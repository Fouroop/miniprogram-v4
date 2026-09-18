// utils/voice.js —— 实时语音通话封装（Seeduplex 全双工版）
// 上行：PCM 16kHz 16bit 单声道，onFrameRecorded 实时分片，20ms(640字节) 一包持续流式上传
// 下行：AI 音频为 base64 PCM s16le 24kHz，嵌在 response.output_audio.delta 事件帧，增量流式播放
// 全双工：麦克风始终开启，服务端 VAD 自动检测用户说话/停顿（无需按住说话）
//
// 协议：火山引擎豆包 Seeduplex（端到端实时语音·全双工）
//   wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue
//   文本 JSON 事件帧，鉴权由 voice-proxy 代理注入 X-Api-Key，客户端无需感知密钥
const { request } = require('./request.js');

const UP_RATE = 16000;
const DOWN_RATE = 24000;
const FRAME_BYTES = 640; // 20ms * 16000 * 2bytes = 640
// 流式播放启动阈值：积累多少样本后才开始播放（防首帧杂音，~50ms）
const STREAM_START_SAMPLES = Math.floor(DOWN_RATE * 0.05);

/* ---------- 24kHz → 设备采样率 线性重采样 ---------- */
function resamplePcm16(i16, fromRate, toRate) {
  if (!i16 || !i16.length) return new Float32Array(0);
  const n = i16.length;
  if (fromRate === toRate) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = Math.max(-1, Math.min(1, i16[i] / 32768));
    return f;
  }
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(n / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const s0 = (i0 < n ? i16[i0] : 0) / 32768;
    const s1 = (i0 + 1 < n ? i16[i0 + 1] : i16[n - 1]) / 32768;
    out[i] = Math.max(-1, Math.min(1, s0 + (s1 - s0) * frac));
  }
  return out;
}

/* ========== 增量流式播放器（收到即播，消除攒够再播的延迟） ========== */
function createStreamingPlayer(opts) {
  var ac = (opts && opts.audioContext) || null;
  var ownsAc = !ac;
  var gainNode = null;
  var volume = 1;

  // 累积 PCM 样本（Float32，设备采样率）
  var sampleBuf = new Float32Array(0);
  var playing = false;
  var started = false;
  var writePos = 0; // 已写入 AudioContext 的样本位置
  var startTime = 0; // 播放起始 AudioContext 时间
  var scheduledSources = []; // 待播放的 source 节点

  function ensureAc() {
    if (!ac || ac.state === 'closed') {
      try { ac = wx.createWebAudioContext({ sampleRate: DOWN_RATE }); }
      catch (e) { ac = wx.createWebAudioContext(); }
      ownsAc = true;
      console.log('[StreamingPlayer] AudioContext state=' + ac.state + ', sampleRate=' + ac.sampleRate);
    }
    return ac;
  }

  function ensureGain() {
    var a = ensureAc();
    if (!gainNode) {
      try {
        gainNode = a.createGain();
        gainNode.gain.value = volume;
        gainNode.connect(a.destination);
      } catch (e) { gainNode = null; }
    }
    return gainNode;
  }

  function scheduleNewChunks() {
    if (!started || writePos >= sampleBuf.length) return;
    var a = ensureAc();
    var gain = ensureGain();
    var dest = gain || a.destination;

    while (writePos < sampleBuf.length) {
      var chunkLen = Math.min(4096, sampleBuf.length - writePos);
      if (chunkLen <= 0) break;
      var chunk = sampleBuf.subarray(writePos, writePos + chunkLen);
      var buf = a.createBuffer(1, chunkLen, a.sampleRate);
      buf.getChannelData(0).set(chunk);
      var src = a.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      var atTime = startTime + writePos / a.sampleRate;
      if (atTime < a.currentTime) atTime = a.currentTime;
      src.start(atTime);
      scheduledSources.push(src);
      src.onended = function () {
        var idx = scheduledSources.indexOf(src);
        if (idx >= 0) scheduledSources.splice(idx, 1);
        if (scheduledSources.length === 0 && playing) {
          playing = false;
          if (opts && opts.onPlay) opts.onPlay(false);
        }
      };
      // 兜底：onended 在切后台/节点异常等情况下可能不触发 → 按预估时长+2s 强制收尾，
      // 避免 playing 卡死导致一直显示“AI 正在回复”
      (function (s, durMs) {
        setTimeout(function () {
          var i = scheduledSources.indexOf(s);
          if (i >= 0) {
            scheduledSources.splice(i, 1);
            if (scheduledSources.length === 0 && playing) {
              playing = false;
              if (opts && opts.onPlay) opts.onPlay(false);
            }
          }
        }, durMs + 2000);
      })(src, Math.round(chunkLen / a.sampleRate * 1000));
      writePos += chunkLen;
    }
  }

  function startPlayback() {
    if (started) return;
    var a = ensureAc();
    started = true;
    playing = true;
    startTime = a.currentTime + 0.02; // 20ms 缓冲
    writePos = 0;
    if (opts && opts.onPlay) opts.onPlay(true);
    scheduleNewChunks();
  }

  // 启动前先解锁 AudioContext（iOS 无手势创建为 suspended，直接调度会无声）
  // 解锁失败则挂起等待：音频继续积累到缓冲区，用户首次触摸（onPageTouch→retry）后从头播放
  function startWhenReady() {
    if (started) return;
    var a = ensureAc();
    if (a.state === 'suspended' || a.state === 'interrupted') {
      if (a.resume) {
        a.resume().then(function () { startPlayback(); }).catch(function () {
          // iOS 无手势：resume 被拒绝，保持未启动，等手势后 retry()
        });
      }
    } else {
      startPlayback();
    }
  }

  return {
    enqueue(buf) {
      if (!buf || !buf.byteLength) return;
      var a = ensureAc();
      var i16 = new Int16Array(buf.buffer || buf, buf.byteOffset || 0, (buf.byteLength || buf.length) >> 1);
      var f32 = resamplePcm16(i16, DOWN_RATE, a.sampleRate);
      if (!f32.length) return;

      // 追加到累积缓冲
      var merged = new Float32Array(sampleBuf.length + f32.length);
      merged.set(sampleBuf, 0);
      merged.set(f32, sampleBuf.length);
      sampleBuf = merged;

      if (opts && opts.onChunk) opts.onChunk(sampleBuf.length);

      // 未开始播放 + 积累够了 → 先尝试解锁 AudioContext（iOS 无手势创建时为 suspended），再启动
      if (!started && sampleBuf.length >= STREAM_START_SAMPLES) {
        startWhenReady();
      } else if (started) {
        // 已在播放 → 调度新到的块
        scheduleNewChunks();
      }
    },
    flush() {
      // 音频流结束信号：确保播放已启动（先解锁再启动）
      if (!started && sampleBuf.length > 0) startWhenReady();
    },
    interrupt() {
      // 插话/打断：立即停止正在播放的 AI 音频并丢弃待播缓冲（保留 AudioContext 复用）
      scheduledSources.forEach(function (s) { try { s.stop(); } catch (e) {} });
      scheduledSources = [];
      sampleBuf = new Float32Array(0);
      writePos = 0;
      started = false;
      playing = false;
      if (opts && opts.onPlay) opts.onPlay(false);
    },
    // iOS/微信：state 可能是 suspended（无手势创建）或 interrupted（被系统打断）
    // 解锁必须在用户手势调用栈内同步执行（如按住 MIC 的 touchstart），异步调用会被拒绝
    unlock() {
      var a = ensureAc();
      if (a && (a.state === 'suspended' || a.state === 'interrupted') && a.resume) {
        try { a.resume(); } catch (e) {}
      }
      return a.state;
    },
    retry() {
      // iOS AudioContext 解锁后重试（覆盖"已启动但 source 挂在 suspended 时间线"的场景）
      var a = ensureAc();
      if (a.state === 'suspended' || a.state === 'interrupted') {
        if (a.resume) {
          a.resume().then(function () {
            if (!started && sampleBuf.length > 0) {
              startPlayback();
            } else if (started && scheduledSources.length === 0 && sampleBuf.length > 0) {
              // 已 started 但没有任何 source 真正调度上 → 重新启动
              started = false;
              playing = false;
              startPlayback();
            }
          }).catch(function () {});
        }
      } else if (!started && sampleBuf.length > 0) {
        startPlayback();
      }
    },
    setVolume(v) {
      volume = v;
      if (gainNode) try { gainNode.gain.value = v; } catch (e) {}
    },
    stop() {
      scheduledSources.forEach(function (s) { try { s.stop(); } catch (e) {} });
      scheduledSources = [];
      sampleBuf = new Float32Array(0);
      writePos = 0;
      started = false;
      playing = false;
      if (ownsAc) try { if (ac) ac.close(); } catch (e) {}
      ac = null; gainNode = null;
      if (opts && opts.onPlay) opts.onPlay(false);
    }
  };
}

/* ---------- 识别文本清洗 ---------- */
function cleanAsrText(t) {
  if (!t) return '';
  let s = String(t).replace(/[，。、；：？！,.!?;:\s]+$/g, '').trim();
  if (!/[一-龥A-Za-z0-9]/.test(s)) return '';
  const hasCn = /[一-龥]/.test(s);
  const cnLen = (s.match(/[一-龥]/g) || []).length;
  const alnumLen = (s.match(/[A-Za-z0-9]/g) || []).length;
  if (hasCn ? cnLen < 2 : alnumLen < 2) return '';
  return s;
}

/* ========== 语音通话对象（Seeduplex 全双工版） ========== */
class VoiceCall {
  /**
   * @param {object} cb 回调集合
   *   onStatus(text, live)          连接状态文案（live=true 表示已接通）
   *   onRecognizing(bool)           识别中
   *   onUserText(text)              识别完成的最终用户文本
   *   onAiTextDelta(text)           AI 文字流式增量
   *   onAiTextDone()                AI 本轮文字结束
   *   onListening(bool)             麦克风收听中
   *   onUserSpeaking(bool)          服务端 VAD 检测到用户说话
   *   onAiSpeaking(bool)            AI 音频播放中
   *   onError(msg)
   */
  constructor(cb) {
    this.cb = cb || {};
    this.socket = null;
    this.player = null;
    this.recorder = null;
    this.voiceId = 'zh_female_vv_jupiter_bigtts';
    this.model = '1.2.6.0'; // 与火山引擎 Seeduplex 上游 model 保持一致
    // 通话唯一ID：计费幂等去重（/voice/end 与代理 /call-report 共用）
    this.callId = 'vc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    this._connectedAt = null;   // 首次接通时间戳（用于统计已接通秒数）
    this.connected = false;
    this._closedByUser = false;
    this.pcmCache = new Uint8Array(0);
    this.aiStream = '';
    this.opening = false;
    this._micInited = false;
    // 全双工状态
    this._micActive = false;     // 麦克风是否正在录音
    this._micPaused = false;     // 用户按住暂停收音（静音上传）
    this._userSpeaking = false;  // 服务端 VAD 检测到用户正在说话
    this._greeted = false;       // 是否已发送过招呼语（重连不重复）
    // 回声抑制状态（AI 播报期间暂停录音器，播报结束恢复）
    this._aiPausedMic = false;   // AI 播报期间已暂停麦克风（防止回声）
    this._doneWaitForPlay = false; // response.done 已收到，等播放结束再恢复麦克风
    this._postAiGuard = false;   // 播报结束后短暂静音过滤残余回声
    this._postAiGuardTimer = null;
    this._reconnects = 0;
    this._reconnectTimer = null;
    this._sessionProbe = null;
    this._frameTimer = null;
    this._framesReceived = false;
    this._userTextBuf = '';
    this._vadDoneTimer = null;
  }

  setCb(key, fn) { this.cb[key] = fn; }
  _emit(key, a, b) { if (this.cb[key]) this.cb[key](a, b); }

  /** 拉取语音配置 */
  fetchConfig() {
    return request('/ai/voice-config').then((data) => {
      data = data || {};
      if (data.voice_id) this.voiceId = data.voice_id;
      return data;
    });
  }

  /**
   * 开始通话（连接成功后自动开麦）
   * @param {string} instructions 人设 + 题干注入
   * @param {string} greeting     接通后招呼语
   * @param {AudioContext} audioContext 可选的共享 AudioContext
   */
  start(instructions, greeting, audioContext, opts) {
    const self = this;
    this._reconnects = 0;
    this._closedByUser = false;
    this._greeted = false;
    // 首次进入只显示文字：开场白音频静音（丢弃不播），第一轮 response.done 后自动恢复
    this._dropAudio = !!(opts && opts.muteGreeting);
    this.opening = true;
    this._emit('onStatus', '正在连接 AI 导师…', false);

    this.fetchConfig().then(function (cfg) {
      const proxy = (cfg && cfg.proxy_url || '').trim();
      if (!proxy) {
        self.opening = false;
        self._emit('onError', '未获取到语音代理地址');
        return;
      }
      self._connect(proxy, instructions, greeting, audioContext);
    }).catch(function () {
      self.opening = false;
      self._emit('onError', '获取语音配置失败');
    });
  }

  _connect(proxyUrl, instructions, greeting, audioContext) {
    const self = this;
    this._proxyUrl = proxyUrl;
    this._instructions = instructions;
    this._greeting = greeting;
    this._audioContext = audioContext;

    // 增量流式播放器（收到即播），同时控制麦克风防止回声
    this.player = createStreamingPlayer({
      audioContext: audioContext || null,
      onChunk: function (n) { self._emit('onAudioChunk', n); },
      onPlay: function (on) {
        self._emit('onAiSpeaking', on);
        if (on) {
          // AI 开始播报 → 暂停麦克风，彻底避免回声
          self._pauseMicForAi();
        } else {
          // AI 播报结束 → 恢复麦克风（若 response.done 已到）
          self._onAiPlayStopped();
        }
      }
    });

    const tk = wx.getStorageSync('token') || '';
    const sep = proxyUrl.indexOf('?') >= 0 ? '&' : '?';
    const wsUrl = proxyUrl + sep + 'token=' + encodeURIComponent(tk) + '&call_id=' + encodeURIComponent(this.callId);
    console.log('[VoiceCall] WebSocket URL:', wsUrl);
    // 显式传 success/fail，避免基础库将 connectSocket 当 Promise 处理（失败产生未处理 rejection）
    this.socket = wx.connectSocket({
      url: wsUrl,
      success: function () {},
      fail: function (e) {
        console.warn('[VoiceCall] connectSocket fail:', e && e.errMsg);
      }
    });

    this.socket.onOpen(function () {
      console.log('[VoiceCall] WebSocket 已连接');
      self.opening = false;
      // 创建会话（Seeduplex 服务端 VAD；VAD 结束判定由客户端 3s 静默兜底保证）
      self._send({
        type: 'session.create',
        session: {
          model: self.model,
          instructions: instructions,
          audio: {
            input: { format: { type: 'pcm', rate: UP_RATE } },
            output: {
              format: { type: 'pcm_s16le', rate: DOWN_RATE },
              voice: self.voiceId,
              speed: -15,
              loudness: 0
            }
          }
        }
      });
      // 探测：3 秒内未收到 session.created → 自动重连
      clearTimeout(self._sessionProbe);
      self._sessionProbe = setTimeout(function () {
        if (!self.connected) {
          console.warn('[VoiceCall] session.create 超时，自动重连');
          self._scheduleReconnect();
        }
      }, 3000);
    });

    this.socket.onMessage(function (res) {
      const data = res.data;
      if (data instanceof ArrayBuffer) {
        // 防御：若收到直接二进制 PCM 帧，直接入播放器（Seeduplex 正常走 base64 JSON）
        console.log('[VoiceCall] 收到二进制帧:', data.byteLength, 'bytes');
        self.player.enqueue(new Uint8Array(data));
        return;
      }
      let msg;
      try { msg = JSON.parse(data); } catch (e) {
        console.warn('[VoiceCall] JSON 解析失败:', String(data).slice(0, 200));
        return;
      }
      console.log('[VoiceCall] 收到事件:', msg.type || '（无 type）');
      self._handleEvent(msg, greeting);
    });

    this.socket.onClose(function (res) {
      // res.code / res.reason 是微信小程序 onClose 的标准字段
      var code = (res && res.code) || 0;
      var reason = (res && res.reason) || '';
      console.log('[VoiceCall] WebSocket 已关闭 code=' + code + ' reason=' + reason);
      self.connected = false;
      self._micActive = false;
      if (self._closedByUser) return;
      if (self._reconnectTimer) return;
      self._teardownMic();
      self._emit('onStatus', '连接已断开，正在重连…', false);
      self._scheduleReconnect();
    });

    this.socket.onError(function (err) {
      console.log('[VoiceCall] WebSocket 错误:', JSON.stringify(err));
      self.opening = false;
      // 不在这里调 _emit('onError')，等 onClose 触发再决定是否重连
    });
  }

  _handleEvent(msg, greeting) {
    const t = msg.type || '';
    const self = this;

    if (t === 'session.created') {
      clearTimeout(this._sessionProbe);
      this.connected = true;
      if (!this._connectedAt) this._connectedAt = Date.now(); // 首次接通计时
      console.log('[VoiceCall] session.created 收到，完整消息:', JSON.stringify(msg).slice(0, 500));
      this._emit('onStatus', '已接通，随时说话', true);
      this.aiStream = '';
      // 首次接通发送招呼语（重连不重复打招呼）
      if (greeting && !this._greeted) {
        this._greeted = true;
        this._emit('onAiGreeting', greeting);
        this._send({ type: 'speech_text_buffer.commit', text: greeting });
      }
      // PTT：接通后麦克风待命（不启动录音器，发静音帧保持流），按住按钮才开麦
      this._openMicLoop();

    } else if (t === 'conversation.item.input_audio_transcription.started') {
      // PTT：仅展示识别状态；麦克风开关完全由按住按钮（interruptMic/commitMic）控制，
      // 服务端 VAD 不干预收音（避免“没按按钮麦克风却开着”）
      this._userSpeaking = true;
      this._emit('onRecognizing', true);
      this._emit('onUserSpeaking', true);

    } else if (t === 'conversation.item.input_audio_transcription.delta') {
      // 实时识别文字（流式显示给用户）
      this._emit('onRecognizing', true);
      const dt = (msg.delta || msg.text || '').trim();
      if (dt) {
        this._userTextBuf = this._mergeDelta(this._userTextBuf, dt);
        this._emit('onUserTextStream', this._userTextBuf);
      }

    } else if (t === 'conversation.item.input_audio_transcription.completed') {
      // 服务端 VAD：检测到用户说完话
      clearTimeout(this._vadDoneTimer);
      this._userSpeaking = false;
      this._userTextBuf = '';
      this._emit('onRecognizing', false);
      this._emit('onUserSpeaking', false);
      const txt = cleanAsrText(msg.transcript || msg.text || msg.delta || '');
      if (txt) this._emit('onUserText', txt);

    } else if (t === 'response.output_text.delta') {
      const txt = (msg.delta || msg.text || '').trim();
      if (txt) {
        this.aiStream = this._mergeDelta(this.aiStream, txt);
        this._emit('onAiTextDelta', this.aiStream);
      }

    } else if (t === 'response.output_text.done') {
      // 若服务端在 done 里携带最终完整文本 → 用它校正（修复流式 merge 可能出现的显示不全）
      const full = (msg.text || msg.transcript || '').trim();
      if (full && full !== this.aiStream) {
        this.aiStream = full;
        this._emit('onAiTextDelta', this.aiStream);
      }
      if (this.aiStream) {
        this._emit('onAiTextDone');
        this.aiStream = '';
      }

    } else if (t === 'response.output_audio.started') {
      // AI 开始输出音频（播放由 output_audio.delta 驱动，这里只需标记）
      console.log('[VoiceCall] AI 开始输出音频');
    } else if (t === 'response.output_audio.delta') {
      // 开场白静音模式：只显示文字，丢弃音频
      if (this._dropAudio) return;
      // AI 音频：base64 PCM s16le 24kHz，增量入播放器（收到即播）
      const b64 = msg.delta || msg.audio || '';
      if (b64) {
        const raw = self._base64ToBytes(b64);
        if (raw && raw.byteLength && this.player) this.player.enqueue(raw);
      }

    } else if (t === 'response.output_audio.done') {
      // AI 音频结束：确保缓冲全部播放
      if (this.player) this.player.flush();

    } else if (t === 'response.done') {
      // 一轮交互结束：音频可能还在播放，等播放结束再恢复麦克风
      this._dropAudio = false; // 开场白结束，后续问答正常出声
      if (this.player) this.player.flush();
      if (this.aiStream) {
        this._emit('onAiTextDone');
        this.aiStream = '';
      }
      this.resumeMicAfterResponse();

    } else if (t === 'error') {
      console.error('[VoiceCall] 服务端错误 event:', JSON.stringify(msg));
      this.connected = false;
      this._teardownMic();
      this._emit('onError', '服务端错误: ' + (msg.message || msg.msg || JSON.stringify(msg)));
      this._scheduleReconnect();

    } else if (t === 'session.closed') {
      console.log('[VoiceCall] 会话已关闭，完整消息:', JSON.stringify(msg).slice(0, 500));
      this.connected = false;
      this._teardownMic();
      this._scheduleReconnect();

    } else if (t === 'response.canceled') {
      console.log('[VoiceCall] response.canceled（取消响应确认）');

    } else if (t) {
      console.log('[VoiceCall] 未处理事件:', t);
    }
  }

  // 自动重连（最多3次）
  _scheduleReconnect() {
    const self = this;
    if (this._reconnectTimer) return;
    if (this._reconnects >= 3) {
      this.connected = false;
      this._emit('onError', '语音服务连接异常，请重新进入页面');
      return;
    }
    this._reconnects++;
    const delay = Math.min(1000 * this._reconnects, 3000);
    console.log('[VoiceCall] ' + delay + 'ms 后自动重连（第' + this._reconnects + '次）');
    this._reconnectTimer = setTimeout(function () {
      self._reconnectTimer = null;
      if (self._closedByUser) return;
      if (self._proxyUrl) {
        self._connect(self._proxyUrl, self._instructions, self._greeting, self._audioContext);
      }
    }, delay);
  }

  /* ---------- Base64 编解码 ---------- */
  _uint8ToBase64(bytes) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      result += chars[b0 >> 2];
      result += chars[((b0 & 3) << 4) | (b1 >> 4)];
      result += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
      result += i + 2 < bytes.length ? chars[b2 & 63] : '=';
    }
    return result;
  }

  _base64ToBytes(b64) {
    const lookup = new Uint8Array(128);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
    const len = b64.length;
    let pad = 0;
    if (len >= 2 && b64[len - 1] === '=' && b64[len - 2] === '=') pad = 2;
    else if (len >= 1 && b64[len - 1] === '=') pad = 1;
    const outLen = ((len >> 2) * 3) - pad;
    const bytes = new Uint8Array(outLen);
    for (let i = 0, j = 0; i < len; i += 4) {
      const a = lookup[b64.charCodeAt(i)] || 0, b = lookup[b64.charCodeAt(i + 1)] || 0;
      const c = lookup[b64.charCodeAt(i + 2)] || 0, d = lookup[b64.charCodeAt(i + 3)] || 0;
      if (j < outLen) bytes[j++] = (a << 2) | (b >> 4);
      if (j < outLen) bytes[j++] = ((b & 15) << 4) | (c >> 2);
      if (j < outLen) bytes[j++] = ((c & 3) << 6) | d;
    }
    return bytes.buffer;
  }

  _mergeDelta(prev, next) {
    if (!prev) return next;
    if (!next) return prev;
    if (next.indexOf(prev) === 0 || next.endsWith(prev)) return next;
    if (next.indexOf(prev) >= 0) return next;
    if (prev.indexOf(next) >= 0) return next;
    return prev + next;
  }

  _send(obj) {
    if (!this.socket) return;
    try {
      this.socket.send({
        data: JSON.stringify(obj),
        fail: function (e) { console.log('[VoiceCall] send 失败:', e && e.errMsg); }
      });
    } catch (e) {}
  }

  /* ---------- 麦克风：始终开启，持续流式上传 ---------- */
  // 接通后麦克风待命：不启动录音器（PTT：麦克风完全由按住按钮控制），
  // 用静音帧循环保持服务端音频流不中断（避免 AudioServerNoAudioInputTooLongError）
  _openMicLoop() {
    const self = this;
    this._micActive = false; // 录音器未运行
    this._micPaused = true;
    this._framesReceived = false;
    this._aiPausedMic = false;
    this._doneWaitForPlay = false;
    this._postAiGuard = false;
    clearTimeout(this._postAiGuardTimer);
    this.pcmCache = new Uint8Array(0);
    clearTimeout(this._frameTimer);
    const tick = function () {
      // 录音器运行且非静音 → 真实帧由 onFrameRecorded 上传，此处跳过
      if (!self._micActive || self._micPaused) {
        self._sendSilence(FRAME_BYTES);
      }
      self._frameTimer = setTimeout(tick, 40);
    };
    this._frameTimer = setTimeout(tick, 40);
    console.log('[VoiceCall] 麦克风待命（按住说话）');
    this._emit('onListening', false);
  }

  _appendPcmFrame(buffer) {
    this._framesReceived = true;
    // 静音保持：AI 播报中/回声保护期 → 上传零幅值帧，维持服务端音频流不中断
    // （否则服务端报 AudioServerNoAudioInputTooLongError 断开会话，导致重连丢上下文）
    if (this._micPaused || this._postAiGuard) {
      this._sendSilence(buffer.byteLength || FRAME_BYTES);
      return;
    }
    const frame = new Uint8Array(buffer);
    const merged = new Uint8Array(this.pcmCache.length + frame.length);
    merged.set(this.pcmCache, 0);
    merged.set(frame, this.pcmCache.length);
    this.pcmCache = merged;
    while (this.pcmCache.length >= FRAME_BYTES) {
      const chunk = this.pcmCache.slice(0, FRAME_BYTES);
      this.pcmCache = this.pcmCache.slice(FRAME_BYTES);
      if (this.connected && this.socket && !this._micPaused) {
        var b64 = this._uint8ToBase64(chunk);
        this._send({ type: 'input_audio_buffer.append', audio: b64 });
      }
    }
  }

  // 上传零幅值帧：静音时保持音频流连续（与真实音频同节奏），避免服务端无输入超时
  _sendSilence(len) {
    if (!this.connected || !this.socket || !len) return;
    const n = Math.min(len, FRAME_BYTES * 2);
    const zero = new Uint8Array(n);
    this._send({ type: 'input_audio_buffer.append', audio: this._uint8ToBase64(zero) });
  }

  // 暂停收音（松开 MIC：静音等待 AI 回复；保持录音器运行，再次按住即恢复）
  pauseMic() {
    if (!this._micActive) return;
    this._micPaused = true;
    this.pcmCache = new Uint8Array(0); // 丢弃未发送的半包，避免恢复后夹带旧音频
    console.log('[VoiceCall] 已暂停收音（静音）');
  }

  // 恢复收音（松开按钮：立即恢复流式上传）
  resumeMic() {
    if (!this._micActive) return;
    this._micPaused = false;
    console.log('[VoiceCall] 麦克风已恢复');
  }

  /* ---------- AI 播报处理：静音防回声 + 按住插话（无 AEC 下避免 AI 自打断） ---------- */
  _pauseMicForAi() {
    // AI 播报时静音麦克风：微信无回声消除，麦克风开放会把 AI 外放拾进去，
    // 服务端 VAD 误判成用户说话 → AI 自问自答。要插话就按住 MIC 按钮（interruptMic）。
    if (!this._micActive || this._micPaused || this._aiPausedMic) return;
    if (this._userSpeaking) return; // 用户正在按住说话，不静音（避免打断）
    this._aiPausedMic = true;
    this._micPaused = true;
    this.pcmCache = new Uint8Array(0);
    console.log('[VoiceCall] AI 播报中，麦克风静音（防回声）；按住 MIC 可插话');
  }

  // 按住 MIC（PTT）：清空服务端缓冲（丢弃静音帧）、停止 AI 播放、启动录音器采集上传
  interruptMic() {
    const self = this;
    // 用户主动插话 → 后续 AI 回复恢复正常出声
    this._dropAudio = false;
    // 关键：按住瞬间处于用户手势调用栈（touchstart），同步解锁 AudioContext
    // 否则 AI 回复音频到达时 resume 被 iOS 拒绝 → 无声；这是"第二次按下才有声"的根因
    if (this.player) { try { this.player.unlock(); } catch (e) {} }
    if (this.connected && this._ws && this._ws.readyState === 1) {
      this._send({ type: 'input_audio_buffer.clear' });
    }
    if (this.player) this.player.interrupt();
    this._aiPausedMic = false;
    this._doneWaitForPlay = false;
    this._postAiGuard = false;
    clearTimeout(this._postAiGuardTimer);
    this._micPaused = false;
    this.pcmCache = new Uint8Array(0);

    if (!this.recorder) {
      const rm = wx.getRecorderManager();
      this.recorder = rm;
      if (!this._micInited) {
        this._micInited = true;
        // 实时 PCM 分片：每录满 frameSize 回调一次，边录边传
        rm.onFrameRecorded(function (res) {
          if (res && res.frameBuffer && self._micActive && !self._micPaused) {
            self._appendPcmFrame(res.frameBuffer);
          }
        });
        rm.onStop(function () {
          self._micActive = false;
        });
        rm.onError(function (e) {
          self._micActive = false;
          self._emit('onListening', false);
          self._emit('onError', '录音失败：' + ((e && e.errMsg) || '请检查麦克风权限'));
        });
      }
    }
    this._micActive = true;
    this._framesReceived = false;
    try {
      this.recorder.start({
        duration: 600000, // 10 分钟上限
        sampleRate: UP_RATE,
        numberOfChannels: 1,
        format: 'PCM',
        frameSize: 1, // 单位 KB，约 32ms 一帧
        enablePCM: true, // 关键：没有它 onFrameRecorded 不会回调 PCM 帧
        success: function () {},
        fail: function (e) {
          console.warn('[VoiceCall] rm.start fail:', e && e.errMsg);
          self._micActive = false;
        }
      });
    } catch (e) {
      this._emit('onError', '无法启动麦克风');
      return;
    }
    this._emit('onListening', true);
    console.log('[VoiceCall] 按住说话：麦克风已开启');
  }

  _onAiPlayStopped() {
    // PTT：AI 播报结束 → 解除 AI 静音标记，保持静音等待（用户按住才说话，不自动恢复收音）
    if (this._aiPausedMic) {
      this._aiPausedMic = false;
      this._doneWaitForPlay = false;
      clearTimeout(this._playWaitTimer);
      this._micPaused = true;
    }
  }

  resumeMicAfterResponse() {
    // PTT：回复完成 → 保持静音等待（用户按住才说话）；静音帧持续发以保持连接
    this._aiPausedMic = false;
    this._doneWaitForPlay = false;
    clearTimeout(this._playWaitTimer);
    this._postAiGuard = false;
    clearTimeout(this._postAiGuardTimer);
    this._micPaused = true;
  }

  // 松开 MIC（PTT 说话结束）：停止录音器（关麦克风）、提交语音；静音帧循环继续保持流
  commitMic() {
    if (this.recorder) {
      try { this.recorder.stop(); } catch (e) {}
    }
    this._micActive = false;
    this._micPaused = true;
    if (this.connected && this._ws && this._ws.readyState === 1) {
      this._send({ type: 'input_audio_buffer.commit' });
    }
    this._userTextBuf = '';
    this._postAiGuard = false;
    clearTimeout(this._postAiGuardTimer);
    this._emit('onListening', false);
    this._emit('onUserSpeaking', false);
    this._emit('onRecognizing', false);
    console.log('[VoiceCall] 已提交语音，麦克风已关闭，等待 AI 回复');
  }

  _resumeMicWithGuard() {
    const self = this;
    const GUARD_MS = 300; // AI 尾音残响过滤，300ms 足够，避免吞掉用户紧接着的话
    this._postAiGuard = true;
    this._micPaused = false;
    console.log('[VoiceCall] 麦克风恢复，' + GUARD_MS + 'ms 后过滤残余回声');
    clearTimeout(this._postAiGuardTimer);
    this._postAiGuardTimer = setTimeout(function () {
      self._postAiGuard = false;
      console.log('[VoiceCall] 回声保护期结束，恢复正常收音');
    }, GUARD_MS);
  }

  _teardownMic() {
    if (this.recorder) {
      try { this.recorder.stop(); } catch (e) {}
      this.recorder = null;
    }
    this._micActive = false;
    this._micPaused = false;
    clearTimeout(this._frameTimer);
    clearTimeout(this._playWaitTimer);
    clearTimeout(this._vadDoneTimer);
    this._playWaitTimer = null;
    this._vadDoneTimer = null;
    this._userTextBuf = '';
    this.pcmCache = new Uint8Array(0);
    this._emit('onListening', false);
  }

  // 用户首次触摸解锁 AudioContext（iOS 自动播放限制）
  retry() {
    if (this.player) this.player.retry();
  }

  /* ---------- 计费辅助 ---------- */
  // 已接通秒数（session.created 起累计，供 /voice/end 上报兜底；服务端优先采用代理实测）
  elapsedSeconds() {
    if (!this._connectedAt) return 0;
    return Math.max(0, Math.round((Date.now() - this._connectedAt) / 1000));
  }

  /* ---------- 结束通话 ---------- */
  stop() {
    this._closedByUser = true;
    this.connected = false;
    this.opening = false;
    this._micActive = false;
    this._micPaused = false;
    this._userSpeaking = false;
    this._aiPausedMic = false;
    this._doneWaitForPlay = false;
    this._postAiGuard = false;
    clearTimeout(this._postAiGuardTimer);
    clearTimeout(this._playWaitTimer);
    this._playWaitTimer = null;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    clearTimeout(this._sessionProbe);
    this._sessionProbe = null;
    this._teardownMic();
    if (this.player) { this.player.stop(); this.player = null; }
    if (this.socket) {
      try { this.socket.onClose = function () {}; this.socket.close(); } catch (e) {}
      this.socket = null;
    }
    this.aiStream = '';
  }
}

module.exports = { VoiceCall };
