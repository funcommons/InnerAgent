package com.inneragent.platform.toolhub;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
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
        // 初始化 MP 实体元数据缓存:断言 wrapper SQL 片段时 lambda 列
        // (orderBy 等)需要 TableInfo(真实容器由 MapperScan 初始化)
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
                new org.apache.ibatis.builder.MapperBuilderAssistant(
                        new com.baomidou.mybatisplus.core.MybatisConfiguration(), ""),
                ToolAuditLog.class);
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
    @DisplayName("字典完备:decision_source 七值(含 V8 expired、P2-W5 admin);decision 十一值与写入码值一致")
    void dictionariesCoverActualValueDomains() {
        List<ToolAuditQueryService.DictionaryEntry> sources =
                ToolAuditQueryService.decisionSourceDictionary();
        assertThat(sources).extracting(ToolAuditQueryService.DictionaryEntry::code)
                .containsExactly("mode-default", "user-grant", "forced-policy",
                        "live-confirm", "expired", "full-access", "admin");

        List<ToolAuditQueryService.DictionaryEntry> decisions =
                ToolAuditQueryService.decisionDictionary();
        assertThat(decisions).extracting(ToolAuditQueryService.DictionaryEntry::code)
                .containsExactly("allowed", "denied", "granted", "revoked",
                        "invalidated", "schema_compatible", "schema_breaking",
                        "risk_upgraded", "tool_disabled",
                        "definition-updated", "definition-imported");
        assertThat(decisions).allSatisfy(entry ->
                assertThat(entry.description()).isNotBlank());
    }

    // ==================== 优化建议 #15:toolFqn 模糊检索 ====================

    @Test
    @DisplayName("toolFqn 模糊匹配:生成 ILIKE '%q%' 参数绑定片段(子串命中语义)")
    void toolFqnFilterUsesParameterizedIlike() {
        when(auditMapper.selectPage(any(Page.class), any(Wrapper.class)))
                .thenAnswer(invocation -> {
                    Page<ToolAuditLog> page = invocation.getArgument(0);
                    page.setRecords(List.of());
                    page.setTotal(0);
                    return page;
                });

        service.page(new ToolAuditQueryService.AuditLogFilter(
                null, null, "get_user", null, null, null, null, 1, 10));

        ArgumentCaptor<Wrapper<ToolAuditLog>> wrapperCaptor =
                ArgumentCaptor.forClass(Wrapper.class);
        Mockito.verify(auditMapper).selectPage(any(Page.class), wrapperCaptor.capture());
        LambdaQueryWrapper<ToolAuditLog> wrapper =
                (LambdaQueryWrapper<ToolAuditLog>) wrapperCaptor.getValue();

        // 片段为 ILIKE(模糊、大小写不敏感),值经 {0} 参数绑定(无拼接注入面);
        // 先取 SQL 片段触发 apply 占位符格式化,再读参数值
        assertThat(wrapper.getSqlSegment()).contains("tool_fqn ILIKE");
        assertThat(wrapper.getParamNameValuePairs().values())
                .contains("%get\\_user%");
    }

    @Test
    @DisplayName("toolFqn 通配符转义:%/_/\\ 按字面量匹配,防通配注入与误匹配")
    void toolFqnWildcardMetacharactersEscaped() {
        when(auditMapper.selectPage(any(Page.class), any(Wrapper.class)))
                .thenAnswer(invocation -> {
                    Page<ToolAuditLog> page = invocation.getArgument(0);
                    page.setRecords(List.of());
                    page.setTotal(0);
                    return page;
                });

        // 输入含全部 LIKE 元字符:100%\_demo
        service.page(new ToolAuditQueryService.AuditLogFilter(
                null, null, "100%\\_demo", null, null, null, null, 1, 10));

        ArgumentCaptor<Wrapper<ToolAuditLog>> wrapperCaptor =
                ArgumentCaptor.forClass(Wrapper.class);
        Mockito.verify(auditMapper).selectPage(any(Page.class), wrapperCaptor.capture());
        LambdaQueryWrapper<ToolAuditLog> wrapper =
                (LambdaQueryWrapper<ToolAuditLog>) wrapperCaptor.getValue();

        // 每个元字符前都补了转义反斜杠:% → \%、_ → \_、\ → \\
        // (转义顺序 \ → % → _:输入 100%\_demo → %100\%\\\_demo%)
        assertThat(wrapper.getSqlSegment()).contains("tool_fqn ILIKE");
        assertThat(wrapper.getParamNameValuePairs().values())
                .contains("%100\\%\\\\\\_demo%");
    }

    @Test
    @DisplayName("toolFqn 前后空白 trim 后转义;空白串不产生 ILIKE 条件")
    void toolFqnBlankAndTrimHandling() {
        when(auditMapper.selectPage(any(Page.class), any(Wrapper.class)))
                .thenAnswer(invocation -> {
                    Page<ToolAuditLog> page = invocation.getArgument(0);
                    page.setRecords(List.of());
                    page.setTotal(0);
                    return page;
                });

        // 空白串:与 null 同为未指定,不追加 ILIKE 片段
        service.page(new ToolAuditQueryService.AuditLogFilter(
                null, null, "   ", null, null, null, null, 1, 10));
        ArgumentCaptor<Wrapper<ToolAuditLog>> blankCaptor =
                ArgumentCaptor.forClass(Wrapper.class);
        Mockito.verify(auditMapper, Mockito.times(1))
                .selectPage(any(Page.class), blankCaptor.capture());
        assertThat(((LambdaQueryWrapper<ToolAuditLog>) blankCaptor.getValue())
                .getSqlSegment()).doesNotContain("ILIKE");

        // 前后空白 trim:'  get_user  ' → '%get\_user%'
        service.page(new ToolAuditQueryService.AuditLogFilter(
                null, null, "  get_user  ", null, null, null, null, 1, 10));
        ArgumentCaptor<Wrapper<ToolAuditLog>> trimmedCaptor =
                ArgumentCaptor.forClass(Wrapper.class);
        Mockito.verify(auditMapper, Mockito.times(2))
                .selectPage(any(Page.class), trimmedCaptor.capture());
        LambdaQueryWrapper<ToolAuditLog> trimmedWrapper =
                (LambdaQueryWrapper<ToolAuditLog>) trimmedCaptor.getValue();
        assertThat(trimmedWrapper.getSqlSegment()).contains("tool_fqn ILIKE");
        assertThat(trimmedWrapper.getParamNameValuePairs().values())
                .contains("%get\\_user%");
    }

    @Test
    @DisplayName("转义工具:纯元字符串全转义;null 安全返回空串")
    void escapeLikePatternUtility() {
        assertThat(ToolAuditQueryService.escapeLikePattern("mcp__demo__get_user"))
                .isEqualTo("mcp\\_\\_demo\\_\\_get\\_user");
        assertThat(ToolAuditQueryService.escapeLikePattern("100%"))
                .isEqualTo("100\\%");
        assertThat(ToolAuditQueryService.escapeLikePattern("a\\b"))
                .isEqualTo("a\\\\b");
        assertThat(ToolAuditQueryService.escapeLikePattern(null)).isEmpty();
    }
}
