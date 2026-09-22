package fun.commons.acmedemo.ia;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import fun.commons.acmedemo.common.BizException;
import fun.commons.acmedemo.config.IaProperties;
import fun.commons.acmedemo.ia.IaAgentAdminService.SaveReq;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * 「Agent 管理」页编排:app 探测门禁、bundle 组装(创建/更新/提示词缺省语义)、
 * 下拉聚合(工具+模型+子 Agent)、入参校验与管理面错误透传。
 */
class IaAgentAdminServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private InnerAgentAdminClient client;
    private EmbedTokenSigner signer;
    private IaAgentAdminService service;

    @BeforeEach
    void setUp() {
        client = mock(InnerAgentAdminClient.class);
        signer = mock(EmbedTokenSigner.class);
        IaProperties props = new IaProperties();
        props.setAppKey("acme-demo");
        service = new IaAgentAdminService(client, signer, props);
        when(signer.sign(anyLong(), any()))
                .thenReturn(new EmbedTokenSigner.SignedToken("sys-token", 3600));
        registered(34);
    }

    private void registered(long appId) {
        when(client.probeAppStatus("acme-demo")).thenReturn(
                new InnerAgentAdminClient.AppView("registered", appId, "acme-demo", "fp"));
    }

    private static JsonNode envelope(String dataJson) {
        return MAPPER.valueToTree(java.util.Map.of("code", 0, "data", read(dataJson)));
    }

    private static JsonNode read(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Nested
    @DisplayName("列表与选项")
    class ListAndOptions {

        @Test
        @DisplayName("列表:appId 实时探测注入;data 透传")
        void listPassesProbedAppId() {
            when(client.getEnvelope(contains("/ia/api/v1/admin/definitions?appId=34")))
                    .thenReturn(envelope("{\"records\":[{\"agentType\":\"a\",\"name\":\"A\"}]}"));
            JsonNode data = service.listDefinitions();
            assertThat(data.path("records")).hasSize(1);
        }

        @Test
        @DisplayName("应用未注册 → 400 引导开通")
        void unregisteredAppRejected() {
            when(client.probeAppStatus("acme-demo")).thenReturn(
                    new InnerAgentAdminClient.AppView("not_registered", 0, "acme-demo", null));
            assertThatThrownBy(service::listDefinitions)
                    .isInstanceOf(BizException.class)
                    .hasMessageContaining("未在 InnerAgent 管理面注册");
        }

        @Test
        @DisplayName("选项:工具/模型原样透传,子 Agent 从 kind=sub 列表提取")
        void optionsAggregatesThreeSources() {
            when(client.getEnvelope(contains("/admin/tools")))
                    .thenReturn(envelope("[{\"toolName\":\"create_ticket\"}]"));
            when(client.getEnvelopeAsUser(contains("/me/models?type=1"), eq("sys-token")))
                    .thenReturn(envelope("[{\"name\":\"MiniMax M3\"}]"));
            when(client.getEnvelope(contains("&kind=sub"))).thenReturn(envelope(
                    "{\"records\":[{\"agentType\":\"sales-query\",\"name\":\"销售查询\"}]}"));

            IaAgentAdminService.AgentOptions options = service.options();
            assertThat(options.tools()).hasSize(1);
            assertThat(options.models()).hasSize(1);
            assertThat(options.subAgents())
                    .containsExactly(java.util.Map.of("agentType", "sales-query", "name", "销售查询"));
        }
    }

    @Nested
    @DisplayName("保存(创建/更新)bundle 组装")
    class Save {

        @Test
        @DisplayName("创建:definitionId=null + systemPrompt 必带 + overwrite 通道")
        void createBuildsBundleWithoutDefinitionId() {
            when(client.postEnvelope(anyString(), any())).thenReturn(
                    envelope("{\"created\":1,\"updated\":0,\"skipped\":0,\"errors\":[]}"));

            JsonNode result = service.save(new SaveReq(null, "trouble-reporter", "故障上报",
                    "main", true, 2L, List.of("create_ticket"), List.of(),
                    "你是故障上报助手", "你好,报什么故障?"));

            assertThat(result.path("created").asInt()).isEqualTo(1);
            @SuppressWarnings("unchecked")
            ArgumentCaptor<java.util.Map<String, Object>> body =
                    ArgumentCaptor.forClass(java.util.Map.class);
            verify(client).postEnvelope(contains("/admin/definitions/import?appId=34"),
                    body.capture());
            assertThat(body.getValue()).containsEntry("conflictPolicy", "overwrite");
            JsonNode bundle = MAPPER.valueToTree(body.getValue()).path("bundle");
            JsonNode def = bundle.path("definitions").get(0);
            assertThat(def.path("definitionId").isNull()).isTrue();
            assertThat(def.path("agentType").asText()).isEqualTo("trouble-reporter");
            assertThat(def.path("specJson").path("kind").asText()).isEqualTo("main");
            assertThat(def.path("specJson").path("modelId").asLong()).isEqualTo(2L);
            assertThat(def.path("specJson").path("toolWhitelist").get(0).asText())
                    .isEqualTo("create_ticket");
            assertThat(def.path("prompts")).hasSize(2);
        }

        @Test
        @DisplayName("更新:提示词缺省=保持原值(prompts 空数组);enabled 缺省=true")
        void updateKeepsPromptsWhenAbsent() {
            when(client.postEnvelope(anyString(), any())).thenReturn(envelope(
                    "{\"created\":0,\"updated\":1,\"skipped\":0,\"errors\":[]}"));

            service.save(new SaveReq(7L, "ticket-assistant", "客服工单助手",
                    "main", null, null, List.of(), List.of(), null, null));

            @SuppressWarnings("unchecked")
            ArgumentCaptor<java.util.Map<String, Object>> body =
                    ArgumentCaptor.forClass(java.util.Map.class);
            verify(client).postEnvelope(anyString(), body.capture());
            JsonNode def = MAPPER.valueToTree(body.getValue()).path("bundle")
                    .path("definitions").get(0);
            assertThat(def.path("definitionId").asLong()).isEqualTo(7L);
            assertThat(def.path("specJson").path("enabled").asBoolean()).isTrue();
            assertThat(def.path("prompts")).isEmpty();
        }

        @Test
        @DisplayName("校验:新建缺 systemPrompt / 非法 agentType / 非法 kind / 空名称")
        void validationFailures() {
            SaveReq noPrompt = new SaveReq(null, "x-agent", "X", "main", true, null,
                    List.of(), List.of(), " ", null);
            assertThatThrownBy(() -> service.save(noPrompt))
                    .isInstanceOf(BizException.class).hasMessageContaining("systemPrompt");
            SaveReq badType = new SaveReq(null, "Bad_Type", "X", "main", true, null,
                    List.of(), List.of(), "p", null);
            assertThatThrownBy(() -> service.save(badType))
                    .isInstanceOf(BizException.class).hasMessageContaining("agentType");
            SaveReq badKind = new SaveReq(1L, "x-agent", "X", "wizard", true, null,
                    List.of(), List.of(), null, null);
            assertThatThrownBy(() -> service.save(badKind))
                    .isInstanceOf(BizException.class).hasMessageContaining("kind");
            SaveReq noName = new SaveReq(1L, "x-agent", " ", "main", true, null,
                    List.of(), List.of(), null, null);
            assertThatThrownBy(() -> service.save(noName))
                    .isInstanceOf(BizException.class).hasMessageContaining("名称");
        }

        @Test
        @DisplayName("管理面业务错误透传(code!=0 → BizException 同码)")
        void adminErrorPropagates() {
            when(client.postEnvelope(anyString(), any())).thenReturn(read(
                    "{\"code\":400,\"msg\":\"agentType 已存在\",\"data\":null}"));
            SaveReq req = new SaveReq(null, "ticket-assistant", "重复", "main", true,
                    null, List.of(), List.of(), "p", null);
            assertThatThrownBy(() -> service.save(req))
                    .isInstanceOf(BizException.class)
                    .hasMessageContaining("agentType 已存在")
                    .extracting(e -> ((BizException) e).getCode())
                    .isEqualTo(400);
        }
    }
}
