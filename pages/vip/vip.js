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
    const self = this;
    wx.showLoading({ title: '获取中…' });
    request('/voice/admin-contact')
      .then((d) => {
        wx.hideLoading();
        const wxid = (d && d.wechat) || '';
        wx.showModal({
          title: '申请开通语音包',
          content: '该语音包由管理员人工开通：\n\n1. 添加管理员微信：' + (wxid || '（待公布）') + '\n2. 备注“开通语音包 + 昵称”\n3. 管理员确认后为你发放「' + (p.name || p.plan) + '」',
          confirmText: '复制微信号',
          cancelText: '取消',
          success(r) {
            if (r.confirm && wxid) {
              wx.setClipboardData({
                data: wxid,
                success: () => wx.showToast({ title: '微信号已复制，去添加申请吧', icon: 'none' })
              });
            }
          }
        });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '获取管理员联系方式失败', icon: 'none' });
      });
  }
});
