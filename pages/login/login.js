// pages/login/login.js
const { request } = require('../../utils/request.js');
const app = getApp();

Page({
  data: {
    loading: false,
    agreed: false
  },

  toggleAgree() { this.setData({ agreed: !this.data.agreed }); },

  showAgreement() {
    wx.showModal({
      title: '用户协议',
      content: '欢迎使用错题AI辅导。本应用为中小学生提供错题记录、AI答疑与学习辅导服务。\n\n1. 使用本服务需微信登录，请妥善保管微信账号信息；\n2. 错题与学习数据仅用于为你提供个性化辅导，不会向第三方出售；\n3. AI 辅导内容由人工智能生成，仅供参考，请以教材和老师讲解为准；\n4. 请勿上传违法违规、侵犯他人权益的内容；\n5. 违反本协议可能导致账号被限制使用。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  showPrivacy() {
    wx.showModal({
      title: '隐私政策',
      content: '我们重视你的隐私：\n\n1. 收集的信息：账号信息、错题数据、学习记录、语音辅导内容，仅用于功能服务；\n2. 微信登录会获取你的微信 openid 用于身份识别；头像昵称由你主动提供；\n3. 我们不会向任何第三方出售你的个人信息；\n4. 语音数据用于 AI 辅导识别，不做其他用途；\n5. 你可随时在「我的-清除本地缓存」或在微信中管理授权；\n6. 如对隐私有疑问，可通过应用内客服渠道联系我们。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  _checkAgree() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先勾选同意用户协议和隐私政策', icon: 'none' });
      return false;
    }
    return true;
  },

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
    if (!this._checkAgree()) return;
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
  }
});
