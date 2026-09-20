package com.inneragent.platform.toolhub.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.toolhub.ToolAuditLog;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * ia_audit_log 审计 Mapper(仅追加;不提供 update/delete 方法,append-only)。
 */
@Mapper
public interface ToolAuditLogMapper extends BaseMapper<ToolAuditLog> {

    /**
     * 显式 INSERT(供审计路径使用;列集与实体对齐,create_time 由 DDL 默认值兜底)。
     */
    @Insert("""
            INSERT INTO ia_audit_log (
                app_id, tenant_id, user_id, conversation_id, run_id, tool_fqn,
                decision, decision_source, risk_level, params_masked_json,
                result_summary, error_text, duration_ms
            ) VALUES (
                #{e.appId}, #{e.tenantId}, #{e.userId}, #{e.conversationId}, #{e.runId}, #{e.toolFqn},
                #{e.decision}, #{e.decisionSource}, #{e.riskLevel}, #{e.paramsMaskedJson},
                #{e.resultSummary}, #{e.errorText}, #{e.durationMs}
            )
            """)
    int append(@Param("e") ToolAuditLog entry);
}
