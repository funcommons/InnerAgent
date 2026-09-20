package com.inneragent.agent.context;

public record ToolExecutionContext(Long userId, Integer ownerType, Long ownerId, Long tenantId, String runId) {

    public ToolExecutionContext {
        userId = ContextValues.requirePositive(userId, "userId");
        ownerType = ContextValues.requirePositive(ownerType, "ownerType");
        ownerId = ContextValues.requirePositive(ownerId, "ownerId");
        tenantId = ContextValues.requirePositive(tenantId, "tenantId");
        if (runId != null && runId.isBlank()) {
            throw new IllegalArgumentException("runId must not be blank when present");
        }
    }

    /** 兼容构造:不携带运行 ID(resolve_scope 等无运行归属的调用路径)。 */
    public ToolExecutionContext(Long userId, Integer ownerType, Long ownerId, Long tenantId) {
        this(userId, ownerType, ownerId, tenantId, null);
    }
}
