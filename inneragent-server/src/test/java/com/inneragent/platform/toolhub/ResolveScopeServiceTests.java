package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.mcp.McpInvokerUnavailableException;
import com.inneragent.agent.mcp.McpToolCatalog;
import com.inneragent.agent.mcp.McpToolCatalogEntry;
import com.inneragent.agent.mcp.McpToolInvocationResult;
import com.inneragent.agent.mcp.McpToolInvoker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * resolve_scope 服务端协议测试(P1-T2a):协议字段解析、
 * 降级(tool_absent / invoker_unavailable)、失败不冒充降级。
 */
class ResolveScopeServiceTests {

    private static final String SCOPE_FQN = "mcp__crm__resolve_scope";

    private McpToolCatalog catalog;
    private ResolveScopeService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        catalog = Mockito.mock(McpToolCatalog.class);
        ObjectProvider<McpToolInvoker> invokers = Mockito.mock(ObjectProvider.class);
        lenient().when(invokers.getIfAvailable())
                .thenReturn((appId, toolName, args, actContext) -> McpToolInvocationResult.ok("""
                        {"visibleDomains":["user","order"],
                         "writableFields":["user.remark"],
                         "forbidden":["user.password"],
                         "hints":["仅可见近 30 天订单"]}
                        """));
        service = new ResolveScopeService(catalog, invokers, new ObjectMapper());
    }

    private void catalogWithResolveScope(boolean present) {
        lenient().when(catalog.find(anyLong(), anyString())).thenReturn(
                present
                        ? Optional.of(new McpToolCatalogEntry(
                                3L, SCOPE_FQN, "crm", "resolve_scope", null, null,
                                "a".repeat(64), "low", null, false, true, true,
                                false, true, false, false, false, false, false))
                        : Optional.empty());
    }

    private static ResolveScopeRequest request() {
        return new ResolveScopeRequest("user-list", "12993", "user", Map.of("tab", "login"));
    }

    @Test
    @DisplayName("正常路径:出参协议字段解析(visible/writable/forbidden/hints)")
    void parsesProtocolFields() {
        catalogWithResolveScope(true);

        ResolveScopeOutcome outcome = service.resolve(1L, null, request(), null);

        assertThat(outcome.degraded()).isFalse();
        assertThat(outcome.visibleDomains()).containsExactly("user", "order");
        assertThat(outcome.writableFields()).containsExactly("user.remark");
        assertThat(outcome.forbidden()).containsExactly("user.password");
        assertThat(outcome.hints()).containsExactly("仅可见近 30 天订单");
    }

    @Test
    @DisplayName("降级:宿主未实现(tool_absent)→ 空 scope + degraded 标记")
    void degradesWhenToolAbsent() {
        catalogWithResolveScope(false);

        ResolveScopeOutcome outcome = service.resolve(1L, null, request(), null);

        assertThat(outcome.degraded()).isTrue();
        assertThat(outcome.degradeReason()).isEqualTo("tool_absent");
        assertThat(outcome.visibleDomains()).isEmpty();
        assertThat(outcome.writableFields()).isEmpty();
        assertThat(outcome.forbidden()).isEmpty();
    }

    @Test
    @DisplayName("降级:端口未接管(T2b 前 UnavailableMcpToolInvoker)→ invoker_unavailable")
    void degradesWhenInvokerUnavailable() {
        catalogWithResolveScope(true);
        ObjectProvider<McpToolInvoker> invokers = Mockito.mock(ObjectProvider.class);
        when(invokers.getIfAvailable()).thenReturn(new com.inneragent.platform.toolhub.UnavailableMcpToolInvoker());
        service = new ResolveScopeService(catalog, invokers, new ObjectMapper());

        ResolveScopeOutcome outcome = service.resolve(1L, SCOPE_FQN, request(), null);

        assertThat(outcome.degraded()).isTrue();
        assertThat(outcome.degradeReason()).isEqualTo("invoker_unavailable");
    }

    @Test
    @DisplayName("宿主工具报错(status:error)→ 失败上抛,不冒充降级")
    void toolErrorDoesNotMasqueradeAsDegrade() {
        catalogWithResolveScope(true);
        ObjectProvider<McpToolInvoker> invokers = Mockito.mock(ObjectProvider.class);
        when(invokers.getIfAvailable()).thenReturn(
                (appId, toolName, args, actContext) ->
                        McpToolInvocationResult.error("{\"status\":\"error\",\"message\":\"boom\"}"));
        service = new ResolveScopeService(catalog, invokers, new ObjectMapper());

        assertThatThrownBy(() -> service.resolve(1L, SCOPE_FQN, request(), null))
                .isInstanceOf(ResolveScopeService.ToolHubScopeResolutionFailure.class)
                .hasMessageContaining("boom");
    }

    @Test
    @DisplayName("出参缺字段容错为空列表;非法 JSON 上抛")
    void tolerantFieldParsing() {
        ResolveScopeOutcome sparse = service.parseOutcome("{\"visibleDomains\":[\"user\", 1]}");
        assertThat(sparse.visibleDomains()).containsExactly("user");
        assertThat(sparse.writableFields()).isEmpty();
        assertThat(sparse.forbidden()).isEmpty();
        assertThat(sparse.hints()).isEmpty();

        assertThatThrownBy(() -> service.parseOutcome("not-json"))
                .isInstanceOf(ResolveScopeService.ToolHubScopeResolutionFailure.class);
    }

    @Test
    @DisplayName("UnavailableMcpToolInvoker:调用即抛「T2b 接管」明确异常")
    void unavailableInvokerThrowsExplicitly() {
        com.inneragent.platform.toolhub.UnavailableMcpToolInvoker invoker =
                new com.inneragent.platform.toolhub.UnavailableMcpToolInvoker();
        assertThatThrownBy(() -> invoker.invoke(1L, "list_users", Map.of(), null))
                .isInstanceOf(McpInvokerUnavailableException.class)
                .hasMessageContaining("T2b");
    }
}
