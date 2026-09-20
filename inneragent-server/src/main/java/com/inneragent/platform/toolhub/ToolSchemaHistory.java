package com.inneragent.platform.toolhub;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 工具 schema 指纹变更历史(ia_tool_schema_history,V6;仅追加留痕)。
 *
 * <p>活刷新分诊(V14)每次提交(含 unchanged 静默刷新)落一行,
 * 分诊结论与处理结果可追溯;配合 ia_audit_log 满足「变更留审计」。
 */
@Data
@TableName("ia_tool_schema_history")
public class ToolSchemaHistory {

    /** 主键 ID */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用 */
    @TableField("app_id")
    private Long appId;

    /** 工具 ID(ia_tool_registry.id) */
    private Long toolId;

    /** 工具全限定名 */
    private String fqn;

    /** 变更前 schema SHA-256(首次注册为 NULL) */
    private String previousSha256;

    /** 变更后 schema SHA-256 */
    private String newSha256;

    /** 分诊结论:unchanged/compatible/breaking */
    private String triage;

    /** 处理结果:silent_refresh/applied/pending_review/rejected */
    private String outcome;

    /** 操作者 */
    private String actor;

    /** 差异明细(分诊理由列表 JSON) */
    private String detail;

    /** 创建时间(仅追加) */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}
