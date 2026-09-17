// routes/knowledge.js —— 知识点大纲 + 用户掌握记录
const express = require('express');
const pool = require('../db/pool');
const { userAuth } = require('../middleware/auth');

const router = express.Router();
router.use(userAuth);

// 科目列表 + 每科掌握统计
router.get('/subjects', async (req, res) => {
  const [kps] = await pool.query(
    'SELECT id, subject, name, parent_id, level FROM knowledge_points WHERE level=2 ORDER BY id'
  );
  const [uks] = await pool.query('SELECT kp_id, level FROM user_knowledge WHERE user_id=?', [req.user.id]);
  const ukMap = {};
  uks.forEach((u) => { ukMap[u.kp_id] = u.level; });

  const bySubject = {};
  kps.forEach((k) => {
    if (!bySubject[k.subject]) bySubject[k.subject] = { total: 0, weak: 0, reviewing: 0, mastered: 0 };
    const s = bySubject[k.subject];
    s.total++;
    const lv = ukMap[k.id];
    if (lv === 'mastered') s.mastered++;
    else if (lv === 'reviewing') s.reviewing++;
    else if (lv === 'weak') s.weak++;
  });
  const data = Object.keys(bySubject).map((subject) => ({
    subject,
    total: bySubject[subject].total,
    mastered: bySubject[subject].mastered,
    reviewing: bySubject[subject].reviewing,
    weak: bySubject[subject].weak
  }));
  res.json({ ok: true, data });
});

// 大纲树：GET /knowledge/tree?subject=数学
router.get('/tree', async (req, res) => {
  const subject = req.query.subject || '数学';
  const [kps] = await pool.query(
    'SELECT id, subject, name, parent_id, level FROM knowledge_points WHERE subject=? ORDER BY sort, id',
    [subject]
  );
  const [uks] = await pool.query('SELECT kp_id, level FROM user_knowledge WHERE user_id=?', [req.user.id]);
  const ukMap = {};
  uks.forEach((u) => { ukMap[u.kp_id] = u.level; });

  const chapters = kps.filter((k) => k.level === 1);
  const kpList = kps.filter((k) => k.level === 2);
  const data = chapters.map((ch) => {
    const kps2 = kpList
      .filter((k) => k.parent_id === ch.id)
      .map((k) => ({
        id: k.id,
        name: k.name,
        level: ukMap[k.id] || 'none' // none/weak/reviewing/mastered
      }));
    const mastered = kps2.filter((k) => k.level === 'mastered').length;
    const reviewing = kps2.filter((k) => k.level === 'reviewing').length;
    const weak = kps2.filter((k) => k.level === 'weak').length;
    return {
      id: ch.id,
      name: ch.name,
      kps: kps2,
      total: kps2.length,
      mastered,
      reviewing,
      weak
    };
  });
  res.json({ ok: true, data: { subject, chapters: data } });
});

// 标记知识点掌握：POST /knowledge/:kpId/mastery  { mastery: weak|reviewing|mastered }
router.post('/:kpId/mastery', async (req, res) => {
  const kpId = parseInt(req.params.kpId);
  const { mastery } = req.body;
  if (!['weak', 'reviewing', 'mastered'].includes(mastery)) {
    return res.json({ ok: false, error: '掌握程度参数无效' });
  }
  const [rows] = await pool.query('SELECT id FROM knowledge_points WHERE id=? AND level=2', [kpId]);
  if (!rows.length) return res.json({ ok: false, error: '知识点不存在' });

  await pool.query(
    `INSERT INTO user_knowledge (user_id, kp_id, level) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE level=?`,
    [req.user.id, kpId, mastery, mastery]
  );
  res.json({ ok: true, data: { kp_id: kpId, level: mastery } });
});

// 我的错题按知识点分组（地图页点击知识点 → 相关错题）
router.get('/mistakes', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, stem, subject, tag, status, created_at FROM mistakes
     WHERE user_id=? ORDER BY created_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json({ ok: true, data: rows });
});

module.exports = router;
