package com.inneragent.platform.webhook;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/**
 * 终态 Webhook 投递记录(ia_webhook_delivery,V11 DDL;任务 #18b)。
 *
 * <p>事件源为运行终态(PRD 最小必要集):RunTerminalCoordinator 在终态
 * 事务提交后落本表,由 {@link WebhookDeliveryScheduler} 以「SKIP LOCKED
 * 领取 + claim 租约」投递(与内核 outbox 同思路,多实例不重投)。
 * 状态机:PENDING →(尝试成功)SUCCESS / →(失败且未达上限)FAILED
 * (next_retry_at 退避)→ / →(达上限)EXHAUSTED;管理端可对
 * SUCCESS/FAILED/EXHAUSTED 手动 redeliver 重置回 PENDING。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ia_webhook_delivery")
public class WebhookDelivery extends BaseEntity {

    /** 状态:待投递(含排队/租约占用中) */
    public static final String STATUS_PENDING = "PENDING";
    /** 状态:尝试失败但未达上限,按退避等待重试 */
    public static final String STATUS_FAILED = "FAILED";
    /** 状态:投递成功(2xx) */
    public static final String STATUS_SUCCESS = "SUCCESS";
    /** 状态:重试耗尽(达 max_attempts),仅手动 redeliver 可复活 */
    public static final String STATUS_EXHAUSTED = "EXHAUSTED";

    /** 主键 ID(亦作 X-IA-Delivery 投递头) */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(ia_app.id;回调配置取该行 webhook_url/webhook_secret) */
    private Long appId;

    /** 事件类型:run.finished/run.failed/run.cancelled */
    private String eventType;

    /** 关联运行 ID */
    private String runId;

    /** 回调地址(入队时快照;每次尝试以 ia_app 当前配置为准) */
    private String url;

    /** 请求体 JSON(入队时冻结;时间戳/nonce 不入体,走签名头) */
    private String payloadJson;

    /** 最近一次尝试的 HMAC-SHA256 签名(hex;对 timestamp.nonce.body) */
    private String signature;

    /** 状态:PENDING/FAILED/SUCCESS/EXHAUSTED */
    private String status;

    /** 已尝试次数(领取时预增) */
    private Integer attemptCount;

    /** 最大尝试次数(入队时按配置快照) */
    private Integer maxAttempts;

    /** 下次可投递时间(NULL 表示立即可投) */
    private LocalDateTime nextRetryAt;

    /** 最近一次尝试的 HTTP 状态码(传输异常为 NULL) */
    private Integer lastHttpStatus;

    /** 最近一次尝试的响应摘要(脱敏截断,≤1024) */
    private String lastResponse;

    /** 首次投递成功时间 */
    private LocalDateTime deliveredAt;

    /** 投递租约持有者(实例+令牌;多实例互斥) */
    private String claimOwner;

    /** 投递租约到期时间(过期可被其他实例接管) */
    private LocalDateTime claimUntil;
}
