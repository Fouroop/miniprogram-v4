const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { userAuth } = require('../middleware/auth');

const router = express.Router();
router.use(userAuth);

// 取当前启用的大模型配置
async function getActiveLlm() {
  const [rows] = await pool.query('SELECT * FROM llm_configs WHERE is_active=1 LIMIT 1');
  return rows[0] || null;
}

// 调 OpenAI 兼容接口
async function callLlm(llm, messages) {
  const url = (llm.base_url || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + llm.api_key },
    body: JSON.stringify({ model: llm.model, messages, temperature: 0.7, max_tokens: 300 })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('大模型调用失败: ' + resp.status + ' ' + txt.slice(0, 200));
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// 构造 system prompt（苏格拉底人设 + 题干）
function buildSystem(mistake) {
  let sys = config.socraticSystem;
  if (mistake) {
    sys += `\n\n【当前讨论的错题】\n科目：${mistake.subject || ''}\n题干：${mistake.stem || ''}\n正确答案：${mistake.answer || ''}\n学生错因标签：${mistake.reason || ''}\n（你知道答案，但不要直接说出来，用提问引导学生自己推导出答案。）`;
  }
  return sys;
}

// AI 对话
router.post('/chat', async (req, res) => {
  const { conversation_id, mistake_id, content, mode = 'text' } = req.body;
  if (!content || !content.trim()) return res.json({ ok: false, error: '消息内容为空' });
  const uid = req.user.id;

  // 找/建对话
  let convId = conversation_id;
  let mistake = null;
  if (mistake_id) {
    const [m] = await pool.query('SELECT * FROM mistakes WHERE id=? AND user_id=?', [mistake_id, uid]);
    mistake = m[0] || null;
  }
  if (!convId) {
    const title = mistake ? `${mistake.subject || ''}·${mistake.tag || '错题辅导'}` : '自由提问';
    const [r] = await pool.query(
      'INSERT INTO conversations (user_id, mistake_id, mode, title) VALUES (?,?,?,?)',
      [uid, mistake_id || null, mode, title]
    );
    convId = r.insertId;
  } else {
    // 校验对话归属
    const [c] = await pool.query('SELECT * FROM conversations WHERE id=? AND user_id=?', [convId, uid]);
    if (!c.length) return res.json({ ok: false, error: '对话不存在' });
    if (!mistake && c[0].mistake_id) {
      const [m] = await pool.query('SELECT * FROM mistakes WHERE id=?', [c[0].mistake_id]);
      mistake = m[0] || null;
    }
  }

  // 存用户消息
  await pool.query('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)', [convId, 'user', content]);

  // 取大模型配置
  const llm = await getActiveLlm();
  let reply;
  if (!llm || !llm.api_key || llm.api_key.includes('your-key-here')) {
    // 未配置真实 key 时，用内置兜底话术（保证接口可用）
    reply = fallbackReply(content);
  } else {
    try {
      // 带上最近 10 条历史
      const [hist] = await pool.query(
        "SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 10",
        [convId]
      );
      const msgs = [{ role: 'system', content: buildSystem(mistake) }];
      hist.reverse().forEach(h => {
        if (h.role === 'ai') msgs.push({ role: 'assistant', content: h.content });
        else if (h.role === 'user') msgs.push({ role: 'user', content: h.content });
      });
      reply = await callLlm(llm, msgs);
    } catch (e) {
      reply = fallbackReply(content) + '（提示：大模型调用失败，已切换到兜底回复）';
    }
  }

  // 存 AI 消息
  await pool.query('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)', [convId, 'ai', reply]);

  res.json({ ok: true, data: { conversation_id: convId, reply } });
});

// 兜底回复（苏格拉底式）
function fallbackReply(userInput) {
  const q = userInput.trim();
  if (/你好|hi|hello|在吗/i.test(q)) return '你好呀！别着急看答案，先告诉我：这道题你卡在哪一步了？';
  if (/为什么|怎么|什么/.test(q)) return '先别急。你先说说看，这道题目里已知的条件都有哪些？把它们列出来我们一起看。';
  if (/算出来|等于|答案是/.test(q)) return '先自己动手算一遍给我看看？把你的算式写出来，我看看你哪一步可以再想想。';
  return '嗯，我听到了。那你觉得，要解这道题，我们第一步应该先弄清楚哪个条件？你先说说看。';
}

// 对话历史列表
router.get('/conversations', async (req, res) => {
  const { page = 1, size = 20 } = req.query;
  const p = Math.max(1, parseInt(page)), s = Math.min(50, parseInt(size));
  const [total] = await pool.query('SELECT COUNT(*) c FROM conversations WHERE user_id=?', [req.user.id]);
  const [rows] = await pool.query(
    'SELECT * FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    [req.user.id, s, (p - 1) * s]
  );
  res.json({ ok: true, data: { list: rows, total: total[0].c, page: p, size: s } });
});

// 对话消息
router.get('/conversations/:id/messages', async (req, res) => {
  const [c] = await pool.query('SELECT id FROM conversations WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!c.length) return res.json({ ok: false, error: '对话不存在' });
  const [rows] = await pool.query('SELECT * FROM messages WHERE conversation_id=? ORDER BY id ASC', [req.params.id]);
  res.json({ ok: true, data: rows });
});

router.delete('/conversations/:id', async (req, res) => {
  await pool.query('DELETE FROM messages WHERE conversation_id=?', [req.params.id]);
  await pool.query('DELETE FROM conversations WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// 语音配置：只返回 proxy_url + voice_id，绝不返回 api_key
router.get('/voice-config', async (req, res) => {
  const [rows] = await pool.query('SELECT proxy_url, voice_id FROM voice_configs WHERE is_active=1 LIMIT 1');
  const cfg = rows[0] || { proxy_url: '', voice_id: 'zh_female_vv_jupiter_bigtts' };
  res.json({ ok: true, data: cfg });
});

module.exports = router;
