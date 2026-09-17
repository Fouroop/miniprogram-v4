const express = require('express');
const pool = require('../db/pool');
const { userAuth } = require('../middleware/auth');

const router = express.Router();

// 首页统计：错题总数 / 待复习 / 已掌握 / 本周辅导次数
router.get('/stats', userAuth, async (req, res) => {
  const uid = req.user.id;
  const [[total]] = await pool.query('SELECT COUNT(*) c FROM mistakes WHERE user_id=?', [uid]);
  const [[todo]] = await pool.query("SELECT COUNT(*) c FROM mistakes WHERE user_id=? AND status IN ('未掌握','复习中')", [uid]);
  const [[mastered]] = await pool.query("SELECT COUNT(*) c FROM mistakes WHERE user_id=? AND status='已掌握'", [uid]);
  const [[week]] = await pool.query(
    "SELECT COUNT(*) c FROM messages m JOIN conversations c ON m.conversation_id=c.id WHERE c.user_id=? AND m.role='user' AND m.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
    [uid]
  );
  res.json({ ok: true, data: { total: total.c, todo: todo.c, mastered: mastered.c, weekChats: week.c } });
});

module.exports = router;
