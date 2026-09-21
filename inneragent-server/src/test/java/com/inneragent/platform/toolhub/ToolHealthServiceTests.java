package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.mcp.McpToolHealthChecker;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 工具体检 v1 服务层单元测试(V16):三态结论矩阵(ok / degraded / unreachable)、
 * 指纹漂移与注解 diff 判定、明细 JSON 形状、落库字段、批量受理(全量/指定/未知 id)。
 * 探活通道以桩替换(真机握手链路由 McpToolHealthCheckHostIT 覆盖)。
 */
class ToolHealthServiceTests {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String SCHEMA = """
            {"type":"object","properties":{"userId":{"type":"integer"}},"required":["userId"]}
            """;

    private ToolRegistryMapper registryMapper;
    private McpToolHealthChecker healthChecker;
    private ToolHealthService service;

    @BeforeEach
    void setUp() {
        registryMapper = Mockito.mock(ToolRegistryMapper.class);
        healthChecker = Mockito.mock(McpToolHealthChecker.class);
        service = new ToolHealthService(registryMapper, healthChecker,
                props(), MAPPER);
        // 落库重读回同一行(测试桩:直接返回被探测行)
        lenient().when(registryMapper.selectById(anyLong())).thenAnswer(invocation -> {
            long id = invocation.getArgument(0);
            return entry(id, SCHEMA, "{\"readOnlyHint\":true}", "mcp__host__echo");
        });
    }

    private static ToolHealthProperties props() {
        ToolHealthProperties properties = new ToolHealthProperties();
        properties.setProbeTimeout(Duration.ofSeconds(10));
        return properties;
    }

    private static ToolRegistryEntry entry(long id, String schema, String annotations, String toolName) {
        ToolRegistryEntry row = new ToolRegistryEntry();
        row.setId(id);
        row.setAppId(1L);
        row.setServerKey("host");
        row.setToolName(toolName);
        row.setFqn(ToolRegistryService.fqnOf("host", toolName));
        row.setSource(ToolRegistryService.SOURCE_HOST_APP);
        row.setParametersSchema(schema);
        row.setAnnotationsJson(annotations);
        row.setSchemaSha256(ToolSchemaFingerprint.of(MAPPER, schema));
        row.setEnabled(true);
        return row;
    }

    private static McpToolHealthChecker.HostTool hostTool(String name, String schemaJson, String annotationsJson) {
        return new McpToolHealthChecker.HostTool(name, schemaJson, annotationsJson);
    }

    // ------------------------------------------------------------------
    // 三态结论
    // ------------------------------------------------------------------

    @Test
    @DisplayName("①ok:握手可达 + 清单含工具 + 指纹一致 + 注解一致 → ok 落库")
    void allChecksPassResolvesOk() {
        ToolRegistryEntry row = entry(11L, SCHEMA, "{\"readOnlyHint\":true}", "echo");
        when(registryMapper.selectById(11L)).thenReturn(row);
        // 同一 canonical 形态:指纹一致;注解 JSON 属性顺序不同但归一后一致
        when(healthChecker.probe(anyLong(), any(), any())).thenReturn(
                McpToolHealthChecker.ProbeOutcome.reachable(List.of(
                        hostTool("echo", "{\"required\":[\"userId\"],\"type\":\"object\","
                                + "\"properties\":{\"userId\":{\"type\":\"integer\"}}}",
                                "{\"readOnlyHint\":true}"))));

        ToolHealthService.ToolCheckResult result = service.checkOne(11L);

        assertThat(result.status()).isEqualTo("ok");
        assertThat(result.checks()).extracting(ToolHealthService.CheckItem::check)
                .containsExactly("endpoint_reachable", "tool_present",
                        "schema_fingerprint", "annotations_diff");
        assertThat(result.checks()).allSatisfy(item -> assertThat(item.status()).isEqualTo("pass"));

        ArgumentCaptor<ToolRegistryEntry> saved = ArgumentCaptor.forClass(ToolRegistryEntry.class);
        verify(registryMapper).updateById(saved.capture());
        assertThat(saved.getValue().getHealthStatus()).isEqualTo("ok");
        assertThat(saved.getValue().getLastCheckedAt()).isNotNull();
        assertThat(saved.getValue().getHealthDetailJson()).contains("\"status\":\"ok\"");
    }

    @Test
    @DisplayName("②unreachable:握手失败 → unreachable,宿主侧检查项不再执行")
    void unreachableEndpointSkipsHostChecks() {
        ToolRegistryEntry row = entry(12L, SCHEMA, "{\"readOnlyHint\":true}", "echo");
        when(registryMapper.selectById(12L)).thenReturn(row);
        when(healthChecker.probe(anyLong(), any(), any())).thenReturn(
                McpToolHealthChecker.ProbeOutcome.unreachable("Connection refused"));

        ToolHealthService.ToolCheckResult result = service.checkOne(12L);

        assertThat(result.status()).isEqualTo("unreachable");
        assertThat(result.checks()).hasSize(1);
        assertThat(result.checks().getFirst().check()).isEqualTo("endpoint_reachable");
        assertThat(result.checks().getFirst().detail()).contains("Connection refused");
        assertThat(persistedHealthStatus()).isEqualTo("unreachable");
    }

    @Test
    @DisplayName("③endpoint 未配置 → unreachable(自拟语义:host_app 行缺 endpoint 无法调用)")
    void blankEndpointIsUnreachable() {
        ToolRegistryEntry row = entry(13L, SCHEMA, null, "echo");
        row.setEndpointUrl(null);
        when(registryMapper.selectById(13L)).thenReturn(row);
        // 桩未打 probe:探活通道不应对空 endpoint 发起(在 checker 内短路)
        when(healthChecker.probe(anyLong(), any(), any())).thenCallRealMethod();

        ToolHealthService.ToolCheckResult result = service.checkOne(13L);

        assertThat(result.status()).isEqualTo("unreachable");
        assertThat(result.checks().getFirst().detail()).contains("endpoint_url 未配置");
        assertThat(persistedHealthStatus()).isEqualTo("unreachable");
    }

    @Test
    @DisplayName("④degraded:宿主清单缺工具 → degraded 并给整改建议")
    void missingToolInHostManifestIsDegraded() {
        ToolRegistryEntry row = entry(14L, SCHEMA, "{\"readOnlyHint\":true}", "echo");
        when(registryMapper.selectById(14L)).thenReturn(row);
        when(healthChecker.probe(anyLong(), any(), any())).thenReturn(
                McpToolHealthChecker.ProbeOutcome.reachable(List.of(
                        hostTool("other_tool", SCHEMA, "{\"readOnlyHint\":true}"))));

        ToolHealthService.ToolCheckResult result = service.checkOne(14L);

        assertThat(result.status()).isEqualTo("degraded");
        assertThat(result.checks()).extracting(ToolHealthService.CheckItem::check)
                .containsExactly("endpoint_reachable", "tool_present");
        assertThat(result.checks().get(1).advice()).contains("注销");
        assertThat(persistedHealthStatus()).isEqualTo("degraded");
    }

    @Test
    @DisplayName("⑤degraded:schema 指纹漂移(宿主 required 集变化)→ degraded + 重发建议")
    void schemaFingerprintDriftIsDegraded() {
        ToolRegistryEntry row = entry(15L, SCHEMA, "{\"readOnlyHint\":true}", "echo");
        when(registryMapper.selectById(15L)).thenReturn(row);
        String driftedSchema = """
                {"type":"object","properties":{"userId":{"type":"integer"}},
                 "required":["userId","reason"]}
                """;
        when(healthChecker.probe(anyLong(), any(), any())).thenReturn(
                McpToolHealthChecker.ProbeOutcome.reachable(List.of(
                        hostTool("echo", driftedSchema, "{\"readOnlyHint\":true}"))));

        ToolHealthService.ToolCheckResult result = service.checkOne(15L);

        assertThat(result.status()).isEqualTo("degraded");
        ToolHealthService.CheckItem fingerprint =
                result.checks().stream()
                        .filter(item -> item.check().equals("schema_fingerprint"))
                        .findFirst().orElseThrow();
        assertThat(fingerprint.status()).isEqualTo("drift");
        assertThat(fingerprint.advice()).contains("/schema");
        assertThat(persistedHealthStatus()).isEqualTo("degraded");
    }

    @Test
    @DisplayName("⑥degraded:注解 diff(readOnlyHint 翻转)→ degraded + 差异键明细")
    void annotationsDriftIsDegraded() {
        ToolRegistryEntry row = entry(16L, SCHEMA, "{\"readOnlyHint\":true}", "echo");
        when(registryMapper.selectById(16L)).thenReturn(row);
        when(healthChecker.probe(anyLong(), any(), any())).thenReturn(
                McpToolHealthChecker.ProbeOutcome.reachable(List.of(
                        hostTool("echo", SCHEMA, "{\"readOnlyHint\":false,\"idempotentHint\":true}"))));

        ToolHealthService.ToolCheckResult result = service.checkOne(16L);

        assertThat(result.status()).isEqualTo("degraded");
        ToolHealthService.CheckItem annotations = result.checks().stream()
                .filter(item -> item.check().equals("annotations_diff"))
                .findFirst().orElseThrow();
        assertThat(annotations.status()).isEqualTo("drift");
        assertThat(annotations.detail()).contains("readOnlyHint");
        assertThat(persistedHealthStatus()).isEqualTo("degraded");
    }

    // ------------------------------------------------------------------
    // 边界与批量受理
    // ------------------------------------------------------------------

    @Test
    @DisplayName("⑦注册行无 schema → 指纹项跳过不误报;详情 JSON 可解析且含检查项")
    void blankRegisteredSchemaSkipsFingerprint() {
        ToolRegistryEntry row = entry(17L, "", "{\"readOnlyHint\":true}", "echo");
        row.setSchemaSha256(null);
        when(registryMapper.selectById(17L)).thenReturn(row);
        when(healthChecker.probe(anyLong(), any(), any())).thenReturn(
                McpToolHealthChecker.ProbeOutcome.reachable(List.of(
                        hostTool("echo", SCHEMA, "{\"readOnlyHint\":true}"))));

        ToolHealthService.ToolCheckResult result = service.checkOne(17L);

        assertThat(result.status()).isEqualTo("ok");
        assertThatCode(() -> MAPPER.readTree(result.detailJson())).doesNotThrowAnyException();
        assertThat(result.detailJson()).contains("\"schema_fingerprint\"");
    }

    @Test
    @DisplayName("⑧未知工具 id → 404")
    void unknownToolIdIs404() {
        when(registryMapper.selectById(99L)).thenReturn(null);

        assertThatThrownBy(() -> service.checkOne(99L))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getCode())
                .isEqualTo(404);
        verify(registryMapper, never()).updateById(any(ToolRegistryEntry.class));
    }

    @Test
    @DisplayName("⑨批量受理:全量(ids 缺省)→ 逐行执行;指定 ids 含未知 → skipped 注明")
    void batchReceiptCoversFullAndExplicit() {
        ToolRegistryEntry a = entry(21L, SCHEMA, null, "echo");
        ToolRegistryEntry b = entry(22L, SCHEMA, null, "grep");
        when(registryMapper.selectList(any())).thenReturn(List.of(a, b));
        when(registryMapper.selectBatchIds(any())).thenReturn(List.of(a));
        when(healthChecker.probe(anyLong(), any(), any())).thenReturn(
                McpToolHealthChecker.ProbeOutcome.reachable(List.of(
                        hostTool("echo", SCHEMA, "{\"readOnlyHint\":true}"),
                        hostTool("grep", SCHEMA, "{\"readOnlyHint\":true}"))));

        ToolHealthService.CheckBatchReceipt full = service.checkBatch(null);
        assertThat(full.accepted()).isTrue();
        assertThat(full.total()).isEqualTo(2);
        assertThat(full.skipped()).isEmpty();

        ToolHealthService.CheckBatchReceipt explicit = service.checkBatch(List.of(21L, 404L));
        assertThat(explicit.total()).isEqualTo(1);
        assertThat(explicit.skipped()).containsExactly(404L);
    }

    private String persistedHealthStatus() {
        ArgumentCaptor<ToolRegistryEntry> saved = ArgumentCaptor.forClass(ToolRegistryEntry.class);
        verify(registryMapper, Mockito.atLeastOnce()).updateById(saved.capture());
        return saved.getValue().getHealthStatus();
    }
}
