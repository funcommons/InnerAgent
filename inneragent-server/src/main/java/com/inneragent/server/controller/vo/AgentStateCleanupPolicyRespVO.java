package com.inneragent.server.controller.vo;

import java.time.Instant;

public record AgentStateCleanupPolicyRespVO(
        int cleanupIntervalDays,
        int retentionDays,
        Instant nextCleanupAt,
        Instant lastCleanupAt) {
}
