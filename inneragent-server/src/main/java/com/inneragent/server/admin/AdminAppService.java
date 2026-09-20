package com.inneragent.server.admin;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.mapper.AppRegistrationMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.List;

/**
 * 应用注册管理(P1-T1,02-技术方案 §6.3:宿主后端 ↔ InnerAgent 管理面)。
 *
 * <p>注册时校验签名公钥为合法 RSA 公钥 PEM(embed token 验签依赖),
 * app_key 唯一约束冲突返回 409。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AdminAppService {

    private static final String PUBLIC_KEY_HEADER = "-----BEGIN PUBLIC KEY-----";

    private final AppRegistrationMapper appMapper;

    public AppRegistration register(
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
        return app;
    }

    public List<AppRegistration> list() {
        return appMapper.selectList(null);
    }

    public AppRegistration getRequired(long id) {
        AppRegistration app = appMapper.selectById(id);
        if (app == null) {
            throw new BusinessException(404, "应用不存在: " + id);
        }
        return app;
    }

    public AppRegistration update(long id, String name, String signPublicKeyPem,
                                   String webhookUrl, String webhookSecret, Integer status) {
        AppRegistration app = getRequired(id);
        if (name != null && !name.isBlank()) {
            app.setName(name.trim());
        }
        if (signPublicKeyPem != null && !signPublicKeyPem.isBlank()) {
            parseRsaPublicKey(signPublicKeyPem.trim());
            app.setSignPublicKey(signPublicKeyPem.trim());
        }
        if (webhookUrl != null) {
            app.setWebhookUrl(webhookUrl.isBlank() ? null : webhookUrl.trim());
        }
        if (webhookSecret != null) {
            app.setWebhookSecret(webhookSecret.isBlank() ? null : webhookSecret.trim());
        }
        if (status != null && (status == 0 || status == 1)) {
            app.setStatus(status);
        }
        appMapper.updateById(app);
        return app;
    }

    public void delete(long id) {
        getRequired(id);
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
