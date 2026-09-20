package com.inneragent.platform.webhook;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Webhook HMAC-SHA256 签名器(任务 #18b;02-技术方案 §7.1)。
 *
 * <p>签名串 = {@code HMAC_SHA256(secret, timestamp + "." + nonce + "." + body)},
 * 十六进制小写;随请求头下发:
 * <ul>
 *   <li>{@code X-IA-Signature}:签名 hex</li>
 *   <li>{@code X-IA-Timestamp}:签名时间戳(纪元毫秒字符串,每次尝试重算,
 *       宿主可做防重放窗口校验)</li>
 *   <li>{@code X-IA-Delivery}:投递记录 ID(幂等去重键)</li>
 * </ul>
 * secret 取 {@code ia_app.webhook_secret};每次投递尝试以当前密钥重签
 * (轮换后的重试天然用新密钥),签名结果持久化到
 * {@code ia_webhook_delivery.signature} 供排查取证。
 */
public final class WebhookSigner {

    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private static final String HMAC_SHA256 = "HmacSHA256";
    private static final String SEPARATOR = ".";

    private WebhookSigner() {
    }

    /**
     * 计算签名(hex 小写)。secret 为空时返回 null(调用方不下发签名头)。
     */
    public static String sign(String secret, String timestamp, String nonce, String body) {
        if (secret == null || secret.isBlank()) {
            return null;
        }
        byte[] actualBytes = hmacSha256(
                secret.getBytes(StandardCharsets.UTF_8),
                (timestamp + SEPARATOR + nonce + SEPARATOR + body)
                        .getBytes(StandardCharsets.UTF_8));
        return toHex(actualBytes);
    }

    /**
     * 常量时间比对宿主回传签名与本端计算签名(供宿主侧实现的参照语义,
     * 服务端测试向量以此断言)。
     */
    public static boolean verify(
            String secret, String timestamp, String nonce, String body, String expected) {
        String actual = sign(secret, timestamp, nonce, body);
        return actual != null
                && expected != null
                && MessageDigest.isEqual(
                        actual.getBytes(StandardCharsets.US_ASCII),
                        expected.toLowerCase().getBytes(StandardCharsets.US_ASCII));
    }

    private static byte[] hmacSha256(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(key, HMAC_SHA256));
            return mac.doFinal(data);
        } catch (Exception failure) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", failure);
        }
    }

    private static String toHex(byte[] bytes) {
        char[] out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int value = bytes[i] & 0xFF;
            out[i * 2] = HEX[value >>> 4];
            out[i * 2 + 1] = HEX[value & 0x0F];
        }
        return new String(out);
    }
}
