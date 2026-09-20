package com.inneragent.model.config;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.inneragent.model.entity.AiModel;
import com.inneragent.model.mapper.AiModelMapper;
import com.inneragent.model.mapper.ApiConfigMapper;
import com.inneragent.platform.common.BusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 模型接入配置删除引用校验(P2-key,对齐 StorageConfig 的 ReferenceGuard 模式):
 * ia_model_api_config 删除前按 ia_ai_model.api_config_id 列引用计数,
 * 有引用 409(双路径:guard/服务编排单测 + admin API 切片见
 * AdminModelConfigApiTests.deleteConflictsWhenReferencedByModel)。
 */
class ApiConfigDeleteGuardTests {

    private AiModelMapper aiModelMapper;
    private AiModelApiConfigReferenceGuard guard;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        aiModelMapper = mock(AiModelMapper.class);
        guard = new AiModelApiConfigReferenceGuard(aiModelMapper);
    }

    @Test
    @DisplayName("有引用(ia_ai_model.api_config_id 计数 > 0):409,错误信息含计数")
    void throws409WhenReferenced() {
        when(aiModelMapper.selectCount(any(Wrapper.class))).thenReturn(3L);

        assertThatThrownBy(() -> guard.assertDeletable(11L))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(409))
                .hasMessageContaining("3");
    }

    @Test
    @DisplayName("无引用:放行(逻辑删除行不计入,@TableLogic 自动过滤)")
    void passesWhenUnreferenced() {
        when(aiModelMapper.selectCount(any(Wrapper.class))).thenReturn(0L);

        assertThatCode(() -> guard.assertDeletable(11L)).doesNotThrowAnyException();

        verify(aiModelMapper).selectCount(any(Wrapper.class));
    }

    @Test
    @DisplayName("id 为 null:直接放行(与 StorageConfig guard 同防御口径)")
    void passesWhenIdNull() {
        assertThatCode(() -> guard.assertDeletable(null)).doesNotThrowAnyException();
        verify(aiModelMapper, never()).selectCount(any());
    }

    @Test
    @DisplayName("服务编排:guard 抛 409 → 删除中止,deleteById 不执行")
    void serviceDeleteBlockedWhenGuardThrows() {
        ApiConfigMapper apiConfigMapper = mock(ApiConfigMapper.class);
        ApiConfigReferenceGuard blocking = Mockito.mock(ApiConfigReferenceGuard.class);
        Mockito.doThrow(new BusinessException(409, "仍被引用"))
                .when(blocking).assertDeletable(11L);
        ApiConfigService service = new ApiConfigService(
                apiConfigMapper,
                providerOf(),
                providerOf(blocking));

        assertThatThrownBy(() -> service.deleteApiConfig(11L))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(409));
        verify(apiConfigMapper, never()).deleteById(11L);
    }

    @Test
    @DisplayName("服务编排:无引用 → 依次过 guard 后删除成功")
    void serviceDeleteProceedsWhenNoReference() {
        ApiConfigMapper apiConfigMapper = mock(ApiConfigMapper.class);
        when(apiConfigMapper.deleteById(11L)).thenReturn(1);
        ApiConfigReferenceGuard passing = Mockito.mock(ApiConfigReferenceGuard.class);
        ApiConfigService service = new ApiConfigService(
                apiConfigMapper,
                providerOf(),
                providerOf(passing));

        service.deleteApiConfig(11L);

        verify(passing).assertDeletable(11L);
        verify(apiConfigMapper).deleteById(11L);
    }

    @SuppressWarnings("unchecked")
    private static <T> ObjectProvider<T> providerOf(T... items) {
        ObjectProvider<T> provider = mock(ObjectProvider.class);
        when(provider.orderedStream()).thenReturn(List.of(items).stream());
        return provider;
    }
}
