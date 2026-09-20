package com.inneragent.agent.kernel;

import cn.hutool.json.JSONUtil;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.observability.GenAiSemanticAttributes;
import com.inneragent.agent.tool.ToolExecutor;
import com.inneragent.agent.tool.ToolPermissionRisk;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.context.CancellationContext;
import com.inneragent.agent.tool.AbstractPlatformAgentTool;
import com.inneragent.agent.tool.AgentScopeToolSchema;
import com.inneragent.agent.permission.AgentToolPermissionPolicy;
import com.inneragent.agent.run.RunLeaseGuard;
import com.inneragent.platform.tenant.TenantContext;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.tool.ToolBase;
import io.agentscope.core.tool.ToolCallParam;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Scheduler;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;

/** Adapts a platform tool to the strict AgentScope V2 {@link ToolBase} contract. */
public final class AgentScopeToolAdapter extends AbstractPlatformAgentTool {

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(AgentScopeToolAdapter.class);

    private final ToolExecutor toolExecutor;
    private final Scheduler toolScheduler;
    private final RunLeaseGuard leaseGuard;
    private final ObjectMapper objectMapper;
    /**
     * act token 供给挂点（P1-T1 预留，P1-T2 由 MCP 工具适配器接管）；
     * null 表示不携带 X-IA-Act（本地内置工具缺省态）。
     */
    private final ActTokenSupplier actTokenSupplier;

    /**
     * [adapt] P1-T2a：MCP 工具调用端口（T2b 接管点，经 ObjectProvider 可选注入，
     * 参照 ActTokenSupplier 挂法）。T2a 阶段仅 UnavailableMcpToolInvoker 缺省
     * （调用即抛）且本地内置工具不触达该端口——行为与现状完全一致；
     * T2b 的 McpToolAdapter 接管后经此端口执行宿主 tools/call。
     */
    private final com.inneragent.agent.mcp.McpToolInvoker mcpToolInvoker;
    /** [adapt] 任务 #18b(W5):execute_tool span 工厂(null=noop 旁路)。 */
    private final com.inneragent.agent.observability.GenAiSpanFactory spanFactory;

    public AgentScopeToolAdapter(
            ToolExecutor toolExecutor,
            AgentScopeToolSchema.PreparedSchema schema,
            Scheduler toolScheduler,
            RunLeaseGuard leaseGuard,
            ObjectMapper objectMapper) {
        this(toolExecutor, schema, toolScheduler, leaseGuard, objectMapper, null, null, null);
    }

    public AgentScopeToolAdapter(
            ToolExecutor toolExecutor,
            AgentScopeToolSchema.PreparedSchema schema,
            Scheduler toolScheduler,
            RunLeaseGuard leaseGuard,
            ObjectMapper objectMapper,
            ActTokenSupplier actTokenSupplier) {
        this(toolExecutor, schema, toolScheduler, leaseGuard, objectMapper,
                actTokenSupplier, null, null);
    }

    public AgentScopeToolAdapter(
            ToolExecutor toolExecutor,
            AgentScopeToolSchema.PreparedSchema schema,
            Scheduler toolScheduler,
            RunLeaseGuard leaseGuard,
            ObjectMapper objectMapper,
            ActTokenSupplier actTokenSupplier,
            com.inneragent.agent.mcp.McpToolInvoker mcpToolInvoker) {
        this(toolExecutor, schema, toolScheduler, leaseGuard, objectMapper,
                actTokenSupplier, mcpToolInvoker, null);
    }

    public AgentScopeToolAdapter(
            ToolExecutor toolExecutor,
            AgentScopeToolSchema.PreparedSchema schema,
            Scheduler toolScheduler,
            RunLeaseGuard leaseGuard,
            ObjectMapper objectMapper,
            ActTokenSupplier actTokenSupplier,
            com.inneragent.agent.mcp.McpToolInvoker mcpToolInvoker,
            com.inneragent.agent.observability.GenAiSpanFactory spanFactory) {
        super(builder(toolExecutor, schema));
        this.toolExecutor = Objects.requireNonNull(toolExecutor, "toolExecutor must not be null");
        this.toolScheduler = Objects.requireNonNull(toolScheduler, "toolScheduler must not be null");
        this.leaseGuard = Objects.requireNonNull(leaseGuard, "leaseGuard must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.actTokenSupplier = actTokenSupplier;
        this.mcpToolInvoker = mcpToolInvoker;
        this.spanFactory = spanFactory == null
                ? com.inneragent.agent.observability.GenAiSpanFactory.noop()
                : spanFactory;
    }

    /** T2b 接管点访问器(MCP client 适配器接入后经此执行宿主调用;当前不可达)。 */
    com.inneragent.agent.mcp.McpToolInvoker mcpToolInvoker() {
        return mcpToolInvoker;
    }

    @Override
    public Mono<ToolResultBlock> callAsync(ToolCallParam param) {
        return Mono.defer(() -> {
            RuntimeContext runtime = requireRuntimeContext(param);
            AgentRunContext run = requireContext(runtime, AgentRunContext.class);
            CancellationContext cancellation = requireContext(runtime, CancellationContext.class);
            com.inneragent.agent.context.ToolExecutionContext toolContext =
                    requireContext(
                            runtime,
                            com.inneragent.agent.context.ToolExecutionContext.class);
            // act token 挂点(P1-T1):P2/T2 前缺省无供给方,DEBUG 说明本地工具不外发令牌;
            // 签发失败由供给方降级返回 null,不阻断工具执行
            String actToken = actTokenSupplier == null
                    ? null
                    : actTokenSupplier.supply(run.runId(), toolContext, getName());
            if (actToken == null) {
                log.debug("Tool call without X-IA-Act token (no supplier/degraded): tool={}, runId={}",
                        getName(), run.runId());
            }
            Duration remaining = remaining(run);
            Map<String, Object> input = Objects.requireNonNull(
                    param.getInput(), "AgentScope tool input must not be null");
            // [adapt] 任务 #18b(W5):execute_tool span(工具调用元数据;内容默认关)。
            com.inneragent.agent.observability.GenAiSpanFactory.GenAiSpan toolSpan =
                    startExecuteToolSpan(param, runtime, run, input);
            // 业务工具按发起 run 的租户执行：工具内部读写业务表依赖租户过滤与 tenant_id 注入
            Mono<String> invocation = Mono.fromCallable(() -> TenantContext.runInTenant(
                            toolContext.tenantId(),
                            () -> toolExecutor.execute(
                                    JSONUtil.toJsonStr(input),
                                    com.inneragent.agent.tool.ToolExecutionContext.builder()
                                            .userId(toolContext.userId())
                                            .ownerType(toolContext.ownerType())
                                            .ownerId(toolContext.ownerId())
                                            .build())))
                    .subscribeOn(toolScheduler);
            return cancellation.checkpoint()
                    .then(assertLease(run))
                    .then(invocation)
                    .doOnError(toolSpan != null
                            ? failure -> toolSpan.error(failure)
                            : failure -> { })
                    .flatMap(result -> cancellation.checkpoint()
                            .then(assertLease(run))
                            .thenReturn(projectResult(param, result)))
                    .doFinally(sig -> {
                        if (toolSpan != null) {
                            toolSpan.end();
                        }
                    })
                    .timeout(remaining);
        });
    }

    /**
     * [adapt] 任务 #18b(W5):execute_tool span。属性:gen_ai.tool.name/
     * tool.description/tool.call.id、inneragent.risk.level、inneragent.run.id、
     * gen_ai.conversation.id;内容属性(prompt=入参 JSON)默认关。
     */
    private com.inneragent.agent.observability.GenAiSpanFactory.GenAiSpan startExecuteToolSpan(
            ToolCallParam param,
            RuntimeContext runtime,
            AgentRunContext run,
            Map<String, Object> input) {
        if (spanFactory.isNoop()) {
            return null;
        }
        try {
            com.inneragent.agent.context.AgentConversationContext conversation =
                    runtime.get(com.inneragent.agent.context.AgentConversationContext.class);
            ToolPermissionRisk risk = toolExecutor.getPermissionRisk(input);
            com.inneragent.agent.observability.GenAiSpanFactory.SpanBuilder builder =
                    spanFactory.spanBuilder(GenAiSemanticAttributes.Operations.EXECUTE_TOOL
                            + " " + getName())
                            .attr(GenAiSemanticAttributes.OPERATION_NAME,
                                    GenAiSemanticAttributes.Operations.EXECUTE_TOOL)
                            .attr(GenAiSemanticAttributes.TOOL_NAME, getName())
                            .attr(GenAiSemanticAttributes.TOOL_DESCRIPTION,
                                    toolExecutor.getToolDescription())
                            .attr(GenAiSemanticAttributes.RUN_ID, run.runId())
                            .attr(GenAiSemanticAttributes.RISK_LEVEL,
                                    risk == null ? null : risk.name())
                            .contentAttr(GenAiSemanticAttributes.PROMPT,
                                    JSONUtil.toJsonStr(input));
            if (param.getToolUseBlock() != null
                    && param.getToolUseBlock().getId() != null) {
                builder.attr(GenAiSemanticAttributes.TOOL_CALL_ID,
                        param.getToolUseBlock().getId());
            }
            if (conversation != null) {
                builder.attr(GenAiSemanticAttributes.CONVERSATION_ID,
                        conversation.conversationId());
            }
            return builder.startSpan();
        } catch (Exception spanFailure) {
            log.debug("GenAI execute_tool span start skipped: {}", spanFailure.toString());
            return null;
        }
    }

    @Override
    public boolean matchRule(String ruleContent, Map<String, Object> toolInput) {
        if (AgentToolPermissionPolicy.HIGH_RISK_RULE_CONTENT.equals(ruleContent)) {
            return toolExecutor.getPermissionRisk(Objects.requireNonNull(
                    toolInput, "toolInput must not be null")) == ToolPermissionRisk.HIGH_RISK;
        }
        return super.matchRule(ruleContent, toolInput);
    }

    public boolean mayRequireHighRiskApproval() {
        return toolExecutor.mayRequireHighRiskApproval();
    }

    private ToolResultBlock projectResult(ToolCallParam param, String result) {
        if (result == null) {
            throw new IllegalStateException("AgentScope tool returned null output: " + getName());
        }
        try {
            JsonNode payload = objectMapper.readTree(result);
            if (payload != null && payload.isObject()) {
                JsonNode status = payload.get("status");
                if (status != null && status.isTextual()
                        && ("error".equalsIgnoreCase(status.textValue())
                            || "failed".equalsIgnoreCase(status.textValue()))) {
                    return errorResult(param, result);
                }
            }
        } catch (JsonProcessingException plainTextResult) {
            // ToolExecutor permits text output; only JSON objects carry the platform status contract.
        }
        return textResult(param, result);
    }

    private Mono<Void> assertLease(AgentRunContext run) {
        return leaseGuard.assertLease(run.runId(), run.ownerInstanceId(), run.ownerEpoch());
    }

    private RuntimeContext requireRuntimeContext(ToolCallParam param) {
        requireToolUse(param);
        if (param.getRuntimeContext() == null) {
            throw new IllegalArgumentException(
                    "AgentScope RuntimeContext is required for tool: " + getName());
        }
        return param.getRuntimeContext();
    }

    private <T> T requireContext(RuntimeContext runtime, Class<T> type) {
        T value = runtime.get(type);
        if (value == null) {
            throw new IllegalStateException(
                    "AgentScope RuntimeContext is missing " + type.getSimpleName()
                            + " for tool " + getName());
        }
        return value;
    }

    private Duration remaining(AgentRunContext run) {
        Duration remaining = Duration.between(Instant.now(), run.deadline());
        if (remaining.isZero() || remaining.isNegative()) {
            throw new IllegalStateException("Agent run deadline expired before tool execution");
        }
        return remaining;
    }

    private static ToolBase.Builder builder(
            ToolExecutor tool,
            AgentScopeToolSchema.PreparedSchema schema) {
        Objects.requireNonNull(tool, "toolExecutor must not be null");
        Objects.requireNonNull(schema, "schema must not be null");
        String description = tool.getToolDescription();
        if (description == null || description.isBlank()) {
            throw new IllegalArgumentException(
                    "AgentScope tool description must not be blank: " + tool.getToolName());
        }
        return ToolBase.builder()
                .name(tool.getToolName())
                .description(description)
                .inputSchema(schema.value())
                .readOnly(tool.isReadOnly())
                .concurrencySafe(tool.isConcurrencySafe());
    }
}
