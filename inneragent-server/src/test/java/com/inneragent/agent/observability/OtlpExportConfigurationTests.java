package com.inneragent.agent.observability;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import io.opentelemetry.sdk.trace.export.SpanExporter;
import io.opentelemetry.sdk.trace.samplers.Sampler;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * OTLP 导出装配测试(B2,docs/升级战役/2026-10-任务板.md)。<strong>先红后绿</strong>:
 * 业务侧 {@link OtlpExportConfiguration} / {@link OtlpExportProperties} 与
 * {@code GenAiObservabilityConfiguration} 的 ObjectProvider 改造落地前,本类整体编译红。
 *
 * <p>对 B2 业务侧的契约(实现须满足):
 * <ul>
 *   <li>{@code OtlpExportProperties}:前缀 {@code inneragent.observability.otlp};
 *       {@code endpoint}(String)/{@code timeoutMs}(默认 10000)/
 *       {@code headers}(Map,默认空)/{@code sampleRatio}(double,默认 1.0,
 *       范围 0&lt;d≤1,<strong>绑定即校验</strong>,越界上下文启动失败);</li>
 *   <li>{@code OtlpExportConfiguration}:
 *       {@code @ConditionalOnClass(OtlpHttpSpanExporter)} +
 *       {@code @ConditionalOnProperty(prefix="inneragent.observability.otlp", name="endpoint")}
 *       (endpoint 未配整体退场);bean 三件套 {@code SdkTracerProvider}
 *       (resource {@code service.name=inneragent},采样器按 sample-ratio)、
 *       {@code OtlpHttpSpanExporter}、{@code OpenTelemetrySdk},并把 SDK
 *       <strong>单次</strong> set 进 {@code GlobalOpenTelemetry}(已占用则降级跳过,
 *       不抛异常);容器销毁 shutdown provider;</li>
 *   <li>包级静态 {@code OpenTelemetrySdk buildSdk(OtlpExportProperties, SpanExporter)}:
 *       span 组装(测试注入 {@link InMemorySpanExporter});用例以 forceFlush 兜底,
 *       不限定 Simple/Batch 处理器;</li>
 *   <li>包级静态 {@code Sampler buildSampler(double)}:0.5 →
 *       {@code TraceIdRatioBased}(描述含 {@code TraceIdRatioBased{0.5}});</li>
 *   <li>包级静态 {@code boolean setGlobalOnce(Consumer<OpenTelemetry> globalSetter,
 *       OpenTelemetry openTelemetry)}:set 成功返回 true;setter 抛
 *       {@code IllegalStateException}(全局已注册)则吞掉返回 false——纯函数,
 *       本类用例不触碰进程级全局;</li>
 *   <li>{@code otelGenAiSpanFactory} 改收 {@code ObjectProvider<OpenTelemetry>}:
 *       有 bean 用 bean,否则回退 {@code GlobalOpenTelemetry.get()}(javaagent 路径不破)。</li>
 * </ul>
 *
 * <p>隔离:所有用例前后 {@link GlobalOpenTelemetry#resetForTest()} 归零进程态,
 * 断言不依赖全局残留;同类用例间亦无共享可变状态(可并行)。
 */
class OtlpExportConfigurationTests {

    private static final String ENDPOINT = "http://127.0.0.1:4318/v1/traces";

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(OtlpExportConfiguration.class);

    @BeforeEach
    void clearGlobalBefore() {
        GlobalOpenTelemetry.resetForTest();
    }

    @AfterEach
    void clearGlobalAfter() {
        GlobalOpenTelemetry.resetForTest();
    }

    @Test
    @DisplayName("endpoint 未配:OTLP 装配整体退场,无 OpenTelemetry/SdkTracerProvider/Exporter bean")
    void backsOffWhenEndpointMissing() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).doesNotHaveBean(OpenTelemetry.class);
            assertThat(context).doesNotHaveBean(SdkTracerProvider.class);
            assertThat(context.getBeansOfType(SpanExporter.class)).isEmpty();
        });
    }

    @Test
    @DisplayName("endpoint 已配:三 bean 在场,且 SDK 已单次 set 进 GlobalOpenTelemetry")
    void beansPresentWhenEndpointConfigured() {
        runner.withPropertyValues(
                        "inneragent.observability.otlp.endpoint=" + ENDPOINT,
                        "inneragent.observability.otlp.timeout-ms=100")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(SdkTracerProvider.class);
                    assertThat(context).hasSingleBean(OpenTelemetry.class);
                    assertThat(context.getBeansOfType(SpanExporter.class)).hasSize(1);
                    assertThat(GlobalOpenTelemetry.isSet())
                            .as("装配时须把 SDK set 进全局(进程态由本类前后归零保证可断言)")
                            .isTrue();
                });
    }

    @Test
    @DisplayName("buildSdk + InMemory 导出器:GenAI span 落地,service.name=inneragent、scope=com.inneragent.genai")
    void buildSdkExportsGenAiSpan() {
        InMemorySpanExporter exporter = InMemorySpanExporter.create();
        OpenTelemetrySdk sdk = OtlpExportConfiguration.buildSdk(
                new OtlpExportProperties(), exporter);
        try {
            new OtelGenAiSpanFactory(sdk, false, 16)
                    .spanBuilder("invoke_agent")
                    .attr(GenAiSemanticAttributes.OPERATION_NAME,
                            GenAiSemanticAttributes.Operations.INVOKE_AGENT)
                    .startSpan()
                    .end();
            sdk.getSdkTracerProvider().forceFlush().join(5, TimeUnit.SECONDS);

            List<SpanData> spans = exporter.getFinishedSpanItems();
            assertThat(spans).hasSize(1);
            assertThat(spans.getFirst().getResource()
                    .getAttribute(AttributeKey.stringKey("service.name")))
                    .isEqualTo("inneragent");
            assertThat(spans.getFirst().getInstrumentationScopeInfo().getName())
                    .isEqualTo("com.inneragent.genai");
        } finally {
            sdk.getSdkTracerProvider().shutdown().join(1, TimeUnit.SECONDS);
        }
    }

    @Test
    @DisplayName("sample-ratio=0.5:采样器为 TraceIdRatioBased(描述含 0.5),provider 采样路径有采有弃")
    void sampleRatioBuildsTraceIdRatioBasedSampler() {
        Sampler sampler = OtlpExportConfiguration.buildSampler(0.5);
        assertThat(sampler.getDescription())
                .contains("TraceIdRatioBased")
                .contains("0.5")
                .doesNotContain("AlwaysOn")
                .doesNotContain("AlwaysOff");

        // provider 接线冒烟:64 个根 span 下既不全采也不全弃(ratio=0.5 退化概率≈2^-63,视为确定)
        InMemorySpanExporter exporter = InMemorySpanExporter.create();
        OtlpExportProperties properties = new OtlpExportProperties();
        properties.setSampleRatio(0.5);
        OpenTelemetrySdk sdk = OtlpExportConfiguration.buildSdk(properties, exporter);
        try {
            for (int i = 0; i < 64; i++) {
                sdk.getTracer("com.inneragent.genai").spanBuilder("s" + i).startSpan().end();
            }
            sdk.getSdkTracerProvider().forceFlush().join(5, TimeUnit.SECONDS);
            List<SpanData> spans = exporter.getFinishedSpanItems();
            assertThat(spans).isNotEmpty();
            assertThat(spans.size()).isLessThan(64);
        } finally {
            sdk.getSdkTracerProvider().shutdown().join(1, TimeUnit.SECONDS);
        }
    }

    @Test
    @DisplayName("setGlobalOnce 守卫(纯函数):首次返回 true,重复返回 false 且不抛异常,不触进程级全局")
    void setGlobalOnceSkipsDuplicateRegistration() {
        List<OpenTelemetry> delivered = new ArrayList<>();
        Consumer<OpenTelemetry> globalLikeSetter = openTelemetry -> {
            if (!delivered.isEmpty()) {
                // 模拟 GlobalOpenTelemetry.set 重复 set 的语义(已实证抛 IllegalStateException)
                throw new IllegalStateException("GlobalOpenTelemetry.set has already been called");
            }
            delivered.add(openTelemetry);
        };

        assertThat(GlobalOpenTelemetry.isSet()).isFalse();
        assertThat(OtlpExportConfiguration.setGlobalOnce(globalLikeSetter, OpenTelemetry.noop()))
                .as("首次注册成功").isTrue();
        assertThat(OtlpExportConfiguration.setGlobalOnce(globalLikeSetter, OpenTelemetry.noop()))
                .as("重复注册降级跳过(吞 IllegalStateException,不抛)").isFalse();
        assertThat(delivered).hasSize(1);
        assertThat(GlobalOpenTelemetry.isSet())
                .as("纯函数守卫不得触碰进程级全局").isFalse();
    }

    @Test
    @DisplayName("属性默认值:timeoutMs=10000、headers 空、sampleRatio=1.0")
    void propertyDefaults() {
        runner.withPropertyValues("inneragent.observability.otlp.endpoint=" + ENDPOINT)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    OtlpExportProperties properties = context.getBean(OtlpExportProperties.class);
                    assertThat(properties.getEndpoint()).isEqualTo(ENDPOINT);
                    assertThat(properties.getTimeoutMs()).isEqualTo(10_000);
                    assertThat(properties.getHeaders()).isEmpty();
                    assertThat(properties.getSampleRatio()).isEqualTo(1.0);
                });
    }

    @Test
    @DisplayName("属性绑定:timeout-ms / headers / sample-ratio 均可覆盖")
    void propertyBindingOverrides() {
        runner.withPropertyValues(
                        "inneragent.observability.otlp.endpoint=" + ENDPOINT,
                        "inneragent.observability.otlp.timeout-ms=2500",
                        "inneragent.observability.otlp.headers.authorization=Bearer test-token",
                        "inneragent.observability.otlp.sample-ratio=0.5")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    OtlpExportProperties properties = context.getBean(OtlpExportProperties.class);
                    assertThat(properties.getTimeoutMs()).isEqualTo(2500);
                    assertThat(properties.getHeaders())
                            .containsEntry("authorization", "Bearer test-token");
                    assertThat(properties.getSampleRatio()).isEqualTo(0.5);
                });
    }

    @Test
    @DisplayName("sample-ratio 范围校验(0<d≤1):0 与 1.5 均拒绝启动,报错含 sampleRatio")
    void invalidSampleRatioFailsContextStartup() {
        for (String ratio : new String[] {"0", "1.5"}) {
            runner.withPropertyValues(
                            "inneragent.observability.otlp.endpoint=" + ENDPOINT,
                            "inneragent.observability.otlp.sample-ratio=" + ratio)
                    .run(context -> {
                        assertThat(context).hasFailed();
                        assertThat(context.getStartupFailure())
                                .hasStackTraceContaining("sampleRatio");
                    });
        }
    }

    @Test
    @DisplayName("GenAI 工厂改造:上下文有 OpenTelemetry bean 时工厂用该 bean(span 进其导出器)")
    void genAiFactoryUsesContextOpenTelemetryBean() {
        InMemorySpanExporter exporter = InMemorySpanExporter.create();
        new ApplicationContextRunner()
                .withUserConfiguration(GenAiObservabilityConfiguration.class)
                .withBean("probeOpenTelemetry", OpenTelemetry.class, () -> sdkOver(exporter))
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    GenAiSpanFactory factory = context.getBean(GenAiSpanFactory.class);
                    assertThat(factory.isNoop()).isFalse();
                    factory.spanBuilder("invoke_agent")
                            .attr(GenAiSemanticAttributes.OPERATION_NAME,
                                    GenAiSemanticAttributes.Operations.INVOKE_AGENT)
                            .startSpan()
                            .end();
                    // span 落在探针导出器 ⇔ 工厂拿的是上下文里的 OpenTelemetry bean
                    assertThat(exporter.getFinishedSpanItems()).hasSize(1);
                });
    }

    @Test
    @DisplayName("GenAI 工厂改造:无 OpenTelemetry bean 时回退全局(此处为 noop),span API 不抛异常")
    void genAiFactoryFallsBackToGlobalWithoutOtelBean() {
        assertThat(GlobalOpenTelemetry.isSet()).isFalse();
        new ApplicationContextRunner()
                .withUserConfiguration(GenAiObservabilityConfiguration.class)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(GenAiSpanFactory.class);
                    GenAiSpanFactory factory = context.getBean(GenAiSpanFactory.class);
                    assertThatCode(() -> factory.spanBuilder("chat").startSpan().end())
                            .doesNotThrowAnyException();
                });
    }

    /** 探针用 SDK:SimpleSpanProcessor 同步落地,断言免 flush(仅测试态,不注册全局)。 */
    private static OpenTelemetrySdk sdkOver(InMemorySpanExporter exporter) {
        return OpenTelemetrySdk.builder()
                .setTracerProvider(SdkTracerProvider.builder()
                        .addSpanProcessor(SimpleSpanProcessor.create(exporter))
                        .build())
                .build();
    }
}
