// app.js
App({
  globalData: {
    baseUrl: 'https://zblw.com.cn/cuoti/api',
    token: '',
    user: null
  },

  onLaunch() {
    // 恢复本地登录态
    const token = wx.getStorageSync('token') || '';
    const user = wx.getStorageSync('user') || null;
    this.globalData.token = token;
    this.globalData.user = user;
  },

  // 统一保存登录态
  saveAuth(token, user) {
    this.globalData.token = token;
    this.globalData.user = user;
    wx.setStorageSync('token', token);
    wx.setStorageSync('user', user);
  },

  // 退出登录：清除所有本地数据
  clearAuth() {
    this.globalData.token = '';
    this.globalData.user = null;
    wx.clearStorageSync();
  },

  isVip() {
    const u = this.globalData.user;
    return !!(u && u.is_vip);
  }
});
