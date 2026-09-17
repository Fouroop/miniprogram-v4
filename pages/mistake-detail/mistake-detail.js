// pages/mistake-detail/mistake-detail.js
const { request } = require('../../utils/request.js');
const app = getApp();

Page({
  data: { id: null, detail: null },

  onLoad(opts) {
    this.setData({ id: opts.id });
    this.load();
  },

  load() {
    request('/mistakes/' + this.data.id).then((data) => {
      this.setData({ detail: data });
    }).catch(() => {});
  },

  goChat() {
    // 计费已切换为语音包：通话前在 chat 页校验余额，这里直接进入
    wx.navigateTo({ url: '/pages/chat/chat?mistake_id=' + this.data.id });
  },

  markMastered() {
    request('/mistakes/' + this.data.id, { method: 'PUT', data: { status: '已掌握' } })
      .then(() => {
        wx.showToast({ title: '已标记为掌握', icon: 'success' });
        this.load();
      }).catch(() => {});
  },

  remove() {
    wx.showModal({
      title: '删除这道错题？',
      content: '删除后不可恢复',
      confirmColor: '#D64541',
      success: (r) => {
        if (!r.confirm) return;
        request('/mistakes/' + this.data.id, { method: 'DELETE' }).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 600);
        }).catch(() => {});
      }
    });
  }
});
