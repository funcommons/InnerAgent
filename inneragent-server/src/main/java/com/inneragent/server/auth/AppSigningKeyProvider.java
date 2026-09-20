package com.inneragent.server.auth;

import java.security.interfaces.RSAPublicKey;

/**
 * embed token 验签公钥加载 SPI(P1-T1)。
 *
 * <p>生产实现 {@link DbAppSigningKeyProvider} 从 ia_app(app_key) 加载
 * sign_public_key;测试以内存假实现替换(令牌矩阵单测,不依赖 DB)。
 */
public interface AppSigningKeyProvider {

    /**
     * 按应用标识加载启用中应用的验签公钥。
     *
     * @throws com.inneragent.platform.common.BusinessException 应用不存在/禁用(401)
     */
    AppSigningKey load(String appKey);

    /**
     * 验签密钥快照(ia_app 行投影;RS256 验签用 RSA 公钥)。
     */
    record AppSigningKey(long appId, String appKey, RSAPublicKey publicKey) {
    }
}
