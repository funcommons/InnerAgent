package com.inneragent.platform.config;

import com.inneragent.agent.run.AgentRuntimeMetrics;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.state.AgentScopeStateStoreFactory;
import com.inneragent.agent.state.AgentStatePreflight;
import com.inneragent.agent.state.InMemoryStateStoreFailureGuard;
import com.inneragent.agent.state.StateStoreFailureGuard;
import io.agentscope.core.state.AgentStateStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;

/**
 * AgentScope 内核运行时装配([adapt] 自融光 config/AgentScopeRuntimeConfiguration.java,
 * 包名 fusion -> platform,依赖类按 com.inneragent 包结构收敛)。
 *
 * <p>注册内核运行时的可注入协作对象:有界调度器、Micrometer 门面、状态存储
 * (Postgres/内存双模)、状态预检与失败熔断守卫,并启用两个配置属性类。
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({AgentScopeRuntimeProperties.class, AgentScopeV2Properties.class})
public class AgentScopeRuntimeConfiguration {

    /**
     * Micrometer 门面(IA-1 指标出口,docs/灰度与指标大盘.md §7.1):注入
     * <strong>Spring 管理的</strong> MeterRegistry——classpath 有 actuator +
     * micrometer-registry-prometheus(pom 已引)时即 PrometheusMeterRegistry
     * 或其复合注册表,meters 由 /actuator/prometheus 抓取;纯测试切片无注册表
     * Bean 时回退进程内 SimpleMeterRegistry(不可抓取,仅保语义不破)。
     */
    @Bean
    @ConditionalOnMissingBean(AgentRuntimeMetrics.class)
    public AgentRuntimeMetrics agentRuntimeMetrics(
            ObjectProvider<io.micrometer.core.instrument.MeterRegistry> registries) {
        return new AgentRuntimeMetrics(registries);
    }

    /**
     * 业务计数门面(IA-2/IA-3/IA-4,docs/灰度与指标大盘.md §7.1;P4 差距
     * 收口):工具终态/确认终态/会话级重连 counter。registry 注入模式同
     * {@link AgentRuntimeMetrics}(IA-1),缺 Bean 时测试切片回退进程内
     * SimpleMeterRegistry。
     */
    @Bean
    @ConditionalOnMissingBean(com.inneragent.platform.metrics.IaBusinessMetrics.class)
    public com.inneragent.platform.metrics.IaBusinessMetrics iaBusinessMetrics(
            ObjectProvider<io.micrometer.core.instrument.MeterRegistry> registries) {
        return new com.inneragent.platform.metrics.IaBusinessMetrics(registries);
    }

    @Bean(destroyMethod = "close")
    public AgentRuntimeSchedulers agentRuntimeSchedulers(
            AgentScopeRuntimeProperties properties,
            AgentRuntimeMetrics metrics) {
        return new AgentRuntimeSchedulers(properties, metrics);
    }

    @Bean
    public StateStoreFailureGuard stateStoreFailureGuard() {
        return new InMemoryStateStoreFailureGuard();
    }

    @Bean
    public AgentScopeStateStoreFactory agentScopeStateStoreFactory(
            StateStoreFailureGuard failures,
            AgentRuntimeMetrics metrics) {
        return new AgentScopeStateStoreFactory(failures, metrics);
    }

    @Bean(destroyMethod = "close")
    @Primary
    public AgentStateStore agentScopeStateStore(
            AgentScopeStateStoreFactory factory,
            ObjectProvider<DataSource> dataSourceProvider,
            AgentScopeV2Properties v2Properties) {
        AgentScopeV2Properties.State state = v2Properties.getState();
        if (state.getMode() == AgentScopeV2Properties.Mode.IN_MEMORY) {
            return factory.createInMemory();
        }
        DataSource dataSource = dataSourceProvider.getIfAvailable();
        if (dataSource == null) {
            throw new IllegalStateException(
                    "DataSource is required when fusion.agentscope.v2.state.mode=postgres");
        }
        return factory.createPostgres(dataSource, state.getTableName());
    }

    @Bean
    public AgentStatePreflight agentStatePreflight(
            AgentStateStore store,
            StateStoreFailureGuard failures,
            AgentRuntimeSchedulers schedulers) {
        return new AgentStatePreflight(store, failures, schedulers);
    }
}
