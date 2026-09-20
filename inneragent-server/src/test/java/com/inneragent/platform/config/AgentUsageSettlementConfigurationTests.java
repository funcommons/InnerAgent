package com.inneragent.platform.config;

import com.inneragent.agent.run.AuditLedgerModelUsageSettlementAdapter;
import com.inneragent.agent.run.ModelUsageSettlementPort;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import reactor.core.publisher.Mono;

import static org.assertj.core.api.Assertions.assertThat;

class AgentUsageSettlementConfigurationTests {

    private final ApplicationContextRunner contextRunner =
            new ApplicationContextRunner()
                    .withUserConfiguration(AgentUsageSettlementConfiguration.class);

    @Test
    void bindsExactlyOneProductionAuditLedgerPort() {
        contextRunner.run(context -> {
            assertThat(context).hasSingleBean(ModelUsageSettlementPort.class);
            assertThat(context.getBean(ModelUsageSettlementPort.class))
                    .isInstanceOf(AuditLedgerModelUsageSettlementAdapter.class);
        });
    }

    @Test
    void backsOffWhenAProductBillingAdapterExists() {
        ModelUsageSettlementPort custom = (key, usage) -> Mono.just("billing-1");
        contextRunner.withBean(
                        "customSettlementPort",
                        ModelUsageSettlementPort.class,
                        () -> custom)
                .run(context -> {
                    assertThat(context).hasSingleBean(ModelUsageSettlementPort.class);
                    assertThat(context.getBean(ModelUsageSettlementPort.class))
                            .isSameAs(custom);
                });
    }
}
