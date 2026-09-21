package com.inneragent.agent.run;

import com.inneragent.agent.run.model.NormalizedModelUsage;
import com.inneragent.platform.enums.ai.AgentModelCallStatus;

/**
 * 模型调用量表({@code ia_agent_model_call_usage})的写入端口(W15 用量统计,
 * 03-开发计划 §7.1;PRD M8「用量统计」P1)。
 *
 * <p>与 {@link ModelUsageSettlementPort}(P2 结算边界,默认审计台账空实现)
 * 并存:本端口负责把每次内核模型调用的生命周期(STARTED → COMPLETED/FAILED/
 * CANCELLED)落进量表白账,供按 应用/用户/日/模型 的聚合统计出数;结算端口仍
 * 独立演进(计费对接时替换 Bean,台账不动)。
 *
 * <p>生命周期与既有对账语义对齐:{@link #start} 落 STARTED 行;运行终态时
 * 存量 STARTED 行由 {@code finishAllStartedForRun} 兜底标 CANCELLED(孤儿
 * 调用对账)。实现必须可在流式线程安全调用,且失败只降级不阻断模型流
 * (调用方负责吞异常)。
 */
public interface ModelCallUsageLedgerPort {

    /** 落 STARTED 行(run 行必须存在且 RUNNING;重复键按同身份幂等)。 */
    void start(ModelCallRef call);

    /** STARTED → COMPLETED 并写归一化 token 用量;无 STARTED 行时返回 false 语义由实现吞并。 */
    void complete(ModelCallRef call, NormalizedModelUsage usage);

    /** STARTED → FAILED/CANCELLED(仅终态;无 STARTED 行时为空操作)。 */
    void fail(ModelCallRef call, AgentModelCallStatus status);

    /**
     * 一次模型调用的定位四元组。
     *
     * @param runId       所属运行 ID(ia_agent_run.run_id)
     * @param modelCallId 内核模型调用 ID(运行内唯一;幂等键 runId+modelCallId)
     * @param provider    模型服务商标识(请求协议归一,如 openai/anthropic)
     * @param modelCode   模型代码标识(ia_ai_model.code)
     */
    record ModelCallRef(
            String runId,
            String modelCallId,
            String provider,
            String modelCode) {
    }
}
