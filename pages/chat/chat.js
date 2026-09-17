// pages/chat/chat.js
const { request, BASE_URL } = require('../../utils/request.js');
const { VoiceCall } = require('../../utils/voice.js');
const store = require('../../utils/store.js');
const app = getApp();

// 与下行 PCM 采样率保持一致，避免重采样
const DOWN_RATE = 24000;

// 苏格拉底人设
const PERSONA =
  '你是「苏格拉底式辅导老师」，正在用打电话的方式辅导一名中学生。\n' +
  '教学原则：绝不直接给出答案或完整解法。每次只提一个启发性的小问题，引导学生自己说出思路、发现错误、推出结论。\n' +
  '对话风格：亲切、耐心、口语化，像真人老师打电话一样自然，每轮回复不超过 3 句话。学生答对关键一步时明确肯定，再引导下一步。';

Page({
  data: {
    isVip: false,
    mode: 'voice',          // text | voice（默认语音提问）
    mistakeId: null,
    mistake: null,

    stemOpen: true,

    // 文字对话
    messages: [],
    inputText: '',
    typing: false,
    conversationId: null,

    // 语音通话（全双工：麦克风始终开启，服务端 VAD 自动检测说话/停顿）
    callOn: false,
    connected: false,       // 会话已接通
    callListening: false,   // 麦克风收音中
    micPaused: false,       // 用户按住暂停收音（静音）
    aiSpeaking: false,      // AI 音频播放中（仅作状态展示，不再用于开关麦克风）
    recognizing: false,     // 识别用户语音中
    userSpeaking: false,    // 服务端 VAD 检测到用户正在说话
    callStatusText: '',
    callSeconds: 0,
    callSecondsText: '未接通',
    audioChunks: 0,
    callLog: [],

    // 通话后掌握标记
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
            else self.setData({ mode: 'text' });
          }
        });
        return;
      }
      // 立即自动连接，连接成功 AI 导师会先说话（用户随时开口即可对话）
      if (self.data.mode !== 'voice') return;
      self._ensureVoice().catch(() => {});
    }).catch(() => {
      // 余额不足或网络异常：静默回文字模式（弹窗由 /voice/start 返回后统一处理）
      self.setData({ mode: 'text' });
    });
  },

  goVip() { wx.switchTab({ url: '/pages/me/me' }); },

  // 首次触摸：解锁 AudioContext（iOS 自动播放限制）并重放 AI 未播出的声音
  onPageTouch() {
    if (this._touched) return;
    this._touched = true;
    this._ensureAudioCtx();
    if (this._audioCtx && this._audioCtx.state === 'suspended' && this._audioCtx.resume) {
      try { this._audioCtx.resume(); } catch (e) {}
    }
    if (this.voice) this.voice.retry();
  },

  /* ---------- 模式切换 ---------- */
  switchMode(e) {
    const m = e.currentTarget.dataset.mode;
    if (m === this.data.mode) return;
    if (m === 'text' && this.data.callOn) this.hangup();
    this.setData({ mode: m });
  },

  toggleStem() { this.setData({ stemOpen: !this.data.stemOpen }); },

  /* ---------- 聊天记录删除 ---------- */
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
    this._saveTextHistory();
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
          messages: [{ role: 'ai', text: '你好，我是你的 AI 苏格拉底导师。我不会直接给答案，会一步步问你，直到你自己想通。开始吧。' }],
          conversationId: null
        });
        self._saveTextHistory();
        store.remove(self._histKey('text'));
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  },

  /* ---------- 聊天记录本地持久化 ---------- */
  _histKey(prefix) {
    return 'chat_' + prefix + '_' + (this.data.mistakeId || 'free');
  },
  _saveTextHistory() {
    store.set(this._histKey('text'), {
      messages: this.data.messages,
      conversationId: this.data.conversationId || null
    });
  },
  _saveVoiceHistory() {
    store.set(this._histKey('voice'), { callLog: this.data.callLog });
  },

  // 长按语音气泡删除该条记录
  onDeleteLogItem(e) {
    const idx = e.currentTarget.dataset.index;
    const log = this.data.callLog;
    if (idx === undefined || idx < 0 || idx >= log.length) return;
    const item = log[idx];
    const label = item.role === 'ai' ? 'AI 导师' : '我';
    wx.showModal({
      title: '删除这条记录？',
      content: (label + '：' + (item.text || '')).slice(0, 40),
      confirmText: '删除',
      confirmColor: '#D64541',
      success: (r) => {
        if (!r.confirm) return;
        const next = this.data.callLog.slice();
        next.splice(idx, 1);
        this.setData({ callLog: next });
        this._saveVoiceHistory();
      }
    });
  },

  // 清空全部语音记录
  onClearCallLog() {
    if (!this.data.callLog.length) return;
    wx.showModal({
      title: '清空全部记录？',
      content: '语音提问记录将全部删除，且不可恢复',
      confirmText: '清空',
      confirmColor: '#D64541',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ callLog: [] });
        this._saveVoiceHistory();
      }
    });
  },
  _restoreHistory() {
    const saved = store.get(this._histKey('text'));
    if (saved && Array.isArray(saved.messages) && saved.messages.length) {
      this.setData({
        messages: saved.messages,
        conversationId: saved.conversationId || null
      });
    } else {
      // 开场白
      this.setData({
        messages: [{
          role: 'ai',
          text: '你好，我是你的 AI 苏格拉底导师。我不会直接给答案，会一步步问你，直到你自己想通。开始吧。'
        }]
      });
    }
    const sv = store.get(this._histKey('voice'));
    if (sv && Array.isArray(sv.callLog) && sv.callLog.length) {
      this.setData({ callLog: sv.callLog });
    }
  },

  /* ---------- 文字对话 ---------- */
  onInput(e) { this.setData({ inputText: e.detail.value }); },

  sendText() {
    const text = this.data.inputText.trim();
    if (!text || this.data.typing) return;
    const msgs = this.data.messages.concat([{ role: 'user', text }]);
    this.setData({ messages: msgs, inputText: '', typing: true });
    this._saveTextHistory();

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
      this._saveTextHistory();
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
    if (!d.callOn || !d.connected) return; // 连接状态由 onStatus 文案控制
    let text;
    if (d.recognizing || d.userSpeaking) text = '正在听你说…';
    else if (d.aiSpeaking) text = 'AI 正在回复…（按住可打断）';
    else text = '按住下方按钮说话';
    this.setData({ callStatusText: text });
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
            self.setData({ connected: true });
            self._refreshStatus();
            if (!resolved) { resolved = true; resolve(); }
          } else {
            self.setData({ connected: false, callStatusText: text });
          }
        },
        onRecognizing(on) { self.setData({ recognizing: on }); self._refreshStatus(); },
        onListening(on) { self.setData({ callListening: on }); },
        onUserText(text) {
          // 定稿用户识别文字：更新最后一条“识别中”条目，或追加新条
          const log = self.data.callLog.slice();
          const last = log[log.length - 1];
          if (last && last.role === 'user' && last.stream) {
            log[log.length - 1] = { role: 'user', text: text };
          } else {
            log.push({ role: 'user', text: text });
          }
          self.setData({ callLog: log });
          self._saveVoiceHistory();
        },
        onUserTextStream(text) {
          // 实时识别文字（边说边显示）
          const log = self.data.callLog.slice();
          const last = log[log.length - 1];
          if (last && last.role === 'user' && last.stream) {
            log[log.length - 1] = { role: 'user', text: text, stream: true };
          } else {
            log.push({ role: 'user', text: text, stream: true });
          }
          self.setData({ callLog: log });
        },
        onAiGreeting(text) {
          self.setData({ callLog: self.data.callLog.concat([{ role: 'ai', text }]) });
          self._saveVoiceHistory();
        },
        onAiTextDelta(text) {
          const log = self.data.callLog.slice();
          const last = log[log.length - 1];
          if (last && last.stream) {
            log[log.length - 1] = { role: 'ai', text: text, stream: true };
          } else {
            log.push({ role: 'ai', text: text, stream: true });
          }
          self.setData({ callLog: log, typing: true });
        },
        onAiTextDone() {
          const log = self.data.callLog.slice();
          if (log.length && log[log.length - 1].stream) {
            log[log.length - 1] = { role: 'ai', text: log[log.length - 1].text };
          }
          self.setData({ callLog: log, typing: false });
          self._saveVoiceHistory();
        },
        onAiSpeaking(on) { self.setData({ aiSpeaking: on }); self._refreshStatus(); },
        onUserSpeaking(on) { self.setData({ userSpeaking: on }); self._refreshStatus(); },
        onError(msg) {
          console.warn('[Chat] voice error:', msg);
          // 只提示用户，不要删掉 voice 对象——VoiceCall 内部会自动重连
          self.setData({ callStatusText: msg });
        }
      });
      const greeting = self.data.mistake
        ? '你好，我看到你在这道题上卡住了。先别急，说说你的思路，我们一步一步来。'
        : '你好，我是你的 AI 辅导老师。想聊哪道题，直接说就行。';
      // 确保题干已就绪再建会话（用户进页面立即按 MIC 时，避免 AI 不知道题目）
      const prep = self.data.mistakeId && !self.data.mistake
        ? request('/mistakes/' + self.data.mistakeId).then((m) => {
            self.setData({ mistake: m });
          }).catch(() => {})
        : Promise.resolve();
      prep.then(() => {
        self.voice.start(self.buildInstructions(), greeting, self._audioCtx);
      });
    });
    this._voiceConnecting = p;
    p.then(() => { self._voiceConnecting = null; }, () => { self._voiceConnecting = null; });
    return p;
  },

  // 开始通话（挂断后重新进入）
  startCall() {
    if (this.data.callOn) return;
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
    this._saveTextHistory();
    this._saveVoiceHistory();
    this.setData({
      callOn: false,
      connected: false,
      callListening: false,
      aiSpeaking: false,
      recognizing: false,
      userSpeaking: false,
      micPaused: false,
      typing: false,
      callStatusText: '未接通'
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
