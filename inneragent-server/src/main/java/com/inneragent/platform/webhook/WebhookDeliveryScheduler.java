package com.inneragent.platform.webhook;

import com.inneragent.agent.run.AgentRuntimeInstanceIdentity;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 终态 Webhook 投递调度器(任务 #18b)。
 *
 * <p>形态对齐 {@code AgentEventOutboxScheduler}:固定间隔扫描 + 单飞锁;
 * 领取侧由 {@code FOR UPDATE SKIP LOCKED + claim 租约}保证多实例不重投。
 */
@Component
@Slf4j
public final class WebhookDeliveryScheduler {

    private final WebhookDeliveryService service;
    private final AgentRuntimeInstanceIdentity instanceIdentity;
    private final AtomicBoolean running = new AtomicBoolean();

    public WebhookDeliveryScheduler(
            WebhookDeliveryService service,
            AgentRuntimeInstanceIdentity instanceIdentity) {
        this.service = Objects.requireNonNull(service, "service must not be null");
        this.instanceIdentity = Objects.requireNonNull(
                instanceIdentity, "instanceIdentity must not be null");
    }

    @Scheduled(
            initialDelayString =
                    "${inneragent.webhook.scan-initial-delay-ms:5000}",
            fixedDelayString =
                    "${inneragent.webhook.scan-delay-ms:30000}")
    public void deliver() {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        try {
            service.deliverDueBatch(instanceIdentity.value());
        } catch (Exception failure) {
            log.error("Webhook delivery scan failed: type={}",
                    failure.getClass().getSimpleName(), failure);
        } finally {
            running.set(false);
        }
    }
}
