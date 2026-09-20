package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 管理站账号认证 admin API(P2-admin 18a,02-技术方案 §6.3)。
 *
 * <p>登录端点 {@code POST /ia/api/v1/admin/auth/login} 由
 * {@link AdminTokenFilter} 豁免守卫(登录本身不能要求已有凭据);登录成功签发
 * 管理会话 token(Bearer),后续 admin 请求凭 token 或 X-IA-Admin-Key(自动化)
 * 通行。登出 {@code POST /admin/auth/logout} 受守卫,须持有效会话 token
 * (吊销 jti;内存黑名单,多实例 Redis 化为 P3 遗留)。
 *
 * <p>web/ 脚手架 {@code api/auth.ts} 的 adminKey 占位契约由本控制器替换:
 * 请求体改 {@code username/password},响应为 {@code token/expiresInSeconds}。
 */
@Tag(name = "管理站账号认证(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/auth")
@RequiredArgsConstructor
@Validated
public class AdminAuthController {

    private final AdminAuthService adminAuthService;

    /** 登录请求。 */
    public record LoginReqVO(@NotBlank String username, @NotBlank String password) {
    }

    /** 登录响应(web 端 auth store 据此保存 Bearer)。 */
    public record LoginRespVO(
            String token,
            String tokenType,
            long expiresInSeconds,
            String username) {
    }

    @PostMapping("/login")
    @Operation(summary = "管理员登录(成功签发管理会话 token;失败/锁定见 401/423;全部尝试落登录审计)")
    public CommonResult<LoginRespVO> login(
            @Validated @RequestBody LoginReqVO request, HttpServletRequest httpRequest) {
        String ip = resolveClientIp(httpRequest);
        AdminSessionTokenService.IssuedToken issued =
                adminAuthService.login(request.username(), request.password(), ip);
        return success(new LoginRespVO(
                issued.token(), "Bearer", issued.expiresInSeconds(), issued.username()));
    }

    @PostMapping("/logout")
    @Operation(summary = "管理员登出(吊销当前会话 token;jti 黑名单,幂等)")
    public CommonResult<Boolean> logout(HttpServletRequest httpRequest) {
        String authorization = httpRequest.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            // 守卫过滤器已保证 admin 路径带 Bearer 会话 token;防御式兜底
            return success(true);
        }
        adminAuthService.logout(authorization.substring("Bearer ".length()));
        return success(true);
    }

    /**
     * 客户端 IP:X-Forwarded-For 首值(反代场景),缺失回退 remoteAddr。
     */
    private static String resolveClientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int separator = forwarded.indexOf(',');
            String first = separator > 0 ? forwarded.substring(0, separator) : forwarded;
            String candidate = first.trim();
            if (!candidate.isEmpty()) {
                return candidate;
            }
        }
        return request.getRemoteAddr();
    }
}
