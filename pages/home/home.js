// pages/home/home.js
const { request } = require('../../utils/request.js');
const app = getApp();

Page({
  data: {
    user: null,
    stats: { total: 0, pending: 0, mastered: 0, week: 0 },
    recent: [],
    weakList: [],
    voiceBal: { minutes: 0, status: 'empty' }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    const user = app.globalData.user;
    this.setData({ user });
    this.loadStats();
    this.loadRecent();
    this.loadWeak();
    this.loadVoiceBalance();
  },

  onPullDownRefresh() {
    Promise.all([this.loadStats(), this.loadRecent(), this.loadWeak(), this.loadVoiceBalance()])
      .finally(() => wx.stopPullDownRefresh());
  },

  loadStats() {
    return request('/home/stats').then((data) => {
      data = data || {};
      this.setData({
        stats: {
          total: data.total || data.total_mistakes || 0,
          pending: data.pending || data.to_review || 0,
          mastered: data.mastered || data.mastered_count || 0,
          week: data.week_coach || data.week_tutoring || 0
        }
      });
    }).catch(() => {});
  },

  loadRecent() {
    return request('/mistakes?page=1&size=3').then((data) => {
      const list = (data && data.list) || (Array.isArray(data) ? data : (data && data.items) || []);
      this.setData({ recent: list.slice(0, 3) });
    }).catch(() => {});
  },

  // 掌握不牢固的题（未掌握+复习中，最该复习的在前）
  loadWeak() {
    return request('/mistakes?weak=1&size=5').then((data) => {
      const list = (data && data.list) || [];
      this.setData({ weakList: list.slice(0, 5) });
    }).catch(() => {});
  },

  // 语音包余量
  loadVoiceBalance() {
    return request('/voice/balance').then((b) => {
      b = b || {};
      this.setData({
        voiceBal: {
          minutes: b.minutes || 0,
          status: b.status || 'empty'
        }
      });
    }).catch(() => {});
  },

  // 醒目打电话入口（自由提问）
  goCall() {
    if (this.data.voiceBal.status !== 'active') {
      wx.showModal({
        title: '需要开通语音包',
        content: '打电话辅导按分钟计费，请先开通语音包（单次/月付/年付三档）。',
        confirmText: '去开通',
        success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/me/me' }); }
      });
      return;
    }
    wx.navigateTo({ url: '/pages/chat/chat' });
  },

  // 带着错题去通话
  askQuestion(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.voiceBal.status !== 'active') {
      wx.showModal({
        title: '需要开通语音包',
        content: '打电话辅导按分钟计费，请先开通语音包。',
        confirmText: '去开通',
        success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/me/me' }); }
      });
      return;
    }
    wx.navigateTo({ url: '/pages/chat/chat?mistake_id=' + id });
  },

  goScan() { wx.navigateTo({ url: '/pages/scan/scan' }); },
  goMistakes() { wx.switchTab({ url: '/pages/mistakes/mistakes' }); },
  goVip() { wx.switchTab({ url: '/pages/me/me' }); },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/mistake-detail/mistake-detail?id=' + id });
  }
});
