package com.inneragent.model.provider;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.inneragent.server.controller.vo.RemoteModelVO;
import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.message.ToolUseBlock;
import io.agentscope.core.model.ChatModelBase;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.ChatUsage;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.ToolSchema;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;

/**
 * <strong>Mock 模型提供商(platform 常量 {@code mock})——仅用于 P0 冒烟与测试,生产环境禁用!</strong>
 *
 * <p>不访问任何外部服务,按确定性脚本输出,让 P0 冒烟在没有真实 API Key 的环境下
 * 也能产生 CONTENT 增量、工具调用与终态 DONE 事件:
 * <ol>
 *   <li>首轮:若可用工具中包含 {@code get_current_time},返回一次工具调用
 *       (ToolUseBlock),驱动平台真实执行内置工具;</li>
 *   <li>次轮:看到工具结果后,按固定模板流式输出若干 CONTENT delta(内嵌工具返回的时间),
 *       然后完成。</li>
 * </ol>
 *
 * <p>[adapt] U1/D2:mock 脚本化——保留既有 get_current_time 行为(无脚本配置时
 * 语义与 P0 冒烟完全一致),新增「脚本指定工具调用」能力:模型配置
 * ({@code ia_ai_model.config} JSON,经 {@link AiProviderContext#getConfig()} 注入)
 * 携带 {@code mockScript} 键即可覆盖首轮脚本,让宿主桥/写确认链路可在无真实
 * 模型的环境下被脚本化驱动(见 {@link #parseScript} 支持形态;缺省形态为
 * 「toolkit 第一个工具」)。
 *
 * <p>启用方式(无需任何开关):{@code ia_model_api_config.platform='mock'} 且
 * {@code text_protocol='mock'},并挂接一条 {@code ia_ai_model} 记录(见
 * {@code V4__demo_seed.sql});模型请求协议解析为 {@code mock} 即命中本 Provider。
 *
 * <p>风险提示:mock 模型的回复是脚本固定文案,不是真实模型推理结果。演示部署若把它
 * 配成默认对话模型,用户可能误以为在和一个真模型对话——因此生产环境严禁保留该配置,
 * 演示环境的模型名称统一以 {@code mock-} 前缀标识。Spring AI 侧的连通性检测
 * ({@link #createChatModel})也返回固定文案,同样不代表真实连通。
 */
@Component
@Slf4j
public class MockAiProvider implements AiProvider {

    /** 平台标识;与 ia_model_api_config.platform / text_protocol = 'mock' 对应。 */
    public static final String PLATFORM = "mock";

    /**
     * [adapt] U1/D2:模型配置({@code ia_ai_model.config} JSON)中的 mock 脚本键。
     * 支持形态见 {@link #parseScript}:字符串工具名、工具名数组(多轮)、
     * {@code [{"tool":..,"args":{..}}]} 对象数组、{@code {"rounds":[...]}} 包装,
     * 以及 {@code true}/空数组(=默认调用 toolkit 第一个工具)。缺省(无该键)
     * 保持既有 get_current_time 脚本不变。
     */
    public static final String SCRIPT_CONFIG_KEY = "mockScript";

    static final String SCRIPT_TOOL_FIELD = "tool";
    static final String SCRIPT_ARGS_FIELD = "args";
    static final String SCRIPT_ROUNDS_FIELD = "rounds";

    /** 脚本会主动调用的内置工具名(legacy 形态;无脚本配置时保持 P0 行为)。 */
    private static final String TIME_TOOL = "get_current_time";

    /** 不可用 get_current_time 时的固定回复(按 P0 任务卡给定文案)。 */
    private static final List<String> FALLBACK_DELTAS = List.of(
            "[mock] 你好,",
            "当前时间请用 ",
            "get_current_time 工具查询。");

    /** 每个 delta 之间的间隔;让一次运行持续数秒,便于冒烟脚本断流重连。 */
    private static final Duration DELTA_INTERVAL = Duration.ofMillis(800);

    private static final int MOCK_TOKENS = 1;

    private final AtomicLong responseSequence = new AtomicLong();

    @Override
    public boolean supports(String platform) {
        return PLATFORM.equalsIgnoreCase(platform);
    }

    @Override
    public ChatModel createChatModel(AiProviderContext context) {
        // 仅供 ia_model 连通性检测按钮返回固定文案,不代表真实连通(详见类注释)。
        return new MockSpringAiChatModel(resolveModelName(context));
    }

    /** Spring AI 侧最小实现:连通性检测返回固定文案,流式不支持。 */
    private static final class MockSpringAiChatModel implements ChatModel {

        private final String modelName;

        private MockSpringAiChatModel(String modelName) {
            this.modelName = modelName;
        }

        @Override
        public org.springframework.ai.chat.model.ChatResponse call(Prompt prompt) {
            return org.springframework.ai.chat.model.ChatResponse.builder()
                    .generations(List.of(new Generation(new AssistantMessage(
                            "[mock] " + modelName + " 已响应(固定文案,仅用于 P0 冒烟与测试,生产禁用)。"))))
                    .build();
        }

        @Override
        public Flux<org.springframework.ai.chat.model.ChatResponse> stream(Prompt prompt) {
            return Flux.error(new UnsupportedOperationException(
                    "mock 平台不支持 Spring AI 流式调用(仅 P0 冒烟用,生产禁用)"));
        }
    }

    @Override
    public ChatModelBase createAgentScopeModel(AiProviderContext context) {
        return new MockChatModelBase(
                resolveModelName(context),
                parseScript(context == null ? null : context.getConfig()
                        .get(SCRIPT_CONFIG_KEY)));
    }

    @Override
    public List<RemoteModelVO> listRemoteModels(AiProviderContext context) {
        // mock 平台没有远程模型目录,由本地 seed 数据提供模型记录。
        return List.of();
    }

    private static String resolveModelName(AiProviderContext context) {
        return context.getModelName() != null ? context.getModelName() : "mock-text";
    }

    // ------------------------------------------------------------------
    // [adapt] U1/D2:脚本解析(模型配置 → 有序工具调用脚本)
    // ------------------------------------------------------------------

    /**
     * 解析 {@code mockScript} 配置为有序脚本(每轮一个工具调用):
     * <ul>
     *   <li>{@code null}/{@code false}/空白 → {@code null}(legacy:get_current_time 脚本);</li>
     *   <li>{@code true} / 空数组 / 空对象 → 空脚本(默认:toolkit 第一个工具);</li>
     *   <li>字符串 {@code "tool_a"} → 单轮调用 tool_a;</li>
     *   <li>数组 → 多轮,元素可为工具名字符串或 {@code {"tool":..,"args":{..}}};</li>
     *   <li>对象 {@code {"rounds":[...]}} → 同数组;含 {@code "tool"} 键 → 单轮。</li>
     * </ul>
     * 非法形态降级为 legacy(不阻断运行),并 WARN 提示。
     */
    List<ScriptedCall> parseScript(Object raw) {
        if (raw == null || Boolean.FALSE.equals(raw)) {
            return null;
        }
        if (Boolean.TRUE.equals(raw)) {
            return List.of();
        }
        if (raw instanceof String name) {
            return name.isBlank() ? null : List.of(ScriptedCall.of(name.trim()));
        }
        if (raw instanceof Map<?, ?> map) {
            Object rounds = map.get(SCRIPT_ROUNDS_FIELD);
            if (rounds != null) {
                return parseScript(rounds);
            }
            Object tool = map.get(SCRIPT_TOOL_FIELD);
            if (tool instanceof String name && !name.isBlank()) {
                return List.of(ScriptedCall.of(name.trim(), argsOf(map.get(SCRIPT_ARGS_FIELD))));
            }
            return List.of();
        }
        if (raw instanceof List<?> items) {
            List<ScriptedCall> calls = new ArrayList<>();
            for (Object item : items) {
                if (item instanceof String name && !name.isBlank()) {
                    calls.add(ScriptedCall.of(name.trim()));
                } else if (item instanceof Map<?, ?> call) {
                    Object tool = call.get(SCRIPT_TOOL_FIELD);
                    if (tool instanceof String name && !name.isBlank()) {
                        calls.add(ScriptedCall.of(
                                name.trim(), argsOf(call.get(SCRIPT_ARGS_FIELD))));
                    }
                }
            }
            return List.copyOf(calls);
        }
        log.warn("[mock] mockScript 配置形态无法解析,回退 legacy 脚本: {}", raw);
        return null;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> argsOf(Object raw) {
        if (raw instanceof Map<?, ?> args) {
            return (Map<String, Object>) args;
        }
        return Map.of();
    }

    /** 脚本中的一轮工具调用(工具名 + 确定性入参)。 */
    record ScriptedCall(String toolName, Map<String, Object> args) {

        ScriptedCall {
            toolName = Objects.requireNonNull(toolName, "toolName must not be null");
            args = args == null ? Map.of() : Map.copyOf(args);
        }

        static ScriptedCall of(String toolName) {
            return new ScriptedCall(toolName, Map.of());
        }

        static ScriptedCall of(String toolName, Map<String, Object> args) {
            return new ScriptedCall(toolName, args);
        }
    }

    /**
     * 确定性脚本化的 AgentScope 模型:按脚本发起工具调用,看到工具结果后流式输出
     * 固定模板文案。无状态、线程安全、完全确定性。脚本为空(null)时保持
     * legacy 形态:get_current_time 优先,结果回灌后按固定模板收尾。
     */
    private final class MockChatModelBase extends ChatModelBase {

        private final String modelName;
        /** [adapt] U1/D2:脚本(可能为 null=legacy);工具名在 toolkit 缺失时按轮跳过。 */
        private final List<ScriptedCall> script;

        private MockChatModelBase(String modelName, List<ScriptedCall> script) {
            this.modelName = Objects.requireNonNull(modelName, "modelName must not be null");
            this.script = script;
        }

        @Override
        public String getModelName() {
            return modelName;
        }

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            return Flux.defer(() -> {
                List<String> toolResults = toolResultTexts(messages);
                String lastToolResult = toolResults.isEmpty() ? null : toolResults.getLast();
                if (script == null) {
                    // legacy:首轮 get_current_time;见过任何工具结果即收尾
                    if (lastToolResult == null && hasTimeTool(tools)) {
                        return Flux.just(toolCallResponse(TIME_TOOL, Map.of()));
                    }
                    return answerFlux(lastToolResult);
                }
                return scriptedFlux(toolResults, tools, lastToolResult);
            });
        }

        /** [adapt] U1/D2:脚本形态——第 N 轮(已见 N 个工具结果)调用脚本第 N 项。 */
        private Flux<ChatResponse> scriptedFlux(
                List<String> toolResults, List<ToolSchema> tools, String lastToolResult) {
            int round = toolResults.size();
            ScriptedCall call = round < script.size()
                    ? script.get(round)
                    : null;
            if (call == null && script.isEmpty() && round == 0) {
                // 缺省形态:toolkit 第一个工具
                String first = firstToolkitTool(tools);
                if (first != null) {
                    call = ScriptedCall.of(first);
                }
            }
            if (call != null) {
                if (hasTool(tools, call.toolName())) {
                    return Flux.just(toolCallResponse(call.toolName(), call.args()));
                }
                log.warn("[mock] 脚本第 {} 轮工具 {} 不在 toolkit,跳过工具调用直接作答;model 可见工具={}",
                        round + 1, call.toolName(),
                        tools == null ? List.of() : tools.stream()
                                .map(ToolSchema::getName).toList());
            }
            return answerFlux(lastToolResult);
        }

        private boolean hasTimeTool(List<ToolSchema> tools) {
            return hasTool(tools, TIME_TOOL);
        }

        private boolean hasTool(List<ToolSchema> tools, String toolName) {
            return tools != null && tools.stream()
                    .anyMatch(tool -> toolName.equals(tool.getName()));
        }

        private String firstToolkitTool(List<ToolSchema> tools) {
            return tools == null || tools.isEmpty() ? null : tools.getFirst().getName();
        }

        /** 一轮脚本:发起指定工具调用(确定性入参)。 */
        private ChatResponse toolCallResponse(String toolName, Map<String, Object> input) {
            // content = 入参 JSON 字符串:AgentScope 流式累加器/参数校验以
            // ToolUseBlock.content 为模型产出参数的载体(缺失时按空参校验,
            // required 字段将误报缺失),与 input 需同时携带
            ToolUseBlock toolCall = ToolUseBlock.builder()
                    .id("mock-call-" + responseSequence.incrementAndGet())
                    .name(toolName)
                    .input(input)
                    .content(JSONUtil.toJsonStr(input))
                    .build();
            return ChatResponse.builder()
                    .id("mock-resp-" + responseSequence.incrementAndGet())
                    .content(List.<ContentBlock>of(toolCall))
                    .finishReason("tool_use")
                    .usage(new ChatUsage(MOCK_TOKENS, MOCK_TOKENS, 0d))
                    .build();
        }

        /** 收尾脚本:把最近一次工具结果嵌入固定模板,按 delta 流式输出后完成。 */
        private Flux<ChatResponse> answerFlux(String toolResultText) {
            List<String> deltas = toolResultText == null
                    ? FALLBACK_DELTAS
                    : answerDeltas(toolResultText);
            String responseId = "mock-resp-" + responseSequence.incrementAndGet();
            return Flux.range(0, deltas.size())
                    .map(index -> {
                        boolean last = index == deltas.size() - 1;
                        ChatResponse.Builder builder = ChatResponse.builder()
                                .id(responseId)
                                .content(List.<ContentBlock>of(TextBlock.builder()
                                        .text(deltas.get(index))
                                        .build()));
                        if (last) {
                            builder.finishReason("stop")
                                    .usage(new ChatUsage(MOCK_TOKENS, MOCK_TOKENS, 0d));
                        }
                        return builder.build();
                    })
                    .delayElements(DELTA_INTERVAL);
        }

        private List<String> answerDeltas(String toolResultText) {
            List<String> deltas = new ArrayList<>();
            deltas.add("[mock] 你好,");
            JSONObject toolResult = parseQuietly(toolResultText);
            if (toolResult != null && "success".equals(toolResult.getStr("status"))) {
                deltas.add("当前时间是 ");
                deltas.add(toolResult.getStr("time", "") + "(时区 " + toolResult.getStr("timezone", "") + ")");
                deltas.add(",来自 " + TIME_TOOL + " 工具。");
            } else {
                deltas.add("工具执行返回: ");
                deltas.add(abbreviate(toolResultText));
            }
            deltas.add("(本回复由 mock 模型脚本生成,仅用于 P0 冒烟与测试,生产禁用。)");
            return List.copyOf(deltas);
        }

        private JSONObject parseQuietly(String text) {
            try {
                return JSONUtil.parseObj(text);
            } catch (Exception invalidJson) {
                return null;
            }
        }

        private String abbreviate(String text) {
            String compact = text.replaceAll("\\s+", " ").trim();
            return compact.length() <= 120 ? compact : compact.substring(0, 120) + "...";
        }

        /**
         * 扫描会话消息,返回全部工具结果文本(按出现顺序);无工具结果返回空列表。
         * legacy 形态以「是否已见过工具结果」为轮次判据;脚本形态以结果个数
         * 定位下一轮。
         */
        private List<String> toolResultTexts(List<Msg> messages) {
            if (messages == null) {
                return List.of();
            }
            List<String> texts = new ArrayList<>();
            for (Msg message : messages) {
                if (!message.hasContentBlocks(ToolResultBlock.class)) {
                    continue;
                }
                for (ToolResultBlock block : message.getContentBlocks(ToolResultBlock.class)) {
                    for (ContentBlock output : block.getOutput()) {
                        if (output instanceof TextBlock textBlock
                                && textBlock.getText() != null
                                && !textBlock.getText().isBlank()) {
                            texts.add(textBlock.getText());
                        }
                    }
                }
            }
            return List.copyOf(texts);
        }
    }
}
