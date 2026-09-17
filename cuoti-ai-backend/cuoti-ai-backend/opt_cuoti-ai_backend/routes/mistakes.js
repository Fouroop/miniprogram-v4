const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { userAuth } = require('../middleware/auth');

const router = express.Router();
router.use(userAuth);

// OCR 识别（演示环境模拟）
router.post('/ocr', async (req, res) => {
  // 真实场景此处调用 OCR 服务；演示环境直接返回模拟文本
  res.json({
    ok: true,
    data: {
      text: config.mockOcrText,
      subject: '数学',
      suggestion: '请核对识别文本，补充正确答案后保存'
    }
  });
});

// 列表
router.get('/', async (req, res) => {
  const { subject, status, weak, page = 1, size = 10 } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(50, parseInt(size));
  let where = 'user_id=?';
  const params = [req.user.id];
  if (subject) { where += ' AND subject=?'; params.push(subject); }
  if (status) { where += ' AND status=?'; params.push(status); }
  // weak=1：掌握不牢固（未掌握 + 复习中），按下次复习时间升序
  if (weak === '1') {
    where += " AND status IN ('未掌握','复习中')";
    const [rows] = await pool.query(
      `SELECT * FROM mistakes WHERE ${where} ORDER BY next_review ASC, created_at DESC LIMIT ? OFFSET ?`,
      [...params, s, (p - 1) * s]
    );
    return res.json({ ok: true, data: { list: rows, total: rows.length, page: p, size: s } });
  }
  const [total] = await pool.query(`SELECT COUNT(*) c FROM mistakes WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM mistakes WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM mistakes WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!rows.length) return res.json({ ok: false, error: '错题不存在' });
  res.json({ ok: true, data: rows[0] });
});

router.post('/', async (req, res) => {
  const { stem, answer, wrong_answer, reason, subject, tag, source, image_url } = req.body;
  const nextReview = new Date(Date.now() + 24 * 3600 * 1000);
  const [r] = await pool.query(
    `INSERT INTO mistakes (user_id, stem, answer, wrong_answer, reason, subject, tag, status, source, image_url, next_review, review_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
    [req.user.id, stem || '', answer || '', wrong_answer || '', reason || '', subject || '数学', tag || '', '未掌握', source || '手动', image_url || null, nextReview]
  );
  res.json({ ok: true, data: { id: r.insertId } });
});

router.put('/:id', async (req, res) => {
  const { stem, answer, wrong_answer, reason, subject, tag, status } = req.body;
  await pool.query(
    `UPDATE mistakes SET stem=?, answer=?, wrong_answer=?, reason=?, subject=?, tag=?, status=? WHERE id=? AND user_id=?`,
    [stem, answer, wrong_answer, reason, subject, tag, status, req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM mistakes WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// 标记复习：review_count+1，按间隔重复更新 next_review（1/2/4/7/15天）
router.post('/:id/review', async (req, res) => {
  const [rows] = await pool.query('SELECT review_count FROM mistakes WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!rows.length) return res.json({ ok: false, error: '错题不存在' });
  const intervals = [1, 2, 4, 7, 15];
  const n = Math.min(rows[0].review_count, intervals.length - 1);
  const next = new Date(Date.now() + intervals[n] * 24 * 3600 * 1000);
  const newStatus = n >= 3 ? '已掌握' : '复习中';
  await pool.query(
    'UPDATE mistakes SET review_count=review_count+1, next_review=?, status=? WHERE id=?',
    [next, newStatus, req.params.id]
  );
  res.json({ ok: true, data: { next_review: next, status: newStatus } });
});

// 通话后标记知识点掌握情况
// mastery: mastered(完全掌握) | reviewing(有点会了) | weak(还没弄懂)
router.post('/:id/mastery', async (req, res) => {
  const { mastery, tag } = req.body;
  const [rows] = await pool.query('SELECT id FROM mistakes WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!rows.length) return res.json({ ok: false, error: '错题不存在' });

  // 掌握度 → 状态 + 复习间隔（天）
  const map = {
    mastered:  { status: '已掌握', days: 15 },
    reviewing: { status: '复习中', days: 4 },
    weak:      { status: '未掌握', days: 1 }
  };
  const m = map[mastery] || map.reviewing;
  const next = new Date(Date.now() + m.days * 24 * 3600 * 1000);
  const updateTag = (tag !== undefined && tag !== null) ? tag : null;

  if (updateTag !== null) {
    await pool.query(
      'UPDATE mistakes SET status=?, next_review=?, review_count=review_count+1, tag=COALESCE(NULLIF(?,\'\'), tag) WHERE id=?',
      [m.status, next, updateTag, req.params.id]
    );
  } else {
    await pool.query(
      'UPDATE mistakes SET status=?, next_review=?, review_count=review_count+1 WHERE id=?',
      [m.status, next, req.params.id]
    );
  }
  res.json({ ok: true, data: { status: m.status, next_review: next } });
});

module.exports = router;
