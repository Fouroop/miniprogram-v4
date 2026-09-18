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

  onLoad() {
    // 从首页统计卡片带入筛选（status/subject），用后即清
    const f = wx.getStorageSync('mistakes_filter');
    if (f && typeof f === 'object') {
      const patch = {};
      if (f.status && STATUSES.indexOf(f.status) >= 0) patch.status = f.status;
      if (f.subject && SUBJECTS.indexOf(f.subject) >= 0) patch.subject = f.subject;
      if (Object.keys(patch).length) this.setData(patch);
      wx.removeStorageSync('mistakes_filter');
    }
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
  },

  /* ---------- 编辑 / 删除 ---------- */
  onItemMenu(e) {
    const id = e.currentTarget.dataset.id;
    const self = this;
    wx.showActionSheet({
      itemList: ['编辑错题', '删除错题'],
      success(r) {
        if (r.tapIndex === 0) self._openEditor(id);
        else if (r.tapIndex === 1) self._remove(id);
      }
    });
  },

  _openEditor(id) {
    const item = this.data.list.find((x) => String(x.id) === String(id));
    if (!item) return;
    const subjects = SUBJECTS.filter((s) => s !== '全部');
    this.setData({
      editorVisible: true,
      editSubjects: subjects,
      editSubjectIndex: Math.max(0, subjects.indexOf(item.subject || '数学')),
      editorForm: {
        id: item.id,
        stem: item.stem || '',
        reason: item.reason || '',
        answer: item.answer || '',
        subject: item.subject || '数学',
        tag: item.tag || ''
      }
    });
  },

  onEditInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ ['editorForm.' + f]: e.detail.value });
  },

  onEditSubject(e) {
    const idx = Number(e.detail.value);
    this.setData({
      editSubjectIndex: idx,
      'editorForm.subject': this.data.editSubjects[idx]
    });
  },

  saveEditor() {
    const self = this;
    const f = this.data.editorForm;
    if (!f || !f.stem || !String(f.stem).trim()) {
      wx.showToast({ title: '题干不能为空', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中…' });
    request('/mistakes/' + f.id, {
      method: 'PUT',
      data: {
        stem: String(f.stem).trim(),
        reason: String(f.reason || '').trim(),
        answer: String(f.answer || '').trim(),
        subject: f.subject || '数学',
        tag: String(f.tag || '').trim()
      }
    }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      self.setData({ editorVisible: false });
      self.load();
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    });
  },

  closeEditor() {
    this.setData({ editorVisible: false });
  },

  _remove(id) {
    const self = this;
    wx.showModal({
      title: '删除错题',
      content: '删除后不可恢复，确定删除这道错题吗？',
      confirmText: '删除',
      confirmColor: '#D64541',
      success(r) {
        if (!r.confirm) return;
        wx.showLoading({ title: '删除中…' });
        request('/mistakes/' + id, { method: 'DELETE' })
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: '已删除', icon: 'success' });
            self.load();
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
      }
    });
  }
});
