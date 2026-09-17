// 语音引擎设置
const VOICES = [
  { id: 'zh_female_vv_jupiter_bigtts', name: '活泼女声（默认）' },
  { id: 'zh_female_xiaohe_jupiter_bigtts', name: '甜美女声' },
  { id: 'zh_male_yunzhou_jupiter_bigtts', name: '沉稳男声' },
  { id: 'zh_male_xiaotian_jupiter_bigtts', name: '磁性男声' }
];

async function renderVoice() {
  const c = document.getElementById('content');
  c.innerHTML = `<div class="card" style="max-width:640px">
    <h3 style="margin-bottom:18px">火山引擎语音引擎配置</h3>
    <div class="form-row"><label>火山引擎 API Key（仅服务端存储，不下发客户端）</label>
      <input id="vcKey" type="password" placeholder="输入新 Key 才会修改，留空保持不变"></div>
    <div class="form-row"><label>代理地址（wss）</label>
      <input id="vcProxy" placeholder="wss://zblw.com.cn/voice?key=..."></div>
    <div class="form-row"><label>默认音色</label>
      <select id="vcVoice">${VOICES.map(v => `<option value="${v.id}">${v.name}（${v.id}）</option>`).join('')}</select></div>
    <div class="flex mt">
      <button class="btn btn-primary" onclick="saveVoice()">保存配置</button>
      <button class="btn" onclick="testVoice()">测试连接</button>
    </div>
    <p style="margin-top:16px;color:var(--text-2);font-size:12px;line-height:1.7">
      说明：客户端通过 /api/ai/voice-config 接口只拿到 proxy_url 和 voice_id，API Key 永不下发。
      代理地址已带鉴权参数 ?key=xxx。
    </p>
  </div>`;
  const r = await api('GET', '/admin/voice');
  if (r.ok) {
    document.getElementById('vcKey').value = r.data.api_key || '';
    document.getElementById('vcProxy').value = r.data.proxy_url || '';
    document.getElementById('vcVoice').value = r.data.voice_id || 'zh_female_vv_jupiter_bigtts';
  }
}

async function saveVoice() {
  const r = await api('PUT', '/admin/voice', {
    api_key: document.getElementById('vcKey').value,
    proxy_url: document.getElementById('vcProxy').value,
    voice_id: document.getElementById('vcVoice').value
  });
  toast(r.ok ? '已保存' : r.error);
  if (r.ok) renderVoice();
}

async function testVoice() {
  toast('测试中...');
  const r = await api('POST', '/admin/voice/test');
  alert(r.ok ? '测试通过：' + r.data.message : '测试失败：' + r.error);
}
