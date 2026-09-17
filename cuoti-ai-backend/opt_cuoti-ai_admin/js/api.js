// API 请求封装（前缀由 index.html 注入，避免与公网 /api 冲突）
const API_BASE = (window.__CUOTI_API_PREFIX__ || '') + '/api';

function getToken() { return localStorage.getItem('admin_token') || ''; }
function setToken(t) { localStorage.setItem('admin_token', t); }
function clearToken() { localStorage.removeItem('admin_token'); }

async function api(method, path, body) {
  const opt = {
    method,
    headers: { 'X-Admin-Token': getToken(), 'Content-Type': 'application/json' }
  };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const resp = await fetch(API_BASE + path, opt);
  const data = await resp.json().catch(() => ({ ok: false, error: '响应解析失败' }));
  if (resp.status === 401 && path !== '/admin/login') {
    clearToken(); location.reload();
    throw new Error('登录已过期');
  }
  return data;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.style.display = 'none', 2200);
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// 通用弹窗
function openModal(title, bodyHtml, onOk) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalMask').classList.add('show');
  const btn = document.getElementById('modalOkBtn');
  btn.onclick = async () => {
    const r = await onOk();
    if (r !== false) closeModal();
  };
}
function closeModal() { document.getElementById('modalMask').classList.remove('show'); }

// 分页 HTML
function paginHtml(total, page, size, onPage) {
  const pages = Math.max(1, Math.ceil(total / size));
  let h = `<div class="pagination">`;
  h += `<button class="btn btn-sm" ${page<=1?'disabled':''} onclick="${onPage}(${page-1})">上一页</button>`;
  h += `<span class="cur">第 ${page} / ${pages} 页（共 ${total} 条）</span>`;
  h += `<button class="btn btn-sm" ${page>=pages?'disabled':''} onclick="${onPage}(${page+1})">下一页</button>`;
  h += `</div>`;
  return h;
}
