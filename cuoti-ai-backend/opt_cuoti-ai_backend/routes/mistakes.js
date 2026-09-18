const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { userAuth } = require('../middleware/auth');

const router = express.Router();
router.use(userAuth);

// ---------- 视觉模型识别（豆包视觉 / OpenAI 兼容） ----------
function visionConfig() {
  return {
    base: process.env.VISION_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    model: process.env.VISION_MODEL || 'doubao-1.5-vision-pro-32k',
    key: process.env.VISION_API_KEY || ''
  };
}

async function visionRecognize(base64Image, mime) {
  const v = visionConfig();
  if (!v.key) {
    const err = new Error('视觉识别服务未配置：请在 .env 设置 VISION_API_KEY（火山方舟 doubao-vision，如 ARK 开头的 key）');
    err.code = 'NO_VISION_KEY';
    throw err;
  }
  const prompt =
    '你是错题识别助手。识别图片中的题目和学生的作答，输出 JSON（不要输出其他内容），格式：' +
    '{"questions":[{"stem":"题目完整文本（若为选择题/填空题请保留题干与选项）",' +
    '"answer":"标准答案（若无法确定留空）",' +
    '"wrong_answer":"学生手写/填写的答案（若识别不到留空）",' +
    '"subject":"学科（数学/物理/化学/英语/语文）",' +
    '"tag":"本题主要考查的知识点（2-8个字）"}]}' +
    '。注意：一张图可能包含多道题，务必全部识别；OCR 内容要完整准确。';
  const body = {
    model: v.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: 'data:' + (mime || 'image/jpeg') + ';base64,' + base64Image } }
      ]
    }],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };
  const resp = await fetch(v.base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + v.key },
    body: JSON.stringify(body)
  });
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error('视觉模型调用失败: HTTP ' + resp.status + ' ' + text.slice(0, 300));
    err.code = 'VISION_HTTP';
    throw err;
  }
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error('视觉模型返回格式错误'); }
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error('视觉模型未返回内容');
  // 剥离可能的 ```json 包裹
  const cleaned = String(content).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('视觉模型 JSON 解析失败: ' + cleaned.slice(0, 200));
  }
}

// 多题拍照识别：POST /mistakes/ocr-batch  { image_base64, mime }
router.post('/ocr-batch', async (req, res) => {
  const { image_base64, mime } = req.body;
  if (!image_base64) return res.json({ ok: false, error: '缺少图片数据' });
  try {
    const result = await visionRecognize(image_base64, mime);
    const qs = Array.isArray(result.questions) ? result.questions : [];
    const questions = qs.map((q) => ({
      stem: (q.stem || '').trim(),
      answer: (q.answer || '').trim(),
      wrong_answer: (q.wrong_answer || '').trim(),
      subject: ['数学', '物理', '化学', '英语', '语文'].includes(q.subject) ? q.subject : '数学',
      tag: (q.tag || '').trim()
    })).filter((q) => q.stem);
    res.json({ ok: true, data: { count: questions.length, questions } });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 批量保存错题：POST /mistakes/batch  { items: [{stem,answer,wrong_answer,reason,subject,tag,image_url}] }
router.post('/batch', async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.json({ ok: false, error: '没有可保存的题目' });
  const nextReview = new Date(Date.now() + 24 * 3600 * 1000);
  const ids = [];
  for (const it of items.slice(0, 20)) {
    const [r] = await pool.query(
      `INSERT INTO mistakes (user_id, stem, answer, wrong_answer, reason, subject, tag, status, source, image_url, next_review, review_count)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
      [req.user.id, it.stem || '', it.answer || '', it.wrong_answer || '', it.reason || '',
       it.subject || '数学', it.tag || '', '未掌握', '拍照', it.image_url || null, nextReview]
    );
    ids.push(r.insertId);
  }
  res.json({ ok: true, data: { count: ids.length, ids } });
});

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
  // 只更新传入的字段，避免未传字段被写成 NULL
  const { stem, answer, wrong_answer, reason, subject, tag, status } = req.body;
  const fields = {};
  if (stem !== undefined) fields.stem = stem;
  if (answer !== undefined) fields.answer = answer;
  if (wrong_answer !== undefined) fields.wrong_answer = wrong_answer;
  if (reason !== undefined) fields.reason = reason;
  if (subject !== undefined) fields.subject = subject;
  if (tag !== undefined) fields.tag = tag;
  if (status !== undefined) fields.status = status;
  if (!Object.keys(fields).length) return res.json({ ok: false, error: '没有需要更新的字段' });
  const setSql = Object.keys(fields).map((k) => k + '=?').join(',');
  const params = Object.keys(fields).map((k) => fields[k]);
  params.push(req.params.id, req.user.id);
  await pool.query(`UPDATE mistakes SET ${setSql} WHERE id=? AND user_id=?`, params);
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

  // ---- 知识点联动：把错题标签/题干匹配到大纲知识点，写入用户掌握记录 ----
  const matchText = (updateTag || rows[0].tag || '').trim();
  let matchedKps = [];
  if (matchText) {
    const [kps] = await pool.query(
      'SELECT id, name FROM knowledge_points WHERE level=2 AND (name LIKE ? OR ? LIKE CONCAT(\'%\', name, \'%\')) LIMIT 5',
      ['%' + matchText + '%', matchText]
    );
    matchedKps = kps;
    if (kps.length) {
      for (const kp of kps) {
        await pool.query(
          `INSERT INTO user_knowledge (user_id, kp_id, level) VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE level=?`,
          [req.user.id, kp.id, m.status === '已掌握' ? 'mastered' : (m.status === '复习中' ? 'reviewing' : 'weak'),
           m.status === '已掌握' ? 'mastered' : (m.status === '复习中' ? 'reviewing' : 'weak')]
        );
      }
    }
  }
  res.json({ ok: true, data: { status: m.status, next_review: next, knowledge: matchedKps } });
});

module.exports = router;
