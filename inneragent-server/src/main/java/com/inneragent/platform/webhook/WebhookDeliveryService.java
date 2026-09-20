package com.inneragent.platform.webhook;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.platform.mapper.WebhookDeliveryMapper;
import com.inneragent.platform.tenant.TenantContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 终态 Webhook 投递服务(任务 #18b):入队、领取、投递、退避重试。
 *
 * <p>多实例不重投:领取走 {@code FOR UPDATE SKIP LOCKED} 短锁候选 + 守卫
 * UPDATE(状态/到期/租约条件,与内核 outbox 同思路);投递本体在事务外
 * 执行,落状态时以 {@code claim_owner + claim_until} 守卫——租约丢失即
 * 放弃本次结果,由持有方接管,不产生重复状态跃迁。
 *
 * <p>签名:每次尝试以 ia_app 当前 webhook_url/webhook_secret 重签
 * (请求头 {@code X-IA-Signature/X-IA-Timestamp/X-IA-Nonce/X-IA-Delivery}:
 * nonce 参与签名串故必须随头下发,宿主才能复算验签);secret 为空时跳过
 * 签名头并告警(宿主可自行决定是否校验)。
 */
@Service
@Slf4j
public class WebhookDeliveryService {

    /** 事件:运行成功终态(DONE) */
    public static final String EVENT_RUN_FINISHED = "run.finished";
    /** 事件:运行失败终态(ERROR) */
    public static final String EVENT_RUN_FAILED = "run.failed";
    /** 事件:运行取消终态(CANCELLED) */
    public static final String EVENT_RUN_CANCELLED = "run.cancelled";

    private static final int MAX_RESPONSE_LENGTH = 1024;
    private static final int MAX_CLAIM_OWNER_LENGTH = 95;

    private final WebhookDeliveryMapper deliveryMapper;
    private final WebhookDeliveryProperties properties;
    private final PlatformTransactionManager transactionManager;
    private final AtomicBoolean delivering = new AtomicBoolean();
    private volatile WebhookHttpSender sender;

    public WebhookDeliveryService(
            WebhookDeliveryMapper deliveryMapper,
            WebhookDeliveryProperties properties,
            PlatformTransactionManager transactionManager) {
        this.deliveryMapper = Objects.requireNonNull(deliveryMapper, "deliveryMapper");
        this.properties = Objects.requireNonNull(properties, "properties");
        this.transactionManager = Objects.requireNonNull(
                transactionManager, "transactionManager");
        this.sender = new RestClientWebhookHttpSender(properties.getHttpTimeout());
    }

    /**
     * [adapt] 终态事件入口(RunTerminalCoordinator 终态提交后回调)。
     * 纯 fire-and-forget:任何异常只记日志,绝不影响运行终态本身。
     */
    public void onRunTerminal(TerminalEvent event) {
        if (!properties.isEnabled()) {
            return;
        }
        try {
            enqueue(event);
        } catch (Exception failure) {
            log.warn("Webhook delivery enqueue failed: runId={}, type={}",
                    event.runId(), failure.getClass().getSimpleName(), failure);
        }
    }

    private void enqueue(TerminalEvent event) {
        WebhookDeliveryMapper.WebhookConfigRow config =
                deliveryMapper.selectWebhookConfig(event.appId());
        if (config == null || config.url() == null || config.url().isBlank()) {
            return;
        }
        LocalDateTime now = inTransaction(deliveryMapper::selectDatabaseNow);
        ObjectNode payload = JsonNodeFactory.instance.objectNode();
        payload.put("event", event.eventType());
        payload.put("appId", event.appId());
        payload.put("runId", event.runId());
        payload.put("status", event.terminalStatus());
        payload.put("finishedAt", event.finishedAt());
        if (event.errorCode() != null) {
            payload.put("errorCode", event.errorCode());
        }
        if (event.errorMessage() != null) {
            payload.put("errorMessage", event.errorMessage());
        }

        WebhookDelivery delivery = new WebhookDelivery();
        delivery.setAppId(event.appId());
        delivery.setEventType(event.eventType());
        delivery.setRunId(event.runId());
        delivery.setUrl(config.url());
        delivery.setPayloadJson(payload.toString());
        delivery.setStatus(WebhookDelivery.STATUS_PENDING);
        delivery.setAttemptCount(0);
        delivery.setMaxAttempts(properties.getMaxAttempts());
        delivery.setNextRetryAt(now);
        deliveryMapper.insert(delivery);
        log.debug("Webhook delivery enqueued: id={}, runId={}, event={}",
                delivery.getId(), event.runId(), event.eventType());
    }

    /**
     * 领取一批到期投递并逐条投递(调度器入口;系统租户下运行)。
     *
     * @return 本轮实际尝试投递的条数
     */
    public int deliverDueBatch(String instanceIdentity) {
        if (!delivering.compareAndSet(false, true)) {
            return 0;
        }
        try {
            return TenantContext.runAsSystem(() -> deliverDueBatchInternal(instanceIdentity));
        } finally {
            delivering.set(false);
        }
    }

    private int deliverDueBatchInternal(String instanceIdentity) {
        LocalDateTime now = inTransaction(deliveryMapper::selectDatabaseNow);
        String claimToken = claimToken(instanceIdentity);
        LocalDateTime claimUntil = now.plus(properties.getClaimLease());
        List<WebhookDelivery> batch = inTransaction(() -> claimBatch(claimToken, claimUntil, now));
        for (WebhookDelivery delivery : batch) {
            WebhookDeliveryMapper.WebhookConfigRow config =
                    deliveryMapper.selectWebhookConfig(delivery.getAppId());
            attemptOne(delivery, config);
        }
        return batch.size();
    }

    private List<WebhookDelivery> claimBatch(
            String claimToken, LocalDateTime claimUntil, LocalDateTime now) {
        List<WebhookDelivery> claimed = new java.util.ArrayList<>();
        claimCandidates(claimed,
                deliveryMapper.selectDueCandidatesForUpdate(now, properties.getBatchSize()),
                claimToken, claimUntil, now);
        int remaining = properties.getBatchSize() - claimed.size();
        if (remaining > 0) {
            claimCandidates(claimed,
                    deliveryMapper.selectExpiredClaimsForUpdate(now, remaining),
                    claimToken, claimUntil, now);
        }
        return claimed;
    }

    /**
     * 同事务内对短锁候选行执行守卫领取(条件不满足返回 0 的行直接丢弃,
     * 不进入本轮投递);attempt_count 在领取时预增(与内核 outbox 同型)。
     */
    private void claimCandidates(
            List<WebhookDelivery> claimed,
            List<WebhookDelivery> candidates,
            String claimToken,
            LocalDateTime claimUntil,
            LocalDateTime now) {
        for (WebhookDelivery delivery : candidates) {
            int claimedRows = deliveryMapper.claimDelivery(
                    delivery.getId(), claimToken, claimUntil, now);
            if (claimedRows != 1) {
                continue;
            }
            delivery.setClaimOwner(claimToken);
            delivery.setClaimUntil(claimUntil);
            delivery.setAttemptCount(delivery.getAttemptCount() + 1);
            claimed.add(delivery);
        }
    }

    private void attemptOne(WebhookDelivery claimed, WebhookDeliveryMapper.WebhookConfigRow config) {
        try {
            if (config == null || config.url() == null || config.url().isBlank()) {
                // 回调配置在重试等待期被移除:自动重试无意义(配置不会自行恢复),
                // 直接落 EXHAUSTED 可查,宿主重新配置后经管理端 redeliver 复活。
                // url 保留入队快照(列 NOT NULL;本次未外呼)。
                finishExhausted(
                        claimed, null, claimed.getUrl(), null,
                        "webhook config removed before delivery");
                return;
            }
            String timestamp = String.valueOf(System.currentTimeMillis());
            String nonce = UUID.randomUUID().toString().replace("-", "");
            String signature = WebhookSigner.sign(
                    config.secret(), timestamp, nonce, claimed.getPayloadJson());
            WebhookHttpSender.Result result;
            try {
                result = sender.send(
                        config.url(),
                        headers(claimed.getId(), signature, timestamp, nonce),
                        claimed.getPayloadJson());
            } catch (Exception transportFailure) {
                finishFailure(
                        claimed,
                        signature,
                        config.url(),
                        null,
                        transportFailure.getClass().getSimpleName() + ": "
                                + String.valueOf(transportFailure.getMessage()));
                return;
            }
            if (result.statusCode() >= 200 && result.statusCode() < 300) {
                finishSuccess(claimed, signature, config.url(), result.statusCode());
            } else {
                finishFailure(
                        claimed, signature, config.url(), result.statusCode(),
                        result.body());
            }
        } catch (Exception unexpected) {
            // 单条投递的任何意外都不阻断批内后续条目。
            log.warn("Webhook delivery attempt crashed: id={}, type={}",
                    claimed.getId(), unexpected.getClass().getSimpleName(), unexpected);
            finishFailure(
                    claimed, null, claimed.getUrl(), null,
                    unexpected.getClass().getSimpleName());
        }
    }

    private static HttpHeaders headers(
            long deliveryId, String signature, String timestamp, String nonce) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-IA-Delivery", Long.toString(deliveryId));
        headers.set("X-IA-Timestamp", timestamp);
        headers.set("X-IA-Nonce", nonce);
        if (signature != null) {
            headers.set("X-IA-Signature", signature);
        }
        return headers;
    }

    private void finishSuccess(
            WebhookDelivery claimed, String signature, String url, int statusCode) {
        inTransaction(() -> {
            LocalDateTime now = deliveryMapper.selectDatabaseNow();
            int updated = deliveryMapper.markSuccess(
                    claimed.getId(), claimed.getClaimOwner(), signature, url, statusCode, now);
            if (updated != 1) {
                log.debug("Webhook claim lost before success: id={}", claimed.getId());
            }
            return updated;
        });
    }

    private void finishFailure(
            WebhookDelivery claimed,
            String signature,
            String url,
            Integer statusCode,
            String response) {
        inTransaction(() -> {
            LocalDateTime now = deliveryMapper.selectDatabaseNow();
            int attempts = claimed.getAttemptCount();
            String excerpt = truncate(response);
            int updated;
            if (attempts >= claimed.getMaxAttempts()) {
                updated = finishExhausted(claimed, signature, url, statusCode, excerpt);
            } else {
                LocalDateTime nextRetryAt = now.plus(properties.backoffAfter(attempts));
                updated = deliveryMapper.markFailedRetry(
                        claimed.getId(), claimed.getClaimOwner(), signature, url,
                        statusCode, excerpt, nextRetryAt, now);
            }
            if (updated != 1) {
                log.debug("Webhook claim lost before failure bookkeeping: id={}", claimed.getId());
            }
            return updated;
        });
    }

    /** 直落 EXHAUSTED(重试耗尽 / 回调配置被移除;不走退避)。 */
    private int finishExhausted(
            WebhookDelivery claimed,
            String signature,
            String url,
            Integer statusCode,
            String response) {
        return inTransaction(() -> {
            LocalDateTime now = deliveryMapper.selectDatabaseNow();
            int updated = deliveryMapper.markExhausted(
                    claimed.getId(), claimed.getClaimOwner(), signature, url,
                    statusCode, truncate(response), now);
            if (updated != 1) {
                log.debug("Webhook claim lost before exhaustion bookkeeping: id={}",
                        claimed.getId());
            }
            return updated;
        });
    }

    /**
     * 管理端手动重投:SUCCESS/FAILED/EXHAUSTED → PENDING(清空尝试历史)。
     *
     * @return true=已重置;false=记录不存在
     */
    public boolean redeliver(long deliveryId) {
        return Boolean.TRUE.equals(TenantContext.runAsSystem(() ->
                inTransaction(() -> {
                    LocalDateTime now = deliveryMapper.selectDatabaseNow();
                    if (deliveryMapper.selectById(deliveryId) == null) {
                        return Boolean.FALSE;
                    }
                    return deliveryMapper.resetForRedeliver(deliveryId, now) == 1;
                })));
    }

    private String truncate(String response) {
        if (response == null) {
            return null;
        }
        return response.length() <= MAX_RESPONSE_LENGTH
                ? response
                : response.substring(0, MAX_RESPONSE_LENGTH);
    }

    private <T> T inTransaction(java.util.function.Supplier<T> action) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
        T result = transaction.execute(ignored -> action.get());
        return Objects.requireNonNull(result, "Webhook transaction returned no result");
    }

    private String claimToken(String instanceIdentity) {
        String owner = instanceIdentity == null || instanceIdentity.isBlank()
                ? "unknown-instance"
                : instanceIdentity;
        if (owner.length() > MAX_CLAIM_OWNER_LENGTH) {
            owner = owner.substring(0, MAX_CLAIM_OWNER_LENGTH);
        }
        return owner + ':' + UUID.randomUUID().toString().replace("-", "");
    }

    void setSender(WebhookHttpSender sender) {
        this.sender = Objects.requireNonNull(sender, "sender");
    }

    /** 单次投递的 HTTP 发送端(可注入替身用于测试)。 */
    public interface WebhookHttpSender {

        /** 发送 POST;网络/超时异常直接抛出,由服务层按失败处理。 */
        Result send(String url, HttpHeaders headers, String body);

        /** 响应投影:状态码 + 响应体(原始,截断在服务层做)。 */
        record Result(int statusCode, String body) {
        }
    }

    /** 默认实现:Spring RestClient,超时取 {@code inneragent.webhook.http-timeout}。 */
    static final class RestClientWebhookHttpSender implements WebhookHttpSender {

        private final RestClient restClient;

        RestClientWebhookHttpSender(Duration timeout) {
            SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
            factory.setConnectTimeout((int) timeout.toMillis());
            factory.setReadTimeout((int) timeout.toMillis());
            this.restClient = RestClient.builder()
                    .requestFactory(factory)
                    .build();
        }

        @Override
        public Result send(String url, HttpHeaders headers, String body) {
            return restClient.post()
                    .uri(url)
                    .headers(httpHeaders -> httpHeaders.addAll(headers))
                    .body(body)
                    .exchange((request, response) -> new Result(
                            response.getStatusCode().value(),
                            new String(response.getBody().readAllBytes(),
                                    StandardCharsets.UTF_8)));
        }
    }

    /**
     * 终态事件投影(由 RunTerminalCoordinator 装配;与内核解耦的最小字段集)。
     */
    public record TerminalEvent(
            long appId,
            String eventType,
            String runId,
            String terminalStatus,
            String finishedAt,
            String errorCode,
            String errorMessage) {

        public static TerminalEvent of(
                long appId, String eventType, String runId, String terminalStatus) {
            return new TerminalEvent(
                    appId, eventType, runId, terminalStatus,
                    java.time.Instant.now().toString(), null, null);
        }
    }
}
