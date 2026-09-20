package com.inneragent.agent.kernel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.inneragent.platform.config.AgentScopeRuntimeProperties;
import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.server.controller.vo.AiChatReqVO;
import com.inneragent.model.entity.AiModel;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.agent.conversation.AgentConversationService;
import com.inneragent.agent.conversation.AgentMessageService;
import com.inneragent.agent.definition.AiAgentService;
import com.inneragent.model.config.AiModelService;
import com.inneragent.agent.context.AgentScopeRuntimeContextRequest;
import com.inneragent.agent.kernel.AgentKernelSpec;
import com.inneragent.agent.kernel.AgentKernelSpecFactory;
import com.inneragent.agent.message.AgentScopeMessageMapper;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.permission.ToolExecutionMode;
import com.inneragent.agent.skill.AgentScopeSkillRegistry;
import com.inneragent.agent.skill.AgentUserSkillService;
import com.inneragent.agent.run.AgentExecutionRuntimeContextRequests;
import com.inneragent.agent.run.AgentExecutionFactory;
import com.inneragent.agent.run.AgentRunCoordinator;
import com.inneragent.agent.run.AgentRunQueryService;
import com.inneragent.agent.run.AgentRunReplayService;
import com.inneragent.agent.run.AgentRuntimeInstanceIdentity;
import com.inneragent.agent.run.AgentRuntimeMetrics;
import com.inneragent.agent.run.RunExecutionSupervisor;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import com.inneragent.agent.run.kernel.AgentKernelSnapshotBuilder;
import com.inneragent.agent.run.kernel.AgentKernelSnapshotPayload;
import com.inneragent.agent.run.kernel.CanonicalAgentKernelSnapshotBuilder;
import com.inneragent.agent.run.model.StartAgentExecutionCommand;
import com.inneragent.agent.run.model.StartAgentRunCommand;
import com.inneragent.agent.run.model.StartedAgentRun;
import io.agentscope.core.message.UserMessage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentScopePipelineRunServiceTests {

    private final AgentRuntimeSchedulers schedulers = schedulers();

    @AfterEach
    void closeSchedulers() {
        schedulers.close();
    }

    @Test
    void startsOnlyTheDurableHarnessExecutionWithStrongMessages() {
        AiModelService models = mock(AiModelService.class);
        AiAgentService agents = mock(AiAgentService.class);
        AgentScopeSkillRegistry skillRegistry = mock(AgentScopeSkillRegistry.class);
        AgentUserSkillService userSkillService = mock(AgentUserSkillService.class);
        AgentConversationService conversations = mock(AgentConversationService.class);
        AgentMessageService persistedMessages = mock(AgentMessageService.class);
        AgentKernelSpecFactory specs = mock(AgentKernelSpecFactory.class);
        AgentKernelSnapshotBuilder snapshots = mock(AgentKernelSnapshotBuilder.class);
        AgentRunCoordinator coordinator = mock(AgentRunCoordinator.class);
        AgentExecutionRuntimeContextRequests runtimeContexts =
                mock(AgentExecutionRuntimeContextRequests.class);
        AgentExecutionFactory executionFactory = mock(AgentExecutionFactory.class);
        RunExecutionSupervisor supervisor = mock(RunExecutionSupervisor.class);
        AgentRunQueryService queries = mock(AgentRunQueryService.class);
        AgentRunReplayService replay = mock(AgentRunReplayService.class);
        AgentRuntimeInstanceIdentity identity = mock(AgentRuntimeInstanceIdentity.class);
        AgentScopeV2Properties properties = new AgentScopeV2Properties();
        AgentKernelSpec spec = mock(AgentKernelSpec.class);
        AgentScopeRuntimeContextRequest runtime = mock(AgentScopeRuntimeContextRequest.class);
        AiModel model = AiModel.builder()
                .id(7L)
                .code("model")
                .status(1)
                .supportReasoning(true)
                .reasoningEffortLevels(List.of("high", "low"))
                .build();
        AgentKernelSnapshot snapshot = snapshot();

        when(models.getDefaultByType(1)).thenReturn(model);
        when(skillRegistry.skills()).thenReturn(List.of());
        when(userSkillService.list(42L)).thenReturn(List.of(
                new AgentUserSkillService.UserSkill(
                        "story-review_workspace:user",
                        "story-review",
                        "故事结构检查",
                        "检查故事结构",
                        "# 工作方式\n\n先检查冲突与节奏。",
                        "workspace:user")));
        when(specs.createRoot(any(AiChatReqVO.class), any(AiModel.class), any(String.class), eq(42L)))
                .thenReturn(spec);
        when(spec.agentDefinitionStableKey()).thenReturn("ai_assistant_agent");
        when(snapshots.build(spec)).thenReturn(snapshot);
        when(identity.value()).thenReturn("node-1");
        when(coordinator.start(any(StartAgentRunCommand.class)))
                .thenAnswer(invocation -> {
                    StartAgentRunCommand command = invocation.getArgument(0);
                    return Mono.just(new StartedAgentRun(
                            command.runId(),
                            command.conversationId(),
                            command.stateSessionCandidate(),
                            command.ownerInstanceId(),
                            1L,
                            command.deadline().minusSeconds(1),
                            command.deadline(),
                            snapshot,
                            1L));
                });
        when(runtimeContexts.forRoot(
                any(), eq("ai_assistant_agent"), isNull(), eq(ToolExecutionMode.DEFAULT)))
                .thenReturn(Mono.just(runtime));
        when(supervisor.start(any(StartAgentExecutionCommand.class))).thenReturn(Mono.empty());

        AgentScopePipelineRunService service = new AgentScopePipelineRunService(
                models,
                agents,
                conversations,
                persistedMessages,
                specs,
                snapshots,
                new AgentScopeMessageMapper(),
                coordinator,
                runtimeContexts,
                executionFactory,
                supervisor,
                queries,
                replay,
                identity,
                properties,
                schedulers,
                new ObjectMapper(),
                skillRegistry,
                userSkillService);
        AiChatReqVO request = new AiChatReqVO()
                .setConversationId("conversation-1")
                .setMessage("hello harness")
                .setReasoningEffort("high")
                .setToolExecutionMode(ToolExecutionMode.DEFAULT.name())
                .setEnabledSkills(List.of("story-review"));

        StepVerifier.create(service.start(request, 42L))
                .assertNext(started -> assertThat(started.runId()).isNotBlank())
                .verifyComplete();

        ArgumentCaptor<StartAgentRunCommand> admission =
                ArgumentCaptor.forClass(StartAgentRunCommand.class);
        verify(coordinator).start(admission.capture());
        assertThat(admission.getValue().agentType()).isEqualTo("ai_assistant_agent");
        assertThat(admission.getValue().stateSessionCandidate())
                .isEqualTo("afv:v2:conversation-1:ai_assistant_agent");
        assertThat(admission.getValue().userContent()).isEqualTo("hello harness");

        ArgumentCaptor<String> systemPrompt = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<AiModel> effectiveModel = ArgumentCaptor.forClass(AiModel.class);
        verify(specs).createRoot(
                any(AiChatReqVO.class), effectiveModel.capture(), systemPrompt.capture(), eq(42L));
        assertThat(effectiveModel.getValue().getConfig()).contains("\"reasoningEffort\":\"high\"");
        assertThat(model.getConfig()).isNull();
        assertThat(systemPrompt.getValue())
                .contains("已主动激活的 Skills", "story-review", "先检查冲突与节奏")
                .doesNotContain("故事结构检查");

        ArgumentCaptor<StartAgentExecutionCommand> execution =
                ArgumentCaptor.forClass(StartAgentExecutionCommand.class);
        verify(supervisor).start(execution.capture());
        assertThat(execution.getValue().messages()).singleElement()
                .isInstanceOfSatisfying(UserMessage.class, message ->
                        assertThat(message.getTextContent()).isEqualTo("hello harness"));
        assertThat(execution.getValue().kernelSpec()).isSameAs(spec);
        assertThat(execution.getValue().runtimeContextRequest()).isSameAs(runtime);
    }

    @ParameterizedTest
    @ValueSource(strings = {"FAILED", "CANCELLED"})
    void continuesRetryableRunFromPersistedKernelAfterProcessRestart(String status) {
        AiModelService models = mock(AiModelService.class);
        AiAgentService agents = mock(AiAgentService.class);
        AgentScopeSkillRegistry skillRegistry = mock(AgentScopeSkillRegistry.class);
        AgentUserSkillService userSkillService = mock(AgentUserSkillService.class);
        AgentConversationService conversations = mock(AgentConversationService.class);
        AgentMessageService persistedMessages = mock(AgentMessageService.class);
        AgentKernelSpecFactory specs = mock(AgentKernelSpecFactory.class);
        AgentKernelSnapshotBuilder snapshots = mock(AgentKernelSnapshotBuilder.class);
        AgentRunCoordinator coordinator = mock(AgentRunCoordinator.class);
        AgentExecutionRuntimeContextRequests runtimeContexts =
                mock(AgentExecutionRuntimeContextRequests.class);
        AgentExecutionFactory executionFactory = mock(AgentExecutionFactory.class);
        RunExecutionSupervisor supervisor = mock(RunExecutionSupervisor.class);
        AgentRunQueryService queries = mock(AgentRunQueryService.class);
        AgentRunReplayService replay = mock(AgentRunReplayService.class);
        AgentRuntimeInstanceIdentity identity = mock(AgentRuntimeInstanceIdentity.class);
        AgentScopeV2Properties properties = new AgentScopeV2Properties();
        AgentKernelSpec spec = mock(AgentKernelSpec.class);
        AgentScopeRuntimeContextRequest runtime = mock(AgentScopeRuntimeContextRequest.class);
        AgentKernelSnapshot snapshot = snapshot();
        AgentRun previous = AgentRun.builder()
                .runId("failed-run")
                .conversationId("conversation-1")
                .userId(42L)
                .projectId(9L)
                .agentType("ai_assistant_agent")
                .agentStateSessionId("afv:v2:conversation-1:ai_assistant_agent")
                .kernelFingerprint(snapshot.fingerprint())
                .agentDefinitionSnapshotJson(snapshot.snapshotJson())
                .status(status)
                .deadlineAt(LocalDateTime.now().plusMinutes(5))
                .build();

        when(queries.resolveAuthorizedTarget(isNull(), eq("conversation-1"), eq(42L)))
                .thenReturn(Mono.just(previous));
        when(executionFactory.resolve(any(AgentKernelSnapshot.class))).thenReturn(Mono.just(spec));
        when(persistedMessages.listByConversation("conversation-1")).thenReturn(List.of());
        when(spec.agentDefinitionStableKey()).thenReturn("ai_assistant_agent");
        when(identity.value()).thenReturn("node-2");
        when(coordinator.start(any(StartAgentRunCommand.class)))
                .thenAnswer(invocation -> {
                    StartAgentRunCommand command = invocation.getArgument(0);
                    return Mono.just(new StartedAgentRun(
                            command.runId(),
                            command.conversationId(),
                            command.stateSessionCandidate(),
                            command.ownerInstanceId(),
                            1L,
                            command.deadline().minusSeconds(1),
                            command.deadline(),
                            snapshot,
                            2L));
                });
        when(runtimeContexts.forRoot(
                any(), eq("ai_assistant_agent"), any(),
                eq(ToolExecutionMode.FULL_ACCESS)))
                .thenReturn(Mono.just(runtime));
        when(supervisor.start(any(StartAgentExecutionCommand.class))).thenReturn(Mono.empty());

        AgentScopePipelineRunService service = new AgentScopePipelineRunService(
                models,
                agents,
                conversations,
                persistedMessages,
                specs,
                snapshots,
                new AgentScopeMessageMapper(),
                coordinator,
                runtimeContexts,
                executionFactory,
                supervisor,
                queries,
                replay,
                identity,
                properties,
                schedulers,
                new ObjectMapper(),
                skillRegistry,
                userSkillService);

        StepVerifier.create(service.startContinuation("conversation-1", 42L))
                .assertNext(started -> assertThat(started.conversationId())
                        .isEqualTo("conversation-1"))
                .verifyComplete();

        ArgumentCaptor<StartAgentRunCommand> admission =
                ArgumentCaptor.forClass(StartAgentRunCommand.class);
        verify(coordinator).start(admission.capture());
        assertThat(admission.getValue().userContent()).isEqualTo("继续");
        assertThat(admission.getValue().projectId()).isEqualTo(9L);
        assertThat(admission.getValue().stateSessionCandidate())
                .startsWith("afv-root:")
                .isNotEqualTo(previous.getAgentStateSessionId());
        assertThat(admission.getValue().kernelSnapshot().snapshotJson())
                .isEqualTo(snapshot.snapshotJson());

        ArgumentCaptor<StartAgentExecutionCommand> execution =
                ArgumentCaptor.forClass(StartAgentExecutionCommand.class);
        verify(supervisor).start(execution.capture());
        assertThat(execution.getValue().messages()).singleElement()
                .isInstanceOfSatisfying(UserMessage.class, message ->
                        assertThat(message.getTextContent()).isEqualTo("继续"));
        assertThat(execution.getValue().kernelSpec()).isSameAs(spec);
        verify(persistedMessages).listByConversation("conversation-1");
        verify(runtimeContexts).forRoot(
                any(), eq("ai_assistant_agent"), any(),
                eq(ToolExecutionMode.FULL_ACCESS));
    }

    @Test
    void rejectsContinuationWhenLatestRootRunDidNotFail() {
        AgentRunCoordinator coordinator = mock(AgentRunCoordinator.class);
        AgentRunQueryService queries = mock(AgentRunQueryService.class);
        AgentRun previous = AgentRun.builder()
                .runId("completed-run")
                .conversationId("conversation-1")
                .userId(42L)
                .status(AgentRunStatus.COMPLETED.name())
                .deadlineAt(LocalDateTime.now().plusMinutes(5))
                .build();
        when(queries.resolveAuthorizedTarget(isNull(), eq("conversation-1"), eq(42L)))
                .thenReturn(Mono.just(previous));

        AgentScopePipelineRunService service = new AgentScopePipelineRunService(
                mock(AiModelService.class),
                mock(AiAgentService.class),
                mock(AgentConversationService.class),
                mock(AgentMessageService.class),
                mock(AgentKernelSpecFactory.class),
                mock(AgentKernelSnapshotBuilder.class),
                new AgentScopeMessageMapper(),
                coordinator,
                mock(AgentExecutionRuntimeContextRequests.class),
                mock(AgentExecutionFactory.class),
                mock(RunExecutionSupervisor.class),
                queries,
                mock(AgentRunReplayService.class),
                mock(AgentRuntimeInstanceIdentity.class),
                new AgentScopeV2Properties(),
                schedulers,
                new ObjectMapper(),
                mock(AgentScopeSkillRegistry.class),
                mock(AgentUserSkillService.class));

        StepVerifier.create(service.startContinuation("conversation-1", 42L))
                .expectErrorSatisfies(error -> assertThat(error)
                        .hasMessage("只有失败或已取消的 Pipeline 可以继续执行"))
                .verify();

        verify(coordinator, never()).start(any(StartAgentRunCommand.class));
    }

    private AgentKernelSnapshot snapshot() {
        return new CanonicalAgentKernelSnapshotBuilder().build(
                new AgentKernelSnapshotPayload(
                        AgentKernelSnapshotPayload.CURRENT_SCHEMA_VERSION,
                        "ai_assistant_agent",
                        "assistant",
                        "test",
                        "system",
                        5,
                        "7",
                        1,
                        "openai",
                        "model",
                        JsonNodeFactory.instance.objectNode(),
                        List.of(),
                        "test"));
    }

    private AgentRuntimeSchedulers schedulers() {
        AgentScopeRuntimeProperties properties = new AgentScopeRuntimeProperties();
        properties.setStateThreads(1);
        properties.setJournalThreads(1);
        properties.setModelThreads(1);
        properties.setToolThreads(1);
        return new AgentRuntimeSchedulers(properties, AgentRuntimeMetrics.noop());
    }
}
