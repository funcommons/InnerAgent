package com.inneragent.model.provider;

import com.inneragent.model.entity.AiModel;
import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.message.ToolUseBlock;
import io.agentscope.core.model.ChatModelBase;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.ToolSchema;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * MockAiProvider 脚本化测试(U1/D2):legacy get_current_time 形态保持不变,
 * 新增 mockScript 配置(指定第 N 轮调用哪个工具 / 默认 toolkit 第一个工具)。
 */
class MockAiProviderTests {

    private final MockAiProvider provider = new MockAiProvider();

    // ------------------------------------------------------------------
    // legacy 形态(无 mockScript 配置;P0 冒烟与既有行为不破坏)
    // ------------------------------------------------------------------

    @Test
    void legacyFormCallsBuiltinTimeToolWhenAvailable() {
        ChatModelBase model = model(null);

        List<ChatResponse> responses = model.stream(
                List.of(), tools("get_current_time"), options()).collectList().block();

        assertThat(responses).hasSize(1);
        ToolUseBlock call = soleToolCall(responses);
        assertThat(call.getName()).isEqualTo("get_current_time");
        assertThat(call.getInput()).isEmpty();
    }

    @Test
    void legacyFormFallsBackToTextWithoutTimeTool() {
        ChatModelBase model = model(null);

        List<ChatResponse> responses = model.stream(
                List.of(), tools("other_tool"), options()).collectList().block();

        assertThat(responses).isNotEmpty();
        assertThat(allText(responses)).contains("get_current_time");
        assertThat(responses.getLast().getFinishReason()).isEqualTo("stop");
    }

    @Test
    void legacyFormAnswersAfterToolResult() {
        ChatModelBase model = model(null);
        List<Msg> messages = List.of(userMessage(), toolResultMessage(
                "{\"status\":\"success\",\"time\":\"2026-09-20T10:00+08:00\",\"timezone\":\"Asia/Shanghai\"}"));

        List<ChatResponse> responses = model.stream(
                messages, tools("get_current_time"), options()).collectList().block();

        String text = allText(responses);
        assertThat(text).contains("当前时间是");
        assertThat(text).contains("Asia/Shanghai");
        assertThat(responses.getLast().getFinishReason()).isEqualTo("stop");
    }

    // ------------------------------------------------------------------
    // [adapt] U1/D2 脚本形态(mockScript 配置)
    // ------------------------------------------------------------------

    @Test
    void scriptCallsConfiguredHostToolWithConfiguredArgs() {
        ChatModelBase model = model(List.of(Map.of(
                "tool", "create_host_record",
                "args", Map.of("title", "U1验收-批准路径"))));

        List<ChatResponse> responses = model.stream(
                List.of(), tools("get_current_time", "create_host_record"),
                options()).collectList().block();

        ToolUseBlock call = soleToolCall(responses);
        assertThat(call.getName()).isEqualTo("create_host_record");
        assertThat(call.getInput()).containsEntry("title", "U1验收-批准路径");
    }

    @Test
    void scriptDefaultsToFirstToolkitToolWhenEmpty() {
        ChatModelBase model = model(List.of());

        List<ChatResponse> responses = model.stream(
                List.of(), tools("get_host_time", "create_host_record"),
                options()).collectList().block();

        assertThat(soleToolCall(responses).getName()).isEqualTo("get_host_time");
    }

    @Test
    void scriptDrivesMultiRoundToolCallsThenAnswers() {
        ChatModelBase model = model(List.of(
                "get_host_time",
                Map.of("tool", "create_host_record", "args", Map.of("title", "T"))));
        List<ToolSchema> toolkit = tools("get_host_time", "create_host_record");

        // 第 1 轮:调用脚本第 1 项
        List<ChatResponse> first = model.stream(
                List.of(), toolkit, options()).collectList().block();
        assertThat(soleToolCall(first).getName()).isEqualTo("get_host_time");

        // 第 2 轮(已见 1 个结果):调用脚本第 2 项
        List<ChatResponse> second = model.stream(
                List.of(toolResultMessage("{\"status\":\"ok\"}")), toolkit,
                options()).collectList().block();
        ToolUseBlock call = soleToolCall(second);
        assertThat(call.getName()).isEqualTo("create_host_record");
        assertThat(call.getInput()).containsEntry("title", "T");

        // 第 3 轮(已见 2 个结果):脚本耗尽,流式作答收尾
        List<ChatResponse> third = model.stream(
                List.of(
                        toolResultMessage("{\"status\":\"ok\"}"),
                        toolResultMessage("{\"status\":\"ok\",\"recordId\":1}")),
                toolkit, options()).collectList().block();
        assertThat(third.getLast().getFinishReason()).isEqualTo("stop");
        assertThat(allText(third)).contains("工具执行返回");
    }

    @Test
    void scriptSkipsToolMissingFromToolkitAndAnswers() {
        ChatModelBase model = model(List.of("not_registered_tool"));

        List<ChatResponse> responses = model.stream(
                List.of(), tools("get_current_time"), options()).collectList().block();

        assertThat(responses.getLast().getFinishReason()).isEqualTo("stop");
        assertThat(allText(responses)).contains("get_current_time");
    }

    // ------------------------------------------------------------------
    // parseScript 配置形态
    // ------------------------------------------------------------------

    @Test
    void parseScriptSupportsConfigForms() {
        // 字符串工具名
        assertThat(provider.parseScript("create_host_record"))
                .containsExactly(MockAiProvider.ScriptedCall.of("create_host_record"));
        // 数组多轮(字符串与对象混合)
        assertThat(provider.parseScript(List.of(
                        "get_host_time",
                        Map.of("tool", "create_host_record", "args", Map.of("title", "t")))))
                .containsExactly(
                        MockAiProvider.ScriptedCall.of("get_host_time"),
                        MockAiProvider.ScriptedCall.of("create_host_record", Map.of("title", "t")));
        // rounds 包装对象
        assertThat(provider.parseScript(Map.of(
                        MockAiProvider.SCRIPT_ROUNDS_FIELD, List.of("get_host_time"))))
                .containsExactly(MockAiProvider.ScriptedCall.of("get_host_time"));
        // true / 空数组 = 缺省「toolkit 第一个工具」
        assertThat(provider.parseScript(Boolean.TRUE)).isEmpty();
        assertThat(provider.parseScript(List.of())).isEmpty();
        // null / false / 非法形态 = legacy
        assertThat(provider.parseScript(null)).isNull();
        assertThat(provider.parseScript(Boolean.FALSE)).isNull();
        assertThat(provider.parseScript(42)).isNull();
    }

    // ------------------------------------------------------------------
    // fixtures
    // ------------------------------------------------------------------

    /**
     * 构造 mock 模型:rawScriptConfig 为 ia_ai_model.config JSON 解析后的
     * {@code mockScript} 值(null=无配置,即 legacy 形态)。
     */
    private ChatModelBase model(Object rawScriptConfig) {
        return provider.createAgentScopeModel(AiProviderContext.builder()
                .model(AiModel.builder().id(1L).code("mock-text").build())
                .platform(MockAiProvider.PLATFORM)
                .modelName("mock-text")
                .config(rawScriptConfig == null
                        ? Map.of()
                        : Map.of(MockAiProvider.SCRIPT_CONFIG_KEY, rawScriptConfig))
                .build());
    }

    private static GenerateOptions options() {
        return GenerateOptions.builder().build();
    }

    private static List<ToolSchema> tools(String... names) {
        return List.of(names).stream()
                .map(name -> ToolSchema.builder().name(name).description(name).build())
                .toList();
    }

    private static Msg userMessage() {
        return Msg.builder().textContent("现在几点了?").build();
    }

    private static Msg toolResultMessage(String json) {
        return Msg.builder()
                .role(io.agentscope.core.message.MsgRole.TOOL)
                .content(ToolResultBlock.text(json))
                .build();
    }

    private static ToolUseBlock soleToolCall(List<ChatResponse> responses) {
        List<ToolUseBlock> calls = responses.stream()
                .map(ChatResponse::getContent)
                .flatMap(List::stream)
                .filter(ToolUseBlock.class::isInstance)
                .map(ToolUseBlock.class::cast)
                .toList();
        assertThat(calls).hasSize(1);
        return calls.getFirst();
    }

    private static String allText(List<ChatResponse> responses) {
        StringBuilder text = new StringBuilder();
        responses.stream()
                .map(ChatResponse::getContent)
                .flatMap(List::stream)
                .filter(TextBlock.class::isInstance)
                .map(TextBlock.class::cast)
                .forEach(block -> text.append(block.getText()));
        return text.toString();
    }
}
