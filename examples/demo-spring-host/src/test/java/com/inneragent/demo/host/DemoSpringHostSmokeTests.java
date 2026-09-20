package com.inneragent.demo.host;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.demo.host.testsupport.HostTestSupport.ActTokens;
import com.inneragent.demo.host.testsupport.HostTestSupport.JwksServer;
import com.inneragent.demo.host.testsupport.HostTestSupport.RawMcp;
import com.inneragent.starter.bridge.IaMcpServerBridge;
import java.net.http.HttpResponse;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * demo-spring-host 冒烟(P1 出口验收任务):不起真主服务——
 * starter 的 JWKS 拉取指向本地 stub;act 验签走真实 RS256 + aud 精确匹配。
 * 覆盖:①上下文启动 + 桥内两工具注册数;②带验签 act token 的 tools/call 在
 * 宿主进程内执行(内存仓/claims 观测);③匿名 fail-closed 401;④错 aud 401。
 * aud 使用生产同值 http://localhost:18091/ia-mcp(即注册进主服务的 endpoint_url)。
 */
@SpringBootTest(classes = DemoSpringHostApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "inneragent.bridge.act.audiences=http://localhost:18091/ia-mcp",
                // 错 aud 用例会换 JWKS key 集:未知 kid 立即强制刷新(starter 测试同款)
                "inneragent.bridge.act.forced-refresh-cooldown=0s"})
class DemoSpringHostSmokeTests {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String AUDIENCE = "http://localhost:18091/ia-mcp";

    private static final JwksServer JWKS = new JwksServer();
    private static final ActTokens TOKENS = new ActTokens(AUDIENCE);

    @LocalServerPort
    int port;

    @Autowired
    IaMcpServerBridge bridge;

    @Autowired
    HostRecordStore store;

    @BeforeAll
    static void startJwks() throws Exception {
        JWKS.start();
        JWKS.setKeys(TOKENS.publicJwk());
    }

    @AfterAll
    static void stopJwks() {
        JWKS.stop();
    }

    @DynamicPropertySource
    static void bridgeProperties(DynamicPropertyRegistry registry) {
        registry.add("inneragent.bridge.server-base", JWKS::base);
    }

    @Test
    void contextStartsAndBridgeRegistersExactlyTheTwoHostTools() {
        assertThat(this.bridge.registeredTools())
                .containsExactlyInAnyOrder("get_host_time", "create_host_record");
    }

    @Test
    void verifiedActTokenCallExecutesWriteToolInHostProcess() throws Exception {
        String runTag = "smoke-" + System.nanoTime();
        HttpResponse<String> response = RawMcp.post(baseUrl() + "/ia-mcp", TOKENS.issue("10001", runTag),
                RawMcp.toolsCall("create_host_record", Map.of("title", "验收记录", "content", "smoke")));

        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode result = JSON.readTree(response.body()).path("result");
        assertThat(result.path("isError").asBoolean(false)).isFalse();
        JsonNode structured = result.path("structuredContent");
        assertThat(structured.path("status").asText()).isEqualTo("ok");
        String recordId = structured.path("recordId").asText();
        assertThat(recordId).startsWith("rec-");
        // act claims(验签通过)到达工具并落内存仓 —— 宿主进程执行证据
        assertThat(structured.path("createdBy").asText()).isEqualTo("10001");
        assertThat(structured.path("runId").asText()).isEqualTo(runTag);
        assertThat(this.store.find(recordId)).isNotNull();
        JsonNode claims = JSON.readTree(JSON.writeValueAsString(this.store.snapshot()))
                .path("lastClaims").path("create_host_record");
        assertThat(claims.path("userId").asText()).isEqualTo("10001");
        assertThat(claims.path("actSub").asText()).isEqualTo("inneragent-run:" + runTag);
        assertThat(claims.path("tenantId").asText()).isEqualTo("7");
        assertThat(claims.path("appKey").asText()).isEqualTo("demo-app");
        assertThat(claims.path("toolName").asText()).isEqualTo("mcp__demo-spring-host__create_host_record");
    }

    @Test
    void verifiedActTokenCallExecutesReadToolInHostProcess() throws Exception {
        String runTag = "smoke-read-" + System.nanoTime();
        HttpResponse<String> response = RawMcp.post(baseUrl() + "/ia-mcp", TOKENS.issue("10001", runTag),
                RawMcp.toolsCall("get_host_time", Map.of()));

        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode structured = JSON.readTree(response.body()).path("result").path("structuredContent");
        assertThat(structured.path("status").asText()).isEqualTo("ok");
        assertThat(structured.path("time").asText()).isNotBlank();
        assertThat(structured.path("userId").asText()).isEqualTo("10001");
    }

    @Test
    void anonymousRequestFailsClosed401() throws Exception {
        HttpResponse<String> anonymous = RawMcp.post(baseUrl() + "/ia-mcp", null, RawMcp.toolsList());
        assertThat(anonymous.statusCode()).isEqualTo(401);
        assertThat(JSON.readTree(anonymous.body()).path("error").asText()).isEqualTo("invalid_act_token");
    }

    @Test
    void wrongAudienceTokenFailsClosed401() throws Exception {
        // 默认占位 aud(ia-mcp)≠ 注册 endpoint_url —— 配置错位即 401(任务卡强调的对齐点)
        ActTokens misaligned = new ActTokens("ia-mcp");
        JWKS.setKeys(misaligned.publicJwk());
        try {
            HttpResponse<String> rejected = RawMcp.post(baseUrl() + "/ia-mcp",
                    misaligned.issue("10001", "wrong-aud"), RawMcp.toolsList());
            assertThat(rejected.statusCode()).isEqualTo(401);
        }
        finally {
            JWKS.setKeys(TOKENS.publicJwk());
        }
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + this.port;
    }

}
