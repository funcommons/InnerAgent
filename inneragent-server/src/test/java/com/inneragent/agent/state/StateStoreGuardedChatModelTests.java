package com.inneragent.agent.state;

import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.config.AgentScopeRuntimeProperties;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.ModelCallUsageLedgerPort;
import com.inneragent.agent.run.ModelUsageSettlementPort;
import com.inneragent.agent.run.model.NormalizedModelUsage;
import com.inneragent.platform.enums.ai.AgentModelCallStatus;
import io.agentscope.core.agent.AgentBase;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.ChatModelBase;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.ChatUsage;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.ToolSchema;
import io.agentscope.core.state.AgentStateStore;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class StateStoreGuardedChatModelTests {

    @Test
    void delegatesOnlyWhenRuntimeSlotHasNoFailureAndPreservesCapabilities() {
        InMemoryStateStoreFailureGuard failures = new InMemoryStateStoreFailureGuard();
        CountingChatModel delegate = new CountingChatModel();
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(delegate, failures);
        RuntimeContext runtime = runtime();

        StepVerifier.create(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build())
                .contextWrite(context -> context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime)))
                .assertNext(response -> assertThat(((TextBlock) response.getContent().getFirst()).getText())
                        .isEqualTo("ok"))
                .verifyComplete();

        assertThat(delegate.invocations()).isEqualTo(1);
        assertThat(guarded.getModelName()).isEqualTo(delegate.getModelName());
        assertThat(guarded.getContextWindowSize()).isEqualTo(8_192);
        assertThat(guarded.supportsNativeStructuredOutput()).isTrue();
        assertThat(guarded.supportsNativeStructuredOutputWithTools()).isTrue();
    }

    @Test
    void exposesTheConfiguredModelContextWindowToHarnessMiddleware() {
        CountingChatModel delegate = new CountingChatModel();
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                delegate, new InMemoryStateStoreFailureGuard(), 262_144);

        assertThat(delegate.getContextWindowSize()).isEqualTo(8_192);
        assertThat(guarded.getContextWindowSize()).isEqualTo(262_144);
    }

    @Test
    void rejectsStoredFailureBeforeInvokingProvider() {
        InMemoryStateStoreFailureGuard failures = new InMemoryStateStoreFailureGuard();
        RuntimeContext runtime = runtime();
        StateStoreSlot slot = new StateStoreSlot(runtime.getUserId(), runtime.getSessionId());
        StateStoreFailure stored = failures.record(slot, "get", new IllegalStateException("redis down"));
        CountingChatModel delegate = new CountingChatModel();
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(delegate, failures);

        StepVerifier.create(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build())
                        .contextWrite(context -> context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime)))
                .expectErrorSatisfies(actual -> assertThat(actual).isSameAs(stored))
                .verify();

        assertThat(delegate.invocations()).isZero();
    }

    @Test
    void rejectsMissingRuntimeContextBeforeInvokingProvider() {
        CountingChatModel delegate = new CountingChatModel();
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                delegate, new InMemoryStateStoreFailureGuard());

        StepVerifier.create(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build()))
                .expectErrorSatisfies(actual -> {
                    assertThat(actual).isInstanceOf(BusinessException.class);
                    assertThat(((BusinessException) actual).getCode()).isEqualTo(500);
                    assertThat(actual.getMessage()).isEqualTo("STATE_STORE_FAILED: RuntimeContext missing");
                })
                .verify();

        assertThat(delegate.invocations()).isZero();
    }

    @Test
    void swallowedStateLoadCannotReachProviderAfterPreflightFailure() {
        AgentStateStore delegateStore = mock(AgentStateStore.class);
        InMemoryStateStoreFailureGuard failures = new InMemoryStateStoreFailureGuard();
        RuntimeContext runtime = runtime();
        when(delegateStore.exists(runtime.getUserId(), runtime.getSessionId()))
                .thenThrow(new IllegalStateException("redis down"));
        CountingChatModel delegateModel = new CountingChatModel();
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(delegateModel, failures);
        AgentScopeRuntimeProperties properties = new AgentScopeRuntimeProperties();
        properties.setStateThreads(1);
        properties.setJournalThreads(1);
        properties.setModelThreads(1);
        properties.setToolThreads(1);

        try (AgentRuntimeSchedulers schedulers = new AgentRuntimeSchedulers(properties)) {
            AgentStatePreflight preflight = new AgentStatePreflight(
                    new FailClosedAgentStateStore(delegateStore, failures), failures, schedulers);

            StepVerifier.create(preflight.check(runtime)
                            .thenMany(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build())
                                    .contextWrite(context -> context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime))))
                    .expectError(StateStoreFailure.class)
                    .verify();
        }

        assertThat(delegateModel.invocations()).isZero();
    }

    @Test
    void streamsEveryChunkThroughAndSettlesUsageExactlyOnce() {
        ModelUsageSettlementPort port = mock(ModelUsageSettlementPort.class);
        when(port.settle(any(), any())).thenReturn(Mono.just("ok"));
        // 与 modeler 约定的 modelCallId key (StateStoreGuardedChatModel.MODEL_CALL_ID_KEY)
        RuntimeContext runtime = RuntimeContext.builder()
                .userId("42")
                .sessionId("afv:v2:conversation-7:assistant-v3")
                .put("afv.modelCallId", "mc-1")
                .build();
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                new MultiChunkChatModel(), new InMemoryStateStoreFailureGuard(), null, port);

        StepVerifier.create(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build())
                        .contextWrite(context -> context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime)))
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("alpha"))
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("beta"))
                // 末 chunk 含 usage: 工具调用场景下带名字的 anchor 块不是最后一个 chunk,
                // 任何「缓冲后只回放一个」的实现都会丢弃 anchor → 内核收到孤儿 __fragment__
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("gamma"))
                .verifyComplete();

        verify(port, times(1)).settle(
                eq("afv:v2:conversation-7:assistant-v3:mc-1"), any());
    }

    private static String chunkText(ChatResponse response) {
        return ((TextBlock) response.getContent().getFirst()).getText();
    }

    // ------------------------------------------------------------------
    // W15 用量统计:量表白账挂点(start/complete/fail 生命周期)
    // ------------------------------------------------------------------

    @Test
    void ledgerRecordsStartThenCompletedWithTokens() {
        ModelCallUsageLedgerPort ledger = mock(ModelCallUsageLedgerPort.class);
        RuntimeContext runtime = RuntimeContext.builder()
                .userId("42")
                .sessionId("afv:v2:conversation-7:assistant-v3")
                .put("afv.modelCallId", "mc-1")
                .put(AgentRunContext.class, new AgentRunContext(
                        "run-9", "node-1", 1, java.time.Instant.parse("2026-09-21T00:00:00Z")))
                .build();
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                new MultiChunkChatModel(), new InMemoryStateStoreFailureGuard(),
                null, null, null, ledger, "openai", "deepseek-v4");

        StepVerifier.create(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build())
                        .contextWrite(context -> context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime)))
                .thenConsumeWhile(response -> true)
                .verifyComplete();

        // runId 取真实运行上下文(AgentRunContext.runId),而非状态会话键
        ModelCallUsageLedgerPort.ModelCallRef expectedRef = new ModelCallUsageLedgerPort.ModelCallRef(
                "run-9", "mc-1", "openai", "deepseek-v4");
        verify(ledger, times(1)).start(expectedRef);
        ArgumentCaptor<NormalizedModelUsage> usage = ArgumentCaptor.forClass(NormalizedModelUsage.class);
        verify(ledger, times(1)).complete(eq(expectedRef), usage.capture());
        assertThat(usage.getValue().inputTokens()).isEqualTo(10L);
        assertThat(usage.getValue().outputTokens()).isEqualTo(5L);
        verify(ledger, never()).fail(any(), any());
    }

    @Test
    void ledgerGeneratesModelCallIdWhenContextKeyAbsentAndRunIdFallsBackToSession() {
        ModelCallUsageLedgerPort ledger = mock(ModelCallUsageLedgerPort.class);
        ModelUsageSettlementPort settlement = mock(ModelUsageSettlementPort.class);
        when(settlement.settle(any(), any())).thenReturn(Mono.just("ok"));
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                new MultiChunkChatModel(), new InMemoryStateStoreFailureGuard(),
                null, settlement, null, ledger, "anthropic", "claude");

        StepVerifier.create(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build())
                        .contextWrite(context -> context.put(
                                AgentBase.RUNTIME_CONTEXT_KEY, runtime())))
                .thenConsumeWhile(response -> true)
                .verifyComplete();

        ArgumentCaptor<ModelCallUsageLedgerPort.ModelCallRef> ref =
                ArgumentCaptor.forClass(ModelCallUsageLedgerPort.ModelCallRef.class);
        verify(ledger, times(1)).start(ref.capture());
        // 无运行上下文:runId 兜底状态会话键(旧约定);modelCallId 按次生成 mc-<32hex>
        assertThat(ref.getValue().runId()).isEqualTo("afv:v2:conversation-7:assistant-v3");
        assertThat(ref.getValue().modelCallId()).startsWith("mc-").hasSize(35);
        verify(ledger, times(1)).complete(eq(ref.getValue()), any());
        // 结算端口幂等键与台账同键(runId:modelCallId)
        verify(settlement, times(1)).settle(
                eq("afv:v2:conversation-7:assistant-v3:" + ref.getValue().modelCallId()),
                any());
    }

    @Test
    void ledgerRecordsFailedWhenStreamErrorsWithoutUsage() {
        ModelCallUsageLedgerPort ledger = mock(ModelCallUsageLedgerPort.class);
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                new FailingChatModel(), new InMemoryStateStoreFailureGuard(),
                null, null, null, ledger, "openai", "deepseek-v4");

        StepVerifier.create(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build())
                        .contextWrite(context -> context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime())))
                .expectError(IllegalStateException.class)
                .verify();

        ArgumentCaptor<ModelCallUsageLedgerPort.ModelCallRef> ref =
                ArgumentCaptor.forClass(ModelCallUsageLedgerPort.ModelCallRef.class);
        verify(ledger, times(1)).start(ref.capture());
        verify(ledger, times(1)).fail(ref.getValue(), AgentModelCallStatus.FAILED);
        verify(ledger, never()).complete(any(), any());
    }

    @Test
    void ledgerStartFailureDoesNotBreakTheStream() {
        ModelCallUsageLedgerPort ledger = mock(ModelCallUsageLedgerPort.class);
        doThrow(new IllegalStateException("run row locked"))
                .when(ledger).start(any());
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                new MultiChunkChatModel(), new InMemoryStateStoreFailureGuard(),
                null, null, null, ledger, "openai", "deepseek-v4");

        StepVerifier.create(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build())
                        .contextWrite(context -> context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime())))
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("alpha"))
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("beta"))
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("gamma"))
                .verifyComplete();

        verify(ledger, never()).complete(any(), any());
        verify(ledger, never()).fail(any(), any());
    }

    @Test
    void ledgerWithoutUsageOnCleanCompletionStaysStartedForRunReconciliation() {
        ModelCallUsageLedgerPort ledger = mock(ModelCallUsageLedgerPort.class);
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                new CountingChatModel(), new InMemoryStateStoreFailureGuard(),
                null, null, null, ledger, "openai", "deepseek-v4");

        StepVerifier.create(guarded.stream(List.of(), List.of(), GenerateOptions.builder().build())
                        .contextWrite(context -> context.put(
                                AgentBase.RUNTIME_CONTEXT_KEY, runtime())))
                .thenConsumeWhile(response -> true)
                .verifyComplete();

        // 无 usage 的正常完成:保持 STARTED,由运行终态 finishAllStartedForRun 兜底
        verify(ledger, times(1)).start(any());
        verify(ledger, never()).complete(any(), any());
        verify(ledger, never()).fail(any(), any());
    }

    private RuntimeContext runtime() {
        return RuntimeContext.builder()
                .userId("42")
                .sessionId("afv:v2:conversation-7:assistant-v3")
                .build();
    }

    private static final class CountingChatModel extends ChatModelBase {

        private final AtomicInteger invocations = new AtomicInteger();

        private CountingChatModel() {
            setContextWindowSize(8_192);
            setNativeStructuredOutput(true);
            setNativeStructuredOutputWithTools(true);
        }

        @Override
        public String getModelName() {
            return "counting";
        }

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            return Flux.defer(() -> {
                invocations.incrementAndGet();
                return Flux.just(ChatResponse.builder()
                        .content(List.of(TextBlock.builder().text("ok").build()))
                        .finishReason("stop")
                        .build());
            });
        }

        private int invocations() {
            return invocations.get();
        }
    }

    /** 三 chunk 流: 前两个无 usage, 末 chunk 带 usage + finishReason (典型流式形态) */
    private static final class MultiChunkChatModel extends ChatModelBase {

        private MultiChunkChatModel() {
            setContextWindowSize(8_192);
        }

        @Override
        public String getModelName() {
            return "multi";
        }

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            return Flux.just(
                    ChatResponse.builder()
                            .content(List.of(TextBlock.builder().text("alpha").build()))
                            .build(),
                    ChatResponse.builder()
                            .content(List.of(TextBlock.builder().text("beta").build()))
                            .build(),
                    ChatResponse.builder()
                            .content(List.of(TextBlock.builder().text("gamma").build()))
                            .finishReason("stop")
                            .usage(ChatUsage.builder().inputTokens(10).outputTokens(5).build())
                            .build());
        }
    }

    /** 流即失败的模型(台账 FAILED 路径) */
    private static final class FailingChatModel extends ChatModelBase {

        private FailingChatModel() {
            setContextWindowSize(8_192);
        }

        @Override
        public String getModelName() {
            return "failing";
        }

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            return Flux.error(new IllegalStateException("provider unreachable"));
        }
    }
}
