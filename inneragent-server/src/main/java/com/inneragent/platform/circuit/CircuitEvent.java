package com.inneragent.platform.circuit;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 熔断事件流水(ia_circuit_event,V14;仅追加,无更新/删除)。
 *
 * <p>web 契约 {@code CircuitBreakerEvent} 形的数据源:type/runId/reason/
 * operator/occurredAt(create_time 以 ISO-8601 序列化),GET /admin/circuit-breaker
 * 的 recentEvents 取最近 20 条。app_id/tenant_id 按 V2 迁移规范携带
 * (行级拦截器对管理请求缺省注入 app_id=1;tenant 无上下文落 DDL 默认 0)。
 */
@TableName("ia_circuit_event")
public class CircuitEvent {

    /** 事件类型:应用级紧急停用 */
    public static final String TYPE_EMERGENCY_STOP = "emergency-stop";
    /** 事件类型:从紧急停用恢复 */
    public static final String TYPE_RESUME = "resume";
    /** 事件类型:管理员强制终止单运行 */
    public static final String TYPE_RUN_TERMINATED = "run-terminated";
    /** 事件类型:资源上限触发(执行层接线待后续,预留值域对齐 mock 契约) */
    public static final String TYPE_LIMIT_TRIGGERED = "limit-triggered";

    /** 主键 ID(web 契约 id,数字) */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(行级拦截器显式注入) */
    private Long appId;

    /** 所属租户 ID(无租户上下文时落 DDL 默认 0) */
    private Long tenantId;

    /** 事件类型:{@link #TYPE_EMERGENCY_STOP} 等 */
    private String type;

    /** 关联运行 ID(应用级事件为 NULL) */
    private String runId;

    /** 事件原因 */
    private String reason;

    /** 操作者(管理会话用户名或 admin 引导通道) */
    private String operator;

    /** 发生时刻(仅追加;web 契约 occurredAt) */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getAppId() {
        return appId;
    }

    public void setAppId(Long appId) {
        this.appId = appId;
    }

    public Long getTenantId() {
        return tenantId;
    }

    public void setTenantId(Long tenantId) {
        this.tenantId = tenantId;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getRunId() {
        return runId;
    }

    public void setRunId(String runId) {
        this.runId = runId;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }

    public String getOperator() {
        return operator;
    }

    public void setOperator(String operator) {
        this.operator = operator;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }
}
