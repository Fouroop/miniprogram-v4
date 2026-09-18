// pages/questions/questions.js —— 九年级题库（几何 + 函数）
const { request } = require('../../utils/request');

Page({
  data: {
    tabs: [
      { key: '', name: '全部' },
      { key: '几何', name: '几何' },
      { key: '函数', name: '函数' }
    ],
    cur: '',
    list: [],
    total: 0,
    loading: false,
    page: 1,
    size: 20,
    hasMore: true,
    showDetail: false,
    curQ: null,
    adding: false
  },

  onLoad() { this.load(true); },

  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { this.load(false); },

  switchTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.cur) return;
    this.setData({ cur: key });
    this.load(true);
  },

  load(reset) {
    if (this.data.loading) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    if (!reset && !this.data.hasMore) return Promise.resolve();
    this.setData({ loading: true });
    const q = { page, size: this.data.size };
    if (this.data.cur) q.tag = this.data.cur;
    return request('/questions', { data: q }).then((d) => {
      const list = reset ? (d.list || []) : this.data.list.concat(d.list || []);
      this.setData({
        list,
        total: d.total || 0,
        page: d.page || 1,
        hasMore: (d.list || []).length >= this.data.size,
        loading: false
      });
    }).catch(() => this.setData({ loading: false }));
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    const q = this.data.list.find((x) => x.id === id);
    if (!q) return;
    this.setData({ showDetail: true, curQ: q });
  },

  closeDetail() { this.setData({ showDetail: false }); },
  noop() {},

  // 加入错题本
  addMistake() {
    if (this.data.adding) return;
    const q = this.data.curQ;
    if (!q) return;
    this.setData({ adding: true });
    request('/mistakes', {
      method: 'POST',
      data: {
        stem: q.stem,
        answer: q.answer,
        reason: q.analysis || '',
        subject: q.subject || '数学',
        tag: q.tag || '',
        source: '题库',
        image_url: q.image_url || null
      }
    }).then((d) => {
      wx.showToast({ title: '已加入错题本', icon: 'success' });
      this.setData({ adding: false, showDetail: false });
    }).catch(() => this.setData({ adding: false }));
  },

  // 问这道题：把题干带进 AI 辅导（自由提问）
  askQuestion() {
    const q = this.data.curQ;
    if (!q) return;
    wx.setStorageSync('chat_seed', {
      stem: q.stem,
      answer: q.answer,
      subject: q.subject || '数学',
      tag: q.tag || ''
    });
    wx.navigateTo({ url: '/pages/chat/chat' });
    this.setData({ showDetail: false });
  }
});
