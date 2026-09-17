-- ============================================================
-- 错题AI辅导 数据库初始化脚本
-- 库：cuoti_ai  字符集 utf8mb4
-- 默认管理员：admin / admin123
-- 执行：mysql -uroot -p < init.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS cuoti_ai DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE cuoti_ai;

-- ---------- 用户表 ----------
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  nickname VARCHAR(64),
  avatar VARCHAR(255),
  grade VARCHAR(32),
  role VARCHAR(16) DEFAULT 'student',
  is_vip TINYINT DEFAULT 0,
  vip_expire DATETIME NULL,
  openid VARCHAR(128) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 题库 ----------
CREATE TABLE IF NOT EXISTS questions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  stem TEXT,
  answer TEXT,
  analysis TEXT,
  subject VARCHAR(32),
  grade VARCHAR(32),
  difficulty VARCHAR(16),
  status VARCHAR(16) DEFAULT '未学习',
  user_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_questions_user (user_id),
  INDEX idx_questions_subject (subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 错题本 ----------
CREATE TABLE IF NOT EXISTS mistakes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  stem TEXT,
  answer TEXT,
  wrong_answer TEXT,
  reason VARCHAR(64),
  subject VARCHAR(32),
  tag VARCHAR(64),
  status VARCHAR(16) DEFAULT '未掌握',
  source VARCHAR(32) DEFAULT '手动',
  image_url VARCHAR(255),
  next_review DATETIME NULL,
  review_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mistakes_user (user_id),
  INDEX idx_mistakes_subject (subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 对话 ----------
CREATE TABLE IF NOT EXISTS conversations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  mistake_id INT NULL,
  mode VARCHAR(16) DEFAULT 'text',
  title VARCHAR(128),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_conv_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 消息 ----------
CREATE TABLE IF NOT EXISTS messages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  conversation_id INT NOT NULL,
  role VARCHAR(16),
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_msg_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 大模型配置 ----------
CREATE TABLE IF NOT EXISTS llm_configs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  provider VARCHAR(32),
  model VARCHAR(64),
  api_key VARCHAR(255),
  base_url VARCHAR(255),
  is_active TINYINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 语音配置 ----------
CREATE TABLE IF NOT EXISTS voice_configs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  api_key VARCHAR(255),
  proxy_url VARCHAR(255),
  voice_id VARCHAR(64) DEFAULT 'zh_female_vv_jupiter_bigtts',
  is_active TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- VIP订单 ----------
CREATE TABLE IF NOT EXISTS vip_orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  plan VARCHAR(16),
  amount DECIMAL(10,2),
  status VARCHAR(16) DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- VIP激活码 ----------
CREATE TABLE IF NOT EXISTS vip_codes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(32) UNIQUE NOT NULL,
  type VARCHAR(16),
  duration_days INT,
  used TINYINT DEFAULT 0,
  used_by INT NULL,
  used_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 管理员 ----------
CREATE TABLE IF NOT EXISTS admin_users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 系统设置 ----------
CREATE TABLE IF NOT EXISTS settings (
  key_name VARCHAR(64) PRIMARY KEY,
  value TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 初始数据（管理员密码为 bcrypt(admin123)，由 db/init.js 插入以保证一致）
-- 这里仅插入公共示例题目与默认语音配置
-- ============================================================

INSERT INTO questions (stem, answer, analysis, subject, grade, difficulty, status, user_id) VALUES
('已知二次函数 y = x² - 4x + 3，求它的顶点坐标和对称轴。',
 '顶点(2, -1)，对称轴 x=2',
 '用配方法 y=(x-2)²-1，直接读出顶点与对称轴。',
 '数学', '九年级', '中等', '未学习', NULL),
('解不等式：2x - 5 > 3(x + 1)',
 'x < -8',
 '展开得 2x-5 > 3x+3，移项 -x > 8，两边乘 -1 注意变号。',
 '数学', '八年级', '简单', '未学习', NULL),
('计算：√12 - √(1/3) + √27',
 '14√3 / 3',
 '化简：2√3 - √3/3 + 3√3 = (6-1+9)/3 √3 = 14√3/3。',
 '数学', '九年级', '较难', '未学习', NULL);

-- 默认语音配置（代理已存在）
INSERT INTO voice_configs (api_key, proxy_url, voice_id, is_active) VALUES
('volc-mock-api-key', 'wss://zblw.com.cn/voice?key=vp_90c1bb01193c11cf', 'zh_female_vv_jupiter_bigtts', 1);

-- 默认大模型配置占位（管理员在后台填写真实 key）
INSERT INTO llm_configs (provider, model, api_key, base_url, is_active) VALUES
('DeepSeek', 'deepseek-chat', 'sk-your-key-here', 'https://api.deepseek.com/v1', 1);
