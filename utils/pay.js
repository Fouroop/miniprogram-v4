// utils/pay.js —— 语音包购买统一入口（个人虚拟支付 → 微信支付商户 → 模拟支付）
const { request } = require('./request.js');

function showToast(title) { wx.showToast({ title, icon: 'none' }); }

// 购买：自动选择支付通道
function buy(p, opts) {
  opts = opts || {};
  request('/vpay/status').then((st) => {
    if (st && st.enabled) vpayBuy(p, opts);
    else wxpayOrSimulate(p, opts);
  }).catch(() => wxpayOrSimulate(p, opts));
}

// 个人虚拟支付（wx.requestVirtualPayment，个人主体可开通，无需商户号）
function vpayBuy(p, opts) {
  wx.showLoading({ title: '正在拉起支付…' });
  wx.login({
    success(r) {
      if (!r.code) { wx.hideLoading(); showToast('登录凭证获取失败'); return; }
      request('/vpay/order', { method: 'POST', data: { plan: p.plan, code: r.code } })
        .then((d) => {
          wx.hideLoading();
          if (!d || !d.payData) { showToast((d && d.error) || '下单失败'); return; }
          if (typeof wx.requestVirtualPayment !== 'function') {
            wx.showModal({ title: '版本过低', content: '请将微信更新至最新版后再支付', showCancel: false });
            return;
          }
          wx.requestVirtualPayment({
            ...d.payData,
            success() {
              wx.showToast({ title: '支付成功，到账确认中…', icon: 'none', duration: 2000 });
              if (opts.onPaid) opts.onPaid(d);
            },
            fail(err) {
              if (err && err.errMsg && String(err.errMsg).indexOf('cancel') >= 0) showToast('已取消支付');
              else showToast('支付失败：' + ((err && err.errMsg) || '未知错误'));
            }
          });
        })
        .catch(() => { wx.hideLoading(); showToast('下单失败，请稍后重试'); });
    },
    fail() { wx.hideLoading(); showToast('微信登录失败'); }
  });
}

// 微信支付商户（JSAPI，需商户号）→ 未配置则模拟支付
function wxpayOrSimulate(p, opts) {
  request('/voice/wxpay/status').then((st) => {
    if (st && st.enabled) wxpayBuy(p, opts);
    else simulateBuy(p, opts);
  }).catch(() => simulateBuy(p, opts));
}

function wxpayBuy(p, opts) {
  wx.showLoading({ title: '正在拉起支付…' });
  wx.login({
    success(r) {
      if (!r.code) { wx.hideLoading(); showToast('登录凭证获取失败'); return; }
      request('/voice/wxpay/prepay', { method: 'POST', data: { plan: p.plan, code: r.code } })
        .then((pay) => {
          wx.hideLoading();
          if (!pay || !pay.paySign) { showToast('下单失败'); return; }
          wx.requestPayment({
            timeStamp: pay.timeStamp,
            nonceStr: pay.nonceStr,
            package: pay.package,
            signType: pay.signType || 'RSA',
            paySign: pay.paySign,
            success() {
              wx.showToast({ title: '支付成功，到账确认中…', icon: 'none', duration: 2000 });
              if (opts.onPaid) opts.onPaid(pay);
            },
            fail(err) {
              if (err && err.errMsg && String(err.errMsg).indexOf('cancel') >= 0) showToast('已取消支付');
              else showToast('支付失败：' + ((err && err.errMsg) || '未知错误'));
            }
          });
        })
        .catch(() => { wx.hideLoading(); showToast('下单失败，请稍后重试'); });
    },
    fail() { wx.hideLoading(); showToast('微信登录失败'); }
  });
}

// 模拟支付（演示环境）
function simulateBuy(p, opts) {
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
          if (opts.onPaid) opts.onPaid({ simulate: true });
        })
        .catch(() => wx.hideLoading());
    }
  });
}

module.exports = { buy };
