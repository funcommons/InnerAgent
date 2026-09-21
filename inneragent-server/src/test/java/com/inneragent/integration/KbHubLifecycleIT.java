package com.inneragent.integration;

import com.inneragent.agent.kb.AgentKnowledgeBasePort;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.kb.KbChunkStore;
import com.inneragent.platform.kb.KbIngestService;
import com.inneragent.platform.kb.KbIngestService.KbDocumentView;
import com.inneragent.platform.kb.KbRetrievalService;
import com.inneragent.platform.kb.KbSearchConfigResolver;
import com.inneragent.platform.kb.mapper.IaKbDocumentMapper;
import com.inneragent.platform.toolhub.ToolAuditLog;
import com.inneragent.platform.toolhub.mapper.ToolAuditLogMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * mini 知识库全旅程真库集成测试(P4-W14;ia_kb_document/ia_kb_chunk 实表,
 * Testcontainers PG 17,Flyway 全链迁移含 V20)。
 *
 * <p>旅程:V20 表结构/索引/运行留痕列就位 → 摄取(文本导入→分块→tsvector
 * 落列)→ 中文词命中(bigram 字面近似)+ 西文命中 + 来源字段(文档名/章节
 * 锚点/seq)→ 无命中不返回 → top-k 截断 → 失效文档退出检索、恢复复得 →
 * 删除(软删主行+分段清理)→ 更新重分块 → 重建索引 → 文档数上限边界
 * (可配缩至 5:第 6 个 409 明确提示拆库)→ 审计留痕(复用码值)。
 *
 * <p>Q4 降级:普通 postgres:17-alpine 无 zhparser 文本检索配置,启动探测
 * 应自动降级 simple 并置 degraded 标记(配置不可得路径在真实 PG 上验证)。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class KbHubLifecycleIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            "postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "kb-hub-node");
        // 1000 文档上限缩至 5 做边界测试(PRD 单库 ≤1000 文档;全部可配)
        properties.add("inneragent.kb.max-documents-per-app", () -> "5");
        // 请求 zhparser(普通镜像不可得)以验证 Q4 自动降级路径
        properties.add("inneragent.kb.search-config", () -> "zhparser");
    }

    @Autowired
    private KbIngestService ingestService;

    @Autowired
    private KbRetrievalService retrievalService;

    @Autowired
    private KbSearchConfigResolver searchConfigResolver;

    @Autowired
    private IaKbDocumentMapper documentMapper;

    @Autowired
    private KbChunkStore chunkStore;

    @Autowired
    private ToolAuditLogMapper auditMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @AfterEach
    void resetAppContext() {
        AppContext.setAppId(null);
    }

    @Test
    void v20SchemaIsInPlaceAndResolverDegradesOnPlainPostgres() {
        // V20 两表就位
        assertThat(tableExists("ia_kb_document")).isTrue();
        assertThat(tableExists("ia_kb_chunk")).isTrue();
        // tsv 为 TSVECTOR 全文索引列(实体不映射,服务端计算)
        assertThat(columnType("ia_kb_chunk", "tsv")).isEqualTo("tsvector");
        // metadata_json 为 TEXT(DEF-08:禁 JSONB)
        assertThat(columnType("ia_kb_document", "metadata_json")).isEqualTo("text");
        // GIN 索引与分段唯一键
        assertThat(indexExists("idx_ia_kb_chunk_tsv")).isTrue();
        assertThat(indexExists("uk_ia_kb_chunk_doc_seq")).isTrue();
        // 运行引用留痕列(TEXT,ia_agent_run)
        assertThat(columnType("ia_agent_run", "kb_citations_json")).isEqualTo("text");

        // Q4:普通 PG 镜像无 zhparser 文本检索配置 → 自动降级 simple + WARN
        assertThat(searchConfigResolver.effectiveConfig())
                .isEqualTo(KbSearchConfigResolver.SIMPLE);
        assertThat(searchConfigResolver.degraded()).isTrue();
        assertThat(retrievalService.effectiveSearchConfig())
                .isEqualTo(KbSearchConfigResolver.SIMPLE);
    }

    @Test
    void chineseAndLatinIngestSearchRoundtripCarriesSourceFields() {
        AppContext.setAppId(11L);
        KbDocumentView doc = ingestService.importDocument(
                11L,
                "员工手册.md",
                "upload",
                "# 请假流程\n事假需要提前一天申请,年假按司龄折算。\n\n# 合同模板\n"
                        + "合同条款以双方签署的正式文本为准。\n",
                "{\"type\":\"hr\"}",
                null, null, 9L);

        // 分段落列:主行分段数与分段行一致;锚点保留章节
        assertThat(doc.chunkCount()).isEqualTo(2);
        List<KbChunkStore.ChunkRow> rows = chunkStore.listChunks(11L, doc.id());
        assertThat(rows).hasSize(2);
        assertThat(rows).extracting(KbChunkStore.ChunkRow::seq).containsExactly(0, 1);

        // 中文词命中:跨词「合同条款」命中(二元切分字面近似)
        List<AgentKnowledgeBasePort.KbHit> hits =
                retrievalService.search(11L, "合同条款", null, null);
        assertThat(hits).hasSize(1);
        AgentKnowledgeBasePort.KbHit hit = hits.getFirst();
        assertThat(hit.chunkId()).isPositive();
        assertThat(hit.documentId()).isEqualTo(doc.id());
        assertThat(hit.documentTitle()).isEqualTo("员工手册.md");
        assertThat(hit.anchor()).isEqualTo("合同模板");
        assertThat(hit.seq()).isEqualTo(1);
        assertThat(hit.content()).contains("合同条款");

        // 子词命中:「年假」命中第 0 段(锚点=请假流程)
        List<AgentKnowledgeBasePort.KbHit> annualHits =
                retrievalService.search(11L, "年假怎么请", null, null);
        assertThat(annualHits).hasSize(1);
        assertThat(annualHits.getFirst().seq()).isZero();
        assertThat(annualHits.getFirst().anchor()).isEqualTo("请假流程");

        // 西文词原样命中(二元切分不伤拉丁词)
        ingestService.importDocument(11L, "leave-policy.md", "upload",
                "Leave policy: annual leave is accrued monthly.", null, null, null, null);
        assertThat(retrievalService.search(11L, "annual leave accrued", null, null))
                .anySatisfy(h -> assertThat(h.documentTitle()).isEqualTo("leave-policy.md"));

        // 来源过滤(元数据过滤位)
        assertThat(retrievalService.search(11L, "合同条款", null, "upload")).hasSize(1);
        assertThat(retrievalService.search(11L, "合同条款", null, "web")).isEmpty();

        // 空查询 → 空列表(无命中不注入语义的检索侧)
        assertThat(retrievalService.search(11L, "  ", null, null)).isEmpty();
        assertThat(retrievalService.search(11L, "!!!。。。", null, null)).isEmpty();
    }

    @Test
    void inactiveAndDeletedDocsLeaveTheRetrievalCorpus() {
        AppContext.setAppId(12L);
        KbDocumentView doc = ingestService.importDocument(
                12L, "faq.md", "upload", "光伏发电补贴按季度发放。", null, null, null, null);

        assertThat(retrievalService.search(12L, "光伏发电补贴", null, null)).hasSize(1);

        // 失效(标黄)→ 退出检索;恢复 → 复得
        ingestService.setStatus(12L, doc.id(), false, 9L);
        assertThat(retrievalService.search(12L, "光伏发电补贴", null, null)).isEmpty();
        ingestService.setStatus(12L, doc.id(), true, 9L);
        assertThat(retrievalService.search(12L, "光伏发电补贴", null, null)).hasSize(1);

        // 删除:软删主行 + 分段物理清理
        ingestService.delete(12L, doc.id(), 9L);
        assertThat(retrievalService.search(12L, "光伏发电补贴", null, null)).isEmpty();
        assertThat(chunkStore.listChunks(12L, doc.id())).isEmpty();
        assertThat(documentMapper.countDocuments(12L)).isZero();
        assertThatThrownBy(() -> ingestService.get(12L, doc.id()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("不存在");
    }

    @Test
    void topKTruncatesHitCount() {
        AppContext.setAppId(13L);
        for (int i = 1; i <= 3; i++) {
            ingestService.importDocument(13L, "doc-" + i + ".md", "upload",
                    "光伏发电是清洁能源,第 " + i + " 号文档。", null, null, null, null);
        }
        // top-k 截断:3 个文档均含关键词,topK=2 只回 2
        List<AgentKnowledgeBasePort.KbHit> hits =
                retrievalService.search(13L, "光伏发电 清洁能源", 2, null);
        assertThat(hits).hasSize(2);
        assertThat(retrievalService.search(13L, "光伏发电 清洁能源", null, null)).hasSize(3);
    }

    @Test
    void updateRechunksAndRebuildKeepsIndexConsistent() {
        AppContext.setAppId(14L);
        KbDocumentView doc = ingestService.importDocument(
                14L, "spec.md", "upload", "旧版内容只讲比特币。", null, null, null, null);
        assertThat(retrievalService.search(14L, "比特币", null, null)).hasSize(1);

        // 带正文更新 → 整文档重分块,旧词退出、新词命中(缺省 500 字装箱:
        // 两段合一分段)
        KbDocumentView updated = ingestService.updateDocument(
                14L, doc.id(), null, null, null,
                "新版内容改讲以太坊。\n\n附带智能合约说明。", null, null, 9L);
        assertThat(updated.chunkCount()).isEqualTo(1);
        assertThat(retrievalService.search(14L, "比特币", null, null)).isEmpty();
        assertThat(retrievalService.search(14L, "以太坊 智能合约", null, null)).hasSize(1);

        // 重建索引:按当前生效配置重算 tsv,命中不受影响
        ingestService.rebuildIndex(14L, doc.id(), 9L);
        assertThat(retrievalService.search(14L, "以太坊 智能合约", null, null)).hasSize(1);

        // metadata 非对象形态拒绝
        assertThatThrownBy(() -> ingestService.updateDocument(
                14L, doc.id(), null, null, "[1,2]", null, null, null, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("metadata");
    }

    @Test
    void documentCapIsEnforcedWithExplicitSplitLibraryError() {
        long appId = 77L;
        AppContext.setAppId(appId);
        for (int i = 1; i <= 5; i++) {
            assertThat(ingestService.importDocument(appId, "cap-" + i + ".md",
                    "upload", "第 " + i + " 号上限边界文档。", null, null, null, null)
                    .id()).isPositive();
        }
        assertThat(documentMapper.countDocuments(appId)).isEqualTo(5L);

        // 第 6 个:409 明确报错并提示拆库(PRD:超限提示拆库)
        assertThatThrownBy(() -> ingestService.importDocument(appId, "cap-6.md",
                "upload", "第 6 号文档,应被拒绝。", null, null, null, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("上限 5")
                .hasMessageContaining("拆库")
                .extracting("code")
                .isEqualTo(409);

        // 删除一个后可再导(上限是库位数,不是累计数)
        PageResult<KbDocumentView> page = ingestService.page(appId, 1, 10);
        assertThat(page.getTotal()).isEqualTo(5L);
        ingestService.delete(appId, page.getList().getFirst().id(), 9L);
        assertThat(ingestService.importDocument(appId, "cap-6.md", "upload",
                "第 6 号文档,删除后导入成功。", null, null, null, null).id())
                .isPositive();
    }

    @Test
    void auditsReuseExistingDecisionCodesForKbOperations() {
        long appId = 78L;
        AppContext.setAppId(appId);
        KbDocumentView doc = ingestService.importDocument(
                appId, "audit.md", "upload", "审计留痕验证文档。", null, null, null, 9L);
        ingestService.setStatus(appId, doc.id(), false, 9L);
        ingestService.delete(appId, doc.id(), 9L);

        List<ToolAuditLog> rows = auditMapper.selectList(
                new LambdaQueryWrapper<ToolAuditLog>()
                        .eq(ToolAuditLog::getToolFqn, "kb:" + doc.id())
                        .orderByAsc(ToolAuditLog::getId));
        assertThat(rows).extracting(ToolAuditLog::getDecision)
                .containsExactly("definition-imported", "definition-updated",
                        "definition-updated");
        assertThat(rows).allSatisfy(row ->
                assertThat(row.getDecisionSource()).isEqualTo("admin"));
        assertThat(rows.getFirst().getParamsMaskedJson()).contains("\"title\":\"audit.md\"");
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private boolean tableExists(String table) {
        Long count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_name = ?",
                Long.class, table);
        return count != null && count > 0;
    }

    private String columnType(String table, String column) {
        return jdbcTemplate.queryForObject(
                "SELECT data_type FROM information_schema.columns "
                        + "WHERE table_schema = 'public' AND table_name = ? "
                        + "AND column_name = ?",
                String.class, table, column);
    }

    private boolean indexExists(String indexName) {
        Long count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pg_indexes "
                        + "WHERE schemaname = 'public' AND indexname = ?",
                Long.class, indexName);
        return count != null && count > 0;
    }
}
