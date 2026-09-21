package com.inneragent.platform.config;

import com.inneragent.agent.run.ModelCallUsageLedgerPort;
import com.inneragent.platform.repository.ai.AgentModelCallUsageRepository;
import com.inneragent.platform.repository.ai.MybatisModelCallUsageLedgerPort;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 模型调用量表写入端口装配(W15 用量统计,PRD M8「用量统计」P1)。
 *
 * <p>[adapt] 形态对齐 {@link AgentUsageSettlementConfiguration}(P2 结算
 * 端口,默认空结算):默认直通 {@code ia_agent_model_call_usage} 台账;
 * 宿主侧如需自管用量,以更高优先级 Bean 覆盖
 * {@link ModelCallUsageLedgerPort} 即可(旁路不阻断模型流,挂点侧吞异常)。
 */
@Configuration(proxyBeanMethods = false)
public class ModelCallUsageLedgerConfiguration {

    @Bean
    @ConditionalOnMissingBean(ModelCallUsageLedgerPort.class)
    ModelCallUsageLedgerPort modelCallUsageLedgerPort(
            AgentModelCallUsageRepository usageRepository) {
        return new MybatisModelCallUsageLedgerPort(usageRepository);
    }
}
