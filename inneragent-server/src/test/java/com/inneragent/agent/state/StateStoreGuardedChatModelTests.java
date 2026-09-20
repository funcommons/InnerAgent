package com.inneragent.agent.state;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.config.AgentScopeRuntimeProperties;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.ModelUsageSettlementPort;
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
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
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
}
