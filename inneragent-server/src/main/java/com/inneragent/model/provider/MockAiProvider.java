package com.inneragent.model.provider;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.inneragent.server.controller.vo.RemoteModelVO;
import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
 * <p>[adapt] CI-canned(2026-09-28):规则式脚本——{@code mockScript} 取
 * {@code {"rules":[{"match":"正则","tool":"工具","args":{…},"reply":"固定回复"},…],
 * "default":"兜底回复","deltaMs":60}} 对象形态时,按「最后一条用户文本」顺序
 * 匹配规则:先(可选)发起工具调用({@code $1..$9} 注入捕获组),工具结果
 * 回灌后流式输出 {@code reply};全部未命中走 {@code default}。demo 全量回归
 * 的 CI 化(24 用例不依赖真实模型)由此驱动,规则与 driver 话术一一对应
 * (见 {@code examples/acme-demo/seeds/mock-model-script.sql})。
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

    /** [adapt] CI-canned(2026-09-28):规则式脚本的子键(mockScript 对象形态)。 */
    static final String SCRIPT_RULES_FIELD = "rules";
    static final String SCRIPT_MATCH_FIELD = "match";
    static final String SCRIPT_REPLY_FIELD = "reply";
    static final String SCRIPT_DEFAULT_FIELD = "default";
    static final String SCRIPT_DELTA_MS_FIELD = "deltaMs";

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
        Object rawScript = context == null ? null : context.getConfig().get(SCRIPT_CONFIG_KEY);
        // 规则式对象形态优先(命中即不进 legacy/轮次脚本解析,二者互斥)
        MockScriptPlan plan = parsePlan(rawScript);
        return new MockChatModelBase(
                resolveModelName(context),
                plan == null ? parseScript(rawScript) : null,
                plan);
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
     * [adapt] CI-canned(2026-09-28):规则式脚本单条——正则命中「最后一条用户文本」
     * 后,先(可选)按 {@code tool+args} 发起工具调用(正则捕获组可经 {@code $1..$9}
     * 注入确定性入参),工具结果回灌后的下一轮调用流式输出 {@code reply}
     * (同样支持捕获替换)。
     */
    record MockRule(Pattern match, ScriptedCall toolCall, String reply) {
    }

    /**
     * [adapt] CI-canned(2026-09-28):规则式脚本整体——{@code mockScript} 的
     * {@code {"rules":[{"match":..,"tool":..,"args":..,"reply":..},…],
     * "default":"…","deltaMs":60}} 对象形态。规则按声明序匹配、命中即止;
     * 全部未命中走 {@code default}(缺省回落 legacy 文案)。CI 的 demo 全量
     * 回归依赖它在不依赖真实模型的前提下满足 L4–L8 全部断言
     * (规则即 seeds/mock-model-script.sql 的单一事实源)。
     */
    record MockScriptPlan(List<MockRule> rules, String defaultReply, Duration deltaInterval) {

        MockScriptPlan {
            rules = rules == null ? List.of() : List.copyOf(rules);
        }
    }

    /**
     * 解析 {@code mockScript} 的规则式对象形态;非该形态(或缺 rules/规则全无效)
     * 返回 {@code null} 交回 legacy/轮次脚本解析,不阻断运行。
     */
    MockScriptPlan parsePlan(Object raw) {
        if (!(raw instanceof Map<?, ?> map)
                || map.get(SCRIPT_ROUNDS_FIELD) != null
                || map.get(SCRIPT_TOOL_FIELD) != null
                || !(map.get(SCRIPT_RULES_FIELD) instanceof List<?> items)
                || items.isEmpty()) {
            // 非「规则式对象」形态(legacy rounds/tool 形态或其他)→ 交回 parseScript
            return null;
        }
        List<MockRule> rules = new ArrayList<>();
        for (Object item : items) {
            if (!(item instanceof Map<?, ?> rule)) {
                continue;
            }
            if (!(rule.get(SCRIPT_MATCH_FIELD) instanceof String expr) || expr.isBlank()) {
                log.warn("[mock] 规则缺 match 正则,跳过: {}", rule);
                continue;
            }
            ScriptedCall toolCall = null;
            if (rule.get(SCRIPT_TOOL_FIELD) instanceof String toolName && !toolName.isBlank()) {
                toolCall = ScriptedCall.of(toolName.trim(), argsOf(rule.get(SCRIPT_ARGS_FIELD)));
            }
            String reply = rule.get(SCRIPT_REPLY_FIELD) instanceof String text && !text.isBlank()
                    ? text
                    : null;
            rules.add(new MockRule(Pattern.compile(expr), toolCall, reply));
        }
        if (rules.isEmpty()) {
            log.warn("[mock] mockScript.rules 无有效规则,回退 legacy 解析: {}", raw);
            return null;
        }
        String defaultReply = map.get(SCRIPT_DEFAULT_FIELD) instanceof String text && !text.isBlank()
                ? text
                : null;
        Duration delta = map.get(SCRIPT_DELTA_MS_FIELD) instanceof Number millis && millis.longValue() >= 0
                ? Duration.ofMillis(millis.longValue())
                : DELTA_INTERVAL;
        return new MockScriptPlan(rules, defaultReply, delta);
    }

    /**
     * 确定性脚本化的 AgentScope 模型:按脚本发起工具调用,看到工具结果后流式输出
     * 固定模板文案。无状态、线程安全、完全确定性。三种互斥形态:
     * <ol>
     *   <li>规则式({@code plan != null},CI-canned):按用户话术正则匹配;</li>
     *   <li>轮次脚本({@code script 非空}):按工具结果个数推进;</li>
     *   <li>legacy({@code script == null && plan == null}):get_current_time。</li>
     * </ol>
     */
    private final class MockChatModelBase extends ChatModelBase {

        private final String modelName;
        /** [adapt] U1/D2:脚本(可能为 null=legacy);工具名在 toolkit 缺失时按轮跳过。 */
        private final List<ScriptedCall> script;
        /** [adapt] CI-canned:规则式脚本(非 null 时优先于 {@link #script})。 */
        private final MockScriptPlan plan;

        private MockChatModelBase(String modelName, List<ScriptedCall> script, MockScriptPlan plan) {
            this.modelName = Objects.requireNonNull(modelName, "modelName must not be null");
            this.script = script;
            this.plan = plan;
        }

        @Override
        public String getModelName() {
            return modelName;
        }

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            return Flux.defer(() -> {
                if (plan != null) {
                    return planFlux(messages, tools);
                }
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

        /**
         * [adapt] CI-canned:规则式形态——按「最后一条用户文本」顺序匹配规则,
         * 命中即止。命中规则的本轮工具阶段以「该用户消息之后是否已有工具结果」
         * 判界(0=先发起脚本工具调用,≥1=流式输出回复);多轮会话中每条新
         * 用户消息自然重置计数,与轮次脚本的全局计数互不干扰。
         */
        private Flux<ChatResponse> planFlux(List<Msg> messages, List<ToolSchema> tools) {
            UserTurn turn = lastUserTurn(messages);
            if (turn.text() != null) {
                for (MockRule rule : plan.rules()) {
                    Matcher matcher = rule.match().matcher(turn.text());
                    if (!matcher.find()) {
                        continue;
                    }
                    ScriptedCall call = rule.toolCall();
                    if (call != null && turn.toolResultsAfterUser() == 0) {
                        String resolved = resolveToolName(tools, call.toolName());
                        if (resolved != null) {
                            return Flux.just(toolCallResponse(
                                    resolved, substituteArgs(call.args(), matcher)));
                        }
                        log.warn("[mock] 规则工具 {} 不在 toolkit,跳过工具调用直接回复;model 可见工具={}",
                                call.toolName(),
                                tools == null ? List.of() : tools.stream()
                                        .map(ToolSchema::getName).toList());
                    }
                    if (rule.reply() != null) {
                        return answerTextFlux(substituteText(rule.reply(), matcher));
                    }
                    break;
                }
            }
            return answerTextFlux(plan.defaultReply() != null
                    ? plan.defaultReply()
                    : String.join("", FALLBACK_DELTAS));
        }

        /** 一次模型调用对应的一个「用户轮次」:最后一条非空用户文本 + 其后工具结果数。 */
        private record UserTurn(String text, int toolResultsAfterUser) {
        }

        /**
         * 定位最后一条非空用户文本消息。确认恢复链路注入的 confirm 元数据消息
         * 文本为空,自动跳过——恢复后仍命中发起工具调用的原规则(工具结果已
         * 在其后,自然进入回复段)。
         */
        private UserTurn lastUserTurn(List<Msg> messages) {
            if (messages == null || messages.isEmpty()) {
                return new UserTurn(null, 0);
            }
            int lastUserIndex = -1;
            for (int i = 0; i < messages.size(); i++) {
                Msg message = messages.get(i);
                MsgRole role = message.getRole();
                if ((role == null || role == MsgRole.USER) && !textOf(message).isBlank()) {
                    lastUserIndex = i;
                }
            }
            if (lastUserIndex < 0) {
                return new UserTurn(null, 0);
            }
            int toolResults = 0;
            for (int i = lastUserIndex + 1; i < messages.size(); i++) {
                if (messages.get(i).hasContentBlocks(ToolResultBlock.class)) {
                    toolResults++;
                }
            }
            return new UserTurn(textOf(messages.get(lastUserIndex)), toolResults);
        }

        private static String textOf(Msg message) {
            String text = message.getTextContent();
            return text == null ? "" : text;
        }

        /**
         * 规则工具名解析:精确匹配优先;其次 MCP FQN 后缀
         * ({@code mcp__<appKey>__<name>} 形态,宿主桥/MCP 工具在 toolkit 中
         * 携带应用前缀)——规则脚本写裸名即可,发射时解析为 toolkit 真名。
         */
        private static String resolveToolName(List<ToolSchema> tools, String name) {
            if (tools == null) {
                return null;
            }
            for (ToolSchema tool : tools) {
                if (name.equals(tool.getName())) {
                    return tool.getName();
                }
            }
            for (ToolSchema tool : tools) {
                if (tool.getName().endsWith("__" + name)) {
                    return tool.getName();
                }
            }
            return null;
        }

        /** 捕获组替换:{@code $1..$9} → 正则捕获组(缺失组保持原样)。 */
        private static String substituteText(String template, Matcher matcher) {
            if (template == null || !template.contains("$")) {
                return template;
            }
            String out = template;
            for (int group = Math.min(matcher.groupCount(), 9); group >= 1; group--) {
                String captured = matcher.group(group);
                if (captured != null) {
                    out = out.replace("$" + group, captured);
                }
            }
            return out;
        }

        /** 入参捕获替换:仅替换字符串值,其余类型原样透传。 */
        private static Map<String, Object> substituteArgs(Map<String, Object> args, Matcher matcher) {
            if (args.isEmpty()) {
                return args;
            }
            Map<String, Object> substituted = new LinkedHashMap<>();
            args.forEach((key, value) -> substituted.put(
                    key, value instanceof String text ? substituteText(text, matcher) : value));
            return substituted;
        }

        /** 规则/缺省回复的流式输出:按固定长度切块成 delta,末块携带 stop 终态。 */
        private Flux<ChatResponse> answerTextFlux(String text) {
            List<String> deltas = splitDeltas(text);
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
                    .delayElements(plan.deltaInterval());
        }

        private static List<String> splitDeltas(String text) {
            if (text == null || text.isEmpty()) {
                return List.of("");
            }
            List<String> deltas = new ArrayList<>();
            for (int i = 0; i < text.length(); i += 40) {
                deltas.add(text.substring(i, Math.min(text.length(), i + 40)));
            }
            return List.copyOf(deltas);
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
