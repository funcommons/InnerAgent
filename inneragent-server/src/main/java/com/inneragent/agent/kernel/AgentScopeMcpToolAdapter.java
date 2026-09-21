package com.inneragent.agent.kernel;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.mcp.McpToolCatalogEntry;
import com.inneragent.agent.mcp.McpToolInvocationResult;
import com.inneragent.agent.mcp.McpToolInvoker;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.context.CancellationContext;
import com.inneragent.agent.context.ToolExecutionContext;
import com.inneragent.agent.tool.AbstractPlatformAgentTool;
import com.inneragent.agent.tool.AgentScopeToolSchema;
import com.inneragent.agent.run.RunLeaseGuard;
import com.inneragent.platform.context.AppContext;
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

/**
 * [adapt] U1/D1 [new]:MCP 工具目录条目 → AgentScope V2 工具适配器(T2b 宿主桥接管形态)。
 *
 * <p>镜像 yml 静态 MCP 的装配形态({@code AgentScopeMcpRegistry}:工具描述 +
 * 参数 schema 进 toolkit),
 * 但目录条目({@link McpToolCatalogEntry}:ia_tool_registry 聚合视图)没有
 * 常驻 MCP client,执行委托 {@link McpToolInvoker#invoke(long, String, Map,
 * ToolExecutionContext)}(生产为 {@code McpClientToolInvoker}:act token 签发
 * + 宿主 tools/call,AppContext/UserContext 由调用链显式携带,不依赖
 * ThreadLocal 跨线程恢复)。
 *
 * <p>AgentScope 工具名取目录 FQN(mcp__{serverKey}__{toolName}):与
 * enabledMcpTools 白名单请求、ia_tool_grant 授权 FQN(T2a 的
 * {@code AgentToolPermissionPolicy} 直接匹配)以及内核快照 restore 校验统一口径。
 * readOnly/concurrencySafe 采用目录治理位(readOnlyEffective:仅可信宿主注解采信,
 * 三方一律按写操作确认,V15)。
 */
public final class AgentScopeMcpToolAdapter extends AbstractPlatformAgentTool {

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(AgentScopeMcpToolAdapter.class);

    /** 目录条目(FQN/注册表工具名/治理位)。 */
    private final McpToolCatalogEntry entry;
    /** 目录所属应用(ia_app.id;注册期捕获,执行期显式透传 invoker)。 */
    private final long appId;
    private final AgentScopeToolSchema.PreparedSchema schema;
    private final Scheduler toolScheduler;
    private final RunLeaseGuard leaseGuard;
    private final ObjectMapper objectMapper;
    /** MCP 工具调用端口(生产 McpClientToolInvoker;缺省 Unavailable 即调用抛错)。 */
    private final McpToolInvoker mcpToolInvoker;

    public AgentScopeMcpToolAdapter(
            McpToolCatalogEntry entry,
            long appId,
            AgentScopeToolSchema.PreparedSchema schema,
            Scheduler toolScheduler,
            RunLeaseGuard leaseGuard,
            ObjectMapper objectMapper,
            McpToolInvoker mcpToolInvoker) {
        super(builder(entry, schema));
        this.entry = Objects.requireNonNull(entry, "entry must not be null");
        this.appId = appId;
        this.schema = Objects.requireNonNull(schema, "schema must not be null");
        this.toolScheduler = Objects.requireNonNull(toolScheduler, "toolScheduler must not be null");
        this.leaseGuard = Objects.requireNonNull(leaseGuard, "leaseGuard must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.mcpToolInvoker = Objects.requireNonNull(
                mcpToolInvoker, "mcpToolInvoker must not be null");
    }

    @Override
    public Mono<ToolResultBlock> callAsync(ToolCallParam param) {
        return Mono.defer(() -> {
            RuntimeContext runtime = requireRuntimeContext(param);
            AgentRunContext run = requireContext(runtime, AgentRunContext.class);
            CancellationContext cancellation = requireContext(runtime, CancellationContext.class);
            ToolExecutionContext toolContext =
                    requireContext(runtime, ToolExecutionContext.class);
            Map<String, Object> input = Objects.requireNonNull(
                    param.getInput(), "AgentScope tool input must not be null");
            // 宿主调用显式携带 appId(AppContext):目录定位/行级过滤按应用隔离。
            // 注意不设租户上下文——ia_tool_registry 为 app 级治理表(无 tenant_id
            // 列),租户注入会让 invoker 的注册表定位 SQL 报错;act token 身份
            // (userId/tenantId/runId)经 actContext 显式传给调用端签发。
            // [P4-W13] 传目录 FQN(mcp__<serverKey>__<tool>):invoker 按命名空间
            // 二分路由——宿主注册表(裸名还原)或三方服务器(应用级/用户级)。
            Mono<McpToolInvocationResult> invocation = Mono.fromCallable(() ->
                            AppContext.runInApp(appId, () -> mcpToolInvoker.invoke(
                                    appId, entry.fqn(), input, toolContext)))
                    .subscribeOn(toolScheduler);
            return cancellation.checkpoint()
                    .then(assertLease(run))
                    .then(invocation)
                    .flatMap(result -> cancellation.checkpoint()
                            .then(assertLease(run))
                            .thenReturn(projectResult(param, result)))
                    .timeout(remaining(run));
        });
    }

    // ------------------------------------------------------------------
    // 结果投影 / 契约校验
    // ------------------------------------------------------------------

    /**
     * 结果投影:宿主错误(isError / platform status 契约)→ AgentScope error
     * 结果回灌模型可续跑;其余为文本结果。
     */
    private ToolResultBlock projectResult(ToolCallParam param, McpToolInvocationResult result) {
        if (result == null) {
            throw new IllegalStateException("AgentScope MCP tool returned null result: " + getName());
        }
        if (result.error()) {
            return errorResult(param, result.payloadJson());
        }
        if (result.payloadJson() == null) {
            throw new IllegalStateException(
                    "AgentScope MCP tool returned null output: " + getName());
        }
        try {
            JsonNode payload = objectMapper.readTree(result.payloadJson());
            if (payload != null && payload.isObject()) {
                JsonNode status = payload.get("status");
                if (status != null && status.isTextual()
                        && ("error".equalsIgnoreCase(status.textValue())
                            || "failed".equalsIgnoreCase(status.textValue()))) {
                    return errorResult(param, result.payloadJson());
                }
            }
        } catch (JsonProcessingException plainTextResult) {
            // payloadJson 恒为合法 JSON(McpClientToolInvoker 契约);容错按文本处理
        }
        return textResult(param, result.payloadJson());
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
            McpToolCatalogEntry entry,
            AgentScopeToolSchema.PreparedSchema schema) {
        Objects.requireNonNull(entry, "entry must not be null");
        Objects.requireNonNull(schema, "schema must not be null");
        String description = entry.description();
        if (description == null || description.isBlank()) {
            // 目录描述可空:回退 FQN,保持 ToolBase 描述非空契约
            description = entry.fqn();
        }
        return ToolBase.builder()
                .name(entry.fqn())
                .description(description)
                .inputSchema(schema.value())
                .readOnly(entry.readOnlyEffective())
                .concurrencySafe(entry.concurrencySafe());
    }
}
