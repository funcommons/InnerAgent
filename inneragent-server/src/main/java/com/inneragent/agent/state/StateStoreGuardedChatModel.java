package com.inneragent.agent.state;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.agent.context.AgentConversationContext;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.observability.GenAiSemanticAttributes;
import com.inneragent.agent.observability.GenAiSpanFactory;
import com.inneragent.agent.run.ModelCallUsageLedgerPort;
import com.inneragent.agent.run.ModelUsageSettlementPort;
import com.inneragent.agent.run.model.NormalizedModelUsage;
import com.inneragent.platform.enums.ai.AgentModelCallStatus;
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
import reactor.core.publisher.SignalType;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 拦截流式 {@link ChatResponse}，在最后一个 chunk 提取 usage 调 {@link
 * ModelUsageSettlementPort} 落库；其余 chunk 透传。
 * <p>
 * 幂等键 = {@code runId:modelCallId}，从 {@link RuntimeContext} 拿 runId/ownerUserId。
 * 流结束（finishReason 非 null 或上游主动 complete）时触发落库。
 * <p>
 * W15 用量统计:每次 doStream 视为一次模型调用——上下文无 modelCallId 时
 * 生成 {@code mc-<uuid>};挂点 {@link ModelCallUsageLedgerPort}(可空=旁路)
 * 按流入口 STARTED / 流尾 COMPLETED(有 usage)/ 失败 FAILED 记
 * {@code ia_agent_model_call_usage} 台账。台账失败只降级(WARN)不阻断流。
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
    /** W15 用量统计:量表白账挂点(null=旁路)。 */
    private final ModelCallUsageLedgerPort ledgerPort;
    /** 台账身份:请求协议归一的服务商标识(构造期绑定,harness 一模型一身份)。 */
    private final String provider;
    /** 台账身份:模型代码标识。 */
    private final String modelCode;
    private final int contextWindowSize;

    public StateStoreGuardedChatModel(
            ChatModelBase delegate,
            StateStoreFailureGuard failures) {
        this(delegate, failures, null, null, null, null, null, null);
    }

    public StateStoreGuardedChatModel(
            ChatModelBase delegate,
            StateStoreFailureGuard failures,
            Integer configuredContextWindow) {
        this(delegate, failures, configuredContextWindow, null, null, null, null, null);
    }

    public StateStoreGuardedChatModel(
            ChatModelBase delegate,
            StateStoreFailureGuard failures,
            Integer configuredContextWindow,
            ModelUsageSettlementPort usagePort) {
        this(delegate, failures, configuredContextWindow, usagePort, null, null, null, null);
    }

    public StateStoreGuardedChatModel(
            ChatModelBase delegate,
            StateStoreFailureGuard failures,
            Integer configuredContextWindow,
            ModelUsageSettlementPort usagePort,
            GenAiSpanFactory spanFactory) {
        this(delegate, failures, configuredContextWindow, usagePort, spanFactory,
                null, null, null);
    }

    /** 全参构造(W15):span 工厂 + 用量结算 + 量表白账(含模型身份)。 */
    public StateStoreGuardedChatModel(
            ChatModelBase delegate,
            StateStoreFailureGuard failures,
            Integer configuredContextWindow,
            ModelUsageSettlementPort usagePort,
            GenAiSpanFactory spanFactory,
            ModelCallUsageLedgerPort ledgerPort,
            String provider,
            String modelCode) {
        this.delegate = Objects.requireNonNull(delegate, "delegate must not be null");
        this.failures = Objects.requireNonNull(failures, "failures must not be null");
        this.usagePort = usagePort;
        this.spanFactory = spanFactory == null ? GenAiSpanFactory.noop() : spanFactory;
        this.ledgerPort = ledgerPort;
        this.provider = provider;
        this.modelCode = modelCode;
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
            // W15 用量统计:一次 doStream = 一次模型调用。runId 取运行上下文
            // (AgentRunContext.runId,内核运行即真实 ia_agent_run.run_id;
            // session id 为状态存储会话键,仅在无运行上下文的形态下兜底);
            // modelCallId 优先沿用 modeler 写入的上下文 key,否则生成。
            String runId = resolveRunId(runtimeContext);
            String modelCallId = resolveModelCallId(runtimeContext);
            ModelCallUsageLedgerPort.ModelCallRef usageRef =
                    startLedgerCall(runId, modelCallId);
            // [adapt] 任务 #18b(W5):chat span(每次模型调用一个;noop 工厂旁路)。
            GenAiSpanFactory.GenAiSpan chatSpan = startChatSpan(runtimeContext, messages);
            Flux<ChatResponse> source = delegate.stream(messages, tools, options);
            if (usagePort == null && chatSpan == null && usageRef == null) {
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
                                settleUsage(last, runId, modelCallId);
                                if (chatSpan != null) {
                                    endChatSpan(chatSpan, last);
                                }
                            } else if (chatSpan != null) {
                                chatSpan.end();
                            }
                            settleLedgerTerminal(usageRef, last, sig);
                        } finally {
                            AgentScopeRuntimeContextAccess.clear();
                        }
                    });
        });
    }

    /** runId 解析:优先真实运行上下文,兜底状态会话键(旧约定形态)。 */
    private static String resolveRunId(RuntimeContext runtimeContext) {
        AgentRunContext run = runtimeContext.get(AgentRunContext.class);
        if (run != null && run.runId() != null && !run.runId().isBlank()) {
            return run.runId();
        }
        return runtimeContext.getSessionId();
    }

    /**
     * modelCallId 解析:modeler 写入的上下文 key 优先(幂等对齐);缺失时
     * 按次生成({@code mc-<32hex>},≤64 列宽)。
     */
    private static String resolveModelCallId(RuntimeContext runtimeContext) {
        Object value = runtimeContext.get(MODEL_CALL_ID_KEY);
        if (value instanceof String s && !s.isBlank()) {
            return s;
        }
        return "mc-" + UUID.randomUUID().toString().replace("-", "");
    }

    /** 流入口落 STARTED;台账缺位/失败均返回 null(本次调用旁路)。 */
    private ModelCallUsageLedgerPort.ModelCallRef startLedgerCall(
            String runId, String modelCallId) {
        if (ledgerPort == null || runId == null || runId.isBlank()) {
            return null;
        }
        ModelCallUsageLedgerPort.ModelCallRef ref = new ModelCallUsageLedgerPort.ModelCallRef(
                runId, modelCallId,
                provider == null || provider.isBlank() ? "unknown" : provider,
                modelCode == null || modelCode.isBlank() ? "unknown" : modelCode);
        try {
            ledgerPort.start(ref);
            return ref;
        } catch (Exception ledgerFailure) {
            log.warn("[usage-ledger] start 落库失败(旁路本次调用): {}", ledgerFailure.getMessage());
            return null;
        }
    }

    /**
     * 流尾台账终态:有 usage → COMPLETED(带 token);无 usage 且流错误 →
     * FAILED;无 usage 的正常完成/取消保持 STARTED,由运行终态对账
     * (finishAllStartedForRun)兜底标 CANCELLED。台账异常只降级。
     */
    private void settleLedgerTerminal(
            ModelCallUsageLedgerPort.ModelCallRef usageRef,
            ChatResponse last,
            SignalType signal) {
        if (usageRef == null || ledgerPort == null) {
            return;
        }
        try {
            if (last != null) {
                NormalizedModelUsage usage = toNormalizedUsage(last);
                if (usage != null) {
                    ledgerPort.complete(usageRef, usage);
                }
                return;
            }
            if (signal == SignalType.ON_ERROR) {
                ledgerPort.fail(usageRef, AgentModelCallStatus.FAILED);
            }
        } catch (Exception ledgerFailure) {
            log.warn("[usage-ledger] 终态落库失败: {}", ledgerFailure.getMessage());
        }
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

    private void settleUsage(ChatResponse response, String runId, String modelCallId) {
        try {
            if (usagePort == null) {
                return;
            }
            NormalizedModelUsage usage = toNormalizedUsage(response);
            if (usage == null) {
                return;
            }
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
}
