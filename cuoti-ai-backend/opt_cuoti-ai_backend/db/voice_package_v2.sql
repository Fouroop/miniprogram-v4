-- ============================================================
-- 语音包 v2：通话流量明细 + 微信支付订单扩展
-- 1. voice_calls 通话明细表（消耗流量/计费流量/实际流量）
-- 2. voice_orders 增加支付字段
-- ============================================================

USE cuoti_ai;

-- 通话明细表：记录每次语音通话的时长（消耗流量）、计费分钟（计费流量）、实际音频数据流量
CREATE TABLE IF NOT EXISTS voice_calls (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL COMMENT '用户ID',
  mistake_id INT NULL COMMENT '关联错题ID',
  seconds INT DEFAULT 0 COMMENT '通话时长(秒)=消耗流量',
  billed_minutes DECIMAL(8,1) DEFAULT 0 COMMENT '计费分钟=计费流量',
  up_bytes BIGINT DEFAULT 0 COMMENT '上行音频流量(字节)',
  down_bytes BIGINT DEFAULT 0 COMMENT '下行音频流量(字节)',
  total_bytes BIGINT DEFAULT 0 COMMENT '总实际流量(字节)',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vc_user (user_id),
  INDEX idx_vc_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 语音包订单表增加支付字段（微信支付）
ALTER TABLE voice_orders
  ADD COLUMN pay_type VARCHAR(16) DEFAULT 'simulate' COMMENT '支付方式: simulate/wxpay' AFTER status,
  ADD COLUMN trade_no VARCHAR(64) NULL COMMENT '微信支付商户订单号' AFTER pay_type,
  ADD COLUMN transaction_id VARCHAR(64) NULL COMMENT '微信支付交易号' AFTER trade_no;
