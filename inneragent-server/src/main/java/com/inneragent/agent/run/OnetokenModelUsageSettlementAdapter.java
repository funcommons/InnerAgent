package com.inneragent.agent.run;

import com.inneragent.platform.enums.ai.AgentModelCallStatus;
import com.inneragent.platform.repository.ai.AgentModelCallUsageRepository;
import com.inneragent.agent.run.model.NormalizedModelUsage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * 把模型调用的 {@link NormalizedModelUsage} 真实写入 {@code ia_agent_model_call_usage}，
 * 取代原先只返回占位 ID 的 {@link AuditLedgerModelUsageSettlementAdapter}。
 * <p>
 * 通过 {@code @ConditionalOnProperty} 控制：仅当 {@code fusion.onetoken.enabled=true}（或
 * 后续被复用到其他场景）时启用；默认禁用时回退到审计日志占位实现，保持现状。
 */
@Component
@ConditionalOnProperty(prefix = "fusion.onetoken", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class OnetokenModelUsageSettlementAdapter implements ModelUsageSettlementPort {

    private final AgentModelCallUsageRepository usageRepository;

    @Override
    public Mono<String> settle(String idempotencyKey, NormalizedModelUsage usage) {
        return Mono.fromRunnable(() -> applySettlement(idempotencyKey, usage))
                .thenReturn(idempotencyKey);
    }

    private void applySettlement(String idempotencyKey, NormalizedModelUsage usage) {
        if (idempotencyKey == null || !idempotencyKey.contains(":")) {
            log.debug("[onetoken-usage] 跳过无 idempotency key 的用量归集");
            return;
        }
        String[] parts = idempotencyKey.split(":", 2);
        if (parts.length != 2 || parts[0].isBlank() || parts[1].isBlank()) {
            return;
        }
        String runId = parts[0];
        String modelCallId = parts[1];
        try {
            usageRepository.completeCall(runId, modelCallId, usage);
        } catch (Exception exception) {
            // 写入失败不应阻塞主流程：用量回填是后台对账的事
            log.warn("[onetoken-usage] 用量落库失败 runId={} callId={}: {}",
                    runId, modelCallId, exception.getMessage());
        }
    }

    /**
     * 失败记录同样复用 repository 通道。
     */
    public void markFailed(String runId, String modelCallId, AgentModelCallStatus status) {
        try {
            usageRepository.failCall(runId, modelCallId, status);
        } catch (Exception exception) {
            log.warn("[onetoken-usage] 失败记录落库失败 runId={} callId={}: {}",
                    runId, modelCallId, exception.getMessage());
        }
    }
}
