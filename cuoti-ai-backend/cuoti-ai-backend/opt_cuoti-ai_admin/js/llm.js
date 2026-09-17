// 大模型管理
async function renderLlm() {
  const c = document.getElementById('content');
  c.innerHTML = `<div class="card">
    <div class="toolbar">
      <h3 style="margin-right:auto">大模型配置列表</h3>
      <button class="btn btn-primary" onclick="editLlm()">+ 新增配置</button>
    </div>
    <div id="llmTable"></div>
  </div>`;
  const r = await api('GET', '/admin/llm');
  if (!r.ok) { document.getElementById('llmTable').innerHTML = '<div class="empty">加载失败</div>'; return; }
  const rows = r.data.map(x => `
    <tr>
      <td>${x.id}</td>
      <td><span class="tag blue">${esc(x.provider)}</span></td>
      <td>${esc(x.model)}</td>
      <td><code>${esc(x.api_key_mask)}</code></td>
      <td style="max-width:220px"><code style="font-size:11px">${esc(x.base_url)}</code></td>
      <td>${x.is_active ? '<span class="tag green">启用中</span>' : '<span class="tag">未启用</span>'}</td>
      <td>
        ${x.is_active ? '' : `<button class="btn btn-sm btn-success" onclick="activateLlm(${x.id})">设为启用</button>`}
        <button class="btn btn-sm" onclick="editLlm(${x.id}, '${esc(x.provider)}', '${esc(x.model)}', '${esc(x.api_key_mask)}', '${esc(x.base_url)}')">编辑</button>
        <button class="btn btn-sm" onclick="testLlm(${x.id})">测试连接</button>
        <button class="btn btn-sm btn-danger" onclick="delLlm(${x.id})">删除</button>
      </td>
    </tr>`).join('');
  document.getElementById('llmTable').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Provider</th><th>Model</th><th>API Key</th><th>Base URL</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">暂无配置，请新增</td></tbody>'}
    </table></div>`;
}

function editLlm(id, provider = 'DeepSeek', model = '', apiKey = '', baseUrl = 'https://api.deepseek.com/v1') {
  openModal(id ? `编辑大模型 #${id}` : '新增大模型配置', `
    <div class="form-row"><label>Provider（硅基流动/DeepSeek/OpenAI/自定义）</label>
      <select id="llProvider">
        ${['DeepSeek','硅基流动','OpenAI','自定义'].map(p => `<option ${p===provider?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="form-row"><label>Model 模型名</label><input id="llModel" value="${esc(model)}" placeholder="如 deepseek-chat"></div>
    <div class="form-row"><label>API Key${id ? '（留空或保持 **** 表示不修改）' : ''}</label>
      <input id="llKey" type="password" value="${esc(apiKey)}" placeholder="sk-..."></div>
    <div class="form-row"><label>Base URL</label><input id="llBase" value="${esc(baseUrl)}" placeholder="https://api.deepseek.com/v1"></div>
  `, async () => {
    const body = {
      provider: document.getElementById('llProvider').value,
      model: document.getElementById('llModel').value,
      api_key: document.getElementById('llKey').value,
      base_url: document.getElementById('llBase').value
    };
    const r = id ? await api('PUT', `/admin/llm/${id}`, body) : await api('POST', '/admin/llm', body);
    toast(r.ok ? '已保存' : r.error);
    if (r.ok) renderLlm();
  });
}

async function activateLlm(id) {
  const r = await api('POST', `/admin/llm/${id}/activate`);
  toast(r.ok ? '已设为启用' : r.error);
  if (r.ok) renderLlm();
}

async function testLlm(id) {
  toast('测试中...');
  const r = await api('POST', `/admin/llm/${id}/test`);
  alert(r.ok ? '连接成功！AI 回复：' + r.data.reply : '测试失败：' + r.error);
}

async function delLlm(id) {
  if (!confirm('确认删除该配置？')) return;
  const r = await api('DELETE', `/admin/llm/${id}`);
  toast(r.ok ? '已删除' : r.error);
  if (r.ok) renderLlm();
}
