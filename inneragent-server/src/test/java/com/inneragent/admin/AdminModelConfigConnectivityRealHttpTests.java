package com.inneragent.admin;

import com.inneragent.model.config.ApiConfigService;
import com.inneragent.model.config.ModelPresetService;
import com.inneragent.model.entity.ApiConfig;
import com.inneragent.model.provider.AiProviderContext;
import com.inneragent.model.provider.AiProviderContextFactory;
import com.inneragent.model.provider.AiProviderRegistry;
import com.inneragent.model.provider.AiProviderService;
import com.inneragent.model.provider.OpenAiCompatibleAiProvider;
import com.inneragent.platform.service.ai.model.AiModelMetadataResolver;
import com.inneragent.platform.service.ai.model.RemoteModelMetadata;
import com.inneragent.server.admin.AdminModelConfigController;
import com.inneragent.server.admin.AdminModelConfigService;
import com.inneragent.server.admin.AdminTokenFilter;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 模型连通性测试端点真实 HTTP 回归(okhttp/okio 混栈修复,P2 台账项)。
 *
 * <p>台账症状:openai_compatible 等 provider 拉远程模型抛
 * {@code NoSuchMethodError: okio.Okio.socket}。根因:agentscope-core 2.0.0 传递
 * okhttp-jvm 5.3.2(要求 okio 3.16.4),而 okhttp 4.12.0/dashscope-sdk 把 okio
 * 邻近调解到 3.6.0(无 {@code Okio.socket} 静态方法)。修复:pom
 * dependencyManagement 全树钉 okio/okio-jvm 3.16.4。
 *
 * <p>本测试走<strong>真实 socket 连接</strong>(com.sun.net.httpserver 本地 stub),
 * 经 {@code AbstractAiProvider.executeGet} 的 OkHttpClient 链路直达
 * {@code POST /ia/api/v1/admin/model-configs/{id}/test};okio 一旦回退 3.6.0,
 * 连接即抛 NoSuchMethodError → 探针语义回 ok=false,断言失败。不依赖数据库。
 */
class AdminModelConfigConnectivityRealHttpTests {

    private static final String ADMIN_KEY = "test-admin-key";

    private HttpServer stubServer;
    private MockMvc mockMvc;
    private ApiConfigService apiConfigService;
    private long configId;

    @BeforeEach
    void setUp() throws Exception {
        // 本地 OpenAI 兼容 /v1/models stub(真实 TCP socket,非 mock HTTP 栈)
        stubServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        byte[] body = ("{\"data\":[{\"id\":\"stub-model-a\",\"owned_by\":\"stub\"},"
                + "{\"id\":\"stub-model-b\",\"owned_by\":\"stub\"}]}")
                .getBytes(StandardCharsets.UTF_8);
        stubServer.createContext("/v1/models", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var out = exchange.getResponseBody()) {
                out.write(body);
            }
        });
        stubServer.start();

        ApiConfig config = new ApiConfig();
        config.setId(31L);
        config.setName("stub-openai-compatible");
        config.setPlatform("openai_compatible");
        config.setTextProtocol("openai_chat");
        config.setApiUrl("http://127.0.0.1:" + stubServer.getAddress().getPort());
        config.setAutoAppendV1Path(true);
        config.setApiKey("sk-stub-1234567890");
        config.setStatus(1);
        configId = 31L;

        apiConfigService = Mockito.mock(ApiConfigService.class);
        when(apiConfigService.getById(configId)).thenReturn(config);

        // AiProviderService 走真实 OpenAiCompatibleAiProvider(真实 okhttp socket),
        // 仅上下文工厂/元数据解析 mock 掉数据库依赖
        AiProviderContextFactory contextFactory = Mockito.mock(AiProviderContextFactory.class);
        when(contextFactory.createForApiConfig(configId)).thenReturn(AiProviderContext.builder()
                .apiConfig(config)
                .platform("openai_compatible")
                .apiKey(config.getApiKey())
                .baseUrl(config.getApiUrl())
                .build());
        AiProviderRegistry registry =
                new AiProviderRegistry(List.of(new OpenAiCompatibleAiProvider()));
        AiModelMetadataResolver metadataResolver = Mockito.mock(AiModelMetadataResolver.class);
        when(metadataResolver.resolveRemoteModel(anyString(), anyString(), any(), any()))
                .thenReturn(new RemoteModelMetadata("openai_compatible", null, null, 1, false));
        AiProviderService providerService = new AiProviderService(
                contextFactory, registry, metadataResolver, Mockito.mock(ModelPresetService.class));

        AdminModelConfigController controller = new AdminModelConfigController(
                new AdminModelConfigService(apiConfigService, providerService));
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
    }

    @AfterEach
    void tearDown() {
        if (stubServer != null) {
            stubServer.stop(0);
        }
    }

    @Test
    @DisplayName("POST /{id}/test 对本地 stub 端点 ok=true(真实 okhttp socket 链路,okio 混栈根因消除)")
    void connectivityTestAgainstLocalStubSucceedsOverRealSocket() throws Exception {
        mockMvc.perform(post("/ia/api/v1/admin/model-configs/{id}/test", configId)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.configId").value((int) configId))
                .andExpect(jsonPath("$.data.ok").value(true))
                .andExpect(jsonPath("$.data.responseText")
                        .value(org.hamcrest.Matchers.containsString("2 个远程模型")))
                .andExpect(jsonPath("$.data.durationMs").isNumber());

        Mockito.verify(apiConfigService).getById(configId);
    }

    @Test
    @DisplayName("探针语义:stub 不可达时 ok=false(HTTP 200,错误为数据;socket 真连失败路径)")
    void connectivityTestReportsFailureAsDataWhenStubUnreachable() throws Exception {
        ApiConfig dead = new ApiConfig();
        dead.setId(32L);
        dead.setName("dead-endpoint");
        dead.setPlatform("openai_compatible");
        dead.setTextProtocol("openai_chat");
        // 127.0.0.1 保留段取一个极不可能监听的端口,触发真实连接拒绝
        dead.setApiUrl("http://127.0.0.1:1");
        dead.setAutoAppendV1Path(true);
        when(apiConfigService.getById(32L)).thenReturn(dead);

        String body = mockMvc.perform(post("/ia/api/v1/admin/model-configs/{id}/test", 32L)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ok").value(false))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(body).contains("configId\":32");
    }
}
