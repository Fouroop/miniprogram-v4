// 申请管理：新用户注册通知 / 语音包开通 / 会员开通 审核
let applyFilter = { type: '', status: 'pending', keyword: '', page: 1 };
const applyTypeName = { register: '新用户注册', voice: '语音包开通', vip: '会员开通' };
const applyStatusName = { pending: '待审核', approved: '已通过', rejected: '已拒绝' };

async function loadApplyBadge() {
  try {
    const r = await api('GET', '/admin/applies/count');
    const b = document.getElementById('badgeApplies');
    if (b) {
      const n = r.ok ? (r.data.total || 0) : 0;
      b.textContent = n > 0 ? (n > 99 ? '99+' : String(n)) : '';
      b.style.display = n > 0 ? 'inline-block' : 'none';
    }
  } catch (e) { /* 忽略 */ }
}

async function renderApplies() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="card"><div class="empty">加载中…</div></div>';
  const q = new URLSearchParams({ type: applyFilter.type, status: applyFilter.status, keyword: applyFilter.keyword, page: applyFilter.page, size: 10 });
  const r = await api('GET', '/admin/applies?' + q.toString());
  if (!r.ok) { c.innerHTML = `<div class="card"><div class="empty">${esc(r.error)}</div></div>`; return; }
  const d = r.data;

  const tab = (t, label) => `<button class="btn btn-sm ${applyFilter.type === t ? 'btn-primary' : ''}" onclick="setApplyType('${t}')">${label}</button>`;
  const st = (s, label) => `<button class="btn btn-sm ${applyFilter.status === s ? 'btn-primary' : ''}" onclick="setApplyStatus('${s}')">${label}</button>`;

  const rows = (d.list || []).map(a => `
    <tr>
      <td>#${a.id}</td>
      <td><span class="tag tag-${a.type}">${applyTypeName[a.type] || a.type}</span></td>
      <td>
        <div style="font-weight:600">${esc(a.nickname || '—')}</div>
        <div style="font-size:12px;color:#888">${esc(a.username || '')}${a.grade ? ' · ' + esc(a.grade) + '年级' : ''}${a.phone_last4 ? ' · 尾号' + esc(a.phone_last4) : ''}</div>
      </td>
      <td>${esc(a.plan_name || '—')}<br><span style="font-size:12px;color:#888">${esc(a.plan || '')}</span></td>
      <td>¥${Number(a.amount || 0).toFixed(2)}</td>
      <td><span class="tag tag-${a.status}">${applyStatusName[a.status] || a.status}</span></td>
      <td style="font-size:12px;color:#888;max-width:150px">${esc(a.remark || '—')}</td>
      <td style="font-size:12px;color:#888">${(a.created_at || '').slice(0, 19).replace('T', ' ')}</td>
      <td>
        ${a.status === 'pending' ? `
          <button class="btn btn-sm" style="color:#1a7f37" onclick="approveApply(${a.id}, 'approved', ${a.type === 'voice' ? 'true' : 'false'})">通过</button>
          <button class="btn btn-sm" style="color:#C0392B" onclick="approveApply(${a.id}, 'rejected')">拒绝</button>
        ` : `<span style="font-size:12px;color:#888">${esc(a.handled_by || '')} ${(a.handled_at || '').slice(5, 16).replace('T', ' ')}</span>`}
      </td>
    </tr>`).join('') || '<tr><td colspan="9" class="empty">暂无申请</td></tr>';

  c.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <h3 style="margin:0">申请管理</h3>
        <span style="flex:1"></span>
        <input placeholder="搜索昵称/账号" value="${esc(applyFilter.keyword)}" onchange="setApplyKeyword(this.value)" style="width:180px">
        <button class="btn btn-sm" onclick="renderApplies()">刷新</button>
      </div>
      <div style="margin:10px 0 6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${tab('', '全部')}${tab('voice', '语音包')}${tab('vip', '会员')}${tab('register', '注册')}
        <span style="flex:1"></span>
        ${st('', '全部')}${st('pending', '待审核')}${st('approved', '已通过')}${st('rejected', '已拒绝')}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>类型</th><th>申请人</th><th>申请内容</th><th>金额</th><th>状态</th><th>备注</th><th>提交时间</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
        <button class="btn btn-sm" ${d.page <= 1 ? 'disabled' : ''} onclick="setApplyPage(${d.page - 1})">上一页</button>
        <span style="font-size:13px;color:#888">第 ${d.page} 页 · 共 ${d.total} 条</span>
        <button class="btn btn-sm" ${d.page * d.size >= d.total ? 'disabled' : ''} onclick="setApplyPage(${d.page + 1})">下一页</button>
      </div>
    </div>`;
}

function setApplyType(t) { applyFilter.type = t; applyFilter.page = 1; renderApplies(); }
function setApplyStatus(s) { applyFilter.status = s; applyFilter.page = 1; renderApplies(); }
function setApplyKeyword(k) { applyFilter.keyword = k; applyFilter.page = 1; renderApplies(); }
function setApplyPage(p) { applyFilter.page = p; renderApplies(); }

async function approveApply(id, status, isVoice) {
  if (status === 'approved' && isVoice) {
    if (!confirm('通过后将按套餐发放语音流量给该用户，确认继续？')) return;
  }
  const remark = prompt(status === 'approved' ? '通过备注（可选）' : '拒绝原因（会展示给用户，可选）') || '';
  const r = await api('PUT', '/admin/applies/' + id, { status, remark });
  if (!r.ok) { toast(r.error); return; }
  toast(status === 'approved' ? '已通过并发放权益' : '已拒绝');
  loadApplyBadge();
  renderApplies();
}
