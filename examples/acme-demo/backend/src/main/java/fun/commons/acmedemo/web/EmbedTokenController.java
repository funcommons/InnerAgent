package fun.commons.acmedemo.web;

import fun.commons.acmedemo.common.R;
import fun.commons.acmedemo.config.IaProperties;
import fun.commons.acmedemo.ia.EmbedTokenSigner;
import fun.commons.acmedemo.ia.InnerAgentAdminClient;
import fun.commons.acmedemo.session.DemoAuthInterceptor;
import fun.commons.acmedemo.session.DemoSessionService;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * embed token 签发端点(接入指南 §2 步骤⑤ / §4.1)。
 *
 * 宿主前端不持有任何密钥:带着演示登录态调这里,后端用本地 RSA 私钥
 * (IA_SIGN_PRIVATE_KEY,与管理面登记 signPublicKey 配对)签 RS256 JWT:
 * iss=appKey、sub=用户 ID(Long 串)、可选 tenantId、exp=12h、无 aud。
 * SDK 在每次请求前与 401 时调用 tokenGetter 打到这里,前端带缓存与临期重签。
 */
@RestController
@RequestMapping("/api/ia")
@RequiredArgsConstructor
public class EmbedTokenController {

    private final EmbedTokenSigner signer;
    private final IaProperties props;
    private final InnerAgentAdminClient adminClient;
    @GetMapping("/embed-token")
    public R<Map<String, Object>> issue(
            @RequestParam(value = "tenantId", required = false) Long tenantId) {
        DemoSessionService.Session session = DemoAuthInterceptor.current();
        if (session == null) {
            // 拦截器未放行(理论不可达):防御性 401
            return R.error(401, "未登录或演示会话无效");
        }
        EmbedTokenSigner.SignedToken token =
                signer.sign(session.userId(), tenantId != null ? tenantId : props.getTenantId());
        return R.ok(Map.of(
                "token", token.token(),
                "expiresIn", token.expiresIn(),
                "appKey", props.getAppKey()));
    }

    /**
     * 开通状态自检(接入总览页实时拉取;管理面「一次性开通」是否已完成):
     * state ∈ registered / not_registered / unreachable / admin_key_missing。
     */
    @GetMapping("/server-status")
    public R<InnerAgentAdminClient.AppView> serverStatus() {
        return R.ok(adminClient.probeAppStatus(props.getAppKey()));
    }
}
