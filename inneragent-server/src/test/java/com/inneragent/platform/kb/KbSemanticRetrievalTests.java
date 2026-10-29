package com.inneragent.platform.kb;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.kb.AgentKnowledgeBasePort;
import com.inneragent.platform.kb.mapper.IaKbDocumentMapper;
import com.inneragent.platform.toolhub.ToolAuditService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * KB 语义检索融合与摄取接线单测(语义检索先导,红测先行;全 Mockito,
 * 无数据库):disabled 零行为、enabled RRF(k=60)融合排序、语义路径异常
 * 降级纯全文(降级哲学:检索失败不阻断)、摄取侧 embedding_json 的
 * TEXT+JSON 写入与失败不阻断。语义候选读取经
 * {@link KbChunkStore#semanticCandidates} 可 mock 出口(KbChunkStore 为
 * JdbcTemplate 直行,不 mock 真库)。
 */
class KbSemanticRetrievalTests {

    private static final long APP_ID = 7L;
    private static final long DOC_ID = 100L;

    private KbProperties properties;
    private KbChunkStore chunkStore;
    private KbEmbeddingPort embeddingPort;
    private KbRetrievalService retrieval;
    private KbIngestService ingest;
    private IaKbDocumentMapper documentMapper;

    @BeforeEach
    void setUp() {
        properties = new KbProperties();
        chunkStore = mock(KbChunkStore.class);
        embeddingPort = mock(KbEmbeddingPort.class);
        KbSearchConfigResolver searchConfig = mock(KbSearchConfigResolver.class);
        when(searchConfig.effectiveConfig()).thenReturn("simple");
        retrieval = new KbRetrievalService(properties, searchConfig, chunkStore, embeddingPort);
        documentMapper = mock(IaKbDocumentMapper.class);
        ingest = new KbIngestService(properties, searchConfig, documentMapper, chunkStore,
                mock(ToolAuditService.class), new ObjectMapper(), embeddingPort);
    }

    // ------------------------------------------------------------------
    // 检索融合
    // ------------------------------------------------------------------

    @Test
    void disabledSearchReturnsFullTextVerbatimWithZeroEmbeddingCalls() {
        List<AgentKnowledgeBasePort.KbHit> fullText = List.of(hit(1, 10), hit(2, 10));
        when(chunkStore.search(APP_ID, "查询", "simple", null, 4)).thenReturn(fullText);

        List<AgentKnowledgeBasePort.KbHit> result = retrieval.search(APP_ID, "查询", null, null);

        assertThat(result).containsExactlyElementsOf(fullText);
        verifyNoInteractions(embeddingPort);
        verify(chunkStore, never()).semanticCandidates(anyLong(), anyInt());
    }

    @Test
    void enabledSearchFusesSemanticAndFullTextRoutesByRRF() {
        properties.getSemantic().setEnabled(true);
        properties.getSemantic().setTopN(2);
        // 全文路由 topK=4:A(chunk1)第 1、B(chunk2)第 2
        when(chunkStore.search(APP_ID, "查询", "simple", null, 4))
                .thenReturn(List.of(hit(1, 10), hit(2, 10)));
        when(embeddingPort.embed(List.of("查询"))).thenReturn(List.of(new float[]{1f, 0f}));
        // 语义候选(余弦对 [1,0]):chunk3≈0.999 第 1、chunk1≈0.707 第 2、
        // chunk4=0.0 第 3(超出 semantic.topN=2,不得进入融合)
        when(chunkStore.semanticCandidates(APP_ID, 2)).thenReturn(List.of(
                embedded(1, new float[]{0.70710677f, 0.70710677f}),
                embedded(3, new float[]{0.999f, 0.0447f}),
                embedded(4, new float[]{0f, 1f})));

        List<AgentKnowledgeBasePort.KbHit> fused = retrieval.search(APP_ID, "查询", null, null);

        // RRF:k=60,A=1/61+1/62 双路命中 > C=1/61 语义第 1 > B=1/62 全文第 2
        assertThat(fused).extracting(AgentKnowledgeBasePort.KbHit::chunkId)
                .containsExactly(1L, 3L, 2L);
        assertThat(KbRetrievalService.rrf(1)).isCloseTo(1.0 / 61.0, within(1e-12));
        assertThat(KbRetrievalService.rrf(2)).isCloseTo(1.0 / 62.0, within(1e-12));
        assertThat(KbRetrievalService.rrf(1) + KbRetrievalService.rrf(2))
                .isGreaterThan(KbRetrievalService.rrf(1))
                .isGreaterThan(KbRetrievalService.rrf(2));
        verify(chunkStore).semanticCandidates(APP_ID, 2);
    }

    @Test
    void semanticEmbeddingFailureFallsBackToPureFullText() {
        properties.getSemantic().setEnabled(true);
        List<AgentKnowledgeBasePort.KbHit> fullText = List.of(hit(1, 10));
        when(chunkStore.search(APP_ID, "查询", "simple", null, 4)).thenReturn(fullText);
        when(embeddingPort.embed(anyList()))
                .thenThrow(new KbEmbeddingException("embedding endpoint down"));

        List<AgentKnowledgeBasePort.KbHit> result = retrieval.search(APP_ID, "查询", null, null);

        assertThat(result).containsExactlyElementsOf(fullText);
    }

    @Test
    void semanticCandidateReadFailureFallsBackToPureFullText() {
        properties.getSemantic().setEnabled(true);
        List<AgentKnowledgeBasePort.KbHit> fullText = List.of(hit(1, 10));
        when(chunkStore.search(APP_ID, "查询", "simple", null, 4)).thenReturn(fullText);
        when(embeddingPort.embed(anyList())).thenReturn(List.of(new float[]{1f, 0f}));
        when(chunkStore.semanticCandidates(anyLong(), anyInt()))
                .thenThrow(new IllegalStateException("candidate read failed"));

        List<AgentKnowledgeBasePort.KbHit> result = retrieval.search(APP_ID, "查询", null, null);

        assertThat(result).containsExactlyElementsOf(fullText);
    }

    @Test
    void enabledButQueryVectorUnavailableFallsBackToPureFullText() {
        properties.getSemantic().setEnabled(true);
        List<AgentKnowledgeBasePort.KbHit> fullText = List.of(hit(1, 10));
        when(chunkStore.search(APP_ID, "查询", "simple", null, 4)).thenReturn(fullText);
        when(embeddingPort.embed(anyList())).thenReturn(List.of());

        List<AgentKnowledgeBasePort.KbHit> result = retrieval.search(APP_ID, "查询", null, null);

        assertThat(result).containsExactlyElementsOf(fullText);
        verify(chunkStore, never()).semanticCandidates(anyLong(), anyInt());
    }

    @Test
    void cosineKnowsOrthogonalParallelAndOppositeVectors() {
        assertThat(KbRetrievalService.cosine(new float[]{1f, 0f}, new float[]{0f, 1f}))
                .isCloseTo(0f, within(1e-6f));
        assertThat(KbRetrievalService.cosine(new float[]{2f, 0f}, new float[]{1f, 0f}))
                .isCloseTo(1f, within(1e-6f));
        assertThat(KbRetrievalService.cosine(new float[]{1f, 0f}, new float[]{-1f, 0f}))
                .isCloseTo(-1f, within(1e-6f));
    }

    // ------------------------------------------------------------------
    // 摄取接线(embedding_json)
    // ------------------------------------------------------------------

    @Test
    void ingestWritesEmbeddingJsonAsFloatArrayWhenEnabled() throws Exception {
        properties.getSemantic().setEnabled(true);
        String content = "字".repeat(15);
        List<String> chunkTexts = new DocumentChunker(10, 0).chunk(content).stream()
                .map(DocumentChunker.Chunk::content).toList();
        assertThat(chunkTexts).hasSize(2);
        stubImportRow();
        when(chunkStore.insertChunks(eq(APP_ID), eq(DOC_ID), anyString(), anyList()))
                .thenReturn(List.of(11L, 12L));
        when(embeddingPort.embed(chunkTexts)).thenReturn(List.of(
                new float[]{0.1f, 0.2f}, new float[]{0.3f, 0.4f}));

        ingest.importDocument(APP_ID, "员工手册", "hr", content, null, 10, 0, 9L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<Long, String>> captor =
                ArgumentCaptor.forClass((Class<Map<Long, String>>) (Class<?>) Map.class);
        verify(chunkStore).storeEmbeddings(eq(APP_ID), eq(DOC_ID), captor.capture());
        Map<Long, String> embeddingJsonByChunkId = captor.getValue();
        assertThat(embeddingJsonByChunkId).containsOnlyKeys(11L, 12L);
        JsonNode first = new ObjectMapper().readTree(embeddingJsonByChunkId.get(11L));
        assertThat(first.isArray()).isTrue();
        assertThat(first.size()).isEqualTo(2);
        assertThat(first.get(0).asDouble()).isCloseTo(0.1, within(1e-6));
        assertThat(first.get(1).asDouble()).isCloseTo(0.2, within(1e-6));
        JsonNode second = new ObjectMapper().readTree(embeddingJsonByChunkId.get(12L));
        assertThat(second.get(0).asDouble()).isCloseTo(0.3, within(1e-6));
        assertThat(second.get(1).asDouble()).isCloseTo(0.4, within(1e-6));
    }

    @Test
    void ingestEmbeddingFailureStillStoresChunksWithoutEmbedding() {
        properties.getSemantic().setEnabled(true);
        String content = "字".repeat(15);
        stubImportRow();
        when(chunkStore.insertChunks(anyLong(), anyLong(), anyString(), anyList()))
                .thenReturn(List.of(11L, 12L));
        when(embeddingPort.embed(anyList()))
                .thenThrow(new KbEmbeddingException("boom"));

        KbIngestService.KbDocumentView view =
                ingest.importDocument(APP_ID, "员工手册", "hr", content, null, 10, 0, 9L);

        assertThat(view.chunkCount()).isEqualTo(2);
        verify(chunkStore, never()).storeEmbeddings(anyLong(), anyLong(), anyMap());
    }

    @Test
    void ingestSkipsEmbeddingEntirelyWhenDisabled() {
        String content = "字".repeat(15);
        stubImportRow();
        when(chunkStore.insertChunks(anyLong(), anyLong(), anyString(), anyList()))
                .thenReturn(List.of(11L, 12L));

        KbIngestService.KbDocumentView view =
                ingest.importDocument(APP_ID, "员工手册", "hr", content, null, 10, 0, 9L);

        assertThat(view.chunkCount()).isEqualTo(2);
        verifyNoInteractions(embeddingPort);
        verify(chunkStore, never()).storeEmbeddings(anyLong(), anyLong(), anyMap());
    }

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    /** 主行落库:mock insert 回填自增 id(复刻 MyBatis-Plus keygen)。 */
    private void stubImportRow() {
        when(documentMapper.countDocuments(APP_ID)).thenReturn(0L);
        when(documentMapper.insert(any(IaKbDocument.class))).thenAnswer(invocation -> {
            ((IaKbDocument) invocation.getArgument(0)).setId(DOC_ID);
            return 1;
        });
    }

    private static AgentKnowledgeBasePort.KbHit hit(long chunkId, long documentId) {
        return new AgentKnowledgeBasePort.KbHit(
                chunkId, documentId, "文档" + documentId, null, 0, "内容" + chunkId);
    }

    private static KbChunkStore.EmbeddedChunk embedded(long chunkId, float[] embedding) {
        return new KbChunkStore.EmbeddedChunk(
                chunkId, 10L, "文档10", null, 0, "内容" + chunkId, embedding);
    }
}
