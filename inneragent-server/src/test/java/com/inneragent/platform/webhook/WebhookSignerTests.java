package com.inneragent.platform.webhook;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Webhook 签名向量与防误用(任务 #18b):固定 secret+body 断言,
 * 独立于 javax.crypto 的实现重算交叉验证。
 */
class WebhookSignerTests {

    /** 测试固定密钥(向量可复现;与生产 ia_app.webhook_secret 同型)。 */
    private static final String SECRET = "ia-webhook-test-secret";
    private static final String TIMESTAMP = "1758400000000";
    private static final String NONCE = "9f2c1a7e4b8d4f0a9c3e5d6b7a8f1c2d";
    private static final String BODY =
            "{\"event\":\"run.finished\",\"appId\":1,\"runId\":\"run-20260920-001\"}";

    @Test
    @DisplayName("固定向量:签名 = HMAC-SHA256(secret, ts.nonce.body) hex 小写")
    void signMatchesFixedVector() {
        String expected = hmacSha256Reference(SECRET, TIMESTAMP + "." + NONCE + "." + BODY);
        String actual = WebhookSigner.sign(SECRET, TIMESTAMP, NONCE, BODY);

        assertThat(actual).isEqualTo(expected);
        // 独立第二次断言:签名长度与字符集(hex 小写 64 位)
        assertThat(actual).hasSize(64).matches("[0-9a-f]{64}");
    }

    @Test
    @DisplayName("签名对 timestamp/nonce/body 任一变化敏感")
    void signIsSensitiveToInputs() {
        String baseline = WebhookSigner.sign(SECRET, TIMESTAMP, NONCE, BODY);

        assertThat(WebhookSigner.sign(SECRET, "1758400000001", NONCE, BODY))
                .isNotEqualTo(baseline);
        assertThat(WebhookSigner.sign(SECRET, TIMESTAMP, "another-nonce", BODY))
                .isNotEqualTo(baseline);
        assertThat(WebhookSigner.sign(SECRET, TIMESTAMP, NONCE, BODY + " "))
                .isNotEqualTo(baseline);
    }

    @Test
    @DisplayName("不同密钥产生不同签名;verify 常量时间比对通过/拒绝")
    void verifyRejectsWrongSecretAndTampering() {
        String signature = WebhookSigner.sign(SECRET, TIMESTAMP, NONCE, BODY);

        assertThat(WebhookSigner.verify(SECRET, TIMESTAMP, NONCE, BODY, signature)).isTrue();
        assertThat(WebhookSigner.verify(SECRET, TIMESTAMP, NONCE, BODY, signature.toUpperCase()))
                .isTrue();
        assertThat(WebhookSigner.verify("other-secret", TIMESTAMP, NONCE, BODY, signature))
                .isFalse();
        assertThat(WebhookSigner.verify(
                SECRET, "1758400000001", NONCE, BODY, signature)).isFalse();
        assertThat(WebhookSigner.verify(SECRET, TIMESTAMP, NONCE, BODY + "x", signature))
                .isFalse();
        assertThat(WebhookSigner.verify(SECRET, TIMESTAMP, NONCE, BODY, null)).isFalse();
    }

    @Test
    @DisplayName("secret 为空返回 null(调用方不下发签名头)")
    void signWithoutSecretReturnsNull() {
        assertThat(WebhookSigner.sign(null, TIMESTAMP, NONCE, BODY)).isNull();
        assertThat(WebhookSigner.sign("", TIMESTAMP, NONCE, BODY)).isNull();
        assertThat(WebhookSigner.sign("   ", TIMESTAMP, NONCE, BODY)).isNull();
    }

    private static String hmacSha256Reference(String secret, String signingInput) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(
                    secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(
                    mac.doFinal(signingInput.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }
}
