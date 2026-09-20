-- =====================================================================
-- InnerAgent V13:授权唯一约束改为「仅活跃行」部分唯一索引(R1 修复 DEF-04)
--
-- 缺陷:V2 的 uk_ia_tool_grant UNIQUE NULLS NOT DISTINCT(app_id, user_id,
-- tool_fqn, scope, conversation_id)不含 deleted 谓词,撤销(逻辑删)行
-- 永久占用唯一键;服务层查重只看活跃行 → 同键重授 INSERT 约束冲突 →
-- 裸 DataIntegrityViolationException → 500「系统内部错误」。
--
-- 修复:删旧约束,建部分唯一索引(列集照抄原约束):
--   * WHERE deleted = FALSE:撤销/失效行不再占键,同键重授恢复可用;
--   * NULLS NOT DISTINCT:保持「永久授权 conversation_id IS NULL 同样
--     参与唯一」的原口径(PostgreSQL 15+ 支持);
--   * 服务层查重(deleted=FALSE 且 invalidated=FALSE)口径不变。
-- =====================================================================

-- 1. 删除旧表级唯一约束(含逻辑删行)
ALTER TABLE ia_tool_grant DROP CONSTRAINT uk_ia_tool_grant;

-- 2. 建活跃行部分唯一索引
CREATE UNIQUE INDEX uk_ia_tool_grant_active
    ON ia_tool_grant (app_id, user_id, tool_fqn, scope, conversation_id)
    NULLS NOT DISTINCT
    WHERE deleted = FALSE;

COMMENT ON INDEX uk_ia_tool_grant_active IS '用户工具授权活跃行唯一(撤销行不占键,同键可重授;R1 DEF-04 修复)';
