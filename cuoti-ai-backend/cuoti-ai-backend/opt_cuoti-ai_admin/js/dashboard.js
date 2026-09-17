// 数据概览
async function renderDashboard() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="empty">加载中...</div>';
  const r = await api('GET', '/admin/stats');
  if (!r.ok) { c.innerHTML = '<div class="empty">加载失败</div>'; return; }
  const d = r.data;
  c.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="label">用户总数</div><div class="value">${d.userTotal}</div><div class="sub">今日新增 +${d.todayNewUsers}</div></div>
      <div class="stat-card"><div class="label">VIP 会员</div><div class="value">${d.vipTotal}</div><div class="sub">已开通付费用户</div></div>
      <div class="stat-card"><div class="label">错题总数</div><div class="value">${d.mistakeTotal}</div><div class="sub">今日新增 +${d.todayNewMistakes}</div></div>
      <div class="stat-card"><div class="label">对话总数</div><div class="value">${d.conversationTotal}</div><div class="sub">今日新增 +${d.todayNewConversations}</div></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:10px">系统说明</h3>
      <p style="color:var(--text-2);line-height:1.8">
        本后台用于管理「错题AI辅导」小程序的全部运营数据。<br>
        1. 在「大模型管理」配置 OpenAI 兼容接口的 provider / model / api_key / base_url，点击"设为启用"后生效。<br>
        2. 在「语音引擎设置」配置火山引擎语音代理，客户端只拿到 proxy_url 与 voice_id，api_key 不下发。<br>
        3. 学生端通过账号密码登录，错题本与 AI 对话按 user_id 隔离。
      </p>
    </div>`;
}
