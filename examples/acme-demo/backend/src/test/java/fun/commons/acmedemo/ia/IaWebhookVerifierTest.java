package fun.commons.acmedemo.ia;

import static fun.commons.acmedemo.ia.IaWebhookVerifier.hmacSha256;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;

/**
 * InnerAgent Webhook 验签向量测试(接入指南 §6.3 / WebhookSigner 契约)。
 * 向量现场生成:HMAC-SHA256(secret, ts + "." + nonce + "." + body) 小写 hex,
 * ts 为纪元毫秒 —— 与签发侧 WebhookSigner.sign 的入参拼接完全同构。
 */
class IaWebhookVerifierTest {

    private static final String SECRET = "whsec-9f2c1ab77d";
    private static final String BODY = "{\"event\":\"run.finished\",\"appId\":1,\"runId\":\"r-1\",\"status\":\"COMPLETED\"}";

    private final IaWebhookVerifier verifier = new IaWebhookVerifier();

    private String sign(String ts, String nonce) {
        return HexFormat.of().formatHex(
                hmacSha256(SECRET.getBytes(StandardCharsets.UTF_8),
                        (ts + "." + nonce + "." + BODY).getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void 正例_当前时间_合法签名() {
        String ts = String.valueOf(System.currentTimeMillis());
        assertThat(verifier.verify(SECRET, BODY.getBytes(StandardCharsets.UTF_8), ts, "n-1", sign(ts, "n-1")))
                .isTrue();
    }

    @Test
    void 正例_大写hex亦接受_与WebhookSigner_verify同语义() {
        String ts = String.valueOf(System.currentTimeMillis());
        assertThat(verifier.verify(SECRET, BODY.getBytes(StandardCharsets.UTF_8), ts, "n-1",
                sign(ts, "n-1").toUpperCase())).isTrue();
    }

    @Test
    void 反例_篡改请求体() {
        String ts = String.valueOf(System.currentTimeMillis());
        byte[] tampered = (BODY + " ").getBytes(StandardCharsets.UTF_8);
        assertThat(verifier.verify(SECRET, tampered, ts, "n-1", sign(ts, "n-1"))).isFalse();
    }

    @Test
    void 反例_nonce变化_签名不符() {
        String ts = String.valueOf(System.currentTimeMillis());
        assertThat(verifier.verify(SECRET, BODY.getBytes(StandardCharsets.UTF_8), ts, "n-2", sign(ts, "n-1")))
                .isFalse();
    }

    @Test
    void 反例_时间戳超出五分钟窗口() {
        String old = String.valueOf(System.currentTimeMillis() - IaWebhookVerifier.MAX_SKEW_MILLIS - 10);
        assertThat(verifier.verify(SECRET, BODY.getBytes(StandardCharsets.UTF_8), old, "n-1", sign(old, "n-1")))
                .isFalse();
    }

    @Test
    void 反例_时间戳非毫秒数字() {
        assertThat(verifier.verify(SECRET, BODY.getBytes(StandardCharsets.UTF_8), "not-a-number", "n-1",
                sign("1", "n-1"))).isFalse();
    }

    @Test
    void 反例_头缺失或签名非法hex() {
        byte[] raw = BODY.getBytes(StandardCharsets.UTF_8);
        String ts = String.valueOf(System.currentTimeMillis());
        assertThat(verifier.verify(SECRET, raw, null, "n-1", sign(ts, "n-1"))).isFalse();
        assertThat(verifier.verify(SECRET, raw, ts, null, sign(ts, "n-1"))).isFalse();
        assertThat(verifier.verify(SECRET, raw, ts, "n-1", null)).isFalse();
        assertThat(verifier.verify(SECRET, raw, ts, "n-1", "")).isFalse();
        assertThat(verifier.verify(SECRET, raw, ts, "n-1", "zz-not-hex")).isFalse();
    }

    @Test
    void 反例_密钥不符() {
        String ts = String.valueOf(System.currentTimeMillis());
        assertThat(verifier.verify("other-secret", BODY.getBytes(StandardCharsets.UTF_8), ts, "n-1", sign(ts, "n-1")))
                .isFalse();
    }
}
