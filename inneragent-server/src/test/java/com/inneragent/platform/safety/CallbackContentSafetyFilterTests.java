package com.inneragent.platform.safety;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.safety.ContentSafetyFilter.Context;
import com.inneragent.platform.safety.ContentSafetyFilter.Direction;
import com.inneragent.platform.safety.ContentSafetyFilter.Verdict;
import com.inneragent.platform.safety.CallbackContentSafetyFilter.HttpCallback;
import com.inneragent.platform.safety.CallbackContentSafetyFilter.HttpCallback.Response;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 可配回调过滤器测试(W6):verdict 三态映射 + 请求体形状 + 内嵌 stub 对端的
 * 真实 HTTP 失败语义(超时/5xx/非法响应)在两档失败策略下的行为。
 */
class CallbackContentSafetyFilterTests {

    private static final Context CONTEXT = new Context(1L, 42L, "conv-9", "run-9");

    private final ObjectMapper mapper = new ObjectMapper();

    // ------------------------------------------------------------------
    // 桩对端(纯 HttpCallback 桩:verdict 三态/请求体捕获)
    // ------------------------------------------------------------------

    private final AtomicReference<String> capturedRequest = new AtomicReference<>();
    private HttpCallback stub;

    @BeforeEach
    void setUp() {
        stub = body -> {
            capturedRequest.set(body);
            return new Response(200, "{\"verdict\":\"allow\"}");
        };
    }

    private CallbackContentSafetyFilter filter(ContentSafetyProperties.FailurePolicy policy) {
        ContentSafetyProperties properties = new ContentSafetyProperties();
        properties.setEnabled(true);
        properties.setCallbackUrl("http://safety.example/audit");
        properties.setFailurePolicy(policy);
        return new CallbackContentSafetyFilter(properties, mapper, stub);
    }

    @Test
    @DisplayName("①verdict=allow → Allow;请求体形状 direction/text/context 齐备")
    void allowVerdictAndRequestShape() {
        Verdict verdict = filter(ContentSafetyProperties.FailurePolicy.FAIL_OPEN)
                .check(Direction.INGRESS, "你好", CONTEXT);

        assertThat(verdict).isInstanceOf(Verdict.Allow.class);
        JsonNode request = readTree(capturedRequest.get());
        assertThat(request.isObject()).isTrue();
        assertThat(request.path("direction").asText()).isEqualTo("ingress");
        assertThat(request.path("text").asText()).isEqualTo("你好");
        assertThat(request.path("context").path("appId").asLong()).isEqualTo(1L);
        assertThat(request.path("context").path("userId").asLong()).isEqualTo(42L);
        assertThat(request.path("context").path("conversationId").asText()).isEqualTo("conv-9");
        assertThat(request.path("context").path("runId").asText()).isEqualTo("run-9");
    }

    @Test
    @DisplayName("②verdict=redact → Redact(带脱敏文本)")
    void redactVerdictCarriesText() {
        stub = body -> new Response(200, "{\"verdict\":\"redact\",\"text\":\"王***\"}");

        Verdict verdict = filter(ContentSafetyProperties.FailurePolicy.FAIL_OPEN)
                .check(Direction.EGRESS, "王小明", CONTEXT);

        assertThat(verdict).isInstanceOf(Verdict.Redact.class);
        assertThat(((Verdict.Redact) verdict).text()).isEqualTo("王***");
    }

    @Test
    @DisplayName("③verdict=block → Block(reason 入裁决,可缺省)")
    void blockVerdictCarriesReason() {
        stub = body -> new Response(200, "{\"verdict\":\"block\",\"reason\":\"合规命中\"}");

        Verdict verdict = filter(ContentSafetyProperties.FailurePolicy.FAIL_OPEN)
                .check(Direction.INGRESS, "…", CONTEXT);
        assertThat(verdict).isInstanceOf(Verdict.Block.class);
        assertThat(((Verdict.Block) verdict).reason()).isEqualTo("合规命中");

        stub = body -> new Response(200, "{\"verdict\":\"block\"}");
        Verdict defaultReason = filter(ContentSafetyProperties.FailurePolicy.FAIL_OPEN)
                .check(Direction.INGRESS, "…", CONTEXT);
        assertThat(((Verdict.Block) defaultReason).reason()).isNotBlank();
    }

    @Test
    @DisplayName("④超时:fail-open 放行 / fail-closed block(内嵌挂起 stub,短超时)")
    void timeoutFollowsFailurePolicy() throws IOException {
        try (HangingSafetyStub hanging = HangingSafetyStub.start()) {
            ContentSafetyProperties properties = new ContentSafetyProperties();
            properties.setEnabled(true);
            properties.setCallbackUrl(hanging.url());
            properties.setTimeout(java.time.Duration.ofMillis(150));

            Verdict failOpen = new CallbackContentSafetyFilter(properties, mapper)
                    .check(Direction.INGRESS, "hello", CONTEXT);
            assertThat(failOpen).as("fail-open 超时放行").isInstanceOf(Verdict.Allow.class);

            properties.setFailurePolicy(ContentSafetyProperties.FailurePolicy.FAIL_CLOSED);
            Verdict failClosed = new CallbackContentSafetyFilter(properties, mapper)
                    .check(Direction.INGRESS, "hello", CONTEXT);
            assertThat(failClosed).as("fail-closed 超时按 block").isInstanceOf(Verdict.Block.class);
            assertThat(((Verdict.Block) failClosed).reason())
                    .isEqualTo(CallbackContentSafetyFilter.FAIL_CLOSED_REASON);
        }
    }

    @Test
    @DisplayName("⑤5xx / 非法响应:两档失败策略同④;redact 缺 text 视为失败")
    void serverErrorAndMalformedFollowPolicy() {
        stub = body -> new Response(503, "boom");
        assertThat(filter(ContentSafetyProperties.FailurePolicy.FAIL_OPEN)
                .check(Direction.EGRESS, "x", CONTEXT)).isInstanceOf(Verdict.Allow.class);
        assertThat(filter(ContentSafetyProperties.FailurePolicy.FAIL_CLOSED)
                .check(Direction.EGRESS, "x", CONTEXT)).isInstanceOf(Verdict.Block.class);

        stub = body -> new Response(200, "not-json");
        assertThat(filter(ContentSafetyProperties.FailurePolicy.FAIL_OPEN)
                .check(Direction.EGRESS, "x", CONTEXT)).isInstanceOf(Verdict.Allow.class);

        stub = body -> new Response(200, "{\"verdict\":\"redact\"}");
        assertThat(filter(ContentSafetyProperties.FailurePolicy.FAIL_OPEN)
                .check(Direction.EGRESS, "x", CONTEXT)).as("redact 缺 text 视为失败")
                .isInstanceOf(Verdict.Allow.class);

        stub = body -> new Response(200, "{\"verdict\":\"maybe\"}");
        assertThat(filter(ContentSafetyProperties.FailurePolicy.FAIL_CLOSED)
                .check(Direction.EGRESS, "x", CONTEXT)).isInstanceOf(Verdict.Block.class);
    }

    private static JsonNode readTree(String json) {
        try {
            return new ObjectMapper().readTree(json);
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    // ------------------------------------------------------------------
    // 内嵌挂起 stub(JDK HttpServer;读阻塞超过过滤器超时)
    // ------------------------------------------------------------------

    /** 收到请求后挂起 2s 再应答(远超 150ms 超时,制造确定性超时)。 */
    private static final class HangingSafetyStub implements AutoCloseable {

        private HttpServer server;

        static HangingSafetyStub start() throws IOException {
            HangingSafetyStub stub = new HangingSafetyStub();
            stub.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            stub.server.createContext("/audit", exchange -> {
                try {
                    Thread.sleep(2_000);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                byte[] body = "{\"verdict\":\"allow\"}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(body);
                }
            });
            stub.server.start();
            return stub;
        }

        String url() {
            return "http://127.0.0.1:" + server.getAddress().getPort() + "/audit";
        }

        @Override
        public void close() {
            if (server != null) {
                server.stop(0);
            }
        }
    }
}
