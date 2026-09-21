-- =====================================================================
-- InnerAgent V15:ia_app.circuit_limits_json JSONB → TEXT(DEF-08 修复)
--
-- 背景(R3 验证轮 DEF-08,P1 服务端回归):V14 以 PG JSONB 落列,实体侧配
-- platform/common/handler/JsonbTypeHandler——该 handler 为 MySQL 形
-- (ps.setString → varchar),而运行态连接串(application.yml / 部署环境)无
-- stringtype=unspecified → 任何携带该列的 ia_app UPDATE 全链 500
--   * PUT  /admin/circuit-breaker/limits
--   * POST /admin/circuit-breaker/emergency-stop
--   * POST /admin/circuit-breaker/resume
--   * PUT  /admin/webhooks/config
--   * PUT  /admin/apps/{id}(公钥轮换——R2 全绿用例被本批次打回 REGRESSED)
-- 单测未拦住:Mockito 切片不盖真实 PG 写路径;既有 IT 未拦住:Testcontainers
-- 连接串普遍追加 stringtype=unspecified,与运行态不同形(AppRegistration-
-- WritePathsIT 即按运行态同形连接串补建的永久守卫)。
--
-- 取舍(2026-09-21):弃「保留 JSONB + PG 绑定修复」(PGobject 包装或连接串
-- 参数都会让实体层耦合 PG 方言/部署环境),改 TEXT 列 + 实体纯 String——
-- JSON 序列化/解析收敛在 CircuitBreakerLimits(服务层),零 JDBC 方言耦合。
-- 列值语义不变(CircuitBreakerLimits 7 字段 JSON 文本;存量 jsonb 数据经
-- ::text 转为其规范文本形,fromJson 解析不受空格/键序影响)。
-- =====================================================================

ALTER TABLE ia_app ALTER COLUMN circuit_limits_json DROP DEFAULT;
ALTER TABLE ia_app ALTER COLUMN circuit_limits_json TYPE TEXT
    USING circuit_limits_json::text;
ALTER TABLE ia_app ALTER COLUMN circuit_limits_json SET DEFAULT
    '{"maxToolCallsPerRun":32,"maxTokensPerRun":300000,"maxRunDurationMinutes":30,"toolRetryLimit":2,"mcpConcurrency":8,"mcpQps":20,"confirmTimeoutHours":24}';

COMMENT ON COLUMN ia_app.circuit_limits_json IS
    '熔断资源上限配置 JSON 文本(TEXT;V15 起,序列化在服务层 CircuitBreakerLimits;§4.7 默认,执行层接线待后续)';
