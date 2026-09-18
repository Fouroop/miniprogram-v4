// 火山豆包语音用量：实时统计（系统实测口径）+ 套餐成本/利润测算
let volcPlanTbl = null;

async function renderVolc() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="card"><div class="empty">加载中…</div></div>';
  const [u, plans] = await Promise.all([
    api('GET', '/admin/volc/usage'),
    api('GET', '/admin/voice/plans')
  ]);
  if (!u.ok) { c.innerHTML = `<div class="card"><div class="empty">加载失败：${esc(u.error||'')}</div></div>`; return; }
  const d = u.data;
  volcPlanTbl = plans.ok ? (plans.data || []) : [];

  const stat = (t) => `
    <div class="stat-box sb-blue">
      <div class="sb-lbl">${t.label}</div>
      <div class="sb-today">通话 <b>${t.calls}</b> 次 · 时长 <b>${t.minutes}</b> 分钟</div>
      <div class="sb-today">流量 <b>${t.trafficMb}</b> MB（上行 ${t.upMb} / 下行 ${t.downMb}）</div>
      <div class="sb-total" style="font-size:14px">估算费用 <b style="color:#C0392B">¥${t.costYuan.toFixed(2)}</b></div>
      <div class="sb-total">输入 ${t.inputTokens} tok / 输出 ${t.outputTokens} tok</div>
    </div>`;

  const costRows = volcPlanTbl.filter(p => p.quota_mb > 0).map(p => {
    const mbPerMin = 1.61; // 实测平均速率 MB/分钟
    const mins = Math.round(p.quota_mb / mbPerMin);
    const cost = +(mins * 0.30).toFixed(0);       // 按量成本（0.30元/分钟基准）
    const costRes = +(mins * 0.10).toFixed(0);    // 官方资源包口径（0.10元/分钟）
    const profit = +(p.price - cost).toFixed(0);
    const profitRes = +(p.price - costRes).toFixed(0);
    const rate = p.price > 0 ? Math.round((p.price - cost) / p.price * 100) : 0;
    const color = profit >= 0 ? '#1a7f37' : '#C0392B';
    return `
    <tr>
      <td>${esc(p.name)}</td>
      <td>¥${p.price}</td>
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
    <div class="form-tip">口径：voice_calls 实测流量/时长 × 官方单价换算。官方账单/账户余额需火山主账号 AK/SK 对接费用中心（待配置）。</div>
    <div class="traffic-grid">
      ${stat({ label: '今日用量', ...d.today })}
      ${stat({ label: '本月用量', ...d.month })}
    </div>
    <table style="margin-top:8px"><thead><tr><th colspan="2">官方单价（豆包端到端实时语音 Seeduplex，后付费）</th></tr></thead>
      <tbody>
        <tr><td>输入音频</td><td>80 元/百万 token（1 秒 ≈ 6.25 token）</td></tr>
        <tr><td>输出音频</td><td>300 元/百万 token（1 秒 ≈ 25 token）</td></tr>
        <tr><td>输出文本</td><td>80 元/百万 token（1 秒播报 ≈ 5 token）</td></tr>
        <tr><td>综合成本</td><td>≈ 0.30 元/分钟（双向，用户40%/AI60%）；买官方资源包可降至 ≈ 0.10 元/分钟</td></tr>
      </tbody></table>
  </div>
  <div class="card">
    <div class="toolbar"><h3 style="margin:0">现有套餐 · 成本与利润测算</h3></div>
    <div class="form-tip">流量→分钟按实测 1.61 MB/分钟；成本分别按按量 0.30 元/分钟 与 官方资源包 0.10 元/分钟 两档估算。</div>
    <div class="table-wrap"><table>
      <thead><tr><th>套餐</th><th>售价</th><th>可用时长</th><th>按量成本</th><th>资源包成本</th><th>毛利（按量口径）</th></tr></thead>
      <tbody>${costRows || '<tr><td colspan="6" class="empty">暂无套餐</td></tr>'}</tbody>
    </table></div>
  </div>`;
}
