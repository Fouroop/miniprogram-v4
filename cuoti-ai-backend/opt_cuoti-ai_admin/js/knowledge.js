// 知识大纲管理：管理后台维护章节/知识点，小程序端只按年级匹配展示
let knSubject = '', knGrade = '', knChapterId = 0;

const KN_GRADES = ['通用', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级'];
const KN_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治', '科学'];

/* ---------- 页面容器 ---------- */
async function renderKnowledge() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <button class="btn ${!knChapterId?'btn-primary':''}" onclick="knChapterId=0;renderKnowledge()">大纲总览</button>
        ${knChapterId ? '<button class="btn" onclick="knChapterId=0;renderKnowledge()">返回章节列表</button>' : ''}
        <span style="flex:1"></span>
        <button class="btn btn-primary" onclick="addKnChapter()">+ 新增章节</button>
      </div>
      <div id="knBody"></div>
    </div>`;
  if (!knChapterId) await loadKnSubjects();
  else await loadKnChapterDetail(knChapterId);
}

/* ---------- 概览：科目 × 年级 ---------- */
async function loadKnSubjects() {
  document.getElementById('knBody').innerHTML = '<div class="empty">加载中…</div>';
  const r = await api('GET', '/admin/knowledge/subjects');
  if (!r.ok) { document.getElementById('knBody').innerHTML = `<div class="empty">加载失败：${esc(r.error||'')}</div>`; return; }
  const list = r.data || [];
  const byKey = {};
  list.forEach(x => { byKey[x.subject + '|' + x.grade] = x; });
  const rows = KN_SUBJECTS.map(sub => `
    <tr>
      <td><b>${sub}</b></td>
      ${KN_GRADES.map(g => {
        const it = byKey[sub + '|' + g];
        const cls = it ? 'kn-cell has' : 'kn-cell';
        return `<td class="${cls}" ${it ? `onclick="knSubject='${sub}';knGrade='${g}';loadKnChapters()"` : ''}>
          ${it ? `${it.ch_count} 章 / ${it.kp_count} 点` : '-'}
        </td>`;
      }).join('')}
    </tr>`).join('');
  document.getElementById('knBody').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>科目 \\ 年级</th>${KN_GRADES.map(g => `<th>${g}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="form-tip">点击有数据的格子进入该科目+年级的章节管理</div>`;
}

/* ---------- 章节列表 ---------- */
async function loadKnChapters() {
  knChapterId = 0;
  const c = document.getElementById('content');
  c.innerHTML = `<div class="card">
    <div class="toolbar">
      <button class="btn" onclick="knChapterId=0;renderKnowledge()">大纲总览</button>
      <span class="crumb">当前：${esc(knSubject)} / ${esc(knGrade)}</span>
      <span style="flex:1"></span>
      <button class="btn btn-primary" onclick="addKnChapter()">+ 新增章节</button>
    </div>
    <div id="knBody"></div>
  </div>`;
  const r = await api('GET', `/admin/knowledge/chapters?subject=${encodeURIComponent(knSubject)}&grade=${encodeURIComponent(knGrade)}`);
  if (!r.ok) { document.getElementById('knBody').innerHTML = `<div class="empty">加载失败：${esc(r.error||'')}</div>`; return; }
  const list = r.data || [];
  const rows = list.map(ch => `
    <tr>
      <td>${ch.id}</td>
      <td><a href="javascript:void(0)" onclick="knChapterId=${ch.id};renderKnowledge()"><b>${esc(ch.name)}</b></a></td>
      <td>${ch.kp_count} 个知识点</td>
      <td>${ch.sort}</td>
      <td>
        <button class="btn btn-sm" onclick="editKnChapter(${ch.id})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="delKnChapter(${ch.id}, '${esc(ch.name)}')">删除</button>
      </td>
    </tr>`).join('');
  document.getElementById('knBody').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>章节</th><th>知识点数</th><th>排序</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty">该科目+年级暂无章节，点右上角新增</td></tbody>'}
    </table></div>`;
}

/* ---------- 章节详情（知识点管理） ---------- */
async function loadKnChapterDetail(id) {
  const [ch, kps] = await Promise.all([
    api('GET', `/admin/knowledge/chapters?subject=${encodeURIComponent(knSubject)}&grade=${encodeURIComponent(knGrade)}`),
    api('GET', `/admin/knowledge/kps?chapter_id=${id}`)
  ]);
  const chInfo = (ch.ok && ch.data || []).find(x => x.id === id);
  const list = (kps.ok && kps.data) || [];
  document.getElementById('knBody').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>知识点</th><th>排序</th><th>操作</th></tr></thead>
      <tbody>${list.map(k => `
        <tr>
          <td>${k.id}</td>
          <td>${esc(k.name)}</td>
          <td>${k.sort}</td>
          <td>
            <button class="btn btn-sm" onclick="editKnKp(${k.id}, '${esc(k.name)}')">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="delKnKp(${k.id}, '${esc(k.name)}')">删除</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty">暂无知识点</td></tr>'}
    </table></div>
    <div class="toolbar" style="margin-top:14px">
      <button class="btn btn-primary" onclick="addKnKp(${id})">+ 新增知识点</button>
      <button class="btn" onclick="batchKnKp(${id})">批量新增（一次多行）</button>
    </div>`;
}

/* ---------- 增删改 ---------- */
function addKnChapter() {
  openModal('新增章节', `
    <div class="form-row"><label>科目</label><select id="knSub">${KN_SUBJECTS.map(s => `<option ${s===knSubject?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="form-row"><label>年级</label><select id="knGradeSel">${KN_GRADES.map(g => `<option ${g===knGrade?'selected':''}>${g}</option>`).join('')}</select></div>
    <div class="form-row"><label>章节名</label><input id="knChName" placeholder="如 有理数"></div>
  `, async () => {
    const r = await api('POST', '/admin/knowledge/chapters', {
      subject: document.getElementById('knSub').value,
      grade: document.getElementById('knGradeSel').value,
      name: document.getElementById('knChName').value.trim()
    });
    if (!r.ok) { toast(r.error); return false; }
    toast('章节已新增');
    knSubject = document.getElementById('knSub').value;
    knGrade = document.getElementById('knGradeSel').value;
    loadKnChapters();
  });
}

function editKnChapter(id) {
  openModal('编辑章节', `
    <div class="form-row"><label>科目</label><select id="knSub">${KN_SUBJECTS.map(s => `<option ${s===knSubject?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="form-row"><label>年级</label><select id="knGradeSel">${KN_GRADES.map(g => `<option ${g===knGrade?'selected':''}>${g}</option>`).join('')}</select></div>
    <div class="form-row"><label>章节名</label><input id="knChName"></div>
  `, async () => {
    const r = await api('PUT', `/admin/knowledge/chapters/${id}`, {
      subject: document.getElementById('knSub').value,
      grade: document.getElementById('knGradeSel').value,
      name: document.getElementById('knChName').value.trim()
    });
    if (!r.ok) { toast(r.error); return false; }
    toast('已保存');
    knSubject = document.getElementById('knSub').value;
    knGrade = document.getElementById('knGradeSel').value;
    loadKnChapters();
  });
  document.getElementById('knChName').value = '';
}

function delKnChapter(id, name) {
  if (!confirm(`确认删除章节「${name}」？其下所有知识点和用户掌握记录将一并删除。`)) return;
  api('DELETE', `/admin/knowledge/chapters/${id}`).then(r => {
    if (!r.ok) { toast(r.error); return; }
    toast('已删除');
    knChapterId = 0;
    loadKnChapters();
  });
}

function addKnKp(chapterId) {
  openModal('新增知识点', `
    <div class="form-row"><label>知识点名</label><input id="knKpName" placeholder="如 有理数加法"></div>
  `, async () => {
    const r = await api('POST', '/admin/knowledge/kps', {
      chapter_id: chapterId,
      name: document.getElementById('knKpName').value.trim()
    });
    if (!r.ok) { toast(r.error); return false; }
    toast('已新增');
    renderKnowledge();
  });
}

function batchKnKp(chapterId) {
  openModal('批量新增知识点', `
    <div class="form-row"><label>每行一个知识点</label><textarea id="knKpNames" rows="8" placeholder="有理数加法&#10;有理数减法&#10;相反数"></textarea></div>
    <div class="form-tip">直接粘贴多行，每行自动成为一个知识点</div>
  `, async () => {
    const names = document.getElementById('knKpNames').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) { toast('请输入至少一个知识点'); return false; }
    const r = await api('POST', '/admin/knowledge/kps/batch', { chapter_id: chapterId, names });
    if (!r.ok) { toast(r.error); return false; }
    toast(`已新增 ${r.data.added} 个知识点`);
    renderKnowledge();
  });
}

function editKnKp(id, name) {
  openModal('编辑知识点', `
    <div class="form-row"><label>知识点名</label><input id="knKpName" value="${esc(name)}"></div>
  `, async () => {
    const r = await api('PUT', `/admin/knowledge/kps/${id}`, {
      name: document.getElementById('knKpName').value.trim()
    });
    if (!r.ok) { toast(r.error); return false; }
    toast('已保存');
    renderKnowledge();
  });
}

function delKnKp(id, name) {
  if (!confirm(`确认删除知识点「${name}」？用户对该点的掌握记录将一并删除。`)) return;
  api('DELETE', `/admin/knowledge/kps/${id}`).then(r => {
    if (!r.ok) { toast(r.error); return; }
    toast('已删除');
    renderKnowledge();
  });
}
