package com.inneragent.platform.config;

import com.inneragent.agent.run.AgentRuntimeMetrics;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.autoconfigure.metrics.CompositeMeterRegistryAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.metrics.MetricsAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.metrics.export.prometheus.PrometheusMetricsExportAutoConfiguration;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IA-1 指标出口装配测试(docs/灰度与指标大盘.md §7.1 台账 IA-1,W9 双跑前阻塞项):
 * <ul>
 *   <li>classpath 有 Prometheus 导出器时,{@link AgentScopeRuntimeConfiguration}
 *       装配的 {@link com.inneragent.agent.run.AgentRuntimeMetrics} 必须注册进
 *       <strong>Spring 管理的</strong> MeterRegistry(prometheus 复合注册表),
 *       抓取文本即含 {@code fusion.agentscope.runtime} 前缀的真实指标行——
 *       进程内 SimpleMeterRegistry 回退只属于测试态,不得出现在该场景;</li>
 *   <li>无任何导出器时(纯测试切片),上下文仍可启动,回退语义不破。</li>
 * </ul>
 */
class AgentMetricsAssemblyTests {

    /** 切片无 DataSource:状态存储按内存模式装配(本测试只关心指标装配) */
    private static final String[] BASE_PROPS = {
            "management.prometheus.metrics.export.enabled=true",
            "fusion.agentscope.v2.state.mode=in-memory"};

    private final ApplicationContextRunner prometheusRunner = new ApplicationContextRunner()
            .withPropertyValues(BASE_PROPS)
            .withConfiguration(AutoConfigurations.of(
                    CompositeMeterRegistryAutoConfiguration.class,
                    MetricsAutoConfiguration.class,
                    PrometheusMetricsExportAutoConfiguration.class));

    @Test
    @DisplayName("IA-1:prometheus 导出器在场,MeterRegistry 由 Spring 装配且指标可抓取")
    void springManagedRegistryReceivesRuntimeMetricsWhenPrometheusPresent() {
        prometheusRunner.withUserConfiguration(AgentScopeRuntimeConfiguration.class)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    // Spring 管理的注册表在场(组合或 prometheus 直接暴露,主候选必有)
                    assertThat(context.getBean(MeterRegistry.class)).isNotNull();
                    assertThat(context.getBean(PrometheusMeterRegistry.class)).isNotNull();
                    // AgentRuntimeMetrics 注册进了 Spring 管理的注册表:抓取文本
                    // 即见真实指标行(名称按 Micrometer->Prometheus 改名:.
                    // ->_ ,counter 补 _total,timer 补 _seconds_*)
                    PrometheusMeterRegistry prometheus =
                            context.getBean(PrometheusMeterRegistry.class);
                    String scrape = prometheus.scrape();
                    assertThat(scrape)
                            .contains("fusion_agentscope_runtime_runs_active")
                            .contains("fusion_agentscope_runtime_runs_terminal_total")
                            .contains("fusion_agentscope_runtime_state_latency_seconds_count");
                    // 注入的是 Spring 管理 Bean,而非装配点自建的 SimpleMeterRegistry:
                    // 自建注册表不可抓取(台账 IA-1 的病灶),以「抓取文本含指标」为证
                    assertThat(scrape)
                            .as("prometheus 抓取必须含运行时 gauge(非空值路径)与 counter")
                            .contains("fusion_agentscope_runtime_outbox_backlog");
                });
    }

    @Test
    @DisplayName("IA-1:无导出器(纯测试态)上下文照常启动,回退语义不破")
    void contextStillBootsWithoutAnyMeterRegistryBean() {
        new ApplicationContextRunner()
                .withPropertyValues("fusion.agentscope.v2.state.mode=in-memory")
                .withUserConfiguration(AgentScopeRuntimeConfiguration.class)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    // AgentRuntimeMetrics 可达(内部回退自建 SimpleMeterRegistry)
                    assertThat(context).hasSingleBean(AgentRuntimeMetrics.class);
                    // 测试态确实没有 Spring 管理的注册表(证明上一条走的是回退)
                    assertThat(context.getBeansOfType(MeterRegistry.class)).isEmpty();
                });
    }
}
