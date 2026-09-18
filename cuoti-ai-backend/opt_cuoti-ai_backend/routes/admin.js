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
    `SELECT id, username, nickname, grade, role, is_vip, vip_expire, voice_mb, created_at FROM users WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

router.get('/users/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, nickname, grade, role, is_vip, vip_expire, voice_mb, created_at FROM users WHERE id=?', [req.params.id]);
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

// ---------- 语音包管理（流量模板：quota_mb 流量额度 + price 单价） ----------
// 套餐列表
router.get('/voice/plans', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM voice_plans ORDER BY price');
  res.json({ ok: true, data: rows });
});

// 新增套餐（流量模板）
router.post('/voice/plans', async (req, res) => {
  const { plan, name, quota_mb, price, duration_days, desc_text, hot } = req.body;
  if (!plan || !name || !quota_mb || !price) return res.json({ ok: false, error: '套餐标识/名称/流量额度/价格必填' });
  const qmb = parseInt(quota_mb);
  const [r] = await pool.query(
    'INSERT INTO voice_plans (plan, name, minutes, quota_mb, price, duration_days, desc_text, hot) VALUES (?,?,?,?,?,?,?,?)',
    [plan, name, qmb, qmb, parseFloat(price), parseInt(duration_days) || 30, desc_text || '', hot ? 1 : 0]
  );
  res.json({ ok: true, data: { id: r.insertId } });
});

// 更新套餐
router.put('/voice/plans/:id', async (req, res) => {
  const { plan, name, quota_mb, price, duration_days, desc_text, hot, is_active } = req.body;
  const qmb = parseInt(quota_mb || 0);
  await pool.query(
    'UPDATE voice_plans SET plan=?, name=?, minutes=?, quota_mb=?, price=?, duration_days=?, desc_text=?, hot=?, is_active=? WHERE id=?',
    [plan, name, qmb, qmb, parseFloat(price), parseInt(duration_days) || 30, desc_text || '', hot ? 1 : 0, is_active ? 1 : 0, req.params.id]
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
    `SELECT id, username, nickname, voice_mb, voice_expire, created_at FROM users WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

// 调整单个用户语音包（增减流量余额 / 延期），voice_mb 支持绝对值/增量
router.put('/voice/users/:id', async (req, res) => {
  const { voice_mb, voice_expire } = req.body;
  const [users] = await pool.query('SELECT voice_mb, voice_expire FROM users WHERE id=?', [req.params.id]);
  if (!users.length) return res.json({ ok: false, error: '用户不存在' });
  const u = users[0];
  // MySQL DECIMAL 读出为字符串，必须 parseFloat 再运算，否则 + 触发字符串拼接
  let newMb = parseFloat(u.voice_mb || 0);
  let newExpire = u.voice_expire || null;
  // voice_mb 支持两种语义：绝对值（>=0 时直接设置）或增量（delta 前缀 +/-）
  if (typeof voice_mb === 'number') {
    if (voice_mb >= 0) newMb = voice_mb;
    else newMb = Math.max(0, newMb + voice_mb);
  } else if (typeof voice_mb === 'string' && (voice_mb.startsWith('+') || voice_mb.startsWith('-'))) {
    newMb = Math.max(0, newMb + (parseFloat(voice_mb, 10) || 0));
  }
  // NaN 防护：解析失败时回退原余额，避免拼出 Unknown column 'NaN'
  if (Number.isNaN(newMb)) newMb = parseFloat(u.voice_mb || 0) || 0;
  // 保留 3 位小数
  newMb = Math.round(newMb * 1000) / 1000;
  if (voice_expire !== undefined) newExpire = voice_expire || null;
  await pool.query('UPDATE users SET voice_mb=?, voice_expire=? WHERE id=?', [newMb, newExpire, req.params.id]);
  res.json({ ok: true, data: { voice_mb: newMb, voice_expire: newExpire } });
});

// ---------- 流量统计：通话时长(分)/计费流量(扣减MB)/实际流量(字节MB) ----------
router.get('/voice/stats', async (req, res) => {
  const [today] = await pool.query(
    `SELECT COUNT(*) calls,
            COALESCE(SUM(seconds),0) seconds,
            COALESCE(SUM(billed_mb),0) billed,
            COALESCE(SUM(total_bytes),0) bytes
     FROM voice_calls WHERE created_at >= CURDATE()`
  );
  const [total] = await pool.query(
    `SELECT COUNT(*) calls,
            COALESCE(SUM(seconds),0) seconds,
            COALESCE(SUM(billed_mb),0) billed,
            COALESCE(SUM(total_bytes),0) bytes
     FROM voice_calls`
  );
  const mb = (b) => Math.round((Number(b) || 0) / 1024 / 1024 * 100) / 100;
  res.json({ ok: true, data: {
    today: {
      calls: today[0].calls,
      consume_minutes: Math.round(Number(today[0].seconds) / 60 * 10) / 10,   // 通话时长
      billed_mb: Number(today[0].billed),                                      // 计费流量（扣减MB）
      actual_mb: mb(today[0].bytes)                                             // 实际流量
    },
    total: {
      calls: total[0].calls,
      consume_minutes: Math.round(Number(total[0].seconds) / 60 * 10) / 10,
      billed_mb: Number(total[0].billed),
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
    `SELECT c.id, c.user_id, u.username, u.nickname, c.mistake_id, c.seconds, c.billed_mb,
            c.up_bytes, c.down_bytes, c.total_bytes, c.created_at
     FROM voice_calls c LEFT JOIN users u ON c.user_id=u.id
     WHERE ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  const mb = (b) => Math.round((Number(b) || 0) / 1024 / 1024 * 100) / 100;
  res.json({ ok: true, data: {
    list: rows.map(r => ({ ...r, billed_mb: Number(r.billed_mb || 0), actual_mb: mb(r.total_bytes), up_mb: mb(r.up_bytes), down_mb: mb(r.down_bytes) })),
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

// ================= 知识大纲管理（管理后台维护；小程序端只按年级匹配展示） =================

// 科目+年级概览（后台筛选用）
router.get('/knowledge/subjects', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT kp.subject, kp.grade, COUNT(DISTINCT kp.id) ch_count, COUNT(k2.id) kp_count
     FROM knowledge_points kp
     LEFT JOIN knowledge_points k2 ON k2.parent_id = kp.id AND k2.level=2
     WHERE kp.level=1
     GROUP BY kp.subject, kp.grade
     ORDER BY kp.subject, kp.grade`
  );
  res.json({ ok: true, data: rows });
});

// 章节列表（按科目/年级）
router.get('/knowledge/chapters', async (req, res) => {
  const { subject, grade } = req.query;
  let where = 'level=1';
  const params = [];
  if (subject) { where += ' AND subject=?'; params.push(subject); }
  if (grade) { where += ' AND grade=?'; params.push(grade); }
  const [rows] = await pool.query(
    `SELECT kp.*, (SELECT COUNT(*) FROM knowledge_points k2 WHERE k2.parent_id=kp.id) kp_count
     FROM knowledge_points kp WHERE ${where} ORDER BY sort, id`,
    params
  );
  res.json({ ok: true, data: rows });
});

// 新增章节
router.post('/knowledge/chapters', async (req, res) => {
  const { subject, grade, name } = req.body;
  if (!subject || !grade || !name) return res.json({ ok: false, error: '科目/年级/章节名必填' });
  const [[max]] = await pool.query(
    'SELECT COALESCE(MAX(sort),0) m FROM knowledge_points WHERE subject=? AND grade=? AND level=1',
    [subject, grade]
  );
  const [r] = await pool.query(
    'INSERT INTO knowledge_points (subject, grade, name, parent_id, level, sort) VALUES (?,?,?,0,1,?)',
    [subject, grade, name, (max.m || 0) + 1]
  );
  res.json({ ok: true, data: { id: r.insertId } });
});

// 修改章节
router.put('/knowledge/chapters/:id', async (req, res) => {
  const { name, grade, subject } = req.body;
  await pool.query('UPDATE knowledge_points SET name=?, grade=?, subject=? WHERE id=? AND level=1',
    [name, grade, subject, req.params.id]);
  res.json({ ok: true });
});

// 删除章节（级联删知识点 + 用户掌握记录）
router.delete('/knowledge/chapters/:id', async (req, res) => {
  const chId = parseInt(req.params.id);
  await pool.query('DELETE FROM user_knowledge WHERE kp_id IN (SELECT id FROM knowledge_points WHERE parent_id=?)', [chId]);
  await pool.query('DELETE FROM knowledge_points WHERE parent_id=?', [chId]);
  await pool.query('DELETE FROM knowledge_points WHERE id=?', [chId]);
  res.json({ ok: true });
});

// 章节下的知识点列表
router.get('/knowledge/kps', async (req, res) => {
  const { chapter_id } = req.query;
  if (!chapter_id) return res.json({ ok: false, error: '缺少章节ID' });
  const [rows] = await pool.query(
    'SELECT id, name, sort FROM knowledge_points WHERE parent_id=? ORDER BY sort, id', [parseInt(chapter_id)]
  );
  res.json({ ok: true, data: rows });
});

// 新增知识点
router.post('/knowledge/kps', async (req, res) => {
  const { chapter_id, name } = req.body;
  if (!chapter_id || !name) return res.json({ ok: false, error: '章节ID/知识点名必填' });
  const [ch] = await pool.query('SELECT subject, grade FROM knowledge_points WHERE id=? AND level=1', [parseInt(chapter_id)]);
  if (!ch.length) return res.json({ ok: false, error: '章节不存在' });
  const [[max]] = await pool.query('SELECT COALESCE(MAX(sort),0) m FROM knowledge_points WHERE parent_id=?', [parseInt(chapter_id)]);
  const [r] = await pool.query(
    'INSERT INTO knowledge_points (subject, grade, name, parent_id, level, sort) VALUES (?,?,?,?,2,?)',
    [ch[0].subject, ch[0].grade, name, parseInt(chapter_id), (max.m || 0) + 1]
  );
  res.json({ ok: true, data: { id: r.insertId } });
});

// 批量新增知识点（一个章节一次贴多行）
router.post('/knowledge/kps/batch', async (req, res) => {
  const { chapter_id, names } = req.body;
  if (!chapter_id || !Array.isArray(names) || !names.length) return res.json({ ok: false, error: '章节ID/知识点列表必填' });
  const [ch] = await pool.query('SELECT subject, grade FROM knowledge_points WHERE id=? AND level=1', [parseInt(chapter_id)]);
  if (!ch.length) return res.json({ ok: false, error: '章节不存在' });
  const [[max]] = await pool.query('SELECT COALESCE(MAX(sort),0) m FROM knowledge_points WHERE parent_id=?', [parseInt(chapter_id)]);
  let sort = (max.m || 0);
  let added = 0;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const n of names) {
      const name = String(n || '').trim();
      if (!name) continue;
      sort++;
      await conn.query(
        'INSERT INTO knowledge_points (subject, grade, name, parent_id, level, sort) VALUES (?,?,?,?,2,?)',
        [ch[0].subject, ch[0].grade, name, parseInt(chapter_id), sort]
      );
      added++;
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  res.json({ ok: true, data: { added } });
});

// 修改知识点
router.put('/knowledge/kps/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.json({ ok: false, error: '知识点名不能为空' });
  await pool.query('UPDATE knowledge_points SET name=? WHERE id=? AND level=2', [name, req.params.id]);
  res.json({ ok: true });
});

// 删除知识点（级联删用户掌握记录）
router.delete('/knowledge/kps/:id', async (req, res) => {
  await pool.query('DELETE FROM user_knowledge WHERE kp_id=?', [req.params.id]);
  await pool.query('DELETE FROM knowledge_points WHERE id=? AND level=2', [req.params.id]);
  res.json({ ok: true });
});

// ================= 火山豆包语音用量·实时统计（系统实测口径） =================
// 费用估算模型（豆包端到端实时语音大模型 Seeduplex 官方后付费单价）：
//   输入音频 80元/百万token（1秒≈6.25 token）、输出音频 300元/百万token（1秒≈25 token）
//   输出文本 80元/百万token（1秒播报≈5 token）；输入文本少量忽略
// 双向时长假设：用户说 40% / AI 说 60%（讲题场景 AI 输出偏长）
const SEEDUPLEX = {
  inPerSecToken: 6.25, inPricePerM: 80,
  outPerSecToken: 25,  outPricePerM: 300,
  outTextPerSecToken: 5, outTextPricePerM: 80,
  userRatio: 0.4, aiRatio: 0.6
};
function estimateVoiceCost(sec) {
  const s = Math.max(0, sec || 0);
  const inSec = s * SEEDUPLEX.userRatio, outSec = s * SEEDUPLEX.aiRatio;
  const inTok = inSec * SEEDUPLEX.inPerSecToken;
  const outTok = outSec * SEEDUPLEX.outPerSecToken;
  const outTextTok = outSec * SEEDUPLEX.outTextPerSecToken;
  return {
    yuan: Math.round((inTok * SEEDUPLEX.inPricePerM + outTok * SEEDUPLEX.outPricePerM + outTextTok * SEEDUPLEX.outTextPricePerM) / 1e6 * 10000) / 10000,
    inputTokens: Math.round(inTok), outputTokens: Math.round(outTok),
    inYuan: Math.round(inTok * SEEDUPLEX.inPricePerM / 1e6 * 10000) / 10000,
    outYuan: Math.round((outTok * SEEDUPLEX.outPricePerM + outTextTok * SEEDUPLEX.outTextPricePerM) / 1e6 * 10000) / 10000
  };
}
router.get('/volc/usage', async (req, res) => {
  const row = async (startSql) => {
    const [r] = await pool.query(
      `SELECT COUNT(*) calls, COALESCE(SUM(seconds),0) sec, COALESCE(SUM(total_bytes),0) bytes,
              COALESCE(SUM(up_bytes),0) up, COALESCE(SUM(down_bytes),0) down, COALESCE(SUM(billed_mb),0) billed
       FROM voice_calls WHERE created_at >= ${startSql}`
    );
    const mb = (b) => Math.round((Number(b) || 0) / 1024 / 1024 * 100) / 100;
    const cost = estimateVoiceCost(r[0].sec);
    return {
      calls: r[0].calls, minutes: Math.round(Number(r[0].sec) / 60 * 10) / 10,
      trafficMb: mb(r[0].bytes), upMb: mb(r[0].up), downMb: mb(r[0].down),
      billedMb: Number(r[0].billed) || 0,
      costYuan: cost.yuan, inYuan: cost.inYuan, outYuan: cost.outYuan,
      inputTokens: cost.inputTokens, outputTokens: cost.outputTokens
    };
  };
  res.json({ ok: true, data: {
    today: await row("CURDATE()"),
    month: await row("DATE_FORMAT(NOW(),'%Y-%m-01')"),
    model: {
      name: '豆包端到端实时语音大模型（Seeduplex）',
      pricePerMin: 0.30,
      inPrice: '80元/百万token(输入音频)', outPrice: '300元/百万token(输出音频)',
      note: '按 voice_calls 实测时长/流量换算，官方账单以费用中心为准'
    }
  }});
});

// ================= 火山主账号配置（AK/SK 加密存储，仅掩码返回） =================
router.get('/volc/account', async (req, res) => {
  const volc = require('../utils/volc');
  const cfg = await volc.getAccount();
  if (!cfg || !cfg.access_key) return res.json({ ok: true, data: { configured: false } });
  res.json({ ok: true, data: {
    configured: true,
    user_name: cfg.user_name || '',
    account_id: cfg.account_id || '',
    access_key: cfg.access_key,
    ak_mask: (cfg.access_key || '').slice(0, 4) + '****' + (cfg.access_key || '').slice(-4)
  }});
});
router.put('/volc/account', async (req, res) => {
  const volc = require('../utils/volc');
  const { user_name, account_id, access_key, secret_key } = req.body || {};
  if (!access_key || !secret_key) return res.json({ ok: false, error: 'Access Key / Secret Key 必填' });
  await volc.setAccount({ user_name: user_name || '', account_id: account_id || '', access_key: access_key.trim(), secret_key: secret_key.trim() });
  res.json({ ok: true, data: { configured: true } });
});

// ================= 火山官方账单与余额（需已配置 AK/SK） =================
router.get('/volc/billing', async (req, res) => {
  const volc = require('../utils/volc');
  const cfg = await volc.getAccount();
  if (!cfg || !cfg.access_key) return res.json({ ok: false, error: '未配置火山主账号 AK/SK' });
  const ak = cfg.access_key, sk = volc.decrypt(cfg.secret_key);
  if (!sk) return res.json({ ok: false, error: '密钥解密失败，请重新配置' });
  const now = new Date();
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const months = [ym(now), ym(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ym(new Date(now.getFullYear(), now.getMonth() - 2, 1))];
  try {
    const [balance, ...bills] = await Promise.all([
      volc.fetchBalance(ak, sk),
      ...months.map(m => volc.fetchBillByMonth(ak, sk, m).catch(e => ({ __error: e.message })))
    ]);
    const monthData = months.map((m, i) => {
      const b = bills[i];
      if (b && b.__error) return { month: m, error: b.__error };
      const rows = b || [];
      return {
        month: m,
        totalYuan: Math.round(rows.reduce((s, x) => s + (x.amount || 0), 0) * 100) / 100,
        pretaxYuan: Math.round(rows.reduce((s, x) => s + (x.pretaxAmount || 0), 0) * 100) / 100,
        discountYuan: Math.round(rows.reduce((s, x) => s + (x.discountAmount || 0), 0) * 100) / 100,
        byProduct: rows.slice(0, 20)
      };
    });
    res.json({ ok: true, data: { balance, months: monthData } });
  } catch (e) {
    res.json({ ok: false, error: '调用火山费用中心失败：' + e.message });
  }
});

// ---------- 工具 ----------
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '****' + k.slice(-4);
  return k.slice(0, 4) + '****' + k.slice(-4);
}

module.exports = router;
