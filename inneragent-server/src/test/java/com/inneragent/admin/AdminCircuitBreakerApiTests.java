package com.inneragent.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.common.GlobalExceptionHandler;
import com.inneragent.server.admin.AdminCircuitBreakerController;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.admin.CircuitBreakerAdminService;
import com.inneragent.server.admin.CircuitBreakerAdminService.CircuitEventView;
import com.inneragent.server.admin.CircuitBreakerAdminService.StateView;
import com.inneragent.platform.circuit.CircuitBreakerLimits;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 熔断 admin API 切片测试(优化建议 #2 服务端半):mock 契约形状逐条对齐
 * (handlers.ts circuitHandlers)、双轨守卫矩阵(与既有 admin 端点一致)、
 * appId 缺省单应用。服务依赖 mock 注入(语义覆盖见 CircuitBreakerAdminServiceTests)。
 */
class AdminCircuitBreakerApiTests {

    private static final String ADMIN_KEY = "test-admin-key";

    private CircuitBreakerAdminService circuitService;
    private MockMvc mockMvcWithKey;
    private MockMvc mockMvcWithoutKey;
    private AdminCircuitBreakerController controller;

    @BeforeEach
    void setUp() {
        circuitService = Mockito.mock(CircuitBreakerAdminService.class);
        controller = new AdminCircuitBreakerController(circuitService);
        mockMvcWithKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
        mockMvcWithoutKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .addFilters(new AdminTokenFilter(""))
                .build();
    }

    private static StateView state() {
        return new StateView(
                true,
                "2026-09-20T12:00:00Z",
                "成本异常",
                CircuitBreakerLimits.DEFAULTS,
                2L,
                List.of(new CircuitEventView(
                        7L, "emergency-stop", null, "成本异常", "admin",
                        "2026-09-20T12:00:00Z")));
    }

    @Test
    @DisplayName("守卫矩阵:无 key/错误 key 403(与既有 admin 端点一致)")
    void guardMatrixPreserved() throws Exception {
        mockMvcWithoutKey.perform(get("/ia/api/v1/admin/circuit-breaker"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(put("/ia/api/v1/admin/circuit-breaker/limits")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/circuit-breaker/emergency-stop")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"x\"}"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/circuit-breaker/resume"))
                .andExpect(status().isForbidden());
        mockMvcWithKey.perform(get("/ia/api/v1/admin/circuit-breaker")
                        .header(AdminTokenFilter.HEADER, "wrong"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("GET 状态:mock 契约 CircuitBreakerState 形 + activeRuns 扩展")
    void getStateContractShape() throws Exception {
        when(circuitService.state(1L)).thenReturn(state());

        mockMvcWithKey.perform(get("/ia/api/v1/admin/circuit-breaker")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.emergencyStopped").value(true))
                .andExpect(jsonPath("$.data.stoppedAt").value("2026-09-20T12:00:00Z"))
                .andExpect(jsonPath("$.data.stopReason").value("成本异常"))
                .andExpect(jsonPath("$.data.limits.mcpConcurrency").value(8))
                .andExpect(jsonPath("$.data.limits.mcpQps").value(20))
                .andExpect(jsonPath("$.data.limits.maxToolCallsPerRun").value(32))
                .andExpect(jsonPath("$.data.activeRuns").value(2))
                .andExpect(jsonPath("$.data.recentEvents[0].id").value(7))
                .andExpect(jsonPath("$.data.recentEvents[0].type").value("emergency-stop"))
                .andExpect(jsonPath("$.data.recentEvents[0].runId").doesNotExist())
                .andExpect(jsonPath("$.data.recentEvents[0].reason").value("成本异常"))
                .andExpect(jsonPath("$.data.recentEvents[0].operator").value("admin"))
                .andExpect(jsonPath("$.data.recentEvents[0].occurredAt").value("2026-09-20T12:00:00Z"));
    }

    @Test
    @DisplayName("PUT limits:body {limits: 部分字段} 透传,响应为合并后全量配置")
    void putLimitsPartialPatch() throws Exception {
        when(circuitService.updateLimits(eq(1L), any())).thenReturn(
                CircuitBreakerLimits.DEFAULTS.merge(new CircuitBreakerLimits.PartialPatch(
                        null, null, null, null, 16, null, null)));

        mockMvcWithKey.perform(put("/ia/api/v1/admin/circuit-breaker/limits")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"limits\":{\"mcpConcurrency\":16}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.mcpConcurrency").value(16))
                .andExpect(jsonPath("$.data.mcpQps").value(20))
                .andExpect(jsonPath("$.data.confirmTimeoutHours").value(24));

        verify(circuitService).updateLimits(eq(1L), eq(new CircuitBreakerLimits.PartialPatch(
                null, null, null, null, 16, null, null)));
    }

    @Test
    @DisplayName("POST emergency-stop:reason 缺失 400(mock 契约);成功返回事件形 + counts 扩展")
    void emergencyStopContract() throws Exception {
        when(circuitService.emergencyStop(eq(1L), any()))
                .thenThrow(new com.inneragent.platform.common.BusinessException(400, "reason 不能为空"));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/circuit-breaker/emergency-stop")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.msg").value("reason 不能为空"));

        when(circuitService.emergencyStop(eq(1L), any())).thenReturn(
                new CircuitBreakerAdminService.EmergencyStopView(
                        8L, "emergency-stop", null, "演练", "admin", "2026-09-20T12:30:00Z",
                        new CircuitBreakerAdminService.EmergencyStopView.Counts(3)));
        mockMvcWithKey.perform(post("/ia/api/v1/admin/circuit-breaker/emergency-stop")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"演练\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.type").value("emergency-stop"))
                .andExpect(jsonPath("$.data.id").value(8))
                .andExpect(jsonPath("$.data.runId").doesNotExist())
                .andExpect(jsonPath("$.data.reason").value("演练"))
                .andExpect(jsonPath("$.data.operator").value("admin"))
                .andExpect(jsonPath("$.data.occurredAt").isNotEmpty())
                .andExpect(jsonPath("$.data.counts.cancelInitiated").value(3));
    }

    @Test
    @DisplayName("POST resume:无请求体调用,返回 resume 事件")
    void resumeContract() throws Exception {
        when(circuitService.resume(1L)).thenReturn(new CircuitEventView(
                9L, "resume", null, "人工恢复", "admin", "2026-09-20T13:00:00Z"));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/circuit-breaker/resume")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.type").value("resume"))
                .andExpect(jsonPath("$.data.reason").value("人工恢复"));
    }

    @Test
    @DisplayName("POST terminate-run:runId/reason 缺失 400;成功返回 run-terminated 事件(Mono 异步)")
    void terminateRunContract() throws Exception {
        when(circuitService.terminateRun(eq(1L), any(), any()))
                .thenThrow(new com.inneragent.platform.common.BusinessException(400, "runId/reason 不能为空"));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/circuit-breaker/terminate-run")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"runId\":\"run-1\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.msg").value("runId/reason 不能为空"));

        when(circuitService.terminateRun(eq(1L), eq("run-9"), eq("违规操作")))
                .thenReturn(Mono.just(new CircuitEventView(
                        10L, "run-terminated", "run-9", "违规操作", "admin",
                        "2026-09-20T13:10:00Z")));

        MvcResult async = mockMvcWithKey.perform(
                        post("/ia/api/v1/admin/circuit-breaker/terminate-run")
                                .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"runId\":\"run-9\",\"reason\":\"违规操作\"}"))
                .andExpect(request().asyncStarted())
                .andReturn();
        mockMvcWithKey.perform(asyncDispatch(async))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.type").value("run-terminated"))
                .andExpect(jsonPath("$.data.runId").value("run-9"))
                .andExpect(jsonPath("$.data.reason").value("违规操作"));
    }

    @Test
    @DisplayName("控制器直连:terminate-run 的 Mono 错误透传(404/409 由服务层映射)")
    void terminateRunMonoErrorPropagates() {
        when(circuitService.terminateRun(eq(1L), eq("run-x"), any()))
                .thenReturn(Mono.error(new com.inneragent.platform.common.BusinessException(
                        404, "运行不存在: run-x")));

        StepVerifier.create(controller.terminateRun(1L,
                        new AdminCircuitBreakerController.TerminateRunReq("run-x", "reason")))
                .expectErrorSatisfies(error -> assertThat(error)
                        .isInstanceOf(com.inneragent.platform.common.BusinessException.class)
                        .hasMessage("运行不存在: run-x"))
                .verify();
    }

    @Test
    @DisplayName("appId 缺省单应用 1;显式 appId 透传(多应用预留)")
    void appIdDefaultsToOneAndPassesThrough() throws Exception {
        when(circuitService.state(1L)).thenReturn(state());
        mockMvcWithKey.perform(get("/ia/api/v1/admin/circuit-breaker")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk());

        when(circuitService.state(3L)).thenReturn(state());
        mockMvcWithKey.perform(get("/ia/api/v1/admin/circuit-breaker")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .param("appId", "3"))
                .andExpect(status().isOk());
        verify(circuitService).state(3L);

        // Jackson 缺省 ObjectMapper 即可完成 PartialPatch 反序列化
        assertThat(new ObjectMapper().readValue(
                "{\"maxToolCallsPerRun\":5}",
                CircuitBreakerLimits.PartialPatch.class).maxToolCallsPerRun()).isEqualTo(5);
    }
}
