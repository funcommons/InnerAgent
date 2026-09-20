package com.inneragent.server.controller.vo;

import com.inneragent.agent.entity.AgentWorkspaceMigration;

public record AgentWorkspaceConfigRespVO(
        String backendType,
        Long storageConfigId,
        String localPath,
        String migrationStatus,
        Long activeMigrationId,
        long entryCount,
        long contentBytes,
        AgentWorkspaceMigration latestMigration) {
}
