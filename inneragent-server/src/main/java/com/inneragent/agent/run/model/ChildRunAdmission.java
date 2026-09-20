package com.inneragent.agent.run.model;

import com.inneragent.platform.enums.ai.AgentRunStatus;

import java.util.Objects;

/** Result of idempotently admitting a platform child run. */
public record ChildRunAdmission(
        StartedAgentRun run,
        AgentRunStatus status,
        boolean created) {

    public ChildRunAdmission {
        Objects.requireNonNull(run, "run must not be null");
        Objects.requireNonNull(status, "status must not be null");
        if (created && status != AgentRunStatus.RUNNING) {
            throw new IllegalArgumentException("a newly created child run must be RUNNING");
        }
    }
}
