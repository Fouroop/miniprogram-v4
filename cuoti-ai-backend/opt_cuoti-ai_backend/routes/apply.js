// routes/apply.js —— 用户申请（语音包开通 / 会员开通 / 注册通知），管理后台审批
// 类型：register（注册通知，微信登录自动产生） / voice（语音包开通） / vip（会员开通）
'use strict';
const express = require('express');
const pool = require('../db/pool');
const { userAuth } = require('../middleware/auth');

const router = express.Router();
router.use(userAuth);

const VIP_PLANS = [
  { plan: 'single', name: '单次辅导', amount: 9.9, duration_days: 1 },
  { plan: 'monthly', name: '月度会员', amount: 39, duration_days: 30 },
  { plan: 'yearly', name: '年度会员', amount: 199, duration_days: 365 }
];

// 提交申请（voice 语音包 / vip 会员）；同类型已有 pending 申请则提示勿重复
router.post('/', async (req, res) => {
  const { type, plan, remark } = req.body;
  if (!['voice', 'vip'].includes(type)) return res.json({ ok: false, error: '申请类型不正确' });
  let planName = '', amount = 0;
  if (type === 'voice') {
    const [plans] = await pool.query('SELECT * FROM voice_plans WHERE plan=? AND is_active=1', [plan]);
    if (!plans.length) return res.json({ ok: false, error: '语音套餐不存在' });
    planName = plans[0].name; amount = plans[0].price;
  } else {
    const p = VIP_PLANS.find(x => x.plan === plan);
    if (!p) return res.json({ ok: false, error: '会员套餐不存在' });
    planName = p.name; amount = p.amount;
  }
  const [dup] = await pool.query(
    'SELECT id FROM apply_records WHERE user_id=? AND type=? AND status="pending" LIMIT 1',
    [req.user.id, type]
  );
  if (dup.length) {
    return res.json({ ok: true, data: { duplicate: true, apply_id: dup[0].id }, tip: '你已有待审核的申请，请耐心等待管理员处理' });
  }
  const [r] = await pool.query(
    'INSERT INTO apply_records (user_id, type, plan, plan_name, amount, remark) VALUES (?,?,?,?,?,?)',
    [req.user.id, type, plan, planName, amount, String(remark || '').slice(0, 200)]
  );
  res.json({ ok: true, data: { apply_id: r.insertId } });
});

// 我的申请记录
router.get('/my', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, type, plan, plan_name, amount, status, remark, handled_at, created_at FROM apply_records WHERE user_id=? ORDER BY id DESC LIMIT 20',
    [req.user.id]
  );
  res.json({ ok: true, data: rows });
});

module.exports = router;
module.exports.VIP_PLANS = VIP_PLANS;
