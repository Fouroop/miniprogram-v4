-- ============================================================
-- 语音包体系（按量计费）迁移脚本
-- 1. users 表加语音包字段
-- 2. 新建 voice_plans 套餐表（3档）
-- 3. 新建 voice_orders 订单表
-- ============================================================

USE cuoti_ai;

-- 用户表加语音包字段
ALTER TABLE users
  ADD COLUMN voice_minutes INT DEFAULT 0 COMMENT '语音包剩余分钟' AFTER vip_expire,
  ADD COLUMN voice_expire DATETIME NULL COMMENT '语音包到期时间' AFTER voice_minutes;

-- 语音包套餐表（3档：单次包 / 月付 / 年付）
CREATE TABLE IF NOT EXISTS voice_plans (
  id INT PRIMARY KEY AUTO_INCREMENT,
  plan VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(64) NOT NULL,
  minutes INT NOT NULL COMMENT '语音分钟数',
  price DECIMAL(8,2) NOT NULL COMMENT '价格(元)',
  duration_days INT NOT NULL COMMENT '有效期天数',
  desc_text VARCHAR(255) DEFAULT '',
  hot TINYINT DEFAULT 0,
  is_active TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 语音包订单表
CREATE TABLE IF NOT EXISTS voice_orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  plan VARCHAR(32) NOT NULL,
  plan_name VARCHAR(64) DEFAULT '',
  minutes INT DEFAULT 0,
  amount DECIMAL(8,2) DEFAULT 0,
  status VARCHAR(16) DEFAULT 'paid',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vo_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 初始 3 档套餐
INSERT INTO voice_plans (plan, name, minutes, price, duration_days, desc_text, hot) VALUES
  ('single',  '单次语音包',    30,  9.9,  30, '30分钟语音辅导，30天有效', 0),
  ('monthly', '月付语音包',   300, 39.0, 30, '300分钟/月，语音辅导不限题', 1),
  ('yearly',  '年付语音包',  3600,199.0, 365, '3600分钟/年，全年畅聊', 0)
ON DUPLICATE KEY UPDATE name=VALUES(name), minutes=VALUES(minutes), price=VALUES(price), duration_days=VALUES(duration_days), desc_text=VALUES(desc_text);
