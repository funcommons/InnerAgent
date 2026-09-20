package com.inneragent.server.controller.vo;

import jakarta.validation.constraints.NotBlank;

public record AgentSkillSaveReqVO(
        String originalName,
        @NotBlank String name,
        @NotBlank String displayName,
        @NotBlank String description,
        @NotBlank String content) {
}
