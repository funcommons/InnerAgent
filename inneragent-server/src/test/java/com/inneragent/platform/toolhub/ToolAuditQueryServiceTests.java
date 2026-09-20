package com.inneragent.platform.toolhub;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.toolhub.mapper.ToolAuditLogMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 审计检索查询服务测试:读时统一脱敏(存量原文行受保护)、分页形
 * (list+total+pageNo/pageSize,web 契约)、页容上限、字典值域完备。
 */
class ToolAuditQueryServiceTests {

    private ToolAuditLogMapper auditMapper;
    private ToolAuditQueryService service;

    @BeforeEach
    void setUp() {
        auditMapper = Mockito.mock(ToolAuditLogMapper.class);
        service = new ToolAuditQueryService(auditMapper);
    }

    private static ToolAuditLog row(long id, String toolFqn, String decision,
            String decisionSource, String rawParams) {
        ToolAuditLog row = new ToolAuditLog();
        row.setId(id);
        row.setAppId(1L);
        row.setUserId(12993L);
        row.setConversationId("conv-1");
        row.setRunId("run-1");
        row.setToolFqn(toolFqn);
        row.setDecision(decision);
        row.setDecisionSource(decisionSource);
        row.setRiskLevel("high");
        row.setParamsMaskedJson(rawParams);
        row.setResultSummary("ok");
        row.setCreateTime(LocalDateTime.of(2026, 9, 20, 12, 0));
        return row;
    }

    @Test
    @DisplayName("读时脱敏:存量原文参数行出参统一打码(password/token → ***)")
    void readTimeMaskingAppliedToLegacyRawRows() {
        when(auditMapper.selectPage(any(Page.class), any(Wrapper.class)))
                .thenAnswer(invocation -> {
                    Page<ToolAuditLog> page = invocation.getArgument(0);
                    page.setRecords(List.of(
                            row(1, "update_user", "allowed", "live-confirm",
                                    "{\"userId\":12993,\"password\":\"raw-secret\",\"nested\":{\"token\":\"tk\"}}"),
                            row(2, "send_email", "denied", "forced-policy", null)));
                    page.setTotal(2);
                    return page;
                });

        PageResult<ToolAuditLog> result = service.page(
                new ToolAuditQueryService.AuditLogFilter(null, null, null, null, null,
                        null, null, 1, 10));

        assertThat(result.getTotal()).isEqualTo(2);
        assertThat(result.getPageNo()).isEqualTo(1);
        assertThat(result.getPageSize()).isEqualTo(10);
        ToolAuditLog first = result.getList().get(0);
        assertThat(first.getParamsMaskedJson()).contains("\"password\":\"***\"");
        assertThat(first.getParamsMaskedJson()).contains("\"token\":\"***\"");
        assertThat(first.getParamsMaskedJson()).doesNotContain("raw-secret").doesNotContain("tk");
        // 非 params 字段不脱敏
        assertThat(first.getToolFqn()).isEqualTo("update_user");
        assertThat(result.getList().get(1).getParamsMaskedJson()).isNull();
    }

    @Test
    @DisplayName("页容钳制:pageNo<1 取 1,pageSize>100 封顶 100")
    void pagingBoundsClamped() {
        when(auditMapper.selectPage(any(Page.class), any(Wrapper.class)))
                .thenAnswer(invocation -> {
                    Page<ToolAuditLog> page = invocation.getArgument(0);
                    page.setRecords(List.of());
                    page.setTotal(0);
                    return page;
                });

        PageResult<ToolAuditLog> result = service.page(
                new ToolAuditQueryService.AuditLogFilter(null, null, null, null, null,
                        null, null, 0, 500));
        assertThat(result.getPageNo()).isEqualTo(1);
        assertThat(result.getPageSize()).isEqualTo(100);

        ArgumentCaptor<Page<ToolAuditLog>> pageCaptor = ArgumentCaptor.forClass(Page.class);
        Mockito.verify(auditMapper)
                .selectPage(pageCaptor.capture(), any(Wrapper.class));
        assertThat(pageCaptor.getValue().getCurrent()).isEqualTo(1);
        assertThat(pageCaptor.getValue().getSize()).isEqualTo(100);
    }

    @Test
    @DisplayName("字典完备:decision_source 六值(含 V8 expired);decision 九值与写入码值一致")
    void dictionariesCoverActualValueDomains() {
        List<ToolAuditQueryService.DictionaryEntry> sources =
                ToolAuditQueryService.decisionSourceDictionary();
        assertThat(sources).extracting(ToolAuditQueryService.DictionaryEntry::code)
                .containsExactly("mode-default", "user-grant", "forced-policy",
                        "live-confirm", "expired", "full-access");

        List<ToolAuditQueryService.DictionaryEntry> decisions =
                ToolAuditQueryService.decisionDictionary();
        assertThat(decisions).extracting(ToolAuditQueryService.DictionaryEntry::code)
                .containsExactly("allowed", "denied", "granted", "revoked",
                        "invalidated", "schema_compatible", "schema_breaking",
                        "risk_upgraded", "tool_disabled");
        assertThat(decisions).allSatisfy(entry ->
                assertThat(entry.description()).isNotBlank());
    }
}
