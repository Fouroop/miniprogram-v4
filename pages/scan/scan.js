// pages/scan/scan.js —— 拍照识别错题（一张图识别多道题 + 学生手写答案）
const { request } = require('../../utils/request.js');

const SUBJECTS = ['数学', '物理', '化学', '语文', '英语'];
const REASONS = ['概念不清', '计算失误', '审题错误', '公式记忆错误', '粗心漏项', '方法不熟练'];

function pad(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  data: {
    imagePath: '',
    recognizing: false,
    questions: [],        // 识别出的题目列表 [{stem,answer,wrong_answer,subject,tag,reason}]
    subjects: SUBJECTS,
    reasons: REASONS
  },

  chooseImage() {
    const self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success(res) {
        const p = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (p) self.setData({ imagePath: p, questions: [] });
      }
    });
  },

  // 读取本地图片 → base64 → 后端视觉模型识别
  startOcr() {
    if (!this.data.imagePath) return;
    const self = this;
    this.setData({ recognizing: true });
    wx.getFileSystemManager().readFile({
      filePath: this.data.imagePath,
      encoding: 'base64',
      success(r) {
        const b64 = r.data;
        request('/mistakes/ocr-batch', {
          method: 'POST',
          data: { image_base64: b64, mime: 'image/jpeg' }
        }).then((data) => {
          data = data || {};
          const qs = (data.questions || []).map((q) => ({
            stem: q.stem || '',
            answer: q.answer || '',
            wrong_answer: q.wrong_answer || '',
            subject: q.subject || '数学',
            tag: q.tag || '',
            reason: ''
          }));
          self.setData({ recognizing: false, questions: qs });
          if (!qs.length) {
            wx.showToast({ title: '未识别到题目，请换张清晰的图', icon: 'none' });
          } else {
            wx.showToast({ title: '识别到 ' + qs.length + ' 道题，请核对', icon: 'none' });
          }
        }).catch(() => self.setData({ recognizing: false }));
      },
      fail() {
        self.setData({ recognizing: false });
        wx.showToast({ title: '读取图片失败', icon: 'none' });
      }
    });
  },

  reset() {
    this.setData({ imagePath: '', questions: [], recognizing: false });
  },

  onField(e) {
    const i = Number(e.currentTarget.dataset.i);
    const field = e.currentTarget.dataset.field;
    this.setData({ ['questions[' + i + '].' + field]: e.detail.value });
  },

  onSubjectChange(e) {
    const i = Number(e.currentTarget.dataset.i);
    const v = Number(e.detail.value);
    this.setData({ ['questions[' + i + '].subject']: SUBJECTS[v] });
  },

  onReasonChange(e) {
    const i = Number(e.currentTarget.dataset.i);
    const v = Number(e.detail.value);
    this.setData({ ['questions[' + i + '].reason']: REASONS[v] });
  },

  removeQuestion(e) {
    const i = Number(e.currentTarget.dataset.i);
    const qs = this.data.questions.slice();
    qs.splice(i, 1);
    this.setData({ questions: qs });
  },

  addQuestion() {
    this.setData({ questions: this.data.questions.concat([{ stem: '', answer: '', wrong_answer: '', subject: '数学', tag: '', reason: '' }]) });
  },

  save() {
    const qs = this.data.questions;
    const valid = qs.filter((q) => q.stem && q.stem.trim());
    if (!valid.length) {
      wx.showToast({ title: '请至少填写一道题目的内容', icon: 'none' });
      return;
    }
    const items = valid.map((q) => ({
      stem: q.stem.trim(),
      answer: (q.answer || '').trim(),
      wrong_answer: (q.wrong_answer || '').trim(),
      reason: (q.reason || '').trim(),
      subject: q.subject,
      tag: (q.tag || '').trim() || '拍照录入',
      source: '拍照',
      image_url: this.data.imagePath
    }));
    wx.showLoading({ title: '保存中…' });
    request('/mistakes/batch', { method: 'POST', data: { items } }).then((d) => {
      wx.hideLoading();
      wx.showToast({ title: '已保存 ' + (d.count || items.length) + ' 道到错题本', icon: 'success' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/mistakes/mistakes' });
      }, 800);
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    });
  }
});
