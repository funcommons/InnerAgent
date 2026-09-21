package com.inneragent.platform.repository.ai;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.entity.AgentEvent;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.platform.enums.ai.AgentModelCallStatus;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.platform.enums.ai.AgentRuntimeErrorCode;
import com.inneragent.agent.mapper.AgentEventMapper;
import com.inneragent.agent.mapper.AgentModelCallUsageMapper;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.run.AgentEventEnvelopeSanitizer;
import com.inneragent.agent.run.model.AgentEventEnvelope;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import com.inneragent.agent.run.model.RunTerminalRequest;
import com.inneragent.agent.run.model.SystemTerminalActor;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/** MySQL row-lock implementation of the durable event transaction port. */
@Repository
@RequiredArgsConstructor
public class MySqlAgentEventRepository implements AgentEventRepository {

    private static final Set<AgentRunStatus> OWNED_TERMINAL_SOURCE =
            Set.of(AgentRunStatus.RUNNING);

    private final AgentRunMapper runMapper;
    private final AgentEventMapper eventMapper;
    private final AgentModelCallUsageMapper usageMapper;
    private final ObjectMapper objectMapper;
    private final AgentEventEnvelopeSanitizer sanitizer;

    @Override
    @Transactional
    public Optional<CommittedAgentEvent> appendOwnedTx(
            String runId,
            String ownerInstanceId,
            long ownerEpoch,
            AgentEventEnvelope event) {
        requireOwnerArguments(runId, ownerInstanceId, ownerEpoch);
        Objects.requireNonNull(event, "event must not be null");

        // [adapt] 多应用运行 500 二轮根修:运行日志按全局唯一 run_id + 显式
        // owner 租约 fencing 定位,属系统路径 —— 事件可能由丢失 ThreadLocal
        // 上下文的内核/唤醒线程提交,环境行级注入(app 缺省回落 1)会把行
        // 过滤成「不存在」→ isCurrentOwner 判空 → append 被误判失租,执行
        // 流中断(真机实证:运行中途 OWNER_LOST)。以系统模式读行与写入,
        // 事件归属显式取运行行(见 insertEvent)。
        return TenantContext.runAsSystem(() -> AppContext.runAsSystem(() -> {
            AgentRun run = runMapper.selectByRunIdForUpdate(runId);
            LocalDateTime databaseNow = runMapper.selectDatabaseNow();
            if (!isCurrentOwner(run, ownerInstanceId, ownerEpoch, databaseNow)) {
                return Optional.empty();
            }
            AgentEventEnvelope safeEvent = sanitize(event);
            long sequence = requireNextSequence(run);
            advanceSequence(run, sequence + 1, databaseNow);
            AgentEvent inserted = insertEvent(run, sequence, safeEvent, databaseNow);
            return Optional.of(toCommitted(inserted, safeEvent, databaseNow));
        }));
    }

    @Override
    @Transactional
    public Optional<CommittedAgentEvent> terminateOwnedTx(
            RunTerminalRequest request,
            String ownerInstanceId,
            long ownerEpoch) {
        Objects.requireNonNull(request, "request must not be null");
        requireOwnerArguments(request.runId(), ownerInstanceId, ownerEpoch);

        return TenantContext.runAsSystem(() -> AppContext.runAsSystem(() -> {
            AgentRun run = runMapper.selectByRunIdForUpdate(request.runId());
            LocalDateTime databaseNow = runMapper.selectDatabaseNow();
            if (!OWNED_TERMINAL_SOURCE.equals(request.expectedStatuses())
                    || !isCurrentOwner(run, ownerInstanceId, ownerEpoch, databaseNow)) {
                return Optional.empty();
            }
            return Optional.of(insertTerminal(run, request, databaseNow));
        }));
    }

    @Override
    @Transactional
    public Optional<CommittedAgentEvent> terminateSystemTx(
            RunTerminalRequest request,
            SystemTerminalActor actor) {
        Objects.requireNonNull(request, "request must not be null");
        Objects.requireNonNull(actor, "actor must not be null");

        return TenantContext.runAsSystem(() -> AppContext.runAsSystem(() -> {
            AgentRun run = runMapper.selectByRunIdForUpdate(request.runId());
            LocalDateTime databaseNow = runMapper.selectDatabaseNow();
            if (!systemTransitionAllowed(run, request, actor, databaseNow)) {
                return Optional.empty();
            }
            return Optional.of(insertTerminal(run, request, databaseNow));
        }));
    }

    @Override
    public ReplaySnapshot loadReplaySnapshot(String runId) {
        String safeRunId = requireRunId(runId);
        AgentRun run = runMapper.selectByRunId(safeRunId);
        if (run == null) {
            throw new IllegalArgumentException("Agent run does not exist: " + safeRunId);
        }
        Long nextSequence = run.getNextSequence();
        if (nextSequence == null || nextSequence < 1) {
            throw new IllegalStateException(
                    "Agent run has an invalid next sequence: " + safeRunId);
        }
        return new ReplaySnapshot(nextSequence - 1, run.getTerminalSequence());
    }

    @Override
    public List<CommittedAgentEvent> loadReplayPage(
            String runId,
            long afterSequence,
            long throughSequence,
            int limit) {
        String safeRunId = requireRunId(runId);
        if (afterSequence < 0) {
            throw new IllegalArgumentException("afterSequence must not be negative");
        }
        if (throughSequence < afterSequence) {
            throw new IllegalArgumentException(
                    "throughSequence must not precede afterSequence");
        }
        if (limit <= 0 || limit > 1000) {
            throw new IllegalArgumentException("limit must be between 1 and 1000");
        }
        if (throughSequence == afterSequence) {
            return List.of();
        }

        List<AgentEvent> rows = eventMapper.selectReplayRange(
                safeRunId, afterSequence, throughSequence, limit);
        if (rows.isEmpty()) {
            throw replayGap(safeRunId, afterSequence + 1, null);
        }
        List<CommittedAgentEvent> committed = new ArrayList<>(rows.size());
        long expected = afterSequence + 1;
        for (AgentEvent row : rows) {
            if (!Objects.equals(row.getSequenceNo(), expected)) {
                throw replayGap(safeRunId, expected, row.getSequenceNo());
            }
            committed.add(toCommitted(row));
            expected++;
        }
        return List.copyOf(committed);
    }

    private boolean isCurrentOwner(
            AgentRun run,
            String ownerInstanceId,
            long ownerEpoch,
            LocalDateTime databaseNow) {
        return run != null
                && AgentRunStatus.RUNNING.name().equals(run.getStatus())
                && Objects.equals(run.getOwnerInstanceId(), ownerInstanceId)
                && Objects.equals(run.getOwnerEpoch(), ownerEpoch)
                && run.getLeaseUntil() != null
                && run.getLeaseUntil().isAfter(databaseNow);
    }

    private boolean systemTransitionAllowed(
            AgentRun run,
            RunTerminalRequest request,
            SystemTerminalActor actor,
            LocalDateTime databaseNow) {
        if (run == null) {
            return false;
        }
        AgentRunStatus current = parseStatus(run.getStatus());
        if (!request.expectedStatuses().equals(Set.of(current))) {
            return false;
        }
        return switch (actor) {
            case CANCELLATION_COORDINATOR ->
                    current == AgentRunStatus.CANCEL_REQUESTED
                            && request.terminalStatus() == AgentRunStatus.CANCELLED;
            case CONFIRMATION_EXPIRER ->
                    current == AgentRunStatus.WAITING_CONFIRMATION
                            && run.getWaitExpiresAt() != null
                            && !run.getWaitExpiresAt().isAfter(databaseNow)
                            && request.terminalStatus() == AgentRunStatus.CANCELLED;
            case OWNER_RECONCILER ->
                    run.getLeaseUntil() != null
                            && !run.getLeaseUntil().isAfter(databaseNow)
                            && ((current == AgentRunStatus.RUNNING
                                    && request.terminalStatus() == AgentRunStatus.FAILED
                                    && request.errorCode() == AgentRuntimeErrorCode.OWNER_LOST)
                                || (current == AgentRunStatus.CANCEL_REQUESTED
                                    && request.terminalStatus() == AgentRunStatus.CANCELLED));
        };
    }

    private CommittedAgentEvent insertTerminal(
            AgentRun run,
            RunTerminalRequest request,
            LocalDateTime databaseNow) {
        AgentEventEnvelope safeEnvelope = sanitize(request.terminalEnvelope());
        validateTerminalIdentity(run, safeEnvelope);
        long sequence = requireNextSequence(run);
        AgentEvent inserted = insertEvent(
                run, sequence, safeEnvelope, databaseNow);

        int updated = runMapper.update(null, new LambdaUpdateWrapper<AgentRun>()
                .eq(AgentRun::getId, run.getId())
                .eq(AgentRun::getStatus, run.getStatus())
                .set(AgentRun::getNextSequence, sequence + 1)
                .set(AgentRun::getTerminalSequence, sequence)
                .set(AgentRun::getTerminalOutputType,
                        request.terminalOutputType().getCode())
                .set(AgentRun::getStatus, request.terminalStatus().name())
                .set(AgentRun::getFinishedAt, databaseNow)
                .set(AgentRun::getErrorCode,
                        request.errorCode() == null ? null : request.errorCode().getCode())
                .set(AgentRun::getErrorMessage, request.errorMessage())
                .set(AgentRun::getWaitingReplyId, null)
                .set(AgentRun::getWaitingToolCallId, null)
                .set(AgentRun::getWaitingToolName, null)
                .set(AgentRun::getWaitExpiresAt, null)
                .set(AgentRun::getUpdateTime, databaseNow));
        if (updated != 1) {
            throw new IllegalStateException(
                    "Agent terminal update did not affect exactly one row");
        }
        usageMapper.finishAllStartedForRun(
                run.getRunId(),
                request.terminalStatus() == AgentRunStatus.CANCELLED
                        ? AgentModelCallStatus.CANCELLED.name()
                        : AgentModelCallStatus.FAILED.name(),
                databaseNow);
        return toCommitted(inserted, safeEnvelope, databaseNow);
    }

    private AgentEvent insertEvent(
            AgentRun run,
            long sequence,
            AgentEventEnvelope envelope,
            LocalDateTime databaseNow) {
        boolean publishRequired = envelope.outputType() != null;
        AgentEvent row = AgentEvent.builder()
                .runId(run.getRunId())
                // 运行期落库多在系统模式（跳过行级注入），租户/应用归属必须
                // 显式取自运行行（appId 列已显式落列时拦截器不再重复注入）
                .tenantId(run.getTenantId())
                .appId(run.getAppId())
                .sequenceNo(sequence)
                .schemaVersion(1)
                .rawEventId(envelope.rawEventId())
                .rawEventType(envelope.rawEventType())
                .source(envelope.source())
                .replyId(envelope.replyId())
                .blockId(envelope.blockId())
                .toolCallId(envelope.toolCallId())
                .parentToolCallId(envelope.parentToolCallId())
                .agentName(envelope.agentName())
                .outputType(envelope.outputType())
                .payloadJson(envelope.payloadJson(objectMapper))
                .eventCreatedAt(toDatabaseTime(envelope.createdAt()))
                .publishRequired(publishRequired)
                .publishStatus(publishRequired ? "PENDING" : "NOT_REQUIRED")
                .nextPublishAttemptAt(publishRequired ? databaseNow : null)
                .createTime(databaseNow)
                .build();
        if (eventMapper.insert(row) != 1) {
            throw new IllegalStateException(
                    "Agent event insert did not affect exactly one row");
        }
        return row;
    }

    private void advanceSequence(
            AgentRun run, long nextSequence, LocalDateTime databaseNow) {
        int updated = runMapper.update(null, new LambdaUpdateWrapper<AgentRun>()
                .eq(AgentRun::getId, run.getId())
                .eq(AgentRun::getStatus, AgentRunStatus.RUNNING.name())
                .set(AgentRun::getNextSequence, nextSequence)
                .set(AgentRun::getUpdateTime, databaseNow));
        if (updated != 1) {
            throw new IllegalStateException(
                    "Agent sequence update did not affect exactly one row");
        }
    }

    private void validateTerminalIdentity(AgentRun run, AgentEventEnvelope envelope) {
        if (run.getParentRunId() == null) {
            if (envelope.parentToolCallId() != null || envelope.agentName() != null) {
                throw new IllegalArgumentException(
                        "Root terminal envelope must not carry child identity");
            }
        } else if (!Objects.equals(run.getParentToolCallId(), envelope.parentToolCallId())
                || !Objects.equals(run.getAgentName(), envelope.agentName())) {
            throw new IllegalArgumentException(
                    "Child terminal envelope identity does not match the run");
        }
    }

    private CommittedAgentEvent toCommitted(
            AgentEvent row,
            AgentEventEnvelope envelope,
            LocalDateTime databaseNow) {
        return new CommittedAgentEvent(
                row.getId(), row.getRunId(), row.getSequenceNo(), envelope,
                databaseNow.toInstant(ZoneOffset.UTC));
    }

    private CommittedAgentEvent toCommitted(AgentEvent row) {
        AgentEventEnvelope envelope = new AgentEventEnvelope(
                row.getRawEventId(),
                row.getRawEventType(),
                row.getSource(),
                row.getReplyId(),
                row.getBlockId(),
                row.getToolCallId(),
                row.getParentToolCallId(),
                row.getAgentName(),
                row.getOutputType(),
                replayPayload(row),
                requireDatabaseInstant(row.getEventCreatedAt(), "eventCreatedAt", row));
        return new CommittedAgentEvent(
                requirePositive(row.getId(), "id", row),
                row.getRunId(),
                requirePositive(row.getSequenceNo(), "sequenceNo", row),
                envelope,
                requireDatabaseInstant(row.getCreateTime(), "createTime", row));
    }

    private JsonNode replayPayload(AgentEvent row) {
        if (row.getPayloadJson() == null) {
            throw new IllegalStateException(
                    "Agent event payload is missing: eventId=" + row.getId());
        }
        try {
            JsonNode payload = objectMapper.readTree(row.getPayloadJson());
            if (payload == null) {
                throw new IllegalStateException(
                        "Agent event payload is empty: eventId=" + row.getId());
            }
            return payload;
        } catch (JsonProcessingException invalidPayload) {
            throw new IllegalStateException(
                    "Agent event payload is invalid: eventId=" + row.getId(),
                    invalidPayload);
        }
    }

    private Instant requireDatabaseInstant(
            LocalDateTime value, String field, AgentEvent row) {
        if (value == null) {
            throw new IllegalStateException(
                    "Agent event " + field + " is missing: eventId=" + row.getId());
        }
        return value.toInstant(ZoneOffset.UTC);
    }

    private long requirePositive(Long value, String field, AgentEvent row) {
        if (value == null || value <= 0) {
            throw new IllegalStateException(
                    "Agent event " + field + " is invalid: eventId=" + row.getId());
        }
        return value;
    }

    private IllegalStateException replayGap(
            String runId, long expected, Long actual) {
        return new IllegalStateException(
                "Committed Agent event sequence gap: runId=" + runId
                        + ", expected=" + expected
                        + (actual == null ? "" : ", actual=" + actual));
    }

    private long requireNextSequence(AgentRun run) {
        Long sequence = run.getNextSequence();
        if (sequence == null || sequence < 1) {
            throw new IllegalStateException(
                    "Agent run has an invalid next sequence: " + run.getRunId());
        }
        return sequence;
    }

    private AgentRunStatus parseStatus(String status) {
        try {
            return AgentRunStatus.valueOf(status);
        } catch (RuntimeException invalid) {
            throw new IllegalStateException("Agent run has an invalid status: " + status, invalid);
        }
    }

    private void requireOwnerArguments(
            String runId, String ownerInstanceId, long ownerEpoch) {
        requireRunId(runId);
        if (ownerInstanceId == null || ownerInstanceId.isBlank()) {
            throw new IllegalArgumentException("ownerInstanceId must not be blank");
        }
        if (ownerEpoch <= 0) {
            throw new IllegalArgumentException("ownerEpoch must be positive");
        }
    }

    private String requireRunId(String runId) {
        if (runId == null || runId.isBlank()) {
            throw new IllegalArgumentException("runId must not be blank");
        }
        return runId;
    }

    private AgentEventEnvelope sanitize(AgentEventEnvelope envelope) {
        return new AgentEventEnvelope(
                envelope.rawEventId(),
                envelope.rawEventType(),
                envelope.source(),
                envelope.replyId(),
                envelope.blockId(),
                envelope.toolCallId(),
                envelope.parentToolCallId(),
                envelope.agentName(),
                envelope.outputType(),
                sanitizer.sanitize(envelope.payload()),
                envelope.createdAt());
    }

    private LocalDateTime toDatabaseTime(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
