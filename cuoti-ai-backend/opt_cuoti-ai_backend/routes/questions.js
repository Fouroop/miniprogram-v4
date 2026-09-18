const express = require('express');
const pool = require('../db/pool');
const { userAuth } = require('../middleware/auth');

const router = express.Router();
router.use(userAuth);

// 列表：公共题(user_id IS NULL) + 本人题；支持 subject / grade / tag 筛选
router.get('/', async (req, res) => {
  const { subject, grade, tag, page = 1, size = 20 } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(50, parseInt(size));
  const conds = ['(user_id IS NULL OR user_id=?)'];
  const params = [req.user.id];
  if (subject) { conds.push('subject=?'); params.push(subject); }
  if (grade) { conds.push('grade=?'); params.push(grade); }
  if (tag) { conds.push('tag=?'); params.push(tag); }
  const where = conds.join(' AND ');
  const [total] = await pool.query(`SELECT COUNT(*) c FROM questions WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM questions WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM questions WHERE id=? AND (user_id IS NULL OR user_id=?)', [req.params.id, req.user.id]);
  if (!rows.length) return res.json({ ok: false, error: '题目不存在' });
  res.json({ ok: true, data: rows[0] });
});

router.post('/', async (req, res) => {
  const { stem, answer, analysis, subject, grade, difficulty, status } = req.body;
  const [r] = await pool.query(
    'INSERT INTO questions (stem, answer, analysis, subject, grade, difficulty, status, user_id) VALUES (?,?,?,?,?,?,?,?)',
    [stem || '', answer || '', analysis || '', subject || '', grade || '', difficulty || '中等', status || '未学习', req.user.id]
  );
  res.json({ ok: true, data: { id: r.insertId } });
});

router.put('/:id', async (req, res) => {
  // 只更新传入字段，避免全字段覆盖把未传字段置 NULL
  const allowed = ['stem', 'answer', 'analysis', 'subject', 'grade', 'difficulty', 'status', 'tag'];
  const sets = [];
  const vals = [];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) { sets.push(k + '=?'); vals.push(req.body[k]); }
  });
  if (!sets.length) return res.json({ ok: false, error: '没有可更新的字段' });
  vals.push(req.params.id, req.user.id);
  const [r] = await pool.query(
    'UPDATE questions SET ' + sets.join(', ') + ' WHERE id=? AND user_id=?',
    vals
  );
  if (!r.affectedRows) return res.json({ ok: false, error: '只能编辑自己创建的题目或题目不存在' });
  res.json({ ok: true, data: { changed: r.affectedRows } });
});

router.delete('/:id', async (req, res) => {
  // 仅允许删除自己创建的题目
  const [r] = await pool.query('DELETE FROM questions WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!r.affectedRows) return res.json({ ok: false, error: '只能删除自己创建的题目或题目不存在' });
  res.json({ ok: true });
});

module.exports = router;
