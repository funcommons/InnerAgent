package com.inneragent.admin;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.AdminAuthService;
import com.inneragent.server.admin.AdminAuthController;
import com.inneragent.server.admin.AdminSessionTokenService;
import com.inneragent.server.admin.AdminTokenFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 管理站账号认证 admin API 测试:登录/登出契约 + AdminTokenFilter
 * 双轨凭据矩阵(会话 token / 引导 key / 无凭据)+ 登录端点豁免。
 * MockMvc standalone(不启 Spring 容器),服务依赖 mock 注入。
 */
class AdminAuthApiTests {

    private static final String ADMIN_KEY = "test-admin-key";
    private static final String SESSION_JWT = "header.payload.signature";

    private AdminAuthService adminAuthService;
    private AdminSessionTokenService sessionTokenService;
    private MockMvc mockMvcWithKeyAndTokens;
    private MockMvc mockMvcWithoutKey;

    @BeforeEach
    void setUp() {
        adminAuthService = Mockito.mock(AdminAuthService.class);
        sessionTokenService = Mockito.mock(AdminSessionTokenService.class);
        AdminAuthController controller = new AdminAuthController(adminAuthService);
        mockMvcWithKeyAndTokens = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY, sessionTokenService))
                .build();
        mockMvcWithoutKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter("", sessionTokenService))
                .build();
        when(sessionTokenService.verify("valid.jwt.token"))
                .thenReturn(new AdminSessionTokenService.SessionPrincipal(
                        "ops-admin", "jti-1", Instant.now().plusSeconds(600)));
    }

    /** 测试态异常映射:BusinessException.code → HTTP 状态 + CommonResult 体 */
    @org.springframework.web.bind.annotation.RestControllerAdvice
    static class BusinessExceptionAdvice {

        @org.springframework.web.bind.annotation.ExceptionHandler(
                com.inneragent.platform.common.BusinessException.class)
        org.springframework.http.ResponseEntity<Object> onBusinessException(
                com.inneragent.platform.common.BusinessException e) {
            return org.springframework.http.ResponseEntity
                    .status(e.getCode() == null ? 500 : e.getCode())
                    .body(java.util.Map.of("code", e.getCode(), "msg", e.getMessage()));
        }
    }

    @Test
    @DisplayName("POST /auth/login 豁免守卫:无任何凭据可登录;成功回 token/tokenType/expiresInSeconds")
    void loginEndpointIsExemptFromGuardAndReturnsTokenContract() throws Exception {
        when(adminAuthService.login(eq("ops-admin"), eq("s3cret-Pass!"), any()))
                .thenReturn(new AdminSessionTokenService.IssuedToken(
                        SESSION_JWT, "ops-admin", "jti-1",
                        Instant.now().plusSeconds(14400), 14400));

        mockMvcWithKeyAndTokens.perform(post("/ia/api/v1/admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"ops-admin\",\"password\":\"s3cret-Pass!\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.token").value(SESSION_JWT))
                .andExpect(jsonPath("$.data.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.data.username").value("ops-admin"))
                .andExpect(jsonPath("$.data.expiresInSeconds").value(14400));
    }

    @Test
    @DisplayName("登录失败映射:401 凭据无效/停用,423 锁定中(均落登录审计,由服务层负责)")
    void loginFailureCodesMapToHttpStatus() throws Exception {
        org.mockito.Mockito.doThrow(new AdminAuthService.LoginFailureException(401, "用户名或密码错误"))
                .when(adminAuthService).login(any(), any(), any());
        mockMvcWithKeyAndTokens.perform(post("/ia/api/v1/admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"ops-admin\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(401));

        // 重打桩经 doThrow:when() 形式会先执行上一轮的抛出桩
        org.mockito.Mockito.doThrow(new AdminAuthService.LoginFailureException(423, "账号已锁定,请 890 秒后重试"))
                .when(adminAuthService).login(any(), any(), any());
        mockMvcWithKeyAndTokens.perform(post("/ia/api/v1/admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"ops-admin\",\"password\":\"wrong\"}"))
                .andExpect(status().isLocked())
                .andExpect(jsonPath("$.code").value(423));
    }

    @Test
    @DisplayName("守卫矩阵(双轨):会话 token Bearer 通行;无效 token 401;正确 key 通行;错误 key 403;无凭据 403")
    void adminGuardAcceptsSessionTokenAndLegacyKey() throws Exception {
        mockMvcWithKeyAndTokens.perform(post("/ia/api/v1/admin/auth/logout")
                        .header("Authorization", "Bearer valid.jwt.token"))
                .andExpect(status().isOk());

        when(sessionTokenService.verify("expired.jwt.token"))
                .thenThrow(new AdminSessionTokenService.InvalidSessionTokenException("已过期"));
        mockMvcWithKeyAndTokens.perform(post("/ia/api/v1/admin/auth/logout")
                        .header("Authorization", "Bearer expired.jwt.token"))
                .andExpect(status().isUnauthorized());

        mockMvcWithKeyAndTokens.perform(post("/ia/api/v1/admin/auth/logout")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk());

        mockMvcWithKeyAndTokens.perform(post("/ia/api/v1/admin/auth/logout")
                        .header(AdminTokenFilter.HEADER, "wrong-key"))
                .andExpect(status().isForbidden());

        mockMvcWithKeyAndTokens.perform(post("/ia/api/v1/admin/auth/logout"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("登出吊销会话:Bearer 有效 token → 服务层 logout 调用")
    void logoutRevokesSessionViaService() throws Exception {
        mockMvcWithKeyAndTokens.perform(post("/ia/api/v1/admin/auth/logout")
                        .header("Authorization", "Bearer valid.jwt.token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));
        verify(adminAuthService).logout("valid.jwt.token");
    }

    @Test
    @DisplayName("未配置 IA_ADMIN_KEY:会话 token 通道仍可用(账号登录通道独立于引导 key)")
    void sessionTokenWorksEvenWhenBootstrapKeyUnconfigured() throws Exception {
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/auth/logout")
                        .header("Authorization", "Bearer valid.jwt.token"))
                .andExpect(status().isOk());
        // 引导 key 通道依旧缺省封闭
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/auth/logout"))
                .andExpect(status().isForbidden());
        verify(adminAuthService).logout("valid.jwt.token");
    }

    @Test
    @DisplayName("登录端点豁免边界:未配置 key 时 login 仍可达(登出不可达)")
    void loginExemptWhileLogoutGuardedWhenNoKeyConfigured() throws Exception {
        when(adminAuthService.login(any(), any(), any()))
                .thenReturn(new AdminSessionTokenService.IssuedToken(
                        SESSION_JWT, "ops-admin", "jti",
                        Instant.now().plusSeconds(60), 60));
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"ops-admin\",\"password\":\"x\"}"))
                .andExpect(status().isOk());
        verify(adminAuthService).login(any(), any(), any());
        verify(adminAuthService, never()).logout(anyString());
    }
}
