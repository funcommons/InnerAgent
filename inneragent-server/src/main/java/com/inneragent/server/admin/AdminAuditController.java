package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.toolhub.ToolAuditLog;
import com.inneragent.platform.toolhub.ToolAuditQueryService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 审计检索 admin API(W5,PRD §6.8 M8「审计日志」;web 契约
 * {@code auditAdminApi.page → GET /ia/api/v1/admin/audit-logs} 对齐)。
 *
 * <p>守卫:{@link AdminTokenFilter} 双轨(X-IA-Admin-Key 引导 key 或管理会话
 * token Bearer)。管理面为跨应用视图:行级 app_id 由拦截器缺省注入
 * (管理请求无 AppContext,单应用部署语义),{@code appId} 参数为冗余显式过滤。
 *
 * <p><strong>出参统一脱敏</strong>:{@code paramsMaskedJson} 经
 * {@link com.inneragent.platform.toolhub.AuditParamMasker} 逐行脱敏(存量
 * 原文行同样受保护——读时脱敏,取舍见该类注释)。
 *
 * <p>字典:{@code GET /audit-logs/dictionary} 下发 decision_source/decision
 * 实际值域(web 脚手架 DecisionSource 类型缺 expired,联调时以字典为准)。
 */
@Tag(name = "审计检索(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/audit-logs")
@RequiredArgsConstructor
@Validated
public class AdminAuditController {

    private final ToolAuditQueryService auditQueryService;

    @GetMapping
    @Operation(summary = "审计日志分页(appId/userId/toolFqn/decision/decisionSource/时间区间过滤;出参脱敏)")
    public CommonResult<PageResult<ToolAuditLog>> page(
            @RequestParam(required = false) Long appId,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String toolFqn,
            @RequestParam(required = false) String decision,
            @RequestParam(required = false) String decisionSource,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            java.time.LocalDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            java.time.LocalDateTime to,
            @RequestParam(defaultValue = "1") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize) {
        if (decisionSource != null && !decisionSource.isBlank()) {
            // 未知值抛 IllegalArgumentException → 全局处理器 400(值域见 dictionary)
            ToolDecisionSource.fromCode(decisionSource);
        }
        return success(auditQueryService.page(new ToolAuditQueryService.AuditLogFilter(
                appId, userId,
                blankToNull(toolFqn), blankToNull(decision), blankToNull(decisionSource),
                from, to, pageNo, pageSize)));
    }

    @GetMapping("/dictionary")
    @Operation(summary = "审计字典(decision_source/decision 实际值域 + 中文说明)")
    public CommonResult<DictionaryVO> dictionary() {
        return success(new DictionaryVO(
                ToolAuditQueryService.decisionSourceDictionary(),
                ToolAuditQueryService.decisionDictionary()));
    }

    /** 字典响应(web 联调值域基准)。 */
    public record DictionaryVO(
            java.util.List<ToolAuditQueryService.DictionaryEntry> decisionSources,
            java.util.List<ToolAuditQueryService.DictionaryEntry> decisions) {
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
