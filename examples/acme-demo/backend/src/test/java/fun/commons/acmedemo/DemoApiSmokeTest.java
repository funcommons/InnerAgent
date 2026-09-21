package fun.commons.acmedemo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * DEMO 接口冒烟(不触达 InnerAgent server):登录→me→登出→401 链、
 * config 防密钥泄漏、embed token 契约(逐字段对齐 EmbedTokenVerifier 的期望)、
 * webhook 合法签名 200/篡改 401/幂等重投、工具调用演示工单直建与列表。
 */
@SpringBootTest
@AutoConfigureMockMvc
class DemoApiSmokeTest {

    private static final String WEBHOOK_SECRET = "whsec-test-hook";
    private static final KeyPair KEY_PAIR = generateKeyPair();

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper om;

    /** 测试内生成 RSA 密钥对:私钥注入本进程(模拟 IA_SIGN_PRIVATE_KEY),公钥留在「登记侧」验签。 */
    @DynamicPropertySource
    static void iaProperties(DynamicPropertyRegistry registry) {
        registry.add("ia.server-base", () -> "http://localhost:18090");
        registry.add("ia.app-key", () -> "acme-demo");
        registry.add("ia.sign-private-key-pem",
                () -> "-----BEGIN PRIVATE KEY-----\n"
                        + Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(KEY_PAIR.getPrivate().getEncoded())
                        + "\n-----END PRIVATE KEY-----");
        registry.add("ia.webhook-secret", () -> WEBHOOK_SECRET);
        registry.add("ia.admin-key", () -> "test-admin-key");
        registry.add("ia.tenant-id", () -> "7");
    }

    @Test
    void 登录_me_登出_401_全链路() throws Exception {
        MvcResult login = mvc.perform(post("/api/demo/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"alice\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.username").value("alice"))
                .andExpect(jsonPath("$.data.userId").isNumber())
                .andReturn();
        String token = om.readTree(login.getResponse().getContentAsString())
                .path("data").path("token").asText();
        assertThat(token).startsWith("demo-");

        mvc.perform(get("/api/demo/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.username").value("alice"));

        // 同名重登:数字用户 ID 稳定(embed token sub 跨会话一致)
        MvcResult relogin = mvc.perform(post("/api/demo/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"alice\"}"))
                .andExpect(status().isOk())
                .andReturn();
        long firstUserId = om.readTree(login.getResponse().getContentAsString()).path("data").path("userId").asLong();
        long secondUserId = om.readTree(relogin.getResponse().getContentAsString()).path("data").path("userId").asLong();
        assertThat(secondUserId).isEqualTo(firstUserId);

        // 空用户名 → 400
        mvc.perform(post("/api/demo/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"\"}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/demo/logout").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
        mvc.perform(get("/api/demo/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/ia/embed-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void config_只暴露公开值_无密钥泄漏() throws Exception {
        String body = mvc.perform(get("/api/demo/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.inneragentBaseUrl").value("http://localhost:18090"))
                .andExpect(jsonPath("$.data.appKey").value("acme-demo"))
                .andExpect(jsonPath("$.data.agentType").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        assertThat(body)
                .doesNotContain(WEBHOOK_SECRET)
                .doesNotContain("test-admin-key")
                .doesNotContain("PRIVATE KEY");
    }

    @Test
    void embed_token_契约对齐EmbedTokenVerifier期望() throws Exception {
        String token = loginAndGetToken("carol");
        MvcResult resp = mvc.perform(get("/api/ia/embed-token").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.appKey").value("acme-demo"))
                .andExpect(jsonPath("$.data.expiresIn").value(43200))
                .andReturn();
        String jwt = om.readTree(resp.getResponse().getContentAsString())
                .path("data").path("token").asText();

        SignedJWT parsed = SignedJWT.parse(jwt);
        assertThat(parsed.getHeader().getAlgorithm()).isEqualTo(JWSAlgorithm.RS256);  // 算法固定 RS256
        JWTClaimsSet claims = parsed.getJWTClaimsSet();
        assertThat(claims.getIssuer()).isEqualTo("acme-demo");                        // iss = appKey
        assertThat(claims.getSubject()).matches("\\d+");                              // sub = 用户 ID Long 串
        assertThat(claims.getClaim("tenantId")).isEqualTo(7L);                        // 可选租户透传
        assertThat(claims.getAudience()).isEmpty();                                   // 无 aud claim
        assertThat(claims.getExpirationTime()).isNotNull();                           // exp 必填
        // 「登记侧」公钥验签通过(EmbedTokenVerifier.verifyWith 同款 RSASSAVerifier)
        assertThat(parsed.verify(new RSASSAVerifier((RSAPublicKey) KEY_PAIR.getPublic()))).isTrue();
    }

    @Test
    void webhook_合法签名_200且事件可查_篡改_401_重投幂等() throws Exception {
        String ts = String.valueOf(System.currentTimeMillis());
        String body = "{\"event\":\"run.finished\",\"appId\":1,\"runId\":\"r-42\",\"status\":\"COMPLETED\"}";
        String sig = hmac(WEBHOOK_SECRET, ts + ".nonce-1." + body);

        mvc.perform(post("/ia/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-IA-Signature", sig)
                        .header("X-IA-Timestamp", ts)
                        .header("X-IA-Nonce", "nonce-1")
                        .header("X-IA-Delivery", "delivery-1")
                        .content(body.getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        // 同 deliveryId 重投(管理面 redeliver 语义)→ 幂等 200,事件不重复
        mvc.perform(post("/ia/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-IA-Signature", sig)
                        .header("X-IA-Timestamp", ts)
                        .header("X-IA-Nonce", "nonce-1")
                        .header("X-IA-Delivery", "delivery-1")
                        .content(body.getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk());

        String token = loginAndGetToken("dave");
        MvcResult events = mvc.perform(get("/api/webhook-events").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode arr = om.readTree(events.getResponse().getContentAsString()).path("data");
        assertThat(arr.isArray()).isTrue();
        int matches = 0;
        for (JsonNode n : arr) {
            if ("run.finished".equals(n.path("event").asText())
                    && "r-42".equals(n.path("runId").asText())
                    && "delivery-1".equals(n.path("deliveryId").asText())) {
                matches++;
            }
        }
        assertThat(matches).as("同 deliveryId 幂等,只落一条").isEqualTo(1);

        // 篡改 body → 401(不落事件)
        String tampered = hmac(WEBHOOK_SECRET, ts + ".nonce-1." + body + " ");
        mvc.perform(post("/ia/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-IA-Signature", tampered)
                        .header("X-IA-Timestamp", ts)
                        .header("X-IA-Nonce", "nonce-1")
                        .header("X-IA-Delivery", "delivery-2")
                        .content(body.getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void 工单_直建与列表_channel_direct() throws Exception {
        String token = loginAndGetToken("erin");
        mvc.perform(post("/api/tickets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"登录页白屏\",\"description\":\"Chrome 130 复现\",\"priority\":\"high\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.channel").value("direct"))
                .andExpect(jsonPath("$.data.priority").value("high"));

        // 非法优先级 → 400
        mvc.perform(post("/api/tickets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"x\",\"priority\":\"urgent\"}"))
                .andExpect(status().isBadRequest());

        MvcResult list = mvc.perform(get("/api/tickets").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode arr = om.readTree(list.getResponse().getContentAsString()).path("data");
        assertThat(arr.isArray() && arr.size() >= 1).isTrue();
    }

    private String loginAndGetToken(String username) throws Exception {
        MvcResult login = mvc.perform(post("/api/demo/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        return om.readTree(login.getResponse().getContentAsString()).path("data").path("token").asText();
    }

    private static KeyPair generateKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** 与 InnerAgent WebhookSigner.sign 同构:ts.nonce.body 的 HMAC-SHA256 小写 hex。 */
    private static String hmac(String secret, String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
    }
}
