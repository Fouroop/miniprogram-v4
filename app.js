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
  },

  isLogin() {
    return !!this.globalData.token && !!this.globalData.user;
  },

  /**
   * 按需登录（微信规范：未登录可浏览，点需要登录的功能时才弹登录，带"取消"返回）
   * @param {string} tip 如"登录后使用 AI 辅导"
   * @returns {Promise<boolean>} 已登录/用户确认去登录返回 true（此时已跳登录页）；用户取消返回 false
   */
  ensureLogin(tip) {
    if (this.isLogin()) return Promise.resolve(true);
    return new Promise((resolve) => {
      wx.showModal({
        title: '提示',
        content: tip || '登录后即可使用此功能',
        confirmText: '去登录',
        cancelText: '取消',
        success(r) {
          if (r.confirm) {
            wx.navigateTo({ url: '/pages/login/login' });
            resolve(true);
          } else {
            resolve(false);
          }
        }
      });
    });
  }
});
