package com.inneragent.platform.kb;

import com.inneragent.agent.kb.AgentKnowledgeBasePort;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

/**
 * mini 知识库检索服务(P4-W14;SQL 全文 + 元数据过滤)。
 *
 * <p>查询入口:运行组装注入(经 {@link AgentKnowledgeBasePort} 的平台
 * 实现)与管理面检索调试接口共用本服务。空查询/空词位直接返回空列表
 * (=「无命中不注入」);查询文本截断至可配上限防 tsquery 膨胀;检索配置
 * 取 {@link KbSearchConfigResolver#effectiveConfig()}(Q4 降级统一收口)。
 */
@Service
public class KbRetrievalService {

    private final KbProperties properties;
    private final KbSearchConfigResolver searchConfig;
    private final KbChunkStore chunkStore;

    public KbRetrievalService(KbProperties properties,
                              KbSearchConfigResolver searchConfig,
                              KbChunkStore chunkStore) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.searchConfig = Objects.requireNonNull(searchConfig, "searchConfig must not be null");
        this.chunkStore = Objects.requireNonNull(chunkStore, "chunkStore must not be null");
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
        return chunkStore.search(
                appId, safeQuery, searchConfig.effectiveConfig(), sourceFilter, limit);
    }

    /** 当前生效检索配置(调试出参/可观测)。 */
    public String effectiveSearchConfig() {
        return searchConfig.effectiveConfig();
    }

    /** 是否发生降级(请求配置不可得,当前 simple 兜底)。 */
    public boolean degraded() {
        return searchConfig.degraded();
    }
}
