package com.inneragent.model.config;

/**
 * 模型接入配置删除引用校验 SPI(P2-key,对齐
 * {@link com.inneragent.platform.service.storage.StorageConfigReferenceGuard} 模式)。
 *
 * <p>{@code ia_model_api_config} 删除前逐一调用实现;任一实现发现引用即抛
 * {@code BusinessException(409)} 中止删除。生产实现:
 * {@link AiModelApiConfigReferenceGuard}(ia_ai_model.api_config_id 列引用计数)。
 */
@FunctionalInterface
public interface ApiConfigReferenceGuard {

    /**
     * @throws com.inneragent.platform.common.BusinessException 仍被引用时(409)
     */
    void assertDeletable(Long apiConfigId);
}
