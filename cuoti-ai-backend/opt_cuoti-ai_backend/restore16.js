const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({ host: '127.0.0.1', port: 3306, user: 'cuoti', password: 'Cuoti2026!Secure', database: 'cuoti_ai' });
  const [r] = await pool.query(
    "UPDATE mistakes SET stem=?, answer=?, wrong_answer=?, reason=?, subject=?, tag=? WHERE id=16 AND stem IS NULL",
    ['已知二次函数 y = x² - 4x + 3，求它的顶点坐标和对称轴。',
     '顶点 (2, -1)，对称轴 x = 2',
     '顶点 (-4, 3)',
     '没掌握配方法：y=(x-2)²-1 可直接读出顶点与对称轴',
     '数学', '二次函数']
  );
  console.log('affected:', r.affectedRows);
  const [rows] = await pool.query('SELECT id, subject, tag, LEFT(stem,20) stem, status FROM mistakes WHERE id=16');
  console.log(JSON.stringify(rows[0]));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
