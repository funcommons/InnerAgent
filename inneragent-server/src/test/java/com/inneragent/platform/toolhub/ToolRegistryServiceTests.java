package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.kernel.AgentKernelToolManifest;
import com.inneragent.agent.tool.ToolExecutor;
import com.inneragent.agent.tool.ToolExecutorRegistry;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.toolhub.mapper.ToolGrantMapper;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import com.inneragent.platform.toolhub.mapper.ToolSchemaHistoryMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mockito;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 工具注册管理服务测试(P1-T2a):FQN/指纹/风险默认/强制高危/冲突保护/
 * 活刷新分诊编排(unchanged 静默/compatible 生效/breaking 暂存+级联失效)/
 * 停用注销级联 + schema 历史留痕。
 */
class ToolRegistryServiceTests {

    private static final String SCHEMA_V1 = """
            {"type":"object","properties":{"userId":{"type":"integer"}},"required":["userId"]}
            """;
    private static final String SCHEMA_V2_OPTIONAL = """
            {"type":"object","properties":{"userId":{"type":"integer"},"note":{"type":"string"}},"required":["userId"]}
            """;
    private static final String SCHEMA_V2_REQUIRED = """
            {"type":"object","properties":{"userId":{"type":"integer"},"reason":{"type":"string"}},"required":["userId","reason"]}
            """;
    private static final String ANNOTATIONS_RO = "{\"readOnlyHint\":true,\"idempotentHint\":true}";

    private ToolRegistryMapper registryMapper;
    private ToolSchemaHistoryMapper historyMapper;
    private ToolGrantMapper grantMapper;
    private ToolGrantService grantService;
    private ToolAuditService auditService;
    private ToolRegistryService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        registryMapper = Mockito.mock(ToolRegistryMapper.class);
        historyMapper = Mockito.mock(ToolSchemaHistoryMapper.class);
        grantMapper = Mockito.mock(ToolGrantMapper.class);
        auditService = Mockito.mock(ToolAuditService.class);
        // spy:注册服务真实调用级联失效;测试同时可 verify 调用
        grantService = Mockito.spy(new ToolGrantService(grantMapper, registryMapper, auditService));
        ToolExecutorRegistry executorRegistry = new ToolExecutorRegistry(List.of(
                builtin("resolve_scope"), builtin("now")));
        ObjectProvider<ToolCatalogInvalidator> invalidators =
                Mockito.mock(ObjectProvider.class);
        lenient().when(invalidators.getIfAvailable()).thenReturn(appId -> {
        });
        service = new ToolRegistryService(
                registryMapper, historyMapper, grantService, auditService,
                new SchemaTriageService(new ObjectMapper()), executorRegistry,
                new ObjectMapper(), invalidators);
        // 注册路径的重复检查默认查无
        lenient().when(registryMapper.selectByFqnIncludingDeleted(anyString())).thenReturn(null);
        lenient().when(registryMapper.selectActiveByToolName(anyString())).thenReturn(null);
    }

    private static ToolExecutor builtin(String name) {
        return new ToolExecutor() {
            @Override
            public String getToolName() {
                return name;
            }

            @Override
            public String getDisplayName() {
                return name;
            }

            @Override
            public String getToolDescription() {
                return name;
            }

            @Override
            public String getParametersSchema() {
                return "{}";
            }

            @Override
            public String execute(String toolInput, com.inneragent.agent.tool.ToolExecutionContext context) {
                return "{}";
            }
        };
    }

    private ToolRegistryService.RegisterCommand command(
            String toolName, String schema, String annotations, String risk) {
        return new ToolRegistryService.RegisterCommand(
                "crm", toolName, "查询客户", schema, annotations,
                risk, null, null, null,
                ToolRegistryService.SOURCE_HOST_APP, null, "v1", true);
    }

    private ToolRegistryEntry persisted(ToolRegistryService.RegisterCommand cmd) {
        service.register(cmd);
        ArgumentCaptor<ToolRegistryEntry> captor = ArgumentCaptor.forClass(ToolRegistryEntry.class);
        verify(registryMapper).insert(captor.capture());
        ToolRegistryEntry entry = captor.getValue();
        entry.setId(11L);
        Mockito.reset(registryMapper);
        lenient().when(registryMapper.selectById(11L)).thenReturn(entry);
        lenient().when(registryMapper.selectByFqnIncludingDeleted(entry.getFqn())).thenReturn(entry);
        lenient().when(registryMapper.selectActiveByToolName(cmd.toolName())).thenReturn(entry);
        return entry;
    }

    @Test
    @DisplayName("注册:计算 FQN(mcp__server__tool)/指纹/注解默认风险级 low")
    void registerComputesFqnFingerprintAndDefaultRisk() {
        ToolRegistryEntry entry = service.register(
                command("list_users", SCHEMA_V1, ANNOTATIONS_RO, null));

        assertThat(entry.getFqn()).isEqualTo("mcp__crm__list_users");
        assertThat(entry.getRiskLevel()).isEqualTo("low");
        assertThat(entry.getResumeSafe()).isTrue(); // idempotentHint 默认透传到 resumeSafe
        assertThat(entry.getSchemaSha256()).hasSize(64);
        verify(historyMapper).insert(any(ToolSchemaHistory.class));
    }

    @Test
    @DisplayName("注册:删除类关键词强制高危,显式声明被覆盖")
    void forcedHighOverridesDeclaredRisk() {
        ToolRegistryEntry entry = service.register(
                command("delete_user", SCHEMA_V1, ANNOTATIONS_RO, "low"));
        assertThat(entry.getRiskLevel()).isEqualTo("high");
    }

    @Test
    @DisplayName("注册冲突:与内置工具重名 409")
    void builtinNameClashRejected() {
        assertThatThrownBy(() -> service.register(command("now", SCHEMA_V1, null, null)))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("内置工具");
    }

    @Test
    @DisplayName("注册冲突:同 FQN 已注册 409;工具名跨 server 重名 409")
    void duplicateRegistrationRejected() {
        service.register(command("list_users", SCHEMA_V1, null, null));
        Mockito.reset(registryMapper);
        ToolRegistryEntry existing = new ToolRegistryEntry();
        existing.setId(1L);
        existing.setFqn("mcp__crm__list_users");
        existing.setToolName("list_users");
        existing.setDeleted(false);
        when(registryMapper.selectByFqnIncludingDeleted("mcp__crm__list_users")).thenReturn(existing);

        assertThatThrownBy(() -> service.register(command("list_users", SCHEMA_V1, null, null)))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("已注册");

        // 同工具名、不同 serverKey → 工具名应用内唯一冲突
        when(registryMapper.selectByFqnIncludingDeleted("mcp__erp__list_users")).thenReturn(null);
        when(registryMapper.selectActiveByToolName("list_users")).thenReturn(existing);
        ToolRegistryService.RegisterCommand clash = new ToolRegistryService.RegisterCommand(
                "erp", "list_users", null, SCHEMA_V1, null, null, null, null, null,
                ToolRegistryService.SOURCE_HOST_APP, null, null, true);
        assertThatThrownBy(() -> service.register(clash))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("重名");
    }

    @Test
    @DisplayName("DEF-03:逻辑删行重注册 → 显式复活(可查询可刷新),复活事件留痕")
    void reRegisterAfterLogicalDeleteRevivesRow() {
        ToolRegistryEntry dead = persisted(command("list_users", SCHEMA_V1, ANNOTATIONS_RO, null));
        // 模拟注销后的逻辑删行:含删查询可见、活跃查询不可见
        dead.setDeleted(true);
        Mockito.reset(registryMapper);
        lenient().when(registryMapper.selectByFqnIncludingDeleted("mcp__crm__list_users"))
                .thenReturn(dead);
        lenient().when(registryMapper.selectActiveByToolName("list_users")).thenReturn(null);

        ToolRegistryEntry revived = service.register(
                command("list_users", SCHEMA_V1, ANNOTATIONS_RO, null));

        // 复活必须先显式置 deleted=false 再常规更新(@TableLogic 会给 updateById 追加 WHERE deleted=false)
        InOrder inOrder = Mockito.inOrder(registryMapper);
        inOrder.verify(registryMapper).revive(dead.getId());
        inOrder.verify(registryMapper).updateById(dead);
        assertThat(revived.getDeleted()).isFalse();
        assertThat(revived.getSchemaSha256())
                .isEqualTo(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V1));
        // 复活事件留痕:schema 历史 detail=register_revived + 审计 tool_revived
        ArgumentCaptor<ToolSchemaHistory> history = ArgumentCaptor.forClass(ToolSchemaHistory.class);
        verify(historyMapper, Mockito.times(2)).insert(history.capture()); // 首次注册 + 复活重注册
        assertThat(history.getAllValues().getLast().getDetail()).isEqualTo("register_revived");
        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("tool_revived");

        // 复活后分诊链路可用(可刷新):纯增量 compatible 照常生效
        Mockito.reset(registryMapper);
        lenient().when(registryMapper.selectById(dead.getId())).thenReturn(revived);
        ToolRegistryService.SchemaTriageResult result =
                service.refreshSchema(dead.getId(), SCHEMA_V2_OPTIONAL, ANNOTATIONS_RO, "v2");
        assertThat(result.verdict()).isEqualTo("compatible");
        assertThat(revived.getSchemaSha256())
                .isEqualTo(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V2_OPTIONAL));
    }

    @Test
    @DisplayName("serverKey 含下划线拒绝(V25)")
    void serverKeyWithUnderscoreRejected() {
        ToolRegistryService.RegisterCommand bad = new ToolRegistryService.RegisterCommand(
                "bad_key", "t", null, SCHEMA_V1, null, null, null, null, null,
                ToolRegistryService.SOURCE_HOST_APP, null, null, true);
        assertThatThrownBy(() -> service.register(bad))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("serverKey");
    }

    @Test
    @DisplayName("V14 分诊:纯增量 → compatible,立即生效,授权不受影响")
    void compatibleRefreshAppliesImmediately() {
        ToolRegistryEntry entry = persisted(command("list_users", SCHEMA_V1, ANNOTATIONS_RO, null));
        entry.setSchemaSha256(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V1));

        ToolRegistryService.SchemaTriageResult result =
                service.refreshSchema(11L, SCHEMA_V2_OPTIONAL, ANNOTATIONS_RO, "v2");

        assertThat(result.verdict()).isEqualTo("compatible");
        assertThat(entry.getParametersSchema()).contains("note");
        assertThat(entry.getSchemaSha256())
                .isEqualTo(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V2_OPTIONAL));
        verify(grantMapper, never()).selectActiveByFqn(anyString());
        verify(auditService).append(any(ToolAuditService.ToolAuditEntry.class));
    }

    @Test
    @DisplayName("V14 分诊:新增必填 → breaking,旧 schema 生效,暂存 pending,存量授权级联失效")
    void breakingRefreshParksSchemaAndInvalidatesGrants() {
        ToolRegistryEntry entry = persisted(command("list_users", SCHEMA_V1, ANNOTATIONS_RO, null));
        entry.setSchemaSha256(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V1));
        when(grantMapper.selectActiveByFqn("mcp__crm__list_users")).thenReturn(List.of());

        ToolRegistryService.SchemaTriageResult result =
                service.refreshSchema(11L, SCHEMA_V2_REQUIRED, ANNOTATIONS_RO, "v2");

        assertThat(result.verdict()).isEqualTo("breaking");
        assertThat(result.reasons()).contains("required_added:reason");
        assertThat(entry.getRevalidateRequired()).isTrue();
        assertThat(entry.getPendingSchemaSha256())
                .isEqualTo(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V2_REQUIRED));
        // 旧 schema 仍然生效
        assertThat(entry.getSchemaSha256())
                .isEqualTo(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V1));
        verify(grantService).invalidateByFqn("mcp__crm__list_users", "schema_breaking");
    }

    @Test
    @DisplayName("V14 分诊:指纹一致 → unchanged 静默刷新,不写审计不通知")
    void unchangedRefreshIsSilent() {
        ToolRegistryEntry entry = persisted(command("list_users", SCHEMA_V1, ANNOTATIONS_RO, null));
        entry.setSchemaSha256(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V1));

        ToolRegistryService.SchemaTriageResult result =
                service.refreshSchema(11L, SCHEMA_V1, ANNOTATIONS_RO, null);

        assertThat(result.verdict()).isEqualTo("unchanged");
        assertThat(entry.getSchemaSha256())
                .isEqualTo(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V1));
        verify(auditService, never()).append(any());
    }

    @Test
    @DisplayName("DEF-02:空体分诊(未重发 schema)→ unchanged,指纹基准不被空串指纹覆写")
    void emptyBodyRefreshKeepsFingerprintAndWritesNoPending() {
        ToolRegistryEntry entry = persisted(command("list_users", SCHEMA_V1, ANNOTATIONS_RO, null));
        entry.setSchemaSha256(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V1));
        String baseline = entry.getSchemaSha256();

        // UI「刷新」按钮的空体调用:null 与空白两种形态
        ToolRegistryService.SchemaTriageResult nullBody =
                service.refreshSchema(11L, null, null, null);
        ToolRegistryService.SchemaTriageResult blankBody =
                service.refreshSchema(11L, "   ", ANNOTATIONS_RO, null);

        assertThat(nullBody.verdict()).isEqualTo("unchanged");
        assertThat(nullBody.reasons()).containsExactly("schema_not_resent");
        assertThat(blankBody.verdict()).isEqualTo("unchanged");
        // 指纹基准保持现库值,绝不退化为空串指纹;schema 内容与 pending 不动
        assertThat(entry.getSchemaSha256()).isEqualTo(baseline);
        assertThat(entry.getParametersSchema()).isNotNull();
        assertThat(entry.getRevalidateRequired()).isFalse();
        assertThat(entry.getPendingSchemaSha256()).isNull();
        // 历史留痕为 silent_refresh,且 new_sha256 保持现库指纹(空串指纹禁止入库)
        ArgumentCaptor<ToolSchemaHistory> history =
                ArgumentCaptor.forClass(ToolSchemaHistory.class);
        verify(historyMapper, Mockito.times(3)).insert(history.capture()); // 注册 1 行 + 空体刷新 2 行
        assertThat(history.getAllValues())
                .filteredOn(row -> ToolRegistryService.OUTCOME_SILENT_REFRESH.equals(row.getOutcome()))
                .hasSize(2)
                .allSatisfy(row -> {
                    assertThat(row.getNewSha256()).isEqualTo(baseline);
                    assertThat(row.getPreviousSha256()).isEqualTo(baseline);
                });
        assertThat(history.getAllValues())
                .noneMatch(row -> AgentKernelToolManifest.schemaSha256("")
                        .equals(row.getNewSha256())); // 空串指纹绝不入库
        // 未重发 schema 不触发授权级联
        verify(grantMapper, never()).selectActiveByFqn(anyString());
    }

    @Test
    @DisplayName("重新确认:应用 pending schema 并清除标记;拒绝:丢弃暂存")
    void confirmAndRejectPendingSchema() {
        ToolRegistryEntry entry = persisted(command("list_users", SCHEMA_V1, ANNOTATIONS_RO, null));
        entry.setSchemaSha256(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V1));
        when(grantMapper.selectActiveByFqn(anyString())).thenReturn(List.of());
        service.refreshSchema(11L, SCHEMA_V2_REQUIRED, ANNOTATIONS_RO, null);

        service.confirmPendingSchema(11L);
        assertThat(entry.getRevalidateRequired()).isFalse();
        assertThat(entry.getSchemaSha256())
                .isEqualTo(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V2_REQUIRED));

        // 再次提交 breaking 后拒绝 → 回到旧 schema
        service.refreshSchema(11L, SCHEMA_V1.replace("integer", "string"), ANNOTATIONS_RO, null);
        assertThat(entry.getRevalidateRequired()).isTrue();
        service.rejectPendingSchema(11L);
        assertThat(entry.getRevalidateRequired()).isFalse();
        assertThat(entry.getSchemaSha256())
                .isEqualTo(ToolSchemaFingerprint.of(new ObjectMapper(), SCHEMA_V2_REQUIRED));
    }

    @Test
    @DisplayName("停用/注销:级联失效授权并落审计")
    void disableAndDeleteCascadeGrants() {
        ToolRegistryEntry entry = persisted(command("list_users", SCHEMA_V1, null, null));
        when(grantMapper.selectActiveByFqn("mcp__crm__list_users")).thenReturn(List.of());

        service.disable(11L);
        assertThat(entry.getEnabled()).isFalse();
        verify(grantService).invalidateByFqn("mcp__crm__list_users", "tool_disabled");

        service.delete(11L);
        verify(registryMapper).deleteById(11L);
        verify(grantService).invalidateByFqn("mcp__crm__list_users", "tool_deleted");
    }

    @Test
    @DisplayName("风险等级上调:存量授权自动失效;强制高危工具不可下调")
    void riskUpgradeInvalidatesGrantsAndForbidsDowngrade() {
        ToolRegistryEntry entry = persisted(command("delete_user", SCHEMA_V1, null, null));
        assertThat(entry.getRiskLevel()).isEqualTo("high");
        when(grantMapper.selectActiveByFqn(anyString())).thenReturn(List.of());

        assertThatThrownBy(() -> service.update(11L,
                new ToolRegistryService.UpdateCommand(null, "low", null, null, null, null)))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("强制高危");

        // 普通 medium 工具上调 → 失效授权
        ToolRegistryEntry medium = persisted(command("list_users", SCHEMA_V1, null, null));
        medium.setRiskLevel("medium");
        Mockito.reset(registryMapper);
        lenient().when(registryMapper.selectById(11L)).thenReturn(medium);
        service.update(11L, new ToolRegistryService.UpdateCommand(null, "high", null, null, null, null));
        verify(grantService).invalidateByFqn(eq("mcp__crm__list_users"), eq("risk_upgrade"));
    }
}
