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

/* ========== 流式播放引擎（装配→校验→解码→队列→链式调度） ==========
 * 核心原则：收到豆包音频 ≠ 立即播放。
 * 数据流：PCM Validator → Chunk Assembler(累积) → Decoder(重采样 Float32)
 *         → AudioQueue(样本缓冲) → Scheduler(链式相对时间调度) → AudioContext
 * 链式调度：每块播完(onended)才调度下一块，atTime = currentTime + 预缓冲(50ms)，
 * 永不追赶（不按绝对时间线），彻底消除网络抖动导致的 underrun 追赶 → 开头乱码/电音
 */
function createStreamingPlayer(opts) {
  var ac = (opts && opts.audioContext) || null;
  var ownsAc = !ac;
  var gainNode = null;
  var volume = 1;

  // ---- AudioQueue：已解码 PCM（Float32，设备采样率）----
  var sampleBuf = new Float32Array(0); // 待播样本
  var playCursor = 0;                  // 已调度播放的样本位置
  var playing = false;                 // 是否有 chunk 在飞
  var flushPending = false;            // 本轮结束：播完清空
  var announcing = false;              // 播放会话是否已宣布开始（onPlay(true) 只触发一次）
  var scheduledSources = [];           // 在飞 source 节点
  var muted = false;

  var CHUNK_SAMPLES = 8192;            // ~186ms@44.1k
  var HEADROOM_SEC = 0.05;             // 首块预缓冲 50ms
  var START_THRESHOLD_SEC = 0.12;      // 首包启动阈值 120ms（防首帧杂音/断裂）
  var MAX_INFLIGHT = 2;                // 预调度块数：保持 2 块在飞 → 连续时间线、块间零间隙（消除卡顿）
  var nextStartTime = 0;               // 下一块应开始的时间（连续时间线基准）
  var timeBaseSet = false;             // 时间线基准是否已建立

  function resetTimeBase() { timeBaseSet = false; nextStartTime = 0; }

  // iOS 微信 WebAudioContext 未解锁状态：suspended / interrupted / default；仅 running 真正出声
  function isLocked(s) { return s === 'suspended' || s === 'interrupted' || s === 'default'; }

  function ensureAc() {
    if (!ac || ac.state === 'closed') {
      try { ac = wx.createWebAudioContext({ sampleRate: DOWN_RATE }); }
      catch (e) { ac = wx.createWebAudioContext(); }
      ownsAc = true;
      if (ac) console.log('[StreamingPlayer] AudioContext state=' + ac.state + ', sampleRate=' + ac.sampleRate);
      else console.warn('[StreamingPlayer] AudioContext 创建失败');
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

  function clearBuf() { sampleBuf = new Float32Array(0); playCursor = 0; }
  function emitPlay(on) { if (opts && opts.onPlay) opts.onPlay(on); }
  function endSession() { announcing = false; emitPlay(false); }

  // Scheduler：预调度（保持 MAX_INFLIGHT 块在飞，连续时间线、块间零间隙）
  // 时间线基准：首块 currentTime+HEADROOM，后续块紧接上一块末尾；仅 underrun 落后时小补偿一次
  function pump() {
    var a = ensureAc();
    if (isLocked(a.state)) return;                 // 未解锁：等手势 retry()/unlock()
    while (scheduledSources.length < MAX_INFLIGHT && playCursor < sampleBuf.length) {
      var avail = sampleBuf.length - playCursor;
      var chunkLen = Math.min(CHUNK_SAMPLES, avail);
      var chunk = sampleBuf.subarray(playCursor, playCursor + chunkLen);
      playCursor += chunkLen;
      // 诊断 Output RMS
      if (opts && opts.onDiag) {
        try {
          var sum = 0;
          for (var i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
          opts.onDiag(Math.sqrt(sum / chunk.length));
        } catch (e) {}
      }
      var buf = a.createBuffer(1, chunkLen, a.sampleRate);
      buf.getChannelData(0).set(chunk);
      var src = a.createBufferSource();
      src.buffer = buf;
      var gain = ensureGain();
      src.connect(gain || a.destination);
      if (!timeBaseSet) {
        timeBaseSet = true;
        nextStartTime = a.currentTime + HEADROOM_SEC;
      } else {
        nextStartTime += chunkLen / a.sampleRate; // 紧接上一块末尾 → 零间隙
      }
      if (nextStartTime < a.currentTime) {
        // underrun 落后（onended 延迟/网络断）：只补偿一次，不累积
        nextStartTime = a.currentTime + 0.03;
      }
      src.start(nextStartTime);
      scheduledSources.push(src);
      playing = true;
      if (scheduledSources.length === 1 && !announcing) { announcing = true; emitPlay(true); } // 会话开始（仅一次）
      src.onended = function () {
        var idx = scheduledSources.indexOf(src);
        if (idx >= 0) scheduledSources.splice(idx, 1);
        if (flushPending && scheduledSources.length === 0 && playCursor >= sampleBuf.length) {
          flushPending = false;
          clearBuf();
          resetTimeBase();
          endSession();
          return;
        }
        pump(); // 补块（保持 2 块在飞）
        if (scheduledSources.length === 0 && playCursor >= sampleBuf.length) {
          endSession(); // 缓冲耗尽，本轮播完
        }
      };
      // 兜底：onended 切后台等可能不触发 → 按时长+1s 强制推进
      (function (s, durMs) {
        setTimeout(function () {
          var i = scheduledSources.indexOf(s);
          if (i >= 0) {
            scheduledSources.splice(i, 1);
            if (flushPending && scheduledSources.length === 0 && playCursor >= sampleBuf.length) {
              flushPending = false;
              clearBuf();
              resetTimeBase();
              endSession();
              return;
            }
            pump();
            if (scheduledSources.length === 0 && playCursor >= sampleBuf.length) {
              endSession();
            }
          }
        }, durMs + 1000);
      })(src, Math.round(chunkLen / a.sampleRate * 1000));
    }
  }

  // 解锁后启动（sync=手势内同步 / async=网络回调）
  function startWhenReady(sync) {
    var a = ensureAc();
    if (isLocked(a.state)) {
      if (a.resume) {
        if (sync) {
          try { a.resume(); } catch (e) {}
          waitRunningThenPlay();
        } else {
          a.resume().then(function () { waitRunningThenPlay(); }).catch(function () {});
        }
      }
    } else {
      pump();
    }
  }

  function waitRunningThenPlay() {
    var a = ensureAc();
    if (!isLocked(a.state)) { pump(); return; }
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (!isLocked(ensureAc().state) || tries >= 20) {
        clearInterval(t);
        pump();
      }
    }, 50);
  }

  return {
    // 入队：Validator(字节对齐) → Decoder(重采样) → Assembler(合并)
    enqueue(buf) {
      if (!buf || !buf.byteLength) return;
      var a = ensureAc();
      console.log('[VoiceCall] enqueue bytes=' + buf.byteLength + ' acState=' + a.state + ' sampleRate=' + a.sampleRate);
      var i16 = new Int16Array(buf.buffer || buf, buf.byteOffset || 0, (buf.byteLength || buf.length) >> 1);
      var f32 = resamplePcm16(i16, DOWN_RATE, a.sampleRate);
      if (!f32.length) return;
      var merged = new Float32Array(sampleBuf.length + f32.length);
      merged.set(sampleBuf, 0);
      merged.set(f32, sampleBuf.length);
      sampleBuf = merged;
      if (opts && opts.onChunk) opts.onChunk(sampleBuf.length - playCursor);
      if (muted) return;
      if (isLocked(a.state)) return; // 未解锁：等手势 unlock/retry
      if ((sampleBuf.length - playCursor) >= Math.floor(a.sampleRate * START_THRESHOLD_SEC)) {
        pump(); // 首包攒够启动阈值再播（防首帧杂音）；后续包由 pump 预调度续播
      }
    },
    flush() {
      // 本轮结束：播完当前缓冲后清空（跨轮不残留，防下一轮开头混入旧数据）
      if (playCursor >= sampleBuf.length) { clearBuf(); return; }
      flushPending = true;
      pump();
    },
    interrupt() {
      scheduledSources.forEach(function (s) { try { s.stop(); } catch (e) {} });
      scheduledSources = [];
      clearBuf();
      resetTimeBase();
      playing = false;
      flushPending = false;
      endSession();
    },
    unlock() {
      var a = ensureAc();
      if (a && isLocked(a.state) && a.resume) { try { a.resume(); } catch (e) {} }
      return a.state;
    },
    setMuted(v) {
      muted = !!v;
      console.log('[VoiceCall] setMuted(' + muted + ') queued=' + (sampleBuf.length - playCursor));
      if (!muted) {
        var a = ensureAc();
        if (isLocked(a.state) && a.resume) { try { a.resume(); } catch (e) {} }
        pump();
      }
    },
    retry() {
      var a = ensureAc();
      if (isLocked(a.state)) {
        if (a.resume) { try { a.resume(); } catch (e) {} waitRunningThenPlay(); }
      } else {
        pump();
      }
    },
    setVolume(v) { volume = v; if (gainNode) try { gainNode.gain.value = v; } catch (e) {} },
    queueLen() { return sampleBuf.length - playCursor; },
    stop() {
      scheduledSources.forEach(function (s) { try { s.stop(); } catch (e) {} });
      scheduledSources = [];
      clearBuf();
      resetTimeBase();
      playing = false;
      flushPending = false;
      if (ownsAc) try { if (ac) ac.close(); } catch (e) {}
      ac = null; gainNode = null;
      endSession();
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
    this._recStarted = false;    // 录音器是否已成功启动（防止对未启动录音器 stop 触发 not start 错误）
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
    this._suppressAudio = false; // 打断后抑制服务端残余音频（避免截断尾巴重播导致声音异常）
    this._suppressTimer = null;  // 抑制解除兜底定时器
    // VoiceSession 状态机：IDLE→INITIALIZING→AUDIO_UNLOCKED→CONNECTING→LISTENING→
    // USER_SPEAKING→THINKING→AI_SPEAKING→INTERRUPTED→LISTENING→ENDED（所有转换可追踪日志）
    this._state = 'IDLE';
    // 回声诊断数据（getDiag() 供调试面板读取）
    this._diag = { inputRms: 0, outputRms: 0, queue: 0, vad: 'SILENCE', micUpload: false, playback: false };
  }

  setState(s) {
    if (this._state === s) return;
    const prev = this._state;
    this._state = s;
    const ts = new Date().toISOString().slice(11, 23);
    console.log('[VoiceCall][' + ts + '][' + (this.callId || '-') + '] state: ' + prev + ' -> ' + s);
    if (this.cb.onState) this.cb.onState(s, prev);
  }

  /** 回声诊断数据（调试面板） */
  getDiag() {
    const playing = this._state === 'AI_SPEAKING';
    this._diag.vad = this._userSpeaking ? 'SPEECH' : 'SILENCE';
    this._diag.micUpload = !!(this._micActive && !this._micPaused && !playing);
    this._diag.playback = playing;
    this._diag.queue = this.player ? this.player.queueLen() : 0;
    return {
      state: this._state,
      inputRms: this._diag.inputRms || 0,
      outputRms: this._diag.outputRms || 0,
      vad: this._diag.vad,
      micUpload: this._diag.micUpload,
      playback: this._diag.playback,
      queue: this._diag.queue,
      sampleRate: DOWN_RATE,
      bitDepth: 16,
      channel: 1
    };
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
    // 首次手势解锁架构：用户在【开始语音聊天】手势内已创建/激活 AudioContext，
    // 连接后 AI 音频自动入队播放，不再要求用户每次点击播放
    this.opening = true;
    this.setState('INITIALIZING');
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
      onDiag: function (rms) { self._diag.outputRms = rms; },
      onPlay: function (on) {
        self._emit('onAiSpeaking', on);
        if (on) {
          // AI 开始播报 → 暂停麦克风，彻底避免回声
          self.setState('AI_SPEAKING');
          self._pauseMicForAi();
        } else {
          // AI 播报结束 → 恢复麦克风（若 response.done 已到）
          self.setState('LISTENING');
          self._onAiPlayStopped();
        }
      }
    });
    this.setState('CONNECTING');
    // 播放器创建即完成 AudioBufferQueue 初始化（不重复创建 AudioContext）
    console.log('[PLAYER][' + new Date().toISOString().slice(11, 23) + '] Buffer queue initialized');
    const tk = wx.getStorageSync('token') || '';
    const sep = proxyUrl.indexOf('?') >= 0 ? '&' : '?';
    const wsUrl = proxyUrl + sep + 'token=' + encodeURIComponent(tk) + '&call_id=' + encodeURIComponent(this.callId);
    console.log('[DOUBAO][' + new Date().toISOString().slice(11, 23) + '] WebSocket URL:', wsUrl);
    // 显式传 success/fail，避免基础库将 connectSocket 当 Promise 处理（失败产生未处理 rejection）
    this.socket = wx.connectSocket({
      url: wsUrl,
      success: function () {},
      fail: function (e) {
        console.warn('[DOUBAO] connectSocket fail:', e && e.errMsg);
      }
    });

    this.socket.onOpen(function () {
      console.log('[DOUBAO][' + new Date().toISOString().slice(11, 23) + '] WebSocket connected');
      self.opening = false;
      self.setState('AUDIO_UNLOCKED');
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
      console.log('[DOUBAO][' + new Date().toISOString().slice(11, 23) + '] session.created, session=' + (msg.session && msg.session.id));
      this.setState('LISTENING');
      this._emit('onStatus', '已接通，随时说话', true);
      this.aiStream = '';
      // 首次接通发送招呼语（重连不重复打招呼）
      if (greeting && !this._greeted) {
        this._greeted = true;
        this._emit('onAiGreeting', greeting);
        this._send({ type: 'speech_text_buffer.commit', text: greeting });
      }
      // 全双工免按：接通后自动开麦（用户已点【开始语音聊天】= 授权），直接说话
      this.startMicFullDuplex();

    } else if (t === 'conversation.item.input_audio_transcription.started') {
      // 全双工免按：AI 播放中检测到用户说话 → 立即打断（Barge-in）
      if (this._state === 'AI_SPEAKING' || this._state === 'THINKING') {
        console.log('[INTERRUPT][' + new Date().toISOString().slice(11, 23) + '] VAD: user speech during AI playback -> interrupt');
        this._suppressAudio = true; // 抑制服务端残余音频，防止截断尾巴重播
        clearTimeout(this._suppressTimer);
        const self2 = this;
        this._suppressTimer = setTimeout(function () { self2._suppressAudio = false; }, 2000); // 兜底解除
        if (this.player) { try { this.player.interrupt(); } catch (e) {} }
        if (this.connected && this._ws && this._ws.readyState === 1) {
          this._send({ type: 'input_audio_buffer.clear' });
        }
        this.setState('INTERRUPTED');
        // 打断后立即恢复收音：用户后半句话必须能继续上传（否则服务端听不全 → 回复异常/没声音）
        this._aiPausedMic = false;
        this._micPaused = false;
        this.pcmCache = new Uint8Array(0);
        this._postAiGuard = false;
        clearTimeout(this._postAiGuardTimer);
      }
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
      // AI 开始生成回复 → THINKING（生成/合成中，尚未播放）；新一轮回复开始 → 解除打断抑制
      this._suppressAudio = false;
      clearTimeout(this._suppressTimer);
      if (this._state === 'LISTENING' || this._state === 'USER_SPEAKING') this.setState('THINKING');
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
      if (this._suppressAudio) {
        console.log('[VoiceCall] 打断抑制中，忽略 output_audio.started');
        return;
      }
      console.log('[VoiceCall] AI 开始输出音频');
    } else if (t === 'response.output_audio.delta') {
      // AI 音频：base64 PCM s16le 24kHz，增量入播放器（收到即播）
      // 打断抑制：interrupt 后服务端仍会推送残余音频，直接丢弃，避免截断尾巴重播
      if (this._suppressAudio) {
        console.log('[VoiceCall] 打断抑制中，丢弃残余音频 chunk');
        return;
      }
      const b64 = msg.delta || msg.audio || '';
      console.log('[VoiceCall] audioDelta b64=' + (b64 ? b64.length : 0) + ' keys=' + Object.keys(msg).join(',') + ' player=' + !!(this.player));
      if (b64) {
        const raw = self._base64ToBytes(b64);
        console.log('[VoiceCall] audioDelta rawBytes=' + (raw ? raw.byteLength : 0));
        if (raw && raw.byteLength && this.player) this.player.enqueue(raw);
      }

    } else if (t === 'response.output_audio.done') {
      // AI 音频结束：确保缓冲全部播放
      this._suppressAudio = false;
      clearTimeout(this._suppressTimer);
      if (this.player) this.player.flush();

    } else if (t === 'response.done') {
      // 一轮交互结束：音频可能还在播放，等播放结束再恢复麦克风
      this._suppressAudio = false;
      clearTimeout(this._suppressTimer);
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
      // 取消响应 = 打断收尾信号：解除残余音频抑制（否则后续轮次会一直无声只出文字）
      this._suppressAudio = false;
      clearTimeout(this._suppressTimer);
      this._resumeMicWithGuard();

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
    // 静音保持：AI 播报中/回声保护期/状态机 AI_SPEAKING → 上传零幅值帧，维持服务端音频流不中断
    // （否则服务端报 AudioServerNoAudioInputTooLongError 断开会话，导致重连丢上下文）
    // 同时这是"防回环"硬保险：AI 正在说话时绝不把麦克风采到的 AI 声音当用户语音上传
    if (this._micPaused || this._postAiGuard || this._state === 'AI_SPEAKING') {
      this._sendSilence(buffer.byteLength || FRAME_BYTES);
      return;
    }
    // 诊断：Input RMS（0~1，判断是否真在收音/是否采到回环）
    try {
      const dI16 = new Int16Array(buffer.buffer || buffer, buffer.byteOffset || 0, (buffer.byteLength || 0) >> 1);
      let sum = 0;
      for (let i = 0; i < dI16.length; i++) sum += dI16[i] * dI16[i];
      this._diag.inputRms = Math.sqrt(sum / Math.max(1, dI16.length)) / 32768;
    } catch (e) {}
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

  /* ---------- AI 播报处理：静音防回声 + 直接说话打断（无 AEC 下避免 AI 自问自答） ---------- */
  _pauseMicForAi() {
    // AI 播报时静音麦克风：微信无回声消除，麦克风开放会把 AI 外放拾进去，
    // 服务端 VAD 误判成用户说话 → AI 自问自答。全双工下由 VAD 检测用户真实说话自动打断。
    if (!this._micActive || this._micPaused || this._aiPausedMic) return;
    if (this._userSpeaking) return; // 用户正在说话，不静音（VAD 已触发打断）
    this._aiPausedMic = true;
    this._micPaused = true;
    this.pcmCache = new Uint8Array(0);
    console.log('[VoiceCall] AI 播报中，麦克风数据不上传（防回声）；直接说话可打断');
  }

  /* ---------- 录音器初始化（RecorderManager 全局单例，只注册一次回调） ---------- */
  _ensureRecorder() {
    const self = this;
    if (this.recorder) return;
    const rm = wx.getRecorderManager();
    this.recorder = rm;
    // 实时 PCM 分片：每录满 frameSize 回调一次，边录边传
    // 注意：不做 !_micPaused 过滤——帧一律进 _appendPcmFrame，
    // 由它内部决定上传静音帧（AI 播放/回声保护，维持服务端输入流不断）还是真实帧
    rm.onFrameRecorded(function (res) {
      if (res && res.frameBuffer && self._micActive) {
        self._appendPcmFrame(res.frameBuffer);
      }
    });
    rm.onStop(function () {
      self._micActive = false;
      self._recStarted = false;
    });
    rm.onError(function (e) {
      const errMsg = (e && e.errMsg) || '';
      // 隐私未声明/未授权：微信隐私接口机制，start/stop 均失败 → 单独事件引导用户处理，
      // 不弹"录音失败"、不触发自动重连死循环（重连也无法解决）
      if (errMsg.indexOf('privacy') >= 0 || errMsg.indexOf('scope') >= 0) {
        console.warn('[VoiceCall] 录音被隐私协议拦截:', errMsg);
        self._micActive = false;
        self._recStarted = false;
        self._emit('onPrivacyError', errMsg);
        return;
      }
      // 可恢复：对"未启动"录音器 stop/start 状态竞争触发（基础库会异步报 not start），
      // 录音器可能仍在工作 → 静默自愈重试，不弹错、不清麦克风标志（否则用户语音全部丢失）
      if (errMsg.indexOf('not start') >= 0 || errMsg.indexOf('recorder not start') >= 0) {
        console.warn('[VoiceCall] recorder not start（状态竞争），自动恢复');
        self._recStarted = false;
        if (self._micActive && !self._micPaused) {
          setTimeout(function () {
            if (self._micActive && !self._micPaused) self._startRecorder();
          }, 300);
        }
        return;
      }
      self._micActive = false;
      self._recStarted = false;
      self._emit('onListening', false);
      self._emit('onError', '录音失败：' + (errMsg || '请检查麦克风权限'));
    });
  }

  _startRecorder() {
    const self = this;
    this._micActive = true;
    this._framesReceived = false;
    // RecorderManager 是全局单例：仅在确认已启动时先 stop 清残留——
    // 对未启动的录音器执行 stop 会异步触发 operateRecorder:fail recorder not start，
    // 进而污染 onError 回调（这正是"没有出文字"的根因）
    if (this._recStarted) {
      try { this.recorder.stop(); } catch (e) {}
    }
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
          self._recStarted = false;
          const errMsg = (e && e.errMsg) || '';
          if (errMsg.indexOf('privacy') >= 0 || errMsg.indexOf('scope') >= 0) {
            self._emit('onPrivacyError', errMsg);
            return;
          }
          self._emit('onError', '录音启动失败：' + (errMsg || '请检查麦克风权限'));
        }
      });
      this._recStarted = true;
    } catch (e) {
      this._emit('onError', '无法启动麦克风');
      return;
    }
    this._emit('onListening', true);
  }

  // 全双工免按开麦：点击【开始语音聊天】接通后自动开启，直接说话即可；
  // AI 播放期间帧在 _appendPcmFrame 被状态机闸门丢弃（防回环），AI 说完自动恢复收音
  startMicFullDuplex() {
    this._suppressAudio = false;
    clearTimeout(this._suppressTimer);
    this._aiPausedMic = false;
    this._doneWaitForPlay = false;
    this._postAiGuard = false;
    clearTimeout(this._postAiGuardTimer);
    this._micPaused = false;
    this.pcmCache = new Uint8Array(0);
    this._ensureRecorder();
    this._startRecorder();
    this.setState('LISTENING');
    console.log('[VoiceCall] 全双工免按：麦克风已开启，直接说话（AI 说话时可直接打断）');
  }

  // 按住 MIC（PTT 备用）：清空服务端缓冲（丢弃静音帧）、停止 AI 播放、启动录音器采集上传
  interruptMic() {
    const self = this;
    // Barge-in：AI 播放中按住 → 立即打断（INTERRUPTED），否则进入用户说话状态
    this.setState(this._state === 'AI_SPEAKING' ? 'INTERRUPTED' : 'USER_SPEAKING');
    console.log('[INTERRUPT][' + new Date().toISOString().slice(11, 23) + '] AI interrupted / mic on');
    // 关键：按住瞬间处于用户手势调用栈（touchstart），同步解锁 AudioContext
    if (this.player) { try { this.player.unlock(); } catch (e) {} }
    if (this.connected && this._ws && this._ws.readyState === 1) {
      this._send({ type: 'input_audio_buffer.clear' });
    }
    if (this.player) this.player.interrupt();
    this._suppressAudio = true; // 抑制服务端残余音频
    clearTimeout(this._suppressTimer);
    const self2 = this;
    this._suppressTimer = setTimeout(function () { self2._suppressAudio = false; }, 2000); // 兜底解除
    this._aiPausedMic = false;
    this._doneWaitForPlay = false;
    this._postAiGuard = false;
    clearTimeout(this._postAiGuardTimer);
    this._micPaused = false;
    this.pcmCache = new Uint8Array(0);
    this._ensureRecorder();
    this._startRecorder();
    console.log('[VoiceCall] 按住说话：麦克风已开启');
  }

  _onAiPlayStopped() {
    // 全双工免按：AI 播完 → 立即恢复收音（300ms 回声保护后正常上传）
    if (this._aiPausedMic) {
      this._aiPausedMic = false;
      this._doneWaitForPlay = false;
      clearTimeout(this._playWaitTimer);
    }
    this._resumeMicWithGuard();
  }

  resumeMicAfterResponse() {
    // 全双工免按：回复结束 → 若仍在播放则保持静音等播完，否则立即恢复收音
    this._aiPausedMic = false;
    this._doneWaitForPlay = false;
    clearTimeout(this._playWaitTimer);
    this._postAiGuard = false;
    clearTimeout(this._postAiGuardTimer);
    if (this._state !== 'AI_SPEAKING') {
      this._resumeMicWithGuard();
    } else {
      this._micPaused = true; // 播放未完，保持静音，_onAiPlayStopped 负责恢复
    }
  }

  // 松开 MIC（PTT 说话结束）：停止录音器（关麦克风）、提交语音；静音帧循环继续保持流
  commitMic() {
    if (this.recorder) {
      try { this.recorder.stop(); } catch (e) {}
      this._recStarted = false;
    }
    this._micActive = false;
    this._micPaused = true;
    this.setState('LISTENING'); // 已提交语音，等待 AI 回复（随后 THINKING→AI_SPEAKING）
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
    this._recStarted = false;
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
    this.setState('ENDED');
  }
}

module.exports = { VoiceCall };
