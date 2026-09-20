package com.inneragent.server.admin;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.mapper.AppRegistrationMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;

/**
 * 应用注册管理(P1-T1,02-技术方案 §6.3:宿主后端 ↔ InnerAgent 管理面)。
 *
 * <p>注册时校验签名公钥为合法 RSA 公钥 PEM(embed token 验签依赖),
 * app_key 唯一约束冲突返回 409。
 *
 * <p><strong>webhookSecret 脱敏铁律(P2-key)</strong>:write-only 字段——创建后
 * 仅可重置不可读,任何响应不回明文(见 {@link AppView},仅回
 * {@code webhookSecretMasked},掩码口径对齐 {@link AdminModelConfigService#maskSecret});
 * PUT 空/缺省 = 不修改(与 apiKey write-only 同款)。
 *
 * <p><strong>公钥轮换宽限期(P2-key,V9)</strong>:PUT signPublicKey 轮换时旧值
 * 移入 {@code previous_sign_public_key}、{@code sign_key_rotated_at}=now(再次轮换
 * 覆盖 previous);宽限期({@code inneragent.auth.embed-key-grace},默认 72h)内
 * 存量 embed token 仍可用旧公钥验签(对齐 ActTokenKeyManager 双 key 语义,
 * 验签链见 {@link com.inneragent.server.auth.DbAppSigningKeyProvider} +
 * {@link com.inneragent.server.auth.EmbedTokenVerifier})。同值重复 PUT 不算轮换。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AdminAppService {

    private static final String PUBLIC_KEY_HEADER = "-----BEGIN PUBLIC KEY-----";

    private final AppRegistrationMapper appMapper;

    /**
     * 应用响应视图(web 脚手架 IaApp 契约形;webhookSecret 永不回显,仅掩码;
     * 补 signKeyFingerprint/signKeyRotatedAt 供 web 侧轮换 UI 恢复)。
     */
    public record AppView(
            long id,
            String appKey,
            String name,
            String signPublicKey,
            String signKeyFingerprint,
            Instant signKeyRotatedAt,
            String webhookUrl,
            String webhookSecretMasked,
            Integer conversationRetentionDays,
            Integer status,
            Instant createTime,
            Instant updateTime) {
    }

    public AppView register(
            String appKey, String name, String signPublicKeyPem,
            String webhookUrl, String webhookSecret) {
        requirePem(appKey, name, signPublicKeyPem);
        AppRegistration app = new AppRegistration();
        app.setAppKey(appKey.trim());
        app.setName(name.trim());
        app.setSignPublicKey(signPublicKeyPem.trim());
        app.setWebhookUrl(webhookUrl);
        app.setWebhookSecret(webhookSecret);
        app.setConversationRetentionDays(180);
        app.setStatus(1);
        try {
            appMapper.insert(app);
        } catch (DuplicateKeyException duplicate) {
            throw new BusinessException(409, "应用 appKey 已存在: " + appKey);
        }
        log.info("应用注册成功: appId={}, appKey={}", app.getId(), app.getAppKey());
        return toView(app);
    }

    public List<AppView> list() {
        return appMapper.selectList(null).stream().map(AdminAppService::toView).toList();
    }

    public AppView getRequiredView(long id) {
        return toView(requireEntity(id));
    }

    public AppRegistration requireEntity(long id) {
        AppRegistration app = appMapper.selectById(id);
        if (app == null) {
            throw new BusinessException(404, "应用不存在: " + id);
        }
        return app;
    }

    public AppView update(long id, String name, String signPublicKeyPem,
                          String webhookUrl, String webhookSecret, Integer status) {
        AppRegistration app = requireEntity(id);
        if (name != null && !name.isBlank()) {
            app.setName(name.trim());
        }
        if (signPublicKeyPem != null && !signPublicKeyPem.isBlank()) {
            rotateSignKey(app, parseRsaPublicKey(signPublicKeyPem.trim()), signPublicKeyPem.trim());
        }
        if (webhookUrl != null) {
            app.setWebhookUrl(webhookUrl.isBlank() ? null : webhookUrl.trim());
        }
        // write-only:空/缺省 = 不修改;非空 = 重置(覆写)。不提供清空路径,
        // 与 AdminModelConfigService 的 apiKey 同款
        if (webhookSecret != null && !webhookSecret.isBlank()) {
            app.setWebhookSecret(webhookSecret.trim());
        }
        if (status != null && (status == 0 || status == 1)) {
            app.setStatus(status);
        }
        appMapper.updateById(app);
        return toView(app);
    }

    public void delete(long id) {
        requireEntity(id);
        appMapper.deleteById(id);
        log.info("应用已注销: appId={}", id);
    }

    /**
     * 按 appKey 加载启用中应用(embed 验签链路;不存在/禁用抛 401 语义异常)。
     */
    public AppRegistration requireEnabledByAppKey(String appKey) {
        AppRegistration app = appMapper.selectByAppKey(appKey);
        if (app == null || app.getStatus() == null || app.getStatus() != 1) {
            throw new BusinessException(401, "未知或禁用的应用: " + appKey);
        }
        return app;
    }

    /**
     * 轮换语义:当前值存在且与新值不同 → 旧值移入 previous、rotated_at=now
     * (再次轮换覆盖 previous);同值重复 PUT 或首次登记不算轮换。
     */
    private static void rotateSignKey(AppRegistration app, PublicKey parsedNewKey, String newPem) {
        String current = app.getSignPublicKey();
        if (newPem.equals(current)) {
            return;
        }
        app.setPreviousSignPublicKey(current);
        app.setSignKeyRotatedAt(LocalDateTime.now());
        app.setSignPublicKey(newPem);
        log.info("应用签名公钥已轮换: appId={}, 新指纹={}, 旧公钥进入 72h 宽限期"
                        + "(inneragent.auth.embed-key-grace 可配)",
                app.getId(), fingerprintOf(parsedNewKey));
    }

    /**
     * 响应视图装配:webhookSecret 永不回明文(仅掩码);公钥指纹
     * {@link #fingerprintOf(PublicKey)};时间以 UTC Instant 回显。
     */
    public static AppView toView(AppRegistration app) {
        return new AppView(
                app.getId(),
                app.getAppKey(),
                app.getName(),
                app.getSignPublicKey(),
                fingerprintOf(app.getSignPublicKey()),
                toInstantUtc(app.getSignKeyRotatedAt()),
                app.getWebhookUrl(),
                AdminModelConfigService.maskSecret(app.getWebhookSecret()),
                app.getConversationRetentionDays(),
                app.getStatus(),
                toInstantUtc(app.getCreateTime()),
                toInstantUtc(app.getUpdateTime()));
    }

    /**
     * 公钥指纹:PEM → 解析 → DER 编码 SHA-256 摘要十六进制前 16 位
     * (摘要算法与 act token kid 一致:均为公钥 DER 的 SHA-256;kid 取
     * Base64URL 前 16 字符,指纹取 hex 前 16 字符)。解析失败返回 null
     * (存量脏数据不阻断管理面读)。
     */
    public static String fingerprintOf(String pem) {
        if (pem == null || pem.isBlank()) {
            return null;
        }
        try {
            return fingerprintOf(parseRsaPublicKey(pem));
        } catch (BusinessException invalidPem) {
            log.warn("signPublicKey 指纹计算失败(公钥非法): {}", invalidPem.getMessage());
            return null;
        }
    }

    private static String fingerprintOf(PublicKey publicKey) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(publicKey.getEncoded());
            return HexFormat.of().formatHex(digest).substring(0, 16);
        } catch (GeneralSecurityException digestFailure) {
            throw new IllegalStateException("SHA-256 不可用", digestFailure);
        }
    }

    private static Instant toInstantUtc(LocalDateTime value) {
        return value == null ? null : value.toInstant(ZoneOffset.UTC);
    }

    private static void requirePem(String appKey, String name, String signPublicKeyPem) {
        if (appKey == null || appKey.isBlank()) {
            throw new BusinessException(400, "appKey 不能为空");
        }
        if (name == null || name.isBlank()) {
            throw new BusinessException(400, "name 不能为空");
        }
        parseRsaPublicKey(signPublicKeyPem);
    }

    /**
     * 校验并解析 RSA 公钥 PEM(X509/PKCS#8 SubjectPublicKeyInfo)。
     */
    public static PublicKey parseRsaPublicKey(String pem) {
        if (pem == null || pem.isBlank()) {
            throw new BusinessException(400, "signPublicKey(PEM) 不能为空");
        }
        String base64 = pem
                .replace(PUBLIC_KEY_HEADER, "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s", "");
        try {
            byte[] encoded = Base64.getDecoder().decode(base64);
            return KeyFactory.getInstance("RSA")
                    .generatePublic(new X509EncodedKeySpec(encoded));
        } catch (IllegalArgumentException | GeneralSecurityException invalidPem) {
            throw new BusinessException(400, "signPublicKey 不是合法的 RSA 公钥 PEM");
        }
    }
}
