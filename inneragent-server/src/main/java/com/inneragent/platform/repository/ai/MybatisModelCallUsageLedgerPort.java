package com.inneragent.platform.repository.ai;

import com.inneragent.agent.run.ModelCallUsageLedgerPort;
import com.inneragent.agent.run.model.NormalizedModelUsage;
import com.inneragent.platform.enums.ai.AgentModelCallStatus;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * {@link ModelCallUsageLedgerPort} 默认实现:直通
 * {@link AgentModelCallUsageRepository}(台账既有事务边界/幂等/对账语义,
 * AgentModelCallUsageIT 锁定)。经
 * {@code ModelCallUsageLedgerConfiguration} 装配,宿主如需旁路(如压测)
 * 以更高优先级 Bean 覆盖即可。
 */
@Slf4j
@RequiredArgsConstructor
public class MybatisModelCallUsageLedgerPort implements ModelCallUsageLedgerPort {

    private final AgentModelCallUsageRepository repository;

    @Override
    public void start(ModelCallRef call) {
        repository.startCall(
                call.runId(), call.modelCallId(), call.provider(), call.modelCode());
    }

    @Override
    public void complete(ModelCallRef call, NormalizedModelUsage usage) {
        boolean updated = repository.completeCall(
                call.runId(), call.modelCallId(), usage);
        if (!updated) {
            // 无 STARTED 行(如 start 已被同身份幂等短路后异常)——量已丢,留痕降级
            log.debug("[usage-ledger] complete 未命中 STARTED 行: runId={}, modelCallId={}",
                    call.runId(), call.modelCallId());
        }
    }

    @Override
    public void fail(ModelCallRef call, AgentModelCallStatus status) {
        repository.failCall(call.runId(), call.modelCallId(), status);
    }
}
