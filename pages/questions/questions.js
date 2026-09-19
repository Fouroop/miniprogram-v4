// pages/questions/questions.js —— 题库（全年级 · 几何/函数专题）
const { request } = require('../../utils/request.js');
const app = getApp();

Page({
  data: {
    gradeTabs: [
      { key: '', name: '全部年级' },
      { key: '七年级', name: '七年级' },
      { key: '八年级', name: '八年级' },
      { key: '九年级', name: '九年级' }
    ],
    topicTabs: [
      { key: '', name: '全部专题' },
      { key: '几何', name: '几何' },
      { key: '函数', name: '函数' }
    ],
    curGrade: '',
    curTopic: '',
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

  switchGrade(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.curGrade) return;
    this.setData({ curGrade: key });
    this.load(true);
  },

  switchTopic(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.curTopic) return;
    this.setData({ curTopic: key });
    this.load(true);
  },

  load(reset) {
    if (this.data.loading) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    if (!reset && !this.data.hasMore) return Promise.resolve();
    this.setData({ loading: true });
    const q = { page, size: this.data.size };
    if (this.data.curGrade) q.grade = this.data.curGrade;
    if (this.data.curTopic) q.tag = this.data.curTopic;
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
    wx.navigateTo({ url: '/pages/detail/detail?type=question&id=' + id });
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
      tag: q.tag || '',
      analysis: q.analysis || ''
    });
    wx.navigateTo({ url: '/pages/chat/chat' });
    this.setData({ showDetail: false });
  },

  /* ---------- 编辑 / 删除题目 ---------- */
  onQMenu() {
    const self = this;
    wx.showActionSheet({
      itemList: ['编辑题目', '删除题目'],
      success(r) {
        if (r.tapIndex === 0) self._openQEditor();
        else if (r.tapIndex === 1) self._removeQ();
      }
    });
  },

  _openQEditor() {
    const q = this.data.curQ;
    if (!q) return;
    const qSubjects = ['数学', '物理', '化学', '语文', '英语'];
    const qGrades = ['七年级', '八年级', '九年级'];
    const qDiffs = ['容易', '中等', '较难'];
    const qForm = {
      id: q.id,
      stem: q.stem || '',
      answer: q.answer || '',
      analysis: q.analysis || '',
      subject: q.subject || '数学',
      grade: q.grade || '',
      difficulty: q.difficulty || '中等',
      tag: q.tag || ''
    };
    this.setData({
      qEditorVisible: true,
      qSubjects, qGrades, qDiffs,
      qSubjectIndex: Math.max(0, qSubjects.indexOf(qForm.subject)),
      qGradeIndex: Math.max(0, qGrades.indexOf(qForm.grade)),
      qDiffIndex: Math.max(0, qDiffs.indexOf(qForm.difficulty)),
      qForm
    });
  },

  onQInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ ['qForm.' + f]: e.detail.value });
  },

  onQSubject(e) { this.setData({ qSubjectIndex: Number(e.detail.value), 'qForm.subject': this.data.qSubjects[Number(e.detail.value)] }); },
  onQGrade(e) { this.setData({ qGradeIndex: Number(e.detail.value), 'qForm.grade': this.data.qGrades[Number(e.detail.value)] }); },
  onQDiff(e) { this.setData({ qDiffIndex: Number(e.detail.value), 'qForm.difficulty': this.data.qDiffs[Number(e.detail.value)] }); },

  closeQEditor() { this.setData({ qEditorVisible: false }); },

  saveQEditor() {
    const self = this;
    const f = this.data.qForm;
    if (!f || !f.stem || !String(f.stem).trim()) {
      wx.showToast({ title: '题干不能为空', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中…' });
    request('/questions/' + f.id, {
      method: 'PUT',
      data: {
        stem: String(f.stem).trim(),
        answer: String(f.answer || '').trim(),
        analysis: String(f.analysis || '').trim(),
        subject: f.subject || '数学',
        grade: f.grade || '',
        difficulty: f.difficulty || '中等',
        tag: String(f.tag || '').trim()
      }
    }).then((d) => {
      wx.hideLoading();
      if (d && d.ok === false) {
        wx.showToast({ title: d.error || '保存失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      self.setData({ qEditorVisible: false, showDetail: false });
      self.load(true);
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    });
  },

  _removeQ() {
    const self = this;
    const q = this.data.curQ;
    if (!q) return;
    wx.showModal({
      title: '删除题目',
      content: '删除后不可恢复，确定删除这道题吗？',
      confirmText: '删除',
      confirmColor: '#D64541',
      success(r) {
        if (!r.confirm) return;
        wx.showLoading({ title: '删除中…' });
        request('/questions/' + q.id, { method: 'DELETE' })
          .then((d) => {
            wx.hideLoading();
            if (d && d.ok === false) {
              wx.showToast({ title: d.error || '删除失败', icon: 'none' });
              return;
            }
            wx.showToast({ title: '已删除', icon: 'success' });
            self.setData({ showDetail: false });
            self.load(true);
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
      }
    });
  }
});
