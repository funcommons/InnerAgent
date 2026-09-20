package com.inneragent.server.controller.vo;

import jakarta.validation.constraints.NotBlank;

public record AgentWorkspaceMigrateReqVO(
        @NotBlank String backendType,
        Long storageConfigId,
        String localPath) {
}
