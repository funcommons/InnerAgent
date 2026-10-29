package com.inneragent.platform.kb;

import com.inneragent.agent.kb.AgentKnowledgeBasePort;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * mini 知识库检索服务(P4-W14;SQL 全文 + 元数据过滤;升级战役 D2 起可选
 * 语义融合)。
 *
 * <p>查询入口:运行组装注入(经 {@link AgentKnowledgeBasePort} 的平台
 * 实现)与管理面检索调试接口共用本服务。空查询/空词位直接返回空列表
 * (=「无命中不注入」);查询文本截断至可配上限防 tsquery 膨胀;检索配置
 * 取 {@link KbSearchConfigResolver#effectiveConfig()}(Q4 降级统一收口)。
 *
 * <p>可选语义层:{@code semantic.enabled}(缺省 false)时纯全文路径
 * 逐字节不变、零外呼;开启后查询向量可得则并行走语义路(余弦排序取
 * topN)与全文路,RRF(k=60)按 chunkId 融合重排——同段双路命中分数相加
 * 自然靠前。embed/候选读取/解析任一异常降级纯全文并 WARN(降级哲学:
 * 检索失败不阻断)。
 */
@Service
@Slf4j
public class KbRetrievalService {

    /** RRF 常数 k(RRF@k;rank 从 1 起,score = 1/(k+rank))。 */
    private static final int RRF_K = 60;

    private final KbProperties properties;
    private final KbSearchConfigResolver searchConfig;
    private final KbChunkStore chunkStore;
    private final KbEmbeddingPort embeddingPort;

    public KbRetrievalService(KbProperties properties,
                              KbSearchConfigResolver searchConfig,
                              KbChunkStore chunkStore,
                              KbEmbeddingPort embeddingPort) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.searchConfig = Objects.requireNonNull(searchConfig, "searchConfig must not be null");
        this.chunkStore = Objects.requireNonNull(chunkStore, "chunkStore must not be null");
        this.embeddingPort = Objects.requireNonNull(embeddingPort, "embeddingPort must not be null");
    }

    /** 检索 top-k 命中(仅 active 且未删文档;空/空白查询 → 空列表)。 */
    public List<AgentKnowledgeBasePort.KbHit> search(
            long appId, String query, Integer topK, String sourceFilter) {
        String safeQuery = query == null ? "" : query.trim();
        if (safeQuery.isEmpty()) {
            return List.of();
        }
        if (safeQuery.length() > properties.getMaxQueryChars()) {
            safeQuery = safeQuery.substring(0, properties.getMaxQueryChars());
        }
        int limit = topK == null || topK <= 0
                ? properties.getRetrievalTopK()
                : Math.min(topK, 50);
        List<AgentKnowledgeBasePort.KbHit> fullText = chunkStore.search(
                appId, safeQuery, searchConfig.effectiveConfig(), sourceFilter, limit);
        if (!properties.getSemantic().isEnabled()) {
            return fullText;
        }
        try {
            return fuse(appId, safeQuery, fullText, limit);
        } catch (Exception degradation) {
            log.warn("KB 语义检索降级纯全文: appId={}, query={}", appId, safeQuery, degradation);
            return fullText;
        }
    }

    /** 语义路:查询向量 → 候选 → 余弦排序 topN → 与全文 RRF 融合。 */
    private List<AgentKnowledgeBasePort.KbHit> fuse(
            long appId, String safeQuery,
            List<AgentKnowledgeBasePort.KbHit> fullText, int limit) {
        KbProperties.Semantic semantic = properties.getSemantic();
        List<float[]> queryVectors = embeddingPort.embed(List.of(safeQuery));
        if (queryVectors.isEmpty()) {
            log.warn("KB 语义检索查询向量不可得,降级纯全文: appId={}", appId);
            return fullText;
        }
        float[] queryVector = queryVectors.get(0);
        List<KbChunkStore.EmbeddedChunk> ranked = chunkStore
                .semanticCandidates(appId, semantic.getTopN())
                .stream()
                .sorted(Comparator
                        .comparingDouble((KbChunkStore.EmbeddedChunk chunk) ->
                                cosine(queryVector, chunk.embedding())).reversed()
                        .thenComparing(KbChunkStore.EmbeddedChunk::chunkId))
                .limit(semantic.getTopN())
                .toList();

        Map<Long, AgentKnowledgeBasePort.KbHit> merged = new LinkedHashMap<>();
        Map<Long, Double> scores = new LinkedHashMap<>();
        for (int rank = 0; rank < fullText.size(); rank++) {
            AgentKnowledgeBasePort.KbHit hit = fullText.get(rank);
            merged.putIfAbsent(hit.chunkId(), hit);
            scores.merge(hit.chunkId(), rrf(rank + 1), Double::sum);
        }
        for (int rank = 0; rank < ranked.size(); rank++) {
            KbChunkStore.EmbeddedChunk chunk = ranked.get(rank);
            merged.putIfAbsent(chunk.chunkId(), new AgentKnowledgeBasePort.KbHit(
                    chunk.chunkId(), chunk.documentId(), chunk.documentTitle(),
                    chunk.anchor(), chunk.seq(), chunk.content()));
            scores.merge(chunk.chunkId(), rrf(rank + 1), Double::sum);
        }
        List<AgentKnowledgeBasePort.KbHit> fused = new ArrayList<>(merged.values());
        fused.sort(Comparator
                .comparingDouble((AgentKnowledgeBasePort.KbHit hit) ->
                        scores.get(hit.chunkId())).reversed()
                .thenComparing(AgentKnowledgeBasePort.KbHit::chunkId));
        return fused.subList(0, Math.min(fused.size(), limit));
    }

    /** 当前生效检索配置(调试出参/可观测)。 */
    public String effectiveSearchConfig() {
        return searchConfig.effectiveConfig();
    }

    /** 是否发生降级(请求配置不可得,当前 simple 兜底)。 */
    public boolean degraded() {
        return searchConfig.degraded();
    }

    /** RRF 单路得分(rank 从 1 起;1/(k+rank),k=60)。 */
    static double rrf(int rank) {
        return 1.0 / (RRF_K + rank);
    }

    /** 余弦相似度(零向量/维度不齐按 0 处理,防 NaN,不做异常上抛)。 */
    static float cosine(float[] a, float[] b) {
        float dot = 0f;
        float normA = 0f;
        float normB = 0f;
        int size = Math.min(a.length, b.length);
        for (int i = 0; i < size; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA == 0f || normB == 0f) {
            return 0f;
        }
        return (float) (dot / (Math.sqrt(normA) * Math.sqrt(normB)));
    }
}
