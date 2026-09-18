// 恢复被 PUT 全字段覆盖误置 NULL 的预置错题（按预置顺序）
const mysql = require('mysql2/promise');
const pool = mysql.createPool({
  host: '127.0.0.1', port: 3306,
  user: 'cuoti', password: 'Cuoti2026!Secure',
  database: 'cuoti_ai', connectionLimit: 5
});

// 与 routes/auth.js PRESET_MISTAKES 一致（顺序即预置插入顺序）
const PRESET = [
  { subject: '数学', tag: '二次函数', stem: '已知二次函数 y = x² - 4x + 3，求它的顶点坐标和对称轴。',
    answer: '顶点 (2, -1)，对称轴 x = 2', wrong_answer: '顶点 (-4, 3)',
    reason: '没掌握配方法：y=(x-2)²-1 可直接读出顶点与对称轴' },
  { subject: '数学', tag: '不等式', stem: '解不等式：2x - 5 > 3(x + 1)',
    answer: 'x < -8', wrong_answer: 'x > -8',
    reason: '展开移项后两边同乘 -1 时忘记变号' },
  { subject: '数学', tag: '二次根式', stem: '计算：√12 - √(1/3) + √27',
    answer: '14√3 / 3', wrong_answer: '4√3',
    reason: '√(1/3) 化简错误，应为 √3/3' },
  { subject: '物理', tag: '动能', stem: '一个质量为 2kg 的物体以 3m/s 的速度在水平面上运动，求它的动能。',
    answer: '9 J（Ek = ½mv² = ½×2×3² = 9）', wrong_answer: '18 J',
    reason: '动能公式漏了前面的 1/2' },
  { subject: '物理', tag: '欧姆定律', stem: '某导体两端电压为 6V，通过的电流为 0.5A，求该导体的电阻。',
    answer: '12 Ω（R = U/I = 6/0.5 = 12）', wrong_answer: '3 Ω',
    reason: '把欧姆定律记成了 R = U×I' },
  { subject: '化学', tag: '化学方程式', stem: '写出高锰酸钾受热分解制取氧气的化学方程式并配平。',
    answer: '2KMnO₄ =△= K₂MnO₄ + MnO₂ + O₂↑', wrong_answer: 'KMnO₄ = K₂MnO₄ + MnO₂ + O₂',
    reason: '没配平，且漏写气体上升符号' },
  { subject: '化学', tag: '化学计算', stem: '计算 H₂O 中氢元素的质量分数（相对原子质量 H=1，O=16）。',
    answer: '约 11.1%（2÷18×100%）', wrong_answer: '约 5.6%',
    reason: '分母应取水的相对分子质量 18，而不是氢原子个数 2' },
  { subject: '语文', tag: '古诗词默写', stem: '默写填空："会当凌绝顶，______。"（杜甫《望岳》）',
    answer: '一览众山小', wrong_answer: '一览众山小矣',
    reason: '背诵不准确，多写或少写了字' },
  { subject: '语文', tag: '病句修改', stem: '修改病句：通过这次活动，使我明白了团结合作的重要性。',
    answer: '删除"通过"或"使"，如：通过这次活动，我明白了团结合作的重要性。', wrong_answer: '这次活动，使我明白了团结合作的重要性。',
    reason: '没识别出介词滥用导致主语残缺' },
  { subject: '英语', tag: '一般现在时', stem: '用所给词的适当形式填空：She ______ (go) to school by bus every day.',
    answer: 'goes（一般现在时，主语第三人称单数）', wrong_answer: 'go',
    reason: '漏掉第三人称单数动词加 -es' },
  { subject: '英语', tag: '主谓一致', stem: '单项选择：There ______ some milk in the glass. A. is  B. are  C. be',
    answer: 'A（milk 为不可数名词，be 动词用 is）', wrong_answer: 'B',
    reason: '看到 some 就选复数，没判断 milk 不可数' }
];

(async () => {
  const [users] = await pool.query("SELECT DISTINCT user_id FROM mistakes WHERE source='预置' ORDER BY user_id");
  let fixed = 0;
  for (const u of users) {
    const [rows] = await pool.query(
      "SELECT id FROM mistakes WHERE user_id=? AND source='预置' ORDER BY id",
      [u.user_id]
    );
    for (let i = 0; i < rows.length; i++) {
      const m = PRESET[i];
      if (!m) continue;
      const [r] = await pool.query(
        "UPDATE mistakes SET stem=?, answer=?, wrong_answer=?, reason=?, subject=?, tag=? WHERE id=? AND stem IS NULL",
        [m.stem, m.answer, m.wrong_answer, m.reason, m.subject, m.tag, rows[i].id]
      );
      if (r.affectedRows > 0) {
        fixed++;
        console.log('restored id=' + rows[i].id + ' -> ' + m.subject + '/' + m.tag);
      }
    }
  }
  console.log('total restored:', fixed);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
