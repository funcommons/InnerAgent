package com.inneragent.agent.run;

import com.inneragent.agent.run.model.NormalizedModelUsage;
import reactor.core.publisher.Mono;

/** Replaceable downstream boundary for idempotent model-usage settlement. */
public interface ModelUsageSettlementPort {

    Mono<String> settle(String idempotencyKey, NormalizedModelUsage usage);
}
