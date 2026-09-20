-- V12 (P2 修复):ia_audit_log.decision 列宽从 VARCHAR(16) 放宽到 VARCHAR(32)。
-- 缺陷:MCP 真机旅程发现 POST /ia/api/v1/admin/tools/{id}/schema/confirm 的
-- BREAKING 确认写审计 decision='schema_revalidated'(18 字符)超 VARCHAR(16),
-- 审计 fail-closed 语义下确认端点 500。枚举实际值域(应用层写入):
--   allowed/denied(确认流)、granted/revoked/invalidated(授权生命周期)、
--   tool_disabled/tool_deleted(注册)、risk_upgraded(风险升级)、
--   schema_compatible/schema_breaking/schema_revalidated(schema 分诊)。
-- 放宽到 32 并刷新注释为真实值域,杜绝「枚举超列宽」整类问题;
-- decision_source 已是 VARCHAR(24) 不动。仅列宽与注释变更,无数据变更。
ALTER TABLE ia_audit_log ALTER COLUMN decision TYPE VARCHAR(32);

COMMENT ON COLUMN ia_audit_log.decision IS
    '裁决结果:allowed/denied(确认流);granted/revoked/invalidated(授权生命周期);tool_disabled/tool_deleted(注册);risk_upgraded(风险升级);schema_compatible/schema_breaking/schema_revalidated(分诊)';
