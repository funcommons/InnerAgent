package com.inneragent.model.provider;

import com.inneragent.model.entity.AiModel;
import com.inneragent.model.entity.ApiConfig;
import lombok.Builder;
import lombok.Value;

import java.util.Map;

/**
 * 提供商执行时需要的统一上下文。
 */
@Value
@Builder
public class AiProviderContext {

    AiModel model;

    ApiConfig apiConfig;

    @Builder.Default
    Map<String, Object> config = Map.of();

    String platform;

    String apiKey;

    String baseUrl;

    String modelName;
}