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

// 微信风格输入栏图标（SVG data URI，麦克风/键盘线稿）
// 微信风格输入栏图标（base64 PNG，真机兼容；micWhite 供按住说话按钮使用）
const INPUT_ICONS = {
  mic: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAJMSURBVGhD7VivbwIxFEZOTk5OLZOTk0jk/gMm+LGgkEgcEomcREwgJ5HIk2zJEiRymZrcvu/y2rzrClkJ5UrSL/lyx2vv9Xu91/YdjYyMjIw/6Pf7171eb9Ttdl9x/QaXuB/jeitd0kWn03kU0T8+IpCJdE0PFOcT7RL9FvJIOoCwB0foJ4ROaWf6gFunfSiPpgEIKow4iN0gle6kqUS73b5E20r12cJ2Ic31AoLc2W9JUwWDweAKbXp9pPEWsOvMjCjM7DtTBvdL0Mw43w53oglo3wK4Ehf1gWkAUR9KVBCRajfi6vSAgCHEu4szlF/wMeUaEbfxwcEwKA8pn6A30BxcI6RXE1cGyp2Iz+gU0ix4AMoQ8cCU4WDO4Jb/EeF7jkSAm+hBYJCFMzAXq/19QAAvzu8i2vbKvd0ZbC5vxNpCA2B/STdrA+Nsr3A8V4PYmVK2gwKgTdZHacP9uux4bNCxGnwk5qMEgCsXu7VHSSM4tqco0ulezEcJAIJZagT5CQYcmxQqxFTCDEoeGgCB38+0RUshwi3SiF2CdmFff9hO/9GzT5APof2jQwsCvZWogVSkyQWgy4PyQwbCmtJcgosebZXaiffRDq0QQEzLiAohAhiLi/qBGX6CqMrHPARWBGuiLb2Pe+YzZxXUB54WvUWfmW8nSxJafBKLNRQ5gLqRA6gbEG631XMNoKxeua2K6fyAANL+S50nMA8okyqBZN1UbzkBARuPsCCyQhV3pwcE6A/9YCaxPljbYJdphpIltrjIyMjIyKgDjcYvRkRQtV2Bdo4AAAAASUVORK5CYII=",
  kb: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAADrSURBVGhD7ZixDcIwFAUzBiUjUFIyBgPYCcoUbMNIjEBJSQm/sCBKDLnq4eKd9Aqks3Rf6eiMMcYYY8yHlNIp53zr+/7Z4O7Rdi6pdRqOf28cx03JXVJ70NqGYdiW3CVTMb7GMeRDC5t2xW92wE9RDO7CohjchUUxuAuLYnAXFsXgLiyKwV1YFIO7sCgGd2FRDO7CohjchUUxuAuLYnAXFsXgLiyKwV1YFIO7sCgGd2FRDO7CohjchUUxuAuLYnDXVGx1awc85g9a29oBl/mDlpZzvpbU76SUdnFl9f+Zfy669iXRGGOMCbruBUtI1R5QTPRtAAAAAElFTkSuQmCC",
  micWhite: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAJSSURBVGhD7ZivTwMxGIYnJycnpwgSOTk5yZ+ARE5OziGRSCQCMYlEIieBhASJJCjUNp6vfa/cNmDptrseSZ/kS9uvv97vrnfXXiuTyWQ2WC6XPWy8WCzusE/snvIEO1aT5oLIMxNN+iPUXahp8zBx0vkntJuqS3NA16mX50HkO3ZJ1vwT8m+uQlAeqWszQNBM2kzcK8mJqhyUO/gfXANQQG1VpwUh61d/qKoVqOpSF54P8s24Cwi5kqblfD5/JrElc4+5K046U/mi8BmW1xDpQEcb0S9eUjwEcaSh6ofJR9jKwxkL/T8we9g7GrZ6bDImvXMK1sD/hBUfrjE2oDyysvXBwhIqg99eAj1NUR1M0tZkv7FVhNptwLj29qo2CCaZ+uk8lO1ql4kKgP63yjp0cap5vTLwiZtFMNkNSduXArF3wPZNttwCjFvN61WCHeUr5T2B6ADMx3jhmSL/6BoeGhtYcxhjuQ8SAOnAFwOHX0YEUP6K9uU+VAAdXwxsHScaRLslRDqTy+Gm+2anAAzGvTYHaTVLyGD8lU2aYZOW2DkAg3L9hx6vI7BXAEmQEAe3/8edaAFNur5lIH0AiC7vMIuDzEDVDnx9bGXvpHz6MwFChl5SNBMNkR6COMd+PcyvQ9vmHe7R5bYFiCt/8AL43zA7/Gy8yRqJlx1I/7DGIuEFOYDakfCCHEDtrL1W/2UAxe61ut1l1aC/2b/Uubr2Bd7p3xD93knSbicQYb9C9qWr4eqHAMJBfxfon/75QIf9brFDeZQhPpyrM5lMJpOAVusLavJSI6WgKIEAAAAASUVORK5CYII="
};

Page({
  data: {
    icons: INPUT_ICONS,
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
    // 全双工免按：无 PTT 轮次限制，AI 说话/收音状态由状态机驱动
    firstReplyDone: true,
    // 回声诊断面板（开发者调试）
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

    // 从题库"问这道题"进入：与错题辅导一致——带上题干，等待用户点【开始语音聊天】
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
        headStatusText: ''
      });
      return;
    }

    if (opts.mistake_id) {
      this.setData({ mistakeId: opts.mistake_id });
      // 先加载题目，用户点击【开始语音聊天】时系统指令里已带题干（避免 AI 不知道题目）
      request('/mistakes/' + opts.mistake_id).then((m) => {
        this.setData({
          mistake: m,
          topic: (m.subject || '') + (m.tag ? ' · ' + m.tag : '')
        });
      }).catch(() => {});
    }
    // 自由提问：等待用户点【开始语音聊天】
  },

  // 点击【开始语音聊天】：首次用户手势 → 手势内一次性完成音频解锁 + 连接
  // 架构要求：AudioContext 激活、播放队列、录音、WS 连接全部在这一次手势内就绪，
  // 之后 AI 音频自动入队播放，禁止要求用户每次点击播放
  startCall() {
    if (this.data.callOn) return;
    // ① 手势栈内创建并激活 AudioContext（iOS 硬性要求：首次解锁必须发生在用户手势中）
    this._ensureAudioCtx();
    const ac = this._audioCtx;
    if (ac && (ac.state === 'suspended' || ac.state === 'interrupted' || ac.state === 'default') && ac.resume) {
      try { ac.resume(); } catch (e) {}
    }
    console.log('[AUDIO] AudioContext unlocked, state=' + (ac ? ac.state : 'null'));
    // ② 隐私授权（麦克风）：微信隐私接口，未在公众平台声明「麦克风」用途或用户未同意时
    //    recorder.start/stop 会直接失败（fail api scope is not declared in the privacy agreement）
    this._ensurePrivacyAuthorize().then((ok) => {
      if (!ok) {
        this.setData({ headStatusText: '需同意隐私协议后才能使用语音' });
        return;
      }
      // ③ 服务端余额校验 → ④ 建立播放器/录音/WS 连接（复用刚解锁的 AudioContext）
      this.setData({ headStatusText: '正在连接 AI 导师…' });
      this._connectVoice().catch(() => {});
    });
  },

  // 隐私授权：微信隐私接口机制（基础库 2.32.3+）。requirePrivacyAuthorize 弹窗授权成功后才可录音
  _ensurePrivacyAuthorize() {
    return new Promise((resolve) => {
      if (!wx.requirePrivacyAuthorize) { resolve(true); return; } // 老基础库无隐私机制
      wx.requirePrivacyAuthorize({
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    });
  },

  // 接通流程：余额校验 → 连接（连接成功后 AI 开场白文字+语音同步自动播放）
  _connectVoice() {
    const self = this;
    return request('/voice/start', { method: 'POST' }).then((d) => {
      d = d || {};
      if (!d.allow) {
        self.setData({ headStatusText: '' });
        wx.showModal({
          title: '需要开通语音包',
          content: '打电话辅导按流量计费，请先开通语音包（单次/月付/年付三档）。',
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
      if (self.data.inputMode !== 'voice') { self._fallbackTextAsk(); return; }
      return self._ensureVoice();
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

  // 触摸页面：兜底解锁 AudioContext（iOS 自动播放限制），不影响已开始的播放
  // 主解锁时机在【开始语音聊天】按钮点击（用户手势）内完成
  onPageTouch() {
    this._ensureAudioCtx();
    const ac = this._audioCtx;
    const locked = ac && (ac.state === 'suspended' || ac.state === 'interrupted' || ac.state === 'default');
    if (locked && ac.resume) {
      try { ac.resume(); } catch (e) {}
      if (this.voice) this.voice.retry();
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
      headStatusText: next === 'voice' ? '点击下方按钮开始语音聊天' : '支持文字与语音提问'
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
    let ctx = PERSONA + '\n当前辅导的题目：' + (stem || '学生自由提问，先了解他想问什么');
    // 注入最近对话历史：从文字切回语音时延续上下文（AI 记得前面聊过什么）
    const msgs = this.data.messages || [];
    const hist = [];
    for (let i = 0; i < msgs.length && hist.length < 10; i++) {
      const m = msgs[i];
      if (m && m.text && !m.stream) hist.push((m.role === 'user' ? '学生：' : 'AI：') + m.text);
    }
    if (hist.length) ctx += '\n\n【之前的对话】\n' + hist.join('\n');
    return ctx;
  },

  // 是否已有真实对话历史（>1 条即视为聊过；仅剩初始欢迎语视为新会话）
  _hasChatHistory() {
    return (this.data.messages || []).length > 1;
  },

  // 确保 AudioContext 已创建（用户手势中调用）
  _ensureAudioCtx() {
    if (this._audioCtx) return;
    try {
      if (wx.createWebAudioContext) {
        try { this._audioCtx = wx.createWebAudioContext({ sampleRate: DOWN_RATE }); }
        catch (e) { this._audioCtx = wx.createWebAudioContext(); }
        if (this._audioCtx.state === 'suspended' || this._audioCtx.state === 'interrupted' || this._audioCtx.state === 'default') {
          if (this._audioCtx.resume) this._audioCtx.resume();
        }
      }
    } catch (e) {}
  },

  // 根据当前通话状态刷新顶部状态文案
  _refreshStatus() {
    const d = this.data;
    if (!d.callOn || !d.connected) {
      // 未通话：头部显示输入方式提示
      const hint = d.inputMode === 'voice'
        ? (d.callStatusText || '点击下方按钮开始语音聊天')
        : '支持文字与语音提问';
      this.setData({ headStatusText: hint });
      return;
    }
    let text;
    if (d.recognizing || d.userSpeaking) text = '正在听你说…';
    else if (d.aiSpeaking) text = 'AI 正在回复…（可直接打断）';
    else text = '通话中 · 直接说话';
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
        onAiSpeaking(on) {
          self.setData({ aiSpeaking: on });
          self._refreshStatus();
        },
        onUserSpeaking(on) { self.setData({ userSpeaking: on }); self._refreshStatus(); },
        onError(msg) {
          console.warn('[Chat] voice error:', msg);
          // 只提示用户，不要删掉 voice 对象——VoiceCall 内部会自动重连
          self.setData({ callStatusText: msg });
          self._refreshStatus();
        },
        onPrivacyError() {
          // 隐私未声明/未授权：录音无法工作，重连也无意义 → 明确引导并挂断
          console.warn('[Chat] privacy error');
          self.hangup();
          wx.showModal({
            title: '无法使用麦克风',
            content: '请在小程序内同意隐私协议；若仍失败，需在小程序后台「设置-服务内容声明-用户隐私保护指引」中声明「麦克风」用途后重新进入。',
            showCancel: false,
            confirmText: '知道了'
          });
        }
      });
      // 有对话历史（文字切回语音）时不重复打招呼，直接延续上下文
      const greeting = self._hasChatHistory() ? '' : self._buildGreeting();
      // 确保题干已就绪再建会话（用户进页面立即按 MIC 时，避免 AI 不知道题目）
      const prep = self.data.mistakeId && !self.data.mistake
        ? request('/mistakes/' + self.data.mistakeId).then((m) => {
            self.setData({ mistake: m });
          }).catch(() => {})
        : Promise.resolve();
      prep.then(() => {
        // 题干就绪后重新生成开场白（结合刚拿到的题目/错因）
        // 自动连接：AI 文字先显示，语音先缓冲；用户轻触屏幕后从头播放（iOS 手势解锁）
        self.voice.start(self.buildInstructions(), greeting, self._audioCtx);
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
      firstReplyDone: true,
      connected: false,
      callListening: false,
      aiSpeaking: false,
      recognizing: false,
      userSpeaking: false,
      micPaused: false,
      typing: false,
      callStatusText: '未接通',
      headStatusText: '点击下方按钮开始语音聊天'
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

  onUnload() {
    this.hangup();
  },
  onHide() { /* 切后台不强制挂断，保持通话 */ }
});
