// 会员管理（订单 + 激活码）
let vipTab = 'orders', vipPage = 1;
async function renderVip(page = 1) {
  vipPage = page;
  const c = document.getElementById('content');
  c.innerHTML = `<div class="card">
    <div class="toolbar">
      <button class="btn ${vipTab==='orders'?'btn-primary':''}" onclick="switchVipTab('orders')">订单列表</button>
      <button class="btn ${vipTab==='codes'?'btn-primary':''}" onclick="switchVipTab('codes')">激活码列表</button>
      <span style="flex:1"></span>
      ${vipTab==='codes' ? '<button class="btn btn-primary" onclick="genCodes()">+ 批量生成激活码</button>' : ''}
    </div>
    <div id="vipTable"></div>
  </div>`;
  if (vipTab === 'orders') await loadOrders(page); else await loadCodes(page);
}
function switchVipTab(t) { vipTab = t; renderVip(1); }

async function loadOrders(page) {
  const r = await api('GET', `/admin/vip/orders?page=${page}&size=10`);
  if (!r.ok) { document.getElementById('vipTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const { list, total, size } = r.data;
  const planName = p => ({single:'单次9.9', monthly:'月度39', yearly:'年度199'}[p] || p);
  const rows = list.map(o => `
    <tr>
      <td>${o.id}</td>
      <td>${esc(o.username || '用户#'+o.user_id)}</td>
      <td>${planName(o.plan)}</td>
      <td>¥${o.amount}</td>
      <td><span class="tag ${o.status==='paid'?'green':o.status==='pending'?'orange':'red'}">${o.status}</span></td>
      <td>${new Date(o.created_at).toLocaleString()}</td>
    </tr>`).join('');
  document.getElementById('vipTable').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>用户</th><th>套餐</th><th>金额</th><th>状态</th><th>时间</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">暂无订单</td></tbody>'}
    </table></div>
    ${paginHtml(total, page, size, 'gotoVipPage')}`;
}

async function loadCodes(page) {
  const r = await api('GET', `/admin/vip/codes?page=${page}&size=10`);
  if (!r.ok) { document.getElementById('vipTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const { list, total, size } = r.data;
  const rows = list.map(c => `
    <tr>
      <td>${c.id}</td>
      <td><code>${esc(c.code)}</code></td>
      <td>${c.type === 'yearly' ? '年度' : '月度'}（${c.duration_days}天）</td>
      <td>${c.used ? `<span class="tag green">已被 ${esc(c.used_by_name || '用户#'+c.used_by)} 使用</span>` : '<span class="tag orange">未使用</span>'}</td>
      <td>${c.used_at ? new Date(c.used_at).toLocaleString() : '-'}</td>
      <td>
        ${c.used ? '' : `<button class="btn btn-sm btn-danger" onclick="delCode(${c.id})">删除</button>`}
      </td>
    </tr>`).join('');
  document.getElementById('vipTable').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>激活码</th><th>类型</th><th>状态</th><th>使用时间</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">暂无激活码</td></tbody>'}
    </table></div>
    ${paginHtml(total, page, size, 'gotoVipPage')}`;
}
function gotoVipPage(p) { renderVip(p); }

function genCodes() {
  openModal('批量生成激活码', `
    <div class="form-row"><label>类型</label>
      <select id="gcType"><option value="monthly">月度（30天）</option><option value="yearly">年度（365天）</option></select>
    </div>
    <div class="form-row"><label>生成数量</label><input id="gcCount" type="number" value="10" min="1" max="500"></div>
  `, async () => {
    const r = await api('POST', '/admin/vip/codes/generate', {
      type: document.getElementById('gcType').value,
      count: parseInt(document.getElementById('gcCount').value)
    });
    if (!r.ok) { toast(r.error); return false; }
    alert(`成功生成 ${r.data.count} 个激活码：\n\n` + r.data.codes.join('\n'));
    renderVip(vipPage);
  });
}

async function delCode(id) {
  if (!confirm('确认删除该激活码？')) return;
  const r = await api('DELETE', `/admin/vip/codes/${id}`);
  toast(r.ok ? '已删除' : r.error);
  if (r.ok) renderVip(vipPage);
}
