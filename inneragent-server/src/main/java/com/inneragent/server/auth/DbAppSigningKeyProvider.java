package com.inneragent.server.auth;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.AdminAppService;
import com.inneragent.server.admin.AppRegistration;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 生产验签公钥加载:ia_app(app_key) 的 sign_public_key(PEM)。
 *
 * <p>[新增] P1-T1;公钥轮换经 admin API 更新该列即时生效(逐请求加载,
 * 暂不做缓存,管理面 QPS 低)。
 */
@Component
@RequiredArgsConstructor
public class DbAppSigningKeyProvider implements AppSigningKeyProvider {

    private final AdminAppService adminAppService;

    @Override
    public AppSigningKey load(String appKey) {
        AppRegistration app = adminAppService.requireEnabledByAppKey(appKey);
        if (app.getSignPublicKey() == null || app.getSignPublicKey().isBlank()) {
            throw new BusinessException(401, "应用未上传验签公钥: " + appKey);
        }
        return new AppSigningKey(
                app.getId(), app.getAppKey(),
                (java.security.interfaces.RSAPublicKey)
                        AdminAppService.parseRsaPublicKey(app.getSignPublicKey()));
    }
}
