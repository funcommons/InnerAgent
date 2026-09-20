package com.inneragent.server.controller.vo;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

public record AgentStateCleanupPolicySaveReqVO(
        @Min(1) @Max(365) int cleanupIntervalDays,
        @Min(1) @Max(3650) int retentionDays) {
}
