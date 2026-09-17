-- ============================================================
-- 语音包 v3：通话幂等去重（call_id）
-- 1. voice_calls 增加 call_id 唯一键：代理上报与 /end 按 call_id 合并，杜绝同一通话重复落账
-- 2. 旧数据 call_id 为 NULL，不影响唯一索引（MySQL 允许多个 NULL）
-- ============================================================

USE cuoti_ai;

ALTER TABLE voice_calls
  ADD COLUMN call_id VARCHAR(64) NULL COMMENT '通话唯一ID（客户端生成，幂等去重用）' AFTER id,
  ADD UNIQUE INDEX uk_vc_call (call_id);
