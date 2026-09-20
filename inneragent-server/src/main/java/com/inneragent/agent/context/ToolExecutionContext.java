package com.inneragent.agent.context;

public record ToolExecutionContext(Long userId, Integer ownerType, Long ownerId, Long tenantId) {

    public ToolExecutionContext {
        userId = ContextValues.requirePositive(userId, "userId");
        ownerType = ContextValues.requirePositive(ownerType, "ownerType");
        ownerId = ContextValues.requirePositive(ownerId, "ownerId");
        tenantId = ContextValues.requirePositive(tenantId, "tenantId");
    }
}
