// 对话管理
let convPage = 1;
async function renderConversations(page = 1) {
  convPage = page;
  const c = document.getElementById('content');
  c.innerHTML = `<div class="card"><div id="convTable"></div></div>`;
  const r = await api('GET', `/admin/conversations?page=${page}&size=10`);
  if (!r.ok) { document.getElementById('convTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const { list, total, size } = r.data;
  const rows = list.map(x => `
    <tr>
      <td>${x.id}</td>
      <td>${esc(x.username || x.nickname || '用户#'+x.user_id)}</td>
      <td>${esc(x.title)}</td>
      <td><span class="tag ${x.mode==='voice'?'orange':'blue'}">${x.mode}</span></td>
      <td>${x.mistake_id || '-'}</td>
      <td>${new Date(x.updated_at).toLocaleString()}</td>
      <td>
        <button class="btn btn-sm" onclick="viewConv(${x.id})">查看详情</button>
        <button class="btn btn-sm btn-danger" onclick="delConv(${x.id})">删除</button>
      </td>
    </tr>`).join('');
  document.getElementById('convTable').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>用户</th><th>标题</th><th>模式</th><th>关联错题</th><th>更新时间</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">暂无对话</td></tbody>'}
    </table></div>
    ${paginHtml(total, page, size, 'gotoConvPage')}`;
}
function gotoConvPage(p) { renderConversations(p); }

async function viewConv(id) {
  const r = await api('GET', `/admin/conversations/${id}/messages`);
  if (!r.ok) { toast(r.error); return; }
  const msgs = r.data.map(m => `
    <div class="chat-msg ${m.role}">
      <div class="role">${m.role === 'ai' ? 'AI 导师' : m.role === 'user' ? '学生' : '系统'}</div>
      <div class="bubble">${esc(m.content)}</div>
    </div>`).join('');
  openModal(`对话详情 #${id}`, `<div class="chat-view">${msgs || '<div class="empty">无消息</div>'}</div>`);
}

async function delConv(id) {
  if (!confirm('确认删除该对话？')) return;
  const r = await api('DELETE', `/admin/conversations/${id}`);
  toast(r.ok ? '已删除' : r.error);
  if (r.ok) renderConversations(convPage);
}
