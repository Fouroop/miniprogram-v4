// pages/login/login.js
const { request } = require('../../utils/request.js');
const app = getApp();

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    loading2: false
  },

  onUserInput(e) { this.setData({ username: e.detail.value }); },
  onPassInput(e) { this.setData({ password: e.detail.value }); },

  // 已登录则直接进首页
  onShow() {
    if (app.globalData.token && app.globalData.user) {
      wx.reLaunch({ url: '/pages/home/home' });
    }
  },

  _afterAuth(data) {
    app.saveAuth(data.token, data.user || data);
    wx.showToast({ title: '登录成功', icon: 'success' });
    // 新注册用户：提示可完善头像昵称（可跳过）
    if (data.isNew) {
      setTimeout(() => {
        wx.showModal({
          title: '欢迎使用',
          content: '微信登录成功！可在「我的」页设置头像和昵称，方便老师和同学认出你。',
          confirmText: '知道了',
          showCancel: false
        });
      }, 700);
    }
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/home/home' });
    }, 1200);
  },

  // 微信一键登录（点一下直接登录，首次自动注册）
  wxLogin() {
    const self = this;
    this.setData({ loading: true });
    wx.login({
      success(res) {
        if (!res.code) {
          wx.showToast({ title: '获取微信凭证失败', icon: 'none' });
          self.setData({ loading: false });
          return;
        }
        request('/auth/wxlogin', {
          method: 'POST',
          data: { code: res.code }
        }).then((data) => {
          self._afterAuth(data);
        }).catch(() => {})
          .then(() => self.setData({ loading: false }));
      },
      fail() {
        wx.showToast({ title: '微信登录失败，请重试', icon: 'none' });
        self.setData({ loading: false });
      }
    });
  },

  doLogin() {
    const u = this.data.username.trim();
    const p = this.data.password.trim();
    if (!u || !p) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' });
      return;
    }
    this.setData({ loading2: true });
    request('/auth/login', { method: 'POST', data: { username: u, password: p } })
      .then((data) => {
        // 后端返回 { token, user }
        app.saveAuth(data.token, data.user || data);
        wx.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => {
          wx.reLaunch({ url: '/pages/home/home' });
        }, 600);
      })
      .catch(() => {})
      .then(() => this.setData({ loading2: false }));
  }
});
