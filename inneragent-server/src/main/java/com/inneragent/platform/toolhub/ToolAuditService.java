package com.inneragent.platform.toolhub;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.tenant.TenantContext;
import com.inneragent.platform.toolhub.mapper.ToolAuditLogMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 工具决策审计写入服务(V22;ia_audit_log 仅追加)。
 *
 * <p>审计写入点保持最小侵入:工具中枢内(注册分诊/授权生命周期)直接落库;
 * 确认流实弹决策(live-confirm)由运行侧经本服务追加。敏感参数打码由调用方
 * 完成后传入(脱敏器统一实现随 W6 审计检索落地,当前存原文调用方负责脱敏)。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ToolAuditService {

    private final ToolAuditLogMapper auditMapper;

    /**
     * 追加一条审计记录(app_id/tenant_id 显式携带,不依赖 ThreadLocal 兜底)。
     */
    public void append(ToolAuditEntry entry) {
        ToolAuditLog row = new ToolAuditLog();
        row.setAppId(entry.appId() != null ? entry.appId() : AppContext.currentOrDefault());
        row.setTenantId(entry.tenantId() != null ? entry.tenantId()
                : (TenantContext.getTenantId() != null ? TenantContext.getTenantId() : 0L));
        row.setUserId(entry.userId());
        row.setConversationId(entry.conversationId());
        row.setRunId(entry.runId());
        row.setToolFqn(entry.toolFqn());
        row.setDecision(entry.decision());
        row.setDecisionSource(entry.decisionSource());
        row.setRiskLevel(entry.riskLevel());
        row.setParamsMaskedJson(entry.paramsMaskedJson());
        row.setResultSummary(entry.resultSummary());
        row.setErrorText(entry.errorText());
        row.setDurationMs(entry.durationMs());
        try {
            auditMapper.append(row);
        } catch (RuntimeException persistFailure) {
            // fail-closed(对齐状态存储一致性原则):审计失败即业务失败,决策不生效
            log.error("审计写入失败: toolFqn={}, decision={}, source={}",
                    entry.toolFqn(), entry.decision(), entry.decisionSource(), persistFailure);
            throw new BusinessException(500, "审计写入失败: " + persistFailure.getMessage());
        }
    }

    /**
     * 审计条目(V22:decisionSource 必填,由 {@link ToolDecisionSource#code()} 生成)。
     */
    public record ToolAuditEntry(
            Long appId,
            Long tenantId,
            Long userId,
            String conversationId,
            String runId,
            String toolFqn,
            String decision,
            String decisionSource,
            String riskLevel,
            String paramsMaskedJson,
            String resultSummary,
            String errorText,
            Long durationMs) {
    }
}
