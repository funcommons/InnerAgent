-- =============================================================================
-- mock-model-restore.sql — 恢复真实模型默认位(与 mock-model-script.sql 配对)
--
-- 用法:
--   docker exec -i inneragent-postgres psql -U inneragent -d inneragent \
--     < examples/acme-demo/seeds/mock-model-restore.sql
-- =============================================================================
UPDATE ia_ai_model SET default_model = FALSE WHERE code = 'mock-text';

-- MiniMax-M3:演示环境默认对话模型(计划.md §3;id=2,anthropic 协议)
UPDATE ia_ai_model
SET default_model = TRUE
WHERE model_type = 1 AND code = 'MiniMax-M3' AND status = 1;
