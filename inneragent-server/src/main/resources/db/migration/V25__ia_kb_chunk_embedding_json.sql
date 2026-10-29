-- InnerAgent V25 (升级战役 D2「KB 可选语义层」;V23/V24 已占用顺延至此):
-- ia_kb_chunk 增 embedding_json 列,mini KB 语义检索的向量落点。
--
-- 铁律(DEF-08 家族,V15/V20/V22 同款):新列一律 TEXT 存 JSON 字符串,
-- 不用 JSONB/pgvector——零 JDBC 方言耦合,序列化/解析收敛在服务层
-- (KbIngestService 写 float[] JSON 数组 / KbChunkStore 读回)。
-- mini 规模(单库 ≤1000 文档 × ≤2000 分段)JVM 余弦足够;不建向量索引,
-- 语义候选按 id 序限量取回内存重排。pgvector 升级路径(向量列类型、
-- ANN 索引与 SQL 侧余弦排序)见外部知识库规范 §7,届时另起迁移。
--
-- 缺省 NULL = 未向量化(纯全文检索,现路径零改动);semantic.enabled
-- (缺省 false)时摄取路径回写,失败亦留 NULL(分段照常入库,降级哲学:
-- 检索失败不阻断)。列可空、无默认值、无索引,既有读写路径零影响。

ALTER TABLE ia_kb_chunk ADD COLUMN embedding_json TEXT;

COMMENT ON COLUMN ia_kb_chunk.embedding_json IS
    '语义向量(TEXT 存 float[] JSON 数组,DEF-08 铁律;NULL=未向量化;pgvector 升级路径见外部知识库规范 §7,升级战役 D2)';
