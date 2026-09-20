package com.inneragent.platform.webhook;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.List;

/**
 * 终态 Webhook 投递配置(任务 #18b,前缀 {@code inneragent.webhook})。
 *
 * <p>重试节奏对齐 02-技术方案 §7.1「HMAC 签名,5 次指数退避重试」:
 * 默认退避 1m/5m/30m/2h/12h、上限 5 次尝试(首投计 1 次);超限落
 * EXHAUSTED,仅管理端 redeliver 可复活。
 */
@ConfigurationProperties(prefix = "inneragent.webhook")
public class WebhookDeliveryProperties {

    /**
     * 投递总开关:false 时终态事件不落投递记录(已存量记录仍会尝试投完)。
     */
    private boolean enabled = true;

    /**
     * 指数退避序列(第 n 次失败后的等待 = backoffs[n-1];超出序列长度
     * 取最后一档)。默认 1m/5m/30m/2h/12h。
     */
    private List<Duration> retryBackoffs = List.of(
            Duration.ofMinutes(1),
            Duration.ofMinutes(5),
            Duration.ofMinutes(30),
            Duration.ofHours(2),
            Duration.ofHours(12));

    /**
     * 单条投递的最大尝试次数(含首投;方案 §7.1「5 次上限」)。
     */
    private int maxAttempts = 5;

    /**
     * 单次投递 HTTP 超时(连接+响应总上限)。
     */
    private Duration httpTimeout = Duration.ofSeconds(10);

    /**
     * 每轮扫描最多领取的投递条数。
     */
    private int batchSize = 50;

    /**
     * claim 租约时长:领取后须在租约内完成投递并落状态,
     * 超期视为实例崩溃,可被其他实例接管接管重投。
     */
    private Duration claimLease = Duration.ofSeconds(30);

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public List<Duration> getRetryBackoffs() {
        return retryBackoffs;
    }

    public void setRetryBackoffs(List<Duration> retryBackoffs) {
        this.retryBackoffs = retryBackoffs;
    }

    public int getMaxAttempts() {
        return maxAttempts;
    }

    public void setMaxAttempts(int maxAttempts) {
        this.maxAttempts = maxAttempts;
    }

    public Duration getHttpTimeout() {
        return httpTimeout;
    }

    public void setHttpTimeout(Duration httpTimeout) {
        this.httpTimeout = httpTimeout;
    }

    public int getBatchSize() {
        return batchSize;
    }

    public void setBatchSize(int batchSize) {
        this.batchSize = batchSize;
    }

    public Duration getClaimLease() {
        return claimLease;
    }

    public void setClaimLease(Duration claimLease) {
        this.claimLease = claimLease;
    }

    /**
     * 第 n 次失败(attemptCount,从 1 计)后的退避档;序列越界取最后一档。
     */
    public Duration backoffAfter(int attemptCount) {
        List<Duration> backoffs = retryBackoffs == null || retryBackoffs.isEmpty()
                ? List.of(Duration.ofMinutes(1))
                : retryBackoffs;
        int index = Math.min(Math.max(attemptCount, 1), backoffs.size()) - 1;
        return backoffs.get(index);
    }
}
