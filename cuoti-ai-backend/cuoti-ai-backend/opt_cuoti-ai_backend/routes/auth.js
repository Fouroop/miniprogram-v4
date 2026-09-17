const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');
const { userAuth } = require('../middleware/auth');

const router = express.Router();

// 登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, error: '请输入账号和密码' });
  const [rows] = await pool.query('SELECT * FROM users WHERE username=?', [username]);
  if (!rows.length) return res.json({ ok: false, error: '账号不存在' });
  const u = rows[0];
  if (!bcrypt.compareSync(password, u.password_hash)) return res.json({ ok: false, error: '密码错误' });
  const token = jwt.sign({ id: u.id, username: u.username, role: u.role }, config.jwt.userSecret, { expiresIn: config.jwt.userExpire });
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
    grade: u.grade, role: u.role, is_vip: u.is_vip, vip_expire: u.vip_expire,
    voice_minutes: Number(u.voice_minutes || 0), voice_expire: u.voice_expire
  };
}

module.exports = router;
