package com.inneragent.platform.circuit;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.common.BusinessException;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * 熔断资源上限配置(web 契约 {@code ResourceLimits} 形,7 字段;V14 落
 * ia_app.circuit_limits_json)。
 *
 * <p>默认值 = 《02-技术方案》§4.7 + web 契约 seed:单运行 32 次工具调用 /
 * 300k token / 30 分钟、幂等只读工具失败重试 2 次、<strong>单宿主 MCP 并发 8
 * / QPS 20</strong>(本版核心)、确认等待 24h(PRD 默认)。
 *
 * <p><strong>执行层接线待后续</strong>:本版仅落库 + 管理面读写(优化建议
 * #2 服务端半的最小实现);内核目录/策略层当前无并发/QPS 挂点,不在本任务
 * 强行重构内核。字段值域对齐 web LIMIT_FIELDS(管理表单 min/max),越界
 * 400(错误语义表:校验失败 400 + 可读文案)。
 */
public record CircuitBreakerLimits(
        int maxToolCallsPerRun,
        long maxTokensPerRun,
        int maxRunDurationMinutes,
        int toolRetryLimit,
        int mcpConcurrency,
        int mcpQps,
        int confirmTimeoutHours) {

    /** §4.7 默认值(与 V14 DDL 列默认 JSON 保持一致,改一处须同步另一处)。 */
    public static final CircuitBreakerLimits DEFAULTS = new CircuitBreakerLimits(
            32, 300_000L, 30, 2, 8, 20, 24);

    /** DDL 默认 JSON(注释引用 {@link #DEFAULTS};供迁移注释/文档对照)。 */
    public static final String DEFAULTS_JSON = """
            {"maxToolCallsPerRun":32,"maxTokensPerRun":300000,"maxRunDurationMinutes":30,\
            "toolRetryLimit":2,"mcpConcurrency":8,"mcpQps":20,"confirmTimeoutHours":24}""";

    /** 全量 JSON 序列化(存 ia_app.circuit_limits_json)。 */
    public String toJson(ObjectMapper mapper) {
        try {
            return mapper.writeValueAsString(this);
        } catch (Exception serializationFailure) {
            throw new IllegalStateException("熔断上限序列化失败", serializationFailure);
        }
    }

    /**
     * 从 ia_app 列值反序列化;空/坏值回退 {@link #DEFAULTS}(存量行/手工改坏
     * 不阻断管理面读,读端自愈)。
     */
    public static CircuitBreakerLimits fromJson(ObjectMapper mapper, String json) {
        if (json == null || json.isBlank()) {
            return DEFAULTS;
        }
        try {
            CircuitBreakerLimits parsed = mapper.readValue(json, CircuitBreakerLimits.class);
            return parsed == null ? DEFAULTS : parsed;
        } catch (Exception invalidJson) {
            return DEFAULTS;
        }
    }

    /**
     * 部分更新(管理面 PUT /limits 语义:仅传入字段生效),返回合并后的全量
     * 配置;越界字段直接 400(不静默钳制,避免「存了 5000 读回 1000」困惑)。
     */
    public CircuitBreakerLimits merge(PartialPatch patch) {
        Objects.requireNonNull(patch, "patch must not be null");
        return validate(new CircuitBreakerLimits(
                patch.maxToolCallsPerRun() != null ? patch.maxToolCallsPerRun() : maxToolCallsPerRun,
                patch.maxTokensPerRun() != null ? patch.maxTokensPerRun() : maxTokensPerRun,
                patch.maxRunDurationMinutes() != null ? patch.maxRunDurationMinutes() : maxRunDurationMinutes,
                patch.toolRetryLimit() != null ? patch.toolRetryLimit() : toolRetryLimit,
                patch.mcpConcurrency() != null ? patch.mcpConcurrency() : mcpConcurrency,
                patch.mcpQps() != null ? patch.mcpQps() : mcpQps,
                patch.confirmTimeoutHours() != null ? patch.confirmTimeoutHours() : confirmTimeoutHours));
    }

    /** 值域校验(对齐 web LIMIT_FIELDS min/max);违规聚合为一条 400 文案。 */
    public CircuitBreakerLimits validate() {
        return validate(this);
    }

    private static CircuitBreakerLimits validate(CircuitBreakerLimits limits) {
        Map<String, String> violations = new LinkedHashMap<>();
        if (limits.maxToolCallsPerRun < 1 || limits.maxToolCallsPerRun > 999) {
            violations.put("maxToolCallsPerRun", "1-999");
        }
        if (limits.maxTokensPerRun < 1000 || limits.maxTokensPerRun > 10_000_000L) {
            violations.put("maxTokensPerRun", "1000-10000000");
        }
        if (limits.maxRunDurationMinutes < 1 || limits.maxRunDurationMinutes > 1440) {
            violations.put("maxRunDurationMinutes", "1-1440");
        }
        if (limits.toolRetryLimit < 0 || limits.toolRetryLimit > 10) {
            violations.put("toolRetryLimit", "0-10");
        }
        if (limits.mcpConcurrency < 1 || limits.mcpConcurrency > 1000) {
            violations.put("mcpConcurrency", "1-1000");
        }
        if (limits.mcpQps < 1 || limits.mcpQps > 10_000) {
            violations.put("mcpQps", "1-10000");
        }
        if (limits.confirmTimeoutHours < 1 || limits.confirmTimeoutHours > 168) {
            violations.put("confirmTimeoutHours", "1-168");
        }
        if (!violations.isEmpty()) {
            throw new BusinessException(400, "熔断上限配置超出值域: " + violations
                    + ",请修正后重试(值域对齐管理站表单提示)");
        }
        return limits;
    }

    /** 部分更新载荷(字段缺省 = 不修改;PUT /limits 的 body.limits 形)。 */
    public record PartialPatch(
            Integer maxToolCallsPerRun,
            Long maxTokensPerRun,
            Integer maxRunDurationMinutes,
            Integer toolRetryLimit,
            Integer mcpConcurrency,
            Integer mcpQps,
            Integer confirmTimeoutHours) {

        /** 是否有任何字段传入(全空 patch = 无变更,管理面回显当前配置)。 */
        public boolean isEmpty() {
            return maxToolCallsPerRun == null && maxTokensPerRun == null
                    && maxRunDurationMinutes == null && toolRetryLimit == null
                    && mcpConcurrency == null && mcpQps == null
                    && confirmTimeoutHours == null;
        }
    }
}
