package com.inneragent.platform.kb;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * OpenAI 兼容 KB 向量客户端(可选语义层;升级战役 D2)。
 *
 * <p>{@code semantic.endpoint} 即 embeddings 完整 URL(不做 baseUrl/path
 * 拼接,与 MCP 三方注册的 endpoint_url 同一口径),请求形如
 * {@code POST endpoint} + {@code Authorization: Bearer <api-key>} +
 * body {@code {model, input}};按 {@code data[].index} 还原输入顺序
 * (服务端并发下发常见乱序),按 {@code batch-size} 切分多次外呼,
 * 空输入短路零外呼。HTTP 失败与畸形响应统一抛 {@link KbEmbeddingException}
 * (畸形指缺 {@code data} 数组、{@code index} 越界/缺失、{@code embedding}
 * 分量非数值——Jackson 宽松转换会吞错,须显式校验数值类型)。
 */
public class OpenAiCompatibleKbEmbeddingClient implements KbEmbeddingPort {

    private final KbProperties properties;
    private final RestClient restClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public OpenAiCompatibleKbEmbeddingClient(KbProperties properties, RestClient restClient) {
        this.properties = properties;
        this.restClient = restClient;
    }

    @Override
    public List<float[]> embed(List<String> texts) {
        if (texts == null || texts.isEmpty()) {
            return List.of();
        }
        KbProperties.Semantic semantic = properties.getSemantic();
        if (isBlank(semantic.getEndpoint()) || isBlank(semantic.getModel())) {
            throw new KbEmbeddingException(
                    "语义向量端点未配置(inneragent.kb.semantic.endpoint/model 缺失)");
        }
        int batchSize = Math.max(1, semantic.getBatchSize());
        List<float[]> vectors = new ArrayList<>(texts.size());
        for (int i = 0; i < texts.size(); i++) {
            vectors.add(null);
        }
        for (int from = 0; from < texts.size(); from += batchSize) {
            List<String> batch = texts.subList(from, Math.min(from + batchSize, texts.size()));
            embedBatch(semantic, batch, from, vectors);
        }
        return vectors;
    }

    /** 单批外呼:应答 {@code index} 为批内下标,按全量偏移位拼回。 */
    private void embedBatch(KbProperties.Semantic semantic, List<String> batch,
                            int offset, List<float[]> vectors) {
        String response;
        try {
            response = restClient.post()
                    .uri(semantic.getEndpoint())
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + semantic.getApiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("model", semantic.getModel(), "input", batch))
                    .retrieve()
                    .body(String.class);
        } catch (RestClientException failure) {
            throw new KbEmbeddingException("KB 向量外呼失败: " + failure.getMessage(), failure);
        }
        if (response == null || response.isBlank()) {
            throw new KbEmbeddingException("KB 向量响应为空");
        }
        JsonNode data;
        try {
            data = objectMapper.readTree(response).path("data");
        } catch (JsonProcessingException malformed) {
            throw new KbEmbeddingException("KB 向量响应不是合法 JSON", malformed);
        }
        if (!data.isArray() || data.isEmpty()) {
            throw new KbEmbeddingException("KB 向量响应缺 data 数组");
        }
        for (JsonNode entry : data) {
            int index = entry.path("index").asInt(-1);
            if (index < 0 || index >= batch.size()) {
                throw new KbEmbeddingException("KB 向量响应 index 越界: " + index);
            }
            vectors.set(offset + index, parseVector(entry.path("embedding")));
        }
        for (int i = 0; i < batch.size(); i++) {
            if (vectors.get(offset + i) == null) {
                throw new KbEmbeddingException("KB 向量响应缺 index=" + i);
            }
        }
    }

    /** embedding 数组 → float[](非数值分量显式拒绝,防宽松转换吞错)。 */
    private float[] parseVector(JsonNode embedding) {
        if (!embedding.isArray() || embedding.isEmpty()) {
            throw new KbEmbeddingException("KB 向量响应缺 embedding 数组");
        }
        float[] vector = new float[embedding.size()];
        for (int i = 0; i < embedding.size(); i++) {
            JsonNode component = embedding.get(i);
            if (!component.isNumber()) {
                throw new KbEmbeddingException("KB 向量分量非数值: " + component);
            }
            vector[i] = component.floatValue();
        }
        return vector;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
