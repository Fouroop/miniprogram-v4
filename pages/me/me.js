// pages/me/me.js
const { request } = require('../../utils/request.js');
const store = require('../../utils/store.js');
const app = getApp();

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

Page({
  data: {
    user: null,
    voiceBal: { minutes: 0, status: 'empty', expireText: '' },
    plans: [],
    // 编辑资料弹层
    showEdit: false,
    editAvatarPath: '',
    editAvatarBase64: '',
    editNickname: '',
    savingProfile: false,
    // 连接 AI 弹层
    showAiConnect: false,
    apiToken: '',
    promptPreview: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    request('/auth/me').then((u) => {
      app.globalData.user = u;
      wx.setStorageSync('user', u);
      this.setData({ user: u });
    }).catch(() => {
      this.setData({ user: app.globalData.user });
    });
    this.refreshVoiceBalance();
    this.loadPlans();
  },

  onPullDownRefresh() {
    Promise.all([this.refreshVoiceBalance(), this.loadPlans()])
      .finally(() => wx.stopPullDownRefresh());
  },

  refreshVoiceBalance() {
    return request('/voice/balance').then((bal) => {
      const b = bal || {};
      const expireText = b.expire ? fmtDate(b.expire) : '';
      this.setData({ voiceBal: { minutes: b.minutes || 0, status: b.status || 'empty', expireText } });
      return bal;
    }).catch(() => {
      this.setData({ voiceBal: { minutes: 0, status: 'empty', expireText: '' } });
    });
  },

  loadPlans() {
    return request('/voice/plans').then((plans) => {
      this.setData({ plans: plans || [] });
    }).catch(() => {});
  },

  /* ---------- 语音包购买 ---------- */
  buy(e) {
    const plan = e.currentTarget.dataset.key;
    const p = this.data.plans.find((x) => x.plan === plan);
    if (!p) return;
    request('/voice/wxpay/status').then((st) => {
      if (st && st.enabled) { this._wxpayBuy(p); }
      else { this._simulateBuy(p); }
    }).catch(() => this._simulateBuy(p));
  },

  _wxpayBuy(p) {
    const self = this;
    wx.showLoading({ title: '正在拉起支付…' });
    wx.login({
      success(r) {
        if (!r.code) { wx.hideLoading(); wx.showToast({ title: '登录凭证获取失败', icon: 'none' }); return; }
        request('/voice/wxpay/prepay', { method: 'POST', data: { plan: p.plan, code: r.code } })
          .then((pay) => {
            wx.hideLoading();
            if (!pay || !pay.paySign) { wx.showToast({ title: '下单失败', icon: 'none' }); return; }
            wx.requestPayment({
              timeStamp: pay.timeStamp,
              nonceStr: pay.nonceStr,
              package: pay.package,
              signType: pay.signType || 'RSA',
              paySign: pay.paySign,
              success() {
                wx.showToast({ title: '支付成功，到账确认中…', icon: 'none', duration: 2000 });
                self._pollBalanceAfterPay();
              },
              fail(err) {
                if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) {
                  wx.showToast({ title: '已取消支付', icon: 'none' });
                } else {
                  wx.showToast({ title: '支付失败：' + ((err && err.errMsg) || '未知错误'), icon: 'none' });
                }
              }
            });
          })
          .catch(() => { wx.hideLoading(); wx.showToast({ title: '下单失败，请稍后重试', icon: 'none' }); });
      },
      fail() { wx.hideLoading(); wx.showToast({ title: '微信登录失败', icon: 'none' }); }
    });
  },

  _pollBalanceAfterPay() {
    let n = 0;
    const timer = setInterval(() => {
      n++;
      this.refreshVoiceBalance().then((b) => {
        if (b && b.minutes > 0 && n > 1) {
          clearInterval(timer);
          wx.showModal({ title: '语音包已到账', content: '当前剩余 ' + b.minutes + ' 分钟，快去打电话问老师吧！', showCancel: false });
        } else if (n >= 6) {
          clearInterval(timer);
          wx.showModal({ title: '支付确认中', content: '支付已成功，语音包稍候到账，可下拉刷新查看。', showCancel: false });
        }
      }).catch(() => {});
    }, 2000);
  },

  _simulateBuy(p) {
    const self = this;
    wx.showModal({
      title: '模拟支付',
      content: `开通「${p.name}」¥${p.price}，含 ${p.minutes} 分钟语音？（演示环境不会真实扣费）`,
      confirmText: '确认支付',
      success: (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '支付中…' });
        request('/voice/order', { method: 'POST', data: { plan: p.plan } })
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: '开通成功', icon: 'success' });
            self.refreshVoiceBalance();
            return request('/auth/me').then((u) => {
              app.globalData.user = u;
              wx.setStorageSync('user', u);
            });
          })
          .catch(() => wx.hideLoading());
      }
    });
  },

  /* ---------- 连接 AI（个人授权码） ---------- */
  _buildPrompt(token) {
    return '你是我的错题AI辅导助手。请用下面的授权码访问我的个人学习数据（读/写我的错题本、题库、资料）：\n\n' +
      '授权码：' + token + '\n' +
      'API 基础地址：https://zblw.com.cn/cuoti/api/my\n' +
      '调用方式：每个请求的请求头加 X-Api-Token: ' + token + '\n\n' +
      '可用接口：\n' +
      '1. 查看我的资料：GET /profile\n' +
      '2. 查看错题本：GET /mistakes?subject=数学&status=全部&page=1&size=20\n' +
      '   （subject: 全部/数学/物理/化学/语文/英语；status: 全部/未掌握/复习中/已掌握；支持 keyword 关键词搜索）\n' +
      '3. 新增错题：POST /mistakes  参数 {stem(必填), answer, reason, subject, tag, source}\n' +
      '4. 修改错题：PUT /mistakes/{id}  参数为要修改的字段\n' +
      '5. 删除错题：DELETE /mistakes/{id}\n' +
      '6. 标记掌握：POST /mistakes/{id}/mastery  参数 {status: "已掌握"|"复习中"|"未掌握"}\n' +
      '7. 查看题库：GET /questions?grade=&tag=&page=1&size=20  （grade: 七年级/八年级/九年级；tag: 几何/函数）\n' +
      '8. 新增题目：POST /questions  参数 {stem(必填), answer, analysis, subject, grade, difficulty, tag}\n' +
      '9. 修改题目：PUT /questions/{id}  参数为要修改的字段\n' +
      '10. 删除题目：DELETE /questions/{id}\n\n' +
      '使用规则：\n' +
      '- 先调用 GET /profile 确认授权码有效，再开始操作；\n' +
      '- 所有返回都是 JSON，ok=true 表示成功，error 为错误说明；\n' +
      '- 辅导错题时：先读我的错题，结合错因用思维引导方式讲解（先问思路、再点拨、最后总结），讲完可以提示我标记"已掌握"。';
  },

  openAiConnect() {
    const self = this;
    this.setData({ showAiConnect: true, apiToken: '', promptPreview: '' });
    request('/user/api-token')
      .then((d) => {
        const token = (d && d.token) || '';
        self.setData({ apiToken: token, promptPreview: token ? self._buildPrompt(token) : '' });
      })
      .catch(() => wx.showToast({ title: '获取授权码失败', icon: 'none' }));
  },

  cancelAiConnect() {
    this.setData({ showAiConnect: false });
  },

  copyAiPrompt() {
    if (!this.data.promptPreview) return;
    wx.setClipboardData({ data: this.data.promptPreview, success: () => wx.showToast({ title: '提示词已复制，去粘贴给豆包吧', icon: 'none' }) });
  },

  regenerateApiToken() {
    const self = this;
    wx.showModal({
      title: '重新生成授权码？',
      content: '生成后旧授权码立即失效，之前复制出去的提示词将无法再访问你的数据。',
      confirmColor: '#D64541',
      success(r) {
        if (!r.confirm) return;
        wx.showLoading({ title: '生成中…' });
        request('/user/api-token/regenerate', { method: 'POST' })
          .then((d) => {
            wx.hideLoading();
            const token = (d && d.token) || '';
            self.setData({ apiToken: token, promptPreview: token ? self._buildPrompt(token) : '' });
            wx.showToast({ title: '已重新生成', icon: 'success' });
          })
          .catch(() => { wx.hideLoading(); wx.showToast({ title: '生成失败', icon: 'none' }); });
      }
    });
  },

  /* ---------- 设置 ---------- */
  clearLocalData() {
    wx.showModal({
      title: '清除本地缓存？',
      content: '将清除所有本地聊天记录和缓存',
      confirmColor: '#D64541',
      success(r) {
        if (!r.confirm) return;
        wx.clearStorageSync();
        wx.showToast({ title: '已清除', icon: 'success' });
      }
    });
  },

  showAbout() {
    wx.showModal({
      title: '关于错题AI辅导',
      content: '版本 1.2.0\n拍照录错题 · AI 思维引导式追问 · 语音通话辅导（按语音包计费）',
      showCancel: false
    });
  },

  /* ---------- 编辑资料 ---------- */
  openEdit() {
    const u = this.data.user || {};
    this.setData({
      showEdit: true,
      editAvatarPath: u.avatar || '',
      editAvatarBase64: '',
      editNickname: u.nickname || ''
    });
  },

  cancelEdit() {
    if (this.data.savingProfile) return;
    this.setData({ showEdit: false });
  },

  noop() {},

  onEditNick(e) { this.setData({ editNickname: e.detail.value }); },

  onEditAvatar(e) {
    const p = e.detail.avatarUrl;
    if (!p) return;
    this.setData({ editAvatarPath: p });
    const self = this;
    wx.compressImage({
      src: p,
      quality: 60,
      success(r) {
        const src = r.tempFilePath || p;
        wx.getFileSystemManager().readFile({
          filePath: src,
          encoding: 'base64',
          success(rr) { self.setData({ editAvatarBase64: rr.data }); }
        });
      },
      fail() {
        wx.getFileSystemManager().readFile({
          filePath: p,
          encoding: 'base64',
          success(rr) { self.setData({ editAvatarBase64: rr.data }); }
        });
      }
    });
  },

  saveProfile() {
    const nick = (this.data.editNickname || '').trim();
    if (!nick) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    this.setData({ savingProfile: true });
    const self = this;
    request('/auth/update-profile', {
      method: 'POST',
      data: {
        nickname: nick,
        avatar_base64: this.data.editAvatarBase64 || ''
      }
    }).then((u) => {
      app.globalData.user = u;
      wx.setStorageSync('user', u);
      this.setData({ user: u, showEdit: false, savingProfile: false });
      wx.showToast({ title: '已保存', icon: 'success' });
    }).catch(() => self.setData({ savingProfile: false }));
  },

  logout() {
    wx.showModal({
      title: '退出登录？',
      content: '将清除本地登录态',
      confirmColor: '#D64541',
      success: (r) => {
        if (!r.confirm) return;
        app.clearAuth();
        wx.reLaunch({ url: '/pages/login/login' });
      }
    });
  }
});
