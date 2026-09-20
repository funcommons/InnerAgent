package com.inneragent.agent.workspace;

public record AgentWorkspaceStoredPayload(
        String backendType,
        Long storageConfigId,
        String localPath,
        String contentRef,
        String databasePayload,
        String sha256,
        long size) {
}
