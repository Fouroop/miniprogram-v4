// pages/mistakes/mistakes.js
const { request } = require('../../utils/request.js');

const SUBJECTS = ['全部', '数学', '物理', '化学', '语文', '英语'];
const STATUSES = ['全部', '未掌握', '复习中', '已掌握'];

Page({
  data: {
    subjects: SUBJECTS,
    statuses: STATUSES,
    subject: '全部',
    status: '全部',
    list: [],
    loading: true
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.load();
  },

  pickSubject(e) {
    this.setData({ subject: e.currentTarget.dataset.v }, () => this.load());
  },
  pickStatus(e) {
    this.setData({ status: e.currentTarget.dataset.v }, () => this.load());
  },

  load() {
    const self = this;
    this.setData({ loading: true });
    const q = [];
    if (this.data.subject !== '全部') q.push('subject=' + this.data.subject);
    if (this.data.status !== '全部') q.push('status=' + this.data.status);
    request('/mistakes?page=1&size=50' + (q.length ? '&' + q.join('&') : ''))
      .then((data) => {
        const list = (data && data.list) || (Array.isArray(data) ? data : (data && data.items) || []);
        self.setData({ list, loading: false });
      })
      .catch(() => self.setData({ loading: false }));
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/mistake-detail/mistake-detail?id=' + id });
  }
});
