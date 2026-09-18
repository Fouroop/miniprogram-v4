// 微信支付管理页：参数配置 + 全链路验证
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtTime(d) {
  if (!d) return '-';
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

async function renderWxpay() {
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-title">微信支付参数（私钥等敏感信息仅保存在服务器数据库，读取时脱敏不回显）</div>
      <div id="wpStatus" class="pay-cfg-tip">加载中…</div>
      <div class="form-grid">
        <div class="form-row"><label>微信支付商户号 mchid</label><input id="wpMchid" placeholder="如 190000xxxx"></div>
        <div class="form-row"><label>小程序 AppID</label><input id="wpAppid" placeholder="wx 开头的 AppID"></div>
        <div class="form-row"><label>小程序 AppSecret（code 换 openid 用）</label><input id="wpSecret" placeholder="含****表示保留原值"></div>
        <div class="form-row"><label>APIv3 密钥（32 位）</label><input id="wpKey" placeholder="含****表示保留原值"></div>
        <div class="form-row"><label>商户证书序列号 serial_no</label><input id="wpSerial" placeholder="证书序列号"></div>
        <div class="form-row"><label>商户 API 私钥（PEM）</label><textarea id="wpPriv" rows="4" placeholder="-----BEGIN PRIVATE KEY-----&#10;……&#10;-----END PRIVATE KEY-----"></textarea></div>
      </div>
      <div id="wpNotify" class="pay-cfg-tip"></div>
      <div class="toolbar">
        <button class="btn btn-primary" onclick="saveWxpayConfig()">保存配置</button>
        <button class="btn" onclick="testWxpayConnect()">测试连接（拉平台证书）</button>
        <button class="btn" onclick="renderWxpay()">刷新</button>
      </div>
      <div id="wpTestResult" class="pay-cfg-tip"></div>
    </div>

    <div class="card">
      <div class="card-title">全链路验证（下单 → 拉起支付 → 回调发货）</div>
      <div class="pay-cfg-tip">
        <b>验证流程：</b><br>
        ① <b>测试连接</b>：用商户号/证书序列号/私钥/APIv3密钥 签名请求微信支付平台，验证参数是否正确；<br>
        ② <b>测试下单</b>：0.01 元真实调微信统一下单，验证 appid/mchid/回调地址/下单签名是否通过（返回 prepay_id 即成功）；<br>
        ③ <b>拉起支付</b>：在微信小程序端（语音包页选套餐）真实支付——管理后台无法拉起微信支付，需真机操作；<br>
        ④ <b>回调发货</b>：支付成功后微信回调 notify_url（<code>https://zblw.com.cn/cuoti/api/voice/wxpay/notify</code>），自动标记订单已支付并发放语音包；下方订单列表实时可见。
      </div>
      <div class="toolbar">
        <input id="wpTestOpenid" style="flex:1;min-width:220px" placeholder="测试用户 openid（小程序 code 换取的 openid）">
        <button class="btn" onclick="testWxpayPrepay()">测试下单（0.01 元）</button>
      </div>
      <div id="wpPrepayResult" class="pay-cfg-tip"></div>
    </div>

    <div class="card">
      <div class="card-title">最近支付订单（回调发货结果）</div>
      <div id="wpOrders">加载中…</div>
    </div>
  `;

  // 读取当前配置（脱敏）
  const r = await api('GET', '/admin/voice/wxpay/config');
  const cfg = (r && r.ok) ? r.data : null;
  if (!cfg) {
    document.getElementById('wpStatus').innerHTML = '<span class="tag orange">未配置</span> 当前为模拟支付（演示），配置后自动切换为真实收款';
  } else {
    document.getElementById('wpStatus').innerHTML =
      '<span class="tag green">已配置</span> 正式收款已启用 · 商户号 ' + esc(cfg.mchid) +
      ' · ' + (cfg.private_key_set ? '私钥已保存' : '私钥未保存');
    document.getElementById('wpMchid').value = cfg.mchid || '';
    document.getElementById('wpAppid').value = cfg.appid || '';
    if (cfg.appsecret_mask) document.getElementById('wpSecret').value = cfg.appsecret_mask;
    if (cfg.apiv3_key_mask) document.getElementById('wpKey').value = cfg.apiv3_key_mask;
    document.getElementById('wpSerial').value = cfg.serial_no || '';
    if (cfg.private_key_set) document.getElementById('wpPriv').value = '****（已保存，重填请粘贴新私钥）';
  }
  document.getElementById('wpNotify').innerHTML = '支付回调地址（微信商户平台「支付回调」需一致）：<code>' +
    esc((cfg && cfg.notify_url) || 'https://zblw.com.cn/cuoti/api/voice/wxpay/notify') + '</code>';

  loadWxpayOrders();
}

async function saveWxpayConfig() {
  const body = {
    mchid: document.getElementById('wpMchid').value.trim(),
    appid: document.getElementById('wpAppid').value.trim(),
    appsecret: document.getElementById('wpSecret').value.trim(),
    apiv3_key: document.getElementById('wpKey').value.trim(),
    serial_no: document.getElementById('wpSerial').value.trim(),
    private_key: document.getElementById('wpPriv').value.trim()
  };
  if (!body.mchid || !body.appid) { toast('商户号和 AppID 必填'); return; }
  const r = await api('PUT', '/admin/voice/wxpay/config', body);
  toast(r.ok ? '支付配置已保存' : (r.error || '保存失败'));
  if (r.ok) renderWxpay();
}

async function testWxpayConnect() {
  const el = document.getElementById('wpTestResult');
  el.innerHTML = '正在测试连接…';
  const r = await api('POST', '/admin/voice/wxpay/test-connect', {});
  el.innerHTML = r.ok
    ? '<span class="tag green">连接成功</span> 平台证书已获取：' + esc(r.data.cert_preview)
    : '<span class="tag orange">连接失败</span> ' + esc(r.error || '未知错误');
}

async function testWxpayPrepay() {
  const openid = document.getElementById('wpTestOpenid').value.trim();
  if (!openid) { toast('请填写测试用户 openid'); return; }
  const el = document.getElementById('wpPrepayResult');
  el.innerHTML = '正在调用微信统一下单…';
  const r = await api('POST', '/admin/voice/wxpay/test-prepay', { openid });
  if (!r.ok) {
    el.innerHTML = '<span class="tag orange">下单失败</span> ' + esc(r.error || '未知错误');
    return;
  }
  el.innerHTML = '<span class="tag green">下单成功</span> prepay_id：<code>' + esc(r.data.prepay_id) +
    '</code><br>商户单号：<code>' + esc(r.data.trade_no) + '</code><br>' +
    '<span style="color:#D64541">（测试单金额 0.01 元，请勿真实支付；真实支付请在小程序端走套餐购买）</span>';
}

async function loadWxpayOrders() {
  const r = await api('GET', '/admin/voice/wxpay/orders?page=1&size=20');
  const list = (r && r.ok && r.data && r.data.list) || [];
  const stMap = { pending: '待支付', paid: '已支付', fail: '失败', test: '测试' };
  document.getElementById('wpOrders').innerHTML = list.length ? `
    <table class="table">
      <tr><th>ID</th><th>套餐</th><th>金额</th><th>状态</th><th>商户单号</th><th>微信交易号</th><th>创建时间</th></tr>
      ${list.map((o) => `
        <tr>
          <td>${o.id}</td>
          <td>${esc(o.plan_name || o.plan || '-')}</td>
          <td>¥${o.amount}</td>
          <td><span class="tag ${o.status === 'paid' ? 'green' : (o.status === 'pending' ? 'orange' : '')}">${stMap[o.status] || o.status}</span></td>
          <td style="font-size:12px">${esc(o.trade_no || '-')}</td>
          <td style="font-size:12px">${esc(o.transaction_id || '-')}</td>
          <td style="font-size:12px">${fmtTime(o.created_at)}</td>
        </tr>`).join('')}
    </table>` : '<div class="empty">暂无订单，配置完成后在小程序端购买即可出现</div>';
}
