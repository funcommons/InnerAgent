package com.inneragent.platform.kb;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 外部知识库出站检索客户端(契约源 06-外部知识库API规范.md §3/§4):
 * {@code POST {endpointUrl}},body {@code {"query","topK","appId"}},
 * STATIC_HEADER 时随呼携带登记静态头;响应 {@code hits[{title,anchor,content,score?}]}。
 * 降级哲学(§1):任何失败——残缺登记、非 200、传输异常(超时不重试)、
 * 畸形 JSON、响应体超 1MB(§4)——一律该源零命中 + WARN,绝不抛出;命中超
 * topK 按序截断(不算错);宿主伪造的 {@code <kb_reference>} 标记剔除(§5)。
 * 超时 client 级可配(KbConfiguration,缺省 10s);逐源覆盖接线待 IT。
 */
@Slf4j
public class KbExternalRetrievalClient {

    /** 出站命中(§4):title/anchor 原样进引用来源,content 注入正文,score 仅排序参考。 */
    public record Hit(String title, String anchor, String content, Double score) {
    }

    /** 响应体上限(§4/§6:建议宿主自限 ≤1MB,超限按零命中)。 */
    private static final int MAX_BODY_BYTES = 1024 * 1024;

    /** topK 缺省(§3:默认 4)与钳制上限(§6:50,平台侧钳制)。 */
    private static final int DEFAULT_TOP_K = 4;
    private static final int MAX_TOP_K = 50;

    private final RestClient restClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public KbExternalRetrievalClient(RestClient restClient) {
        this.restClient = Objects.requireNonNull(restClient, "restClient must not be null");
    }

    /** 生产装配:client 级超时的请求工厂(webhook 侧 RestClientWebhookHttpSender 同型)。 */
    public static RestClient restClient(Duration timeout) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) timeout.toMillis());
        factory.setReadTimeout((int) timeout.toMillis());
        return RestClient.builder().requestFactory(factory).build();
    }

    /** 检索宿主端点;任何失败语义 = 空列表 + WARN,绝不抛出。 */
    public List<Hit> retrieve(IaKbExternal source, String query, Integer topK) {
        try {
            return doRetrieve(source, query, topK);
        } catch (Exception failure) {
            log.warn("外部知识库检索失败,按该源零命中: id={}, type={}, msg={}",
                    source.getId(), failure.getClass().getSimpleName(), failure.getMessage());
            return List.of();
        }
    }

    private List<Hit> doRetrieve(IaKbExternal source, String query, Integer topK) {
        String endpoint = source.getEndpointUrl();
        if (endpoint == null || endpoint.isBlank()) {
            log.warn("外部知识库端点缺失,不外呼,按该源零命中: id={}", source.getId());
            return List.of();
        }
        boolean staticHeader = "STATIC_HEADER".equals(source.getAuthType());
        String headerName = staticHeader ? source.getHeaderName() : null;
        String credentials = staticHeader ? source.getCredentials() : null;
        if (staticHeader && (headerName == null || headerName.isBlank()
                || credentials == null || credentials.isBlank())) {
            log.warn("静态头配置残缺(成对必填),不外呼,按该源零命中: id={}", source.getId());
            return List.of();
        }
        int safeTopK = normalizeTopK(topK);
        ObjectNode body = objectMapper.createObjectNode();
        body.put("query", query);
        body.put("topK", safeTopK);
        if (source.getAppId() != null) body.put("appId", source.getAppId());
        String responseBody = restClient.post()
                .uri(URI.create(endpoint.trim()))
                .headers(headers -> {
                    headers.setContentType(MediaType.APPLICATION_JSON);
                    if (staticHeader) {
                        headers.set(headerName.trim(), credentials);
                    }
                })
                .body(body.toString())
                .exchange((request, response) -> {
                    if (!response.getStatusCode().is2xxSuccessful()) {
                        log.warn("外部知识库非 200,按该源零命中: id={}, status={}",
                                source.getId(), response.getStatusCode().value());
                        return null;
                    }
                    return readCapped(response.getBody());
                });
        return parseHits(responseBody, safeTopK);
    }

    /** 有界读:超 1MB 上限即按零命中(不再读余量,防病态宿主拖垮内存)。 */
    private static String readCapped(InputStream body) throws IOException {
        byte[] bytes = body.readNBytes(MAX_BODY_BYTES + 1);
        if (bytes.length > MAX_BODY_BYTES) {
            log.warn("外部知识库响应体超 1MB 上限,按该源零命中");
            return null;
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }


    private List<Hit> parseHits(String responseBody, int topK) {
        if (responseBody == null) {
            return List.of();
        }
        try {
            JsonNode hits = objectMapper.readTree(responseBody).path("hits");
            if (!hits.isArray()) {
                log.warn("外部知识库响应 hits 非数组,按该源零命中");
                return List.of();
            }
            List<Hit> out = new ArrayList<>();
            for (JsonNode hit : hits) {
                String content = text(hit, "content");
                if (content == null || content.isBlank()) {
                    continue; // content 必填(§4):缺失分段直接丢弃
                }
                Double score = hit.path("score").isNumber() ? hit.path("score").asDouble() : null;
                out.add(new Hit(neutralize(text(hit, "title")),
                        neutralize(text(hit, "anchor")), neutralize(content), score));
            }
            return List.copyOf(out.size() > topK ? out.subList(0, topK) : out);
        } catch (Exception malformed) {
            log.warn("外部知识库响应解析失败,按该源零命中: {}", malformed.getMessage());
            return List.of();
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    /** 剔除宿主内容中的引用标记伪造成分(§5:平台已过滤,宿主返回干净字段更可靠)。 */
    private static String neutralize(String value) {
        if (value == null) {
            return null;
        }
        return value.replace("<kb_reference", "").replace("</kb_reference>", "");
    }

    private static int normalizeTopK(Integer topK) {
        return Math.max(1, Math.min(topK == null ? DEFAULT_TOP_K : topK, MAX_TOP_K));
    }
}
