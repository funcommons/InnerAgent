-- V8 (P2-srv U1 遗留):确认流超时系统裁决的 decision_source 独立值。
-- 过期语义裁定:过期 = denied,decision_source = 'expired'(与用户/模式路径区分,
-- 见 ToolDecisionSource.EXPIRED 与 AgentConfirmationExpiryCoordinator 审计接线)。
-- 列为 VARCHAR(24),仅刷新注释对齐应用层值域;无数据/结构变更。
COMMENT ON COLUMN ia_audit_log.decision_source IS
    '裁决来源:mode-default/user-grant/forced-policy/live-confirm/expired/full-access';
