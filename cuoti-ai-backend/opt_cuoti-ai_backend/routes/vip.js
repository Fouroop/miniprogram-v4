const express = require('express');
const pool = require('../db/pool');
const { userAuth } = require('../middleware/auth');

const router = express.Router();
router.use(userAuth);

const PLANS = [
  { plan: 'single', name: '单次辅导', amount: 9.9, duration_days: 1, desc: '1次AI文字辅导' },
  { plan: 'monthly', name: '月度会员', amount: 39, duration_days: 30, desc: '30天不限次辅导' },
  { plan: 'yearly', name: '年度会员', amount: 199, duration_days: 365, desc: '365天不限次辅导' }
];

router.get('/plans', (req, res) => {
  res.json({ ok: true, data: PLANS });
});

// 创建订单（演示环境直接模拟支付成功并开通）
router.post('/order', async (req, res) => {
  const { plan } = req.body;
  const p = PLANS.find(x => x.plan === plan);
  if (!p) return res.json({ ok: false, error: '套餐不存在' });
  const [r] = await pool.query(
    'INSERT INTO vip_orders (user_id, plan, amount, status) VALUES (?,?,?,?)',
    [req.user.id, p.plan, p.amount, 'paid']
  );
  // 直接开通 VIP
  const expire = new Date(Date.now() + p.duration_days * 24 * 3600 * 1000);
  await pool.query('UPDATE users SET is_vip=1, vip_expire=? WHERE id=?', [expire, req.user.id]);
  res.json({ ok: true, data: { order_id: r.insertId, status: 'paid', vip_expire: expire } });
});

// 激活码激活
router.post('/activate', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ ok: false, error: '请输入激活码' });
  const [rows] = await pool.query('SELECT * FROM vip_codes WHERE code=?', [code]);
  if (!rows.length) return res.json({ ok: false, error: '激活码无效' });
  const c = rows[0];
  if (c.used) return res.json({ ok: false, error: '激活码已被使用' });
  const expire = new Date(Date.now() + c.duration_days * 24 * 3600 * 1000);
  await pool.query('UPDATE vip_codes SET used=1, used_by=?, used_at=NOW() WHERE id=?', [req.user.id, c.id]);
  await pool.query('UPDATE users SET is_vip=1, vip_expire=? WHERE id=?', [expire, req.user.id]);
  res.json({ ok: true, data: { vip_expire: expire } });
});

module.exports = router;
