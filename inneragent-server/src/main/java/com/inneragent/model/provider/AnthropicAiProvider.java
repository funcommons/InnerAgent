package com.inneragent.model.provider;

import cn.hutool.core.util.StrUtil;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.MessageParam;
import com.anthropic.models.messages.OutputConfig;
import com.inneragent.server.controller.vo.RemoteModelVO;
import com.inneragent.platform.service.ai.proxy.AiProxySupport;
import io.agentscope.core.formatter.MediaUtils;
import io.agentscope.core.message.AudioBlock;
import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.DataBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.Source;
import io.agentscope.core.message.VideoBlock;
import io.agentscope.core.model.ChatModelBase;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.transport.ProxyConfig;
import io.agentscope.extensions.model.anthropic.AnthropicChatModel;
import io.agentscope.extensions.model.anthropic.formatter.AnthropicChatFormatter;
import org.springframework.ai.anthropic.AnthropicChatOptions;
import org.springframework.ai.anthropic.api.AnthropicApi;
import org.springframework.ai.chat.model.ChatModel;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Anthropic 提供商。
 */
@Component
@Slf4j
public class AnthropicAiProvider extends AbstractAiProvider {

    @Override
    public boolean supports(String platform) {
        return platform != null && "anthropic".equalsIgnoreCase(platform);
    }

    @Override
    public ChatModel createChatModel(AiProviderContext context) {
        requireApiKey(context.getApiKey(), "Anthropic");

        AnthropicApi.Builder apiBuilder = AnthropicApi.builder().apiKey(context.getApiKey());
        apiBuilder.restClientBuilder(AiProxySupport.restClientBuilder(
            context.getApiConfig(), 60 * 1000, 25 * 60 * 1000));
        apiBuilder.webClientBuilder(AiProxySupport.webClientBuilder(
            context.getApiConfig(), "anthropic-provider", Duration.ofMinutes(25)));
        String rootBaseUrl = resolveRootBaseUrl(context.getBaseUrl());
        if (StrUtil.isNotBlank(rootBaseUrl)) {
            apiBuilder.baseUrl(rootBaseUrl);
        }

        AnthropicChatOptions.Builder optionsBuilder = AnthropicChatOptions.builder()
                .model(context.getModelName());
        applyDouble(context.getConfig(), "temperature", optionsBuilder::temperature);
        applyDouble(context.getConfig(), "topP", optionsBuilder::topP);
        applyInt(context.getConfig(), "maxTokens", optionsBuilder::maxTokens);

        return org.springframework.ai.anthropic.AnthropicChatModel.builder()
                .anthropicApi(apiBuilder.build())
                .defaultOptions(optionsBuilder.build())
                .build();
    }

    @Override
    public ChatModelBase createAgentScopeModel(AiProviderContext context) {
        requireApiKey(context.getApiKey(), "Anthropic");
        GenerateOptions defaultOptions = buildReasoningOptions(context);
        String rootBaseUrl = resolveRootBaseUrl(context.getBaseUrl());
        AnthropicChatModel.Builder builder = AnthropicChatModel.builder()
                .apiKey(context.getApiKey())
                .modelName(context.getModelName())
                .stream(true)
                .formatter(agentScopeFormatter())
                .baseUrl(rootBaseUrl);
        if (defaultOptions != null) {
            builder.defaultOptions(defaultOptions);
        }
        ProxyConfig proxy = AiProxySupport.agentScopeProxyConfig(context.getApiConfig());
        if (proxy != null) {
            builder.proxy(proxy);
        }
        return builder.build();
    }

    @Override
    public List<RemoteModelVO> listRemoteModels(AiProviderContext context) {
        requireApiKey(context.getApiKey(), "Anthropic");
        String apiBaseUrl = ensurePathSuffix(resolveRootBaseUrl(context.getBaseUrl()), "/v1");
        String url = joinUrl(apiBaseUrl, "/models");
        log.info("[AnthropicAiProvider] 获取远程模型列表: {}", url);

        String response = executeGet(url, Map.of(
                "x-api-key", context.getApiKey(),
                "anthropic-version", "2023-06-01"
        ), context.getApiConfig());
        return parseDataArrayModels(response, "anthropic");
    }

    private GenerateOptions buildReasoningOptions(AiProviderContext context) {
        GenerateOptions.Builder builder = GenerateOptions.builder();
        boolean hasOptions = false;

        Object thinking = getConfigValue(context.getConfig(), "thinking");
        if (thinking != null) {
            builder.additionalBodyParam("thinking", thinking);
            hasOptions = true;
        } else if (isReasoningEnabled(context)) {
            Integer thinkingBudget = getConfigInteger(context.getConfig(), "thinkingBudget", "thinking_budget");
            int budgetTokens = thinkingBudget != null ? thinkingBudget : 1024;
            builder.thinkingBudget(budgetTokens);
            builder.additionalBodyParam("thinking", Map.of(
                    "type", "enabled",
                    "budget_tokens", budgetTokens));
            hasOptions = true;
        }

        String reasoningEffort = getConfigString(
                context.getConfig(), "reasoningEffort", "reasoning_effort");
        if (StrUtil.isNotBlank(reasoningEffort)) {
            builder.reasoningEffort(reasoningEffort);
            hasOptions = true;
        }

        return hasOptions ? builder.build() : null;
    }

    static AnthropicChatFormatter agentScopeFormatter() {
        return new ReasoningEffortAnthropicFormatter();
    }

    private static final class ReasoningEffortAnthropicFormatter extends AnthropicChatFormatter {

        @Override
        public void applyOptions(
                MessageCreateParams.Builder paramsBuilder,
                GenerateOptions options,
                GenerateOptions defaultOptions) {
            super.applyOptions(paramsBuilder, options, defaultOptions);
            GenerateOptions merged = GenerateOptions.mergeOptions(options, defaultOptions);
            if (merged == null || StrUtil.isBlank(merged.getReasoningEffort())) {
                return;
            }
            paramsBuilder.outputConfig(OutputConfig.builder()
                    .effort(OutputConfig.Effort.of(merged.getReasoningEffort().trim()))
                    .build());
        }

        /**
         * A3(升级战役 2026-10):anthropic messages 协议只支持图片多模态。库默认实现会把
         * video/audio 块静默丢弃(纯 audio 消息整条蒸发)、把非图片 DataBlock 降级为
         * "[Media - processing failed: …]" 占位文本发给模型;这里在格式化前显式拒绝,
         * 口径与 OpenAiResponsesAgentScopeModel 的 audio/video 显式不支持一致。
         */
        @Override
        public List<MessageParam> doFormat(List<Msg> msgs) {
            rejectUnsupportedMultimodalBlocks(msgs);
            return super.doFormat(msgs);
        }

        private static void rejectUnsupportedMultimodalBlocks(List<Msg> msgs) {
            for (Msg msg : msgs) {
                for (ContentBlock block : msg.getContent()) {
                    if (block instanceof VideoBlock videoBlock) {
                        throw new IllegalArgumentException(
                                "Anthropic API does not support video input blocks: "
                                        + sourceMimeType(videoBlock.getSource()));
                    } else if (block instanceof AudioBlock audioBlock) {
                        throw new IllegalArgumentException(
                                "Anthropic API does not support audio input blocks: "
                                        + sourceMimeType(audioBlock.getSource()));
                    } else if (block instanceof DataBlock dataBlock) {
                        String mimeType = sourceMimeType(dataBlock.getSource());
                        if (!mimeType.startsWith("image/")) {
                            throw new IllegalArgumentException(
                                    "Anthropic API only supports image DataBlocks; got MIME type: "
                                            + mimeType);
                        }
                    }
                }
            }
        }

        /** MIME 解析不出来时回退占位值,保证拒绝消息始终能拼出完整口径而不是次生异常。 */
        private static String sourceMimeType(Source source) {
            try {
                return MediaUtils.resolveMimeType(source);
            } catch (RuntimeException e) {
                return "unknown";
            }
        }
    }

    private String resolveRootBaseUrl(String baseUrl) {
        return StrUtil.isBlank(baseUrl) ? "https://api.anthropic.com" : normalizeBaseUrl(baseUrl);
    }
}
