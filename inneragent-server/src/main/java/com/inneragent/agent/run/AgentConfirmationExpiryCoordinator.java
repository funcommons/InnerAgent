package com.inneragent.agent.run;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.platform.common.BusinessException;
import org.springframework.beans.factory.ObjectProvider;
import com.inneragent.agent.entity.AgentEvent;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.platform.enums.ai.AgentTerminalOutputType;
import com.inneragent.agent.mapper.AgentEventMapper;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.state.StateStoreSlot;
import com.inneragent.agent.run.model.AgentEventEnvelope;
import com.inneragent.agent.run.model.RunTerminalRequest;
import com.inneragent.agent.run.model.SystemTerminalActor;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Ends an expired confirmation when application code observes its deadline.
 *
 * <p>[adapt] P2-srv U1 遗留补强:过期裁决写审计 —— 语义裁定
 * <strong>过期 = denied,decision_source 独立值 {@code expired}</strong>
 * ({@link com.inneragent.platform.toolhub.ToolDecisionSource#EXPIRED}),
 * 与用户实弹确认(live-confirm)区分,高危「100% 确认」审计可证明超时
 * 未发生用户批准。逐工具在终止决策前追加 {@code ia_audit_log},失败即业务失败
 * (fail-closed,过期终止不生效,与确认流 U1/D3 同口径)。
 */
@Component
public final class AgentConfirmationExpiryCoordinator {

    public static final String REASON = "CONFIRMATION_EXPIRED";
    public static final String MESSAGE = "审批时间已结束，相关操作未执行。";

    private static final String DECISION_DENIED = "denied";

    private final AgentRunMapper runMapper;
    private final AgentEventMapper eventMapper;
    private final ObjectMapper objectMapper;
    private final RunTerminalCoordinator terminals;
    private final AgentMessageProjectionService projections;
    private final AgentEventEnvelopeSanitizer sanitizer;
    private final AgentRuntimeSchedulers schedulers;
    private final com.inneragent.platform.toolhub.ToolAuditService audits;
    private final ObjectProvider<com.inneragent.agent.mcp.McpToolCatalog> toolCatalogs;
    /** [adapt] IA-3 过期终态业务计数(ia_confirmation_total;P4 差距收口)。 */
    private final com.inneragent.platform.metrics.IaBusinessMetrics metrics;

    public AgentConfirmationExpiryCoordinator(
            AgentRunMapper runMapper,
            AgentEventMapper eventMapper,
            ObjectMapper objectMapper,
            RunTerminalCoordinator terminals,
            AgentMessageProjectionService projections,
            AgentEventEnvelopeSanitizer sanitizer,
            AgentRuntimeSchedulers schedulers,
            com.inneragent.platform.toolhub.ToolAuditService audits,
            ObjectProvider<com.inneragent.agent.mcp.McpToolCatalog> toolCatalogs,
            com.inneragent.platform.metrics.IaBusinessMetrics metrics) {
        this.runMapper = Objects.requireNonNull(runMapper, "runMapper must not be null");
        this.eventMapper = Objects.requireNonNull(
                eventMapper, "eventMapper must not be null");
        this.objectMapper = Objects.requireNonNull(
                objectMapper, "objectMapper must not be null");
        this.terminals = Objects.requireNonNull(terminals, "terminals must not be null");
        this.projections = Objects.requireNonNull(
                projections, "projections must not be null");
        this.sanitizer = Objects.requireNonNull(sanitizer, "sanitizer must not be null");
        this.schedulers = Objects.requireNonNull(
                schedulers, "schedulers must not be null");
        this.audits = Objects.requireNonNull(audits, "audits must not be null");
        this.toolCatalogs = Objects.requireNonNull(
                toolCatalogs, "toolCatalogs must not be null");
        this.metrics = metrics == null
                ? com.inneragent.platform.metrics.IaBusinessMetrics.noop()
                : metrics;
    }

    public Mono<Boolean> expireAuthorized(
            String runId, String replyId, long currentUserId) {
        String safeRunId = requireText(runId, "runId");
        String safeReplyId = requireText(replyId, "replyId");
        if (currentUserId <= 0) {
            return Mono.error(new IllegalArgumentException(
                    "currentUserId must be positive"));
        }
        return journal(() -> {
                    AgentRun run = runMapper.selectAuthorizedByRunId(
                            safeRunId, currentUserId);
                    if (run == null) {
                        throw new BusinessException(404, "Agent 运行不存在");
                    }
                    if (AgentRunStatus.WAITING_CONFIRMATION.name().equals(run.getStatus())
                            && !safeReplyId.equals(run.getWaitingReplyId())) {
                        throw new BusinessException(409, "该审批已处理或已失效");
                    }
                    return run;
                })
                .flatMap(this::expireIfNeeded);
    }

    public Mono<Boolean> expireIfNeeded(AgentRun run) {
        AgentRun safeRun = Objects.requireNonNull(run, "run must not be null");
        if (!AgentRunStatus.WAITING_CONFIRMATION.name().equals(safeRun.getStatus())
                || !expired(safeRun)) {
            return Mono.just(false);
        }
        return terminalRequest(safeRun)
                .flatMap(request -> terminals.terminateSystem(
                        request, SystemTerminalActor.CONFIRMATION_EXPIRER))
                .flatMap(committed -> committed
                        .map(event -> projections.projectThrough(
                                        event.runId(), event.sequence())
                                .thenReturn(true))
                        .orElseGet(() -> Mono.just(false)));
    }

    private Mono<RunTerminalRequest> terminalRequest(AgentRun run) {
        return journal(() -> {
            String replyId = requireText(run.getWaitingReplyId(), "waitingReplyId");
            AgentEvent candidate = eventMapper.selectConfirmationCandidate(
                    run.getRunId(), replyId);
            if (candidate == null) {
                throw new IllegalStateException(
                        "Expired confirmation has no durable candidate");
            }
            ArrayNode pendingToolCalls = pendingToolCalls(candidate);
            auditExpiredDecision(run, pendingToolCalls);
            ObjectNode payload = JsonNodeFactory.instance.objectNode()
                    .put("outputType", AgentTerminalOutputType.CANCELLED.name())
                    .put("cancellationReason", REASON)
                    .put("content", MESSAGE)
                    .put("finished", true);
            payload.set("pendingToolCalls", pendingToolCalls);
            AgentEventEnvelope envelope = new AgentEventEnvelope(
                    "confirmation-expired-"
                            + UUID.randomUUID().toString().replace("-", ""),
                    REASON,
                    run.getParentRunId() == null
                            ? "main"
                            : "main/" + run.getAgentName(),
                    replyId,
                    null,
                    null,
                    run.getParentToolCallId(),
                    run.getAgentName(),
                    AgentTerminalOutputType.CANCELLED.name(),
                    sanitizer.sanitize(payload),
                    Instant.now());
            return new RunTerminalRequest(
                    run.getRunId(),
                    new StateStoreSlot(
                            String.valueOf(run.getUserId()),
                            run.getAgentStateSessionId()),
                    Set.of(AgentRunStatus.WAITING_CONFIRMATION),
                    AgentRunStatus.CANCELLED,
                    AgentTerminalOutputType.CANCELLED,
                    null,
                    null,
                    envelope);
        });
    }

    private ArrayNode pendingToolCalls(AgentEvent event) {
        try {
            JsonNode payload = objectMapper.readTree(event.getPayloadJson());
            JsonNode encoded = payload == null ? null : payload.get("pendingToolCallsJson");
            if (encoded == null || !encoded.isTextual()) {
                throw new IllegalStateException(
                        "Confirmation candidate has no pending tool calls");
            }
            JsonNode parsed = objectMapper.readTree(encoded.textValue());
            if (!(parsed instanceof ArrayNode array) || array.isEmpty()) {
                throw new IllegalStateException(
                        "Confirmation candidate pending tool calls are invalid");
            }
            return array;
        } catch (JsonProcessingException invalidJson) {
            throw new IllegalStateException(
                    "Confirmation candidate pending tool calls are invalid", invalidJson);
        }
    }

    /**
     * [adapt] P2-srv U1:过期裁决逐工具追加审计(终止决策前,fail-closed)。
     * decision=denied;decision_source=expired(V8/ToolDecisionSource.EXPIRED);
     * 入参快照取待审批载荷的 argumentsPreview(写入侧已做预览/打码);
     * conversationId 取运行行。任何写入失败沿 journal 上抛,终止决策不生效。
     *
     * <p>[adapt] IA-3 业务计数与审计同点位、逐工具一比一
     * ({@code ia_confirmation_total{app,decision=expired,source=expired}})。
     */
    private void auditExpiredDecision(AgentRun run, ArrayNode pendingToolCalls) {
        long appId = com.inneragent.platform.context.AppContext.currentOrDefault();
        for (JsonNode toolCall : pendingToolCalls) {
            String toolName = toolCall.path("toolName").asText(null);
            if (toolName == null || toolName.isBlank()) {
                continue;
            }
            metrics.confirmation(appId,
                    com.inneragent.platform.metrics.IaBusinessMetrics.DECISION_EXPIRED,
                    com.inneragent.platform.toolhub.ToolDecisionSource.EXPIRED.code());
            audits.append(new com.inneragent.platform.toolhub.ToolAuditService.ToolAuditEntry(
                    appId,
                    run.getTenantId(),
                    run.getUserId(),
                    run.getConversationId(),
                    run.getRunId(),
                    toolName,
                    DECISION_DENIED,
                    com.inneragent.platform.toolhub.ToolDecisionSource.EXPIRED.code(),
                    catalogRiskLevel(toolName),
                    toolCall.path("argumentsPreview").asText(null),
                    REASON,
                    null,
                    null));
        }
    }

    /** 工具风险等级:注册目录(ia_tool_registry)可查则落目录值,否则留空。 */
    private String catalogRiskLevel(String toolNameOrFqn) {
        com.inneragent.agent.mcp.McpToolCatalog catalog = toolCatalogs.getIfAvailable();
        if (catalog == null) {
            return null;
        }
        return catalog.find(
                        com.inneragent.platform.context.AppContext.currentOrDefault(),
                        toolNameOrFqn)
                .map(com.inneragent.agent.mcp.McpToolCatalogEntry::riskLevel)
                .orElse(null);
    }

    private boolean expired(AgentRun run) {
        LocalDateTime expiresAt = run.getWaitExpiresAt();
        return expiresAt != null
                && !expiresAt.toInstant(ZoneOffset.UTC).isAfter(Instant.now());
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new BusinessException(400, field + " 不能为空");
        }
        return value.trim();
    }

    private <T> Mono<T> journal(java.util.concurrent.Callable<T> operation) {
        return Mono.fromCallable(operation)
                .subscribeOn(schedulers.journal());
    }
}
