package com.inneragent.agent.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.toolhub.ToolGrantService;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * McpToolCatalog 测试(P1-T2a):注册表聚合、注解可信采信(V15)、
 * caffeine 缓存与注册变更失效、授权 granted 标注。
 *
 * <p>P2-srv U1 遗留修复:load 显式按 app_id 过滤(SQL eq + 内存兜底过滤),
 * 不再单靠 AppTenantLineInnerInterceptor 行级注入——拦截器被绕过/直连 mapper
 * 时目录也不串应用。
 */
class McpToolCatalogTests {

    @BeforeAll
    static void initMybatisPlusTableInfo() {
        // LambdaQueryWrapper 列名解析(sql segment)需要实体的 TableInfo 缓存
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
                new org.apache.ibatis.builder.MapperBuilderAssistant(
                        new com.baomidou.mybatisplus.core.MybatisConfiguration(), ""),
                ToolRegistryEntry.class);
    }

    private ToolRegistryMapper registryMapper;
    private ToolGrantService grantService;
    private McpToolCatalog catalog;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        registryMapper = Mockito.mock(ToolRegistryMapper.class);
        grantService = Mockito.mock(ToolGrantService.class);
        lenient().when(registryMapper.selectList(any())).thenAnswer(invocation -> List.of(
                hostTool(),
                thirdPartyTool()));
        catalog = new McpToolCatalog(registryMapper, grantService, new ObjectMapper());
    }

    private static ToolRegistryEntry hostTool() {
        ToolRegistryEntry entry = new ToolRegistryEntry();
        entry.setId(1L);
        entry.setAppId(1L);
        entry.setServerKey("crm");
        entry.setToolName("list_users");
        entry.setFqn("mcp__crm__list_users");
        entry.setDescription("查询客户");
        entry.setParametersSchema("{\"type\":\"object\"}");
        entry.setAnnotationsJson("{\"readOnlyHint\":true}");
        entry.setRiskLevel("low");
        entry.setSource(ToolRegistryService.SOURCE_HOST_APP);
        entry.setResumeSafe(true);
        entry.setEnabled(true);
        entry.setSchemaSha256("a".repeat(64));
        return entry;
    }

    private static ToolRegistryEntry thirdPartyTool() {
        ToolRegistryEntry entry = new ToolRegistryEntry();
        entry.setId(2L);
        entry.setAppId(1L);
        entry.setServerKey("third-crm");
        entry.setToolName("export_users");
        entry.setFqn("mcp__third-crm__export_users");
        entry.setAnnotationsJson("{\"readOnlyHint\":true}");
        entry.setRiskLevel("medium");
        entry.setSource(ToolRegistryService.SOURCE_THIRD_PARTY);
        entry.setEnabled(true);
        entry.setSchemaSha256("b".repeat(64));
        return entry;
    }

    @Test
    @DisplayName("聚合 enabled 注册项;三方工具 readOnly 不被采信(V15)")
    void catalogAggregatesAndTrustsOnlyHostAnnotations() {
        List<McpToolCatalogEntry> entries = catalog.catalog(1L);

        assertThat(entries).hasSize(2);
        McpToolCatalogEntry host = entries.stream()
                .filter(entry -> entry.toolName().equals("list_users"))
                .findFirst().orElseThrow();
        assertThat(host.readOnlyEffective()).isTrue();   // 可信宿主 readOnlyHint 采信
        assertThat(host.annotationsTrusted()).isTrue();
        assertThat(host.resumeSafe()).isTrue();

        McpToolCatalogEntry thirdParty = entries.stream()
                .filter(entry -> entry.toolName().equals("export_users"))
                .findFirst().orElseThrow();
        assertThat(thirdParty.readOnlyEffective()).isFalse(); // 三方一律按写操作
        assertThat(thirdParty.annotationsTrusted()).isFalse();
    }

    @Test
    @DisplayName("caffeine 缓存命中不重复查库;invalidate 后重新加载")
    void cacheHitAndInvalidation() {
        catalog.catalog(1L);
        catalog.catalog(1L);
        verify(registryMapper, Mockito.times(1)).selectList(any());

        catalog.invalidate(1L);
        catalog.catalog(1L);
        verify(registryMapper, Mockito.times(2)).selectList(any());
    }

    @Test
    @DisplayName("find 支持 FQN 与工具名;resolve_scope 实现判定")
    void findByNameOrFqnAndResolveScopeDetection() {
        assertThat(catalog.find(1L, "mcp__crm__list_users")).isPresent();
        assertThat(catalog.find(1L, "list_users")).isPresent();
        assertThat(catalog.find(1L, "missing")).isEmpty();
        assertThat(catalog.resolveScopeImplemented(1L)).isFalse();

        ToolRegistryEntry scopeTool = new ToolRegistryEntry();
        scopeTool.setId(3L);
        scopeTool.setAppId(1L);
        scopeTool.setToolName("resolve_scope");
        scopeTool.setFqn("mcp__crm__resolve_scope");
        scopeTool.setSource(ToolRegistryService.SOURCE_HOST_APP);
        scopeTool.setEnabled(true);
        lenient().when(registryMapper.selectList(any())).thenReturn(List.of(hostTool(), scopeTool));
        catalog.invalidate(1L);
        assertThat(catalog.resolveScopeImplemented(1L)).isTrue();
    }

    @Test
    @DisplayName("catalogForUser 叠加 permanent 授权 granted 标注(授权过滤)")
    void catalogForUserMarksGrants() {
        when(grantService.activePermanentFqns(12993L)).thenReturn(java.util.Set.of("mcp__crm__list_users"));

        List<McpToolCatalogEntry> entries = catalog.catalogForUser(1L, 12993L);
        assertThat(entries.stream()
                .filter(entry -> entry.toolName().equals("list_users"))
                .findFirst().orElseThrow().granted()).isTrue();
        assertThat(entries.stream()
                .filter(entry -> entry.toolName().equals("export_users"))
                .findFirst().orElseThrow().granted()).isFalse();
    }

    @Test
    @DisplayName("U1:load 查询显式携带 app_id 条件(不单靠行级拦截器)")
    @SuppressWarnings("unchecked")
    void loadQueryFiltersByAppIdExplicitly() {
        catalog.catalog(1L);

        org.mockito.ArgumentCaptor<com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<ToolRegistryEntry>>
                wrapper = org.mockito.ArgumentCaptor.forClass(
                com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper.class);
        Mockito.verify(registryMapper).selectList(wrapper.capture());
        // 显式 app_id 条件进入 SQL 段(单测经 TableInfo 缓存解析 lambda 列名)
        assertThat(wrapper.getValue().getSqlSegment())
                .containsPattern("(?i)(^|\\W)app_id\\s*=")
                .containsPattern("(?i)(^|\\W)enabled\\s*=");
        assertThat(wrapper.getValue().getParamNameValuePairs().values())
                .contains(1L, Boolean.TRUE);
    }

    @Test
    @DisplayName("U1:内存兜底过滤——他应用/无 app_id 行即使被 mapper 返回也进不了目录")
    @SuppressWarnings("unchecked")
    void loadDropsRowsOfOtherAppsEvenWhenMapperReturnsThem() {
        ToolRegistryEntry foreign = thirdPartyTool();
        foreign.setId(9L);
        foreign.setAppId(2L); // 他应用同名 FQN 行
        ToolRegistryEntry unscoped = hostTool();
        unscoped.setId(8L);
        unscoped.setAppId(null); // 异常无归属行(ia_tool_registry 唯一键 (app_id,fqn) 不应出现)
        when(registryMapper.selectList(any())).thenReturn(List.of(hostTool(), foreign, unscoped));
        catalog.invalidate(1L);

        List<McpToolCatalogEntry> entries = catalog.catalog(1L);

        assertThat(entries)
                .extracting(McpToolCatalogEntry::toolName)
                .containsExactly("list_users");
        // 他应用目录视角仍只见他应用行
        when(registryMapper.selectList(any())).thenReturn(List.of(hostTool(), foreign, unscoped));
        catalog.invalidate(2L);
        assertThat(catalog.catalog(2L))
                .extracting(McpToolCatalogEntry::toolName)
                .containsExactly("export_users");
    }
}
