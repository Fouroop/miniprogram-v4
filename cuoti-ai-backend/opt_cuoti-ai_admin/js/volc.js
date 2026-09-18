// 火山豆包语音用量：系统实测统计 + 官方账单/余额（AK/SK 配置后拉取）
let volcPlanTbl = null;

async function renderVolc() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="card"><div class="empty">加载中…</div></div>';
  const [u, plans, acc] = await Promise.all([
    api('GET', '/admin/volc/usage'),
    api('GET', '/admin/voice/plans'),
    api('GET', '/admin/volc/account')
  ]);
  if (!u.ok) { c.innerHTML = `<div class="card"><div class="empty">加载失败：${esc(u.error||'')}</div></div>`; return; }
  const d = u.data;
  volcPlanTbl = plans.ok ? (plans.data || []) : [];
  const accOk = acc.ok && acc.data && acc.data.configured;

  const stat = (t) => `
    <div class="stat-box sb-blue">
      <div class="sb-lbl">${t.label}</div>
      <div class="sb-today">通话 <b>${t.calls}</b> 次 · 时长 <b>${t.minutes}</b> 分钟</div>
      <div class="sb-today">流量 <b>${t.trafficMb}</b> MB（上行 ${t.upMb} / 下行 ${t.downMb}）</div>
      <div class="sb-total" style="font-size:14px">估算费用 <b style="color:#C0392B">¥${t.costYuan.toFixed(2)}</b></div>
      <div class="sb-total">输入 ${t.inputTokens} tok / 输出 ${t.outputTokens} tok</div>
    </div>`;

  const costRows = volcPlanTbl.filter(p => p.quota_mb > 0).map(p => {
    const mins = Math.round(p.quota_mb / 1.61);
    const cost = +(mins * 0.30).toFixed(0);
    const costRes = +(mins * 0.10).toFixed(0);
    const profit = +(p.price - cost).toFixed(0);
    const rate = p.price > 0 ? Math.round((p.price - cost) / p.price * 100) : 0;
    const color = profit >= 0 ? '#1a7f37' : '#C0392B';
    return `
    <tr>
      <td>${esc(p.name)}</td><td>¥${p.price}</td>
      <td>${p.quota_mb} MB ≈ ${mins} 分钟</td>
      <td style="color:#C0392B">¥${cost}（0.30元/分按量）</td>
      <td style="color:#C0392B">¥${costRes}（0.10元/分资源包）</td>
      <td style="color:${color};font-weight:700">${profit >= 0 ? '+' : ''}¥${profit}（${rate >= 0 ? '+' : ''}${rate}%）</td>
    </tr>`;
  }).join('');

  c.innerHTML = `
  <div class="card">
    <div class="toolbar">
      <h3 style="margin:0">火山豆包语音 · 用量与费用（实时）</h3>
      <span style="flex:1"></span>
      <button class="btn btn-sm" onclick="renderVolc()">刷新</button>
    </div>
    <div class="form-tip">系统实测口径：voice_calls 实测流量/时长 × 官方单价换算。下方"官方账单/余额"需配置火山主账号 AK/SK。</div>
    <div class="traffic-grid">
      ${stat({ label: '今日用量', ...d.today })}
      ${stat({ label: '本月用量', ...d.month })}
    </div>
    <table style="margin-top:8px"><thead><tr><th colspan="2">官方单价（豆包端到端实时语音 Seeduplex，后付费）</th></tr></thead>
      <tbody>
        <tr><td>输入音频</td><td>80 元/百万 token（1 秒 ≈ 6.25 token）</td></tr>
        <tr><td>输出音频</td><td>300 元/百万 token（1 秒 ≈ 25 token）</td></tr>
        <tr><td>输出文本</td><td>80 元/百万 token（1 秒播报 ≈ 5 token）</td></tr>
        <tr><td>综合成本</td><td>≈ 0.30 元/分钟（双向）；官方资源包可降至 ≈ 0.10 元/分钟</td></tr>
      </tbody></table>
  </div>

  <div class="card">
    <div class="toolbar"><h3 style="margin:0">火山主账号（官方账单/余额）</h3></div>
    ${accOk ? `
      <div class="form-tip" style="color:#1a7f37">✓ 已配置：${esc(acc.data.user_name||'-')}（账号 ${esc(acc.data.account_id||'-')}），AK ${esc(acc.data.ak_mask)}</div>
      <div class="toolbar" style="margin-top:8px">
        <button class="btn btn-sm" onclick="loadVolcBilling()">刷新官方账单</button>
        <button class="btn btn-sm" onclick="toggleVolcEdit()">重新配置</button>
      </div>
      <div id="volcBilling" style="margin-top:10px"><div class="empty">点击刷新加载官方账单与余额</div></div>
    ` : `
      <div class="form-tip" style="color:#C98A2D">未配置。请到火山控制台「访问控制 → Access Key 管理」创建 AK/SK，填入后可实时拉取官方账单金额与账户余额。</div>
      ${volcEditHtml()}
    `}
  </div>

  <div class="card">
    <div class="toolbar"><h3 style="margin:0">现有套餐 · 成本与利润测算</h3></div>
    <div class="form-tip">流量→分钟按实测 1.61 MB/分钟；成本按 0.30 元/分钟（按量）与 0.10 元/分钟（资源包）两档估算。</div>
    <div class="table-wrap"><table>
      <thead><tr><th>套餐</th><th>售价</th><th>可用时长</th><th>按量成本</th><th>资源包成本</th><th>毛利（按量口径）</th></tr></thead>
      <tbody>${costRows || '<tr><td colspan="6" class="empty">暂无套餐</td></tr>'}</tbody>
    </table></div>
  </div>`;
  if (accOk) loadVolcBilling();
}

function volcEditHtml() {
  return `
    <div class="form-row" style="margin-top:10px"><label>用户名</label><input id="volcUser" placeholder="如 liaoti"></div>
    <div class="form-row"><label>主账号 ID</label><input id="volcAccountId" placeholder="如 2132072495"></div>
    <div class="form-row"><label>Access Key ID</label><input id="volcAk" placeholder="AKLT..."></div>
    <div class="form-row"><label>Secret Access Key</label><input id="volcSk" type="password" placeholder="填一次，后端加密存储"></div>
    <div class="toolbar" style="margin-top:10px"><button class="btn btn-primary" onclick="saveVolcAccount()">保存并验证</button></div>`;
}
function toggleVolcEdit() {
  const card = document.querySelector('.card:nth-of-type(2) .form-tip');
  // 简易做法：重新渲染页面进入编辑态
  document.getElementById('content').insertAdjacentHTML('afterbegin', '<div style="display:none"></div>');
  // 直接重渲染（保留已配置信息但显示编辑表单）
  const cfg = document.getElementById('content');
  cfg.insertAdjacentHTML('beforeend', `<div class="card" id="volcEditCard">${volcEditHtml()}</div>`);
}

async function saveVolcAccount() {
  const r = await api('PUT', '/admin/volc/account', {
    user_name: document.getElementById('volcUser').value.trim(),
    account_id: document.getElementById('volcAccountId').value.trim(),
    access_key: document.getElementById('volcAk').value.trim(),
    secret_key: document.getElementById('volcSk').value
  });
  if (!r.ok) { toast(r.error); return; }
  toast('已保存，正在验证官方账单…');
  renderVolc();
}

async function loadVolcBilling() {
  const box = document.getElementById('volcBilling');
  if (!box) return;
  box.innerHTML = '<div class="empty">拉取火山费用中心…</div>';
  const r = await api('GET', '/admin/volc/billing');
  if (!r.ok) { box.innerHTML = `<div class="empty" style="color:#C0392B">${esc(r.error||'拉取失败')}</div>`; return; }
  const d = r.data;
  const balRows = (d.balance || []).map(b => `
    <tr><td>${esc(b.acctType || '账户')}</td><td style="color:#1a7f37;font-weight:700">¥${b.availableBalance}</td>
    <td>冻结 ¥${b.frozenBalance}</td><td>${b.currency || 'CNY'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">无余额数据</td></tr>';
  const mRows = (d.months || []).map(m => {
    const prod = (m.byProduct || []).map(p => `${esc(p.product||'-')}: ¥${p.amount}`).join('；');
    return `<tr>
      <td>${m.month}</td>
      <td style="color:#C0392B;font-weight:700">¥${m.totalYuan || 0}</td>
      <td>折前 ¥${m.pretaxYuan||0} / 优惠 -¥${m.discountYuan||0}</td>
      <td style="font-size:12px;color:#666;max-width:260px">${m.error ? `<span style="color:#C0392B">${esc(m.error)}</span>` : (prod || '-')}</td>
    </tr>`;
  }).join('');
  box.innerHTML = `
    <table><thead><tr><th colspan="2">账户余额（官方）</th></tr></thead><tbody>${balRows}</tbody></table>
    <table style="margin-top:10px"><thead><tr><th>月份</th><th>官方账单金额</th><th>折前/优惠</th><th>主要产品</th></tr></thead>
    <tbody>${mRows}</tbody></table>
    <div class="form-tip">账单数据来自火山费用中心（ListSplitBillDetail/QueryBalanceAcct），有 3~4 小时延迟，非实时计费。</div>`;
}
