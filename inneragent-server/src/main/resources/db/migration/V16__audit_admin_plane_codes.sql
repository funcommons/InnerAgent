-- =====================================================================
-- InnerAgent V16 (P2-W5):ia_audit_log 决策码值注释刷新(管理面定义变更)。
-- 内容:随「Agent 定义导入导出与提示词编辑」新增的两类审计写入
--   * decision   = definition-updated / definition-imported
--                 (提示词编辑 / 覆盖导入与新建导入,均经 ToolAuditService)
--   * decision_source = admin(管理面直接写操作来源,ToolDecisionSource.ADMIN)
-- 仅列注释刷新(V12「注释即值域真源」先例),列宽均已满足
-- (decision VARCHAR(32) ≥ 19 字符;decision_source VARCHAR(24) ≥ 5 字符),
-- 无数据变更、无 DDL 结构变更。
-- =====================================================================

COMMENT ON COLUMN ia_audit_log.decision IS
    '裁决结果:allowed/denied(确认流);granted/revoked/invalidated(授权生命周期);tool_disabled/tool_deleted(注册);risk_upgraded(风险升级);schema_compatible/schema_breaking/schema_revalidated(分诊);definition-updated/definition-imported(定义管理)';

COMMENT ON COLUMN ia_audit_log.decision_source IS
    '裁决来源:mode-default/user-grant/forced-policy/live-confirm/expired/full-access;admin(管理面定义变更:提示词编辑/导入导出)';
