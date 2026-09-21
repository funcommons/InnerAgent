package com.inneragent.integration;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.agent.kernel.AgentKernelSpec;
import com.inneragent.agent.kernel.AgentScopePipelineRunService;
import com.inneragent.agent.kernel.OwnedChatModel;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.run.AgentRunRedisSignalService;
import com.inneragent.model.entity.AiModel;
import com.inneragent.model.mapper.AiModelMapper;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.server.admin.AgentDefinitionAdminService;
import com.inneragent.server.controller.vo.AiChatReqVO;
import com.inneragent.server.controller.vo.AiChatStreamRespVO;
import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.message.ToolUseBlock;
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
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * [adapt] P4 数据驱动内核 真内核 IT(参照 {@link AgentRunSubAgentTwoLayerIT}
 * 的模型 mock 形态;仅 ChatModel 边界脚本化,运行链全真):
 *
 * <ol>
 *   <li><strong>DB 优先解析</strong>:经 admin 导入面
 *       ({@link AgentDefinitionAdminService#importBundle})落一个最小定义
 *       (1 个工具 fqn/名 + 人设提示词;agentType 不在代码注册表)→ 用其
 *       agentType 发起真实运行 → 断言运行走 DB 定义(人设进模型上下文与
 *       内核快照;类型不在代码注册表,回落即启动失败,本身即证据);</li>
 *   <li><strong>工具白名单过滤</strong>:模型边界收到的工具面恰为定义声明面
 *       (get_current_time 进,已注册但未声明的 parse_text_file 不进);</li>
 *   <li><strong>子引用解析</strong>:DB 声明的 subAgentTools(refAgentType 亦为
 *       DB 定义,代码注册表无此类型)经真实父子链调起,子运行 COMPLETED;</li>
 *   <li><strong>停用回落</strong>:同名 DB 行停用(specJson.enabled=false 覆盖
 *       播种行)后运行回落代码注册表提示词——「DB 优先,停用即回落代码」。</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers(disabledWithoutDocker = false)
class AgentDefinitionDrivenRunIT {

    private static final String DB_DRIVEN_TYPE = "db-driven-it";
    private static final String DB_PARENT_TYPE = "db-parent-it";
    private static final String DB_CHILD_TYPE = "db-child-it";
    private static final String PROMPT_MARKER = "数据驱动IT人设标记XYZZY";
    private static final String DISABLED_MARKER = "DB停用版人设标记FIZZBUZZ";

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
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "db-driven-node");
    }

    @MockitoBean
    private AgentRunRedisSignalService signals;

    /** 模型边界脚本化(运行内核其余环节全真;形态同 AgentRunSubAgentTwoLayerIT)。 */
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
    private com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    private final AtomicReference<String> capturedContext = new AtomicReference<>("");
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
                .thenReturn("d".repeat(64));
        when(modelFactory.create(any(AgentKernelSpec.class)))
                .thenAnswer(invocation -> {
                    AgentKernelSpec spec = invocation.getArgument(0);
                    return OwnedChatModel.owned(scriptedModel(spec.agentDefinitionStableKey()));
                });
        capturedContext.set("");
        capturedToolNames.set(List.of());
    }

    @Test
    void runsImportedDefinitionWithWhitelistedToolFaceThroughRealKernel() throws Exception {
        AiModel model = seedModel();
        com.fasterxml.jackson.databind.JsonNode bundle = objectMapper.readTree("""
                {
                  "schemaVersion": 1,
                  "definitions": [{
                    "agentType": "%s",
                    "name": "数据驱动 IT 助手",
                    "specJson": {
                      "kind": "main",
                      "enabled": true,
                      "toolWhitelist": ["get_current_time"],
                      "subAgentTools": []
                    },
                    "prompts": [{
                      "slot": "systemPrompt",
                      "content": "%s 你是数据驱动内核 IT 助手。需要时间必须调用 get_current_time。"
                    }]
                  }]
                }
                """.formatted(DB_DRIVEN_TYPE, PROMPT_MARKER));
        var result = definitionAdmin.importBundle(1L, bundle, "overwrite", false);
        assertThat(result.errors()).isEmpty();
        assertThat(result.created()).isEqualTo(1);

        AiChatReqVO request = new AiChatReqVO();
        request.setConversationId(unique("db-driven-conversation"));
        request.setAgentType(DB_DRIVEN_TYPE);
        request.setModelId(model.getId());
        // 声明面内工具(get_current_time)只读:DEFAULT 档自动执行
        request.setToolExecutionMode(
                com.inneragent.agent.permission.ToolExecutionMode.DEFAULT.name());
        request.setMessage("现在几点了?");

        List<AiChatStreamRespVO> events = pipeline.stream(request, 42L)
                .collectList()
                .block(Duration.ofSeconds(60));

        assertThat(events).isNotNull();
        assertThat(events.getLast().getOutputType()).isEqualTo("DONE");
        AgentRun run = soleRootRun(request.getConversationId());
        assertThat(run.getStatus()).isEqualTo(AgentRunStatus.COMPLETED.name());

        // 提示词进上下文(模型边界实收)+ 进内核快照(持久留痕)
        assertThat(capturedContext.get()).contains(PROMPT_MARKER);
        assertThat(run.getAgentDefinitionSnapshotJson()).contains(PROMPT_MARKER);

        // 工具面过滤:已注册但未声明的 parse_text_file 不进模型边界
        // (内核白名单恰为声明面,经 Harness 精确锁定;load_skill_through_path
        // 为技能库启用时恒在的 Harness 内建工具,属内核白名单之外的平台能力,
        // 代码/DB 定义两侧行为一致,非本批语义)。
        assertThat(capturedToolNames.get())
                .contains("get_current_time")
                .doesNotContain("parse_text_file");
    }

    @Test
    void resolvesImportedSubReferenceThroughRealParentChildChain() throws Exception {
        AiModel model = seedModel();
        com.fasterxml.jackson.databind.JsonNode bundle = objectMapper.readTree("""
                {
                  "schemaVersion": 1,
                  "definitions": [
                    {
                      "agentType": "%s",
                      "name": "数据驱动父定义",
                      "specJson": {
                        "kind": "main",
                        "enabled": true,
                        "toolWhitelist": [],
                        "subAgentTools": [{
                          "toolName": "db_sub_it_tool",
                          "displayName": "调起数据驱动子定义",
                          "description": "把任务派给数据驱动子定义执行",
                          "parametersSchema": {"type":"object","properties":{"message":{"type":"string"}},"required":["message"]},
                          "refAgentType": "%s"
                        }]
                      },
                      "prompts": [{
                        "slot": "systemPrompt",
                        "content": "你是数据驱动父定义,派发任务时调用 db_sub_it_tool。"
                      }]
                    },
                    {
                      "agentType": "%s",
                      "name": "数据驱动子定义",
                      "specJson": {
                        "kind": "sub",
                        "enabled": true,
                        "toolWhitelist": [],
                        "subAgentTools": []
                      },
                      "prompts": [{
                        "slot": "systemPrompt",
                        "content": "你是数据驱动子定义(代码注册表无此类型),收到任务后直接完成。"
                      }]
                    }
                  ]
                }
                """.formatted(DB_PARENT_TYPE, DB_CHILD_TYPE, DB_CHILD_TYPE));
        var result = definitionAdmin.importBundle(1L, bundle, "overwrite", false);
        assertThat(result.errors()).isEmpty();
        assertThat(result.created()).isEqualTo(2);

        AiChatReqVO request = new AiChatReqVO();
        request.setConversationId(unique("db-sub-conversation"));
        request.setAgentType(DB_PARENT_TYPE);
        request.setModelId(model.getId());
        // 子工具为写操作(readOnly=false):ALWAYS_ALLOW 豁免确认(聚焦调起链)
        request.setToolExecutionMode(
                com.inneragent.agent.permission.ToolExecutionMode.ALWAYS_ALLOW.name());
        request.setMessage("请派发任务");

        List<AiChatStreamRespVO> events = pipeline.stream(request, 42L)
                .collectList()
                .block(Duration.ofSeconds(60));

        assertThat(events).isNotNull();
        assertThat(events.getLast().getOutputType()).isEqualTo("DONE");

        AgentRun parent = soleRootRun(request.getConversationId());
        assertThat(parent.getStatus()).isEqualTo(AgentRunStatus.COMPLETED.name());

        AgentRun child = runMapper.selectOne(new LambdaQueryWrapper<AgentRun>()
                .eq(AgentRun::getParentRunId, parent.getRunId()));
        assertThat(child).isNotNull();
        assertThat(child.getStatus()).isEqualTo(AgentRunStatus.COMPLETED.name());
        assertThat(child.getAgentName()).isEqualTo("db_sub_it_tool");
        assertThat(child.getAgentDefinitionSnapshotJson())
                .contains("数据驱动子定义(代码注册表无此类型)");

        assertThat(events.stream()
                .filter(event -> "TOOL_FINISHED".equals(event.getOutputType()))
                .filter(event -> "db_sub_it_tool".equals(event.getToolName()))
                .findFirst())
                .hasValueSatisfying(toolResult -> {
                    assertThat(toolResult.getToolStatus()).isEqualTo("success");
                    assertThat(toolResult.getToolResult())
                            .contains("childRunId")
                            .contains("COMPLETED");
                });
    }

    @Test
    void disabledDbDefinitionFallsBackToCodeRegistryPrompt() throws Exception {
        AiModel model = seedModel();
        // 播种行(demo,内容同代码注册表)被导入覆盖为停用 → 运行回落代码人设
        com.fasterxml.jackson.databind.JsonNode bundle = objectMapper.readTree("""
                {
                  "schemaVersion": 1,
                  "definitions": [{
                    "agentType": "demo",
                    "name": "InnerAgent 演示助手",
                    "specJson": {
                      "kind": "main",
                      "enabled": false,
                      "toolWhitelist": ["get_current_time", "parse_text_file"],
                      "subAgentTools": []
                    },
                    "prompts": [{
                      "slot": "systemPrompt",
                      "content": "%s"
                    }]
                  }]
                }
                """.formatted(DISABLED_MARKER));
        var result = definitionAdmin.importBundle(1L, bundle, "overwrite", false);
        assertThat(result.errors()).isEmpty();
        assertThat(result.updated()).isEqualTo(1);

        AiChatReqVO request = new AiChatReqVO();
        request.setConversationId(unique("db-disabled-conversation"));
        request.setAgentType("demo");
        request.setModelId(model.getId());
        // 回落后的代码工具面均为只读:DEFAULT 档自动执行
        request.setToolExecutionMode(
                com.inneragent.agent.permission.ToolExecutionMode.DEFAULT.name());
        request.setMessage("你好");

        List<AiChatStreamRespVO> events = pipeline.stream(request, 42L)
                .collectList()
                .block(Duration.ofSeconds(60));

        assertThat(events).isNotNull();
        assertThat(events.getLast().getOutputType()).isEqualTo("DONE");
        assertThat(soleRootRun(request.getConversationId()).getStatus())
                .isEqualTo(AgentRunStatus.COMPLETED.name());
        assertThat(capturedContext.get())
                .doesNotContain(DISABLED_MARKER)
                .contains("InnerAgent 的演示助手");
    }

    /** 按定义键脚本化的模型边界:先捕获人设/工具面上下文,再按键回放行为。 */
    private ChatModelBase scriptedModel(String definitionKey) {
        return new ChatModelBase() {
            @Override
            protected Flux<ChatResponse> doStream(
                    List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
                capturedContext.set(messages.stream()
                        .map(Msg::getTextContent)
                        .collect(Collectors.joining("\n")));
                capturedToolNames.set(tools.stream()
                        .map(ToolSchema::getName)
                        .toList());
                boolean toolResultSeen = messages.stream().anyMatch(message ->
                        !message.getContentBlocks(ToolResultBlock.class).isEmpty());
                if (DB_PARENT_TYPE.equals(definitionKey) && !toolResultSeen) {
                    return Flux.just(ChatResponse.builder()
                            .id("parent-1")
                            .content(List.<ContentBlock>of(new ToolUseBlock(
                                    "call-db-sub-1",
                                    "db_sub_it_tool",
                                    Map.of("message", "解析场次数据"),
                                    "{\"message\":\"解析场次数据\"}",
                                    null)))
                            .finishReason("tool_use")
                            .build());
                }
                return textReply("reply-" + definitionKey, "数据驱动回答完成");
            }

            @Override
            public String getModelName() {
                return "db-driven-scripted-model";
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

    private AiModel seedModel() {
        AiModel model = aiModelMapper.selectOne(new LambdaQueryWrapper<AiModel>()
                .eq(AiModel::getCode, "db-driven-it-model"));
        if (model == null) {
            // multimodal_* 为 jsonb 列,实体字符串映射不适配直插;用原生 SQL 播种
            jdbcTemplate.update("""
                    INSERT INTO ia_ai_model
                        (name, code, model_protocol, model_type, status, config)
                    VALUES ('数据驱动 IT 模型', 'db-driven-it-model', 'openai', 1, 1, '{}')
                    """);
            model = aiModelMapper.selectOne(new LambdaQueryWrapper<AiModel>()
                    .eq(AiModel::getCode, "db-driven-it-model"));
        }
        assertThat(model).isNotNull();
        return model;
    }

    private AgentRun soleRootRun(String conversationId) {
        AgentRun run = runMapper.selectOne(new LambdaQueryWrapper<AgentRun>()
                .eq(AgentRun::getConversationId, conversationId)
                .isNull(AgentRun::getParentRunId));
        assertThat(run).isNotNull();
        return run;
    }

    private static String unique(String prefix) {
        return prefix + '-' + UUID.randomUUID().toString().replace("-", "");
    }
}
