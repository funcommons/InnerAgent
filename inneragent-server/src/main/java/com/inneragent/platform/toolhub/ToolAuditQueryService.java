package com.inneragent.platform.toolhub;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.toolhub.mapper.ToolAuditLogMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 审计检索查询服务(W5 审计检索,PRD §6.8 M8「审计日志」)。
 *
 * <p>过滤维度:appId/userId/toolFqn/decision/decisionSource/时间区间 + 分页
 * (web 契约 AuditLogQuery/PageResult 形)。管理面为跨应用视图,行级隔离由
 * {@code AppTenantLineInnerInterceptor} 兜底注入(管理请求无 AppContext,
 * 缺省 app_id=1,单应用部署语义;appId 参数为冗余显式过滤)。
 *
 * <p><strong>toolFqn 为模糊匹配</strong>(优化建议 #15:占位文案「模糊」对齐实现,
 * 采纳方案①):{@code tool_fqn ILIKE '%q%'}(审计量级可承受);查询词按 LIKE
 * 通配语义转义 {@code % _ \},杜绝通配注入与误匹配。其余维度仍为精确等值。
 *
 * <p><strong>读时脱敏</strong>:出参逐行过 {@link AuditParamMasker}(存量
 * 原文行同样受保护,取舍见该类注释;写路径保持透传不变)。ia_audit_log 仅追加,
 * 本服务只读(不提供 update/delete)。
 */
@Service
@RequiredArgsConstructor
public class ToolAuditQueryService {

    /** 每页上限(对齐 PageParam 惯例) */
    static final int MAX_PAGE_SIZE = 100;

    private final ToolAuditLogMapper auditMapper;

    /**
     * 分页检索(create_time 降序、id 降序稳定排序);出参已统一脱敏。
     */
    public PageResult<ToolAuditLog> page(AuditLogFilter filter) {
        int pageNo = Math.max(filter.pageNo(), 1);
        int pageSize = Math.min(Math.max(filter.pageSize(), 1), MAX_PAGE_SIZE);
        String toolFqn = filter.toolFqn();
        LambdaQueryWrapper<ToolAuditLog> wrapper = new LambdaQueryWrapper<ToolAuditLog>()
                .eq(filter.appId() != null, ToolAuditLog::getAppId, filter.appId())
                .eq(filter.userId() != null, ToolAuditLog::getUserId, filter.userId())
                // 优化建议 #15:toolFqn 模糊匹配(ILIKE '%q%',通配符转义防注入/误匹配)
                .apply(hasText(toolFqn), TOOL_FQN_ILIKE_FRAGMENT,
                        "%" + escapeLikePattern(toolFqn) + "%")
                .eq(hasText(filter.decision()), ToolAuditLog::getDecision,
                        filter.decision() == null ? null : filter.decision().trim())
                .eq(hasText(filter.decisionSource()), ToolAuditLog::getDecisionSource,
                        filter.decisionSource() == null ? null : filter.decisionSource().trim())
                .ge(filter.from() != null, ToolAuditLog::getCreateTime, filter.from())
                .le(filter.to() != null, ToolAuditLog::getCreateTime, filter.to())
                .orderByDesc(ToolAuditLog::getCreateTime)
                .orderByDesc(ToolAuditLog::getId);
        Page<ToolAuditLog> page =
                auditMapper.selectPage(new Page<>(pageNo, pageSize), wrapper);
        List<ToolAuditLog> maskedRecords = page.getRecords().stream()
                .peek(row -> row.setParamsMaskedJson(
                        AuditParamMasker.mask(row.getParamsMaskedJson())))
                .toList();
        PageResult<ToolAuditLog> result = new PageResult<>(maskedRecords, page.getTotal());
        result.setPageNo(pageNo);
        result.setPageSize(pageSize);
        return result;
    }

    /**
     * toolFqn 模糊匹配 SQL 片段({0} 为 MyBatis-Plus 参数占位符,值走
     * PreparedStatement 绑定,无拼接注入面;列名字面量与
     * {@link ToolAuditLog} 表映射 {@code ia_audit_log.tool_fqn} 一致)。
     */
    static final String TOOL_FQN_ILIKE_FRAGMENT = "tool_fqn ILIKE {0}";

    /**
     * LIKE/ILIKE 通配符转义(PostgreSQL 默认转义符为反斜杠):
     * {@code \ → \\}、{@code % → \%}、{@code _ → \_},保证用户输入中的
     * 通配元字符按字面量匹配(防通配注入导致的全表模糊扫描/误匹配)。
     * 入参先 trim 再转义;null 安全(调用方以 hasText 条件守卫)。
     */
    static String escapeLikePattern(String raw) {
        if (raw == null) {
            return "";
        }
        String trimmed = raw.trim();
        return trimmed
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
    }

    /**
     * decision_source 字典(W5「decision_source 过滤」前端下拉;实际值域以
     * {@link ToolDecisionSource} 为准,含 V8 增补的 expired)。
     */
    public static List<DictionaryEntry> decisionSourceDictionary() {
        return List.of(
                new DictionaryEntry(ToolDecisionSource.MODE_DEFAULT.code(), "模式默认路径(只读放行/写确认)"),
                new DictionaryEntry(ToolDecisionSource.USER_GRANT.code(), "用户「总是允许」授权"),
                new DictionaryEntry(ToolDecisionSource.FORCED_POLICY.code(), "管理员强制策略"),
                new DictionaryEntry(ToolDecisionSource.LIVE_CONFIRM.code(), "确认流实弹批准"),
                new DictionaryEntry(ToolDecisionSource.EXPIRED.code(), "确认超时系统裁决(过期=denied)"),
                new DictionaryEntry(ToolDecisionSource.FULL_ACCESS.code(), "FULL_ACCESS 全开放"));
    }

    /**
     * decision 字典(实际写入码值:工具调用 allowed/denied;授权生命周期
     * granted/revoked/invalidated;注册分诊 schema_compatible/schema_breaking;
     * 级联 risk_upgraded/tool_disabled)。
     */
    public static List<DictionaryEntry> decisionDictionary() {
        return List.of(
                new DictionaryEntry("allowed", "工具调用放行"),
                new DictionaryEntry("denied", "工具调用拒绝"),
                new DictionaryEntry("granted", "授权授予"),
                new DictionaryEntry("revoked", "授权撤销"),
                new DictionaryEntry("invalidated", "授权自动失效"),
                new DictionaryEntry("schema_compatible", "schema 纯增量变更自动接受"),
                new DictionaryEntry("schema_breaking", "schema 安全相关差异强确认"),
                new DictionaryEntry("risk_upgraded", "风险级人工上调"),
                new DictionaryEntry("tool_disabled", "工具停用"));
    }

    /** 字典项(code + 中文说明)。 */
    public record DictionaryEntry(String code, String description) {
    }

    /** 检索过滤(时间区间闭区间;分页缺省 1/10)。 */
    public record AuditLogFilter(
            Long appId,
            Long userId,
            String toolFqn,
            String decision,
            String decisionSource,
            LocalDateTime from,
            LocalDateTime to,
            int pageNo,
            int pageSize) {
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
