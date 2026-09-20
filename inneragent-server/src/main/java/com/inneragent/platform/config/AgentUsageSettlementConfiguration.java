package com.inneragent.platform.config;

import com.inneragent.agent.run.AuditLedgerModelUsageSettlementAdapter;
import com.inneragent.agent.run.ModelUsageSettlementPort;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 用量归集端口的默认实现([adapt] 自融光 config/AgentUsageSettlementConfiguration.java,
 * 包名 fusion -> platform)。
 *
 * <p>P0 阶段无 onetoken 计费适配器,回退到基于审计台账的空结算实现;
 * P1 如接入宿主计费,以更高优先级 Bean 覆盖即可。
 */
@Configuration(proxyBeanMethods = false)
public class AgentUsageSettlementConfiguration {

    @Bean
    @ConditionalOnMissingBean(ModelUsageSettlementPort.class)
    ModelUsageSettlementPort modelUsageSettlementPort() {
        return new AuditLedgerModelUsageSettlementAdapter();
    }
}
