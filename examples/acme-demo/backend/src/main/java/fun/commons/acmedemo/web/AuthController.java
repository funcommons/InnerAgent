package fun.commons.acmedemo.web;

import fun.commons.acmedemo.common.R;
import fun.commons.acmedemo.session.DemoAuthInterceptor;
import fun.commons.acmedemo.session.DemoSessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 演示登录(接入指南「宿主登录态」替身,见 §2 步骤⑤ tokenGetter 语义)。
 *
 * ⚠️ 任意用户名即登录,仅用于 DEMO 串起「用户 → embed token」链路;
 * 生产实现中本控制器必须替换为宿主真实鉴权体系,embed token 只签给已认证用户。
 */
@Validated
@RestController
@RequestMapping("/api/demo")
@RequiredArgsConstructor
public class AuthController {

    private final DemoSessionService sessionService;

    public record LoginReq(@NotBlank(message = "username 不能为空") String username) {
    }

    @PostMapping("/login")
    public R<Map<String, Object>> login(@Validated @RequestBody LoginReq req) {
        DemoSessionService.LoginResult result = sessionService.login(req.username());
        return R.ok(Map.of(
                "token", result.token(),
                "username", result.username(),
                "userId", result.userId()));
    }

    /** username/userId 由 DemoAuthInterceptor 从演示会话解析后放入 attribute。 */
    @GetMapping("/me")
    public R<Map<String, Object>> me(HttpServletRequest request) {
        String username = (String) request.getAttribute(DemoAuthInterceptor.ATTR_USERNAME);
        Object userId = request.getAttribute(DemoAuthInterceptor.ATTR_USER_ID);
        return R.ok(Map.of(
                "username", username == null ? "" : username,
                "userId", userId == null ? 0L : userId));
    }

    @PostMapping("/logout")
    public R<Void> logout(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
        sessionService.logout(bearerOf(auth));
        return R.ok();
    }

    static String bearerOf(String auth) {
        return auth != null && auth.startsWith("Bearer ") ? auth.substring(7).trim() : null;
    }
}
