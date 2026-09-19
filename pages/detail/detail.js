// pages/detail/detail.js —— 题库 / 错题本通用详情页（长题干滚动显示）
const { request } = require('../../utils/request.js');

Page({
  data: {
    type: 'question',   // question=题库  mistake=错题本
    id: null,
    detail: null,
    error: '',
    adding: false,
    // 编辑弹层（题库）
    qEditorVisible: false,
    qSubjects: ['数学', '物理', '化学', '语文', '英语'],
    qGrades: ['七年级', '八年级', '九年级'],
    qDiffs: ['容易', '中等', '较难'],
    qSubjectIndex: 0,
    qGradeIndex: 0,
    qDiffIndex: 0,
    qForm: {},
    // 编辑弹层（错题）
    mEditorVisible: false,
    editSubjects: ['数学', '物理', '化学', '语文', '英语'],
    editSubjectIndex: 0,
    editorForm: {}
  },

  onLoad(opts) {
    opts = opts || {};
    const type = opts.type === 'mistake' ? 'mistake' : 'question';
    this.setData({ type, id: opts.id || null });
    wx.setNavigationBarTitle({ title: type === 'mistake' ? '错题详情' : '题目详情' });
    this.load();
  },

  load() {
    if (!this.data.id) { this.setData({ error: '缺少题目 ID' }); return; }
    this.setData({ error: '' });
    const url = this.data.type === 'mistake' ? '/mistakes/' + this.data.id : '/questions/' + this.data.id;
    request(url).then((d) => {
      if (!d || (d.ok === false)) { this.setData({ error: (d && d.error) || '加载失败' }); return; }
      this.setData({ detail: d });
    }).catch(() => this.setData({ error: '加载失败，请重试' }));
  },

  /* ---------- 加入错题本（题库） ---------- */
  addMistake() {
    if (this.data.adding) return;
    const q = this.data.detail;
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
      this.setData({ adding: false });
    }).catch(() => {
      wx.showToast({ title: '加入失败', icon: 'none' });
      this.setData({ adding: false });
    });
  },

  /* ---------- 问这道题 / AI 辅导 ---------- */
  askQuestion() {
    const q = this.data.detail;
    if (!q) return;
    wx.setStorageSync('chat_seed', {
      stem: q.stem,
      answer: q.answer,
      subject: q.subject || '数学',
      tag: q.tag || '',
      analysis: q.analysis || ''
    });
    wx.navigateTo({ url: '/pages/chat/chat' });
  },

  askMistake() {
    const m = this.data.detail;
    if (!m) return;
    wx.navigateTo({ url: '/pages/chat/chat?mistake_id=' + m.id });
  },

  /* ---------- 掌握状态切换 ---------- */
  toggleMastery() {
    const m = this.data.detail;
    if (!m) return;
    const next = m.status === '已掌握' ? '未掌握' : '已掌握';
    const mastery = next === '已掌握' ? 'mastered' : 'weak';
    wx.showLoading({ title: '更新中…' });
    request('/mistakes/' + m.id + '/mastery', { method: 'POST', data: { mastery } })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: next === '已掌握' ? '已标记掌握' : '已改回未掌握', icon: 'none' });
        this.setData({ 'detail.status': next });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      });
  },

  /* ---------- 编辑 / 删除 ---------- */
  onMenu() {
    const self = this;
    const isQ = this.data.type === 'question';
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
    const q = this.data.detail;
    if (!q) return;
    this.setData({
      qEditorVisible: true,
      qSubjectIndex: Math.max(0, this.data.qSubjects.indexOf(q.subject || '数学')),
      qGradeIndex: Math.max(0, this.data.qGrades.indexOf(q.grade || '')),
      qDiffIndex: Math.max(0, this.data.qDiffs.indexOf(q.difficulty || '中等')),
      qForm: {
        id: q.id,
        stem: q.stem || '',
        answer: q.answer || '',
        analysis: q.analysis || '',
        subject: q.subject || '数学',
        grade: q.grade || '',
        difficulty: q.difficulty || '中等',
        tag: q.tag || ''
      }
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
      self.setData({ qEditorVisible: false });
      self.load();
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    });
  },

  _removeQ() {
    const self = this;
    const q = this.data.detail;
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
            setTimeout(() => wx.navigateBack(), 600);
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
    const item = this.data.detail;
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
      self.setData({ mEditorVisible: false });
      self.load();
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    });
  },

  _removeM() {
    const self = this;
    const m = this.data.detail;
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
            setTimeout(() => wx.navigateBack(), 600);
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
      }
    });
  }
});
