const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const config = require('../config');
const { userAuth } = require('../middleware/auth');

const router = express.Router();

// ---------- 预置错题（各科示例） ----------
// 注册或首次登录（用户还没有任何错题）时自动写入，让新用户一进来就有各科题目可练
const PRESET_MISTAKES = [
  // 数学
  { subject: '数学', tag: '二次函数', stem: '已知二次函数 y = x² - 4x + 3，求它的顶点坐标和对称轴。',
    answer: '顶点 (2, -1)，对称轴 x = 2', wrong_answer: '顶点 (-4, 3)',
    reason: '没掌握配方法：y=(x-2)²-1 可直接读出顶点与对称轴' },
  { subject: '数学', tag: '不等式', stem: '解不等式：2x - 5 > 3(x + 1)',
    answer: 'x < -8', wrong_answer: 'x > -8',
    reason: '展开移项后两边同乘 -1 时忘记变号' },
  { subject: '数学', tag: '二次根式', stem: '计算：√12 - √(1/3) + √27',
    answer: '14√3 / 3', wrong_answer: '4√3',
    reason: '√(1/3) 化简错误，应为 √3/3' },
  // 物理
  { subject: '物理', tag: '动能', stem: '一个质量为 2kg 的物体以 3m/s 的速度在水平面上运动，求它的动能。',
    answer: '9 J（Ek = ½mv² = ½×2×3² = 9）', wrong_answer: '18 J',
    reason: '动能公式漏了前面的 1/2' },
  { subject: '物理', tag: '欧姆定律', stem: '某导体两端电压为 6V，通过的电流为 0.5A，求该导体的电阻。',
    answer: '12 Ω（R = U/I = 6/0.5 = 12）', wrong_answer: '3 Ω',
    reason: '把欧姆定律记成了 R = U×I' },
  // 化学
  { subject: '化学', tag: '化学方程式', stem: '写出高锰酸钾受热分解制取氧气的化学方程式并配平。',
    answer: '2KMnO₄ =△= K₂MnO₄ + MnO₂ + O₂↑', wrong_answer: 'KMnO₄ = K₂MnO₄ + MnO₂ + O₂',
    reason: '没配平，且漏写气体上升符号' },
  { subject: '化学', tag: '化学计算', stem: '计算 H₂O 中氢元素的质量分数（相对原子质量 H=1，O=16）。',
    answer: '约 11.1%（2÷18×100%）', wrong_answer: '约 5.6%',
    reason: '分母应取水的相对分子质量 18，而不是氢原子个数 2' },
  // 语文
  { subject: '语文', tag: '古诗词默写', stem: '默写填空："会当凌绝顶，______。"（杜甫《望岳》）',
    answer: '一览众山小', wrong_answer: '一览众山小矣',
    reason: '背诵不准确，多写或少写了字' },
  { subject: '语文', tag: '病句修改', stem: '修改病句：通过这次活动，使我明白了团结合作的重要性。',
    answer: '删除"通过"或"使"，如：通过这次活动，我明白了团结合作的重要性。', wrong_answer: '这次活动，使我明白了团结合作的重要性。',
    reason: '没识别出介词滥用导致主语残缺' },
  // 英语
  { subject: '英语', tag: '一般现在时', stem: '用所给词的适当形式填空：She ______ (go) to school by bus every day.',
    answer: 'goes（一般现在时，主语第三人称单数）', wrong_answer: 'go',
    reason: '漏掉第三人称单数动词加 -es' },
  { subject: '英语', tag: '主谓一致', stem: '单项选择：There ______ some milk in the glass. A. is  B. are  C. be',
    answer: 'A（milk 为不可数名词，be 动词用 is）', wrong_answer: 'B',
    reason: '看到 some 就选复数，没判断 milk 不可数' }
];

// 用户还没有任何错题时，写入预置题目；返回写入条数
async function ensurePresetMistakes(userId) {
  const [[cnt]] = await pool.query('SELECT COUNT(*) c FROM mistakes WHERE user_id=?', [userId]);
  if (Number(cnt.c || 0) > 0) return 0;
  const nextReview = new Date(Date.now() + 24 * 3600 * 1000);
  const rows = PRESET_MISTAKES.map((m) => [
    userId, m.stem, m.answer, m.wrong_answer, m.reason, m.subject, m.tag,
    '未掌握', '预置', nextReview, 0
  ]);
  const [r] = await pool.query(
    `INSERT INTO mistakes (user_id, stem, answer, wrong_answer, reason, subject, tag, status, source, next_review, review_count)
     VALUES ?`,
    [rows]
  );
  return r.affectedRows;
}

// 微信一键登录/注册：code 换 openid，首次自动注册，返回 token + user
// 需要服务器 .env 配置 WX_APPID / WX_APPSECRET
router.post('/wxlogin', async (req, res) => {
  const { code, nickname, avatar_base64 } = req.body;
  if (!code) return res.json({ ok: false, error: '缺少微信登录凭证' });
  const appid = process.env.WX_APPID || '';
  const secret = process.env.WX_APPSECRET || '';
  if (!appid || !secret) {
    return res.json({ ok: false, error: '微信登录未配置：请在服务器 .env 设置 WX_APPID 与 WX_APPSECRET' });
  }
  let openid = '';
  try {
    const url = 'https://api.weixin.qq.com/sns/jscode2session?appid=' + appid +
      '&secret=' + secret + '&js_code=' + encodeURIComponent(code) + '&grant_type=authorization_code';
    const r = await fetch(url);
    const j = await r.json();
    if (!j.openid) {
      return res.json({ ok: false, error: '微信登录失败：' + (j.errmsg || 'code 无效或已过期') });
    }
    openid = j.openid;
  } catch (e) {
    return res.json({ ok: false, error: '微信登录服务异常' });
  }

  // 头像 base64 → 存文件
  let avatarUrl = '';
  if (avatar_base64) {
    try {
      const buf = Buffer.from(avatar_base64, 'base64');
      const dir = path.join(__dirname, '..', 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const fname = 'avatar_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '.png';
      fs.writeFileSync(path.join(dir, fname), buf);
      const publicBase = process.env.PUBLIC_BASE || 'https://zblw.com.cn/cuoti';
      avatarUrl = publicBase + '/uploads/' + fname;
    } catch (e) { /* 头像保存失败不影响登录 */ }
  }

  let [rows] = await pool.query('SELECT * FROM users WHERE openid=?', [openid]);
  let user;
  let isNew = false;
  if (rows.length) {
    user = rows[0];
    const up = [];
    const params = [];
    if (nickname) { up.push('nickname=?'); params.push(String(nickname).slice(0, 32)); }
    if (avatarUrl) { up.push('avatar=?'); params.push(avatarUrl); }
    if (up.length) {
      params.push(user.id);
      await pool.query('UPDATE users SET ' + up.join(',') + ' WHERE id=?', params);
      if (nickname) user.nickname = String(nickname).slice(0, 32);
      if (avatarUrl) user.avatar = avatarUrl;
    }
  } else {
    // 新用户注册：用户名取 openid 尾 8 位，冲突则加随机后缀
    let username = 'wx_' + openid.slice(-8);
    const [dup] = await pool.query('SELECT id FROM users WHERE username=?', [username]);
    if (dup.length) username = username + '_' + Math.floor(Math.random() * 10000);
    const passwordHash = await bcrypt.hash('wx' + openid, 10);
    const [r] = await pool.query(
      'INSERT INTO users (username, password_hash, nickname, avatar, role, openid) VALUES (?,?,?,?,?,?)',
      [username, passwordHash, nickname ? String(nickname).slice(0, 32) : '微信用户', avatarUrl, 'student', openid]
    );
    user = { id: r.insertId, username, nickname: nickname ? String(nickname).slice(0, 32) : '微信用户', avatar: avatarUrl, role: 'student' };
    await ensurePresetMistakes(user.id);
    // 新用户注册通知管理后台（register 申请，管理员在"申请管理"处理）
    await pool.query(
      "INSERT INTO apply_records (user_id, type, plan_name, remark) VALUES (?, 'register', ?, ?)",
      [user.id, (nickname ? String(nickname).slice(0, 32) : '微信用户'), '微信新用户注册']
    );
    isNew = true;
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.jwt.userSecret,
    { expiresIn: '30d' }
  );
  res.json({
    ok: true,
    data: {
      token,
      isNew,
      user: { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar, role: user.role }
    }
  });
});

// 更新个人资料（昵称/头像/年级/电话），微信登录后随时可补
router.post('/update-profile', userAuth, async (req, res) => {
  const { nickname, avatar_base64, grade, phone } = req.body;
  const userId = req.user.id;
  const up = [];
  const params = [];
  if (avatar_base64) {
    try {
      const buf = Buffer.from(avatar_base64, 'base64');
      const dir = path.join(__dirname, '..', 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const fname = 'avatar_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '.png';
      fs.writeFileSync(path.join(dir, fname), buf);
      const publicBase = process.env.PUBLIC_BASE || 'https://zblw.com.cn/cuoti';
      up.push('avatar=?');
      params.push(publicBase + '/uploads/' + fname);
    } catch (e) { /* 头像保存失败不阻塞资料更新 */ }
  }
  if (nickname && String(nickname).trim()) {
    up.push('nickname=?');
    params.push(String(nickname).trim().slice(0, 32));
  }
  // 年级：允许空串（清空），仅当字段被显式传入
  if (grade !== undefined && grade !== null) {
    up.push('grade=?');
    params.push(String(grade).trim().slice(0, 16));
  }
  // 电话：11 位手机号校验；仅存脱敏尾号 phone_last4，同时保留原文供展示
  if (phone !== undefined && phone !== null) {
    const p = String(phone).trim();
    if (p && !/^1\d{10}$/.test(p)) {
      return res.json({ ok: false, error: '请输入正确的11位手机号' });
    }
    up.push('phone=?');
    params.push(p.slice(0, 20));
    up.push('phone_last4=?');
    params.push(p ? p.slice(-4) : '');
  }
  if (!up.length) return res.json({ ok: false, error: '没有需要更新的内容' });
  params.push(userId);
  await pool.query('UPDATE users SET ' + up.join(',') + ' WHERE id=?', params);
  const [rows] = await pool.query('SELECT * FROM users WHERE id=?', [userId]);
  res.ok(pickUser(rows[0]));
});

// 登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, error: '请输入账号和密码' });
  const [rows] = await pool.query('SELECT * FROM users WHERE username=?', [username]);
  if (!rows.length) return res.json({ ok: false, error: '账号不存在' });
  const u = rows[0];
  if (!bcrypt.compareSync(password, u.password_hash)) return res.json({ ok: false, error: '密码错误' });
  const token = jwt.sign({ id: u.id, username: u.username, role: u.role }, config.jwt.userSecret, { expiresIn: config.jwt.userExpire });
  // 老用户空错题本也补上预置题目
  try { await ensurePresetMistakes(u.id); } catch (e) { console.error('[auth] ensurePresetMistakes error:', e); }
  res.json({ ok: true, data: { token, user: pickUser(u) } });
});

// 注册
router.post('/register', async (req, res) => {
  const { username, password, nickname, grade } = req.body;
  if (!username || !password) return res.json({ ok: false, error: '账号和密码必填' });
  const [exists] = await pool.query('SELECT id FROM users WHERE username=?', [username]);
  if (exists.length) return res.json({ ok: false, error: '账号已被注册' });
  const hash = bcrypt.hashSync(password, 10);
  const [r] = await pool.query(
    'INSERT INTO users (username, password_hash, nickname, grade, role) VALUES (?,?,?,?,\'student\')',
    [username, hash, nickname || username, grade || '']
  );
  const token = jwt.sign({ id: r.insertId, username, role: 'student' }, config.jwt.userSecret, { expiresIn: config.jwt.userExpire });
  // 新用户自动预置各科题目
  try { await ensurePresetMistakes(r.insertId); } catch (e) { console.error('[auth] ensurePresetMistakes error:', e); }
  // 注册通知管理后台
  await pool.query(
    "INSERT INTO apply_records (user_id, type, plan_name, remark) VALUES (?, 'register', ?, '账号密码注册')",
    [r.insertId, nickname || username]
  );
  res.json({ ok: true, data: { token, user: { id: r.insertId, username, nickname: nickname || username, grade: grade || '', is_vip: 0, voice_minutes: 0, voice_expire: null } } });
});

// 当前用户
router.get('/me', userAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!rows.length) return res.json({ ok: false, error: '用户不存在' });
  res.json({ ok: true, data: pickUser(rows[0]) });
});

function pickUser(u) {
  return {
    id: u.id, username: u.username, nickname: u.nickname, avatar: u.avatar,
    grade: u.grade, phone: u.phone || '', phone_last4: u.phone_last4 || '',
    role: u.role, is_vip: u.is_vip, vip_expire: u.vip_expire,
    voice_minutes: Number(u.voice_minutes || 0), voice_expire: u.voice_expire
  };
}

module.exports = router;
