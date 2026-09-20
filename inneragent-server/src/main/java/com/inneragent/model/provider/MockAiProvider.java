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

    /** 脚本会主动调用的内置工具名。 */
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
        return new MockChatModelBase(resolveModelName(context));
    }

    @Override
    public List<RemoteModelVO> listRemoteModels(AiProviderContext context) {
        // mock 平台没有远程模型目录,由本地 seed 数据提供模型记录。
        return List.of();
    }

    private static String resolveModelName(AiProviderContext context) {
        return context.getModelName() != null ? context.getModelName() : "mock-text";
    }

    /**
     * 确定性脚本化的 AgentScope 模型:首轮发起 {@code get_current_time} 工具调用,
     * 看到工具结果后流式输出固定模板文案。无状态、线程安全、完全确定性。
     */
    private final class MockChatModelBase extends ChatModelBase {

        private final String modelName;

        private MockChatModelBase(String modelName) {
            this.modelName = Objects.requireNonNull(modelName, "modelName must not be null");
        }

        @Override
        public String getModelName() {
            return modelName;
        }

        @Override
        protected Flux<ChatResponse> doStream(
                List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            return Flux.defer(() -> {
                String toolResultText = firstToolResultText(messages);
                if (toolResultText == null && hasTimeTool(tools)) {
                    return Flux.just(toolCallResponse());
                }
                return answerFlux(toolResultText);
            });
        }

        private boolean hasTimeTool(List<ToolSchema> tools) {
            return tools != null && tools.stream()
                    .anyMatch(tool -> TIME_TOOL.equals(tool.getName()));
        }

        /** 首轮脚本:一次 get_current_time 工具调用。 */
        private ChatResponse toolCallResponse() {
            ToolUseBlock toolCall = ToolUseBlock.builder()
                    .id("mock-call-" + responseSequence.incrementAndGet())
                    .name(TIME_TOOL)
                    .input(Map.of())
                    .build();
            return ChatResponse.builder()
                    .id("mock-resp-" + responseSequence.incrementAndGet())
                    .content(List.<ContentBlock>of(toolCall))
                    .finishReason("tool_use")
                    .usage(new ChatUsage(MOCK_TOKENS, MOCK_TOKENS, 0d))
                    .build();
        }

        /** 次轮脚本:把工具结果嵌入固定模板,按 delta 流式输出后完成。 */
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
                deltas.add(TIME_TOOL + " 工具返回异常: ");
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
         * 扫描会话消息,返回第一个工具结果的文本;没有工具结果返回 null。
         * mock 脚本以“是否已见过工具结果”作为轮次判据。
         */
        private String firstToolResultText(List<Msg> messages) {
            if (messages == null) {
                return null;
            }
            for (Msg message : messages) {
                if (!message.hasContentBlocks(ToolResultBlock.class)) {
                    continue;
                }
                for (ToolResultBlock block : message.getContentBlocks(ToolResultBlock.class)) {
                    for (ContentBlock output : block.getOutput()) {
                        if (output instanceof TextBlock textBlock
                                && textBlock.getText() != null
                                && !textBlock.getText().isBlank()) {
                            return textBlock.getText();
                        }
                    }
                }
            }
            return null;
        }
    }
}
