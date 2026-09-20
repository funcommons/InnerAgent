package com.inneragent.agent.state;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.agent.context.AgentConversationContext;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.observability.GenAiSemanticAttributes;
import com.inneragent.agent.observability.GenAiSpanFactory;
import com.inneragent.agent.run.ModelUsageSettlementPort;
import com.inneragent.agent.run.model.NormalizedModelUsage;
import io.agentscope.core.agent.AgentBase;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.Msg;
import io.agentscope.core.model.ChatModelBase;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.ChatUsage;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.ToolSchema;
import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 拦截流式 {@link ChatResponse}，在最后一个 chunk 提取 usage 调 {@link
 * ModelUsageSettlementPort} 落库；其余 chunk 透传。
 * <p>
 * 幂等键 = {@code runId:modelCallId}，从 {@link RuntimeContext} 拿 runId/ownerUserId。
 * 流结束（finishReason 非 null 或上游主动 complete）时触发落库。
 */
@Slf4j
public final class StateStoreGuardedChatModel extends ChatModelBase {

    private static final String MISSING_RUNTIME_MESSAGE =
            "STATE_STORE_FAILED: RuntimeContext missing";

    /** AgentScope 运行时上下文里 modelCallId 的存储 key（与 modeler 约定）。 */
    private static final String MODEL_CALL_ID_KEY = "afv.modelCallId";

    private final ChatModelBase delegate;
    private final StateStoreFailureGuard failures;
    private final ModelUsageSettlementPort usagePort;
    /** [adapt] 任务 #18b(W5):chat span 工厂(null=noop 挂点整体旁路)。 */
    private final GenAiSpanFactory spanFactory;
    private final int contextWindowSize;

    public StateStoreGuardedChatModel(
            ChatModelBase delegate,
            StateStoreFailureGuard failures) {
        this(delegate, failures, null, null, null);
    }

    public StateStoreGuardedChatModel(
            ChatModelBase delegate,
            StateStoreFailureGuard failures,
            Integer configuredContextWindow) {
        this(delegate, failures, configuredContextWindow, null, null);
    }

    public StateStoreGuardedChatModel(
            ChatModelBase delegate,
            StateStoreFailureGuard failures,
            Integer configuredContextWindow,
            ModelUsageSettlementPort usagePort) {
        this(delegate, failures, configuredContextWindow, usagePort, null);
    }

    public StateStoreGuardedChatModel(
            ChatModelBase delegate,
            StateStoreFailureGuard failures,
            Integer configuredContextWindow,
            ModelUsageSettlementPort usagePort,
            GenAiSpanFactory spanFactory) {
        this.delegate = Objects.requireNonNull(delegate, "delegate must not be null");
        this.failures = Objects.requireNonNull(failures, "failures must not be null");
        this.usagePort = usagePort;
        this.spanFactory = spanFactory == null ? GenAiSpanFactory.noop() : spanFactory;
        this.contextWindowSize = configuredContextWindow != null && configuredContextWindow > 0
                ? configuredContextWindow
                : delegate.getContextWindowSize();
    }

    @Override
    public String getModelName() {
        return delegate.getModelName();
    }

    @Override
    public int getContextWindowSize() {
        return contextWindowSize;
    }

    @Override
    public boolean supportsNativeStructuredOutput() {
        return delegate.supportsNativeStructuredOutput();
    }

    @Override
    public boolean supportsNativeStructuredOutputWithTools() {
        return delegate.supportsNativeStructuredOutputWithTools();
    }

    @Override
    protected Flux<ChatResponse> doStream(
            List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
        return Flux.deferContextual(contextView -> {
            Object value = contextView.getOrDefault(AgentBase.RUNTIME_CONTEXT_KEY, null);
            if (!(value instanceof RuntimeContext runtimeContext)
                    || runtimeContext.getUserId() == null
                    || runtimeContext.getUserId().isBlank()
                    || runtimeContext.getSessionId() == null
                    || runtimeContext.getSessionId().isBlank()) {
                return Flux.error(new BusinessException(500, MISSING_RUNTIME_MESSAGE));
            }
            failures.throwIfFailed(new StateStoreSlot(
                    runtimeContext.getUserId(), runtimeContext.getSessionId()));
            AgentScopeRuntimeContextAccess.set(runtimeContext);
            // [adapt] 任务 #18b(W5):chat span(每次模型调用一个;noop 工厂旁路)。
            GenAiSpanFactory.GenAiSpan chatSpan = startChatSpan(runtimeContext, messages);
            Flux<ChatResponse> source = delegate.stream(messages, tools, options);
            if (usagePort == null && chatSpan == null) {
                return source;
            }
            // 边流边记、流尾结算: chunk 必须逐个透传。工具调用的带名 anchor 块
            // (content_block_start) 通常不是最后一个 chunk, 任何缓冲/坍缩都会把
            // anchor 丢给内核变成孤儿 __fragment__, 导致工具执行必然失败。
            AtomicReference<ChatResponse> lastUsage = new AtomicReference<>();
            return source
                    .doOnNext(chunk -> {
                        if (chunk.getUsage() != null) {
                            lastUsage.set(chunk);
                        }
                    })
                    .doOnError(failure -> {
                        if (chatSpan != null) {
                            chatSpan.error(failure);
                        }
                    })
                    .doFinally(sig -> {
                        try {
                            ChatResponse last = lastUsage.get();
                            if (last != null) {
                                settleUsage(last);
                                if (chatSpan != null) {
                                    endChatSpan(chatSpan, last);
                                }
                            } else if (chatSpan != null) {
                                chatSpan.end();
                            }
                        } finally {
                            AgentScopeRuntimeContextAccess.clear();
                        }
                    });
        });
    }

    /**
     * [adapt] 任务 #18b(W5):开 chat span。属性:gen_ai.operation.name/
     * request.model/conversation.id + inneragent.run.id;noop 工厂返回 null
     * 表示挂点整体旁路(零开销路径)。
     */
    private GenAiSpanFactory.GenAiSpan startChatSpan(
            RuntimeContext runtimeContext, List<Msg> messages) {
        if (spanFactory.isNoop()) {
            return null;
        }
        try {
            AgentConversationContext conversation =
                    runtimeContext.get(AgentConversationContext.class);
            AgentRunContext run = runtimeContext.get(AgentRunContext.class);
            String model = getModelName();
            GenAiSpanFactory.SpanBuilder builder = spanFactory
                    .spanBuilder(GenAiSemanticAttributes.Operations.CHAT + " " + model)
                    .attr(GenAiSemanticAttributes.OPERATION_NAME,
                            GenAiSemanticAttributes.Operations.CHAT)
                    .attr(GenAiSemanticAttributes.REQUEST_MODEL, model);
            if (conversation != null) {
                builder.attr(GenAiSemanticAttributes.CONVERSATION_ID,
                        conversation.conversationId());
            }
            if (run != null) {
                builder.attr(GenAiSemanticAttributes.RUN_ID, run.runId());
            }
            builder.attr(GenAiSemanticAttributes.STATE_SESSION_ID,
                    runtimeContext.getSessionId());
            if (!messages.isEmpty()) {
                builder.contentAttr(GenAiSemanticAttributes.PROMPT,
                        String.valueOf(messages.getFirst().getTextContent()));
            }
            return builder.startSpan();
        } catch (Exception spanFailure) {
            log.debug("[genai-span] chat span start skipped: {}", spanFailure.toString());
            return null;
        }
    }

    /** [adapt] 任务 #18b(W5):流尾补 usage/结束原因/完成摘要后收 span。 */
    private void endChatSpan(GenAiSpanFactory.GenAiSpan chatSpan, ChatResponse last) {
        try {
            chatSpan.setAttribute(GenAiSemanticAttributes.RESPONSE_FINISH_REASON,
                    last.getFinishReason());
            NormalizedModelUsage usage = toNormalizedUsage(last);
            if (usage != null) {
                if (usage.inputTokens() != null) {
                    chatSpan.setAttribute(GenAiSemanticAttributes.USAGE_INPUT_TOKENS,
                            usage.inputTokens());
                }
                if (usage.outputTokens() != null) {
                    chatSpan.setAttribute(GenAiSemanticAttributes.USAGE_OUTPUT_TOKENS,
                            usage.outputTokens());
                }
                if (usage.cacheTokens() != null && usage.cacheTokens() > 0) {
                    chatSpan.setAttribute(GenAiSemanticAttributes.USAGE_CACHED_TOKENS,
                            usage.cacheTokens());
                }
                if (usage.reasoningTokens() != null && usage.reasoningTokens() > 0) {
                    chatSpan.setAttribute(GenAiSemanticAttributes.USAGE_REASONING_TOKENS,
                            usage.reasoningTokens());
                }
            }
            chatSpan.contentAttribute(GenAiSemanticAttributes.COMPLETION,
                    completionText(last));
            chatSpan.end();
        } catch (Exception spanFailure) {
            log.debug("[genai-span] chat span end skipped: {}", spanFailure.toString());
            chatSpan.end();
        }
    }

    private static String completionText(ChatResponse response) {
        try {
            List<io.agentscope.core.message.ContentBlock> blocks = response.getContent();
            if (blocks == null) {
                return null;
            }
            StringBuilder text = new StringBuilder();
            for (io.agentscope.core.message.ContentBlock block : blocks) {
                if (block instanceof io.agentscope.core.message.TextBlock textBlock) {
                    text.append(textBlock.getText());
                }
            }
            return text.isEmpty() ? null : text.toString();
        } catch (Exception ignore) {
            return null;
        }
    }

    private void settleUsage(ChatResponse response) {
        try {
            NormalizedModelUsage usage = toNormalizedUsage(response);
            if (usage == null) {
                return;
            }
            String runId = currentRunId();
            String modelCallId = currentModelCallId();
            if (runId == null || modelCallId == null) {
                return;
            }
            usagePort.settle(runId + ":" + modelCallId, usage).subscribe();
        } catch (Exception e) {
            log.warn("[usage-settle] 落库失败: {}", e.getMessage());
        }
    }

    /**
     * 把 {@link ChatUsage} + metadata 里的 fields 归一化为 {@link NormalizedModelUsage}。
     * upstream metadata 形如 {@code {"usage": {"prompt_tokens":..., "completion_tokens_details": {"reasoning_tokens": ...}}},
     * OpenAI / Anthropic 字段命名差异由本方法兼容。
     */
    static NormalizedModelUsage toNormalizedUsage(ChatResponse response) {
        ChatUsage usage = response.getUsage();
        if (usage == null) {
            return null;
        }
        long input = usage.getInputTokens();
        long output = usage.getOutputTokens();
        long cached = usage.getCachedTokens();
        long reasoning = 0L;

        Map<String, Object> metadata = response.getMetadata();
        if (metadata != null) {
            Object raw = metadata.get("usage");
            if (raw != null) {
                JSONObject node = wrap(raw);
                if (node != null) {
                    String prompt = node.getStr("prompt_tokens");
                    if (prompt != null && !prompt.isBlank()) {
                        try { input = Math.max(input, Long.parseLong(prompt.trim())); } catch (NumberFormatException ignore) { }
                    }
                    String completion = node.getStr("completion_tokens");
                    if (completion != null && !completion.isBlank()) {
                        try { output = Math.max(output, Long.parseLong(completion.trim())); } catch (NumberFormatException ignore) { }
                    }
                    String cachedMeta = node.getStr("cached_tokens");
                    if (cachedMeta != null && !cachedMeta.isBlank()) {
                        try { cached = Math.max(cached, Long.parseLong(cachedMeta.trim())); } catch (NumberFormatException ignore) { }
                    }
                    JSONObject completionDetails = node.getJSONObject("completion_tokens_details");
                    if (completionDetails != null) {
                        String r = completionDetails.getStr("reasoning_tokens");
                        if (r != null && !r.isBlank()) {
                            try { reasoning = Math.max(reasoning, Long.parseLong(r.trim())); } catch (NumberFormatException ignore) { }
                        }
                    }
                    JSONObject promptDetails = node.getJSONObject("prompt_tokens_details");
                    if (promptDetails != null) {
                        String r = promptDetails.getStr("reasoning_tokens");
                        if (r != null && !r.isBlank()) {
                            try { reasoning = Math.max(reasoning, Long.parseLong(r.trim())); } catch (NumberFormatException ignore) { }
                        }
                    }
                }
            }
        }
        if (input == 0 && output == 0 && cached == 0 && reasoning == 0) {
            return null;
        }
        return new NormalizedModelUsage(
                input,
                output,
                reasoning > 0 ? reasoning : null,
                cached > 0 ? cached : null,
                null);
    }

    private static JSONObject wrap(Object raw) {
        if (raw instanceof JSONObject json) {
            return json;
        }
        if (raw instanceof Map<?, ?> map) {
            return JSONUtil.parseObj(JSONUtil.toJsonStr(map));
        }
        if (raw instanceof String text) {
            try {
                return JSONUtil.parseObj(text);
            } catch (Exception ignore) {
                return null;
            }
        }
        return null;
    }

    private static String currentRunId() {
        RuntimeContext context = AgentScopeRuntimeContextAccess.current();
        return context == null ? null : context.getSessionId();
    }

    private static String currentModelCallId() {
        RuntimeContext context = AgentScopeRuntimeContextAccess.current();
        if (context == null) {
            return null;
        }
        Object value = context.get(MODEL_CALL_ID_KEY);
        return value instanceof String s ? s : null;
    }
}
