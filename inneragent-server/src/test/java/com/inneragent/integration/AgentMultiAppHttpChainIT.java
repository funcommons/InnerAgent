package com.inneragent.integration;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.kernel.AgentKernelSpec;
import com.inneragent.agent.kernel.OwnedChatModel;
import com.inneragent.model.entity.AiModel;
import com.inneragent.model.mapper.AiModelMapper;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.context.UserContext;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.platform.security.SecurityUserDetails;
import com.inneragent.server.admin.AgentDefinitionAdminService;
import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.ChatModelBase;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.ToolSchema;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.security.SecurityProperties;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.filter.OncePerRequestFilter;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import reactor.core.publisher.Flux;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 多应用(app≠1)运行「真 HTTP 链」回归 IT(多应用运行 500 二轮根修)。
 *
 * <p>与 {@link AgentMultiAppRunContextIT}(直调 service,订阅恰在设置了
 * AppContext 的线程上)互补:本用例经真实 servlet 栈(Tomcat RANDOM_PORT,
 * 真 MVC 异步/SSE 路径)打 {@code POST /ia/api/v1/runs},由一个模拟 embed
 * 认证过滤器语义的测试过滤器在请求线程写入双层上下文——AppContext=34、
 * UserContext(10086, tenantId=0)(同步 TenantContext=0),并在请求返回
 * (异步化)后清理——与真机 EmbedTokenAuthenticationFilter 行为一致。
 *
 * <p>回归的缺陷(真机实证):embed 用户(token tenantId=0,app=34)发起运行,
 * 会话行租户为 0 而运行行被回落写成 1;journal 调度线程按环境租户 0 过滤,
 * RuntimeContext 装配按 run_id 回查 0 行不中 →「Agent run does not exist」
 * HTTP 500。且该失败与「订阅线程是否恰好带上下文」无关——唤醒/轮询等
 * 丢失 ThreadLocal 的线程提交的按 run_id 系统查找同样依赖环境注入。
 * 修复后:运行行与会话/事件行租户同口径,按 run_id 查找走系统模式。
 *
 * <ol>
 *   <li>SSE 流收到终态 DONE(修复前 500 无终态);</li>
 *   <li>run 行原始 SQL 直读:status=COMPLETED、app_id=34、tenant_id=0;</li>
 *   <li>事件行 app_id 全部为 34。</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers(disabledWithoutDocker = false)
class AgentMultiAppHttpChainIT {

    private static final long OTHER_APP_ID = 34L;
    private static final long USER_ID = 10086L;
    private static final long TENANT_ID = 0L;
    private static final String DB_DRIVEN_TYPE = "multi-app-http-it";
    private static final String PROMPT_MARKER = "多应用HTTP链IT人设标记XYZZY";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine")
            .withDatabaseName("ai_fusion_video")
            .withUsername("afv")
            .withPassword("afv-test");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "multi-app-http-node");
    }

    @MockitoBean
    private com.inneragent.agent.run.AgentRunRedisSignalService signals;

    /** 模型边界脚本化(运行内核其余环节全真;形态同 AgentMultiAppRunContextIT)。 */
    @MockitoBean
    private com.inneragent.agent.kernel.AgentScopeModelFactory modelFactory;

    @Autowired
    private AgentDefinitionAdminService definitionAdmin;

    @Autowired
    private AiModelMapper aiModelMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @org.springframework.boot.test.web.server.LocalServerPort
    private int port;

    @BeforeEach
    void configureModelBoundaryAndSignals() {
        org.mockito.Mockito.when(signals.publishCancel(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(reactor.core.publisher.Mono.empty());
        org.mockito.Mockito.when(signals.publishWakeup(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.anyLong()))
                .thenReturn(reactor.core.publisher.Mono.empty());
        org.mockito.Mockito.when(signals.wakeupsWhenSubscribed(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(reactor.core.publisher.Mono.just(Flux.never()));
        org.mockito.Mockito.when(signals.cancellations(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(Flux.never());
        org.mockito.Mockito.when(modelFactory.modelConfigFingerprint(
                        org.mockito.ArgumentMatchers.any(com.inneragent.model.entity.AiModel.class)))
                .thenReturn("c".repeat(64));
        org.mockito.Mockito.when(modelFactory.create(
                        org.mockito.ArgumentMatchers.any(AgentKernelSpec.class)))
                .thenAnswer(invocation -> {
                    AgentKernelSpec spec = invocation.getArgument(0);
                    return OwnedChatModel.owned(scriptedModel(spec.agentDefinitionStableKey()));
                });
    }

    @Test
    void embedUserRunOverHttpReachesCompletedWithRowOwnedTenantAndApp() throws Exception {
        seedDefinition();
        long modelId = seedModel();

        // 模拟 embed 用户请求体(appKey=acme-demo → ia_app.id=34;token tenantId=0)
        String body = """
                {"message":"请帮客户张三创建一个工单,问题是登录失败,优先级高",
                 "agentType":"%s","modelId":%d,"toolExecutionMode":"DEFAULT"}
                """.formatted(DB_DRIVEN_TYPE, modelId);

        List<String> sseLines = postForSse(body);

        List<JsonNode> events = parseDataEvents(sseLines);
        assertThat(events)
                .as("SSE 流应携带事件(修复前 500:RuntimeContext 装配按环境租户过滤查不到 run 行)")
                .isNotEmpty();
        JsonNode done = events.stream()
                .filter(event -> "DONE".equals(event.path("outputType").asText()))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "SSE 流未收到 DONE 终态,事件: " + events));
        String rootRunId = done.path("runId").asText();
        assertThat(rootRunId).isNotBlank();

        // 运行行原始 SQL 直读(绕过行级拦截器):租户必须与发起请求的
        // embed token 同口径(0),而非回落 1 —— 本用例回归的根因位
        Map<String, Object> run = jdbcTemplate.queryForMap(
                "SELECT app_id, tenant_id, status, user_id FROM ia_agent_run WHERE run_id = ?",
                rootRunId);
        assertThat(run.get("status")).isEqualTo(AgentRunStatus.COMPLETED.name());
        assertThat(((Number) run.get("app_id")).longValue())
                .as("run 行 app_id 必须为发起应用 %d", OTHER_APP_ID)
                .isEqualTo(OTHER_APP_ID);
        assertThat(((Number) run.get("tenant_id")).longValue())
                .as("run 行 tenant_id 必须保留会话行的 0(无租户),不得回落 1")
                .isEqualTo(TENANT_ID);
        assertThat(((Number) run.get("user_id")).longValue()).isEqualTo(USER_ID);

        // 事件行:app_id 全部为发起应用
        List<Map<String, Object>> eventRows = jdbcTemplate.queryForList(
                "SELECT app_id, tenant_id FROM ia_agent_event WHERE run_id = ?", rootRunId);
        assertThat(eventRows).isNotEmpty();
        assertThat(eventRows.stream()
                .allMatch(row -> ((Number) row.get("app_id")).longValue() == OTHER_APP_ID))
                .as("ia_agent_event 全部事件行 app_id 应为 %d", OTHER_APP_ID)
                .isTrue();

        // 会话行与运行行租户同口径
        Map<String, Object> conversation = jdbcTemplate.queryForMap(
                "SELECT tenant_id, app_id FROM ia_agent_conversation WHERE conversation_id = ?",
                done.path("conversationId").asText());
        assertThat(((Number) conversation.get("tenant_id")).longValue()).isEqualTo(TENANT_ID);
        assertThat(((Number) conversation.get("app_id")).longValue()).isEqualTo(OTHER_APP_ID);
    }

    /**
     * 真 HTTP POST(随机端口 Tomcat,真 MVC 异步 SSE 路径)。线程上下文由
     * {@link EmbedShapeContextFilter}(测试过滤器,模拟 embed 认证语义)写入,
     * 不在测试线程手工设置 —— 用例对「订阅线程恰好带上下文」不敏感。
     */
    private List<String> postForSse(String jsonBody) throws Exception {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        HttpRequest request = HttpRequest.newBuilder(
                        URI.create("http://localhost:" + port + "/ia/api/v1/runs"))
                .timeout(Duration.ofSeconds(120))
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8))
                .build();
        Callable<List<String>> consume = () -> {
            HttpResponse<java.io.InputStream> response =
                    client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            List<String> lines = new ArrayList<>();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    response.body(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    lines.add(line);
                }
            }
            return lines;
        };
        ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "multi-app-http-it-sse");
            thread.setDaemon(true);
            return thread;
        });
        try {
            Future<List<String>> future = executor.submit(consume);
            return future.get(120, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
        }
    }

    private List<JsonNode> parseDataEvents(List<String> sseLines) throws Exception {
        List<JsonNode> events = new ArrayList<>();
        for (String line : sseLines) {
            if (line.startsWith("data:")) {
                String payload = line.substring("data:".length()).trim();
                if (payload.isEmpty() || "[DONE]".equals(payload)) {
                    continue;
                }
                try {
                    events.add(objectMapper.readTree(payload));
                } catch (Exception ignored) {
                    // 非 JSON data 行(如注释/心跳)跳过
                }
            }
        }
        return events;
    }

    /** 按键脚本化的模型边界(直接文本完成)。 */
    private ChatModelBase scriptedModel(String definitionKey) {
        return new ChatModelBase() {
            @Override
            protected Flux<ChatResponse> doStream(
                    List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
                return textReply("reply-" + definitionKey, "多应用 HTTP 链回答完成");
            }

            @Override
            public String getModelName() {
                return "multi-app-http-scripted-model";
            }
        };
    }

    private static Flux<ChatResponse> textReply(String replyId, String text) {
        return Flux.just(
                ChatResponse.builder()
                        .id(replyId)
                        .content(List.<ContentBlock>of(
                                TextBlock.builder().text(text).build()))
                        .build(),
                ChatResponse.builder()
                        .id(replyId)
                        .content(List.of())
                        .finishReason("stop")
                        .build());
    }

    private void seedDefinition() throws Exception {
        JsonNode bundle = objectMapper.readTree("""
                {
                  "schemaVersion": 1,
                  "definitions": [{
                    "agentType": "%s",
                    "name": "多应用 HTTP 链 IT 助手",
                    "specJson": {
                      "kind": "main",
                      "enabled": true,
                      "toolWhitelist": [],
                      "subAgentTools": []
                    },
                    "prompts": [{
                      "slot": "systemPrompt",
                      "content": "%s 你是多应用 HTTP 链 IT 助手,直接完成回答。"
                    }]
                  }]
                }
                """.formatted(DB_DRIVEN_TYPE, PROMPT_MARKER));
        var result = definitionAdmin.importBundle(
                OTHER_APP_ID, bundle, "overwrite", false);
        assertThat(result.errors()).isEmpty();
        assertThat(result.created()).isEqualTo(1);
    }

    private long seedModel() {
        AiModel model = aiModelMapper.selectOne(new LambdaQueryWrapper<AiModel>()
                .eq(AiModel::getCode, "multi-app-http-it-model"));
        if (model == null) {
            jdbcTemplate.update("""
                    INSERT INTO ia_ai_model
                        (name, code, model_protocol, model_type, status, config)
                    VALUES ('多应用 HTTP 链 IT 模型', 'multi-app-http-it-model',
                            'openai', 1, 1, '{}')
                    """);
            model = aiModelMapper.selectOne(new LambdaQueryWrapper<AiModel>()
                    .eq(AiModel::getCode, "multi-app-http-it-model"));
        }
        assertThat(model).isNotNull();
        return model.getId();
    }

    /**
     * 模拟 embed 认证过滤器上下文语义的测试过滤器(形态对齐
     * EmbedTokenAuthenticationFilter):请求线程写入 SecurityContext +
     * AppContext(34) + UserContext(10086, tenant 0)(同步 TenantContext),
     * 请求返回后统一清理(与真机「异步化后请求线程上下文被清」一致)。
     * 注册在安全链之后(LOWEST_PRECEDENCE),任意请求放行。
     */
    @TestConfiguration
    static class EmbedShapeContextConfiguration {

        @org.springframework.context.annotation.Bean
        FilterRegistrationBean<OncePerRequestFilter> embedShapeContextFilter() {
            OncePerRequestFilter filter = new OncePerRequestFilter() {
                @Override
                protected void doFilterInternal(HttpServletRequest request,
                                                HttpServletResponse response,
                                                FilterChain filterChain)
                        throws ServletException, IOException {
                    SecurityUserDetails userDetails = new SecurityUserDetails(
                            USER_ID, "embed:acme-demo", "N/A", 1, TENANT_ID, List.of());
                    UsernamePasswordAuthenticationToken authentication =
                            new UsernamePasswordAuthenticationToken(
                                    userDetails, null, userDetails.getAuthorities());
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                    AppContext.setAppId(OTHER_APP_ID);
                    UserContext.set(USER_ID, TENANT_ID);
                    try {
                        filterChain.doFilter(request, response);
                    } finally {
                        SecurityContextHolder.clearContext();
                        AppContext.clear();
                        UserContext.clear();
                    }
                }
            };
            FilterRegistrationBean<OncePerRequestFilter> registration =
                    new FilterRegistrationBean<>(filter);
            registration.setOrder(SecurityProperties.DEFAULT_FILTER_ORDER + 1);
            return registration;
        }
    }

}
