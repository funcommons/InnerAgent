package com.inneragent.agent.observability;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter;
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporterBuilder;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.sdk.trace.export.SpanExporter;
import io.opentelemetry.sdk.trace.samplers.Sampler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;
import java.util.function.Consumer;

/**
 * OTLP 导出开箱装配(B2):配了 {@code inneragent.observability.otlp.endpoint}
 * 才装配(缺省整体退场,行为同现状),服务内自建 SDK——BatchSpanProcessor
 * 异步导出,采样按 {@code sample-ratio},并把 SDK <strong>单次</strong> set 进
 * {@link GlobalOpenTelemetry}(已被 javaagent 等占用则降级跳过,span 仍走
 * 服务内 bean,不破链路)。容器销毁时 shutdown provider(flush 兜底)。
 *
 * <p>依赖为 optional(opentelemetry-sdk / exporter-otlp),classpath 无
 * exporter 时本配置不加载,api 直连形态(GenAiObservabilityConfiguration)照旧。
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnClass(OtlpHttpSpanExporter.class)
@ConditionalOnProperty(prefix = "inneragent.observability.otlp", name = "endpoint")
@EnableConfigurationProperties(OtlpExportProperties.class)
public class OtlpExportConfiguration {

    private static final Logger log = LoggerFactory.getLogger(OtlpExportConfiguration.class);

    /** 对齐仓内应用名(spring.application.name),Resource 惯例同 PRD「trace 关联」。 */
    private static final String SERVICE_NAME = "inneragent";

    @Bean(destroyMethod = "shutdown")
    SdkTracerProvider sdkTracerProvider(OtlpExportProperties properties, SpanExporter spanExporter) {
        return buildTracerProvider(properties, spanExporter);
    }

    @Bean
    OtlpHttpSpanExporter otlpHttpSpanExporter(OtlpExportProperties properties) {
        OtlpHttpSpanExporterBuilder builder = OtlpHttpSpanExporter.builder()
                .setEndpoint(properties.getEndpoint())
                .setTimeout(Duration.ofMillis(properties.getTimeoutMs()));
        properties.getHeaders().forEach(builder::addHeader);
        return builder.build();
    }

    @Bean
    OpenTelemetrySdk openTelemetry(SdkTracerProvider tracerProvider) {
        OpenTelemetrySdk sdk = OpenTelemetrySdk.builder().setTracerProvider(tracerProvider).build();
        setGlobalOnce(GlobalOpenTelemetry::set, sdk);
        return sdk;
    }

    /** 组装 SDK(测试注入 InMemorySpanExporter 同走此路径)。 */
    static OpenTelemetrySdk buildSdk(OtlpExportProperties properties, SpanExporter spanExporter) {
        return OpenTelemetrySdk.builder().setTracerProvider(
                buildTracerProvider(properties, spanExporter)).build();
    }

    /** 根 span 采样器:TraceIdRatioBased(父子跟随由 provider 默认 ParentBased 包裹)。 */
    static Sampler buildSampler(double sampleRatio) {
        return Sampler.traceIdRatioBased(sampleRatio);
    }

    /**
     * 单次全局注册守卫(纯函数):set 成功 true;{@link GlobalOpenTelemetry#set}
     * 重复注册抛 {@link IllegalStateException} 时吞掉降级 false,不外抛。
     */
    static boolean setGlobalOnce(Consumer<OpenTelemetry> globalSetter, OpenTelemetry openTelemetry) {
        try {
            globalSetter.accept(openTelemetry);
            return true;
        } catch (IllegalStateException alreadyRegistered) {
            log.warn("GlobalOpenTelemetry 已被占用(如 OTel javaagent 先行注册),"
                    + "服务内 SDK 不注册全局,仅作容器内 bean", alreadyRegistered);
            return false;
        }
    }

    private static SdkTracerProvider buildTracerProvider(
            OtlpExportProperties properties, SpanExporter spanExporter) {
        return SdkTracerProvider.builder()
                .setResource(Resource.getDefault().merge(Resource.builder()
                        .put(AttributeKey.stringKey("service.name"), SERVICE_NAME)
                        .build()))
                .setSampler(buildSampler(properties.getSampleRatio()))
                .addSpanProcessor(BatchSpanProcessor.builder(spanExporter).build())
                .build();
    }
}
