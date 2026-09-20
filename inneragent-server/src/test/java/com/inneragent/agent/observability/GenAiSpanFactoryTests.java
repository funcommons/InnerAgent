package com.inneragent.agent.observability;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * GenAI span 工厂契约测试(任务 #18b):noop 零开销路径 + OTel 桥接下
 * invoke_agent/chat/execute_tool/MCP client 四类 span 的属性完备性、
 * capture-content 开关前后差异、错误记录与内容截断。
 */
class GenAiSpanFactoryTests {

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

    private OtelGenAiSpanFactory otelFactory(boolean captureContent) {
        OpenTelemetrySdk sdk = OpenTelemetrySdk.builder()
                .setTracerProvider(tracerProvider)
                .build();
        return new OtelGenAiSpanFactory(sdk, captureContent, 16);
    }

    @Test
    @DisplayName("noop 工厂:builder/span 均为共享单例,属性与 end 全部零状态")
    void noopFactoryIsZeroOverhead() {
        GenAiSpanFactory factory = GenAiSpanFactory.noop();

        assertThat(factory.isNoop()).isTrue();
        GenAiSpanFactory.SpanBuilder first = factory.spanBuilder("invoke_agent");
        GenAiSpanFactory.SpanBuilder second = factory.spanBuilder("chat model");
        assertThat(first)
                .isSameAs(second)
                .isSameAs(first.attr("k", "v")
                        .attr("n", 1L)
                        .contentAttr("gen_ai.prompt", "secret content"));
        GenAiSpanFactory.GenAiSpan span = first.startSpan();
        span.setAttribute("k", "v");
        span.setAttribute("n", 2L);
        span.error(new IllegalStateException("boom"));
        span.contentAttribute("gen_ai.prompt", "x");
        span.end();
        span.close();
        assertThat(factory.spanBuilder("x").startSpan()).isSameAs(span);
    }

    @Test
    @DisplayName("invoke_agent span:agent.id/name/type + conversation/run 属性完备")
    void invokeAgentSpanCarriesAgentAttributes() {
        GenAiSpanFactory factory = otelFactory(false);

        factory.spanBuilder(GenAiSemanticAttributes.Operations.INVOKE_AGENT)
                .attr(GenAiSemanticAttributes.OPERATION_NAME,
                        GenAiSemanticAttributes.Operations.INVOKE_AGENT)
                .attr(GenAiSemanticAttributes.AGENT_ID, "assistant-v3")
                .attr(GenAiSemanticAttributes.AGENT_NAME, "写作助手")
                .attr(GenAiSemanticAttributes.AGENT_TYPE, "root")
                .attr(GenAiSemanticAttributes.CONVERSATION_ID, "conv-1")
                .attr(GenAiSemanticAttributes.RUN_ID, "run-1")
                .startSpan()
                .end();

        List<SpanData> spans = exporter.getFinishedSpanItems();
        assertThat(spans).hasSize(1);
        SpanData span = spans.getFirst();
        assertThat(span.getName()).isEqualTo("invoke_agent");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.operation.name")))
                .isEqualTo("invoke_agent");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.agent.id")))
                .isEqualTo("assistant-v3");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.agent.name")))
                .isEqualTo("写作助手");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.agent.type")))
                .isEqualTo("root");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.conversation.id")))
                .isEqualTo("conv-1");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("inneragent.run.id")))
                .isEqualTo("run-1");
    }

    @Test
    @DisplayName("chat span:模型名 + usage token 数 + 结束原因;空值属性不落")
    void chatSpanCarriesModelUsageAndFinishReason() {
        GenAiSpanFactory factory = otelFactory(false);

        GenAiSpanFactory.GenAiSpan span = factory.spanBuilder("chat gpt-x")
                .attr(GenAiSemanticAttributes.OPERATION_NAME,
                        GenAiSemanticAttributes.Operations.CHAT)
                .attr(GenAiSemanticAttributes.REQUEST_MODEL, "gpt-x")
                .attr(GenAiSemanticAttributes.CONVERSATION_ID, "")
                .startSpan();
        span.setAttribute(GenAiSemanticAttributes.USAGE_INPUT_TOKENS, 120L);
        span.setAttribute(GenAiSemanticAttributes.USAGE_OUTPUT_TOKENS, 45L);
        span.setAttribute(GenAiSemanticAttributes.RESPONSE_FINISH_REASON, "stop");
        span.end();

        SpanData data = exporter.getFinishedSpanItems().getFirst();
        assertThat(data.getName()).isEqualTo("chat gpt-x");
        assertThat(data.getAttributes().get(AttributeKey.stringKey("gen_ai.request.model")))
                .isEqualTo("gpt-x");
        assertThat(data.getAttributes().get(AttributeKey.longKey("gen_ai.usage.input_tokens")))
                .isEqualTo(120L);
        assertThat(data.getAttributes().get(AttributeKey.longKey("gen_ai.usage.output_tokens")))
                .isEqualTo(45L);
        assertThat(data.getAttributes().get(AttributeKey.stringKey("gen_ai.response.finish_reason")))
                .isEqualTo("stop");
        // 空串属性不落(避免空键噪声)
        assertThat(data.getAttributes().get(AttributeKey.stringKey("gen_ai.conversation.id")))
                .isNull();
    }

    @Test
    @DisplayName("execute_tool span:tool.name/description/call.id + risk_level")
    void executeToolSpanCarriesToolAttributes() {
        GenAiSpanFactory factory = otelFactory(false);

        factory.spanBuilder(GenAiSemanticAttributes.Operations.EXECUTE_TOOL + " parse_text_file")
                .attr(GenAiSemanticAttributes.OPERATION_NAME,
                        GenAiSemanticAttributes.Operations.EXECUTE_TOOL)
                .attr(GenAiSemanticAttributes.TOOL_NAME, "parse_text_file")
                .attr(GenAiSemanticAttributes.TOOL_DESCRIPTION, "解析文本文件")
                .attr(GenAiSemanticAttributes.TOOL_CALL_ID, "call-9")
                .attr(GenAiSemanticAttributes.RISK_LEVEL, "READ_ONLY")
                .startSpan()
                .end();

        SpanData span = exporter.getFinishedSpanItems().getFirst();
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.tool.name")))
                .isEqualTo("parse_text_file");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.tool.description")))
                .isEqualTo("解析文本文件");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.tool.call.id")))
                .isEqualTo("call-9");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("inneragent.risk.level")))
                .isEqualTo("READ_ONLY");
    }

    @Test
    @DisplayName("MCP client span:mcp.method.name=tools/call + mcp.tool.name + server.key")
    void mcpClientSpanCarriesServerAndTool() {
        GenAiSpanFactory factory = otelFactory(false);

        factory.spanBuilder(GenAiSemanticAttributes.Operations.MCP_TOOLS_CALL)
                .attr(GenAiSemanticAttributes.OPERATION_NAME,
                        GenAiSemanticAttributes.Operations.MCP_TOOLS_CALL)
                .attr(GenAiSemanticAttributes.TOOL_NAME, "create_host_record")
                .attr(GenAiSemanticAttributes.MCP_SERVER_KEY, "demo-spring-host")
                .attr(GenAiSemanticAttributes.RUN_ID, "run-77")
                .startSpan()
                .end();

        SpanData span = exporter.getFinishedSpanItems().getFirst();
        assertThat(span.getName()).isEqualTo("tools/call");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.operation.name")))
                .isEqualTo("tools/call");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("gen_ai.tool.name")))
                .isEqualTo("create_host_record");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("inneragent.mcp.server.key")))
                .isEqualTo("demo-spring-host");
        assertThat(span.getAttributes().get(AttributeKey.stringKey("inneragent.run.id")))
                .isEqualTo("run-77");
    }

    @Test
    @DisplayName("capture-content=false:prompt/completion 内容属性不记录;true 时记录并截断")
    void contentAttributesGateAndTruncate() {
        String longPrompt = "p".repeat(64);

        otelFactory(false).spanBuilder("chat gpt-x")
                .contentAttr(GenAiSemanticAttributes.PROMPT, longPrompt)
                .startSpan()
                .end();
        assertThat(exporter.getFinishedSpanItems().getFirst()
                .getAttributes().get(AttributeKey.stringKey("gen_ai.prompt"))).isNull();

        GenAiSpanFactory.GenAiSpan span = otelFactory(true).spanBuilder("chat gpt-x")
                .contentAttr(GenAiSemanticAttributes.PROMPT, longPrompt)
                .startSpan();
        span.contentAttribute(GenAiSemanticAttributes.COMPLETION, "done");
        span.end();
        SpanData recorded = exporter.getFinishedSpanItems().getLast();
        assertThat(recorded.getAttributes().get(AttributeKey.stringKey("gen_ai.prompt")))
                .isEqualTo("p".repeat(16));
        assertThat(recorded.getAttributes().get(AttributeKey.stringKey("gen_ai.completion")))
                .isEqualTo("done");
    }

    @Test
    @DisplayName("error():记录异常并置 ERROR 状态")
    void errorRecordsExceptionAndStatus() {
        GenAiSpanFactory factory = otelFactory(false);

        GenAiSpanFactory.GenAiSpan span = factory.spanBuilder("execute_tool boom")
                .startSpan();
        IllegalStateException failure = new IllegalStateException("tool exploded");
        span.error(failure);
        span.end();

        SpanData data = exporter.getFinishedSpanItems().getFirst();
        assertThat(data.getStatus().getStatusCode()).isEqualTo(StatusCode.ERROR);
        assertThat(data.getEvents()).hasSize(1);
        assertThat(data.getEvents().getFirst()
                .getAttributes().get(AttributeKey.stringKey("exception.type")))
                .isEqualTo("java.lang.IllegalStateException");
    }
}
