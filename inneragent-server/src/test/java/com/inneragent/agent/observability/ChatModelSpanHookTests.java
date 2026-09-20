package com.inneragent.agent.observability;

import com.inneragent.agent.context.AgentConversationContext;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.state.InMemoryStateStoreFailureGuard;
import com.inneragent.agent.state.StateStoreGuardedChatModel;
import io.agentscope.core.agent.AgentBase;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.ChatModelBase;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.ChatUsage;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.ToolSchema;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * chat span 挂点测试(任务 #18b,[adapt] StateStoreGuardedChatModel):
 * 每次模型调用产生一个 chat span,流尾带 usage/结束原因;
 * chunks 逐个透传不受挂点影响;noop 工厂旁路不产生 span。
 */
class ChatModelSpanHookTests {

    private InMemorySpanExporter exporter;
    private SdkTracerProvider tracerProvider;

    @BeforeEach
    void setUp() {
        exporter = InMemorySpanExporter.create();
        tracerProvider = SdkTracerProvider.builder()
                .addSpanProcessor(SimpleSpanProcessor.create(exporter))
                .build();
    }

    @AfterEach
    void tearDown() {
        tracerProvider.shutdown().join(1, java.util.concurrent.TimeUnit.SECONDS);
    }

    private OtelGenAiSpanFactory otelFactory() {
        return new OtelGenAiSpanFactory(
                OpenTelemetrySdk.builder().setTracerProvider(tracerProvider).build(),
                true, 512);
    }

    private static RuntimeContext runtime() {
        return RuntimeContext.builder()
                .userId("42")
                .sessionId("afv:v2:conversation-7:assistant-v3")
                .put(AgentConversationContext.class, new AgentConversationContext(
                        "conversation-7", "assistant-v3", null))
                .put(AgentRunContext.class, new AgentRunContext(
                        "run-1", "instance-1", 1L, Instant.now().plusSeconds(600),
                        null, null))
                .build();
    }

    private static Msg userMessage(String text) {
        return Msg.builder().role(io.agentscope.core.message.MsgRole.USER)
                .content(List.of(TextBlock.builder().text(text).build()))
                .build();
    }

    @Test
    @DisplayName("chat span:带模型名/会话/run 属性,流尾补 usage 与结束原因")
    void emitsChatSpanWithUsageOnStreamEnd() {
        UsageChatModel delegate = new UsageChatModel();
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                delegate, new InMemoryStateStoreFailureGuard(), null, null, otelFactory());

        StepVerifier.create(guarded.stream(
                                List.of(userMessage("帮我写一句话")), List.of(),
                                GenerateOptions.builder().build())
                        .contextWrite(context ->
                                context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime())))
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("alpha"))
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("beta"))
                .verifyComplete();

        List<SpanData> spans = exporter.getFinishedSpanItems();
        assertThat(spans).hasSize(1);
        SpanData span = spans.getFirst();
        assertThat(span.getName()).isEqualTo("chat usage-model");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.operation.name")))
                .isEqualTo("chat");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.request.model")))
                .isEqualTo("usage-model");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.conversation.id")))
                .isEqualTo("conversation-7");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("inneragent.run.id")))
                .isEqualTo("run-1");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.response.finish_reason")))
                .isEqualTo("stop");
        assertThat(span.getAttributes().get(AttributeKey.longKey("gen_ai.usage.input_tokens")))
                .isEqualTo(120L);
        assertThat(span.getAttributes().get(AttributeKey.longKey("gen_ai.usage.output_tokens")))
                .isEqualTo(45L);
        // capture-content=true:prompt 摘要入属性
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.prompt")))
                .isEqualTo("帮我写一句话");
    }

    @Test
    @DisplayName("noop 工厂:流原样透传且零 span;上游错误路径同样收 span")
    void streamsRemainIntactWithFactory() {
        OtelGenAiSpanFactory factory = otelFactory();
        BoomChatModel delegate = new BoomChatModel();
        StateStoreGuardedChatModel guarded = new StateStoreGuardedChatModel(
                delegate, new InMemoryStateStoreFailureGuard(), null, null, factory);

        StepVerifier.create(guarded.stream(
                                List.of(), List.of(), GenerateOptions.builder().build())
                        .contextWrite(context ->
                                context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime())))
                .expectError(IllegalStateException.class)
                .verify();

        List<SpanData> spans = exporter.getFinishedSpanItems();
        assertThat(spans).hasSize(1);
        assertThat(spans.getFirst().getStatus().getStatusCode())
                .isEqualTo(io.opentelemetry.api.trace.StatusCode.ERROR);

        // noop 工厂:无任何 span 产物,流行为与无挂点一致
        StateStoreGuardedChatModel noopGuarded = new StateStoreGuardedChatModel(
                new UsageChatModel(), new InMemoryStateStoreFailureGuard(), null, null,
                GenAiSpanFactory.noop());
        StepVerifier.create(noopGuarded.stream(
                        List.of(), List.of(), GenerateOptions.builder().build())
                .contextWrite(context ->
                        context.put(AgentBase.RUNTIME_CONTEXT_KEY, runtime())))
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("alpha"))
                .assertNext(response -> assertThat(chunkText(response)).isEqualTo("beta"))
                .verifyComplete();
        assertThat(exporter.getFinishedSpanItems()).hasSize(1);
    }

    private static String chunkText(ChatResponse response) {
        return ((TextBlock) response.getContent().getFirst()).getText();
    }

    /** 双 chunk + 末 chunk 带 usage/结束原因的假模型。 */
    private static final class UsageChatModel extends ChatModelBase {

        private UsageChatModel() {
            setContextWindowSize(8_192);
        }

        @Override
        public String getModelName() {
            return "usage-model";
        }

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            ChatUsage usage = ChatUsage.builder()
                    .inputTokens(120)
                    .outputTokens(45)
                    .build();
            return Flux.just(
                    simpleChunk("alpha"),
                    ChatResponse.builder()
                            .content(List.of(TextBlock.builder().text("beta").build()))
                            .usage(usage)
                            .finishReason("stop")
                            .build());
        }

        private ChatResponse simpleChunk(String text) {
            return ChatResponse.builder()
                    .content(List.of(TextBlock.builder().text(text).build()))
                    .build();
        }
    }

    /** 直接失败的假模型(验证 error 记录路径)。 */
    private static final class BoomChatModel extends ChatModelBase {

        private BoomChatModel() {
            setContextWindowSize(8_192);
        }

        @Override
        public String getModelName() {
            return "boom-model";
        }

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            return Flux.error(new IllegalStateException("provider down"));
        }
    }
}
