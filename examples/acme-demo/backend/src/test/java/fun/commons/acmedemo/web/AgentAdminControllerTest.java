package fun.commons.acmedemo.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import fun.commons.acmedemo.common.BizException;
import fun.commons.acmedemo.ia.IaAgentAdminService;
import fun.commons.acmedemo.session.DemoAuthInterceptor;
import fun.commons.acmedemo.session.DemoSessionService;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * 「Agent 管理」端点:演示会话拦截(无 Bearer 401)+ 委派与错误码映射
 * (BizException.code → HTTP 状态,经 GlobalExceptionHandler)。
 */
class AgentAdminControllerTest {

    private DemoSessionService sessions;
    private IaAgentAdminService service;
    private MockMvc mvc;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        sessions = mock(DemoSessionService.class);
        service = mock(IaAgentAdminService.class);
        DemoAuthInterceptor interceptor = new DemoAuthInterceptor(sessions, mapper);
        mvc = MockMvcBuilders.standaloneSetup(new AgentAdminController(service))
                .setControllerAdvice(new fun.commons.acmedemo.common.GlobalExceptionHandler())
                .addInterceptors(interceptor)
                .build();
    }

    @Test
    @DisplayName("无演示会话 → 401 信封")
    void unauthenticatedRejected() throws Exception {
        when(sessions.resolve(any())).thenReturn(Optional.empty());
        mvc.perform(get("/api/ia/agent-admin/definitions"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(401));
    }

    @Test
    @DisplayName("带会话:列表透传信封;save 委派编排服务")
    void authenticatedPassthrough() throws Exception {
        when(sessions.resolve(eq("demo-tok"))).thenReturn(Optional.of(
                new DemoSessionService.Session("alice", 10086L, Instant.now())));
        when(service.listDefinitions()).thenReturn(mapper.readTree(
                "{\"records\":[{\"agentType\":\"ticket-assistant\",\"kind\":\"main\"}]}"));
        mvc.perform(get("/api/ia/agent-admin/definitions")
                        .header("Authorization", "Bearer demo-tok"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.records[0].agentType").value("ticket-assistant"));

        when(service.save(any())).thenReturn(mapper.readTree(
                "{\"created\":1,\"updated\":0,\"skipped\":0,\"errors\":[]}"));
        mvc.perform(post("/api/ia/agent-admin/save")
                        .header("Authorization", "Bearer demo-tok")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agentType\":\"trouble-reporter\",\"name\":\"故障上报\","
                                + "\"kind\":\"main\",\"enabled\":true,\"systemPrompt\":\"你是助手\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.created").value(1));
    }

    @Test
    @DisplayName("编排层 BizException → 对应 HTTP 状态(400)")
    void bizErrorMappedToHttpStatus() throws Exception {
        when(sessions.resolve(eq("demo-tok"))).thenReturn(Optional.of(
                new DemoSessionService.Session("alice", 10086L, Instant.now())));
        when(service.options()).thenThrow(new BizException(400, "应用尚未在 InnerAgent 管理面注册"));
        mvc.perform(get("/api/ia/agent-admin/options")
                        .header("Authorization", "Bearer demo-tok"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.msg").value("应用尚未在 InnerAgent 管理面注册"));
    }
}
