package com.inneragent.agent.run;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import com.inneragent.server.controller.vo.ToolConfirmationReqVO;
import com.inneragent.agent.kernel.AgentKernelSpecFactory;
import com.inneragent.agent.permission.ToolExecutionMode;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import com.inneragent.agent.run.kernel.AgentKernelSnapshotBuilder;
import com.inneragent.agent.run.kernel.AgentKernelSnapshotPayload;
import com.inneragent.agent.run.model.PendingConfirmation;
import com.inneragent.agent.run.model.ResumeAgentExecutionCommand;
import com.inneragent.agent.run.model.ResumeConfirmationCommand;
import com.inneragent.agent.run.model.ResumedAgentRun;
import io.agentscope.core.event.ConfirmResult;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.ToolUseBlock;
import io.agentscope.core.message.ToolCallState;
import io.agentscope.core.message.UserMessage;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Authorizes, durably claims, and resumes a user-confirmed AgentScope tool pause.
 *
 * <p>[adapt] U1/D3:确认决策实弹审计接线(V22)——批准/拒绝在决策生效前逐工具
 * 追加 {@code ia_audit_log}(decision=allowed/denied,decision_source=live-confirm,
 * run_id/tool_fqn/入参快照),失败即业务失败(fail-closed,决策不生效)。
 */
@Service
public final class AgentConfirmationService {

    private static final TypeReference<Map<String, Object>> OBJECT_MAP = new TypeReference<>() { };

    private static final String DECISION_ALLOWED = "allowed";
    private static final String DECISION_DENIED = "denied";

    private final AgentWaitingStatePort waitingState;
    private final AgentExecutionRuntimeContextRequests runtimeContexts;
    private final RunExecutionSupervisor supervisor;
    private final AgentKernelSnapshotBuilder snapshotBuilder;
    private final AgentRuntimeInstanceIdentity instanceIdentity;
    private final AgentScopeV2Properties properties;
    private final ObjectMapper objectMapper;
    /**
     * [adapt] U1/D3:确认流实弹审计写入口(V22:decision_source=live-confirm)。
     * riskLevel 经工具目录(可选依赖)按工具名/FQN 反查;内置工具无目录行落 null。
     */
    private final ToolAuditService audits;
    private final ObjectProvider<com.inneragent.agent.mcp.McpToolCatalog> toolCatalogs;
    /** [adapt] IA-3 确认终态业务计数(ia_confirmation_total;P4 差距收口)。 */
    private final com.inneragent.platform.metrics.IaBusinessMetrics metrics;

    public AgentConfirmationService(
            AgentWaitingStatePort waitingState,
            AgentExecutionRuntimeContextRequests runtimeContexts,
            RunExecutionSupervisor supervisor,
            AgentKernelSnapshotBuilder snapshotBuilder,
            AgentRuntimeInstanceIdentity instanceIdentity,
            AgentScopeV2Properties properties,
            ObjectMapper objectMapper,
            ToolAuditService audits,
            ObjectProvider<com.inneragent.agent.mcp.McpToolCatalog> toolCatalogs,
            com.inneragent.platform.metrics.IaBusinessMetrics metrics) {
        this.waitingState = Objects.requireNonNull(waitingState, "waitingState must not be null");
        this.runtimeContexts = Objects.requireNonNull(
                runtimeContexts, "runtimeContexts must not be null");
        this.supervisor = Objects.requireNonNull(supervisor, "supervisor must not be null");
        this.snapshotBuilder = Objects.requireNonNull(
                snapshotBuilder, "snapshotBuilder must not be null");
        this.instanceIdentity = Objects.requireNonNull(
                instanceIdentity, "instanceIdentity must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.audits = Objects.requireNonNull(audits, "audits must not be null");
        this.toolCatalogs = Objects.requireNonNull(toolCatalogs, "toolCatalogs must not be null");
        this.metrics = metrics == null
                ? com.inneragent.platform.metrics.IaBusinessMetrics.noop()
                : metrics;
    }

    public Mono<Void> respond(ToolConfirmationReqVO request, long currentUserId) {
        ToolConfirmationReqVO safeRequest = Objects.requireNonNull(
                request, "request must not be null");
        String runId = requireText(safeRequest.getRunId(), "runId");
        String replyId = requireText(safeRequest.getReplyId(), "replyId");
        Map<String, Boolean> decisions = decisions(safeRequest.getDecisions());

        return waitingState.getPendingConfirmationAuthorized(
                        runId, currentUserId, replyId)
                .flatMap(pending -> resume(
                        pending, decisions, runId, replyId, currentUserId));
    }

    private Mono<Void> resume(
            PendingConfirmation pending,
            Map<String, Boolean> decisions,
            String runId,
            String replyId,
            long currentUserId) {
        if (!pending.decisionIds().equals(decisions.keySet())) {
            return Mono.error(new BusinessException(
                    409, "确认决定与当前待审批工具不一致"));
        }
        List<ToolUseBlock> toolCalls = suspendedToolCalls(pending);
        Map<String, ToolUseBlock> byId = new LinkedHashMap<>();
        for (ToolUseBlock toolCall : toolCalls) {
            if (toolCall.getId() == null || toolCall.getId().isBlank()
                    || byId.putIfAbsent(toolCall.getId(), toolCall) != null) {
                return Mono.error(new IllegalStateException(
                        "Persisted confirmation contains invalid tool identities"));
            }
        }
        if (!byId.keySet().equals(pending.decisionIds())) {
            return Mono.error(new IllegalStateException(
                    "Persisted confirmation tool calls do not match decision identities"));
        }
        List<ConfirmResult> results = toolCalls.stream()
                .map(toolCall -> new ConfirmResult(
                        decisions.get(toolCall.getId()), toolCall))
                .toList();
        // [adapt] U1/D3:决策生效前落审计(fail-closed:审计写入失败即抛出,
        // 中止本次确认,决策不生效)。批准与拒绝双路径均逐工具追加。
        auditDecisions(runId, currentUserId, decisions, toolCalls);
        Msg resumeMessage = UserMessage.builder()
                .metadata(Map.of(Msg.METADATA_CONFIRM_RESULTS, results))
                .build();
        ResumeConfirmationCommand transition = new ResumeConfirmationCommand(
                runId,
                currentUserId,
                replyId,
                Set.copyOf(decisions.keySet()),
                decisions,
                instanceIdentity.value(),
                properties.getExecution().getOwnerLease());
        return waitingState.resumeConfirmation(transition)
                .flatMap(resumed -> launchResume(resumed, resumeMessage));
    }

    /**
     * [adapt] U1/D3:确认决策逐工具追加 ia_audit_log(V22)。
     * decision=allowed/denied;decision_source=live-confirm(V22 裁定:确认流
     * 实弹决策由运行侧落库);conversationId 在确认载荷中不可得,留空。
     *
     * <p>[adapt] IA-3 业务计数与审计同点位、逐工具一比一
     * ({@code ia_confirmation_total{app,decision,source}};
     * decision 用大盘契约值域 approved/rejected,source=live-confirm)。
     */
    private void auditDecisions(
            String runId,
            long currentUserId,
            Map<String, Boolean> decisions,
            List<ToolUseBlock> toolCalls) {
        long appId = AppContext.currentOrDefault();
        for (ToolUseBlock toolCall : toolCalls) {
            Boolean approved = decisions.get(toolCall.getId());
            if (approved == null) {
                continue;
            }
            metrics.confirmation(appId,
                    approved
                            ? com.inneragent.platform.metrics.IaBusinessMetrics.DECISION_APPROVED
                            : com.inneragent.platform.metrics.IaBusinessMetrics.DECISION_REJECTED,
                    ToolDecisionSource.LIVE_CONFIRM.code());
            audits.append(new ToolAuditService.ToolAuditEntry(
                    appId,
                    null,
                    currentUserId,
                    null,
                    runId,
                    toolCall.getName(),
                    approved ? DECISION_ALLOWED : DECISION_DENIED,
                    ToolDecisionSource.LIVE_CONFIRM.code(),
                    catalogRiskLevel(toolCall.getName()),
                    paramsJson(toolCall),
                    null,
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
        return catalog.find(AppContext.currentOrDefault(), toolNameOrFqn)
                .map(com.inneragent.agent.mcp.McpToolCatalogEntry::riskLevel)
                .orElse(null);
    }

    /** 确认时的工具入参快照(敏感打码由调用方负责;序列化失败退化为字符串视图)。 */
    private String paramsJson(ToolUseBlock toolCall) {
        try {
            return objectMapper.writeValueAsString(toolCall.getInput());
        } catch (JsonProcessingException serializationFailure) {
            return String.valueOf(toolCall.getInput());
        }
    }

    private Mono<Void> launchResume(ResumedAgentRun resumed, Msg resumeMessage) {
        AgentKernelSnapshot snapshot = snapshot(resumed);
        ToolExecutionMode toolExecutionMode = ToolExecutionMode.parse(
                snapshot.payload().promptVariables().get(
                        AgentKernelSpecFactory.TOOL_EXECUTION_MODE_VARIABLE));
        return runtimeContexts.forResume(
                        resumed,
                        snapshot.payload().agentDefinitionStableKey(),
                        toolExecutionMode)
                .flatMap(runtime -> supervisor.resume(new ResumeAgentExecutionCommand(
                        resumed, List.of(resumeMessage), snapshot, runtime)));
    }

    private AgentKernelSnapshot snapshot(ResumedAgentRun resumed) {
        try {
            JsonNode root = objectMapper.readTree(resumed.agentDefinitionSnapshotJson());
            AgentKernelSnapshotPayload payload = objectMapper.treeToValue(
                    root, AgentKernelSnapshotPayload.class);
            AgentKernelSnapshot snapshot = snapshotBuilder.build(payload);
            if (!snapshot.fingerprint().equals(resumed.kernelFingerprint())) {
                throw new IllegalStateException(
                        "Persisted resume snapshot fingerprint does not match its payload");
            }
            return snapshot;
        } catch (JsonProcessingException invalidSnapshot) {
            throw new IllegalStateException(
                    "Persisted resume snapshot is invalid", invalidSnapshot);
        }
    }

    private List<ToolUseBlock> suspendedToolCalls(PendingConfirmation pending) {
        try {
            JsonNode parsed = objectMapper.readTree(pending.suspendedToolCallsJson());
            if (!(parsed instanceof ArrayNode array) || array.isEmpty()) {
                throw new IllegalStateException(
                        "Persisted confirmation has no suspended tool calls");
            }
            List<ToolUseBlock> calls = new ArrayList<>();
            for (JsonNode value : array) {
                Map<String, Object> input = objectMap(value.path("input"));
                Map<String, Object> metadata = restoreMetadata(
                        objectMap(value.path("metadata")));
                String state = requireNodeText(value, "state");
                calls.add(new ToolUseBlock(
                        requireNodeText(value, "id"),
                        requireNodeText(value, "name"),
                        input,
                        value.hasNonNull("content") ? value.get("content").asText() : null,
                        metadata,
                        ToolCallState.valueOf(state)));
            }
            return List.copyOf(calls);
        } catch (JsonProcessingException | IllegalArgumentException invalidCalls) {
            throw new IllegalStateException(
                    "Persisted suspended tool calls are invalid", invalidCalls);
        }
    }

    private Map<String, Object> objectMap(JsonNode value) {
        if (!value.isObject()) {
            throw new IllegalArgumentException("Persisted tool call map is invalid");
        }
        return objectMapper.convertValue(value, OBJECT_MAP);
    }

    private Map<String, Object> restoreMetadata(Map<String, Object> metadata) {
        Object signature = metadata.get(ToolUseBlock.METADATA_THOUGHT_SIGNATURE);
        if (!(signature instanceof String encoded)) {
            return metadata;
        }
        Map<String, Object> restored = new LinkedHashMap<>(metadata);
        restored.put(
                ToolUseBlock.METADATA_THOUGHT_SIGNATURE,
                Base64.getDecoder().decode(encoded));
        return Map.copyOf(restored);
    }

    private String requireNodeText(JsonNode value, String field) {
        JsonNode node = value.get(field);
        if (node == null || !node.isTextual() || node.textValue().isBlank()) {
            throw new IllegalArgumentException("Persisted tool call is missing " + field);
        }
        return node.textValue();
    }

    private Map<String, Boolean> decisions(List<ToolConfirmationReqVO.DecisionVO> values) {
        if (values == null || values.isEmpty()) {
            throw new BusinessException(400, "确认决定不能为空");
        }
        Map<String, Boolean> result = new LinkedHashMap<>();
        for (ToolConfirmationReqVO.DecisionVO value : values) {
            if (value == null || value.getApproved() == null) {
                throw new BusinessException(400, "每个工具都必须明确允许或拒绝");
            }
            String toolCallId = requireText(value.getToolCallId(), "toolCallId");
            if (result.putIfAbsent(toolCallId, value.getApproved()) != null) {
                throw new BusinessException(400, "工具确认决定不能重复");
            }
        }
        return Map.copyOf(result);
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new BusinessException(400, field + " 不能为空");
        }
        return value.trim();
    }
}
