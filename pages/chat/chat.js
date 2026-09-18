// pages/chat/chat.js
const { request, BASE_URL } = require('../../utils/request.js');
const { VoiceCall } = require('../../utils/voice.js');
const store = require('../../utils/store.js');
const app = getApp();

// 与下行 PCM 采样率保持一致，避免重采样
const DOWN_RATE = 24000;

// 思维引导人设
const PERSONA =
  '你是「思维引导式辅导老师」，正在用打电话的方式辅导一名中学生。\n' +
  '教学原则：绝不直接给出答案或完整解法。每次只提一个启发性的小问题，引导学生自己说出思路、发现错误、推出结论。\n' +
  '对话风格：亲切、耐心、口语化，像真人老师打电话一样自然，每轮回复不超过 3 句话。学生答对关键一步时明确肯定，再引导下一步。';

Page({
  data: {
    isVip: false,
    inputMode: 'voice',      // voice（按住说话）| text（键盘输入），微信聊天式切换
    mistakeId: null,
    mistake: null,

    stemOpen: true,
    headStatusText: '支持文字与语音提问',
    topic: '自由提问',
    scrollIntoViewId: '',

    // 聊天记录（文字 + 语音统一列表）
    messages: [],
    inputText: '',
    seedSession: false,
    typing: false,
    conversationId: null,

    // 语音通话状态（按住说话 PTT）
    callOn: false,
    connected: false,       // 会话已接通
    callListening: false,   // 麦克风收音中
    micPaused: false,       // 用户按住收音中
    aiSpeaking: false,      // AI 音频播放中（仅作状态展示）
    recognizing: false,     // 识别用户语音中
    userSpeaking: false,    // 服务端 VAD 检测到用户正在说话
    callStatusText: '',
    callSeconds: 0,
    callSecondsText: '未接通',
    audioChunks: 0,

    // 辅导后掌握标记
    showMastery: false,
    masterySel: '',
    masteryTag: '',
    masteryReported: false
  },

  voice: null,
  timerInt: null,
  _audioCtx: null,

  onLoad(opts) {
    // 计费已切换为语音包：文字对话免费开放，语音通话按语音包计费（startCall 时校验）
    // 恢复本地保存的聊天记录（重新进入页面不丢）
    this._restoreHistory();

    // 从题库"问这道题"进入：与错题辅导一致——带上题干、自动语音连接、AI 开口讲解
    const seed = wx.getStorageSync('chat_seed');
    if (seed && seed.stem) {
      wx.removeStorageSync('chat_seed');
      this.setData({
        seedSession: true,
        mistake: {
          stem: seed.stem,
          answer: seed.answer || '',
          subject: seed.subject || '数学',
          tag: seed.tag || ''
          // 题库题没有错因定位，reason 留空（开场白不会提"错因"）
        },
        topic: (seed.subject || '数学') + (seed.tag ? ' · ' + seed.tag : ''),
        headStatusText: '正在连接 AI 导师…'
      });
      this._autoStartVoice();
      return;
    }

    if (opts.mistake_id) {
      this.setData({ mistakeId: opts.mistake_id });
      // 先加载题目，再自动连接——确保 AI 建会话时系统指令里已带题干（避免 AI 不知道题目）
      request('/mistakes/' + opts.mistake_id).then((m) => {
        this.setData({
          mistake: m,
          topic: (m.subject || '') + (m.tag ? ' · ' + m.tag : '')
        });
        this._autoStartVoice();
      }).catch(() => { this._autoStartVoice(); });
    } else {
      // 自由提问：直接自动连接
      this._autoStartVoice();
    }
  },

  // 进入页面自动连接并让 AI 导师先开口
  _autoStartVoice() {
    const self = this;
    // 服务端余额校验（/voice/start 校验语音包余额与有效期，防止余额不足仍通话）
    request('/voice/start', { method: 'POST' }).then((d) => {
      d = d || {};
      if (!d.allow) {
        wx.showModal({
          title: '需要开通语音包',
          content: '打电话辅导按分钟计费，请先开通语音包（单次/月付/年付三档）。',
          confirmText: '去开通',
          cancelText: '先用文字',
          success: (r) => {
            if (r.confirm) wx.switchTab({ url: '/pages/me/me' });
            else {
              self.setData({ inputMode: 'text' });
              // 题库/错题进入：自动转文字讲解，避免进入后没反应
              self._fallbackTextAsk();
            }
          }
        });
        return;
      }
      // 立即自动连接，连接成功 AI 导师会先说话（用户随时开口即可对话）
      if (self.data.inputMode !== 'voice') return;
      self._ensureVoice().catch(() => {});
    }).catch(() => {
      // 余额不足或网络异常：静默回文字输入，有题则自动转文字讲解
      self.setData({ inputMode: 'text' });
      self._fallbackTextAsk();
    });
  },

  // 语音不可用时：带着当前题目自动发一条文字讲解请求（题库/错题进入）
  _fallbackTextAsk() {
    if (this.data.mistake && this.data.mistake.stem) {
      this._postText('帮我讲这道题：' + this.data.mistake.stem);
    }
  },

  goVip() { wx.switchTab({ url: '/pages/me/me' }); },

  // 触摸页面：解锁 AudioContext（iOS 自动播放限制），解锁完成后重放 AI 未播出的声音
  // 每次都尝试（resume/retry 幂等），首次解锁失败时后续触摸仍可触发
  onPageTouch() {
    this._ensureAudioCtx();
    const ac = this._audioCtx;
    if (ac && (ac.state === 'suspended' || ac.state === 'interrupted') && ac.resume) {
      // 手势栈内同步 resume（iOS 要求），随后异步 retry 重放
      try { ac.resume(); } catch (e) {}
      try {
        ac.resume().then(() => { if (this.voice) this.voice.retry(); }).catch(() => {});
      } catch (e) {}
    } else if (this.voice) {
      this.voice.retry();
    }
  },

  /* ---------- 输入方式切换（微信聊天式：语音/键盘） ---------- */
  toggleInputMode() {
    const next = this.data.inputMode === 'text' ? 'voice' : 'text';
    if (next === 'text' && this.data.callOn) this.hangup();
    this.setData({
      inputMode: next,
      headStatusText: next === 'voice' ? '语音：接通后按住说话' : '支持文字与语音提问'
    });
  },

  toggleStem() { this.setData({ stemOpen: !this.data.stemOpen }); },

  // 新消息时滚动到底部锚点（'' 与 'msg-end' 交替，保证每次都触发跟随）
  _bumpScroll() {
    this.setData({ scrollIntoViewId: this.data.scrollIntoViewId ? '' : 'msg-end' });
  },

  /* ---------- 聊天记录（统一：文字 + 语音）删除 ---------- */
  onMsgLongPress(e) {
    const idx = e.currentTarget.dataset.idx;
    const msg = this.data.messages[idx];
    if (!msg) return;
    const self = this;
    wx.showActionSheet({
      itemList: ['删除此消息', '清空全部聊天'],
      success(res) {
        if (res.tapIndex === 0) {
          self._deleteOneMsg(idx);
        } else if (res.tapIndex === 1) {
          self.clearTextHistory();
        }
      }
    });
  },
  _deleteOneMsg(idx) {
    const msgs = this.data.messages.slice();
    msgs.splice(idx, 1);
    this.setData({ messages: msgs });
    this._saveHistory();
  },
  clearTextHistory() {
    const self = this;
    wx.showModal({
      title: '清空聊天记录？',
      content: '清空后不可恢复',
      confirmColor: '#D64541',
      success(r) {
        if (!r.confirm) return;
        self.setData({
          messages: [{ role: 'ai', text: '你好，我是你的 AI 思维引导导师。我不会直接给答案，会一步步问你，直到你自己想通。开始吧。' }],
          conversationId: null
        });
        self._saveHistory();
        store.remove(self._histKey());
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  },

  /* ---------- 聊天记录本地持久化（文字+语音统一） ---------- */
  _histKey() {
    // 题库"问这道题"会话独立存储，避免与自由提问记录混在一起
    if (this.data.seedSession) return 'chat_seed_' + (this.data.topic || 'q');
    return 'chat_' + (this.data.mistakeId || 'free');
  },
  _saveHistory() {
    store.set(this._histKey(), {
      messages: this.data.messages,
      conversationId: this.data.conversationId || null
    });
  },

  _restoreHistory() {
    // 新版统一记录：chat_<mistakeId>
    const saved = store.get(this._histKey());
    if (saved && Array.isArray(saved.messages) && saved.messages.length) {
      this.setData({
        messages: saved.messages,
        conversationId: saved.conversationId || null
      });
      this._bumpScroll();
      return;
    }
    // 兼容旧版：chat_text_xxx（文字） + chat_voice_xxx（语音）合并
    const t = store.get('chat_text_' + (this.data.mistakeId || 'free'));
    const v = store.get('chat_voice_' + (this.data.mistakeId || 'free'));
    let msgs = [];
    if (t && Array.isArray(t.messages) && t.messages.length) {
      msgs = msgs.concat(t.messages);
      this.setData({ conversationId: t.conversationId || null });
    }
    if (v && Array.isArray(v.callLog) && v.callLog.length) {
      msgs = msgs.concat(v.callLog.map((m) => ({
        role: m.role,
        text: m.text,
        voice: m.role === 'user' ? true : undefined,
        stream: m.stream
      })));
    }
    if (!msgs.length) {
      msgs = [{
        role: 'ai',
        text: '你好，我是你的 AI 思维引导导师。我不会直接给答案，会一步步问你，直到你自己想通。开始吧。'
      }];
    }
    this.setData({ messages: msgs });
    this._bumpScroll();
  },

  /* ---------- 文字对话 ---------- */
  onInput(e) { this.setData({ inputText: e.detail.value }); },

  sendText() {
    const text = this.data.inputText.trim();
    if (!text || this.data.typing) return;
    this.setData({ inputText: '' });
    this._postText(text);
  },

  // 发送一条文字并等待 AI 回复（供输入框与"问这道题"共用）
  _postText(text) {
    const msgs = this.data.messages.concat([{ role: 'user', text }]);
    this.setData({ messages: msgs, typing: true });
    this._saveHistory();
    this._bumpScroll();

    request('/ai/chat', {
      method: 'POST',
      data: {
        content: text,
        mode: 'text',
        mistake_id: this.data.mistakeId,
        conversation_id: this.data.conversationId
      }
    }).then((data) => {
      data = data || {};
      if (data.conversation_id) this.setData({ conversationId: data.conversation_id });
      const reply = data.reply || data.reply_text || data.content || '嗯，说说你的思路，卡在哪一步？';
      this.setData({
        typing: false,
        messages: this.data.messages.concat([{ role: 'ai', text: reply }])
      });
      this._saveHistory();
      this._bumpScroll();
    }).catch(() => this.setData({ typing: false }));
  },

  /* ---------- 语音模式（全双工：麦克风始终开启，服务端 VAD 检测说话/停顿） ---------- */
  buildInstructions() {
    const stem = this.data.mistake ? this.data.mistake.stem : '';
    return PERSONA + '\n当前辅导的题目：' + (stem || '学生自由提问，先了解他想问什么');
  },

  // 确保 AudioContext 已创建（用户手势中调用）
  _ensureAudioCtx() {
    if (this._audioCtx) return;
    try {
      if (wx.createWebAudioContext) {
        try { this._audioCtx = wx.createWebAudioContext({ sampleRate: DOWN_RATE }); }
        catch (e) { this._audioCtx = wx.createWebAudioContext(); }
        if (this._audioCtx.state === 'suspended' && this._audioCtx.resume) this._audioCtx.resume();
      }
    } catch (e) {}
  },

  // 根据当前通话状态刷新顶部状态文案
  _refreshStatus() {
    const d = this.data;
    if (!d.callOn || !d.connected) {
      // 未通话：头部显示输入方式提示
      const hint = d.inputMode === 'voice'
        ? (d.callStatusText || '点击下方按钮接通 AI 导师')
        : '支持文字与语音提问';
      this.setData({ headStatusText: hint });
      return;
    }
    let text;
    if (d.recognizing || d.userSpeaking) text = '正在听你说…';
    else if (d.aiSpeaking) text = 'AI 正在回复…（按住可打断）';
    else text = '按住下方按钮说话';
    this.setData({ callStatusText: text, headStatusText: text });
  },

  // 确保 VoiceCall 已创建（复用同一个实例，其内部会自动重连）
  _ensureVoice() {
    if (this.voice) return Promise.resolve();
    if (this._voiceConnecting) return this._voiceConnecting;
    const self = this;
    this._ensureAudioCtx();
    let resolved = false;
    const p = new Promise((resolve, reject) => {
      self.setData({ callOn: true, callStatusText: '正在连接…' });
      self.voice = new VoiceCall({
        onStatus(text, live) {
          if (live) {
            self.setData({ connected: true, callStatusText: text });
            self._refreshStatus();
            if (!resolved) { resolved = true; resolve(); }
          } else {
            self.setData({ connected: false, callStatusText: text });
            self._refreshStatus();
          }
        },
        onRecognizing(on) { self.setData({ recognizing: on }); self._refreshStatus(); },
        onListening(on) { self.setData({ callListening: on }); },
        onUserText(text) {
          // 定稿用户语音识别文字：更新最后一条"识别中"条目，或追加新条（统一进 messages）
          const msgs = self.data.messages.slice();
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'user' && last.stream) {
            msgs[msgs.length - 1] = { role: 'user', text: text, voice: true };
          } else {
            msgs.push({ role: 'user', text: text, voice: true });
          }
          self.setData({ messages: msgs });
          self._saveHistory();
          self._bumpScroll();
        },
        onUserTextStream(text) {
          // 实时识别文字（边说边显示）
          const msgs = self.data.messages.slice();
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'user' && last.stream) {
            msgs[msgs.length - 1] = { role: 'user', text: text, stream: true, voice: true };
          } else {
            msgs.push({ role: 'user', text: text, stream: true, voice: true });
          }
          self.setData({ messages: msgs });
          self._bumpScroll();
        },
        onAiGreeting(text) {
          self.setData({ messages: self.data.messages.concat([{ role: 'ai', text }]) });
          self._saveHistory();
          self._bumpScroll();
        },
        onAiTextDelta(text) {
          const msgs = self.data.messages.slice();
          const last = msgs[msgs.length - 1];
          if (last && last.stream) {
            msgs[msgs.length - 1] = { role: 'ai', text: text, stream: true };
          } else {
            msgs.push({ role: 'ai', text: text, stream: true });
          }
          self.setData({ messages: msgs, typing: true });
          self._bumpScroll();
        },
        onAiTextDone() {
          const msgs = self.data.messages.slice();
          if (msgs.length && msgs[msgs.length - 1].stream) {
            msgs[msgs.length - 1] = { role: 'ai', text: msgs[msgs.length - 1].text };
          }
          self.setData({ messages: msgs, typing: false });
          self._saveHistory();
          self._bumpScroll();
        },
        onAiSpeaking(on) { self.setData({ aiSpeaking: on }); self._refreshStatus(); },
        onUserSpeaking(on) { self.setData({ userSpeaking: on }); self._refreshStatus(); },
        onError(msg) {
          console.warn('[Chat] voice error:', msg);
          // 只提示用户，不要删掉 voice 对象——VoiceCall 内部会自动重连
          self.setData({ callStatusText: msg });
          self._refreshStatus();
        }
      });
      const greeting = self._buildGreeting();
      // 确保题干已就绪再建会话（用户进页面立即按 MIC 时，避免 AI 不知道题目）
      const prep = self.data.mistakeId && !self.data.mistake
        ? request('/mistakes/' + self.data.mistakeId).then((m) => {
            self.setData({ mistake: m });
          }).catch(() => {})
        : Promise.resolve();
      prep.then(() => {
        // 题干就绪后重新生成开场白（结合刚拿到的题目/错因）
        // 首次进入只发文字、不播开场白语音（iOS 无声问题规避）；问答环节正常出声
        self.voice.start(self.buildInstructions(), self._buildGreeting(), self._audioCtx, { muteGreeting: true });
      });
    });
    this._voiceConnecting = p;
    p.then(() => { self._voiceConnecting = null; }, () => { self._voiceConnecting = null; });
    return p;
  },

  // 开场白：结合昵称 / 题目 / 错因，随机变体，避免每次固定同一句话
  _buildGreeting() {
    const user = app.globalData.user || {};
    const nick = (user.nickname && String(user.nickname).trim()) || '同学';
    const m = this.data.mistake;
    const cut = (s, n) => {
      s = String(s || '').trim();
      return s.length > n ? s.slice(0, n) + '…' : s;
    };
    if (m && m.stem) {
      const stem = cut(m.stem, 36);
      const reason = m.reason ? cut(m.reason, 26) : '';
      if (reason) {
        return [
          nick + '你好，我是你的 AI 思维引导导师。这道题：' + stem + '。看到你的错因和' + reason + '有关，先别急，说说你当时是怎么想的？',
          '嗨，' + nick + '！这道题：' + stem + '，你的错因定位在' + reason + '。咱们就从这一步开始捋，你现在卡在哪？',
          nick + '，我看到你在这道题上卡住了。错因是' + reason + '，这很常见。你先说说你的思路，我们一步一步来。'
        ][Math.floor(Math.random() * 3)];
      }
      return [
        nick + '你好，我是你的 AI 思维引导导师。这道题：' + stem + '。先说说你的思路，卡在哪一步？',
        '嗨，' + nick + '！这道题：' + stem + '。别急着要答案，你先说说准备从哪入手？',
        nick + '，我看到你在这道题上卡住了。先说说你现在的想法，咱们一起把它想透。'
      ][Math.floor(Math.random() * 3)];
    }
    return [
      nick + '你好，我是你的 AI 思维引导导师。想聊哪道题，直接说就行，我们一起把它想透。',
      '嗨，' + nick + '！我是你的 AI 辅导老师。今天想攻克哪道题？说出来听听。',
      nick + '你好呀！我是 AI 思维引导导师。有什么想不通的题尽管问我，我不会直接给答案，会一步步带着你想明白。'
    ][Math.floor(Math.random() * 3)];
  },

  // 头部右侧操作：通话中=挂断，否则=清空聊天
  onHeadAction() {
    if (this.data.callOn) this.hangup();
    else this.clearTextHistory();
  },

  // 开始通话（挂断后重新进入）
  startCall() {
    if (this.data.callOn) return;
    this.setData({ headStatusText: '正在连接 AI 导师…' });
    this._ensureVoice().catch(() => {});
  },

  // 按住 MIC 按钮 = 插话：AI 正在说话时按住，立即打断 AI 并收音
  onMicTouchStart() {
    wx.vibrateShort({ type: 'medium', fail: function () {} });
    this.setData({ micPaused: true });
    this._refreshStatus();
    if (this.voice) this.voice.interruptMic();
    // 兜底：touchend/touchcancel 丢失时自动提交并松开（防“麦克风一直开着/卡在说话中”）
    clearTimeout(this._pttTimer);
    this._pttTimer = setTimeout(() => { this.onMicTouchEnd(); }, 60000);
  },

  // 松开按钮：提交语音（PTT 说话结束），等待 AI 回复
  onMicTouchEnd() {
    clearTimeout(this._pttTimer);
    wx.vibrateShort({ type: 'light', fail: function () {} });
    if (this.voice) this.voice.commitMic();
    this.setData({ micPaused: false });
    this._refreshStatus();
  },

  // 结束通话
  onHangup() { this.hangup(); },

  // 挂断/清理
  hangup() {
    this._voiceConnecting = null;
    // 先取计费数据，再销毁实例（stop 后 callId/elapsed 不可用）
    const bill = (this.voice && this.data.callOn)
      ? { call_id: this.voice.callId, seconds: this.voice.elapsedSeconds(), mistake_id: this.data.mistakeId }
      : null;
    if (this.voice) { this.voice.stop(); this.voice = null; }
    if (this._audioCtx) { try { this._audioCtx.close(); } catch (e) {} this._audioCtx = null; }
    // 上报通话结束 → 服务端扣减语音包余额并落明细（幂等：call_id 去重，重复调用不重复扣）
    this._reportVoiceEnd(bill);
    this._saveHistory();
    this.setData({
      callOn: false,
      connected: false,
      callListening: false,
      aiSpeaking: false,
      recognizing: false,
      userSpeaking: false,
      micPaused: false,
      typing: false,
      callStatusText: '未接通',
      headStatusText: '语音：接通后按住说话'
    });
  },

  // 静默上报通话结束（失败不打扰用户，下次 /start 校验余额兜底）
  _reportVoiceEnd(bill) {
    if (!bill || !bill.call_id) return;
    const token = wx.getStorageSync('token') || '';
    wx.request({
      url: BASE_URL + '/voice/end',
      method: 'POST',
      data: { call_id: bill.call_id, seconds: bill.seconds || 0, mistake_id: bill.mistake_id || null },
      header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      fail: function () {}
    });
  },

  /* ---------- 通话后掌握标记 ---------- */
  noop() {},
  selMastery(e) { this.setData({ masterySel: e.currentTarget.dataset.v }); },
  onTagInput(e) { this.setData({ masteryTag: e.detail.value }); },
  closeMastery() { this.setData({ showMastery: false }); },

  confirmMastery() {
    const sel = this.data.masterySel;
    if (!sel) {
      wx.showToast({ title: '请选择掌握程度', icon: 'none' });
      return;
    }
    if (!this.data.mistakeId) {
      wx.showToast({ title: '无关联错题，无法标记掌握度', icon: 'none' });
      return;
    }
    const tag = (this.data.masteryTag || '').trim();
    wx.showLoading({ title: '保存中…' });
    request('/mistakes/' + this.data.mistakeId + '/mastery', {
      method: 'POST',
      data: { mastery: sel, tag: tag }
    }).then((d) => {
      wx.hideLoading();
      this.setData({ showMastery: false, masteryReported: true });
      const statusMap = { mastered: '已掌握', reviewing: '复习中', weak: '未掌握' };
      const kn = (d && d.knowledge) || [];
      let toast = '已标记：' + (statusMap[sel] || sel);
      if (kn.length) toast += ' · ' + kn.map((k) => k.name).join('、');
      wx.showToast({ title: toast.length > 46 ? toast.slice(0, 44) + '…' : toast, icon: 'success' });
      // 更新本地错题状态
      if (this.data.mistake) {
        this.setData({ 'mistake.status': statusMap[sel] || this.data.mistake.status });
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    });
  },

  _resetCall() {
    this.setData({
      callOn: false,
      connected: false,
      callListening: false,
      aiSpeaking: false,
      recognizing: false,
      userSpeaking: false,
      micPaused: false,
      callStatusText: '未接通',
      callSecondsText: '未接通',
      audioChunks: 0
    });
  },

  onToggleCall() {
    if (this.data.callOn) this.hangup();
    else this.startCall();
  },

  startTimer() {
    this.stopTimer();
    const self = this;
    this.timerInt = setInterval(() => {
      const s = self.data.callSeconds + 1;
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      self.setData({ callSeconds: s, callSecondsText: mm + ':' + ss });
    }, 1000);
  },
  stopTimer() { if (this.timerInt) { clearInterval(this.timerInt); this.timerInt = null; } },

  onUnload() { this.hangup(); },
  onHide() { /* 切后台不强制挂断，保持通话 */ }
});
