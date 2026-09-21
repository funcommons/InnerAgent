package com.inneragent.integration;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.agent.kernel.AgentKernelSpec;
import com.inneragent.agent.kernel.AgentScopePipelineRunService;
import com.inneragent.agent.kernel.OwnedChatModel;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.run.AgentRunRedisSignalService;
import com.inneragent.model.entity.AiModel;
import com.inneragent.model.mapper.AiModelMapper;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.server.admin.AgentDefinitionAdminService;
import com.inneragent.server.controller.vo.AiChatReqVO;
import com.inneragent.server.controller.vo.AiChatStreamRespVO;
import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.ChatModelBase;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.ToolSchema;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * 多应用(app≠1)运行链 AppContext 调度线程传播 IT(缺陷根修回归)。
 *
 * <p>形态同 {@link AgentDefinitionDrivenRunIT}(模型边界 mock,运行链全真),
 * 差异仅在:订阅线程显式携带 <strong>非缺省 app(34)</strong>——模拟 embed
 * token 用户(appKey → ia_app.id=34)经过滤器写入 AppContext 后发起
 * {@code POST /ia/api/v1/runs}。运行链经 journal/state 等
 * {@code AgentRuntimeSchedulers} 装饰线程池多次 hop,任务必须在
 * 调度线程上按发起应用(app_id=34)过滤 SQL,而非缺省回落 1。
 *
 * <ol>
 *   <li>真实运行启动到 COMPLETED(修复前于 RuntimeContext 装配阶段
 *       {@code Agent run does not exist: <runId>} 500——load 注入 app_id=1
 *       查不到 app_id=34 的 run 行);</li>
 *   <li>run 行落库 app_id=34(非 1);</li>
 *   <li>事件行(ia_agent_event)app_id 全部为 34。</li>
 * </ol>
 *
 * <p>断言经 JdbcTemplate 原生 SQL(绕过行级拦截器),直读物理行,
 * 避免测试线程自身 AppContext 影响。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers(disabledWithoutDocker = false)
class AgentMultiAppRunContextIT {

    private static final long OTHER_APP_ID = 34L;
    private static final long USER_ID = 42L;
    private static final String DB_DRIVEN_TYPE = "multi-app-context-it";
    private static final String PROMPT_MARKER = "多应用上下文IT人设标记XYZZY";

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
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "multi-app-node");
    }

    @MockitoBean
    private AgentRunRedisSignalService signals;

    /** 模型边界脚本化(运行内核其余环节全真;形态同 AgentDefinitionDrivenRunIT)。 */
    @MockitoBean
    private com.inneragent.agent.kernel.AgentScopeModelFactory modelFactory;

    @Autowired
    private AgentDefinitionAdminService definitionAdmin;

    @Autowired
    private AgentScopePipelineRunService pipeline;

    @Autowired
    private AgentRunMapper runMapper;

    @Autowired
    private AiModelMapper aiModelMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    private final AtomicReference<List<String>> capturedToolNames = new AtomicReference<>(List.of());

    @BeforeEach
    void configureModelBoundaryAndSignals() {
        when(signals.publishCancel(anyString())).thenReturn(reactor.core.publisher.Mono.empty());
        when(signals.publishWakeup(anyString(), anyLong()))
                .thenReturn(reactor.core.publisher.Mono.empty());
        when(signals.wakeupsWhenSubscribed(anyString()))
                .thenReturn(reactor.core.publisher.Mono.just(Flux.never()));
        when(signals.cancellations(anyString())).thenReturn(Flux.never());
        when(modelFactory.modelConfigFingerprint(any(AiModel.class)))
                .thenReturn("b".repeat(64));
        when(modelFactory.create(any(AgentKernelSpec.class)))
                .thenAnswer(invocation -> {
                    AgentKernelSpec spec = invocation.getArgument(0);
                    return OwnedChatModel.owned(scriptedModel(spec.agentDefinitionStableKey()));
                });
        capturedToolNames.set(List.of());
    }

    @Test
    void propagatesNonDefaultAppAcrossSchedulerHopsToEndOfRun() throws Exception {
        seedDefinition();
        AiModel model = seedModel();

        AiChatReqVO request = new AiChatReqVO();
        request.setConversationId(unique("multi-app-conversation"));
        request.setAgentType(DB_DRIVEN_TYPE);
        request.setModelId(model.getId());
        request.setToolExecutionMode(
                com.inneragent.agent.permission.ToolExecutionMode.DEFAULT.name());
        request.setMessage("现在几点了?");

        // 模拟 embed 认证过滤器在请求线程写入的 AppContext(app=34):
        // 订阅发起即在该线程,与真机 POST /runs 请求线程语义一致。
        List<AiChatStreamRespVO> events;
        try {
            AppContext.setAppId(OTHER_APP_ID);
            events = pipeline.stream(request, USER_ID)
                    .collectList()
                    .block(Duration.ofSeconds(60));
        } finally {
            AppContext.clear();
        }

        assertThat(events).isNotNull();
        assertThat(events.getLast().getOutputType()).isEqualTo("DONE");
        String rootRunId = events.getLast().getRunId();
        assertThat(rootRunId).isNotBlank();

        // 运行行:物理行直读(run_id 全局唯一,原生 SQL 绕过行级拦截器)
        Map<String, Object> run = jdbcTemplate.queryForMap(
                "SELECT app_id, status FROM ia_agent_run WHERE run_id = ?", rootRunId);
        assertThat(run.get("status")).isEqualTo(AgentRunStatus.COMPLETED.name());
        assertThat(((Number) run.get("app_id")).longValue())
                .as("run 行 app_id 必须为发起应用 %d(而非缺省 1)", OTHER_APP_ID)
                .isEqualTo(OTHER_APP_ID);

        // 事件行:app_id 全部为发起应用
        List<Map<String, Object>> eventRows = jdbcTemplate.queryForList(
                "SELECT app_id FROM ia_agent_event WHERE run_id = ?", rootRunId);
        assertThat(eventRows).isNotEmpty();
        assertThat(eventRows.stream()
                .allMatch(row -> ((Number) row.get("app_id")).longValue() == OTHER_APP_ID))
                .as("ia_agent_event 全部事件行 app_id 应为 %d", OTHER_APP_ID)
                .isTrue();

        // 仓储读路径(带行级拦截器)以应用 34 身份可读回该 run
        AgentRun readBack = AppContext.runInApp(OTHER_APP_ID, () ->
                runMapper.selectOne(new LambdaQueryWrapper<AgentRun>()
                        .eq(AgentRun::getRunId, rootRunId)));
        assertThat(readBack).isNotNull();
        assertThat(readBack.getStatus()).isEqualTo(AgentRunStatus.COMPLETED.name());
    }

    /** 按键脚本化的模型边界(捕获工具面;直接文本完成)。 */
    private ChatModelBase scriptedModel(String definitionKey) {
        return new ChatModelBase() {
            @Override
            protected Flux<ChatResponse> doStream(
                    List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
                capturedToolNames.set(tools.stream()
                        .map(ToolSchema::getName)
                        .toList());
                return textReply("reply-" + definitionKey, "多应用回答完成");
            }

            @Override
            public String getModelName() {
                return "multi-app-scripted-model";
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
                    "name": "多应用上下文 IT 助手",
                    "specJson": {
                      "kind": "main",
                      "enabled": true,
                      "toolWhitelist": [],
                      "subAgentTools": []
                    },
                    "prompts": [{
                      "slot": "systemPrompt",
                      "content": "%s 你是多应用上下文 IT 助手,直接完成回答。"
                    }]
                  }]
                }
                """.formatted(DB_DRIVEN_TYPE, PROMPT_MARKER));
        // 定义导入挂发起应用(app=34):运行解析 ia_agent_definition 按
        // AppContext.currentOrDefault() 定位,与行级隔离同口径。
        var result = definitionAdmin.importBundle(
                OTHER_APP_ID, bundle, "overwrite", false);
        assertThat(result.errors()).isEmpty();
        assertThat(result.created()).isEqualTo(1);
    }

    private AiModel seedModel() {
        AiModel model = aiModelMapper.selectOne(new LambdaQueryWrapper<AiModel>()
                .eq(AiModel::getCode, "multi-app-context-it-model"));
        if (model == null) {
            jdbcTemplate.update("""
                    INSERT INTO ia_ai_model
                        (name, code, model_protocol, model_type, status, config)
                    VALUES ('多应用上下文 IT 模型', 'multi-app-context-it-model',
                            'openai', 1, 1, '{}')
                    """);
            model = aiModelMapper.selectOne(new LambdaQueryWrapper<AiModel>()
                    .eq(AiModel::getCode, "multi-app-context-it-model"));
        }
        assertThat(model).isNotNull();
        return model;
    }

    private static String unique(String prefix) {
        return prefix + '-' + UUID.randomUUID().toString().replace("-", "");
    }
}
