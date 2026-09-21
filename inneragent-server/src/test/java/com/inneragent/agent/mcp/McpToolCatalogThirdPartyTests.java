package com.inneragent.agent.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.mapper.McpServerConfigMapper;
import com.inneragent.agent.mapper.McpUserServerMapper;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.ToolGrantService;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.beans.factory.ObjectProvider;

import java.time.Duration;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 目录三方聚合单测(P4-W13,需求 #3):宿主 → 应用级三方 → 用户级三方聚合序、
 * FQN 命名空间、防遮蔽丢弃(WARN + 审计)、用户级行级隔离、LRU 失效。
 */
class McpToolCatalogThirdPartyTests {

    private static final long APP_ID = 1L;
    private static final long USER_A = 10001L;
    private static final long USER_B = 20002L;

    private ToolRegistryMapper registryMapper;
    private ToolGrantService grantService;
    private ToolAuditService auditService;
    private McpThirdPartyToolListCache thirdPartyCache;
    private McpToolCatalog catalog;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        registryMapper = Mockito.mock(ToolRegistryMapper.class);
        grantService = Mockito.mock(ToolGrantService.class);
        lenient().when(grantService.activePermanentFqns(anyLong())).thenReturn(Set.of());
        auditService = Mockito.mock(ToolAuditService.class);
        thirdPartyCache = Mockito.mock(McpThirdPartyToolListCache.class);
        lenient().when(thirdPartyCache.enabledAppServers(anyLong())).thenReturn(List.of());
        lenient().when(thirdPartyCache.enabledUserServers(anyLong(), anyLong()))
                .thenReturn(List.of());
        lenient().when(thirdPartyCache.tools(any())).thenReturn(List.of());
        ObjectProvider<McpThirdPartyToolListCache> provider = Mockito.mock(ObjectProvider.class);
        lenient().when(provider.getIfAvailable()).thenReturn(thirdPartyCache);

        catalog = new McpToolCatalog(
                registryMapper, grantService, new ObjectMapper(), null, provider, auditService);
    }

    private static ToolRegistryEntry hostTool(String serverKey, String toolName) {
        ToolRegistryEntry entry = new ToolRegistryEntry();
        entry.setId(11L);
        entry.setAppId(APP_ID);
        entry.setServerKey(serverKey);
        entry.setToolName(toolName);
        entry.setFqn(ToolRegistryService.fqnOf(serverKey, toolName));
        entry.setSource(ToolRegistryService.SOURCE_HOST_APP);
        entry.setAnnotationsJson("{\"readOnlyHint\":true}");
        entry.setEnabled(true);
        return entry;
    }

    private static McpThirdPartyToolListCache.ThirdPartyTool tool(String name) {
        return new McpThirdPartyToolListCache.ThirdPartyTool(
                name, "desc " + name, "{\"type\":\"object\"}", false, false, false, false);
    }

    private static McpThirdPartyToolListCache.ServerRef appRef(String serverKey) {
        return McpThirdPartyToolListCache.ServerRef.app(APP_ID, serverKey);
    }

    private static McpThirdPartyToolListCache.ServerRef userRef(long userId, String serverKey) {
        return McpThirdPartyToolListCache.ServerRef.user(APP_ID, userId, serverKey);
    }

    // ------------------------------------------------------------------
    // 聚合顺序与命名空间
    // ------------------------------------------------------------------

    @Test
    @DisplayName("聚合顺序:宿主 → 应用级三方 → 用户级三方;FQN 强制 mcp__<key>__<tool>")
    void aggregationOrderAndNamespacing() {
        when(registryMapper.selectList(any())).thenReturn(List.of(hostTool("host", "echo")));
        when(thirdPartyCache.enabledAppServers(APP_ID)).thenReturn(List.of(appRef("crm")));
        when(thirdPartyCache.tools(appRef("crm"))).thenReturn(List.of(tool("list_contacts")));
        when(thirdPartyCache.enabledUserServers(APP_ID, USER_A))
                .thenReturn(List.of(userRef(USER_A, "mytools")));
        when(thirdPartyCache.tools(userRef(USER_A, "mytools"))).thenReturn(List.of(tool("my_tool")));

        List<McpToolCatalogEntry> combined = catalog.catalogForUser(APP_ID, USER_A);

        assertThat(combined).extracting(McpToolCatalogEntry::fqn)
                .containsExactly(
                        "mcp__host__echo",
                        "mcp__crm__list_contacts",
                        "mcp__mytools__my_tool");
        // 用户级条目治理位:注解不可信/写操作确认/无注册表行
        McpToolCatalogEntry userEntry = combined.get(2);
        assertThat(userEntry.annotationsTrusted()).isFalse();
        assertThat(userEntry.readOnlyEffective()).isFalse();
        assertThat(userEntry.id()).isNull();
        assertThat(userEntry.enabled()).isTrue();
        // 应用级目录(catalog)不含用户级条目
        assertThat(catalog.catalog(APP_ID)).extracting(McpToolCatalogEntry::fqn)
                .containsExactly("mcp__host__echo", "mcp__crm__list_contacts");
    }

    @Test
    @DisplayName("用户级目录条目叠加 granted 标注(catalogForUser 授权口径不变)")
    void grantAnnotationStillApplies() {
        when(registryMapper.selectList(any())).thenReturn(List.of());
        when(thirdPartyCache.enabledUserServers(APP_ID, USER_A))
                .thenReturn(List.of(userRef(USER_A, "mytools")));
        when(thirdPartyCache.tools(userRef(USER_A, "mytools"))).thenReturn(List.of(tool("my_tool")));
        when(grantService.activePermanentFqns(USER_A)).thenReturn(Set.of("mcp__mytools__my_tool"));

        assertThat(catalog.catalogForUser(APP_ID, USER_A).get(0).granted()).isTrue();
    }

    // ------------------------------------------------------------------
    // 防遮蔽
    // ------------------------------------------------------------------

    @Test
    @DisplayName("防遮蔽:三方工具与宿主工具同名 → 丢弃 + WARN + 审计(denied/forced-policy)")
    void hostNameShadowDropsThirdPartyTool() {
        when(registryMapper.selectList(any())).thenReturn(List.of(hostTool("host", "echo")));
        when(thirdPartyCache.enabledAppServers(APP_ID)).thenReturn(List.of(appRef("crm")));
        when(thirdPartyCache.tools(appRef("crm")))
                .thenReturn(List.of(tool("echo"), tool("list_contacts")));

        assertThat(catalog.catalog(APP_ID)).extracting(McpToolCatalogEntry::fqn)
                .containsExactly("mcp__host__echo", "mcp__crm__list_contacts");

        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("denied");
        assertThat(audit.getValue().decisionSource())
                .isEqualTo(ToolDecisionSource.FORCED_POLICY.code());
        assertThat(audit.getValue().toolFqn()).isEqualTo("mcp__crm__echo");
        assertThat(audit.getValue().resultSummary()).contains("name_shadow");
    }

    @Test
    @DisplayName("防遮蔽:同层两 server 暴露同名工具 → serverKey 序靠前者保留,后者丢弃")
    void crossServerNameShadowDropsLaterTool() {
        when(registryMapper.selectList(any())).thenReturn(List.of());
        when(thirdPartyCache.enabledAppServers(APP_ID))
                .thenReturn(List.of(appRef("crm"), appRef("helpdesk")));
        when(thirdPartyCache.tools(appRef("crm"))).thenReturn(List.of(tool("ping")));
        when(thirdPartyCache.tools(appRef("helpdesk"))).thenReturn(List.of(tool("ping")));

        assertThat(catalog.catalog(APP_ID)).extracting(McpToolCatalogEntry::fqn)
                .containsExactly("mcp__crm__ping");
        verify(auditService).append(any(ToolAuditService.ToolAuditEntry.class));
    }

    @Test
    @DisplayName("防遮蔽:应用级已占用同名 → 用户级同名条目丢弃;用户 A 丢弃不影响用户 B")
    void appLayerShadowDoesNotLeakAcrossUsers() {
        when(registryMapper.selectList(any())).thenReturn(List.of());
        when(thirdPartyCache.enabledAppServers(APP_ID)).thenReturn(List.of(appRef("crm")));
        when(thirdPartyCache.tools(appRef("crm"))).thenReturn(List.of(tool("ping")));
        when(thirdPartyCache.enabledUserServers(APP_ID, USER_A))
                .thenReturn(List.of(userRef(USER_A, "mytools")));
        when(thirdPartyCache.tools(userRef(USER_A, "mytools"))).thenReturn(List.of(tool("ping")));
        when(thirdPartyCache.enabledUserServers(APP_ID, USER_B))
                .thenReturn(List.of(userRef(USER_B, "btools")));
        when(thirdPartyCache.tools(userRef(USER_B, "btools")))
                .thenReturn(List.of(tool("ping"), tool("b_only")));

        assertThat(catalog.catalogForUser(APP_ID, USER_A))
                .extracting(McpToolCatalogEntry::fqn)
                .containsExactly("mcp__crm__ping");
        assertThat(catalog.catalogForUser(APP_ID, USER_B))
                .extracting(McpToolCatalogEntry::fqn)
                .containsExactly("mcp__crm__ping", "mcp__btools__b_only");
    }

    // ------------------------------------------------------------------
    // 行级 userId 隔离
    // ------------------------------------------------------------------

    @Test
    @DisplayName("行级隔离:用户 A 的三方工具对用户 B 不可见;findForUser 仅本人命中")
    void userIsolation() {
        when(registryMapper.selectList(any())).thenReturn(List.of());
        when(thirdPartyCache.enabledUserServers(APP_ID, USER_A))
                .thenReturn(List.of(userRef(USER_A, "mytools")));
        when(thirdPartyCache.tools(userRef(USER_A, "mytools"))).thenReturn(List.of(tool("a_tool")));
        when(thirdPartyCache.enabledUserServers(APP_ID, USER_B)).thenReturn(List.of());

        assertThat(catalog.catalogForUser(APP_ID, USER_A))
                .extracting(McpToolCatalogEntry::fqn)
                .containsExactly("mcp__mytools__a_tool");
        assertThat(catalog.catalogForUser(APP_ID, USER_B)).isEmpty();

        assertThat(catalog.findForUser(APP_ID, USER_A, "mcp__mytools__a_tool")).isPresent();
        assertThat(catalog.findForUser(APP_ID, USER_A, "a_tool")).isPresent();
        assertThat(catalog.findForUser(APP_ID, USER_B, "mcp__mytools__a_tool")).isEmpty();
        // 应用级 find 不含用户级条目
        assertThat(catalog.find(APP_ID, "mcp__mytools__a_tool")).isEmpty();
    }

    @Test
    @DisplayName("无自遮蔽:catalogForUser 仅追加用户层(应用级已在 higher 占位),不产生虚假审计")
    void userAppendDoesNotReAppendAppLayer() {
        when(registryMapper.selectList(any())).thenReturn(List.of(hostTool("host", "echo")));
        when(thirdPartyCache.enabledAppServers(APP_ID)).thenReturn(List.of(appRef("crm")));
        when(thirdPartyCache.tools(appRef("crm"))).thenReturn(List.of(tool("crm_tool")));
        when(thirdPartyCache.enabledUserServers(APP_ID, USER_A))
                .thenReturn(List.of(userRef(USER_A, "mytools")));
        when(thirdPartyCache.tools(userRef(USER_A, "mytools"))).thenReturn(List.of(tool("a_tool")));

        assertThat(catalog.catalogForUser(APP_ID, USER_A))
                .extracting(McpToolCatalogEntry::fqn)
                .containsExactly("mcp__host__echo", "mcp__crm__crm_tool", "mcp__mytools__a_tool");
        verify(auditService, never()).append(any(ToolAuditService.ToolAuditEntry.class));
    }

    // ------------------------------------------------------------------
    // LRU 缓存与失效
    // ------------------------------------------------------------------

    @Test
    @DisplayName("清单 LRU:命中不重拉;invalidateThirdPartyConfigs 后重拉(注册变更即失效)")
    void lruCacheAndInvalidation() {
        List<McpThirdPartyToolListCache.ThirdPartyTool> payload = List.of(tool("t1"));
        CountingCache cache = new CountingCache(payload);
        McpThirdPartyToolListCache.ServerRef ref = appRef("crm");

        List<McpThirdPartyToolListCache.ThirdPartyTool> first = cache.tools(ref);
        List<McpThirdPartyToolListCache.ThirdPartyTool> second = cache.tools(ref);
        assertThat(cache.loads).isEqualTo(1);
        assertThat(second).isSameAs(first);

        cache.invalidateThirdPartyConfigs();
        cache.tools(ref);
        assertThat(cache.loads).as("失效后必须重拉").isEqualTo(2);
    }

    @Test
    @DisplayName("TTL 可配:短 TTL 过期后重拉(缺省 5min 由配置覆盖为 80ms 验证)")
    void ttlExpiryReloads() throws InterruptedException {
        McpInvokerProperties properties = new McpInvokerProperties();
        properties.setThirdPartyToolListTtl(Duration.ofMillis(80));
        List<McpThirdPartyToolListCache.ThirdPartyTool> payload = List.of(tool("t1"));
        CountingCache cache = new CountingCache(payload, properties);
        McpThirdPartyToolListCache.ServerRef ref = appRef("crm");

        cache.tools(ref);
        Thread.sleep(200);
        cache.tools(ref);
        assertThat(cache.loads).as("TTL 过期后应重拉").isEqualTo(2);
    }

    @Test
    @DisplayName("三方 server 配置变更触发目录全量失效(McpToolCatalog 双实现)")
    void catalogImplementsConfigInvalidator() {
        when(registryMapper.selectList(any())).thenReturn(List.of(hostTool("host", "echo")));
        catalog.catalog(APP_ID);
        catalog.invalidateThirdPartyConfigs();
        catalog.catalog(APP_ID);
        // 目录重查注册表(失效生效),无异常即通过
        verify(registryMapper, times(2)).selectList(any());
    }

    /** 装载计数桩:绕开真实 MCP 连接,验证 LRU/失效语义。 */
    private static final class CountingCache extends McpThirdPartyToolListCache {

        private final List<ThirdPartyTool> payload;
        private int loads;

        private CountingCache(List<ThirdPartyTool> payload) {
            this(payload, new McpInvokerProperties());
        }

        private CountingCache(List<ThirdPartyTool> payload, McpInvokerProperties properties) {
            super(Mockito.mock(McpServerConfigMapper.class),
                    Mockito.mock(McpUserServerMapper.class),
                    new ObjectMapper(),
                    properties);
            this.payload = payload;
        }

        @Override
        protected List<ThirdPartyTool> load(ServerRef ref) {
            loads++;
            return payload;
        }
    }
}
