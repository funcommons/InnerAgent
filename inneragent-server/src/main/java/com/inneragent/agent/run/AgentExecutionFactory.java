package com.inneragent.agent.run;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.model.entity.AiModel;
import com.inneragent.model.config.AiModelService;
import com.inneragent.agent.kernel.AgentScopeModelFactory;
import com.inneragent.agent.kernel.AgentScopeToolAdapter;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.context.AgentScopeRuntimeContextFactory;
import com.inneragent.agent.context.AgentScopeRuntimeContextRequest;
import com.inneragent.agent.context.ToolPermissionContext;
import com.inneragent.agent.kernel.AgentKernelSpec;
import com.inneragent.agent.kernel.AgentKernelSpecFactory;
import com.inneragent.agent.kernel.AgentScopeHarnessInvoker;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.platform.service.ai.model.AiModelMetadataResolver;
import com.inneragent.platform.service.ai.model.AiModelRequestOptions;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import com.inneragent.agent.run.kernel.AgentKernelSnapshotPayload;
import com.inneragent.agent.run.kernel.CanonicalAgentKernelSnapshotBuilder;
import com.inneragent.agent.run.kernel.PersistedAgentKernelSnapshotResolver;
import com.inneragent.agent.run.kernel.RunConfigUnavailableException;
import com.inneragent.agent.run.kernel.ToolManifestSnapshot;
import com.inneragent.agent.run.model.AgentEventEnvelope;
import com.inneragent.agent.run.model.PendingConfirmation;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.event.AgentEvent;
import io.agentscope.core.event.RequireUserConfirmEvent;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.ToolUseBlock;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.time.Duration;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;

@Component
public final class AgentExecutionFactory {

    private final AgentScopeHarnessInvoker harnessInvoker;
    private final AgentScopeRuntimeContextFactory runtimeContextFactory;
    private final AgentScopeEventMapper eventMapper;
    private final AiModelService modelService;
    private final AgentScopeModelFactory modelFactory;
    private final AgentRuntimeSchedulers schedulers;
    private final PersistedAgentKernelSnapshotResolver snapshotResolver;
    private final AiModelMetadataResolver modelMetadataResolver;
    private final ObjectMapper objectMapper;
    private final AgentKernelSpecFactory specFactory;
    private final Duration confirmationTimeout;

    public AgentExecutionFactory(
            AgentScopeHarnessInvoker harnessInvoker,
            AgentScopeRuntimeContextFactory runtimeContextFactory,
            AgentScopeEventMapper eventMapper,
            AiModelService modelService,
            AgentScopeModelFactory modelFactory,
            AgentRuntimeSchedulers schedulers,
            AiModelMetadataResolver modelMetadataResolver,
            ObjectMapper objectMapper,
            AgentKernelSpecFactory specFactory,
            AgentScopeV2Properties properties) {
        this.harnessInvoker = Objects.requireNonNull(harnessInvoker, "harnessInvoker must not be null");
        this.runtimeContextFactory = Objects.requireNonNull(
                runtimeContextFactory, "runtimeContextFactory must not be null");
        this.eventMapper = Objects.requireNonNull(eventMapper, "eventMapper must not be null");
        this.modelService = Objects.requireNonNull(modelService, "modelService must not be null");
        this.modelFactory = Objects.requireNonNull(modelFactory, "modelFactory must not be null");
        this.schedulers = Objects.requireNonNull(schedulers, "schedulers must not be null");
        this.modelMetadataResolver = Objects.requireNonNull(
                modelMetadataResolver, "modelMetadataResolver must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.specFactory = Objects.requireNonNull(specFactory, "specFactory must not be null");
        this.confirmationTimeout = Objects.requireNonNull(
                properties, "properties must not be null")
                .getExecution()
                .getConfirmationTimeout();
        this.snapshotResolver = new PersistedAgentKernelSnapshotResolver(this.objectMapper);
    }

    public Mono<AgentExecution> start(
            String runId,
            String ownerInstanceId,
            long ownerEpoch,
            String stateSessionId,
            List<Msg> messages,
            AgentKernelSpec spec,
            AgentScopeRuntimeContextRequest runtimeRequest,
            Instant deadline) {
        return Mono.fromSupplier(() -> {
            requireRuntimeIdentity(
                    runId, ownerInstanceId, ownerEpoch,
                    stateSessionId, deadline, runtimeRequest);
            RuntimeContext runtimeContext = runtimeContextFactory.create(runtimeRequest);
            AgentRunContext run = runtimeRequest.run();
            return new AgentExecution(
                    runId,
                    ownerInstanceId,
                    ownerEpoch,
                    runtimeRequest.authenticatedUser().userId(),
                    stateSessionId,
                    runtimeRequest.parentRun(),
                    harnessInvoker.streamEvents(spec, List.copyOf(messages), runtimeContext)
                            .map(event -> mapConfirmationCandidate(
                                    event, run.deadline(),
                                    runtimeRequest.authenticatedUser().userId(),
                                    runtimeRequest.toolPermission()))
                            .map(event -> childIdentity(event, run)),
                    ignored -> Mono.empty(),
                    () -> { });
        });
    }

    private AgentEventEnvelope mapConfirmationCandidate(
            AgentEvent event, Instant deadline, long userId,
            ToolPermissionContext toolPermission) {
        AgentEventEnvelope mapped = eventMapper.map(event);
        if (!(event instanceof RequireUserConfirmEvent confirmation)) {
            return mapped;
        }
        PendingConfirmation candidate = confirmationCandidate(
                confirmation, mapped.payload(), userId, toolPermission);
        ObjectNode payload = mapped.payload().deepCopy();
        ObjectNode candidatePayload = JsonNodeFactory.instance.objectNode()
                .put("replyId", candidate.replyId())
                .put("pendingToolCallsJson", candidate.pendingToolCallsJson())
                .put("suspendedToolCallsJson", candidate.suspendedToolCallsJson())
                .put("expiresAt", candidate.expiresAt().toString());
        ArrayNode decisionIds = JsonNodeFactory.instance.arrayNode();
        candidate.decisionIds().stream().sorted().forEach(decisionIds::add);
        candidatePayload.set("decisionIds", decisionIds);
        payload.set("_platformConfirmationCandidate", candidatePayload);
        return new AgentEventEnvelope(
                mapped.rawEventId(),
                mapped.rawEventType(),
                mapped.source(),
                mapped.replyId(),
                mapped.blockId(),
                mapped.toolCallId(),
                mapped.parentToolCallId(),
                mapped.agentName(),
                mapped.outputType(),
                payload,
                mapped.createdAt());
    }

    PendingConfirmation confirmationCandidate(
            RequireUserConfirmEvent event, JsonNode sanitizedPayload, long userId,
            ToolPermissionContext toolPermission) {
        if (event.getReplyId() == null || event.getReplyId().isBlank()
                || event.getToolCalls().isEmpty()) {
            throw new IllegalStateException(
                    "AgentScope confirmation event has no actionable tool calls");
        }
        ArrayNode previews = JsonNodeFactory.instance.arrayNode();
        JsonNode sanitizedCalls = sanitizedPayload.path("toolCalls");
        if (!sanitizedCalls.isArray()
                || sanitizedCalls.size() != event.getToolCalls().size()) {
            throw new IllegalStateException(
                    "Sanitized AgentScope confirmation calls do not match the source event");
        }
        JsonNode scope = scopeNode(toolPermission);
        Set<String> decisionIds = new LinkedHashSet<>();
        for (int index = 0; index < event.getToolCalls().size(); index++) {
            ToolUseBlock toolCall = event.getToolCalls().get(index);
            if (toolCall.getId() == null || toolCall.getId().isBlank()
                    || toolCall.getName() == null || toolCall.getName().isBlank()
                    || !decisionIds.add(toolCall.getId())) {
                throw new IllegalStateException(
                        "AgentScope confirmation event contains invalid tool identity");
            }
            JsonNode sanitizedInput = sanitizedCalls.get(index).get("input");
            if (sanitizedInput == null) {
                throw new IllegalStateException(
                        "Sanitized AgentScope confirmation call has no input");
            }
            String argumentsPreview = writeJson(sanitizedInput);
            if (argumentsPreview.length() > 2048) {
                argumentsPreview = argumentsPreview.substring(0, 2048) + "…";
            }
            ObjectNode preview = JsonNodeFactory.instance.objectNode()
                    .put("toolCallId", toolCall.getId())
                    .put("toolName", toolCall.getName())
                    .put("argumentsPreview", argumentsPreview);
            // [adapt] P2-scope 任务 #15:约束范围可检视(PRD §6.1.4)——每项挂 run 级
            // scope 标记,随候选持久化并向 USER_CONFIRMATION_REQUIRED/过期重发/决策
            // 事件 verbatim 透传;平台当前 scope 为会话级,批内各项取值一致
            preview.set("scope", scope.deepCopy());
            // [adapt] ToolModificationPlanService 依赖 Project/Storyboard 业务域,未移植;
            // 确认预览中的 "plan" 节点(工具改动计划摘要)随域裁剪,其余确认语义不变
            previews.add(preview);
        }
        return new PendingConfirmation(
                event.getReplyId(),
                decisionIds,
                writeJson(previews),
                writeJson(suspendedToolCalls(event.getToolCalls())),
                Instant.now().plus(confirmationTimeout));
    }

    /**
     * [adapt] P2-scope 任务 #15:run 级约束范围标记(PRD §6.1.4)。
     *
     * <p>来源是该 run 的 {@code ToolPermissionContext.scopeDegraded}(目录聚合判定:
     * 宿主未实现 resolve_scope 反查 → 降级)。安全侧缺省:权限上下文取不到
     * (null/装配缺失)时按降级处理 —— 无上下文提示 + 写操作一律逐次确认。
     * 平台当前未留存运行级已解析 scope 载荷,{@code summary} 仅在降级时携带
     * 稳定原因文案;resolved 形态省略 summary(字段可选,前端不依赖)。
     */
    static JsonNode scopeNode(ToolPermissionContext toolPermission) {
        ObjectNode scope = JsonNodeFactory.instance.objectNode();
        if (toolPermission == null) {
            // 安全侧缺省:拿不到权限上下文 → degraded=true(写操作强制逐次确认)
            return scope.put("resolved", false).put("degraded", true);
        }
        if (toolPermission.scopeDegraded()) {
            return scope
                    .put("resolved", false)
                    .put("degraded", true)
                    .put("summary",
                            "宿主未实现约束范围反查(resolve_scope),本次运行无约束范围上下文");
        }
        return scope.put("resolved", true).put("degraded", false);
    }

    private ArrayNode suspendedToolCalls(List<ToolUseBlock> toolCalls) {
        ArrayNode suspended = JsonNodeFactory.instance.arrayNode();
        for (ToolUseBlock toolCall : toolCalls) {
            ObjectNode value = JsonNodeFactory.instance.objectNode()
                    .put("id", toolCall.getId())
                    .put("name", toolCall.getName())
                    .put("state", toolCall.getState().name());
            value.set("input", objectMapper.valueToTree(toolCall.getInput()));
            value.set("metadata", objectMapper.valueToTree(toolCall.getMetadata()));
            if (toolCall.getContent() != null) {
                value.put("content", toolCall.getContent());
            }
            suspended.add(value);
        }
        return suspended;
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException(
                    "Failed to serialize AgentScope confirmation state", failure);
        }
    }

    private AgentEventEnvelope childIdentity(
            AgentEventEnvelope event, AgentRunContext run) {
        if (!run.childRun()) {
            return event;
        }
        return new AgentEventEnvelope(
                event.rawEventId(),
                event.rawEventType(),
                event.source(),
                event.replyId(),
                event.blockId(),
                event.toolCallId(),
                run.parentToolCallId(),
                run.agentName(),
                event.outputType(),
                event.payload(),
                event.createdAt());
    }

    /** Rehydrates only an exact, currently available no-tool kernel; other states fail closed. */
    public Mono<AgentKernelSpec> resolve(AgentKernelSnapshot snapshot) {
        AgentKernelSnapshot safeSnapshot = Objects.requireNonNull(
                snapshot, "snapshot must not be null");
        return Mono.fromCallable(() -> resolveBlocking(safeSnapshot))
                .subscribeOn(schedulers.modelBlocking());
    }

    private AgentKernelSpec resolveBlocking(AgentKernelSnapshot snapshot) {
        AgentKernelSnapshotPayload payload = snapshot.payload();
        long modelId;
        try {
            modelId = Long.parseLong(payload.modelConfigId());
        } catch (NumberFormatException invalidId) {
            throw unavailable("Persisted model configuration identity is invalid");
        }
        AiModel model = modelService.getById(modelId);
        if (model == null || !Integer.valueOf(1).equals(model.getStatus())) {
            throw unavailable("Persisted model configuration is unavailable");
        }
        String modelFingerprint = modelFactory.modelConfigFingerprint(model);
        long modelVersion = CanonicalAgentKernelSnapshotBuilder.modelConfigVersion(modelFingerprint);
        if (modelVersion != payload.modelConfigVersion()) {
            try {
                model = AiModelRequestOptions.withReasoningEffort(
                        model,
                        AiModelRequestOptions.reasoningEffort(payload.modelOptions()),
                        objectMapper);
            } catch (BusinessException invalidEffort) {
                throw unavailable("Persisted reasoning effort is no longer available");
            }
            modelFingerprint = modelFactory.modelConfigFingerprint(model);
            modelVersion = CanonicalAgentKernelSnapshotBuilder.modelConfigVersion(modelFingerprint);
        }
        AgentKernelSpec restored;
        try {
            restored = specFactory.restore(payload, model, modelFingerprint);
        } catch (RuntimeException unavailableTool) {
            throw unavailable(unavailableTool.getMessage());
        }
        List<ToolManifestSnapshot> currentTools = restored.toolManifest().stream()
                .map(tool -> new ToolManifestSnapshot(
                        tool.toolName(),
                        tool.schemaSha256(),
                        tool.readOnly(),
                        tool.concurrencySafe(),
                        restored.toolWhitelistVersion()))
                .toList();
        AgentKernelSnapshot validated = snapshotResolver.resolve(
                snapshot.snapshotJson(), snapshot.fingerprint(), modelVersion, currentTools);
        requireSameModel(validated.payload(), model);
        return restored;
    }

    private void requireSameModel(AgentKernelSnapshotPayload payload, AiModel model) {
        if (!Objects.equals(payload.modelCode(), model.getCode())
                || !payload.provider().equals(provider(model))) {
            throw unavailable("Persisted model configuration no longer matches the snapshot");
        }
    }

    private String provider(AiModel model) {
        String protocol = modelMetadataResolver.resolve(model).modelProtocol();
        return protocol == null ? "" : protocol.trim();
    }

    private void requireRuntimeIdentity(
            String runId,
            String ownerInstanceId,
            long ownerEpoch,
            String stateSessionId,
            Instant deadline,
            AgentScopeRuntimeContextRequest request) {
        AgentRunContext run = Objects.requireNonNull(request, "runtimeRequest must not be null").run();
        if (!Objects.equals(runId, run.runId())
                || !Objects.equals(ownerInstanceId, run.ownerInstanceId())
                || ownerEpoch != run.ownerEpoch()
                || !Objects.equals(
                        stateSessionId,
                        request.conversation().agentStateSessionId())
                || !Objects.equals(deadline, run.deadline())) {
            throw new IllegalArgumentException(
                    "RuntimeContext run identity does not match durable execution ownership");
        }
        if (run.childRun()) {
            if (request.parentRun() == null
                    || !Objects.equals(
                            run.parentToolCallId(), request.parentRun().toolCallId())
                    || !Objects.equals(run.agentName(), request.parentRun().agentName())) {
                throw new IllegalArgumentException(
                        "Child RuntimeContext must carry its durable parent run identity");
            }
        } else if (request.parentRun() != null) {
            throw new IllegalArgumentException(
                    "Root RuntimeContext must not carry a parent run identity");
        }
    }

    private RunConfigUnavailableException unavailable(String message) {
        return new RunConfigUnavailableException(message);
    }
}
