const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');
const { adminAuth } = require('../middleware/auth');

const router = express.Router();

// ---------- 管理员登录 ----------
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM admin_users WHERE username=?', [username || '']);
  if (!rows.length || !bcrypt.compareSync(password || '', rows[0].password_hash)) {
    return res.json({ ok: false, error: '账号或密码错误' });
  }
  const token = jwt.sign({ id: rows[0].id, username: rows[0].username }, config.jwt.adminSecret, { expiresIn: config.jwt.adminExpire });
  res.json({ ok: true, data: { token, username: rows[0].username } });
});

router.use(adminAuth); // 以下全部需要 X-Admin-Token

// ---------- 数据概览 ----------
router.get('/stats', async (req, res) => {
  const [[users]] = await pool.query('SELECT COUNT(*) c FROM users');
  const [[vip]] = await pool.query('SELECT COUNT(*) c FROM users WHERE is_vip=1');
  const [[mistakes]] = await pool.query('SELECT COUNT(*) c FROM mistakes');
  const [[convs]] = await pool.query('SELECT COUNT(*) c FROM conversations');
  const [[todayUsers]] = await pool.query('SELECT COUNT(*) c FROM users WHERE DATE(created_at)=CURDATE()');
  const [[todayMistakes]] = await pool.query('SELECT COUNT(*) c FROM mistakes WHERE DATE(created_at)=CURDATE()');
  const [[todayConvs]] = await pool.query('SELECT COUNT(*) c FROM conversations WHERE DATE(created_at)=CURDATE()');
  res.json({
    ok: true,
    data: {
      userTotal: users.c, vipTotal: vip.c, mistakeTotal: mistakes.c, conversationTotal: convs.c,
      todayNewUsers: todayUsers.c, todayNewMistakes: todayMistakes.c, todayNewConversations: todayConvs.c
    }
  });
});

// ---------- 用户管理 ----------
router.get('/users', async (req, res) => {
  const { page = 1, size = 10, keyword } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(100, parseInt(size));
  let where = '1=1';
  const params = [];
  if (keyword) { where += ' AND (username LIKE ? OR nickname LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  const [total] = await pool.query(`SELECT COUNT(*) c FROM users WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT id, username, nickname, grade, role, is_vip, vip_expire, voice_minutes, created_at FROM users WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

router.get('/users/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, nickname, grade, role, is_vip, vip_expire, voice_minutes, created_at FROM users WHERE id=?', [req.params.id]);
  if (!rows.length) return res.json({ ok: false, error: '用户不存在' });
  res.json({ ok: true, data: rows[0] });
});

router.put('/users/:id', async (req, res) => {
  const { nickname, grade, is_vip, vip_expire } = req.body;
  await pool.query('UPDATE users SET nickname=?, grade=?, is_vip=?, vip_expire=? WHERE id=?',
    [nickname, grade, is_vip ? 1 : 0, vip_expire || null, req.params.id]);
  res.json({ ok: true });
});

router.delete('/users/:id', async (req, res) => {
  await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- 大模型管理 ----------
router.get('/llm', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM llm_configs ORDER BY id DESC');
  // api_key 脱敏
  rows.forEach(r => { r.api_key_mask = maskKey(r.api_key); });
  res.json({ ok: true, data: rows });
});

router.post('/llm', async (req, res) => {
  const { provider, model, api_key, base_url } = req.body;
  if (!provider || !model) return res.json({ ok: false, error: 'provider 和 model 必填' });
  const [r] = await pool.query('INSERT INTO llm_configs (provider, model, api_key, base_url, is_active) VALUES (?,?,?,?,0)',
    [provider, model, api_key || '', base_url || 'https://api.openai.com/v1']);
  res.json({ ok: true, data: { id: r.insertId } });
});

router.put('/llm/:id', async (req, res) => {
  const { provider, model, api_key, base_url } = req.body;
  // api_key 为空或带 **** 表示不修改
  if (api_key && api_key.includes('****')) {
    await pool.query('UPDATE llm_configs SET provider=?, model=?, base_url=? WHERE id=?', [provider, model, base_url, req.params.id]);
  } else {
    await pool.query('UPDATE llm_configs SET provider=?, model=?, api_key=?, base_url=? WHERE id=?', [provider, model, api_key, base_url, req.params.id]);
  }
  res.json({ ok: true });
});

router.delete('/llm/:id', async (req, res) => {
  await pool.query('DELETE FROM llm_configs WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

router.post('/llm/:id/activate', async (req, res) => {
  await pool.query('UPDATE llm_configs SET is_active=0');
  await pool.query('UPDATE llm_configs SET is_active=1 WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

router.post('/llm/:id/test', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM llm_configs WHERE id=?', [req.params.id]);
  if (!rows.length) return res.json({ ok: false, error: '配置不存在' });
  const llm = rows[0];
  try {
    const url = (llm.base_url || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + llm.api_key },
      body: JSON.stringify({ model: llm.model, messages: [{ role: 'user', content: '你好，请回复"连接成功"' }], max_tokens: 20 })
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return res.json({ ok: false, error: 'HTTP ' + resp.status + ': ' + txt.slice(0, 150) });
    }
    const data = await resp.json();
    res.json({ ok: true, data: { reply: data.choices?.[0]?.message?.content || '(空回复)' } });
  } catch (e) {
    res.json({ ok: false, error: '请求失败: ' + e.message });
  }
});

// ---------- 对话管理 ----------
router.get('/conversations', async (req, res) => {
  const { page = 1, size = 10, user_id } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(100, parseInt(size));
  let where = '1=1';
  const params = [];
  if (user_id) { where += ' AND c.user_id=?'; params.push(user_id); }
  const [total] = await pool.query(`SELECT COUNT(*) c FROM conversations c WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT c.*, u.username, u.nickname FROM conversations c LEFT JOIN users u ON c.user_id=u.id WHERE ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

router.get('/conversations/:id/messages', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM messages WHERE conversation_id=? ORDER BY id ASC', [req.params.id]);
  res.json({ ok: true, data: rows });
});

router.delete('/conversations/:id', async (req, res) => {
  await pool.query('DELETE FROM messages WHERE conversation_id=?', [req.params.id]);
  await pool.query('DELETE FROM conversations WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- 题库管理 ----------
router.get('/questions', async (req, res) => {
  const { page = 1, size = 10, subject, keyword } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(100, parseInt(size));
  let where = '1=1';
  const params = [];
  if (subject) { where += ' AND subject=?'; params.push(subject); }
  if (keyword) { where += ' AND (stem LIKE ? OR answer LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  const [total] = await pool.query(`SELECT COUNT(*) c FROM questions WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT q.*, u.username FROM questions q LEFT JOIN users u ON q.user_id=u.id WHERE ${where} ORDER BY q.id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

router.post('/questions', async (req, res) => {
  const { stem, answer, analysis, subject, grade, difficulty, status, user_id } = req.body;
  const [r] = await pool.query(
    'INSERT INTO questions (stem, answer, analysis, subject, grade, difficulty, status, user_id) VALUES (?,?,?,?,?,?,?,?)',
    [stem || '', answer || '', analysis || '', subject || '', grade || '', difficulty || '中等', status || '未学习', user_id || null]
  );
  res.json({ ok: true, data: { id: r.insertId } });
});

router.put('/questions/:id', async (req, res) => {
  const { stem, answer, analysis, subject, grade, difficulty, status } = req.body;
  await pool.query(
    'UPDATE questions SET stem=?, answer=?, analysis=?, subject=?, grade=?, difficulty=?, status=? WHERE id=?',
    [stem, answer, analysis, subject, grade, difficulty, status, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/questions/:id', async (req, res) => {
  await pool.query('DELETE FROM questions WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

router.post('/questions/batch-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.json({ ok: false, error: 'ids 不能为空' });
  await pool.query(`DELETE FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  res.json({ ok: true, data: { deleted: ids.length } });
});

// ---------- 错题管理 ----------
router.get('/mistakes', async (req, res) => {
  const { page = 1, size = 10, user_id, subject } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(100, parseInt(size));
  let where = '1=1';
  const params = [];
  if (user_id) { where += ' AND m.user_id=?'; params.push(user_id); }
  if (subject) { where += ' AND m.subject=?'; params.push(subject); }
  const [total] = await pool.query(`SELECT COUNT(*) c FROM mistakes m WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT m.*, u.username FROM mistakes m LEFT JOIN users u ON m.user_id=u.id WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

router.get('/mistakes/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM mistakes WHERE id=?', [req.params.id]);
  if (!rows.length) return res.json({ ok: false, error: '错题不存在' });
  res.json({ ok: true, data: rows[0] });
});

router.put('/mistakes/:id', async (req, res) => {
  const { stem, answer, wrong_answer, reason, subject, tag, status } = req.body;
  await pool.query(
    'UPDATE mistakes SET stem=?, answer=?, wrong_answer=?, reason=?, subject=?, tag=?, status=? WHERE id=?',
    [stem, answer, wrong_answer, reason, subject, tag, status, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/mistakes/:id', async (req, res) => {
  await pool.query('DELETE FROM mistakes WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- 会员管理 ----------
router.get('/vip/orders', async (req, res) => {
  const { page = 1, size = 10 } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(100, parseInt(size));
  const [total] = await pool.query('SELECT COUNT(*) c FROM vip_orders');
  const [rows] = await pool.query(
    'SELECT o.*, u.username, u.nickname FROM vip_orders o LEFT JOIN users u ON o.user_id=u.id ORDER BY o.id DESC LIMIT ? OFFSET ?',
    [s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

router.get('/vip/codes', async (req, res) => {
  const { page = 1, size = 10 } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(100, parseInt(size));
  const [total] = await pool.query('SELECT COUNT(*) c FROM vip_codes');
  const [rows] = await pool.query(
    'SELECT c.*, u.username AS used_by_name FROM vip_codes c LEFT JOIN users u ON c.used_by=u.id ORDER BY c.id DESC LIMIT ? OFFSET ?',
    [s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

router.post('/vip/codes/generate', async (req, res) => {
  const { type = 'monthly', count = 10, duration_days } = req.body;
  const days = duration_days || (type === 'yearly' ? 365 : 30);
  const n = Math.min(500, Math.max(1, parseInt(count) || 10));
  const codes = [];
  for (let i = 0; i < n; i++) {
    const code = 'VIP-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();
    await pool.query('INSERT INTO vip_codes (code, type, duration_days) VALUES (?,?,?)', [code, type, days]);
    codes.push(code);
  }
  res.json({ ok: true, data: { count: codes.length, codes } });
});

router.delete('/vip/codes/:id', async (req, res) => {
  await pool.query('DELETE FROM vip_codes WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- 语音引擎设置 ----------
router.get('/voice', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM voice_configs WHERE is_active=1 LIMIT 1');
  if (!rows.length) return res.json({ ok: true, data: { api_key: '', proxy_url: '', voice_id: 'zh_female_vv_jupiter_bigtts' } });
  const r = rows[0];
  res.json({ ok: true, data: { ...r, api_key: maskKey(r.api_key) } });
});

router.put('/voice', async (req, res) => {
  const { api_key, proxy_url, voice_id } = req.body;
  const [rows] = await pool.query('SELECT * FROM voice_configs WHERE is_active=1 LIMIT 1');
  if (rows.length) {
    // api_key 含 **** 表示不修改
    if (api_key && api_key.includes('****')) {
      await pool.query('UPDATE voice_configs SET proxy_url=?, voice_id=? WHERE id=?', [proxy_url, voice_id, rows[0].id]);
    } else {
      await pool.query('UPDATE voice_configs SET api_key=?, proxy_url=?, voice_id=? WHERE id=?', [api_key, proxy_url, voice_id, rows[0].id]);
    }
  } else {
    await pool.query('INSERT INTO voice_configs (api_key, proxy_url, voice_id, is_active) VALUES (?,?,?,1)',
      [api_key || '', proxy_url || '', voice_id || 'zh_female_vv_jupiter_bigtts']);
  }
  res.json({ ok: true });
});

router.post('/voice/test', async (req, res) => {
  const [rows] = await pool.query('SELECT proxy_url FROM voice_configs WHERE is_active=1 LIMIT 1');
  if (!rows.length) return res.json({ ok: false, error: '未配置语音代理地址' });
  const proxyUrl = rows[0].proxy_url;
  try {
    // 演示环境：检测地址可解析即可，不真正建立 wss
    if (!proxyUrl) return res.json({ ok: false, error: '代理地址为空' });
    res.json({ ok: true, data: { message: '代理地址已配置：' + proxyUrl } });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---------- 语音包管理 ----------
// 套餐列表
router.get('/voice/plans', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM voice_plans ORDER BY price');
  res.json({ ok: true, data: rows });
});

// 新增套餐
router.post('/voice/plans', async (req, res) => {
  const { plan, name, minutes, price, duration_days, desc_text, hot } = req.body;
  if (!plan || !name || !minutes || !price) return res.json({ ok: false, error: '套餐标识/名称/分钟数/价格必填' });
  const [r] = await pool.query(
    'INSERT INTO voice_plans (plan, name, minutes, price, duration_days, desc_text, hot) VALUES (?,?,?,?,?,?,?)',
    [plan, name, parseInt(minutes), parseFloat(price), parseInt(duration_days) || 30, desc_text || '', hot ? 1 : 0]
  );
  res.json({ ok: true, data: { id: r.insertId } });
});

// 更新套餐
router.put('/voice/plans/:id', async (req, res) => {
  const { plan, name, minutes, price, duration_days, desc_text, hot, is_active } = req.body;
  await pool.query(
    'UPDATE voice_plans SET plan=?, name=?, minutes=?, price=?, duration_days=?, desc_text=?, hot=?, is_active=? WHERE id=?',
    [plan, name, parseInt(minutes), parseFloat(price), parseInt(duration_days) || 30, desc_text || '', hot ? 1 : 0, is_active ? 1 : 0, req.params.id]
  );
  res.json({ ok: true });
});

// 删除套餐
router.delete('/voice/plans/:id', async (req, res) => {
  await pool.query('DELETE FROM voice_plans WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// 语音包订单列表
router.get('/voice/orders', async (req, res) => {
  const { page = 1, size = 10 } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(100, parseInt(size));
  const [total] = await pool.query('SELECT COUNT(*) c FROM voice_orders');
  const [rows] = await pool.query(
    'SELECT o.*, u.username, u.nickname FROM voice_orders o LEFT JOIN users u ON o.user_id=u.id ORDER BY o.id DESC LIMIT ? OFFSET ?',
    [s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

// 用户语音包列表（含余额/到期）
router.get('/voice/users', async (req, res) => {
  const { page = 1, size = 10, keyword } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(100, parseInt(size));
  let where = '1=1';
  const params = [];
  if (keyword) { where += ' AND (username LIKE ? OR nickname LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  const [total] = await pool.query(`SELECT COUNT(*) c FROM users WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT id, username, nickname, voice_minutes, voice_expire, created_at FROM users WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

// 调整单个用户语音包（增减余额 / 延期）
router.put('/voice/users/:id', async (req, res) => {
  const { voice_minutes, voice_expire } = req.body;
  const [users] = await pool.query('SELECT voice_minutes, voice_expire FROM users WHERE id=?', [req.params.id]);
  if (!users.length) return res.json({ ok: false, error: '用户不存在' });
  const u = users[0];
  // MySQL DECIMAL 读出为字符串，必须 parseFloat 再运算，否则 + 触发字符串拼接
  let newMinutes = parseFloat(u.voice_minutes || 0);
  let newExpire = u.voice_expire || null;
  // voice_minutes 支持两种语义：绝对值（>=0 时直接设置）或增量（delta 前缀 +/-）
  if (typeof voice_minutes === 'number') {
    if (voice_minutes >= 0) newMinutes = voice_minutes;
    else newMinutes = Math.max(0, newMinutes + voice_minutes);
  } else if (typeof voice_minutes === 'string' && (voice_minutes.startsWith('+') || voice_minutes.startsWith('-'))) {
    newMinutes = Math.max(0, newMinutes + (parseInt(voice_minutes, 10) || 0));
  }
  // NaN 防护：解析失败时回退原余额，避免拼出 Unknown column 'NaN'
  if (Number.isNaN(newMinutes)) newMinutes = parseFloat(u.voice_minutes || 0) || 0;
  // 保留 1 位小数
  newMinutes = Math.round(newMinutes * 10) / 10;
  if (voice_expire !== undefined) newExpire = voice_expire || null;
  await pool.query('UPDATE users SET voice_minutes=?, voice_expire=? WHERE id=?', [newMinutes, newExpire, req.params.id]);
  res.json({ ok: true, data: { voice_minutes: newMinutes, voice_expire: newExpire } });
});

// ---------- 流量统计：消耗流量(时长)/计费流量(扣减分钟)/实际流量(字节) ----------
router.get('/voice/stats', async (req, res) => {
  const [today] = await pool.query(
    `SELECT COUNT(*) calls,
            COALESCE(SUM(seconds),0) seconds,
            COALESCE(SUM(billed_minutes),0) billed,
            COALESCE(SUM(total_bytes),0) bytes
     FROM voice_calls WHERE created_at >= CURDATE()`
  );
  const [total] = await pool.query(
    `SELECT COUNT(*) calls,
            COALESCE(SUM(seconds),0) seconds,
            COALESCE(SUM(billed_minutes),0) billed,
            COALESCE(SUM(total_bytes),0) bytes
     FROM voice_calls`
  );
  const mb = (b) => Math.round((Number(b) || 0) / 1024 / 1024 * 100) / 100;
  res.json({ ok: true, data: {
    today: {
      calls: today[0].calls,
      consume_minutes: Math.round(Number(today[0].seconds) / 60 * 10) / 10,   // 消耗流量
      billed_minutes: Number(today[0].billed),                                  // 计费流量
      actual_mb: mb(today[0].bytes)                                             // 实际流量
    },
    total: {
      calls: total[0].calls,
      consume_minutes: Math.round(Number(total[0].seconds) / 60 * 10) / 10,
      billed_minutes: Number(total[0].billed),
      actual_mb: mb(total[0].bytes)
    }
  }});
});

// ---------- 通话明细（实时查询） ----------
router.get('/voice/calls', async (req, res) => {
  const { page = 1, size = 10, keyword, days } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(100, parseInt(size));
  let where = '1=1';
  const params = [];
  if (keyword) { where += ' AND (u.username LIKE ? OR u.nickname LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (days) { where += ' AND c.created_at >= NOW() - INTERVAL ? DAY'; params.push(parseInt(days)); }
  const [total] = await pool.query(`SELECT COUNT(*) c FROM voice_calls c LEFT JOIN users u ON c.user_id=u.id WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT c.id, c.user_id, u.username, u.nickname, c.mistake_id, c.seconds, c.billed_minutes,
            c.up_bytes, c.down_bytes, c.total_bytes, c.created_at
     FROM voice_calls c LEFT JOIN users u ON c.user_id=u.id
     WHERE ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  const mb = (b) => Math.round((Number(b) || 0) / 1024 / 1024 * 100) / 100;
  res.json({ ok: true, data: {
    list: rows.map(r => ({ ...r, actual_mb: mb(r.total_bytes), up_mb: mb(r.up_bytes), down_mb: mb(r.down_bytes) })),
    total: total[0].c, page: p, size: s
  }});
});

// ---------- 微信支付配置（读取，脱敏） ----------
router.get('/voice/wxpay/config', async (req, res) => {
  const wxpay = require('./wxpay');
  const cfg = await wxpay.getConfig();
  if (!cfg) return res.json({ ok: true, data: null });
  res.json({ ok: true, data: {
    mchid: cfg.mchid, appid: cfg.appid, serial_no: cfg.serial_no,
    apiv3_key_mask: maskKey(cfg.apiv3_key),
    appsecret_mask: cfg.appsecret ? maskKey(cfg.appsecret) : '',
    private_key_set: !!(cfg.private_key && cfg.private_key.includes('PRIVATE KEY')),
    notify_url: wxpay.getNotifyUrl(),
    configured: true
  }});
});

// ---------- 微信支付配置（保存） ----------
router.put('/voice/wxpay/config', async (req, res) => {
  const wxpay = require('./wxpay');
  const { mchid, appid, apiv3_key, serial_no, private_key, appsecret } = req.body;
  // 商户号/AppID 为空 = 停用微信支付，恢复模拟模式
  if (!mchid || !appid) {
    await pool.query("DELETE FROM settings WHERE key_name='wxpay_config'");
    return res.json({ ok: true, disabled: true });
  }
  const old = await wxpay.getConfig();
  const cfg = {
    mchid, appid,
    apiv3_key: (apiv3_key && !apiv3_key.includes('****')) ? apiv3_key : (old ? old.apiv3_key : ''),
    serial_no,
    private_key: (private_key && !private_key.includes('****')) ? private_key : (old ? old.private_key : ''),
    appsecret: (appsecret && !appsecret.includes('****')) ? appsecret : (old ? old.appsecret : '')
  };
  if (!cfg.apiv3_key || !cfg.serial_no || !cfg.private_key) {
    return res.json({ ok: false, error: 'APIv3密钥、证书序列号、商户私钥必填（重填时保留****）' });
  }
  await wxpay.setConfig(cfg);
  res.json({ ok: true });
});

// ---------- 微信支付连接测试（验证商户号/证书序列号/私钥/APIv3密钥） ----------
router.post('/voice/wxpay/test-connect', async (req, res) => {
  const wxpay = require('./wxpay');
  try {
    const cfg = await wxpay.getConfig();
    if (!cfg) return res.json({ ok: false, error: '未配置微信支付参数，请先保存配置' });
    wxpay.resetPlatformCertCache();
    const cert = await wxpay.getPlatformCert(cfg);
    res.json({ ok: true, data: { cert_ok: true, cert_preview: String(cert).slice(0, 30) + '…' } });
  } catch (e) {
    res.json({ ok: false, error: '连接失败：' + (e && e.message ? e.message : String(e)).slice(0, 300) });
  }
});

// ---------- 微信支付测试下单（0.01 元真实调统一下单，验证下单链路） ----------
router.post('/voice/wxpay/test-prepay', async (req, res) => {
  const wxpay = require('./wxpay');
  try {
    const cfg = await wxpay.getConfig();
    if (!cfg) return res.json({ ok: false, error: '未配置微信支付参数，请先保存配置' });
    const openid = String(req.body.openid || '').trim();
    if (!openid) return res.json({ ok: false, error: '请填写测试用户的 openid（小程序 code 换取的 openid）' });
    const tradeNo = 'TEST' + Date.now() + Math.floor(Math.random() * 1000);
    const path = '/v3/pay/transactions/jsapi';
    const body = {
      appid: cfg.appid,
      mchid: cfg.mchid,
      description: '微信支付配置验证（请勿支付）',
      out_trade_no: tradeNo,
      notify_url: wxpay.getNotifyUrl(),
      amount: { total: 1, currency: 'CNY' },
      payer: { openid }
    };
    const bodyStr = JSON.stringify(body);
    const auth = wxpay.buildAuthHeader('POST', path, bodyStr, cfg);
    const resp = await wxpay.httpsJson({
      hostname: 'api.mch.weixin.qq.com', path, method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Accept': 'application/json' }
    }, bodyStr);
    if (resp.status !== 200 || !resp.body.prepay_id) {
      return res.json({ ok: false, error: '下单失败(' + resp.status + ')：' + JSON.stringify(resp.body).slice(0, 300) });
    }
    // 生成 wx.requestPayment 参数（仅验证用途，勿真实拉起）
    const crypto = require('crypto');
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const packageStr = 'prepay_id=' + resp.body.prepay_id;
    const paySignMsg = `${cfg.appid}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(paySignMsg, 'utf8'); sign.end();
    res.json({
      ok: true,
      data: {
        trade_no: tradeNo,
        prepay_id: resp.body.prepay_id,
        payment: {
          timeStamp, nonceStr, package: packageStr, signType: 'RSA',
          paySign: sign.sign(cfg.private_key, 'base64')
        }
      }
    });
  } catch (e) {
    res.json({ ok: false, error: '测试下单异常：' + (e && e.message ? e.message : String(e)).slice(0, 300) });
  }
});

// ---------- 语音包订单列表（验证支付回调发货结果） ----------
router.get('/voice/wxpay/orders', async (req, res) => {
  const { page = 1, size = 20 } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(50, parseInt(size));
  const [total] = await pool.query('SELECT COUNT(*) c FROM voice_orders');
  const [rows] = await pool.query(
    `SELECT id, user_id, plan, plan_name, minutes, amount, status, pay_type, trade_no, transaction_id, created_at
     FROM voice_orders ORDER BY id DESC LIMIT ? OFFSET ?`,
    [s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

// ---------- 个人虚拟支付配置（读取，脱敏） ----------
router.get('/vpay/config', async (req, res) => {
  const vpay = require('./vpay');
  const cfg = await vpay.getConfig();
  if (!cfg) return res.json({ ok: true, data: null });
  res.json({
    ok: true,
    data: {
      offer_id: cfg.offer_id,
      appid: cfg.appid,
      appkey_mask: cfg.appkey ? maskKey(cfg.appkey) : '',
      appsecret_mask: cfg.appsecret ? maskKey(cfg.appsecret) : '',
      product_single: cfg.product_single || '',
      product_monthly: cfg.product_monthly || '',
      product_yearly: cfg.product_yearly || '',
      notify_url: 'https://zblw.com.cn/cuoti/api/vpay/notify',
      configured: true
    }
  });
});

// ---------- 个人虚拟支付配置（保存） ----------
router.put('/vpay/config', async (req, res) => {
  const vpay = require('./vpay');
  const { offer_id, appid, appkey, appsecret, product_single, product_monthly, product_yearly } = req.body;
  if (!offer_id || !appid) {
    await pool.query("DELETE FROM settings WHERE key_name='vpay_config'");
    return res.json({ ok: true, disabled: true });
  }
  const old = await vpay.getConfig();
  const cfg = {
    offer_id, appid,
    appkey: (appkey && !String(appkey).includes('****')) ? appkey : (old ? old.appkey : ''),
    appsecret: (appsecret && !String(appsecret).includes('****')) ? appsecret : (old ? old.appsecret : ''),
    product_single: product_single || '',
    product_monthly: product_monthly || '',
    product_yearly: product_yearly || ''
  };
  if (!cfg.appkey) return res.json({ ok: false, error: '现网AppKey 必填（重填时保留****）' });
  await vpay.setConfig(cfg);
  res.json({ ok: true });
});

// ---------- 工具 ----------
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '****' + k.slice(-4);
  return k.slice(0, 4) + '****' + k.slice(-4);
}

module.exports = router;
