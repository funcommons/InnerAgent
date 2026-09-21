-- InnerAgent V24 (acme-demo 真机联调,DEF-08 家族「上下文相关缺口」收尾/灭族):
-- 全库盘点 AppTenantLineInnerInterceptor#IGNORED_TABLES 之外的 ia_ 业务表,
-- 一次性补齐全部缺失的 tenant_id 列(迁移约定 README:所有业务表携带
-- app_id 与 tenant_id)。此前 V23 只补了 ia_skill/ia_skill_file 两张,
-- 属挤牙膏式修复;本轮照 V1-V23 DDL 与 information_schema 口径全量清点,
-- 缺列名单(六张,均携带 app_id 故不能进 IGNORED_TABLES):
--   ia_tool_registry(V2 工具注册)、ia_tool_schema_history(V6 schema 历史)、
--   ia_storage_config(V5 存储配置)、ia_mcp_server_config(V18 三方 MCP 应用级)、
--   ia_kb_document / ia_kb_chunk(V20 mini KB)。
-- 缺列后果:请求线程携带租户上下文(如 embed token tenantId claim)时,
-- TenantIdLineHandler 对忽略清单外的表注入 tenant_id 条件 →
-- column "tenant_id" does not exist → 500。
-- 照 V23/V18 先例:NOT NULL DEFAULT 0,实体不映射,注入与归属由行级拦截器/
-- 上下文负责;纯加列,既有读写路径不破。

ALTER TABLE ia_tool_registry ADD COLUMN tenant_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ia_tool_schema_history ADD COLUMN tenant_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ia_storage_config ADD COLUMN tenant_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ia_mcp_server_config ADD COLUMN tenant_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ia_kb_document ADD COLUMN tenant_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ia_kb_chunk ADD COLUMN tenant_id BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN ia_tool_registry.tenant_id IS '所属租户(团队)ID(用户面请求经行级拦截器落值;V24 全库缺列灭族)';
COMMENT ON COLUMN ia_tool_schema_history.tenant_id IS '所属租户(团队)ID(用户面请求经行级拦截器落值;V24 全库缺列灭族)';
COMMENT ON COLUMN ia_storage_config.tenant_id IS '所属租户(团队)ID(用户面请求经行级拦截器落值;V24 全库缺列灭族)';
COMMENT ON COLUMN ia_mcp_server_config.tenant_id IS '所属租户(团队)ID(用户面请求经行级拦截器落值;V24 全库缺列灭族)';
COMMENT ON COLUMN ia_kb_document.tenant_id IS '所属租户(团队)ID(用户面请求经行级拦截器落值;V24 全库缺列灭族)';
COMMENT ON COLUMN ia_kb_chunk.tenant_id IS '所属租户(团队)ID(用户面请求经行级拦截器落值;V24 全库缺列灭族)';
