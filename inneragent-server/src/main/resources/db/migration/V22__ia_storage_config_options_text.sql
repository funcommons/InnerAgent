-- =====================================================================
-- InnerAgent V22:ia_storage_config.options JSONB → TEXT(DEF-08 同族修复)
--
-- 背景(收尾批次台账):V5 以 PG JSONB 落 options 列,实体侧配
-- platform/common/handler/JsonbTypeHandler——该 handler 为 MySQL 形
-- (ps.setString → varchar),而运行态连接串(application.yml / 部署环境)无
-- stringtype=unspecified → 携带该列的 ia_storage_config 写入全链失败
--   * POST   /admin/storage-configs(create,INSERT)
--   * PUT    /admin/storage-configs/{id}(updateById 整行)
--   * PUT    /admin/storage-configs/{id}/default(setDefault 复用整行更新)
--   * 条件更新(LambdaUpdateWrapper 定向 SET options)
-- 与 R3 DEF-08(ia_app.circuit_limits_json)同族。既有 StorageConfigServiceIT
-- 未拦住:其 Testcontainers 连接串追加了 stringtype=unspecified,与运行态
-- 不同形(StorageConfigWritePathsIT 即按运行态同形连接串补建的永久守卫)。
--
-- 取舍(照 V15 先例):弃「保留 JSONB + PG 绑定修复」(PGobject 包装或连接串
-- 参数都会让实体层耦合 PG 方言/部署环境),改 TEXT 列 + 实体纯 String——
-- JSON 序列化/解析收敛在服务层 StorageConfigOptions/S3StorageConfigResolver,
-- 零 JDBC 方言耦合。列值语义不变(厂商扩展配置 JSON 文本;存量 jsonb 数据经
-- ::text 转为其规范文本形,fromJson/readTree 解析不受空格/键序影响)。
-- =====================================================================

ALTER TABLE ia_storage_config ALTER COLUMN options TYPE TEXT
    USING options::text;

COMMENT ON COLUMN ia_storage_config.options IS
    '厂商扩展配置 JSON 文本(TEXT;V22 起,DEF-08 同族修复:实体纯 String,序列化在服务层;pathStyleAccessEnabled / signingRegion 等)';
