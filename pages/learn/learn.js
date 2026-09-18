// pages/learn/learn.js —— 学习页（题库 + 错题本合并，内部筛选）
const { request } = require('../../utils/request.js');

const SUBJECTS = ['全部', '数学', '物理', '化学', '语文', '英语'];
const GRADE_TABS = [
  { key: '', name: '全部年级' },
  { key: '七年级', name: '七年级' },
  { key: '八年级', name: '八年级' },
  { key: '九年级', name: '九年级' }
];
const TOPIC_TABS = [
  { key: '', name: '全部专题' },
  { key: '几何', name: '几何' },
  { key: '函数', name: '函数' }
];
const STATUSES = ['全部', '未掌握', '复习中', '已掌握'];

Page({
  data: {
    // 来源：question=题库  mistake=错题本
    source: 'question',
    sourceTabs: [
      { key: 'question', name: '题库' },
      { key: 'mistake', name: '错题本' }
    ],
    subjects: SUBJECTS,
    subject: '全部',
    gradeTabs: GRADE_TABS,
    curGrade: '',
    topicTabs: TOPIC_TABS,
    curTopic: '',
    statuses: STATUSES,
    curStatus: '全部',
    list: [],
    total: 0,
    loading: false,
    page: 1,
    size: 20,
    hasMore: true,
    // 详情弹层
    showDetail: false,
    cur: null,
    adding: false,
    // 题库编辑弹层
    qEditorVisible: false,
    qSubjects: ['数学', '物理', '化学', '语文', '英语'],
    qGrades: ['七年级', '八年级', '九年级'],
    qDiffs: ['容易', '中等', '较难'],
    qSubjectIndex: 0,
    qGradeIndex: 0,
    qDiffIndex: 0,
    qForm: {},
    // 错题编辑弹层
    mEditorVisible: false,
    editSubjects: ['数学', '物理', '化学', '语文', '英语'],
    editSubjectIndex: 0,
    editorForm: {}
  },

  onLoad(options) {
    options = options || {};
    // 首页错题入口可带 source=mistake 或 mistakes_filter（兼容旧统计卡片）
    if (options.source === 'mistake') this.setData({ source: 'mistake' });
    const f = wx.getStorageSync('mistakes_filter');
    if (f && typeof f === 'object') {
      const patch = { source: 'mistake' };
      if (f.status && STATUSES.indexOf(f.status) >= 0) patch.curStatus = f.status;
      if (f.subject && SUBJECTS.indexOf(f.subject) >= 0) patch.subject = f.subject;
      this.setData(patch);
      wx.removeStorageSync('mistakes_filter');
    }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.load(true);
  },

  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { this.load(false); },

  /* ---------- 筛选 ---------- */
  switchSource(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.source) return;
    this.setData({ source: key, list: [], page: 1, hasMore: true });
    this.load(true);
  },

  pickSubject(e) {
    const v = e.currentTarget.dataset.v;
    if (v === this.data.subject) return;
    this.setData({ subject: v });
    this.load(true);
  },

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

  pickStatus(e) {
    const v = e.currentTarget.dataset.v;
    if (v === this.data.curStatus) return;
    this.setData({ curStatus: v });
    this.load(true);
  },

  load(reset) {
    if (this.data.loading) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    if (!reset && !this.data.hasMore) return Promise.resolve();
    this.setData({ loading: true });
    const p = this.data.source === 'question' ? this._loadQuestions(page) : this._loadMistakes(page);
    return p.then((d) => {
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

  _loadQuestions(page) {
    const q = { page, size: this.data.size };
    if (this.data.subject !== '全部') q.subject = this.data.subject;
    if (this.data.curGrade) q.grade = this.data.curGrade;
    if (this.data.curTopic) q.tag = this.data.curTopic;
    return request('/questions', { data: q }).then((d) => {
      d = d || {};
      return { list: d.list || [], total: d.total || 0, page: d.page || 1 };
    });
  },

  _loadMistakes(page) {
    const q = ['page=' + page, 'size=' + this.data.size];
    if (this.data.subject !== '全部') q.push('subject=' + encodeURIComponent(this.data.subject));
    if (this.data.curStatus !== '全部') q.push('status=' + encodeURIComponent(this.data.curStatus));
    return request('/mistakes?' + q.join('&')).then((data) => {
      const list = (data && data.list) || (Array.isArray(data) ? data : (data && data.items) || []);
      return { list, total: (data && data.total) || list.length, page };
    });
  },

  /* ---------- 详情 ---------- */
  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find((x) => String(x.id) === String(id));
    if (!item) return;
    this.setData({ showDetail: true, cur: item });
  },

  closeDetail() { this.setData({ showDetail: false }); },
  noop() {},

  // 加入错题本（题库）
  addMistake() {
    if (this.data.adding) return;
    const q = this.data.cur;
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
    }).then(() => {
      wx.showToast({ title: '已加入错题本', icon: 'success' });
      this.setData({ adding: false, showDetail: false });
    }).catch(() => this.setData({ adding: false }));
  },

  // 问这道题：把题干带进 AI 辅导
  askQuestion() {
    const q = this.data.cur;
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

  // 问错题：带 mistake_id 进 AI 辅导（保留思维引导上下文）
  askMistake() {
    const m = this.data.cur;
    if (!m) return;
    wx.navigateTo({ url: '/pages/chat/chat?mistake_id=' + m.id });
    this.setData({ showDetail: false });
  },

  // 掌握状态切换：已掌握 ↔ 未掌握
  toggleMastery() {
    const m = this.data.cur;
    if (!m) return;
    const next = m.status === '已掌握' ? '未掌握' : '已掌握';
    const mastery = next === '已掌握' ? 'mastered' : 'weak';
    wx.showLoading({ title: '更新中…' });
    request('/mistakes/' + m.id + '/mastery', { method: 'POST', data: { mastery } })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: next === '已掌握' ? '已标记掌握' : '已改回未掌握', icon: 'none' });
        this.setData({
          cur: { ...this.data.cur, status: next },
          list: this.data.list.map((x) => String(x.id) === String(m.id) ? { ...x, status: next } : x)
        });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      });
  },

  /* ---------- 编辑 / 删除（题库+错题共用菜单） ---------- */
  onItemMenu() {
    const item = this.data.cur;
    if (!item) return;
    const self = this;
    const isQ = this.data.source === 'question';
    wx.showActionSheet({
      itemList: [isQ ? '编辑题目' : '编辑错题', '删除'],
      success(r) {
        if (r.tapIndex === 0) {
          if (isQ) self._openQEditor();
          else self._openMEditor();
        } else if (r.tapIndex === 1) {
          if (isQ) self._removeQ();
          else self._removeM();
        }
      }
    });
  },

  // ---- 题库编辑 ----
  _openQEditor() {
    const q = this.data.cur;
    if (!q) return;
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
      qSubjectIndex: Math.max(0, this.data.qSubjects.indexOf(qForm.subject)),
      qGradeIndex: Math.max(0, this.data.qGrades.indexOf(qForm.grade)),
      qDiffIndex: Math.max(0, this.data.qDiffs.indexOf(qForm.difficulty)),
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
    const q = this.data.cur;
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
  },

  // ---- 错题编辑 ----
  _openMEditor() {
    const item = this.data.cur;
    if (!item) return;
    this.setData({
      mEditorVisible: true,
      editSubjectIndex: Math.max(0, this.data.editSubjects.indexOf(item.subject || '数学')),
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
    this.setData({ editSubjectIndex: idx, 'editorForm.subject': this.data.editSubjects[idx] });
  },

  closeMEditor() { this.setData({ mEditorVisible: false }); },

  saveMEditor() {
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
      self.setData({ mEditorVisible: false, showDetail: false });
      self.load(true);
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    });
  },

  _removeM() {
    const self = this;
    const m = this.data.cur;
    if (!m) return;
    wx.showModal({
      title: '删除错题',
      content: '删除后不可恢复，确定删除这道错题吗？',
      confirmText: '删除',
      confirmColor: '#D64541',
      success(r) {
        if (!r.confirm) return;
        wx.showLoading({ title: '删除中…' });
        request('/mistakes/' + m.id, { method: 'DELETE' })
          .then(() => {
            wx.hideLoading();
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
