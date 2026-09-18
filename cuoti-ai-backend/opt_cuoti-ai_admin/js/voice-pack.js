// 语音包管理（套餐 + 用户语音包 + 订单 + 流量统计 + 支付配置）
let vpTab = 'plans', vpPage = 1, vpUserPage = 1, vpOrderPage = 1, vpKeyword = '', vpCallPage = 1, vpCallKw = '';

async function renderVp(page = 1) {
  vpPage = page;
  const c = document.getElementById('content');
  c.innerHTML = `<div class="card">
    <div class="toolbar">
      <button class="btn ${vpTab==='plans'?'btn-primary':''}" onclick="switchVpTab('plans')">套餐管理</button>
      <button class="btn ${vpTab==='users'?'btn-primary':''}" onclick="switchVpTab('users')">用户语音包</button>
      <button class="btn ${vpTab==='orders'?'btn-primary':''}" onclick="switchVpTab('orders')">订单记录</button>
      <button class="btn ${vpTab==='traffic'?'btn-primary':''}" onclick="switchVpTab('traffic')">流量统计</button>
      <button class="btn ${vpTab==='pay'?'btn-primary':''}" onclick="switchVpTab('pay')">支付配置</button>
      <span style="flex:1"></span>
      ${vpTab==='plans' ? '<button class="btn btn-primary" onclick="addVpPlan()">+ 新增套餐</button>' : ''}
    </div>
    <div id="vpTable"></div>
  </div>`;
  if (vpTab === 'plans') await loadVpPlans(page);
  else if (vpTab === 'users') await loadVpUsers(vpUserPage);
  else if (vpTab === 'orders') await loadVpOrders(vpOrderPage);
  else if (vpTab === 'traffic') await renderTraffic();
  else await renderPayConfig();
}
function switchVpTab(t) { vpTab = t; renderVp(1); }

/* ---------- 套餐管理（流量模板：quota_mb 流量额度 + 单价 元/MB） ---------- */
async function loadVpPlans(page) {
  const r = await api('GET', `/admin/voice/plans?page=${page}`);
  if (!r.ok) { document.getElementById('vpTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const list = r.data || [];
  window.__vpPlans = list;
  const rows = list.map(p => {
    const unit = p.quota_mb > 0 ? (parseFloat(p.price) / p.quota_mb) : 0;
    return `
    <tr>
      <td>${p.id}</td>
      <td><code>${esc(p.plan)}</code></td>
      <td>${esc(p.name)}</td>
      <td>${p.quota_mb} MB</td>
      <td>¥${p.price}</td>
      <td><b>¥${unit.toFixed(4)}/MB</b></td>
      <td>${p.duration_days} 天</td>
      <td>${esc(p.desc_text || '-')}</td>
      <td>${p.hot ? '<span class="tag orange">推荐</span>' : ''} ${p.is_active ? '<span class="tag green">启用</span>' : '<span class="tag">停用</span>'}</td>
      <td>
        <button class="btn btn-sm" onclick="editVpPlan(${p.id})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="delVpPlan(${p.id})">删除</button>
      </td>
    </tr>`;
  }).join('');
  document.getElementById('vpTable').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>标识</th><th>名称</th><th>流量额度</th><th>价格</th><th>单价</th><th>有效期</th><th>说明</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10" class="empty">暂无套餐</td></tbody>'}
    </table></div>`;
}

function addVpPlan() {
  openModal('新增流量模板（语音包套餐）', `
    <div class="form-row"><label>标识（英文，唯一）</label><input id="vpPlan" placeholder="如 monthly"></div>
    <div class="form-row"><label>名称</label><input id="vpName" placeholder="如 月付语音包"></div>
    <div class="form-row"><label>流量额度（MB）</label><input id="vpQuota" type="number" placeholder="如 600"></div>
    <div class="form-row"><label>价格（元）</label><input id="vpPrice" type="number" step="0.1" placeholder="如 39"></div>
    <div class="form-row"><label>有效期（天）</label><input id="vpDays" type="number" value="30"></div>
    <div class="form-row"><label>说明</label><input id="vpDesc" placeholder="一句话说明"></div>
    <div class="form-row"><label>推荐</label><select id="vpHot"><option value="0">否</option><option value="1">是</option></select></div>
    <div class="form-tip">单价 = 价格 ÷ 流量额度，自动计算（元/MB）</div>
  `, async () => {
    const r = await api('POST', '/admin/voice/plans', {
      plan: document.getElementById('vpPlan').value.trim(),
      name: document.getElementById('vpName').value.trim(),
      quota_mb: parseInt(document.getElementById('vpQuota').value),
      price: parseFloat(document.getElementById('vpPrice').value),
      duration_days: parseInt(document.getElementById('vpDays').value),
      desc_text: document.getElementById('vpDesc').value.trim(),
      hot: parseInt(document.getElementById('vpHot').value)
    });
    if (!r.ok) { toast(r.error); return false; }
    toast('流量模板已新增');
    renderVp(vpPage);
  });
}

function editVpPlan(id) {
  if (!id) { return; }
  const p = (window.__vpPlans || []).find((x) => x.id === id);
  if (!p) { toast('套餐不存在，请刷新'); return; }
  openModal('编辑流量模板（语音包套餐）', `
    <div class="form-row"><label>标识（英文，唯一）</label><input id="vpPlan" value="${esc(p.plan)}"></div>
    <div class="form-row"><label>名称</label><input id="vpName" value="${esc(p.name)}"></div>
    <div class="form-row"><label>流量额度（MB）</label><input id="vpQuota" type="number" value="${p.quota_mb || p.minutes || 0}"></div>
    <div class="form-row"><label>价格（元）</label><input id="vpPrice" type="number" step="0.1" value="${p.price}"></div>
    <div class="form-row"><label>有效期（天）</label><input id="vpDays" type="number" value="${p.duration_days || 30}"></div>
    <div class="form-row"><label>说明</label><input id="vpDesc" value="${esc(p.desc_text || '')}"></div>
    <div class="form-row"><label>推荐</label><select id="vpHot"><option value="0" ${p.hot?'':'selected'}>否</option><option value="1" ${p.hot?'selected':''}>是</option></select></div>
    <div class="form-row"><label>启用</label><select id="vpActive"><option value="1" ${p.is_active?'selected':''}>启用</option><option value="0" ${p.is_active?'':'selected'}>停用</option></select></div>
    <div class="form-tip">单价 = 价格 ÷ 流量额度，自动计算（元/MB）</div>
  `, async () => {
    const r = await api('PUT', `/admin/voice/plans/${id}`, {
      plan: document.getElementById('vpPlan').value.trim(),
      name: document.getElementById('vpName').value.trim(),
      quota_mb: parseInt(document.getElementById('vpQuota').value),
      price: parseFloat(document.getElementById('vpPrice').value),
      duration_days: parseInt(document.getElementById('vpDays').value),
      desc_text: document.getElementById('vpDesc').value.trim(),
      hot: parseInt(document.getElementById('vpHot').value),
      is_active: parseInt(document.getElementById('vpActive').value)
    });
    if (!r.ok) { toast(r.error); return false; }
    toast('已保存');
    renderVp(vpPage);
  });
}

async function delVpPlan(id) {
  if (!confirm('确认删除该套餐？')) return;
  const r = await api('DELETE', `/admin/voice/plans/${id}`);
  toast(r.ok ? '已删除' : r.error);
  if (r.ok) renderVp(vpPage);
}

/* ---------- 用户语音包 ---------- */
async function loadVpUsers(page) {
  vpUserPage = page;
  const r = await api('GET', `/admin/voice/users?page=${page}&size=10&keyword=${encodeURIComponent(vpKeyword)}`);
  if (!r.ok) { document.getElementById('vpTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const { list, total, size } = r.data;
  const rows = list.map(u => {
    const expired = u.voice_expire && new Date(u.voice_expire) < new Date();
    return `
    <tr>
      <td>${u.id}</td>
      <td>${esc(u.username)}</td>
      <td>${esc(u.nickname || '-')}</td>
      <td><b style="color:#8B1E1A">${expired ? 0 : (u.voice_mb || 0)} MB</b></td>
      <td>${u.voice_expire ? new Date(u.voice_expire).toLocaleDateString() + (expired ? ' <span class="tag">已过期</span>' : '') : '-'}</td>
      <td>
        <button class="btn btn-sm" onclick="editVpUser(${u.id}, '${esc(u.username)}', ${u.voice_mb||0}, '${u.voice_expire ? new Date(u.voice_expire).toISOString().slice(0,16) : ''}')">调整</button>
      </td>
    </tr>`;
  }).join('');
  document.getElementById('vpTable').innerHTML = `
    <div class="toolbar" style="margin-bottom:12px">
      <input id="vpUserKw" placeholder="搜索账号/昵称" value="${esc(vpKeyword)}" style="width:200px">
      <button class="btn btn-primary" onclick="vpKeyword=document.getElementById('vpUserKw').value.trim();loadVpUsers(1)">搜索</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>账号</th><th>昵称</th><th>语音包余量</th><th>有效期至</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">暂无用户</td></tbody>'}
    </table></div>
    ${paginHtml(total, page, size, 'gotoVpUsers')}`;
}
function gotoVpUsers(p) { loadVpUsers(p); }

function editVpUser(id, username, mb, expire) {
  openModal(`调整语音包：${username}`, `
    <div class="form-row"><label>语音包余量（MB）</label><input id="vuMin" type="number" step="0.1" value="${mb}"></div>
    <div class="form-row"><label>有效期至</label><input id="vuExpire" type="datetime-local" value="${expire}"></div>
    <div class="form-tip">余量填正数=直接设为该值；负数=扣减（如 -100）；到期时间留空=不限</div>
  `, async () => {
    const minVal = document.getElementById('vuMin').value.trim();
    const r = await api('PUT', `/admin/voice/users/${id}`, {
      voice_mb: minVal.startsWith('-') ? parseFloat(minVal) : (minVal === '' ? null : parseFloat(minVal)),
      voice_expire: document.getElementById('vuExpire').value || null
    });
    if (!r.ok) { toast(r.error); return false; }
    toast('已保存');
    loadVpUsers(vpUserPage);
  });
}

/* ---------- 订单记录 ---------- */
async function loadVpOrders(page) {
  vpOrderPage = page;
  const r = await api('GET', `/admin/voice/orders?page=${page}&size=10`);
  if (!r.ok) { document.getElementById('vpTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const { list, total, size } = r.data;
  const rows = list.map(o => `
    <tr>
      <td>${o.id}</td>
      <td>${esc(o.username || '用户#'+o.user_id)}</td>
      <td>${esc(o.plan_name || o.plan)}</td>
      <td>${o.minutes} MB</td>
      <td>¥${o.amount}</td>
      <td><span class="tag ${o.status==='paid'?'green':'orange'}">${o.status}</span></td>
      <td>${new Date(o.created_at).toLocaleString()}</td>
    </tr>`).join('');
  document.getElementById('vpTable').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>用户</th><th>套餐</th><th>流量额度</th><th>金额</th><th>状态</th><th>时间</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">暂无订单</td></tbody>'}
    </table></div>
    ${paginHtml(total, page, size, 'gotoVpOrders')}`;
}
function gotoVpOrders(p) { loadVpOrders(p); }

/* ---------- 流量统计（消耗/计费/实际流量 + 实时查询） ---------- */
async function renderTraffic() {
  document.getElementById('vpTable').innerHTML = '<div class="empty">加载中…</div>';
  const [s, calls] = await Promise.all([
    api('GET', '/admin/voice/stats'),
    api('GET', `/admin/voice/calls?page=${vpCallPage}&size=10&keyword=${encodeURIComponent(vpCallKw)}`)
  ]);
  const st = (s && s.ok && s.data) ? s.data : { today: {}, total: {} };
  const card = (label, today, total, unit, cls) => `
    <div class="stat-box ${cls}">
      <div class="sb-lbl">${label}</div>
      <div class="sb-today">今日 <b>${today}</b> ${unit}</div>
      <div class="sb-total">累计 <b>${total}</b> ${unit}</div>
    </div>`;
  const html = `
    <div class="traffic-grid">
      ${card('消耗流量（通话时长）', st.today.consume_minutes ?? 0, st.total.consume_minutes ?? 0, '分钟', 'sb-red')}
      ${card('计费流量（扣减MB）', st.today.billed_mb ?? 0, st.total.billed_mb ?? 0, 'MB', 'sb-amber')}
      ${card('实际流量（音频数据）', st.today.actual_mb ?? 0, st.total.actual_mb ?? 0, 'MB', 'sb-blue')}
      ${card('通话次数', st.today.calls ?? 0, st.total.calls ?? 0, '次', 'sb-green')}
    </div>
    <div class="toolbar" style="margin:16px 0 12px">
      <input id="vpCallKw" placeholder="搜索用户账号/昵称" value="${esc(vpCallKw)}" style="width:200px">
      <button class="btn btn-primary" onclick="vpCallKw=document.getElementById('vpCallKw').value.trim();vpCallPage=1;renderTraffic()">查询</button>
      <button class="btn" onclick="renderTraffic()">刷新（实时）</button>
      <span style="flex:1"></span>
    </div>
    <div id="vpCalls"></div>`;
  document.getElementById('vpTable').innerHTML = html;
  if (calls && calls.ok) renderCalls(calls.data);
  else document.getElementById('vpCalls').innerHTML = '<div class="empty">加载失败</div>';
}

function renderCalls(data) {
  const { list, total, page, size } = data;
  const rows = (list || []).map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${esc(r.username || '用户#'+r.user_id)}</td>
      <td>${fmtTime(r.created_at)}</td>
      <td>${r.seconds} 秒</td>
      <td><b style="color:#C98A2D">${r.billed_mb ?? 0} MB</b></td>
      <td>${(r.actual_mb || 0)} MB <span class="tag" style="font-size:12px">↑${r.up_mb||0}/↓${r.down_mb||0}</span></td>
      <td>${r.mistake_id ? '<span class="tag green">带题</span>' : '<span class="tag">自由</span>'}</td>
    </tr>`).join('');
  document.getElementById('vpCalls').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>用户</th><th>时间</th><th>消耗流量</th><th>计费流量</th><th>实际流量</th><th>类型</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">暂无通话记录</td></tbody>'}
    </table></div>
    ${paginHtml(total, page, size, 'gotoVpCalls')}`;
}
function gotoVpCalls(p) { vpCallPage = p; renderTraffic(); }

function fmtTime(d) {
  if (!d) return '-';
  const dt = new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/* ---------- 支付配置（微信支付正式收款） ---------- */
async function renderPayConfig() {
  document.getElementById('vpTable').innerHTML = '<div class="empty">加载中…</div>';
  const r = await api('GET', '/admin/voice/wxpay/config');
  const cfg = (r && r.ok) ? r.data : null;
  const v = (k, def) => (cfg && cfg[k]) ? cfg[k] : def;
  const html = `
    <div class="pay-cfg-tip">
      ${cfg && cfg.configured
        ? '<span class="tag green">已配置微信支付</span> 正式收款已启用，用户购买走微信支付'
        : '<span class="tag orange">未配置</span> 当前为模拟支付（演示），配置后自动切换为真实收款'}
      <div style="margin-top:8px;font-size:13px;color:#6E675A">回调地址：${cfg ? esc(cfg.notify_url) : 'https://zblw.com.cn/cuoti/api/voice/wxpay/notify'}</div>
    </div>
    <div class="form-grid">
      <div class="form-row"><label>微信支付商户号 mchid</label><input id="wpMchid" value="${esc(v('mchid',''))}" placeholder="如 190000xxxx"></div>
      <div class="form-row"><label>小程序 AppID</label><input id="wpAppid" value="${esc(v('appid',''))}" placeholder="wx 开头的 AppID"></div>
      <div class="form-row"><label>小程序 AppSecret</label><input id="wpSecret" value="${esc(v('appsecret_mask',''))}" placeholder="用于 code 换 openid（含****表示保留原值）"></div>
      <div class="form-row"><label>APIv3 密钥</label><input id="wpKey" value="${esc(v('apiv3_key_mask',''))}" placeholder="32 位 APIv3 密钥"></div>
      <div class="form-row"><label>商户证书序列号</label><input id="wpSerial" value="${esc(v('serial_no',''))}" placeholder="证书序列号"></div>
      <div class="form-row"><label>商户 API 私钥（PEM）</label><textarea id="wpPriv" rows="4" placeholder="-----BEGIN PRIVATE KEY-----&#10;……&#10;-----END PRIVATE KEY-----">${cfg && cfg.private_key_set ? '****（已保存，重填请粘贴新私钥）' : ''}</textarea></div>
    </div>
    <div class="toolbar">
      <button class="btn btn-primary" onclick="savePayConfig()">保存支付配置</button>
      <button class="btn" onclick="renderPayConfig()">刷新</button>
    </div>
    <div class="pay-cfg-tip" style="margin-top:16px">
      <b>开通步骤：</b>① 微信支付商户平台开通小程序支付，获取商户号/APIv3密钥/API证书 ② 商户平台设置回调域名 zblw.com.cn ③ 把上方参数填入保存 ④ 小程序端重新购买即走正式支付。
      未配置时购买自动降级为模拟支付，不影响演示。
    </div>`;
  document.getElementById('vpTable').innerHTML = html;
}

async function savePayConfig() {
  const body = {
    mchid: document.getElementById('wpMchid').value.trim(),
    appid: document.getElementById('wpAppid').value.trim(),
    appsecret: document.getElementById('wpSecret').value.trim(),
    apiv3_key: document.getElementById('wpKey').value.trim(),
    serial_no: document.getElementById('wpSerial').value.trim(),
    private_key: document.getElementById('wpPriv').value.trim()
  };
  if (!body.mchid || !body.appid) { toast('商户号和AppID必填'); return; }
  const r = await api('PUT', '/admin/voice/wxpay/config', body);
  toast(r.ok ? '支付配置已保存' : (r.error || '保存失败'));
  if (r.ok) renderPayConfig();
}
