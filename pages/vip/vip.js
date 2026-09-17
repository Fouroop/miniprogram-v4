// pages/vip/vip.js —— 语音包开通页（3档：单次/月付/年付）
const { request } = require('../../utils/request.js');
const app = getApp();

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

Page({
  data: {
    plans: [],
    voiceBal: { minutes: 0, status: 'empty', expireText: '' }
  },

  onShow() {
    // VIP 页已从 tab 移入"我的"，此处不再设置 tab 选中态
    // 拉取套餐 + 当前余量
    this.loadPlans();
    this.loadBalance();
  },

  onPullDownRefresh() {
    Promise.all([this.loadPlans(), this.loadBalance()]).finally(() => wx.stopPullDownRefresh());
  },

  loadPlans() {
    return request('/voice/plans').then((plans) => {
      this.setData({ plans: plans || [] });
    }).catch(() => {});
  },

  loadBalance() {
    return request('/voice/balance').then((b) => {
      b = b || {};
      this.setData({ voiceBal: { minutes: b.minutes || 0, status: b.status || 'empty', expireText: b.expire ? fmtDate(b.expire) : '' } });
    }).catch(() => {});
  },

  buy(e) {
    const plan = e.currentTarget.dataset.key;
    const p = this.data.plans.find((x) => x.plan === plan);
    if (!p) return;

    // 先看是否已配置微信支付正式收款
    request('/voice/wxpay/status').then((st) => {
      if (st && st.enabled) {
        this._wxpayBuy(p);
      } else {
        this._simulateBuy(p);
      }
    }).catch(() => this._simulateBuy(p));
  },

  // 微信支付正式收款（已配置时）
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

  // 支付成功后轮询余额（回调异步发货）
  _pollBalanceAfterPay() {
    let n = 0;
    const timer = setInterval(() => {
      n++;
      this.loadBalance().then((b) => {
        if (b && b.minutes > 0 && n > 1) {
          clearInterval(timer);
          wx.showModal({
            title: '语音包已到账',
            content: '当前剩余 ' + b.minutes + ' 分钟，快去打电话问老师吧！',
            showCancel: false
          });
        } else if (n >= 6) {
          clearInterval(timer);
          wx.showModal({
            title: '支付确认中',
            content: '支付已成功，语音包稍候到账，可下拉刷新查看。',
            showCancel: false
          });
        }
      }).catch(() => {});
    }, 2000);
  },

  // 模拟支付（演示环境，未配置微信支付时）
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
            this.loadBalance();
            // 同步用户信息
            return request('/auth/me').then((u) => {
              app.globalData.user = u;
              wx.setStorageSync('user', u);
            });
          })
          .catch(() => wx.hideLoading());
      }
    });
  }
});
