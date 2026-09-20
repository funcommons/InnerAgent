package com.inneragent.model.provider;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.model.entity.ApiConfig;
import com.inneragent.platform.service.ai.model.AiModelMetadataResolver;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class AiProviderContextFactoryTests {

    @Test
    void createForApiConfigNormalizesLegacyOpenAiPlatform() {
        AiProviderContextFactory factory = new AiProviderContextFactory(null, mock(AiModelMetadataResolver.class));

        AiProviderContext context = factory.createForApiConfig(
                ApiConfig.builder().platform("openai").apiUrl("https://api.openai.com").build());

        assertThat(context.getPlatform()).isEqualTo("openai_compatible");
    }

    @Test
    void createForApiConfigRequiresExplicitAccessType() {
        AiProviderContextFactory factory = new AiProviderContextFactory(null, mock(AiModelMetadataResolver.class));

        assertThatThrownBy(() -> factory.createForApiConfig(
                ApiConfig.builder().apiUrl("https://api.openai.com").build()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("接入与鉴权类型");
    }
}
