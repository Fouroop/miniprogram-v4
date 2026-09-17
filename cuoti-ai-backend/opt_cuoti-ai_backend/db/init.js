// 一键初始化数据库：执行 init.sql + 插入默认管理员 admin/admin123
// 用法：node db/init.js
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');

  // 先连到 MySQL（不指定库），执行建库+建表语句
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port,
    user: config.db.user, password: config.db.password,
    multipleStatements: true
  });
  console.log('[init] 执行 init.sql ...');
  await conn.query(sql);

  // 插入/更新默认管理员
  const hash = bcrypt.hashSync('admin123', 10);
  await conn.query(`USE ${config.db.database}`);
  await conn.query(
    `INSERT INTO admin_users (username, password_hash) VALUES ('admin', ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [hash]
  );

  // 演示学生账号 demo/demo123
  const demoHash = bcrypt.hashSync('demo123', 10);
  await conn.query(
    `INSERT INTO users (username, password_hash, nickname, grade, role, is_vip)
     VALUES ('demo', ?, '演示同学', '九年级', 'student', 1)
     ON DUPLICATE KEY UPDATE nickname=VALUES(nickname)`,
    [demoHash]
  );

  await conn.end();
  console.log('[init] 完成。默认管理员 admin / admin123，演示学生 demo / demo123');
}

main().catch(e => { console.error('[init] 失败:', e.message); process.exit(1); });
