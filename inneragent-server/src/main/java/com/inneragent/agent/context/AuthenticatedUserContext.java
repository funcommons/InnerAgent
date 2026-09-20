package com.inneragent.agent.context;

public record AuthenticatedUserContext(Long userId) {

    public AuthenticatedUserContext {
        userId = ContextValues.requirePositive(userId, "userId");
    }
}
