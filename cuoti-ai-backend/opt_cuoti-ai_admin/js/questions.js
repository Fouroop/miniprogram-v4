// 题库管理
let qPage = 1, qSelected = new Set();
async function renderQuestions(page = 1, subject = '', keyword = '') {
  qPage = page;
  const c = document.getElementById('content');
  c.innerHTML = `<div class="card">
    <div class="toolbar">
      <select id="qSubject">
        <option value="">全部科目</option>
        ${['数学','物理','化学','语文','英语'].map(s => `<option ${s===subject?'selected':''}>${s}</option>`).join('')}
      </select>
      <input id="qKeyword" placeholder="搜索题干/答案" value="${esc(keyword)}" style="width:200px">
      <button class="btn btn-primary" onclick="renderQuestions(1, document.getElementById('qSubject').value, document.getElementById('qKeyword').value.trim())">搜索</button>
      <span style="flex:1"></span>
      <button class="btn btn-primary" onclick="editQuestion()">+ 新增题目</button>
      <button class="btn btn-danger" onclick="batchDelQuestions()">批量删除选中</button>
    </div>
    <div id="qTable"></div>
  </div>`;
  const r = await api('GET', `/admin/questions?page=${page}&size=10&subject=${encodeURIComponent(subject)}&keyword=${encodeURIComponent(keyword)}`);
  if (!r.ok) { document.getElementById('qTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const { list, total, size } = r.data;
  const rows = list.map(q => `
    <tr>
      <td><input type="checkbox" onchange="toggleQ(${q.id}, this.checked)"></td>
      <td>${q.id}</td>
      <td style="max-width:280px">${esc((q.stem||'').slice(0,60))}${(q.stem||'').length>60?'...':''}</td>
      <td><span class="tag blue">${esc(q.subject)}</span></td>
      <td>${esc(q.grade)}</td>
      <td><span class="tag ${q.difficulty==='拔高'?'red':q.difficulty==='较难'?'orange':''}">${esc(q.difficulty)}</span></td>
      <td>${q.user_id ? esc(q.username||'用户#'+q.user_id) : '<span class="tag green">公共题</span>'}</td>
      <td>
        <button class="btn btn-sm" onclick='editQuestion(${q.id}, ${JSON.stringify(q.stem||'').replace(/'/g,"&#39;")}, ${JSON.stringify(q.answer||'').replace(/'/g,"&#39;")}, ${JSON.stringify(q.analysis||'').replace(/'/g,"&#39;")}, ${JSON.stringify(q.subject||'').replace(/'/g,"&#39;")}, ${JSON.stringify(q.grade||'').replace(/'/g,"&#39;")}, ${JSON.stringify(q.difficulty||'').replace(/'/g,"&#39;")}, ${JSON.stringify(q.status||'').replace(/'/g,"&#39;")})'>编辑</button>
        <button class="btn btn-sm btn-danger" onclick="delQuestion(${q.id})">删除</button>
      </td>
    </tr>`).join('');
  document.getElementById('qTable').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th style="width:30px"></th><th>ID</th><th>题干</th><th>科目</th><th>年级</th><th>难度</th><th>归属</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="empty">暂无题目</td></tbody>'}
    </table></div>
    ${paginHtml(total, page, size, 'gotoQPage')}`;
}
function gotoQPage(p) { renderQuestions(p, document.getElementById('qSubject').value, document.getElementById('qKeyword').value.trim()); }
function toggleQ(id, checked) { checked ? qSelected.add(id) : qSelected.delete(id); }

function editQuestion(id, stem='', answer='', analysis='', subject='数学', grade='九年级', difficulty='中等', status='未学习') {
  openModal(id ? `编辑题目 #${id}` : '新增题目', `
    <div class="form-row"><label>题干</label><textarea id="qqStem">${esc(stem)}</textarea></div>
    <div class="form-row"><label>答案</label><textarea id="qqAnswer">${esc(answer)}</textarea></div>
    <div class="form-row"><label>解析</label><textarea id="qqAnalysis">${esc(analysis)}</textarea></div>
    <div class="form-row"><label>科目</label>
      <select id="qqSubject">${['数学','物理','化学','语文','英语'].map(s => `<option ${s===subject?'selected':''}>${s}</option>`).join('')}</select>
    </div>
    <div class="form-row"><label>年级</label><input id="qqGrade" value="${esc(grade)}"></div>
    <div class="form-row"><label>难度</label>
      <select id="qqDiff">${['简单','中等','较难','拔高'].map(d => `<option ${d===difficulty?'selected':''}>${d}</option>`).join('')}</select>
    </div>
    <div class="form-row"><label>状态</label>
      <select id="qqStatus">${['未学习','需复习','已掌握'].map(s => `<option ${s===status?'selected':''}>${s}</option>`).join('')}</select>
    </div>
  `, async () => {
    const body = {
      stem: document.getElementById('qqStem').value,
      answer: document.getElementById('qqAnswer').value,
      analysis: document.getElementById('qqAnalysis').value,
      subject: document.getElementById('qqSubject').value,
      grade: document.getElementById('qqGrade').value,
      difficulty: document.getElementById('qqDiff').value,
      status: document.getElementById('qqStatus').value
    };
    const r = id ? await api('PUT', `/admin/questions/${id}`, body) : await api('POST', '/admin/questions', body);
    toast(r.ok ? '已保存' : r.error);
    if (r.ok) renderQuestions(qPage, document.getElementById('qSubject').value, document.getElementById('qKeyword').value.trim());
  });
}

async function delQuestion(id) {
  if (!confirm('确认删除该题？')) return;
  const r = await api('DELETE', `/admin/questions/${id}`);
  toast(r.ok ? '已删除' : r.error);
  if (r.ok) renderQuestions(qPage, document.getElementById('qSubject').value, document.getElementById('qKeyword').value.trim());
}

async function batchDelQuestions() {
  if (!qSelected.size) { toast('请先勾选题目'); return; }
  if (!confirm(`确认删除选中的 ${qSelected.size} 道题？`)) return;
  const r = await api('POST', '/admin/questions/batch-delete', { ids: [...qSelected] });
  toast(r.ok ? `已删除 ${r.data.deleted} 条` : r.error);
  if (r.ok) { qSelected.clear(); renderQuestions(qPage, document.getElementById('qSubject').value, document.getElementById('qKeyword').value.trim()); }
}
