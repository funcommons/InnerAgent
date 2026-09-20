package com.inneragent.server.auth.act;

import com.nimbusds.jose.jwk.JWKSet;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * act token JWKS 发布(02-技术方案 §6.1:{@code /.well-known/jwks.json})。
 *
 * <p>宿主侧 starter(inneragent-spring-boot-starter,P1-T2)以本端点取公钥验
 * X-IA-Act;输出含 kid,轮换宽限期内的旧 key 一并列出(见
 * {@link ActTokenKeyManager#publicJwks()})。
 */
@RestController
public class JwksController {

    private final ActTokenKeyManager keyManager;

    public JwksController(ActTokenKeyManager keyManager) {
        this.keyManager = keyManager;
    }

    @GetMapping("/.well-known/jwks.json")
    public Map<String, Object> jwks() {
        // toJSONObject(true) 只输出公开参数(不含私钥);keys 顺序稳定(当前 key 在前)
        return new JWKSet(keyManager.publicJwks()).toJSONObject(true);
    }
}
