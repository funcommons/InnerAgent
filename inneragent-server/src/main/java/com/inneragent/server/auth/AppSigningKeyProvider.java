package com.inneragent.server.auth;

import java.security.interfaces.RSAPublicKey;

/**
 * embed token 验签公钥加载 SPI(P1-T1;P2-key 扩展轮换双 key)。
 *
 * <p>生产实现 {@link DbAppSigningKeyProvider} 从 ia_app(app_key) 加载
 * sign_public_key,并按轮换宽限期(inneragent.auth.embed-key-grace,默认 72h)
 * 决定是否暴露上一代公钥;测试以内存假实现替换(令牌矩阵单测,不依赖 DB)。
 */
public interface AppSigningKeyProvider {

    /**
     * 按应用标识加载启用中应用的验签公钥(含宽限期内的上一代公钥,可为 null)。
     *
     * @throws com.inneragent.platform.common.BusinessException 应用不存在/禁用(401)
     */
    AppSigningKey load(String appKey);

    /**
     * 验签密钥快照(ia_app 行投影;RS256 验签用 RSA 公钥)。
     *
     * @param previousPublicKey 上一代公钥(仅轮换宽限期内非 null;验签链:
     *                          当前 key 失败 → previous key,对齐
     *                          ActTokenKeyManager 72h 双 key 语义)
     */
    record AppSigningKey(
            long appId,
            String appKey,
            RSAPublicKey publicKey,
            RSAPublicKey previousPublicKey) {
    }
}
