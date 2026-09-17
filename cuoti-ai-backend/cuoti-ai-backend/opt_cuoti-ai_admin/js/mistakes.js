// 错题管理
let mPage = 1;
async function renderMistakes(page = 1, subject = '') {
  mPage = page;
  const c = document.getElementById('content');
  c.innerHTML = `<div class="card">
    <div class="toolbar">
      <select id="mSubject">
        <option value="">全部科目</option>
        ${['数学','物理','化学','语文','英语'].map(s => `<option ${s===subject?'selected':''}>${s}</option>`).join('')}
      </select>
      <button class="btn btn-primary" onclick="renderMistakes(1, document.getElementById('mSubject').value)">筛选</button>
    </div>
    <div id="mTable"></div>
  </div>`;
  const r = await api('GET', `/admin/mistakes?page=${page}&size=10&subject=${encodeURIComponent(subject)}`);
  if (!r.ok) { document.getElementById('mTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const { list, total, size } = r.data;
  const statusTag = s => s==='已掌握' ? 'green' : s==='复习中' ? 'orange' : 'red';
  const rows = list.map(m => `
    <tr>
      <td>${m.id}</td>
      <td>${esc(m.username || '用户#'+m.user_id)}</td>
      <td style="max-width:260px">${esc((m.stem||'').slice(0,50))}${(m.stem||'').length>50?'...':''}</td>
      <td><span class="tag blue">${esc(m.subject)}</span></td>
      <td>${esc(m.tag)}</td>
      <td><span class="tag ${statusTag(m.status)}">${esc(m.status)}</span></td>
      <td>${m.review_count}</td>
      <td>${new Date(m.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn btn-sm" onclick="viewMistake(${m.id})">详情</button>
        <button class="btn btn-sm" onclick='editMistake(${m.id}, ${JSON.stringify(m.stem||'').replace(/'/g,"&#39;")}, ${JSON.stringify(m.answer||'').replace(/'/g,"&#39;")}, ${JSON.stringify(m.wrong_answer||'').replace(/'/g,"&#39;")}, ${JSON.stringify(m.reason||'').replace(/'/g,"&#39;")}, ${JSON.stringify(m.subject||'').replace(/'/g,"&#39;")}, ${JSON.stringify(m.tag||'').replace(/'/g,"&#39;")}, ${JSON.stringify(m.status||'').replace(/'/g,"&#39;")})'>编辑</button>
        <button class="btn btn-sm btn-danger" onclick="delMistake(${m.id})">删除</button>
      </td>
    </tr>`).join('');
  document.getElementById('mTable').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>用户</th><th>题干</th><th>科目</th><th>知识点</th><th>状态</th><th>复习次数</th><th>录入时间</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="empty">暂无错题</td></tbody>'}
    </table></div>
    ${paginHtml(total, page, size, 'gotoMPage')}`;
}
function gotoMPage(p) { renderMistakes(p, document.getElementById('mSubject').value); }

async function viewMistake(id) {
  const r = await api('GET', `/admin/mistakes/${id}`);
  if (!r.ok) { toast(r.error); return; }
  const m = r.data;
  openModal(`错题详情 #${id}`, `
    <div class="form-row"><label>题干</label><div style="white-space:pre-wrap">${esc(m.stem)}</div></div>
    <div class="form-row"><label>正确答案</label><div>${esc(m.answer)}</div></div>
    <div class="form-row"><label>学生错答</label><div>${esc(m.wrong_answer)}</div></div>
    <div class="form-row"><label>错因标签</label><div>${esc(m.reason)}</div></div>
    <div class="form-row"><label>科目 / 知识点</label><div>${esc(m.subject)} / ${esc(m.tag)}</div></div>
    <div class="form-row"><label>状态</label><div>${esc(m.status)}（已复习 ${m.review_count} 次）</div></div>
  `);
}

function editMistake(id, stem, answer, wrongAnswer, reason, subject, tag, status) {
  openModal(`编辑错题 #${id}`, `
    <div class="form-row"><label>题干</label><textarea id="mmStem">${esc(stem)}</textarea></div>
    <div class="form-row"><label>正确答案</label><textarea id="mmAnswer">${esc(answer)}</textarea></div>
    <div class="form-row"><label>学生错答</label><textarea id="mmWrong">${esc(wrongAnswer)}</textarea></div>
    <div class="form-row"><label>错因标签</label><input id="mmReason" value="${esc(reason)}" placeholder="如 概念不清/计算失误/审题错误"></div>
    <div class="form-row"><label>科目</label><input id="mmSubject" value="${esc(subject)}"></div>
    <div class="form-row"><label>知识点标签</label><input id="mmTag" value="${esc(tag)}"></div>
    <div class="form-row"><label>状态</label>
      <select id="mmStatus">${['未掌握','复习中','已掌握'].map(s => `<option ${s===status?'selected':''}>${s}</option>`).join('')}</select>
    </div>
  `, async () => {
    const r = await api('PUT', `/admin/mistakes/${id}`, {
      stem: document.getElementById('mmStem').value,
      answer: document.getElementById('mmAnswer').value,
      wrong_answer: document.getElementById('mmWrong').value,
      reason: document.getElementById('mmReason').value,
      subject: document.getElementById('mmSubject').value,
      tag: document.getElementById('mmTag').value,
      status: document.getElementById('mmStatus').value
    });
    toast(r.ok ? '已保存' : r.error);
    if (r.ok) renderMistakes(mPage, document.getElementById('mSubject').value);
  });
}

async function delMistake(id) {
  if (!confirm('确认删除该错题？')) return;
  const r = await api('DELETE', `/admin/mistakes/${id}`);
  toast(r.ok ? '已删除' : r.error);
  if (r.ok) renderMistakes(mPage, document.getElementById('mSubject').value);
}
