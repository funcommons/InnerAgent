package com.inneragent.server.auth;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.AdminAppService;
import com.inneragent.server.admin.AppRegistration;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.LocalDateTime;

/**
 * 生产验签公钥加载:ia_app(app_key) 的 sign_public_key(PEM)。
 *
 * <p>P1-T1 起逐请求加载(暂不做缓存,管理面 QPS 低);PUT signPublicKey
 * 轮换即时生效。
 *
 * <p><strong>轮换宽限期(P2-key,V9)</strong>:ia_app.signKeyRotatedAt +
 * {@code inneragent.auth.embed-key-grace}(默认 72h,对齐 ActTokenKeyManager
 * 双 key 语义)之内,上一代公钥 previous_sign_public_key 一并暴露给
 * {@link EmbedTokenVerifier} 验签链——当前 key 验签失败时以旧 key 兜底,
 * 存量 embed token 在轮换后不至于立即全量失效。宽限期外/未轮换/配置为
 * 0 或负(关闭宽限)时只暴露当前公钥。时间口径:与写入侧同用
 * LocalDateTime.now()(TIMESTAMP(3) 无时区语义,同钟比较)。
 */
@Component
@Slf4j
public class DbAppSigningKeyProvider implements AppSigningKeyProvider {

    private final AdminAppService adminAppService;

    /** 轮换宽限期(0/负 = 关闭:轮换即时全量生效) */
    private final Duration embedKeyGrace;

    public DbAppSigningKeyProvider(
            AdminAppService adminAppService,
            @Value("${inneragent.auth.embed-key-grace:72h}") Duration embedKeyGrace) {
        this.adminAppService = adminAppService;
        this.embedKeyGrace = embedKeyGrace;
    }

    @Override
    public AppSigningKey load(String appKey) {
        AppRegistration app = adminAppService.requireEnabledByAppKey(appKey);
        if (app.getSignPublicKey() == null || app.getSignPublicKey().isBlank()) {
            throw new BusinessException(401, "应用未上传验签公钥: " + appKey);
        }
        return new AppSigningKey(
                app.getId(),
                app.getAppKey(),
                (RSAPublicKey) AdminAppService.parseRsaPublicKey(app.getSignPublicKey()),
                previousKeyWithinGrace(app));
    }

    /**
     * 宽限期内的上一代公钥;未轮换/超宽限/宽限关闭/旧 key 非法 → null
     * (旧 key 为轮换前写入的存量数据,解析失败只跳过兜底,不阻断当前 key 验签)。
     */
    private RSAPublicKey previousKeyWithinGrace(AppRegistration app) {
        if (embedKeyGrace == null || embedKeyGrace.isZero() || embedKeyGrace.isNegative()
                || app.getPreviousSignPublicKey() == null
                || app.getPreviousSignPublicKey().isBlank()
                || app.getSignKeyRotatedAt() == null) {
            return null;
        }
        if (!app.getSignKeyRotatedAt().plus(embedKeyGrace).isAfter(LocalDateTime.now())) {
            return null;
        }
        try {
            return (RSAPublicKey)
                    AdminAppService.parseRsaPublicKey(app.getPreviousSignPublicKey());
        } catch (BusinessException staleKey) {
            log.warn("应用 appId={} 的上一代验签公钥非法,跳过宽限期兜底验签: {}",
                    app.getId(), staleKey.getMessage());
            return null;
        }
    }
}
