package com.inneragent.agent.observability;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Tracer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * GenAI 可观测装配(任务 #18b)。
 *
 * <p>桥接选择(技术方案未定,选 otel-api 直连,报告说明):classpath 有
 * {@code io.opentelemetry.api.trace.Tracer}(agentscope-core 传递携带;
 * pom 以 opentelemetry-bom 钉版)时,工厂挂 {@code GlobalOpenTelemetry}——
 * 缺省 noop,部署侧以 OTel javaagent / SDK 注册 provider 后生效;
 * 否则回落全 noop 工厂。B2 起:上下文有 OpenTelemetry bean
 * (OtlpExportConfiguration 配 endpoint 后自建)则工厂优先用它,
 * 无 bean 再回退全局(采样与导出由 OtlpExportConfiguration 承接)。
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(GenAiObservabilityProperties.class)
public class GenAiObservabilityConfiguration {

    @Bean
    @ConditionalOnClass(name = "io.opentelemetry.api.trace.Tracer")
    @ConditionalOnMissingBean(GenAiSpanFactory.class)
    public GenAiSpanFactory otelGenAiSpanFactory(
            GenAiObservabilityProperties properties, ObjectProvider<OpenTelemetry> openTelemetry) {
        // B2:上下文有 OpenTelemetry bean(如 OtlpExportConfiguration 自建 SDK)则优先;
        // 无 bean(javaagent / 缺省)回退 GlobalOpenTelemetry.get(),形态不破。
        OpenTelemetry otel = openTelemetry.getIfAvailable();
        if (otel != null) {
            return new OtelGenAiSpanFactory(
                    otel, properties.isCaptureContent(), properties.getContentMaxChars());
        }
        return OtelGenAiSpanFactory.global(
                properties.isCaptureContent(), properties.getContentMaxChars());
    }

    @Bean
    @ConditionalOnMissingBean(GenAiSpanFactory.class)
    public GenAiSpanFactory noopGenAiSpanFactory() {
        return GenAiSpanFactory.noop();
    }
}
