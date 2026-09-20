package com.inneragent.platform.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.webhook.WebhookDelivery;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 终态 Webhook 投递记录 Mapper(V11;任务 #18b;置于 platform.mapper 以命中
 * {@code @MapperScan("com.inneragent.platform.mapper")} 扫描)。
 *
 * <p>领取语义与内核 outbox({@code AgentEventMapper} 的 publish claim)同思路:
 * {@code FOR UPDATE SKIP LOCKED} 短锁选候选 + 带 owner/lease 条件的守卫
 * UPDATE 完成领取,多实例并发扫描不会重复投递同一行。
 */
@Mapper
public interface WebhookDeliveryMapper extends BaseMapper<WebhookDelivery> {

    /**
     * 读取应用 Webhook 回调配置(ia_app 为平台级表,无行级注入;
     * url/secret 任一为空即返回空串,由服务层判定跳过)。
     */
    @Select("""
            SELECT COALESCE(webhook_url, '') AS url,
                   COALESCE(webhook_secret, '') AS secret
            FROM ia_app
            WHERE id = #{appId}
              AND deleted = FALSE
            LIMIT 1
            """)
    WebhookConfigRow selectWebhookConfig(@Param("appId") long appId);

    /** 数据库当前时间(UTC;租约/退避计算与 SQL 比较同钟)。 */
    @Select("""
            SELECT (clock_timestamp() AT TIME ZONE 'UTC')
            """)
    LocalDateTime selectDatabaseNow();

    /** 到期待投行(PENDING/FAILED 且 next_retry_at 到期),SKIP LOCKED 短锁选取。 */
    @Select("""
            SELECT *
            FROM ia_webhook_delivery
            WHERE deleted = FALSE
              AND status IN ('PENDING', 'FAILED')
              AND (next_retry_at IS NULL OR next_retry_at <= #{now})
              AND claim_owner IS NULL
            ORDER BY next_retry_at, id
            LIMIT #{limit}
            FOR UPDATE SKIP LOCKED
            """)
    List<WebhookDelivery> selectDueCandidatesForUpdate(
            @Param("now") LocalDateTime now,
            @Param("limit") int limit);

    /** 租约过期的占用行(上次实例崩溃遗留),同样可被领取接管。 */
    @Select("""
            SELECT *
            FROM ia_webhook_delivery
            WHERE deleted = FALSE
              AND status IN ('PENDING', 'FAILED')
              AND claim_owner IS NOT NULL
              AND claim_until <= #{now}
            ORDER BY claim_until, id
            LIMIT #{limit}
            FOR UPDATE SKIP LOCKED
            """)
    List<WebhookDelivery> selectExpiredClaimsForUpdate(
            @Param("now") LocalDateTime now,
            @Param("limit") int limit);

    /**
     * 领取(守卫 UPDATE:状态/到期/租约条件任一不满足即 0 行,调用方跳过)。
     * attempt_count 在领取时预增,与内核 outbox 的 publish_attempts 同型。
     */
    @Update("""
            UPDATE ia_webhook_delivery
            SET claim_owner = #{claimOwner},
                claim_until = #{claimUntil},
                attempt_count = attempt_count + 1
            WHERE id = #{id}
              AND deleted = FALSE
              AND status IN ('PENDING', 'FAILED')
              AND (
                    (claim_owner IS NULL
                     AND (next_retry_at IS NULL OR next_retry_at <= #{now}))
                 OR (claim_owner IS NOT NULL AND claim_until <= #{now})
              )
            """)
    int claimDelivery(
            @Param("id") long id,
            @Param("claimOwner") String claimOwner,
            @Param("claimUntil") LocalDateTime claimUntil,
            @Param("now") LocalDateTime now);

    /** 投递成功:2xx 落 SUCCESS,清租约,记首次成功时间与最近尝试签名。 */
    @Update("""
            UPDATE ia_webhook_delivery
            SET status = 'SUCCESS',
                signature = #{signature},
                url = #{url},
                last_http_status = #{httpStatus},
                last_response = NULL,
                delivered_at = COALESCE(delivered_at, #{now}),
                next_retry_at = NULL,
                claim_owner = NULL,
                claim_until = NULL
            WHERE id = #{id}
              AND claim_owner = #{claimOwner}
              AND claim_until > #{now}
            """)
    int markSuccess(
            @Param("id") long id,
            @Param("claimOwner") String claimOwner,
            @Param("signature") String signature,
            @Param("url") String url,
            @Param("httpStatus") int httpStatus,
            @Param("now") LocalDateTime now);

    /** 失败未达上限:落 FAILED 并按退避写 next_retry_at,清租约。 */
    @Update("""
            UPDATE ia_webhook_delivery
            SET status = 'FAILED',
                signature = #{signature},
                url = #{url},
                last_http_status = #{httpStatus},
                last_response = #{response},
                next_retry_at = #{nextRetryAt},
                claim_owner = NULL,
                claim_until = NULL
            WHERE id = #{id}
              AND claim_owner = #{claimOwner}
              AND claim_until > #{now}
            """)
    int markFailedRetry(
            @Param("id") long id,
            @Param("claimOwner") String claimOwner,
            @Param("signature") String signature,
            @Param("url") String url,
            @Param("httpStatus") Integer httpStatus,
            @Param("response") String response,
            @Param("nextRetryAt") LocalDateTime nextRetryAt,
            @Param("now") LocalDateTime now);

    /** 失败达上限:落 EXHAUSTED(终态,仅手动 redeliver 可复活)。 */
    @Update("""
            UPDATE ia_webhook_delivery
            SET status = 'EXHAUSTED',
                signature = #{signature},
                url = #{url},
                last_http_status = #{httpStatus},
                last_response = #{response},
                next_retry_at = NULL,
                claim_owner = NULL,
                claim_until = NULL
            WHERE id = #{id}
              AND claim_owner = #{claimOwner}
              AND claim_until > #{now}
            """)
    int markExhausted(
            @Param("id") long id,
            @Param("claimOwner") String claimOwner,
            @Param("signature") String signature,
            @Param("url") String url,
            @Param("httpStatus") Integer httpStatus,
            @Param("response") String response,
            @Param("now") LocalDateTime now);

    /** 手动重投:SUCCESS/FAILED/EXHAUSTED 重置回 PENDING 并清空尝试历史。 */
    @Update("""
            UPDATE ia_webhook_delivery
            SET status = 'PENDING',
                attempt_count = 0,
                next_retry_at = #{now},
                delivered_at = NULL,
                last_http_status = NULL,
                last_response = NULL,
                claim_owner = NULL,
                claim_until = NULL
            WHERE id = #{id}
              AND deleted = FALSE
              AND status IN ('SUCCESS', 'FAILED', 'EXHAUSTED')
            """)
    int resetForRedeliver(@Param("id") long id, @Param("now") LocalDateTime now);

    /** 应用回调配置投影(避免 platform 层反向依赖 server.admin 实体)。 */
    record WebhookConfigRow(String url, String secret) {
    }
}
