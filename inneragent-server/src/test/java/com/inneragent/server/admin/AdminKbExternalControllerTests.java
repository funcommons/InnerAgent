package com.inneragent.server.admin;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.GlobalExceptionHandler;
import com.inneragent.platform.kb.KbExternalConfigService;
import com.inneragent.platform.kb.KbExternalRetrievalClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 外部知识库管理 admin API 切片测试(红测先行;契约源
 * docs/使用手册/03-接入指南/06-外部知识库API规范.md §2;形态逐字对齐
 * {@link AdminKbController}:CommonResult 包裹 + @Validated + appId 缺省 1):
 * 登记透传与缺省 appId、请求体校验 400、每应用第 2 个 → 400、list 出参
 * credentials 只写不读出(null)、{id}/debug 透传与命中出参形态、软删后
 * 再登记可成功。本地 KB 的 RRF 融合另测,不在本切片。
 */
class AdminKbExternalControllerTests {

    private static final String REGISTER_BODY = "{\"name\":\"宿主 wiki\","
            + "\"endpointUrl\":\"http://wiki.example.com/ia-kb/search\","
            + "\"authType\":\"STATIC_HEADER\",\"headerName\":\"Authorization\","
            + "\"credentials\":\"Bearer wiki-token\",\"timeoutMs\":5000}";

    private KbExternalConfigService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(KbExternalConfigService.class);
        mvc = MockMvcBuilders.standaloneSetup(new AdminKbExternalController(service))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    @DisplayName("登记成功:body 透传服务层、appId 缺省 1;CommonResult 回读登记行")
    void registerPassesBodyThroughWithDefaultAppId() throws Exception {
        when(service.register(anyLong(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(invocation -> {
                    assertThat(invocation.getArguments()).containsExactly(
                            1L, "宿主 wiki", "http://wiki.example.com/ia-kb/search",
                            "STATIC_HEADER", "Authorization", "Bearer wiki-token", 5000);
                    return view(1L, 7L);
                });

        mvc.perform(post("/ia/api/v1/admin/kb/external")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(REGISTER_BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.id").value(7))
                .andExpect(jsonPath("$.data.name").value("宿主 wiki"))
                .andExpect(jsonPath("$.data.endpointUrl")
                        .value("http://wiki.example.com/ia-kb/search"))
                .andExpect(jsonPath("$.data.authType").value("STATIC_HEADER"));
    }

    @Test
    @DisplayName("字段校验失败:缺 name / 缺 endpointUrl → 400,不触服务层")
    void registerRejectsBlankRequiredFields() throws Exception {
        mvc.perform(post("/ia/api/v1/admin/kb/external")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"endpointUrl\":\"http://wiki.example.com/ia-kb/search\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/ia/api/v1/admin/kb/external")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"宿主 wiki\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("每应用第 2 个外接源 → 400(暂限 1 个,BusinessException 400 语义)")
    void secondSourcePerAppMapsTo400() throws Exception {
        when(service.register(anyLong(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new BusinessException(400,
                        "每应用外接源数已达上限(暂限 1 个),请先删除现有登记"));

        mvc.perform(post("/ia/api/v1/admin/kb/external")
                        .param("appId", "2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(REGISTER_BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.msg")
                        .value(org.hamcrest.Matchers.containsString("上限")));
    }

    @Test
    @DisplayName("list:出参形态与脱敏契约 —— credentials 只写不读出(恒 null)")
    void listOmitsCredentials() throws Exception {
        when(service.list(2L)).thenReturn(List.of(view(2L, 7L)));

        mvc.perform(get("/ia/api/v1/admin/kb/external").param("appId", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(7))
                .andExpect(jsonPath("$.data[0].appId").value(2))
                .andExpect(jsonPath("$.data[0].name").value("宿主 wiki"))
                .andExpect(jsonPath("$.data[0].headerName").value("Authorization"))
                .andExpect(jsonPath("$.data[0].status").value("active"))
                .andExpect(jsonPath("$.data[0].timeoutMs").value(5000))
                .andExpect(jsonPath("$.data[0].credentials")
                        .value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    @DisplayName("{id}/debug:query/topK 透传,出参为出站命中形态(title/anchor/content/score)")
    void debugPassesQueryThroughAndReturnsHits() throws Exception {
        when(service.debug(1L, 7L, "报销流程", 3)).thenReturn(List.of(
                new KbExternalRetrievalClient.Hit(
                        "报销制度", "第一章", "差旅报销须附发票", 0.87d)));

        mvc.perform(post("/ia/api/v1/admin/kb/external/7/debug")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"报销流程\",\"topK\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].title").value("报销制度"))
                .andExpect(jsonPath("$.data[0].anchor").value("第一章"))
                .andExpect(jsonPath("$.data[0].content").value("差旅报销须附发票"))
                .andExpect(jsonPath("$.data[0].score").value(0.87));
        verify(service).debug(1L, 7L, "报销流程", 3);
    }

    @Test
    @DisplayName("软删后同应用可重新登记:登记→DELETE 透传(appId 显式)→再登记返回新行")
    void reRegisterSucceedsAfterSoftDelete() throws Exception {
        // 首次登记(id=7);stub 以 eq(5L) 收窄,隐式断言 appId 透传
        when(service.register(eq(5L), any(), any(), any(), any(), any(), any()))
                .thenReturn(view(5L, 7L));
        mvc.perform(post("/ia/api/v1/admin/kb/external")
                        .param("appId", "5")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(REGISTER_BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(7));
        verify(service).register(eq(5L), any(), any(), any(), any(), any(), any());

        when(service.delete(5L, 7L)).thenReturn(true);
        mvc.perform(delete("/ia/api/v1/admin/kb/external/7").param("appId", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data").value(true));
        verify(service).delete(5L, 7L);

        // 再登记:返回新行(id=8),同应用不因软删被拒
        when(service.register(eq(5L), any(), any(), any(), any(), any(), any()))
                .thenReturn(view(5L, 8L));
        mvc.perform(post("/ia/api/v1/admin/kb/external")
                        .param("appId", "5")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(REGISTER_BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(8));
        verify(service, times(2))
                .register(anyLong(), any(), any(), any(), any(), any(), any());
    }

    /** 服务层出参替身:credentials 传 null,脱敏由 VO 契约保证(只写不读出)。 */
    private static KbExternalConfigService.KbExternalView view(long appId, long id) {
        return new KbExternalConfigService.KbExternalView(
                id, appId, "宿主 wiki", "http://wiki.example.com/ia-kb/search",
                "STATIC_HEADER", "Authorization", "active", 5000, null);
    }
}
