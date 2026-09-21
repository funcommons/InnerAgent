-- =====================================================================
-- InnerAgent V17 (P2-safety 批次②,合并时自 V16 顺延:主线 V16 已被审计码值注释占用):工具体检 v1 —— ia_tool_registry 体检位
--
-- W5「工具注册与体检 v1」(03-开发计划 §5.1)/ PRD §6.8 M8「工具体检」:
-- 对单个注册工具做健康检查(endpoint 可达 / toolName 在宿主清单 /
-- schema 指纹一致 / 注解与宿主上报 diff),结果落注册行供列表/详情回显。
--
-- 列:
--   health_status     VARCHAR(16)  最近一次体检结论:ok/degraded/unreachable;
--                                  NULL = 从未体检。
--   last_checked_at   TIMESTAMP    最近一次体检时间。
--   health_detail_json TEXT        体检明细 JSON(逐检查项 pass/drift + 建议)。
--
-- 教训落档(R3 DEF-08):JSON 明细一律 TEXT 存 JSON 字符串、序列化收敛在
-- 服务层——不用 JSONB:共享实体整行 UPDATE 携带该列时,MySQL 形
-- JsonbTypeHandler(ps.setString → varchar)在真实 PG jsonb 列上绑定失败
-- (运行态连接串无 stringtype=unspecified),全写路径 500。
-- 仅增列,无数据变更;全列可空,存量行语义 = 从未体检。
-- =====================================================================

ALTER TABLE ia_tool_registry
    ADD COLUMN health_status VARCHAR(16),
    ADD COLUMN last_checked_at TIMESTAMP,
    ADD COLUMN health_detail_json TEXT;

COMMENT ON COLUMN ia_tool_registry.health_status IS
    '最近一次工具体检结论:ok(全部通过)/degraded(可达但清单/指纹/注解漂移)/unreachable(endpoint 未配置或握手失败);NULL-从未体检';
COMMENT ON COLUMN ia_tool_registry.last_checked_at IS '最近一次工具体检时间(体检落库回读用)';
COMMENT ON COLUMN ia_tool_registry.health_detail_json IS
    '工具体检明细 JSON(TEXT 存 JSON 字符串,不用 JSONB——R3 DEF-08 教训):逐检查项(endpoint_reachable/tool_present/schema_fingerprint/annotations_diff)结论与整改建议';
