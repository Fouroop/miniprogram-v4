// pages/vip/vip.js —— 语音包开通页（3档：单次/月付/年付，提交申请→管理员后台审核发放）
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
    voiceBal: { minutes: 0, status: 'empty', expireText: '' },
    applies: [],
    adminWechat: 'zblw2026'
  },

  onShow() {
    this.loadPlans();
    this.loadBalance();
    this.loadApplies();
    this.loadAdminContact();
  },

  onPullDownRefresh() {
    Promise.all([this.loadPlans(), this.loadBalance(), this.loadApplies()]).finally(() => wx.stopPullDownRefresh());
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

  loadAdminContact() {
    return request('/voice/admin-contact').then((d) => {
      if (d && d.wechat) this.setData({ adminWechat: d.wechat });
    }).catch(() => {});
  },

  loadApplies() {
    return request('/apply/my').then((rows) => {
      const voice = (rows || []).filter((x) => x.type === 'voice');
      this.setData({ applies: voice.slice(0, 5) });
    }).catch(() => {});
  },

  buy(e) {
    const plan = e.currentTarget.dataset.key;
    const p = this.data.plans.find((x) => x.plan === plan);
    if (!p) return;
    const self = this;
    wx.showModal({
      title: '申请开通「' + (p.name || p.plan) + '」',
      content: '提交后管理员在后台审核，通过后自动发放 ' + (p.minutes || p.quota_mb || '') + ' MB 流量。\n\n加速方式：加管理员微信 ' + this.data.adminWechat + '，备注你的昵称即可。',
      confirmText: '提交申请',
      cancelText: '取消',
      success(r) {
        if (!r.confirm) return;
        wx.showLoading({ title: '提交中…' });
        request('/apply', { method: 'POST', data: { type: 'voice', plan: plan } })
          .then((d) => {
            wx.hideLoading();
            if (d && d.duplicate) {
              wx.showToast({ title: '你已有待审核的申请，请耐心等待', icon: 'none' });
            } else {
              wx.showModal({
                title: '申请已提交',
                content: '管理员审核通过后会自动发放流量。\n\n可添加管理员微信 ' + self.data.adminWechat + ' 加速处理。',
                confirmText: '复制微信号',
                cancelText: '知道了',
                success(r2) {
                  if (r2.confirm) {
                    wx.setClipboardData({ data: self.data.adminWechat });
                  }
                }
              });
            }
            self.loadApplies();
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '提交失败，请稍后重试', icon: 'none' });
          });
      }
    });
  }
});
