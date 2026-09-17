// 冒烟自测：用内存假 MySQL 跑通核心 HTTP 链路（不依赖真实数据库）
process.env.PORT = '8765';

const bcrypt = require('bcryptjs');
const path = require('path');

// ---- 内存假 mysql2/promise ----
const adminHash = bcrypt.hashSync('admin123', 10);
const demoHash = bcrypt.hashSync('demo123', 10);

async function fakeQuery(sql, params) {
  sql = sql.replace(/\s+/g, ' ').trim();
  // SELECT COUNT(*)
  if (/SELECT COUNT\(\*\) c/.test(sql)) return [[{ c: 7 }]];
  if (/FROM admin_users WHERE username/.test(sql)) return [[{ id: 1, username: 'admin', password_hash: adminHash }]];
  if (/FROM users WHERE username/.test(sql)) return [[{ id: 2, username: 'demo', password_hash: demoHash, nickname: '演示同学', grade: '九年级', role: 'student', is_vip: 1, vip_expire: null }]];
  if (/FROM users WHERE id/.test(sql)) return [[{ id: 2, username: 'demo', nickname: '演示同学', grade: '九年级', role: 'student', is_vip: 1, vip_expire: null }]];
  if (/FROM llm_configs WHERE is_active/.test(sql)) return [[{ id: 1, provider: 'DeepSeek', model: 'deepseek-chat', api_key: 'sk-your-key-here', base_url: 'https://api.deepseek.com/v1', is_active: 1 }]];
  if (/FROM voice_configs/.test(sql)) return [[{ proxy_url: 'wss://zblw.com.cn/voice?key=vp_test', voice_id: 'zh_female_vv_jupiter_bigtts' }]];
  if (/FROM messages WHERE conversation_id/.test(sql)) return [[]];
  if (/FROM conversations WHERE user_id/.test(sql)) return [[{ id: 5, user_id: 2, title: '自由提问', mode: 'text', updated_at: new Date() }]];
  if (/FROM questions/.test(sql)) return [[{ id: 1, stem: '测试题', subject: '数学' }]];
  if (/FROM mistakes/.test(sql)) return [[]];
  if (/INSERT INTO/.test(sql)) return [{ insertId: 10, affectedRows: 1 }];
  if (/UPDATE |DELETE FROM/.test(sql)) return [{ affectedRows: 1 }];
  return [[]];
}

const fakeMysql = {
  createPool: () => ({ query: fakeQuery, end: async () => {} })
};

// 注入 require 缓存，让 db/pool.js 用到假 mysql
require.cache[require.resolve('mysql2/promise')] = {
  id: require.resolve('mysql2/promise'), filename: 'mysql2/promise', loaded: true, exports: fakeMysql
};

// ---- 启动被测 server ----
require('../server.js');

// ---- 测试 ----
const base = 'http://127.0.0.1:8765';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ✅', name); pass++; }
  catch (e) { console.log('  ❌', name, '→', e.message); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

setTimeout(async () => {
  console.log('\n=== 冒烟自测 ===');

  await t('健康检查 /api/health', async () => {
    const r = await fetch(base + '/api/health').then(x => x.json());
    assert(r.ok && r.data.status === 'up', 'health');
  });

  let adminToken = '';
  await t('管理员登录 admin/admin123', async () => {
    const r = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) }).then(x => x.json());
    assert(r.ok && r.data.token, 'no token');
    adminToken = r.data.token;
  });

  await t('管理员错误密码被拒', async () => {
    const r = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) }).then(x => x.json());
    assert(!r.ok, 'should fail');
  });

  await t('管理端统计 /admin/stats 需 X-Admin-Token', async () => {
    const noAuth = await fetch(base + '/api/admin/stats').then(x => x.status);
    assert(noAuth === 401, 'should 401');
    const r = await fetch(base + '/api/admin/stats', { headers: { 'X-Admin-Token': adminToken } }).then(x => x.json());
    assert(r.ok && r.data.userTotal === 7, 'stats');
  });

  let userToken = '';
  await t('学生登录 demo/demo123', async () => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'demo123' }) }).then(x => x.json());
    assert(r.ok && r.data.token, 'no user token');
    userToken = r.data.token;
  });

  await t('学生未带 token 被拒 (401)', async () => {
    const s = await fetch(base + '/api/auth/me').then(x => x.status);
    assert(s === 401, 'should 401');
  });

  await t('首页统计 /home/stats', async () => {
    const r = await fetch(base + '/api/home/stats', { headers: { Authorization: 'Bearer ' + userToken } }).then(x => x.json());
    assert(r.ok && 'total' in r.data, 'stats keys');
  });

  await t('AI 对话 /ai/chat（兜底苏格拉底回复）', async () => {
    const r = await fetch(base + '/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + userToken }, body: JSON.stringify({ content: '你好，这道题怎么做' }) }).then(x => x.json());
    assert(r.ok && typeof r.data.reply === 'string' && r.data.reply.length > 0, 'no reply');
    console.log('     AI回复示例:', r.data.reply.slice(0, 50) + '...');
  });

  await t('语音配置只下发 proxy_url+voice_id', async () => {
    const r = await fetch(base + '/api/ai/voice-config', { headers: { Authorization: 'Bearer ' + userToken } }).then(x => x.json());
    assert(r.ok && r.data.proxy_url && r.data.voice_id && !('api_key' in r.data), 'leak api_key!');
  });

  await t('VIP 套餐 9.9/39/199', async () => {
    const r = await fetch(base + '/api/vip/plans', { headers: { Authorization: 'Bearer ' + userToken } }).then(x => x.json());
    assert(r.ok && r.data.length === 3, 'plans');
    assert(r.data[0].amount === 9.9 && r.data[1].amount === 39 && r.data[2].amount === 199, 'amounts');
  });

  await t('OCR 模拟识别', async () => {
    const r = await fetch(base + '/api/mistakes/ocr', { method: 'POST', headers: { Authorization: 'Bearer ' + userToken } }).then(x => x.json());
    assert(r.ok && r.data.text && r.data.subject, 'ocr');
  });

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
}, 800);
