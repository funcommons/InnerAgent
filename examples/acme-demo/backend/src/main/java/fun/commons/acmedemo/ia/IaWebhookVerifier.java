package fun.commons.acmedemo.ia;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * InnerAgent Webhook 验签(接入指南 §6.3;签发侧参照
 * {@code com.inneragent.platform.webhook.WebhookSigner},本类是宿主侧镜像实现)。
 *
 * <p>InnerAgent 投递头:
 * <ul>
 *   <li>{@code X-IA-Signature}:HMAC-SHA256 小写 hex</li>
 *   <li>{@code X-IA-Timestamp}:纪元<strong>毫秒</strong>字符串(每次投递尝试重算,
 *       宿主可做防重放窗口校验)</li>
 *   <li>{@code X-IA-Nonce}:随机数,参与签名</li>
 *   <li>{@code X-IA-Delivery}:投递记录 ID(宿主幂等去重键)</li>
 * </ul>
 * 待签数据:{@code timestamp + "." + nonce + "." + body}。
 *
 * <p>校验:头齐备 → 时钟偏移 |now - t| ≤ 300s → HMAC 重算 →
 * {@link MessageDigest#isEqual} 常量时间比对(hex 大小写不敏感,与
 * WebhookSigner.verify 同语义)。必须用原始字节验签:任何"先解析再重序列化"
 * 都会破坏签名。
 */
@Component
public class IaWebhookVerifier {

    /** 防重放窗口(毫秒):与 InnerAgent 投递时钟偏移容忍上限。 */
    static final long MAX_SKEW_MILLIS = 300 * 1000L;

    private static final String HMAC_SHA256 = "HmacSHA256";

    /**
     * @return true = 签名有效;false = 头缺失/时间戳非法/超时窗/签名不符。
     */
    public boolean verify(String webhookSecret, byte[] rawBody, String timestampHeader,
                          String nonceHeader, String signatureHeader) {
        if (webhookSecret == null || webhookSecret.isBlank()
                || rawBody == null
                || timestampHeader == null || timestampHeader.isBlank()
                || nonceHeader == null || signatureHeader == null || signatureHeader.isBlank()) {
            return false;
        }
        long timestampMs;
        try {
            timestampMs = Long.parseLong(timestampHeader.trim());
        } catch (NumberFormatException badTimestamp) {
            return false;
        }
        if (Math.abs(System.currentTimeMillis() - timestampMs) > MAX_SKEW_MILLIS) {
            return false;
        }
        byte[] computed = hmacSha256(
                webhookSecret.getBytes(StandardCharsets.UTF_8),
                (timestampHeader.trim() + "." + nonceHeader + "." + bodyString(rawBody))
                        .getBytes(StandardCharsets.UTF_8));
        try {
            return MessageDigest.isEqual(computed, hexToBytes(signatureHeader.trim()));
        } catch (IllegalArgumentException badHex) {
            return false; // 签名头非合法 hex(如 "zz"),按验签失败处理
        }
    }

    /** 待签数据中的 body 按 UTF-8 参与(与签发侧字符串拼接同构)。 */
    private static String bodyString(byte[] rawBody) {
        return new String(rawBody, StandardCharsets.UTF_8);
    }

    static byte[] hmacSha256(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(key, HMAC_SHA256));
            return mac.doFinal(data);
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 不可用", e);
        }
    }

    /** hex → 字节(大小写不敏感,非法 hex 抛出由调用方语义=验签失败)。 */
    static byte[] hexToBytes(String hex) {
        return java.util.HexFormat.of().parseHex(hex.toLowerCase());
    }
}
