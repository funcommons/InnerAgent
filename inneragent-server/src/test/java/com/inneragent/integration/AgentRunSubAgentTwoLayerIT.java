package com.inneragent.integration;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.run.AgentRunQueryService;
import com.inneragent.agent.run.AgentRunRedisSignalService;
import com.inneragent.agent.run.AgentRunReplayService;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import com.inneragent.agent.kernel.AgentKernelSpec;
import com.inneragent.agent.kernel.AgentScopePipelineRunService;
import com.inneragent.agent.kernel.OwnedChatModel;
import com.inneragent.model.entity.AiModel;
import com.inneragent.model.mapper.AiModelMapper;
import com.inneragent.platform.enums.ai.AgentRunStatus;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * [adapt] P4-W14 真实内核 父→子 两层运行 IT(03-开发计划 §7.3 验收 4,
 * 参照 AgentRunStartIT 先例):
 *
 * <p>父运行(script_full_parse,含 sub Agent 工具 episode_scene_writer)经
 * <strong>真实</strong>运行链(pipeline → coordinator → supervisor →
 * executionFactory → 真实 AgentScope Harness;仅 ChatModel 边界脚本化)发起
 * 工具调用,由 {@code AgentScopeSubAgentToolAdapter} 准入持久化子运行,子运行
 * 独立 Harness 执行 DONE 后工具结果回灌父模型收尾。
 *
 * <p>断言:父子两层运行均 COMPLETED;子运行 parent_run_id/parent_tool_call_id
 * 落库且 deadline ≤ 父;父事件流可见子 Agent 工具结果回灌(childRunId +
 * PARENT_TOOL_RESULT 契约)与镜像子事件(childRunId/parentToolCallId);
 * 子运行自身事件投影携带 parentRunId(前端父子层级渲染的服务端数据支撑)。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers(disabledWithoutDocker = false)
class AgentRunSubAgentTwoLayerIT {

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
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "two-layer-node");
    }

    @MockitoBean
    private AgentRunRedisSignalService signals;

    /**
     * 模型边界脚本化:按定义键选择父/子脚本模型,运行内核其余环节全真。
     * mock 具体类 AgentScopeModelFactory(同时满足 AgentKernelModelFactory
     * 接口注入与 spec/execution 工厂的具体类型注入)。
     */
    @MockitoBean
    private com.inneragent.agent.kernel.AgentScopeModelFactory modelFactory;

    @Autowired
    private AgentScopePipelineRunService pipeline;

    @Autowired
    private AgentRunQueryService runQueries;

    @Autowired
    private AgentRunReplayService replay;

    @Autowired
    private AgentRunMapper runMapper;

    @Autowired
    private AiModelMapper aiModelMapper;

    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    @BeforeEach
    void configureModelBoundaryAndSignals() {
        when(signals.publishCancel(anyString())).thenReturn(Mono.empty());
        when(signals.publishWakeup(anyString(), anyLong())).thenReturn(Mono.empty());
        when(signals.wakeupsWhenSubscribed(anyString()))
                .thenReturn(Mono.just(Flux.never()));
        when(signals.cancellations(anyString())).thenReturn(Flux.never());
        when(modelFactory.modelConfigFingerprint(any(AiModel.class)))
                .thenReturn("c".repeat(64));
        when(modelFactory.create(any(AgentKernelSpec.class)))
                .thenAnswer(invocation -> {
                    AgentKernelSpec spec = invocation.getArgument(0);
                    return OwnedChatModel.owned(
                            "script_full_parse".equals(spec.agentDefinitionStableKey())
                                    ? new ScriptedParentModel()
                                    : new ScriptedChildModel());
                });
    }

    @Test
    void runsParentAndChildTwoLayersThroughRealKernel() {
        long userId = 42L;
        long projectId = 77L;
        AiModel model = aiModelMapper.selectOne(new LambdaQueryWrapper<AiModel>()
                .eq(AiModel::getCode, "two-layer-it-model"));
        if (model == null) {
            // multimodal_* 为 jsonb 列,实体字符串映射不适配直插;用原生 SQL 播种
            jdbcTemplate.update("""
                    INSERT INTO ia_ai_model
                        (name, code, model_protocol, model_type, status, config)
                    VALUES ('两层运行测试模型', 'two-layer-it-model', 'openai', 1, 1, '{}')
                    """);
            model = aiModelMapper.selectOne(new LambdaQueryWrapper<AiModel>()
                    .eq(AiModel::getCode, "two-layer-it-model"));
            assertThat(model).isNotNull();
        }

        AiChatReqVO request = new AiChatReqVO();
        request.setConversationId(unique("two-layer-conversation"));
        request.setAgentType("script_full_parse");
        request.setModelId(model.getId());
        request.setProjectId(projectId);
        // script_full_parse 的指令模板变量(instructionTemplate/defaultUserMessage)
        request.setContext(Map.of("scriptId", 123));
        // 子 Agent 工具为写操作(readOnly=false):DEFAULT 档会停在 REQUIRE_USER_CONFIRM;
        // 本 IT 聚焦调起链,按批量自动化语义放行(ALWAYS_ALLOW 全部豁免确认)
        request.setToolExecutionMode(
                com.inneragent.agent.permission.ToolExecutionMode.ALWAYS_ALLOW.name());
        request.setMessage("请解析该分集的场次");

        // 真实内核父运行:脚本模型第一回合发起 episode_scene_writer 工具调用 →
        // 持久化子运行(真实 Harness)→ 工具结果回灌 → 第二回合文本收尾。
        // [adapt] 不注入租户上下文:ia_tool_registry 目录查询为 app 级治理表
        // (无 tenant_id 列),与 embed 链路的目录读取语义一致;运行归属由
        // 会话/运行行显式携带(租户兜底见 AgentRunCoordinator)。
        List<AiChatStreamRespVO> events = pipeline.stream(request, userId)
                .collectList()
                .block(Duration.ofSeconds(60));

        assertThat(events).isNotNull();
        assertThat(events.getLast().getOutputType()).isEqualTo("DONE");

        AgentRun parent = runMapper.selectOne(new LambdaQueryWrapper<AgentRun>()
                .eq(AgentRun::getConversationId, request.getConversationId())
                .isNull(AgentRun::getParentRunId));
        assertThat(parent).isNotNull();
        assertThat(parent.getStatus()).isEqualTo(AgentRunStatus.COMPLETED.name());

        AgentRun child = runMapper.selectOne(new LambdaQueryWrapper<AgentRun>()
                .eq(AgentRun::getParentRunId, parent.getRunId()));
        assertThat(child).isNotNull();
        assertThat(child.getStatus()).isEqualTo(AgentRunStatus.COMPLETED.name());
        assertThat(child.getAgentName()).isEqualTo("episode_scene_writer");
        assertThat(child.getParentToolCallId()).isNotBlank();
        assertThat(child.getDeadlineAt())
                .isBeforeOrEqualTo(parent.getDeadlineAt());

        // 父事件流:子 Agent 工具结果以 JSON 回灌(childRunId + COMPLETED,
        // PARENT_TOOL_RESULT 契约);镜像子事件携带 parentToolCallId/childRunId。
        AiChatStreamRespVO toolResult = events.stream()
                .filter(event -> "TOOL_FINISHED".equals(event.getOutputType()))
                .filter(event -> "episode_scene_writer".equals(event.getToolName()))
                .reduce((first, second) -> second)
                .orElseThrow();
        assertThat(toolResult.getToolStatus()).isEqualTo("success");
        assertThat(toolResult.getToolResult())
                .contains("childRunId")
                .contains("COMPLETED")
                .contains("PARENT_TOOL_RESULT");

        assertThat(events.stream().filter(event ->
                event.getChildRunId() != null
                        && event.getParentToolCallId() != null))
                .isNotEmpty();

        // 子运行自身事件流:重放至终态,CONTENT 事件投影携带 parentRunId
        // (层级渲染数据支撑;字段对齐现有事件契约的新增可选字段)。
        List<CommittedAgentEvent> childEvents = replay
                .replayThenLive(child.getRunId(), 0)
                .collectList()
                .block(Duration.ofSeconds(15));
        assertThat(childEvents).isNotNull();
        CommittedAgentEvent childContent = childEvents.stream()
                .filter(event -> "CONTENT".equals(event.outputType()))
                .findFirst()
                .orElseThrow();
        AiChatStreamRespVO childProjection =
                runQueries.project(child, childContent).block(Duration.ofSeconds(10));
        assertThat(childProjection).isNotNull();
        assertThat(childProjection.getParentRunId()).isEqualTo(parent.getRunId());
        assertThat(childProjection.getChildRunId()).isNull();
    }

    private static String unique(String prefix) {
        return prefix + '-' + UUID.randomUUID().toString().replace("-", "");
    }

    /** 父模型脚本:首回合发起 sub Agent 工具调用,工具结果回灌后文本收尾。 */
    private static final class ScriptedParentModel extends ChatModelBase {
        private final AtomicInteger calls = new AtomicInteger();

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            int call = calls.incrementAndGet();
            String replyId = "parent-" + call;
            boolean toolResultSeen = messages.stream().anyMatch(message ->
                    !message.getContentBlocks(ToolResultBlock.class).isEmpty());
            if (call == 1 && !toolResultSeen) {
                // 同时携带 input 与原始 content 流:流式累积器两路取参兼容
                return Flux.just(ChatResponse.builder()
                        .id(replyId)
                        .content(List.<ContentBlock>of(new ToolUseBlock(
                                "call-subagent-1",
                                "episode_scene_writer",
                                Map.of("scriptEpisodeId", 42),
                                "{\"scriptEpisodeId\":42}",
                                null)))
                        .finishReason("tool_use")
                        .build());
            }
            return textReply(replyId, "场次解析完成");
        }

        @Override
        public String getModelName() {
            return "two-layer-parent-model";
        }
    }

    /** 子模型脚本:单回合文本收尾(子运行立即 DONE)。 */
    private static final class ScriptedChildModel extends ChatModelBase {
        private final AtomicInteger calls = new AtomicInteger();

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            String replyId = "child-" + calls.incrementAndGet();
            return textReply(replyId, "场次 1-3 已解析并保存");
        }

        @Override
        public String getModelName() {
            return "two-layer-child-model";
        }
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
}
