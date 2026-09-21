package fun.commons.acmedemo.ia;

import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;

/**
 * RSA 私钥 PEM 解析(PKCS#8 与 PKCS#1 双形态,零第三方依赖)。
 *
 * <p>接入指南步骤④的密钥生成命令(oopenssl genrsa)产出 PKCS#1
 * ("BEGIN RSA PRIVATE KEY");Java 原生 KeyFactory 只吃 PKCS#8
 * ("BEGIN PRIVATE KEY")。本类对 PKCS#1 做最小 DER 包装(X.509 AlgorithmIdentifier
 * + OCTET STRING)转为 PKCS#8,两种形态统一交付 {@link RSAPrivateKey}。
 *
 * <p>纯函数、无状态:解析失败抛 {@link IllegalArgumentException},调用方决定
 * 是阻断启动(私钥格式错)还是运行期 503(私钥未配置)。
 */
public final class RSAPrivateKeys {

    private static final String RSA_OID_ALGID = "300d06092a864886f70d0101010500";

    private RSAPrivateKeys() {
    }

    /** 从 PEM(或裸 base64 DER)解析 RSA 私钥;PKCS#8 / PKCS#1 均可。 */
    public static RSAPrivateKey parse(String pem) {
        byte[] der = decodeBody(pem);
        if ((der[0] & 0xFF) != 0x30) {
            throw new IllegalArgumentException("不是合法的 DER SEQUENCE");
        }
        if (looksLikePkcs8(der)) {
            return fromPkcs8(der);
        }
        return fromPkcs8(wrapPkcs1InPkcs8(der));
    }

    /** 剥离 PEM armor 与空白,base64 解码为 DER 字节。 */
    private static byte[] decodeBody(String pem) {
        if (pem == null || pem.isBlank()) {
            throw new IllegalArgumentException("PEM 为空");
        }
        String base64 = pem.replaceAll("-----[A-Z ]*-----", "").replaceAll("\\s", "");
        byte[] der;
        try {
            der = Base64.getDecoder().decode(base64);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("PEM base64 体不可解码", e);
        }
        if (der.length == 0) {
            throw new IllegalArgumentException("PEM 体为空");
        }
        return der;
    }

    /**
     * PKCS#8 的内容以 [INTEGER 0, AlgorithmIdentifier(rsaEncryption), OCTET STRING]
     * 开头;PKCS#1 以 [INTEGER 0, INTEGER(n)…] 开头。区分点:长度头之后固定出现
     * {@code 02 01 00 30 0d 06 09 2a 86 48 86 f7 0d 01 01 01 05 00}
     * (version + rsaEncryption AlgId);PKCS#1 在 version 后紧跟模数 INTEGER,不匹配。
     */
    private static boolean looksLikePkcs8(byte[] der) {
        int off;
        int first = der[1] & 0xFF;
        if (first == 0x81) {
            off = 3;
        } else if (first == 0x82) {
            off = 4;
        } else if (first < 0x80) {
            off = 2;
        } else {
            return false; // 0x83+ 长度头(>64KB 的私钥不现实)
        }
        byte[] marker = hex("020100" + RSA_OID_ALGID);
        if (der.length < off + marker.length) {
            return false;
        }
        for (int i = 0; i < marker.length; i++) {
            if (der[off + i] != marker[i]) {
                return false;
            }
        }
        return true;
    }

    /** PKCS#1 RSAPrivateKey DER → PKCS#8:外层 SEQUENCE(0x02 01 00 + algid + [key])。 */
    static byte[] wrapPkcs1InPkcs8(byte[] pkcs1) {
        byte[] algid = hex(RSA_OID_ALGID);
        int contentLength = 3 + algid.length + 4 + pkcs1.length; // version + algid + OCTET STRING header + key
        byte[] out = new byte[4 + contentLength];
        int i = 0;
        out[i++] = 0x30;                       // SEQUENCE
        out[i++] = (byte) 0x82;                // 长度 >255 时 DER 用 0x82 + 2 字节大端
        out[i++] = (byte) (contentLength >> 8);
        out[i++] = (byte) contentLength;
        out[i++] = 0x02; out[i++] = 0x01; out[i++] = 0x00; // INTEGER 0(version)
        System.arraycopy(algid, 0, out, i, algid.length);
        i += algid.length;
        out[i++] = 0x04; out[i++] = (byte) 0x82;           // OCTET STRING
        out[i++] = (byte) (pkcs1.length >> 8);
        out[i] = (byte) pkcs1.length;
        System.arraycopy(pkcs1, 0, out, i + 1, pkcs1.length);
        return out;
    }

    private static RSAPrivateKey fromPkcs8(byte[] der) {
        try {
            PrivateKey key = KeyFactory.getInstance("RSA")
                    .generatePrivate(new PKCS8EncodedKeySpec(der));
            if (!(key instanceof RSAPrivateKey rsa)) {
                throw new IllegalArgumentException("私钥不是 RSA(算法: " + key.getAlgorithm() + ")");
            }
            return rsa;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("私钥解析失败(期待 PKCS#8/PKCS#1 RSA PEM)", e);
        }
    }

    private static byte[] hex(String hex) {
        int len = hex.length() / 2;
        byte[] out = new byte[len];
        for (int i = 0; i < len; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }
}
