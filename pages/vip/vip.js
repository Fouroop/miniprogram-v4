// pages/vip/vip.js —— 语音包开通页（3档：单次/月付/年付）
const { request } = require('../../utils/request.js');
const pay = require('../../utils/pay.js');
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
    // 统一支付入口：个人虚拟支付 → 微信支付商户 → 模拟支付
    pay.buy(p, { onPaid: () => this._pollBalanceAfterPay() });
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
  }
});
