// routes/api_access.js —— 个人 API（授权码读写当前账号的错题/题库/资料）
// 鉴权：X-Api-Token: cu_xxx（「我的-连接AI」生成），仅能读写 token 对应用户的数据
const express = require('express');
const pool = require('../db/pool');
const { apiTokenAuth } = require('../middleware/auth');

const router = express.Router();
router.use(apiTokenAuth);

const MISTAKE_STATUSES = ['未掌握', '复习中', '已掌握'];
const QUESTION_SUBJECTS = ['数学', '物理', '化学', '语文', '英语'];
const QUESTION_GRADES = ['七年级', '八年级', '九年级'];
const QUESTION_DIFFS = ['容易', '中等', '较难'];

function escLike(s) { return String(s || '').replace(/[%_\\]/g, (c) => '\\' + c); }

// ---------- 我的资料 ----------
router.get('/profile', async (req, res) => {
  const u = req.user;
  const [[mis]] = await pool.query('SELECT COUNT(*) c FROM mistakes WHERE user_id=?', [u.id]);
  const [[mastered]] = await pool.query("SELECT COUNT(*) c FROM mistakes WHERE user_id=? AND status='已掌握'", [u.id]);
  const [[qs]] = await pool.query('SELECT COUNT(*) c FROM questions WHERE user_id=?', [u.id]);
  res.json({
    ok: true,
    data: {
      id: u.id,
      username: u.username,
      nickname: u.nickname || u.username,
      grade: u.grade || '',
      role: u.role,
      is_vip: !!u.is_vip,
      vip_expire: u.vip_expire || null,
      voice_minutes: u.voice_minutes || 0,
      voice_expire: u.voice_expire || null,
      stats: { mistakes: mis.c, mastered: mastered.c, questions: qs.c }
    }
  });
});

// ---------- 错题本 ----------
// GET /mistakes?subject=&status=&keyword=&page=&size=
router.get('/mistakes', async (req, res) => {
  const { subject, status, keyword } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(50, Math.max(1, parseInt(req.query.size) || 20));
  const where = ['user_id=?'];
  const params = [req.user.id];
  if (subject && subject !== '全部') { where.push('subject=?'); params.push(subject); }
  if (status && status !== '全部') { where.push('status=?'); params.push(status); }
  if (keyword) { where.push('(stem LIKE ? OR tag LIKE ? OR reason LIKE ?)'); const k = '%' + escLike(keyword) + '%'; params.push(k, k, k); }
  const sql = where.join(' AND ');
  const [[total]] = await pool.query(`SELECT COUNT(*) c FROM mistakes WHERE ${sql}`, params);
  const [rows] = await pool.query(
    `SELECT id, stem, answer, wrong_answer, reason, subject, tag, status, source, image_url, created_at
     FROM mistakes WHERE ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size]
  );
  res.json({ ok: true, data: { list: rows, total: total.c, page, size } });
});

// POST /mistakes 新增错题 {stem, answer, reason, subject, tag, source, image_url}
router.post('/mistakes', async (req, res) => {
  const { stem, answer, reason, subject, tag, source, image_url, wrong_answer } = req.body;
  if (!stem || !String(stem).trim()) return res.json({ ok: false, error: '题干不能为空' });
  const [r] = await pool.query(
    'INSERT INTO mistakes (user_id, stem, answer, wrong_answer, reason, subject, tag, status, source, image_url) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [req.user.id, String(stem).trim(), answer || '', wrong_answer || '', reason || '', subject || '数学',
     tag || '', '未掌握', source || 'API', image_url || null]
  );
  res.json({ ok: true, data: { id: r.insertId } });
});

// PUT /mistakes/:id 修改错题（只更新传入字段）
router.put('/mistakes/:id', async (req, res) => {
  const allowed = ['stem', 'answer', 'wrong_answer', 'reason', 'subject', 'tag', 'status', 'source', 'image_url'];
  const sets = [], vals = [];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) { sets.push(k + '=?'); vals.push(req.body[k]); }
  });
  if (!sets.length) return res.json({ ok: false, error: '没有可更新的字段' });
  vals.push(req.params.id, req.user.id);
  const [r] = await pool.query(`UPDATE mistakes SET ${sets.join(', ')} WHERE id=? AND user_id=?`, vals);
  if (!r.affectedRows) return res.json({ ok: false, error: '错题不存在或无权修改' });
  res.json({ ok: true, data: { changed: r.affectedRows } });
});

// DELETE /mistakes/:id 删除错题
router.delete('/mistakes/:id', async (req, res) => {
  const [r] = await pool.query('DELETE FROM mistakes WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!r.affectedRows) return res.json({ ok: false, error: '错题不存在或无权删除' });
  res.json({ ok: true });
});

// POST /mistakes/:id/mastery 标记掌握 {status: 已掌握/复习中/未掌握}
router.post('/mistakes/:id/mastery', async (req, res) => {
  const status = req.body.status || '已掌握';
  if (MISTAKE_STATUSES.indexOf(status) < 0) return res.json({ ok: false, error: '状态只支持：未掌握/复习中/已掌握' });
  const [r] = await pool.query('UPDATE mistakes SET status=? WHERE id=? AND user_id=?', [status, req.params.id, req.user.id]);
  if (!r.affectedRows) return res.json({ ok: false, error: '错题不存在或无权操作' });
  res.json({ ok: true, data: { status } });
});

// ---------- 题库 ----------
// GET /questions?grade=&tag=&subject=&page=&size=
router.get('/questions', async (req, res) => {
  const { grade, tag, subject } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(50, Math.max(1, parseInt(req.query.size) || 20));
  const where = ['user_id=?'];
  const params = [req.user.id];
  if (grade) { where.push('grade=?'); params.push(grade); }
  if (tag) { where.push('tag=?'); params.push(tag); }
  if (subject) { where.push('subject=?'); params.push(subject); }
  const sql = where.join(' AND ');
  const [[total]] = await pool.query(`SELECT COUNT(*) c FROM questions WHERE ${sql}`, params);
  const [rows] = await pool.query(
    `SELECT id, stem, answer, analysis, subject, grade, difficulty, status, tag, image_url, created_at
     FROM questions WHERE ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size]
  );
  res.json({ ok: true, data: { list: rows, total: total.c, page, size } });
});

// POST /questions 新增题目 {stem, answer, analysis, subject, grade, difficulty, tag, image_url}
router.post('/questions', async (req, res) => {
  const { stem, answer, analysis, subject, grade, difficulty, tag, image_url } = req.body;
  if (!stem || !String(stem).trim()) return res.json({ ok: false, error: '题干不能为空' });
  const [r] = await pool.query(
    'INSERT INTO questions (user_id, stem, answer, analysis, subject, grade, difficulty, status, tag, image_url) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [req.user.id, String(stem).trim(), answer || '', analysis || '', subject || '数学',
     grade || '', difficulty || '中等', '未学习', tag || '', image_url || null]
  );
  res.json({ ok: true, data: { id: r.insertId } });
});

// PUT /questions/:id 修改题目（只更新传入字段）
router.put('/questions/:id', async (req, res) => {
  const allowed = ['stem', 'answer', 'analysis', 'subject', 'grade', 'difficulty', 'status', 'tag', 'image_url'];
  const sets = [], vals = [];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) { sets.push(k + '=?'); vals.push(req.body[k]); }
  });
  if (!sets.length) return res.json({ ok: false, error: '没有可更新的字段' });
  vals.push(req.params.id, req.user.id);
  const [r] = await pool.query(`UPDATE questions SET ${sets.join(', ')} WHERE id=? AND user_id=?`, vals);
  if (!r.affectedRows) return res.json({ ok: false, error: '题目不存在或无权修改' });
  res.json({ ok: true, data: { changed: r.affectedRows } });
});

// DELETE /questions/:id 删除题目
router.delete('/questions/:id', async (req, res) => {
  const [r] = await pool.query('DELETE FROM questions WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!r.affectedRows) return res.json({ ok: false, error: '题目不存在或无权删除' });
  res.json({ ok: true });
});

module.exports = router;
