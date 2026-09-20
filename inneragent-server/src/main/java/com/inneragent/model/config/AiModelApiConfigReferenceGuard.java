package com.inneragent.model.config;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.model.entity.AiModel;
import com.inneragent.model.mapper.AiModelMapper;
import com.inneragent.platform.common.BusinessException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * ia_ai_model → ia_model_api_config 引用守卫(P2-key)。
 *
 * <p>删除接入配置前按 {@code ia_ai_model.api_config_id} 列引用计数;有引用抛 409。
 * {@code AiModel.deleted} 为 @TableLogic,selectCount 自动过滤逻辑删除行——
 * 已删模型不阻止配置清理(与 AgentWorkspaceStorageReferenceGuard 同口径)。
 */
@Component
@RequiredArgsConstructor
public class AiModelApiConfigReferenceGuard implements ApiConfigReferenceGuard {

    private final AiModelMapper aiModelMapper;

    @Override
    public void assertDeletable(Long apiConfigId) {
        if (apiConfigId == null) {
            return;
        }
        Long count = aiModelMapper.selectCount(new LambdaQueryWrapper<AiModel>()
                .eq(AiModel::getApiConfigId, apiConfigId));
        if (count != null && count > 0) {
            throw new BusinessException(409,
                    "该模型接入配置仍被 " + count + " 个 AI 模型引用,不能删除");
        }
    }
}
