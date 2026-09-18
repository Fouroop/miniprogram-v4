// routes/voice.js —— 语音包（按量计费 + 流量统计 + 微信支付）
const express = require('express');
const pool = require('../db/pool');
const { userAuth } = require('../middleware/auth');
const wxpay = require('./wxpay');

const router = express.Router();

// ---------- 管理员微信（语音包人工开通） ----------
router.get('/admin-contact', userAuth, async (req, res) => {
  const config = require('../config');
  res.json({
    ok: true,
    data: {
      wechat: config.adminWechat || '',
      tips: '添加管理员微信，备注“开通语音包+昵称”，管理员确认后为你开通分钟数'
    }
  });
});

// ================= 以下路由不挂 userAuth（独立鉴权） =================

// ---------- 语音代理流量上报（内网，X-Report-Key 鉴权） ----------
router.post('/call-report', async (req, res) => {
  const key = req.headers['x-report-key'] || '';
  if (key !== process.env.REPORT_KEY && key !== 'voice-report-2026') {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const { token, call_id, seconds, up_bytes, down_bytes, total_bytes } = req.body || {};
  if (!token) return res.json({ ok: false, error: '缺少 token' });
  // 解析用户 token
  const jwt = require('jsonwebtoken');
  const config = require('../config');
  let userId = null;
  try {
    const d = jwt.verify(token, config.jwt.userSecret);
    userId = d.id;
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'token 无效' });
  }
  const sec = Math.max(0, parseInt(seconds) || 0);
  const up = Math.max(0, parseInt(up_bytes) || 0);
  const down = Math.max(0, parseInt(down_bytes) || 0);
  const total = Math.max(0, parseInt(total_bytes) || (up + down));
  if (sec <= 0 && total <= 0) return res.json({ ok: true, data: { skipped: true } });

  if (call_id) {
    // v3：按 call_id 幂等合并——同一通话只留一条记录，代理只补字节，不覆盖已计费分钟
    await pool.query(
      `INSERT INTO voice_calls (call_id, user_id, seconds, up_bytes, down_bytes, total_bytes)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         up_bytes = VALUES(up_bytes),
         down_bytes = VALUES(down_bytes),
         total_bytes = VALUES(total_bytes)`,
      [call_id, userId, sec, up, down, total]
    );
  } else {
    // 兼容旧客户端（无 call_id）：沿用 90 秒内补最近一条 total_bytes=0 记录的逻辑
    const [pending] = await pool.query(
      `SELECT id FROM voice_calls WHERE user_id=? AND total_bytes=0 AND created_at > NOW() - INTERVAL 90 SECOND ORDER BY id DESC LIMIT 1`,
      [userId]
    );
    if (pending.length) {
      await pool.query(
        'UPDATE voice_calls SET up_bytes=?, down_bytes=?, total_bytes=? WHERE id=?',
        [up, down, total, pending[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO voice_calls (user_id, seconds, up_bytes, down_bytes, total_bytes) VALUES (?,?,?,?,?)',
        [userId, sec, up, down, total]
      );
    }
  }
  res.json({ ok: true, data: { recorded: true } });
});

// ---------- 微信支付回调（微信服务器调用，验签保护） ----------
router.post('/wxpay/notify', async (req, res) => {
  const result = await wxpay.handleNotify(req);
  res.status(result.code || 200).json(result.body);
});

// ================= 以下路由需要用户登录 =================
router.use(userAuth);

// ---------- 套餐列表（3档，按流量配额） ----------
router.get('/plans', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT plan, name, quota_mb, minutes, price, duration_days, desc_text, hot FROM voice_plans WHERE is_active=1 ORDER BY price'
  );
  res.json({ ok: true, data: rows });
});

// ---------- 余额查询（实时，按流量 MB） ----------
router.get('/balance', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT voice_mb, voice_expire FROM users WHERE id=?', [req.user.id]
  );
  const u = rows[0];
  if (!u) return res.json({ ok: false, error: '用户不存在' });
  const now = new Date();
  const expired = u.voice_expire && new Date(u.voice_expire) < now;
  const mb = Number(u.voice_mb || 0);
  res.json({
    ok: true,
    data: {
      mb: expired ? 0 : mb,
      minutes: expired ? 0 : mb, // 兼容字段（旧前端按分钟显示），新前端用 mb
      expire: expired ? null : u.voice_expire,
      status: expired ? 'expired' : (mb > 0 ? 'active' : 'empty')
    }
  });
});

// ---------- 购买语音包（流量模板，人工开通走 /voice/admin-contact） ----------
router.post('/order', async (req, res) => {
  const { plan } = req.body;
  const [plans] = await pool.query('SELECT * FROM voice_plans WHERE plan=? AND is_active=1', [plan]);
  if (!plans.length) return res.json({ ok: false, error: '套餐不存在' });
  const p = plans[0];

  const [r] = await pool.query(
    'INSERT INTO voice_orders (user_id, plan, plan_name, minutes, amount, status, pay_type) VALUES (?,?,?,?,?,?,?)',
    [req.user.id, p.plan, p.name, p.quota_mb || p.minutes, p.price, 'paid', 'simulate']
  );
  await grantVoiceMb(req.user.id, p.quota_mb || p.minutes, p.duration_days);
  res.json({ ok: true, data: { order_id: r.insertId, status: 'paid', pay_type: 'simulate' } });
});

// ---------- 微信支付：查询是否已配置正式收款 ----------
router.get('/wxpay/status', async (req, res) => {
  const cfg = await wxpay.getConfig();
  res.json({ ok: true, data: { enabled: !!cfg, mode: cfg ? 'wxpay' : 'simulate' } });
});

// ---------- 微信支付：JSAPI 下单（小程序端拉起支付） ----------
router.post('/wxpay/prepay', async (req, res) => {
  const { plan, code } = req.body;
  const result = await wxpay.prepay(req.user, plan, code);
  if (!result.ok) return res.json({ ok: false, error: result.error });
  res.json({ ok: true, data: result.data });
});

// ---------- 通话开始前校验余额（按流量） ----------
router.post('/start', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT voice_mb, voice_expire FROM users WHERE id=?', [req.user.id]
  );
  const u = rows[0];
  if (!u) return res.json({ ok: false, error: '用户不存在' });
  const now = new Date();
  const expired = u.voice_expire && new Date(u.voice_expire) < now;
  // 业务校验返回 allow:false（而非 ok:false），前端据此弹"去开通"，不触发统一错误 toast
  if (expired || parseFloat(u.voice_mb || 0) <= 0) {
    return res.json({ ok: true, data: { allow: false, mb: 0, reason: expired ? 'expired' : 'empty' } });
  }
  res.json({ ok: true, data: { allow: true, mb: Number(u.voice_mb || 0) } });
});

// 语音流量估算速率：无实测字节时的兜底（16kHz/16bit/单声道 ≈ 1.83 MB/min，取 2MB/min）
const EST_MB_PER_MIN = 2;

// ---------- 通话结束：按流量扣减 + 落通话明细 ----------
router.post('/end', async (req, res) => {
  const { seconds, mistake_id, call_id } = req.body;
  const sec = Math.max(0, Math.min(7200, parseInt(seconds) || 0));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // 锁用户行，防止并发 /end 重复扣费
    const [rows] = await conn.query(
      'SELECT voice_mb, voice_expire FROM users WHERE id=? FOR UPDATE', [req.user.id]
    );
    const u = rows[0];
    if (!u) { await conn.rollback(); return res.json({ ok: false, error: '用户不存在' }); }

    const now = new Date();
    const expired = u.voice_expire && new Date(u.voice_expire) < now;
    if (expired || parseFloat(u.voice_mb || 0) <= 0) {
      await conn.rollback();
      return res.json({ ok: true, data: { deducted: 0, mb: 0, status: 'empty' } });
    }

    // 幂等：按 call_id 查已有明细（代理可能已先上报实测流量）
    let existing = null;
    if (call_id) {
      const [cs] = await conn.query('SELECT * FROM voice_calls WHERE call_id=? AND user_id=?', [call_id, req.user.id]);
      existing = cs[0] || null;
      // 该通话已计费过 → 不重复扣
      if (existing && parseFloat(existing.billed_mb || 0) > 0) {
        await conn.rollback();
        return res.json({ ok: true, data: { deducted: 0, mb: Number(u.voice_mb), status: 'already-billed' } });
      }
    }

    // 计费流量（MB）：优先用代理上报实测 total_bytes（后台流量统计口径），否则按通话秒数估算
    let billingBytes = existing && parseInt(existing.total_bytes) > 0 ? parseInt(existing.total_bytes) : 0;
    if (billingBytes <= 0 && sec > 0) {
      billingBytes = Math.round(sec / 60 * EST_MB_PER_MIN * 1024 * 1024);
    }
    if (billingBytes <= 0) { await conn.rollback(); return res.json({ ok: true, data: { deducted: 0 } }); }

    // 按流量扣：bytes → MB（保留 3 位小数）
    const deductMb = +(billingBytes / 1024 / 1024).toFixed(3);
    const cur = parseFloat(u.voice_mb || 0);
    const left = Math.max(0, +(cur - deductMb).toFixed(3));
    await conn.query('UPDATE users SET voice_mb=? WHERE id=?', [left, req.user.id]);

    // 落通话明细：有记录则补计费流量与错题关联（仅当未计费），无则插入
    const mid = parseInt(mistake_id) || null;
    const billingSec = existing && parseInt(existing.seconds) > 0 ? Math.min(7200, parseInt(existing.seconds)) : sec;
    if (existing) {
      await conn.query(
        'UPDATE voice_calls SET mistake_id=?, billed_minutes=?, billed_mb=? WHERE id=? AND billed_mb=0',
        [mid, Math.ceil(billingSec / 6) / 10, deductMb, existing.id]
      );
    } else {
      await conn.query(
        'INSERT INTO voice_calls (call_id, user_id, mistake_id, seconds, total_bytes, billed_minutes, billed_mb) VALUES (?,?,?,?,?,?,?)',
        [call_id || null, req.user.id, mid, billingSec, billingBytes, Math.ceil(billingSec / 6) / 10, deductMb]
      );
    }
    await conn.commit();
    res.json({ ok: true, data: { deducted: deductMb, mb: Number(left) } });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// ---------- 工具 ----------
async function grantVoiceMb(userId, quotaMb, durationDays) {
  const [users] = await pool.query('SELECT voice_mb, voice_expire FROM users WHERE id=?', [userId]);
  const u = users[0];
  const now = Date.now();
  const curExpire = (u.voice_expire && new Date(u.voice_expire) > now) ? new Date(u.voice_expire).getTime() : now;
  const newExpire = curExpire + durationDays * 24 * 3600 * 1000;
  const newMb = parseFloat(u.voice_mb || 0) + parseFloat(quotaMb || 0);
  await pool.query('UPDATE users SET voice_mb=?, voice_expire=? WHERE id=?', [newMb, new Date(newExpire), userId]);
  return { voice_mb: newMb, voice_expire: new Date(newExpire) };
}

module.exports = router;
module.exports.grantVoiceMb = grantVoiceMb;
module.exports.grantVoiceMinutes = grantVoiceMb; // 兼容旧引用
