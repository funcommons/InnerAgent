package com.inneragent.agent.mcp;

import com.inneragent.agent.entity.McpServerConfig;
import com.inneragent.agent.entity.McpUserServer;
import com.inneragent.agent.mapper.McpServerConfigMapper;
import com.inneragent.agent.mapper.McpUserServerMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 三方 MCP 服务器注册服务单测(P4-W13):serverKey 防遮蔽冲突域、字段校验、
 * OAuth 501 枚举位、行级 userId 隔离、变更失效挂钩、管理面审计。
 */
class McpThirdPartyServerServiceTests {

    private McpServerConfigMapper appMapper;
    private McpUserServerMapper userMapper;
    private ToolRegistryMapper registryMapper;
    private ToolAuditService auditService;
    private McpThirdPartyConfigInvalidator invalidator;
    private McpAppServerService appService;
    private McpUserServerService userService;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        appMapper = Mockito.mock(McpServerConfigMapper.class);
        userMapper = Mockito.mock(McpUserServerMapper.class);
        registryMapper = Mockito.mock(ToolRegistryMapper.class);
        auditService = Mockito.mock(ToolAuditService.class);
        invalidator = Mockito.mock(McpThirdPartyConfigInvalidator.class);
        ObjectProvider<McpThirdPartyConfigInvalidator> invalidators =
                Mockito.mock(ObjectProvider.class);
        lenient().when(invalidators.orderedStream())
                .thenAnswer(invocation -> java.util.stream.Stream.of(invalidator));
        lenient().doNothing().when(auditService).append(any());
        // 冲突域缺省:各表均无同键行
        lenient().when(appMapper.selectCount(any())).thenReturn(0L);
        lenient().when(userMapper.selectCount(any())).thenReturn(0L);
        lenient().when(registryMapper.selectCount(any())).thenReturn(0L);
        appService = new McpAppServerService(
                appMapper, userMapper, registryMapper, auditService, invalidators);
        userService = new McpUserServerService(
                userMapper, appMapper, registryMapper, invalidators);
    }

    private static McpThirdPartyServerSupport.Upsert upsert(String serverKey) {
        return new McpThirdPartyServerSupport.Upsert(
                serverKey, "CRM 线索", "https://crm.example.com/mcp",
                null, null, "X-Api-Key", "secret-value", 45, true);
    }

    // ------------------------------------------------------------------
    // 字段校验(应用级与用户级同口径)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("serverKey 非法字符(下划线/超长)拒绝注册——FQN 命名空间防遮蔽")
    void serverKeyCharsetEnforced() {
        assertThatThrownBy(() -> appService.register(upsert("crm_sales")))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(400));
        assertThatThrownBy(() -> userService.register(1L, 10001L, upsert("a".repeat(65))))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> userService.register(1L, 10001L, upsert("含中文")))
                .isInstanceOf(BusinessException.class);
        verify(appMapper, never()).insert(any(McpServerConfig.class));
        verify(userMapper, never()).insert(any(McpUserServer.class));
    }

    @Test
    @DisplayName("OAUTH 鉴权策略:配置即 501(枚举位保留,流程 P4 后续批次)")
    void oauthRejectedWith501() {
        assertThatThrownBy(() -> appService.register(new McpThirdPartyServerSupport.Upsert(
                "crm", "CRM", "https://crm.example.com/mcp",
                null, "oauth", null, null, null, true)))
                .isInstanceOfSatisfying(BusinessException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(501);
                    assertThat(e.getMessage()).contains("CIMD");
                });
        assertThatThrownBy(() -> userService.register(1L, 10001L, new McpThirdPartyServerSupport.Upsert(
                "crm", "CRM", "https://crm.example.com/mcp",
                null, "OAUTH", null, null, null, true)))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(501));
    }

    @Test
    @DisplayName("transport 仅 streamable-http;STATIC_HEADER 缺头名/头值拒绝")
    void transportAndStaticHeaderValidation() {
        assertThatThrownBy(() -> appService.register(new McpThirdPartyServerSupport.Upsert(
                "crm", "CRM", "https://crm.example.com/mcp",
                "sse", null, null, null, null, true)))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> appService.register(new McpThirdPartyServerSupport.Upsert(
                "crm", "CRM", "https://crm.example.com/mcp",
                null, "STATIC_HEADER", null, "secret", null, true)))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> appService.register(new McpThirdPartyServerSupport.Upsert(
                "crm", "CRM", "https://crm.example.com/mcp",
                null, "STATIC_HEADER", "X-Api-Key", null, null, true)))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("用户自接 endpoint 拒绝本机/内网地址(防 SSRF);应用级(管理面)不设此限")
    void ssrfGuardOnlyForUserPlane() {
        McpThirdPartyServerSupport.Upsert loopback = new McpThirdPartyServerSupport.Upsert(
                "crm", "CRM", "http://127.0.0.1:9000/mcp",
                null, null, "X-Api-Key", "s", null, true);
        assertThatThrownBy(() -> userService.register(1L, 10001L, loopback))
                .isInstanceOf(BusinessException.class);
        // 应用级为管理面可信配置(对齐宿主桥注册先例):内网端点允许
        when(appMapper.insert(any(McpServerConfig.class))).thenReturn(1);
        McpServerConfig registered = appService.register(new McpThirdPartyServerSupport.Upsert(
                "crm", "CRM", "http://intranet-host:9000/mcp",
                null, null, "X-Api-Key", "s", null, true));
        assertThat(registered.getEndpointUrl()).contains("intranet-host");
    }

    // ------------------------------------------------------------------
    // 防遮蔽冲突域
    // ------------------------------------------------------------------

    @Test
    @DisplayName("serverKey 冲突域:应用级表/宿主注册表/用户级表任一占用即 409")
    void serverKeyConflictDomains() {
        when(appMapper.selectCount(any())).thenReturn(1L);
        assertThatThrownBy(() -> appService.register(upsert("crm")))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(409));

        when(appMapper.selectCount(any())).thenReturn(0L);
        when(registryMapper.selectCount(any())).thenReturn(1L);
        assertThatThrownBy(() -> appService.register(upsert("crm")))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(409));

        // 应用级注册:用户级同应用任意用户占用同键也拒绝(键混用致用户级不可达)
        when(registryMapper.selectCount(any())).thenReturn(0L);
        when(userMapper.selectCount(any())).thenReturn(1L);
        assertThatThrownBy(() -> appService.register(upsert("crm")))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(409));
    }

    @Test
    @DisplayName("用户级注册:与应用级/宿主 serverKey 冲突拒绝;本人重复同键拒绝")
    void userServerKeyConflictDomains() {
        when(appMapper.selectCount(any())).thenReturn(1L);
        assertThatThrownBy(() -> userService.register(1L, 10001L, upsert("crm")))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(409));

        when(appMapper.selectCount(any())).thenReturn(0L);
        when(registryMapper.selectCount(any())).thenReturn(1L);
        assertThatThrownBy(() -> userService.register(1L, 10001L, upsert("crm")))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(409));

        when(registryMapper.selectCount(any())).thenReturn(0L);
        when(userMapper.selectCount(any())).thenReturn(1L);
        assertThatThrownBy(() -> userService.register(1L, 10001L, upsert("crm")))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(409));
    }

    // ------------------------------------------------------------------
    // 注册成功形态 / 审计 / 失效
    // ------------------------------------------------------------------

    @Test
    @DisplayName("应用级注册成功:归一化落库 + decision=allowed/source=admin 审计(不含凭据)+ 失效挂钩")
    void appRegisterAuditsAndInvalidates() {
        when(appMapper.insert(any(McpServerConfig.class))).thenReturn(1);

        McpServerConfig registered = appService.register(upsert("crm"));

        assertThat(registered.getServerKey()).isEqualTo("crm");
        assertThat(registered.getTransport()).isEqualTo("streamable-http");
        assertThat(registered.getAuthType()).isEqualTo("STATIC_HEADER");
        assertThat(registered.getEnabled()).isTrue();
        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("allowed");
        assertThat(audit.getValue().decisionSource())
                .isEqualTo(ToolDecisionSource.ADMIN.code());
        assertThat(audit.getValue().toolFqn()).isEqualTo("mcp__crm");
        // 凭据值绝不进审计
        assertThat(String.valueOf(audit.getValue().resultSummary())).doesNotContain("secret-value");
        verify(invalidator).invalidateThirdPartyConfigs();
    }

    @Test
    @DisplayName("FQN 命名空间:注册键与 ToolRegistryService.fqnOf 同构(mcp__<key>__<tool>)")
    void fqnNamespaceConsistent() {
        assertThat(ToolRegistryService.fqnOf("crm", "list_contacts"))
                .isEqualTo("mcp__crm__list_contacts");
    }

    // ------------------------------------------------------------------
    // 用户级行级隔离
    // ------------------------------------------------------------------

    @Test
    @DisplayName("行级隔离:用户 B 访问用户 A 的服务器 → 404(不泄露存在性)")
    void userRowIsolation() {
        McpUserServer owned = McpUserServer.builder()
                .appId(1L).userId(10001L).serverKey("crm").build();
        owned.setId(7L);
        when(userMapper.selectById(7L)).thenReturn(owned);

        assertThat(userService.requireOwned(1L, 10001L, 7L).getServerKey()).isEqualTo("crm");
        assertThatThrownBy(() -> userService.requireOwned(1L, 20002L, 7L))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(404));
        // 跨应用同样 404
        assertThatThrownBy(() -> userService.requireOwned(2L, 10001L, 7L))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("每用户注册数护栏(32);启用清单仅含 enabled 行")
    void perUserQuotaAndEnabledFilter() {
        McpUserServer existing = Mockito.mock(McpUserServer.class);
        when(existing.getEnabled()).thenReturn(true);
        when(userMapper.selectList(any())).thenReturn(List.of(existing, Mockito.mock(McpUserServer.class)));
        assertThat(userService.listEnabled(1L, 10001L)).hasSize(1);
    }

    // ------------------------------------------------------------------
    // 失效挂钩(注册变更即失效)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("启停/更新/删除均触发失效;invalidator 缺席时静默跳过")
    void invalidationHooks() {
        McpServerConfig existing = McpServerConfig.builder()
                .appId(1L).serverKey("crm").endpointUrl("https://crm.example.com/mcp")
                .transport("streamable-http").authType("STATIC_HEADER")
                .headerName("X-Api-Key").credentials("old").timeoutSeconds(30).enabled(true)
                .build();
        existing.setId(9L);
        when(appMapper.selectById(9L)).thenReturn(existing);
        when(appMapper.updateById(any(McpServerConfig.class))).thenReturn(1);

        appService.setEnabled(1L, 9L, false);
        appService.update(1L, 9L, upsert("crm"));
        verify(invalidator, Mockito.times(2)).invalidateThirdPartyConfigs();

        // invalidator 缺席(裁剪部署):静默跳过不抛
        ObjectProvider<McpThirdPartyConfigInvalidator> absent = Mockito.mock(ObjectProvider.class);
        when(absent.orderedStream()).thenReturn(java.util.stream.Stream.empty());
        McpAppServerService bare = new McpAppServerService(
                appMapper, userMapper, registryMapper, auditService, absent);
        bare.setEnabled(1L, 9L, true);
    }
}
