package com.inneragent.agent.run;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.context.ToolPermissionContext;
import com.inneragent.agent.kernel.AgentKernelSpecFactory;
import com.inneragent.agent.kernel.AgentScopeModelFactory;
import com.inneragent.agent.kernel.AgentScopeHarnessInvoker;
import com.inneragent.agent.context.AgentScopeRuntimeContextFactory;
import com.inneragent.agent.permission.ToolExecutionMode;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.model.PendingConfirmation;
import com.inneragent.model.config.AiModelService;
import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.platform.service.ai.model.AiModelMetadataResolver;
import com.inneragent.server.controller.vo.AiChatStreamRespVO;
import io.agentscope.core.event.RequireUserConfirmEvent;
import io.agentscope.core.message.ToolUseBlock;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * [adapt] P2-scope 任务 #15:确认候选装配的约束范围标记(PRD §6.1.4 约束范围可检视)。
 *
 * <p>覆盖契约的两种装配形态 + 安全侧缺省 + wire 兼容(旧事件无 scope 字段):
 * <ol>
 *   <li>scopeDegraded=true(宿主未实现 resolve_scope)→ 每项
 *       {@code scope={resolved:false, degraded:true, summary:…}};</li>
 *   <li>scopeDegraded=false → {@code scope={resolved:true, degraded:false}},
 *       summary 缺省(平台未留存运行级 scope 载荷);</li>
 *   <li>权限上下文取不到(null)→ 安全侧缺省 degraded;</li>
 *   <li>USER_CONFIRMATION_REQUIRED 形态的 payload 经 VO 反序列化保留 scope;
 *       旧形态(无 scope)→ VO scope=null(前端按降级弱提示,兼容)。</li>
 * </ol>
 */
class AgentExecutionFactoryTests {

    private final ObjectMapper objectMapper = new ObjectMapper();

    private AgentExecutionFactory factory() {
        return new AgentExecutionFactory(
                mock(AgentScopeHarnessInvoker.class),
                mock(AgentScopeRuntimeContextFactory.class),
                mock(AgentScopeEventMapper.class),
                mock(AiModelService.class),
                mock(AgentScopeModelFactory.class),
                mock(AgentRuntimeSchedulers.class),
                mock(AiModelMetadataResolver.class),
                objectMapper,
                mock(AgentKernelSpecFactory.class),
                new AgentScopeV2Properties());
    }

    private RequireUserConfirmEvent confirmEvent() {
        return new RequireUserConfirmEvent("reply-scope-1", List.of(
                new ToolUseBlock("call-1", "mcp__crm__update_contact", Map.of("name", "张三")),
                new ToolUseBlock("call-2", "mcp__crm__query_contact", Map.of())));
    }

    /** AgentScopeEventMapper.map 的 sanitized payload 形态(仅确认候选消费的字段)。 */
    private JsonNode sanitizedPayload() {
        return objectMapper.valueToTree(Map.of(
                "toolCalls", List.of(
                        Map.of("input", Map.of("name", "张三")),
                        Map.of("input", Map.of("name", "张三")))));
    }

    @Test
    void degradedScopeIsEmbeddedIntoEveryPendingToolCall() {
        PendingConfirmation candidate = factory().confirmationCandidate(
                confirmEvent(),
                sanitizedPayload(),
                12993L,
                new ToolPermissionContext(ToolExecutionMode.ALWAYS_ASK, Set.of(), true));

        JsonNode tools = parsePending(candidate.pendingToolCallsJson());
        assertThat(tools).hasSize(2);
        for (JsonNode tool : tools) {
            JsonNode scope = tool.get("scope");
            assertThat(scope).isNotNull();
            assertThat(scope.path("resolved").asBoolean()).isFalse();
            assertThat(scope.path("degraded").asBoolean()).isTrue();
            assertThat(scope.path("summary").asText()).isNotBlank();
        }
    }

    @Test
    void resolvedScopeOmitsSummaryWhenPlatformHoldsNoRunScopePayload() {
        PendingConfirmation candidate = factory().confirmationCandidate(
                confirmEvent(),
                sanitizedPayload(),
                12993L,
                new ToolPermissionContext(ToolExecutionMode.DEFAULT));

        JsonNode tools = parsePending(candidate.pendingToolCallsJson());
        for (JsonNode tool : tools) {
            JsonNode scope = tool.get("scope");
            assertThat(scope).isNotNull();
            assertThat(scope.path("resolved").asBoolean()).isTrue();
            assertThat(scope.path("degraded").asBoolean()).isFalse();
            // summary 可选:resolved 形态缺省(不伪造未留存的运行级范围载荷)
            assertThat(scope.hasNonNull("summary")).isFalse();
        }
    }

    @Test
    void missingPermissionContextFailsClosedToDegraded() {
        PendingConfirmation candidate = factory().confirmationCandidate(
                confirmEvent(), sanitizedPayload(), 12993L, null);

        JsonNode tools = parsePending(candidate.pendingToolCallsJson());
        for (JsonNode tool : tools) {
            JsonNode scope = tool.get("scope");
            assertThat(scope.path("resolved").asBoolean()).isFalse();
            assertThat(scope.path("degraded").asBoolean()).isTrue();
        }
    }

    /**
     * wire 兼容矩阵:确认等待事件形态经 {@link AiChatStreamRespVO} 反序列化时
     * scope 保留;旧形态(无 scope 字段)→ null(SDK 端归一化为 degraded)。
     */
    @Test
    void wireProjectionPreservesScopeAndLegacyPayloadsRemainCompatible() throws Exception {
        JsonNode withScope = objectMapper.readTree("""
                {"pendingToolCalls":[
                  {"toolCallId":"call-1","toolName":"mcp__crm__update_contact",
                   "argumentsPreview":"{}",
                   "scope":{"resolved":false,"degraded":true,"summary":"降级"}},
                  {"toolCallId":"call-2","toolName":"mcp__crm__query_contact",
                   "argumentsPreview":"{}",
                   "scope":{"resolved":true,"degraded":false}}
                ]}""");
        AiChatStreamRespVO projected = objectMapper.convertValue(
                withScope, AiChatStreamRespVO.class);
        assertThat(projected.getPendingToolCalls()).hasSize(2);
        assertThat(projected.getPendingToolCalls().get(0).getScope().isResolved()).isFalse();
        assertThat(projected.getPendingToolCalls().get(0).getScope().isDegraded()).isTrue();
        assertThat(projected.getPendingToolCalls().get(0).getScope().getSummary())
                .isEqualTo("降级");
        assertThat(projected.getPendingToolCalls().get(1).getScope().isResolved()).isTrue();
        assertThat(projected.getPendingToolCalls().get(1).getScope().isDegraded()).isFalse();
        assertThat(projected.getPendingToolCalls().get(1).getScope().getSummary()).isNull();

        JsonNode legacy = objectMapper.readTree("""
                {"pendingToolCalls":[
                  {"toolCallId":"call-1","toolName":"mcp__crm__update_contact",
                   "argumentsPreview":"{}"}
                ]}""");
        AiChatStreamRespVO legacyProjected = objectMapper.convertValue(
                legacy, AiChatStreamRespVO.class);
        assertThat(legacyProjected.getPendingToolCalls()).hasSize(1);
        assertThat(legacyProjected.getPendingToolCalls().get(0).getScope()).isNull();
    }

    private JsonNode parsePending(String pendingToolCallsJson) {
        try {
            return objectMapper.readTree(pendingToolCallsJson);
        } catch (Exception invalidJson) {
            throw new IllegalStateException(invalidJson);
        }
    }
}
