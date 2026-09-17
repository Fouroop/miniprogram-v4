const express = require('express');
const pool = require('../db/pool');
const { userAuth } = require('../middleware/auth');

const router = express.Router();
router.use(userAuth);

// 更新昵称/年级
router.put('/profile', async (req, res) => {
  const { nickname, grade, avatar } = req.body;
  await pool.query('UPDATE users SET nickname=?, grade=?, avatar=? WHERE id=?',
    [nickname || null, grade || null, avatar || null, req.user.id]);
  res.json({ ok: true });
});

// AI 使用统计
router.get('/usage', async (req, res) => {
  const uid = req.user.id;
  const [[conv]] = await pool.query('SELECT COUNT(*) c FROM conversations WHERE user_id=?', [uid]);
  const [[msgs]] = await pool.query(
    'SELECT COUNT(*) c FROM messages m JOIN conversations c ON m.conversation_id=c.id WHERE c.user_id=? AND m.role=\'user\'',
    [uid]
  );
  const [[mistakes]] = await pool.query('SELECT COUNT(*) c FROM mistakes WHERE user_id=?', [uid]);
  res.json({ ok: true, data: { conversations: conv.c, userMessages: msgs.c, mistakes: mistakes.c } });
});

module.exports = router;
