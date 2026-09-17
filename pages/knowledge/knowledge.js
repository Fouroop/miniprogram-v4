// pages/knowledge/knowledge.js —— 知识点掌握地图
const { request } = require('../../utils/request.js');
const app = getApp();

const SUBJECTS = ['数学', '物理', '化学', '英语', '语文'];
const LEVELS = [
  { key: 'none', text: '未学', cls: 'lv-none' },
  { key: 'weak', text: '薄弱', cls: 'lv-weak' },
  { key: 'reviewing', text: '复习中', cls: 'lv-reviewing' },
  { key: 'mastered', text: '已掌握', cls: 'lv-mastered' }
];

Page({
  data: {
    subjects: SUBJECTS,
    subjectIndex: 0,
    subject: SUBJECTS[0],
    chapters: [],
    stat: { total: 0, mastered: 0, reviewing: 0, weak: 0 },
    allStats: [],
    expanded: {},
    masteryPanel: null,   // 正在标记的知识点 { id, name }
    masterySel: '',
    loading: true
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.loadAll();
  },

  loadAll() {
    this.setData({ loading: true });
    Promise.all([this.loadTree(), this.loadSubjects()])
      .finally(() => this.setData({ loading: false }));
  },

  loadTree() {
    return request('/knowledge/tree?subject=' + encodeURIComponent(this.data.subject)).then((data) => {
      data = data || {};
      const chapters = (data.chapters || []).map((ch) => ({
        id: ch.id,
        name: ch.name,
        total: ch.total || 0,
        mastered: ch.mastered || 0,
        reviewing: ch.reviewing || 0,
        weak: ch.weak || 0,
        open: !!this.data.expanded[ch.id],
        kps: (ch.kps || []).map((k) => this._decorateKp(k))
      }));
      const stat = { total: 0, mastered: 0, reviewing: 0, weak: 0 };
      chapters.forEach((ch) => {
        stat.total += ch.total;
        stat.mastered += ch.mastered;
        stat.reviewing += ch.reviewing;
        stat.weak += ch.weak;
      });
      this.setData({ chapters, stat });
    }).catch(() => {});
  },

  loadSubjects() {
    return request('/knowledge/subjects').then((list) => {
      list = list || [];
      const map = {};
      list.forEach((s) => { map[s.subject] = s; });
      this.setData({ allStats: map });
    }).catch(() => {});
  },

  _decorateKp(k) {
    const lv = k.level || 'none';
    const meta = LEVELS.find((l) => l.key === lv) || LEVELS[0];
    return { id: k.id, name: k.name, level: lv, levelText: meta.text, levelCls: meta.cls };
  },

  onSubjectTap(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (i === this.data.subjectIndex) return;
    this.setData({ subjectIndex: i, subject: this.data.subjects[i], expanded: {}, masteryPanel: null, masterySel: '' });
    this.loadTree();
  },

  toggleChapter(e) {
    const id = e.currentTarget.dataset.id;
    const expanded = Object.assign({}, this.data.expanded);
    expanded[id] = !expanded[id];
    this.setData({ expanded });
    this.loadTree();
  },

  // 点击知识点 → 打开掌握标记
  onKpTap(e) {
    const idx = e.currentTarget.dataset.idx;
    const cidx = e.currentTarget.dataset.cidx;
    const kp = this.data.chapters[cidx].kps[idx];
    this.setData({
      masteryPanel: { id: kp.id, name: kp.name, level: kp.level },
      masterySel: kp.level === 'none' ? 'weak' : kp.level
    });
  },

  noop() {},
  closePanel() { this.setData({ masteryPanel: null, masterySel: '' }); },
  selMastery(e) { this.setData({ masterySel: e.currentTarget.dataset.v }); },

  confirmMastery() {
    const panel = this.data.masteryPanel;
    const sel = this.data.masterySel;
    if (!panel || !sel) return;
    wx.showLoading({ title: '保存中…' });
    request('/knowledge/' + panel.id + '/mastery', {
      method: 'POST',
      data: { mastery: sel }
    }).then(() => {
      wx.hideLoading();
      this.setData({ masteryPanel: null, masterySel: '' });
      wx.showToast({ title: '已标记', icon: 'success' });
      this.loadAll();
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  }
});
