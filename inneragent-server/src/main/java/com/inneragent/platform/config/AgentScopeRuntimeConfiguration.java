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

    @Bean
    @ConditionalOnMissingBean(AgentRuntimeMetrics.class)
    public AgentRuntimeMetrics agentRuntimeMetrics(
            ObjectProvider<io.micrometer.core.instrument.MeterRegistry> registries) {
        return new AgentRuntimeMetrics(registries);
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
