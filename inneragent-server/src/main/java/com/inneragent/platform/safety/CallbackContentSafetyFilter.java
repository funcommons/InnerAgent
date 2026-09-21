package com.inneragent.platform.safety;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * 可配回调过滤器(P2-safety W6):把裁决外呼给宿主/外部审核服务。
 *
 * <p>协议(POST {@code inneragent.safety.callback-url},application/json):
 * <pre>
 * 请求:{ "direction": "ingress|egress",
 *        "text": "待裁决文本",
 *        "context": { "appId": 1, "userId": 10001,
 *                     "conversationId": "uuid|null", "runId": "uuid|null" } }
 * 响应(2xx):{ "verdict": "allow|redact|block",
 *             "text": "脱敏后文本(verdict=redact 必填)",
 *             "reason": "block 原因(可选,仅入审计,不回显给终端用户)" }
 * </pre>
 *
 * <p>失败语义:非 2xx / 超时 / 不可达 / 响应非法(verdict 缺失或未知、
 * redact 未带 text)一律视为回调失败,按 {@code inneragent.safety.failure-policy}
 * 处理——fail-open(缺省):allow + WARN;fail-closed:block(固定原因,
 * 不透传异常细节)。
 */
@Slf4j
public class CallbackContentSafetyFilter implements ContentSafetyFilter {

    /** fail-closed 时的固定裁决原因(对外/审计同文案,不透传网络细节)。 */
    static final String FAIL_CLOSED_REASON = "safety callback unavailable (fail-closed)";

    private final ContentSafetyProperties properties;
    private final ObjectMapper objectMapper;
    private final HttpCallback callback;

    public CallbackContentSafetyFilter(ContentSafetyProperties properties,
                                       ObjectMapper objectMapper) {
        this(properties, objectMapper, defaultCallback(properties));
    }

    /** 测试注入替身用构造(内嵌 stub 对端以真 HTTP 覆盖,亦可纯桩)。 */
    CallbackContentSafetyFilter(ContentSafetyProperties properties,
                                ObjectMapper objectMapper,
                                HttpCallback callback) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.callback = Objects.requireNonNull(callback, "callback must not be null");
    }

    @Override
    public Verdict check(Direction direction, String text, Context context) {
        final String responseBody;
        try {
            HttpCallback.Response response = callback.post(requestJson(direction, text, context));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return onCallbackFailure(direction, new IllegalStateException(
                        "safety callback responded " + response.statusCode()));
            }
            responseBody = response.body();
        } catch (Exception transportFailure) {
            return onCallbackFailure(direction, transportFailure);
        }
        return mapResponse(direction, responseBody);
    }

    // ------------------------------------------------------------------
    // 请求装配 / 响应映射
    // ------------------------------------------------------------------

    private String requestJson(Direction direction, String text, Context context) {
        try {
            ObjectNode request = objectMapper.createObjectNode();
            request.put("direction", direction.code());
            request.put("text", text == null ? "" : text);
            ObjectNode ctx = request.putObject("context");
            ctx.put("appId", context == null ? 0L : context.appId());
            if (context == null || context.userId() == null) {
                ctx.putNull("userId");
            } else {
                ctx.put("userId", context.userId());
            }
            ctx.put("conversationId", context == null ? null : context.conversationId());
            ctx.put("runId", context == null ? null : context.runId());
            return objectMapper.writeValueAsString(request);
        } catch (Exception serializationFailure) {
            throw new IllegalStateException("安全回调请求体装配失败", serializationFailure);
        }
    }

    private Verdict mapResponse(Direction direction, String responseBody) {
        final String verdict;
        final String text;
        final String reason;
        try {
            JsonNode response = objectMapper.readTree(responseBody);
            if (response == null || !response.isObject()) {
                throw new IllegalArgumentException("response body is not a JSON object");
            }
            verdict = response.path("verdict").asText("");
            text = response.path("text").isTextual() ? response.path("text").asText() : null;
            reason = response.path("reason").isTextual() ? response.path("reason").asText() : null;
        } catch (Exception malformedResponse) {
            return onCallbackFailure(direction, malformedResponse);
        }
        return switch (verdict) {
            case "allow" -> Verdict.allow();
            case "redact" -> {
                if (text == null) {
                    yield onCallbackFailure(direction,
                            new IllegalArgumentException("redact verdict without text"));
                }
                yield Verdict.redact(text);
            }
            case "block" -> Verdict.block(reason == null ? "blocked by safety callback" : reason);
            default -> onCallbackFailure(direction,
                    new IllegalArgumentException("unknown verdict: " + verdict));
        };
    }

    /** 失败策略落点:fail-open → allow + WARN;fail-closed → block(固定原因)。 */
    private Verdict onCallbackFailure(Direction direction, Exception failure) {
        if (properties.getFailurePolicy() == ContentSafetyProperties.FailurePolicy.FAIL_CLOSED) {
            log.warn("安全回调失败(fail-closed 按 block 处理): direction={}, cause={}",
                    direction.code(), String.valueOf(failure.getMessage()));
            return Verdict.block(FAIL_CLOSED_REASON);
        }
        log.warn("安全回调失败(fail-open 放行): direction={}, cause={}",
                direction.code(), String.valueOf(failure.getMessage()));
        return Verdict.allow();
    }

    // ------------------------------------------------------------------
    // HTTP 对端(缺省:RestClient,超时取 inneragent.safety.timeout)
    // ------------------------------------------------------------------

    /** 单次回调调用(POST JSON,返回状态码 + 响应体原文;异常上抛由策略层处理)。 */
    public interface HttpCallback {

        /** 回调响应投影(状态码不检查,由过滤器按 2xx 语义归类)。 */
        record Response(int statusCode, String body) {
        }

        Response post(String requestBody) throws Exception;
    }

    private static HttpCallback defaultCallback(ContentSafetyProperties properties) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        long timeout = properties.getTimeout().toMillis();
        factory.setConnectTimeout((int) timeout);
        factory.setReadTimeout((int) timeout);
        RestClient restClient = RestClient.builder().requestFactory(factory).build();
        String url = properties.getCallbackUrl();
        return requestBody -> restClient.post()
                .uri(url)
                .contentType(MediaType.APPLICATION_JSON)
                .body(requestBody)
                .exchange((request, response) -> new HttpCallback.Response(
                        response.getStatusCode().value(),
                        new String(response.getBody().readAllBytes(),
                                StandardCharsets.UTF_8)));
    }
}
