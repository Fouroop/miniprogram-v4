// 用户管理
let usersPage = 1;
async function renderUsers(page = 1, keyword = '') {
  usersPage = page;
  const c = document.getElementById('content');
  c.innerHTML = `<div class="card">
    <div class="toolbar">
      <input id="uKeyword" placeholder="搜索账号/昵称" value="${esc(keyword)}" style="width:200px">
      <button class="btn btn-primary" onclick="renderUsers(1, document.getElementById('uKeyword').value.trim())">搜索</button>
    </div>
    <div id="uTable"></div>
  </div>`;
  const r = await api('GET', `/admin/users?page=${page}&size=10&keyword=${encodeURIComponent(keyword)}`);
  if (!r.ok) { document.getElementById('uTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const { list, total, size } = r.data;
  let rows = list.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${esc(u.username)}</td>
      <td>${esc(u.nickname)}</td>
      <td>${esc(u.grade)}</td>
      <td>${u.is_vip ? '<span class="tag green">VIP</span>' : '<span class="tag">普通</span>'}</td>
      <td>${u.vip_expire ? new Date(u.vip_expire).toLocaleString() : '-'}</td>
      <td>${u.voice_minutes ? `<b style="color:#8B1E1A">${u.voice_minutes} 分钟</b>` : '0 分钟'}</td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn btn-sm" onclick="editUser(${u.id}, '${esc(u.username)}', '${esc(u.nickname||'')}', '${esc(u.grade||'')}', ${u.is_vip}, '${u.vip_expire ? new Date(u.vip_expire).toISOString().slice(0,16) : ''}')">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="delUser(${u.id})">删除</button>
      </td>
    </tr>`).join('');
  document.getElementById('uTable').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>账号</th><th>昵称</th><th>年级</th><th>VIP</th><th>VIP到期</th><th>语音包</th><th>注册时间</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="empty">暂无数据</td></tbody>'}
    </table></div>
    ${paginHtml(total, page, size, 'gotoUsersPage')}`;
}
function gotoUsersPage(p) { renderUsers(p, document.getElementById('uKeyword').value.trim()); }

function editUser(id, username, nickname, grade, isVip, vipExpire) {
  openModal(`编辑用户：${username}`, `
    <div class="form-row"><label>昵称</label><input id="euNick" value="${esc(nickname)}"></div>
    <div class="form-row"><label>年级</label><input id="euGrade" value="${esc(grade)}"></div>
    <div class="form-row"><label>VIP 状态</label>
      <select id="euVip"><option value="0" ${!isVip?'selected':''}>普通用户</option><option value="1" ${isVip?'selected':''}>VIP</option></select>
    </div>
    <div class="form-row"><label>VIP 到期时间</label><input id="euExpire" type="datetime-local" value="${esc(vipExpire)}"></div>
  `, async () => {
    const r = await api('PUT', `/admin/users/${id}`, {
      nickname: document.getElementById('euNick').value,
      grade: document.getElementById('euGrade').value,
      is_vip: document.getElementById('euVip').value === '1',
      vip_expire: document.getElementById('euExpire').value || null
    });
    toast(r.ok ? '已保存' : r.error);
    if (r.ok) renderUsers(usersPage, document.getElementById('uKeyword').value.trim());
  });
}

async function delUser(id) {
  if (!confirm('确认删除该用户？')) return;
  const r = await api('DELETE', `/admin/users/${id}`);
  toast(r.ok ? '已删除' : r.error);
  if (r.ok) renderUsers(usersPage, document.getElementById('uKeyword').value.trim());
}
