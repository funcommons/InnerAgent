package com.inneragent.agent.run;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.agent.entity.AgentConversation;
import com.inneragent.agent.entity.AgentMessage;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.platform.repository.ai.AgentRunRepository;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.model.ChildRunAdmission;
import com.inneragent.agent.run.model.ChildRunIdentityConflictException;
import com.inneragent.agent.run.model.StartAgentRunCommand;
import com.inneragent.platform.tenant.TenantContext;
import com.inneragent.platform.context.UserContext;
import com.inneragent.agent.run.model.StartChildAgentRunCommand;
import com.inneragent.agent.run.model.StartedAgentRun;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import com.inneragent.agent.state.AgentStateCleanupPolicyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Objects;

/**
 * Owns the only root and platform-child run admission transactions.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentRunCoordinator {

    private static final long INITIAL_OWNER_EPOCH = 1L;

    /**
     * 内核工具执行上下文(ToolExecutionContext)要求正数租户的最低保障值:
     * 仅当会话行与当前身份上下文都缺失租户时兜底(P0 演示链路遗留数据形态),
     * embed 认证下 UserContext 已带宿主声明的真实租户,不会触发。
     */
    private static final long FALLBACK_TENANT_ID = 1L;

    private final AgentRunRepository runRepository;
    private final AgentMessageAllocator messageAllocator;
    private final TransactionTemplate transactionTemplate;
    private final AgentRuntimeSchedulers schedulers;
    private final AgentStateCleanupPolicyService stateCleanupPolicy;
    private final AgentScopeV2Properties properties;

    public Mono<StartedAgentRun> start(StartAgentRunCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        // Reactor 调度线程无 ThreadLocal 租户上下文；归属校验已通过
        // command.userId/conversationId 显式完成，这里以系统模式执行事务
        return Mono.fromCallable(() -> TenantContext.runAsSystem(() -> requireTransactionResult(
                        transactionTemplate.execute(ignored -> startTransaction(command)))))
                .subscribeOn(schedulers.journal());
    }

    public Mono<ChildRunAdmission> startChild(StartChildAgentRunCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        return Mono.fromCallable(() -> TenantContext.runAsSystem(() -> requireTransactionResult(
                        transactionTemplate.execute(ignored -> startChildTransaction(command)))))
                .subscribeOn(schedulers.journal());
    }

    private StartedAgentRun startTransaction(StartAgentRunCommand command) {
        requireRootIdentity(command);
        AgentConversation conversation = requireOwnedConversation(
                command.conversationId(), command.userId(), command.projectId());
        LocalDateTime databaseNow = runRepository.databaseNow();
        stateCleanupPolicy.requireAvailable(
                conversation,
                databaseNow,
                stateCleanupPolicy.getCurrent().getRetentionDays());
        String stateSessionId = rootStateSessionId(command);
        runRepository.activateConversation(conversation, databaseNow);
        LocalDateTime deadline = requireFutureDeadline(command.deadline(), databaseNow);
        LocalDateTime leaseUntil = leaseUntil(databaseNow, command.ownerLease(), deadline);

        AgentRun run = AgentRun.builder()
                .runId(command.runId())
                .conversationId(conversation.getConversationId())
                .userId(conversation.getUserId())
                .projectId(conversation.getProjectId())
                .tenantId(normalizeTenantId(conversation.getTenantId()))
                .agentType(command.agentType())
                .kernelFingerprint(command.kernelSnapshot().fingerprint())
                .agentDefinitionSnapshotJson(command.kernelSnapshot().snapshotJson())
                .agentStateSessionId(stateSessionId)
                .status(AgentRunStatus.RUNNING.name())
                .ownerInstanceId(command.ownerInstanceId())
                .ownerEpoch(INITIAL_OWNER_EPOCH)
                .leaseUntil(leaseUntil)
                .deadlineAt(deadline)
                .startedAt(databaseNow)
                .heartbeatAt(databaseNow)
                .build();
        try {
            runRepository.insert(run);
        } catch (DuplicateKeyException duplicate) {
            throw new BusinessException(409, "该会话已有运行中的 Agent 任务");
        }

        long initialOrder = messageAllocator.append(
                conversation.getConversationId(), userMessage(
                        command.runId(), command.userContent(), command.referencesJson()));
        return started(run, command.kernelSnapshot(), initialOrder);
    }

    private ChildRunAdmission startChildTransaction(StartChildAgentRunCommand command) {
        AgentRun parent = runRepository.lockRun(command.parentRunId());
        LocalDateTime databaseNow = runRepository.databaseNow();
        requireAdmissibleParent(parent, command, databaseNow);

        LocalDateTime deadline = clampChildDeadline(
                parent, requireFutureDeadline(command.deadline(), databaseNow));
        enforceSubAgentGuardrails(parent, command);
        LocalDateTime leaseUntil = leaseUntil(databaseNow, command.ownerLease(), deadline);
        AgentRun child = AgentRun.builder()
                .runId(command.childRunId())
                .conversationId(parent.getConversationId())
                .userId(parent.getUserId())
                .projectId(parent.getProjectId())
                .tenantId(parent.getTenantId())
                .agentType(command.agentDefinitionStableKey())
                .parentRunId(parent.getRunId())
                .parentToolCallId(command.parentToolCallId())
                .agentName(command.agentName())
                .kernelFingerprint(command.kernelSnapshot().fingerprint())
                .agentDefinitionSnapshotJson(command.kernelSnapshot().snapshotJson())
                .agentStateSessionId(AgentStateSessionIds.childGeneration(
                        parent.getRunId(),
                        parent.getAgentStateSessionId(),
                        command.parentToolCallId(),
                        command.agentDefinitionStableKey()))
                .status(AgentRunStatus.RUNNING.name())
                .ownerInstanceId(command.ownerInstanceId())
                .ownerEpoch(INITIAL_OWNER_EPOCH)
                .leaseUntil(leaseUntil)
                .deadlineAt(deadline)
                .startedAt(databaseNow)
                .heartbeatAt(databaseNow)
                .build();
        try {
            runRepository.insert(child);
            long initialOrder = messageAllocator.append(
                    parent.getConversationId(), userMessage(
                            child.getRunId(), command.userContent(), command.referencesJson()));
            return new ChildRunAdmission(
                    started(child, command.kernelSnapshot(), initialOrder),
                    AgentRunStatus.RUNNING,
                    true);
        } catch (DuplicateKeyException duplicate) {
            return existingChildAdmission(command, deadline, duplicate);
        }
    }

    private ChildRunAdmission existingChildAdmission(
            StartChildAgentRunCommand command,
            LocalDateTime persistedDeadline,
            DuplicateKeyException duplicate) {
        AgentRun existing = runRepository.lockChild(
                command.parentRunId(), command.parentToolCallId());
        if (existing == null) {
            throw duplicate;
        }
        if (!Objects.equals(existing.getAgentName(), command.agentName())
                || !Objects.equals(existing.getAgentType(), command.agentDefinitionStableKey())
                || !Objects.equals(existing.getKernelFingerprint(),
                        command.kernelSnapshot().fingerprint())
                || !Objects.equals(existing.getAgentDefinitionSnapshotJson(),
                        command.kernelSnapshot().snapshotJson())
                || !Objects.equals(existing.getDeadlineAt(), persistedDeadline)) {
            throw new ChildRunIdentityConflictException(
                    command.parentRunId(), command.parentToolCallId());
        }
        Long initialOrder = runRepository.findInitialMessageOrder(existing.getRunId());
        if (initialOrder == null || initialOrder < 1) {
            throw new IllegalStateException(
                    "Existing child run has no persisted initial message: " + existing.getRunId());
        }
        AgentRunStatus status;
        try {
            status = AgentRunStatus.valueOf(existing.getStatus());
        } catch (IllegalArgumentException invalidStatus) {
            throw new IllegalStateException(
                    "Existing child run has an unsupported status: " + existing.getStatus(),
                    invalidStatus);
        }
        return new ChildRunAdmission(
                started(existing, command.kernelSnapshot(), initialOrder), status, false);
    }

    private AgentConversation requireOwnedConversation(
            String conversationId, long userId, Long requestedProjectId) {
        AgentConversation conversation = runRepository.lockConversation(conversationId);
        if (conversation == null) {
            throw new BusinessException(404, "Agent 对话不存在");
        }
        if (!Objects.equals(conversation.getUserId(), userId)) {
            throw new BusinessException(403, "无权在该 Agent 对话中启动任务");
        }
        if (requestedProjectId != null
                && !Objects.equals(conversation.getProjectId(), requestedProjectId)) {
            throw new BusinessException(409, "Agent 对话与请求项目不一致");
        }
        return conversation;
    }

    private void requireRootIdentity(StartAgentRunCommand command) {
        if (command.parentRunId() != null
                || command.parentToolCallId() != null
                || command.agentName() != null) {
            throw new IllegalArgumentException(
                    "Root run admission does not accept parent identity fields");
        }
    }

    private void requireAdmissibleParent(
            AgentRun parent,
            StartChildAgentRunCommand command,
            LocalDateTime databaseNow) {
        if (parent == null) {
            throw new BusinessException(404, "父 Agent 运行不存在");
        }
        if (!AgentRunStatus.RUNNING.name().equals(parent.getStatus())) {
            throw new BusinessException(409, "父 Agent 运行当前不接受子任务");
        }
        if (!Objects.equals(parent.getOwnerInstanceId(), command.parentOwnerInstanceId())
                || !Objects.equals(parent.getOwnerEpoch(), command.parentOwnerEpoch())) {
            throw new BusinessException(409, "父 Agent 运行所有权已变更");
        }
        if (parent.getLeaseUntil() == null || !parent.getLeaseUntil().isAfter(databaseNow)) {
            throw new BusinessException(409, "父 Agent 运行租约已失效");
        }
        if (parent.getDeadlineAt() == null || !parent.getDeadlineAt().isAfter(databaseNow)) {
            throw new BusinessException(409, "父 Agent 运行已超过截止时间");
        }
    }

    private LocalDateTime requireFutureDeadline(Instant deadline, LocalDateTime databaseNow) {
        LocalDateTime persisted = toDatabaseTime(deadline);
        if (!persisted.isAfter(databaseNow)) {
            throw new IllegalArgumentException("Agent run deadline must be in the future");
        }
        return persisted;
    }

    /**
     * [adapt] P4-W14 子运行 deadline 钳制(03-开发计划 §7.3 验收 4「子 deadline
     * ≤ 父」):缺省请求(适配器传父 deadline)天然不越界;显式传入更大值时
     * 钳制到父 deadlineAt 并 WARN 留痕——子运行生命周期恒被父覆盖,而非
     * 整次调起被拒绝。更短请求按原样生效。
     */
    private LocalDateTime clampChildDeadline(AgentRun parent, LocalDateTime requested) {
        LocalDateTime parentDeadline = parent.getDeadlineAt();
        if (parentDeadline == null || !requested.isAfter(parentDeadline)) {
            return requested;
        }
        log.warn("Child run deadline clamped to parent deadline: parentRunId={}, "
                        + "requested={}, clamped={}",
                parent.getRunId(), requested, parentDeadline);
        return parentDeadline;
    }

    /**
     * [adapt] P4-W14 深度/扇出护栏(fusion.agentscope.v2.execution.
     * max-sub-agent-depth 默认 3 / max-concurrent-sub-agents 默认 5):
     * 深度按父子链代数计数(根=1);扇出按父下活跃子运行计数,排除同
     * parentToolCallId 的幂等重试。超限以 429 明确拒绝,错误经子 Agent 工具
     * 结果回灌模型(见 AgentScopeSubAgentToolAdapter 的准入拒绝映射)。
     */
    private void enforceSubAgentGuardrails(AgentRun parent, StartChildAgentRunCommand command) {
        int maxDepth = properties.getExecution().getMaxSubAgentDepth();
        int parentDepth = runRepository.generationDepthOf(parent, maxDepth);
        if (parentDepth + 1 > maxDepth) {
            throw new BusinessException(429, "子 Agent 嵌套深度超过上限 " + maxDepth
                    + "(当前层级 " + (parentDepth + 1) + "),父运行 " + parent.getRunId());
        }
        int maxConcurrent = properties.getExecution().getMaxConcurrentSubAgents();
        long activeOthers = runRepository.findActiveChildren(parent.getRunId()).stream()
                .filter(child -> !command.parentToolCallId()
                        .equals(child.getParentToolCallId()))
                .count();
        if (activeOthers >= maxConcurrent) {
            throw new BusinessException(429, "子 Agent 并发数超过上限 " + maxConcurrent
                    + "(父运行 " + parent.getRunId() + " 当前活跃子运行 " + activeOthers + "个)");
        }
    }

    /**
     * [adapt] P0 演示租户回填补丁的语义修正(P1-T1→多应用 500 二轮根修):
     * 运行行租户以会话行为单一事实源——会话行携带的租户(含 0=无租户)
     * 原样沿用,保证运行行与会话/消息/事件行的租户归属同口径;仅当会话行
     * 租户为 NULL(列上线前的历史行)时按 ① UserContext ② 正数兜底解析。
     *
     * <p>真机实证的缺陷:embed 用户(token tenantId=0)的会话行租户为 0,
     * 旧逻辑把 0 视为缺失而回落 1,运行行租户写成 1;同一运行链的 journal
     * 线程环境租户为 0,后续按 run_id 回查(RUNTIME CONTEXT 装配、事件
     * append 的行锁)注入 tenant_id=0 过滤,行(1)与过滤(0)错位 →
     * 「Agent run does not exist」500。内核 ToolExecutionContext 的正数租户
     * 约束改由装配点(RuntimeContext create)对入参兜底满足,不再落行。
     */
    private static Long normalizeTenantId(Long tenantId) {
        if (tenantId != null) {
            return tenantId;
        }
        Long contextTenantId = UserContext.getTenantId();
        if (contextTenantId != null && contextTenantId > 0) {
            return contextTenantId;
        }
        log.warn("Agent run resolved no tenant from conversation/UserContext; "
                + "falling back to tenant {}. Persisted tenantId={}", FALLBACK_TENANT_ID, tenantId);
        return FALLBACK_TENANT_ID;
    }

    private LocalDateTime leaseUntil(
            LocalDateTime databaseNow,
            Duration ownerLease,
            LocalDateTime deadline) {
        LocalDateTime requested = databaseNow.plus(ownerLease)
                .truncatedTo(ChronoUnit.MILLIS);
        return requested.isAfter(deadline) ? deadline : requested;
    }

    private AgentMessage userMessage(String runId, String content, String referencesJson) {
        return AgentMessage.builder()
                .runId(runId)
                .role("user")
                .content(content)
                .referencesJson(referencesJson)
                .build();
    }

    private StartedAgentRun started(
            AgentRun run,
            AgentKernelSnapshot snapshot,
            long initialMessageOrder) {
        return new StartedAgentRun(
                run.getRunId(),
                run.getConversationId(),
                run.getAgentStateSessionId(),
                run.getOwnerInstanceId(),
                run.getOwnerEpoch(),
                toInstant(run.getLeaseUntil()),
                toInstant(run.getDeadlineAt()),
                snapshot,
                initialMessageOrder);
    }

    private String rootStateSessionId(StartAgentRunCommand command) {
        AgentRun latest = runRepository.findLatestRoot(command.conversationId());
        if (latest == null || !Objects.equals(latest.getAgentType(), command.agentType())) {
            return command.stateSessionCandidate();
        }
        AgentRunStatus status;
        try {
            status = AgentRunStatus.valueOf(latest.getStatus());
        } catch (RuntimeException invalidStatus) {
            throw new IllegalStateException(
                    "Latest root run has an unsupported status: " + latest.getStatus(),
                    invalidStatus);
        }
        if (status == AgentRunStatus.FAILED || status == AgentRunStatus.CANCELLED) {
            // AgentScope may finish an asynchronous state save after durable
            // cancellation. A new immutable generation fences every such late
            // write without delaying cancellation or fabricating tool results.
            return AgentStateSessionIds.recoveryGeneration(
                    command.conversationId(), command.agentType(), command.runId());
        }
        return requireStateSessionId(latest);
    }

    private String requireStateSessionId(AgentRun run) {
        String sessionId = run.getAgentStateSessionId();
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalStateException(
                    "Latest root run has no AgentState session: " + run.getRunId());
        }
        return sessionId;
    }

    private LocalDateTime toDatabaseTime(Instant instant) {
        return LocalDateTime.ofInstant(
                instant.truncatedTo(ChronoUnit.MILLIS), ZoneOffset.UTC);
    }

    private Instant toInstant(LocalDateTime value) {
        return value.toInstant(ZoneOffset.UTC);
    }

    private <T> T requireTransactionResult(T value) {
        return Objects.requireNonNull(value, "Agent run transaction returned no result");
    }
}
