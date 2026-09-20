package com.inneragent.server.controller.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * /me/models 响应模型(SDK aiModelApi.listByType 消费子集)。
 *
 * <p>[adapt] P1-T3b:对齐 SDK me.ts {@code AiModel} 契约;刻意裁剪管理面字段
 * (config/apiConfigId/maxConcurrency 等)——config 携带模型接入密钥,
 * 用户级端点不得下发。
 */
@Schema(description = "用户可用 AI 模型(SDK 契约字段)")
@Data
public class MeModelRespVO {

    private Long id;
    private String name;
    private String code;
    private String description;
    private Integer status;
    private Boolean defaultModel;
    private Boolean supportVision;
    private List<String> multimodalInputTypes;
    private Map<String, List<String>> multimodalInputTransports;
    private Boolean supportReasoning;
    private List<String> reasoningEffortLevels;
    private Integer contextWindow;
}
