package com.inneragent.agent.run;

import com.inneragent.agent.entity.AgentRun;
import com.inneragent.platform.repository.ai.AgentRunRepository;
import com.inneragent.agent.context.AgentConversationContext;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.context.AgentScopeRuntimeContextRequest;
import com.inneragent.agent.context.AuthenticatedUserContext;
import com.inneragent.agent.context.CancellationContext;
import com.inneragent.agent.context.PipelineRequestContext;
import com.inneragent.agent.context.ParentAgentRunContext;
import com.inneragent.agent.context.ProjectContext;
import com.inneragent.agent.context.ToolExecutionContext;
import com.inneragent.agent.context.ToolPermissionContext;
import com.inneragent.agent.permission.ToolExecutionMode;
import com.inneragent.agent.mcp.McpToolCatalog;
import com.inneragent.agent.permission.ToolGrantPolicyView;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.model.ResumedAgentRun;
import com.inneragent.agent.run.model.StartedAgentRun;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.tenant.TenantContext;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Objects;
import java.util.function.Supplier;

@Component
public final class AgentExecutionRuntimeContextRequests {

    private final AgentRunRepository runRepository;
    private final AgentRuntimeSchedulers schedulers;
    // [adapt] P1-T2a:确认档位映射输入 —— 用户永久授权(ia_tool_grant)
    // 与 resolve_scope 降级标记(目录聚合判定);端口缺省时空授权/未降级
    private final ObjectProvider<ToolGrantPolicyView> grantViews;
    private final ObjectProvider<McpToolCatalog> toolCatalogs;

    public AgentExecutionRuntimeContextRequests(
            AgentRunRepository runRepository,
            AgentRuntimeSchedulers schedulers,
            ObjectProvider<ToolGrantPolicyView> grantViews,
            ObjectProvider<McpToolCatalog> toolCatalogs) {
        this.runRepository = Objects.requireNonNull(
                runRepository, "runRepository must not be null");
        this.schedulers = Objects.requireNonNull(schedulers, "schedulers must not be null");
        this.grantViews = Objects.requireNonNull(grantViews, "grantViews must not be null");
        this.toolCatalogs = Objects.requireNonNull(toolCatalogs, "toolCatalogs must not be null");
    }

    public Mono<AgentScopeRuntimeContextRequest> forChild(
            StartedAgentRun started,
            String agentDefinitionStableKey,
            ProjectContext projectContext,
            ParentAgentRunContext parentRun,
            ToolExecutionMode toolExecutionMode) {
        Objects.requireNonNull(started, "started must not be null");
        Objects.requireNonNull(parentRun, "parentRun must not be null");
        Objects.requireNonNull(toolExecutionMode, "toolExecutionMode must not be null");
        return load(started.runId()).map(run -> inRunApp(run, () -> create(
                run,
                agentDefinitionStableKey,
                started.ownerInstanceId(),
                started.ownerEpoch(),
                started.deadline(),
                projectContext,
                parentRun,
                toolExecutionMode,
                PipelineRequestContext.Kind.PIPELINE)));
    }

    public Mono<AgentScopeRuntimeContextRequest> forRoot(
            StartedAgentRun started,
            String agentDefinitionStableKey,
            ProjectContext projectContext,
            ToolExecutionMode toolExecutionMode) {
        Objects.requireNonNull(started, "started must not be null");
        Objects.requireNonNull(toolExecutionMode, "toolExecutionMode must not be null");
        return load(started.runId()).map(run -> {
            if (run.getParentRunId() != null || run.getParentToolCallId() != null) {
                throw new IllegalArgumentException(
                        "Root RuntimeContext cannot be created for a child run");
            }
            return inRunApp(run, () -> create(
                    run,
                    agentDefinitionStableKey,
                    started.ownerInstanceId(),
                    started.ownerEpoch(),
                    started.deadline(),
                    projectContext,
                    null,
                    toolExecutionMode,
                    PipelineRequestContext.Kind.PIPELINE));
        });
    }

    public Mono<AgentScopeRuntimeContextRequest> forResume(
            ResumedAgentRun resumed,
            String agentDefinitionStableKey,
            ToolExecutionMode toolExecutionMode) {
        Objects.requireNonNull(resumed, "resumed must not be null");
        Objects.requireNonNull(toolExecutionMode, "toolExecutionMode must not be null");
        return load(resumed.runId()).map(run -> inRunApp(run, () -> create(
                run,
                agentDefinitionStableKey,
                resumed.newOwnerInstanceId(),
                resumed.newOwnerEpoch(),
                resumed.deadline(),
                run.getProjectId() != null ? new ProjectContext(run.getProjectId()) : null,
                parentForResume(run),
                toolExecutionMode,
                PipelineRequestContext.Kind.PIPELINE)));
    }

    /**
     * [adapt] 多应用运行 500 二轮根修:按全局唯一 run_id 的系统查找脱离
     * 环境行级注入。run_id 全局唯一且入口已鉴权,此处查找可能在丢失
     * ThreadLocal 上下文的调度线程上执行(netty/agentscope 内部线程提交),
     * 环境 AppContext/TenantContext 缺失时行级拦截器按缺省 app 1/环境租户
     * 过滤,查不到非缺省应用的 run 行(真机实证:注入 app_id 正确、但
     * 租户过滤与环境回落租户错位同样致命)。改为系统模式(双列注入均跳过)
     * 查行,行到手后以行归属恢复上下文(inRunApp)。
     */
    private Mono<AgentRun> load(String runId) {
        return Mono.fromCallable(() -> {
                    AgentRun run = TenantContext.runAsSystem(() ->
                            AppContext.runAsSystem(() ->
                                    runRepository.findRun(runId)));
                    if (run == null) {
                        throw new IllegalStateException("Agent run does not exist: " + runId);
                    }
                    return run;
                })
                .subscribeOn(schedulers.journal());
    }

    /**
     * 以运行行归属执行组装:权限面(grant 目录/resolve_scope)按行的 app
     * 解析,不再依赖执行线程的环境 AppContext。
     */
    private <T> T inRunApp(AgentRun run, Supplier<T> action) {
        return AppContext.runInApp(run.getAppId(), action);
    }

    private AgentScopeRuntimeContextRequest create(
            AgentRun persisted,
            String agentDefinitionStableKey,
            String ownerInstanceId,
            long ownerEpoch,
            Instant deadline,
            ProjectContext requestedProject,
            ParentAgentRunContext parentRun,
            ToolExecutionMode toolExecutionMode,
            PipelineRequestContext.Kind requestKind) {
        Objects.requireNonNull(toolExecutionMode, "toolExecutionMode must not be null");
        Objects.requireNonNull(requestKind, "requestKind must not be null");
        if (!Objects.equals(persisted.getAgentType(), agentDefinitionStableKey)) {
            throw new IllegalArgumentException(
                    "RuntimeContext agent definition does not match the persisted run");
        }
        if (!persisted.getDeadlineAt().toInstant(ZoneOffset.UTC).equals(deadline)) {
            throw new IllegalArgumentException(
                    "RuntimeContext deadline does not match the persisted run deadline");
        }
        ProjectContext project = persisted.getProjectId() != null
                ? new ProjectContext(persisted.getProjectId())
                : null;
        if (requestedProject != null && !requestedProject.equals(project)) {
            throw new IllegalArgumentException(
                    "RuntimeContext project does not match the persisted run project");
        }
        validateParent(persisted, parentRun);
        long userId = persisted.getUserId();
        return new AgentScopeRuntimeContextRequest(
                new AuthenticatedUserContext(userId),
                new AgentConversationContext(
                        persisted.getConversationId(),
                        agentDefinitionStableKey,
                        persisted.getAgentStateSessionId()),
                new AgentRunContext(
                        persisted.getRunId(),
                        ownerInstanceId,
                        ownerEpoch,
                        deadline,
                        persisted.getParentToolCallId(),
                        persisted.getAgentName()),
                parentRun,
                project,
                new PipelineRequestContext(
                        persisted.getRunId(), requestKind),
                // 内核契约要求正数租户(ToolExecutionContext 构造校验);运行行
                // 的 tenant_id 现与会话/消息/事件行同口径保留 0(=无租户),
                // 仅在此处对内核入参兜底,不再污染运行行归属。
                new ToolExecutionContext(userId, 1, userId, kernelTenantId(persisted.getTenantId()),
                        persisted.getRunId()),
                CancellationContext.noop(),
                permissionContext(userId, toolExecutionMode));
    }

    private static long kernelTenantId(Long tenantId) {
        return tenantId != null && tenantId > 0 ? tenantId : 1L;
    }

    /**
     * [adapt] P1-T2a:确认档位映射输入装配 —— 用户「总是允许」永久授权
     * (ia_tool_grant,经 ToolGrantPolicyView 端口)+ resolve_scope 降级标记
     * (宿主未实现反查时写操作一律确认,PRD §6.1.4)。端口缺省时行为与
     * T1 完全一致(无授权、未降级)。
     */
    private ToolPermissionContext permissionContext(long userId, ToolExecutionMode mode) {
        ToolGrantPolicyView grantView = grantViews.getIfAvailable();
        McpToolCatalog toolCatalog = toolCatalogs.getIfAvailable();
        java.util.Set<String> grantedTools = grantView == null
                ? java.util.Set.of()
                : grantView.permanentGrantedToolFqns(AppContext.currentOrDefault(), userId);
        boolean scopeDegraded = toolCatalog != null
                && !toolCatalog.resolveScopeImplemented(AppContext.currentOrDefault());
        return new ToolPermissionContext(mode, grantedTools, scopeDegraded);
    }

    private ParentAgentRunContext parentForResume(AgentRun child) {
        if (child.getParentRunId() == null) {
            return null;
        }
        // 父行同按全局唯一 run_id 系统查找(见 load 注释)
        AgentRun parent = TenantContext.runAsSystem(() ->
                AppContext.runAsSystem(() ->
                        runRepository.findRun(child.getParentRunId())));
        if (parent == null
                || parent.getOwnerInstanceId() == null
                || parent.getOwnerInstanceId().isBlank()
                || parent.getOwnerEpoch() == null
                || parent.getOwnerEpoch() <= 0) {
            throw new IllegalStateException(
                    "Child Agent run has no active parent owner: "
                            + child.getRunId());
        }
        return new ParentAgentRunContext(
                parent.getRunId(),
                parent.getOwnerInstanceId(),
                parent.getOwnerEpoch(),
                child.getParentToolCallId(),
                child.getAgentName());
    }

    private void validateParent(
            AgentRun persisted, ParentAgentRunContext parentRun) {
        if (persisted.getParentRunId() == null) {
            if (parentRun != null) {
                throw new IllegalArgumentException(
                        "Root RuntimeContext must not carry a parent run");
            }
            return;
        }
        if (parentRun == null
                || !Objects.equals(persisted.getParentRunId(), parentRun.runId())
                || !Objects.equals(
                        persisted.getParentToolCallId(), parentRun.toolCallId())
                || !Objects.equals(persisted.getAgentName(), parentRun.agentName())) {
            throw new IllegalArgumentException(
                    "Child RuntimeContext parent identity does not match the persisted run");
        }
    }
}
