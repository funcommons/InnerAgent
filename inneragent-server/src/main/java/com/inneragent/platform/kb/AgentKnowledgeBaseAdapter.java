package com.inneragent.platform.kb;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.agent.kb.AgentKnowledgeBasePort;
import com.inneragent.agent.mapper.AgentRunMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Objects;

/**
 * {@link AgentKnowledgeBasePort} 的平台实现(P4-W14 内核接线;依赖方向
 * 与 {@code AppSkillCatalogAdapter} 同范):retrieve 委托
 * {@link KbRetrievalService};recordRunCitations 将命中清单以 JSON(TEXT,
 * DEF-08 同款)落 {@code ia_agent_run.kb_citations_json},供终态 DONE
 * 事件投影回填引用溯源。
 */
@Component
@Slf4j
public class AgentKnowledgeBaseAdapter implements AgentKnowledgeBasePort {

    private final KbRetrievalService retrieval;
    private final AgentRunMapper runMapper;
    private final ObjectMapper objectMapper;

    public AgentKnowledgeBaseAdapter(KbRetrievalService retrieval,
                                     AgentRunMapper runMapper,
                                     ObjectMapper objectMapper) {
        this.retrieval = Objects.requireNonNull(retrieval, "retrieval must not be null");
        this.runMapper = Objects.requireNonNull(runMapper, "runMapper must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    @Override
    public List<KbHit> retrieve(long appId, String query, int topK) {
        return retrieval.search(appId, query, topK, null);
    }

    @Override
    public void recordRunCitations(String runId, long appId, List<KbHit> hits) {
        if (hits == null || hits.isEmpty()) {
            return;
        }
        ArrayNode array = JsonNodeFactory.instance.arrayNode();
        for (KbHit hit : hits) {
            ObjectNode node = array.addObject();
            node.put("chunkId", hit.chunkId());
            node.put("documentId", hit.documentId());
            node.put("documentTitle", hit.documentTitle());
            node.put("anchor", hit.anchor());
            node.put("seq", hit.seq());
        }
        String citationsJson;
        try {
            citationsJson = objectMapper.writeValueAsString(array);
        } catch (JsonProcessingException serializationFailure) {
            // 序列化失败仅放弃溯源展示,不影响运行
            log.warn("KB 引用清单序列化失败: runId={}", runId, serializationFailure);
            return;
        }
        int updated = runMapper.updateKbCitations(runId, appId, citationsJson);
        if (updated != 1) {
            log.warn("KB 引用清单落库未命中运行行: runId={}, updated={}", runId, updated);
        }
    }
}
