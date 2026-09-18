// 路由 + 登录控制
const PAGES = {
  dashboard: { title: '数据概览', render: renderDashboard },
  users: { title: '用户管理', render: renderUsers },
  applies: { title: '申请管理', render: renderApplies },
  llm: { title: '大模型管理', render: renderLlm },
  conversations: { title: '对话管理', render: renderConversations },
  questions: { title: '题库管理', render: renderQuestions },
  mistakes: { title: '错题管理', render: renderMistakes },
  knowledge: { title: '知识大纲', render: renderKnowledge },
  voicepack: { title: '语音包管理', render: renderVp },
  volc: { title: '火山用量', render: renderVolc },
  wxpay: { title: '微信支付', render: renderWxpay },
  voice: { title: '语音引擎设置', render: renderVoice }
};

let currentPage = 'dashboard';

function navTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.getElementById('pageTitle').textContent = PAGES[page].title;
  PAGES[page].render();
  if (page === 'applies') loadApplyBadge();
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginErr');
  errEl.textContent = '';
  const r = await api('POST', '/admin/login', { username, password });
  if (!r.ok) { errEl.textContent = r.error; return; }
  setToken(r.data.token);
  localStorage.setItem('admin_name', r.data.username);
  showMain();
}

function doLogout() {
  clearToken();
  localStorage.removeItem('admin_name');
  location.reload();
}

function showMain() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('mainLayout').style.display = 'flex';
  document.getElementById('adminName').textContent = localStorage.getItem('admin_name') || 'admin';
  navTo('dashboard');
  loadApplyBadge();
}

// 回车登录
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  if (getToken()) showMain();
  else document.getElementById('loginPage').style.display = 'flex';
});
