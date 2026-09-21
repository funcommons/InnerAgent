-- InnerAgent V23 (acme-demo 真机冒烟发现,DEF-08 家族「上下文相关缺口」兄弟):
-- ia_skill / ia_skill_file 缺 tenant_id 列。两表携带 app_id 且不在
-- AppTenantLineInnerInterceptor#IGNORED_TABLES(行级 app_id 隔离必需),
-- 用户面请求携带 embed token 的 tenantId 时 TenantIdLineHandler 会向查询
-- 注入 tenant_id 条件 → column "tenant_id" does not exist → 500。
-- 既有 IT 无租户上下文(注入被跳过)故未暴露;对齐 ia_feedback/ia_mcp_user_server
-- 先例补列(NOT NULL DEFAULT 0,实体不映射,注入与归属由拦截器/上下文负责)。

ALTER TABLE ia_skill ADD COLUMN tenant_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ia_skill_file ADD COLUMN tenant_id BIGINT NOT NULL DEFAULT 0;
