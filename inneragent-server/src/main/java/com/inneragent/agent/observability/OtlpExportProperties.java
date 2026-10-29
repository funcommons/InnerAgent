package com.inneragent.agent.observability;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * OTLP 导出配置(B2,前缀 {@code inneragent.observability.otlp})。
 *
 * <p>缺省 {@code endpoint} 为空 ⇒ {@link OtlpExportConfiguration} 整体退场,
 * 行为同「未配置」(GenAI 工厂仍挂全局,导出零变化);配置后服务内自建
 * SDK 导出 OTLP(BatchSpanProcessor 异步,不阻塞 span end)。
 *
 * <p>{@code sample-ratio} 绑定即校验({@code 0 < d ≤ 1}),越界拒绝上下文启动。
 */
@Validated
@ConfigurationProperties(prefix = "inneragent.observability.otlp")
public class OtlpExportProperties {

    /** OTLP/HTTP 接收端 traces 地址(如 {@code http://otel-collector:4318/v1/traces});空=不装配导出。 */
    private String endpoint;

    /** 单次 OTLP 导出超时(毫秒)。 */
    private long timeoutMs = 10_000;

    /** 导出请求附加头(如 {@code headers.authorization=Bearer xx})。 */
    private final Map<String, String> headers = new LinkedHashMap<>();

    /** 根 span 采样比例({@code 0 < d ≤ 1},TraceIdRatioBased);绑定越界即启动失败。 */
    @DecimalMin(value = "0.0", inclusive = false, message = "sampleRatio must be > 0 and <= 1")
    @DecimalMax(value = "1.0", inclusive = true, message = "sampleRatio must be > 0 and <= 1")
    private double sampleRatio = 1.0;

    public String getEndpoint() {
        return endpoint;
    }

    public void setEndpoint(String endpoint) {
        this.endpoint = endpoint;
    }

    public long getTimeoutMs() {
        return timeoutMs;
    }

    public void setTimeoutMs(long timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    public Map<String, String> getHeaders() {
        return headers;
    }

    public double getSampleRatio() {
        return sampleRatio;
    }

    public void setSampleRatio(double sampleRatio) {
        this.sampleRatio = sampleRatio;
    }
}
