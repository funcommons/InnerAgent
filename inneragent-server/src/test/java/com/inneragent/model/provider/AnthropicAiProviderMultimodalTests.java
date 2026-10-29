package com.inneragent.model.provider;

import com.anthropic.core.ObjectMappers;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.MessageParam;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.json.JsonMapper;
import io.agentscope.core.message.AudioBlock;
import io.agentscope.core.message.Base64Source;
import io.agentscope.core.message.DataBlock;
import io.agentscope.core.message.ImageBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.VideoBlock;
import io.agentscope.extensions.model.anthropic.formatter.AnthropicChatFormatter;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * A3(升级战役 2026-10):Anthropic 路径的多模态块 → anthropic messages content block 映射。
 *
 * <p>测试出口:provider 的真实请求构建在 agentscope 扩展库的网络客户端内,仓库侧最小可测出口是
 * {@link AnthropicAiProvider#agentScopeFormatter()}(createAgentScopeModel 装进 AnthropicChatModel
 * 的正是这个 formatter)。用例按 AnthropicChatModel 的组装顺序(applySystemMessage 提参 +
 * doFormat 逐条入列)拼出 MessageCreateParams,再用 SDK 自带的
 * {@link ObjectMappers#jsonMapper()}(与线上同一序列化器)序列化 {@code _body()}(即 wire body),
 * 对请求体 JSON 断言。
 *
 * <p>规格口径:ImageBlock(base64+mediaType)→
 * {@code {"type":"image","source":{"type":"base64","media_type":…,"data":…}}};
 * 无图消息请求体与改造前基线逐字节一致;video/audio/DataBlock(文件)显式不支持
 * (与 OpenAiResponsesAgentScopeModel 路径同口径:IllegalArgumentException 点名协议/模态)。
 */
class AnthropicAiProviderMultimodalTests {

    /** demo 默认对话模型走 anthropic 协议(examples/acme-demo/seeds/mock-model-restore.sql)。 */
    private static final String MODEL_NAME = "MiniMax-M3";

    private final AnthropicChatFormatter formatter = AnthropicAiProvider.agentScopeFormatter();
    private final JsonMapper mapper = ObjectMappers.jsonMapper();

    @Test
    void singleImageBlockBecomesBase64ImageSourceInRequestBody() throws Exception {
        Msg message = Msg.builder()
                .role(MsgRole.USER)
                .content(List.of(
                        TextBlock.builder().text("这张图里有什么?").build(),
                        ImageBlock.builder()
                                .source(base64("image/png", "aVZlcnlTZWNyZXRQbmlQYXlsb2Fk"))
                                .build()))
                .build();

        JsonNode content = requestBody(List.of(message)).path("messages").path(0).path("content");

        assertThat(content.isArray()).isTrue();
        assertThat(content.size()).isEqualTo(2);
        assertThat(content.get(0).path("type").asText()).isEqualTo("text");
        assertThat(content.get(0).path("text").asText()).isEqualTo("这张图里有什么?");

        JsonNode image = content.get(1);
        assertThat(image.path("type").asText()).isEqualTo("image");
        assertThat(image.path("source").path("type").asText()).isEqualTo("base64");
        assertThat(image.path("source").path("media_type").asText()).isEqualTo("image/png");
        assertThat(image.path("source").path("data").asText()).isEqualTo("aVZlcnlTZWNyZXRQbmlQYXlsb2Fk");
    }

    @Test
    void multipleImageBlocksKeepInputOrderInRequestBody() throws Exception {
        Msg message = Msg.builder()
                .role(MsgRole.USER)
                .content(List.of(
                        ImageBlock.builder().source(base64("image/png", "QUFB")).build(),
                        TextBlock.builder().text("对比这两张图").build(),
                        ImageBlock.builder().source(base64("image/jpeg", "QkJC")).build()))
                .build();

        JsonNode content = requestBody(List.of(message)).path("messages").path(0).path("content");

        assertThat(content.size()).isEqualTo(3);
        assertThat(content.get(0).path("type").asText()).isEqualTo("image");
        assertThat(content.get(0).path("source").path("type").asText()).isEqualTo("base64");
        assertThat(content.get(0).path("source").path("media_type").asText()).isEqualTo("image/png");
        assertThat(content.get(0).path("source").path("data").asText()).isEqualTo("QUFB");
        assertThat(content.get(1).path("type").asText()).isEqualTo("text");
        assertThat(content.get(1).path("text").asText()).isEqualTo("对比这两张图");
        assertThat(content.get(2).path("type").asText()).isEqualTo("image");
        assertThat(content.get(2).path("source").path("type").asText()).isEqualTo("base64");
        assertThat(content.get(2).path("source").path("media_type").asText()).isEqualTo("image/jpeg");
        assertThat(content.get(2).path("source").path("data").asText()).isEqualTo("QkJC");
    }

    /**
     * 无图消息回归基线:黄金快照取自 2026-10-29 改造前实现(agentscope 2.0.0
     * AnthropicChatFormatter,经本测试同一组装路径)对本类同参数对话的输出。
     * 注意按既有口径,首条 system 消息除提到 system 参数外仍以 user 角色留在 messages 里。
     */
    @Test
    void textOnlyConversationRequestBodyStaysAtPreChangeBaseline() throws Exception {
        String body = mapper.writeValueAsString(
                requestBodyParams(List.of(systemMessage(), assistantMessage(), textUserMessage())).build()._body());

        assertThat(body).isEqualTo(
                "{\"max_tokens\":4096,\"messages\":[{\"content\":[{\"text\":\"你是 Acme 的工单助手\",\"type\":\"text\"}],\"role\":\"user\"},{\"content\":[{\"text\":\"好的,请描述问题。\",\"type\":\"text\"}],\"role\":\"assistant\"},{\"content\":[{\"text\":\"工单 9203 卡在哪一步?\",\"type\":\"text\"}],\"role\":\"user\"}],\"model\":\"MiniMax-M3\",\"system\":\"你是 Acme 的工单助手\"}");
    }

    @Test
    void systemAndAssistantMessagesUnaffectedWhenLaterUserMessageCarriesImage() throws Exception {
        Msg userWithImage = Msg.builder()
                .role(MsgRole.USER)
                .content(List.of(
                        TextBlock.builder().text("继续,看这张图").build(),
                        ImageBlock.builder().source(base64("image/png", "QUFB")).build()))
                .build();

        JsonNode body = requestBody(List.of(systemMessage(), assistantMessage(), userWithImage));

        assertThat(body.path("system").asText()).isEqualTo("你是 Acme 的工单助手");
        JsonNode messages = body.path("messages");
        assertThat(messages.size()).isEqualTo(3);
        assertThat(messages.get(0).path("role").asText()).isEqualTo("user");
        assertThat(messages.get(1).path("role").asText()).isEqualTo("assistant");
        assertThat(messages.get(2).path("role").asText()).isEqualTo("user");
        assertThat(messages.get(2).path("content").get(1).path("type").asText()).isEqualTo("image");
    }

    /** 现状(库默认):video 块被静默丢弃、只剩文字 —— 要求改为显式报错(OpenAiResponses 同口径)。 */
    @Test
    void videoBlockIsRejectedExplicitlyInsteadOfSilentlyDropped() {
        Msg message = Msg.builder()
                .role(MsgRole.USER)
                .content(List.of(
                        TextBlock.builder().text("看这段视频").build(),
                        VideoBlock.builder().source(base64("video/mp4", "VkltZU8")).build()))
                .build();

        IllegalArgumentException thrown = catchThrowableOfType(
                IllegalArgumentException.class, () -> requestBody(List.of(message)));

        assertThat(thrown)
                .as("VideoBlock 在 anthropic 路径必须显式拒绝,而不是静默丢弃")
                .isNotNull();
        assertThat(thrown.getMessage()).containsIgnoringCase("video");
    }

    /** 现状(库默认):纯 audio 消息整条蒸发(doFormat 返回空列表)—— 要求改为显式报错。 */
    @Test
    void audioBlockIsRejectedExplicitlyInsteadOfSilentlyDropped() {
        Msg message = Msg.builder()
                .role(MsgRole.USER)
                .content(List.of(
                        AudioBlock.builder().source(base64("audio/wav", "QVVESU8")).build()))
                .build();

        IllegalArgumentException thrown = catchThrowableOfType(
                IllegalArgumentException.class, () -> requestBody(List.of(message)));

        assertThat(thrown)
                .as("AudioBlock 在 anthropic 路径必须显式拒绝,而不是静默丢弃")
                .isNotNull();
        assertThat(thrown.getMessage()).containsIgnoringCase("audio");
    }

    /**
     * DataBlock(文件)在 anthropic 路径显式不支持。
     * 现状(库默认):application/pdf 变成 "[Media - processing failed: …]" 文本块发给模型 ——
     * 要求改为显式报错,消息点名 anthropic(与 audio/video 口径一致)。
     */
    @Test
    void dataBlockFileIsRejectedExplicitlyOnAnthropicPath() {
        Msg message = Msg.builder()
                .role(MsgRole.USER)
                .content(List.of(
                        TextBlock.builder().text("读这个文件").build(),
                        DataBlock.builder()
                                .id("file-1")
                                .name("spec.pdf")
                                .source(base64("application/pdf", "UERG"))
                                .build()))
                .build();

        IllegalArgumentException thrown = catchThrowableOfType(
                IllegalArgumentException.class, () -> requestBody(List.of(message)));

        assertThat(thrown)
                .as("DataBlock 文件在 anthropic 路径必须显式拒绝,而不是降级为占位文本")
                .isNotNull();
        assertThat(thrown.getMessage()).containsIgnoringCase("anthropic");
    }

    private Base64Source base64(String mediaType, String data) {
        return Base64Source.builder().mediaType(mediaType).data(data).build();
    }

    private Msg systemMessage() {
        return Msg.builder().role(MsgRole.SYSTEM)
                .content(List.of(TextBlock.builder().text("你是 Acme 的工单助手").build()))
                .build();
    }

    private Msg assistantMessage() {
        return Msg.builder().role(MsgRole.ASSISTANT)
                .content(List.of(TextBlock.builder().text("好的,请描述问题。").build()))
                .build();
    }

    private Msg textUserMessage() {
        return Msg.builder().role(MsgRole.USER)
                .content(List.of(TextBlock.builder().text("工单 9203 卡在哪一步?").build()))
                .build();
    }

    /** 复刻 AnthropicChatModel 的请求组装:system 提参 + doFormat 逐条入列。 */
    private MessageCreateParams.Builder requestBodyParams(List<Msg> messages) {
        MessageCreateParams.Builder paramsBuilder = MessageCreateParams.builder()
                .model(MODEL_NAME)
                .maxTokens(4096);
        formatter.applySystemMessage(paramsBuilder, messages);
        for (MessageParam param : formatter.doFormat(messages)) {
            paramsBuilder.addMessage(param);
        }
        return paramsBuilder;
    }

    /** 请求体 JSON(_body() 即线上 wire body;顶层其余字段是路由/头部元数据,不进 body)。 */
    private JsonNode requestBody(List<Msg> messages) throws Exception {
        String json = mapper.writeValueAsString(requestBodyParams(messages).build()._body());
        return mapper.readTree(json);
    }
}
