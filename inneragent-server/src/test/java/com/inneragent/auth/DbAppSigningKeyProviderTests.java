package com.inneragent.auth;

import com.inneragent.auth.support.EmbedTokenTestSupport;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.AdminAppService;
import com.inneragent.server.admin.AppRegistration;
import com.inneragent.server.auth.AppSigningKeyProvider.AppSigningKey;
import com.inneragent.server.auth.DbAppSigningKeyProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验签公钥加载宽限期单测(P2-key):PUT signPublicKey 轮换后,
 * {@code previous_sign_public_key} 仅在 {@code sign_key_rotated_at + 宽限期
 * (inneragent.auth.embed-key-grace,默认 72h)} 内参与验签链;
 * 宽限期外/未轮换/关闭宽限/旧 key 非法时只暴露当前公钥。
 */
class DbAppSigningKeyProviderTests {

    private static final String APP_KEY = "demo-app";
    private static final Duration GRACE = Duration.ofHours(72);

    private static final KeyPair CURRENT = EmbedTokenTestSupport.generateKeyPair();
    private static final KeyPair PREVIOUS = EmbedTokenTestSupport.generateKeyPair();

    private AdminAppService adminAppService;

    @BeforeEach
    void setUp() {
        adminAppService = mock(AdminAppService.class);
    }

    private DbAppSigningKeyProvider newProvider(Duration grace) {
        return new DbAppSigningKeyProvider(adminAppService, grace);
    }

    private AppRegistration app(LocalDateTime rotatedAt, boolean malformedPrevious) {
        AppRegistration app = new AppRegistration();
        app.setId(42L);
        app.setAppKey(APP_KEY);
        app.setStatus(1);
        app.setSignPublicKey(EmbedTokenTestSupport.toPem(CURRENT.getPublic()));
        app.setPreviousSignPublicKey(malformedPrevious
                ? "not-a-valid-pem"
                : EmbedTokenTestSupport.toPem(PREVIOUS.getPublic()));
        app.setSignKeyRotatedAt(rotatedAt);
        return app;
    }

    @Test
    @DisplayName("宽限期内(rotated_at + 72h > now):previous 公钥参与验签链")
    void exposesPreviousKeyWithinGrace() {
        when(adminAppService.requireEnabledByAppKey(APP_KEY))
                .thenReturn(app(LocalDateTime.now().minusHours(1), false));

        AppSigningKey key = newProvider(GRACE).load(APP_KEY);

        assertThat(key.appId()).isEqualTo(42L);
        assertThat(key.publicKey()).isEqualTo((RSAPublicKey) CURRENT.getPublic());
        assertThat(key.previousPublicKey()).isEqualTo((RSAPublicKey) PREVIOUS.getPublic());
    }

    @Test
    @DisplayName("宽限期外(rotated_at + 72h < now):只暴露当前公钥,存量旧令牌拒绝")
    void hidesPreviousKeyBeyondGrace() {
        when(adminAppService.requireEnabledByAppKey(APP_KEY))
                .thenReturn(app(LocalDateTime.now().minusHours(73), false));

        AppSigningKey key = newProvider(GRACE).load(APP_KEY);

        assertThat(key.previousPublicKey()).isNull();
    }

    @Test
    @DisplayName("宽限期边界:恰好 rotated_at + 72h == now → 不再宽限(after 判定)")
    void graceBoundaryIsExclusive() {
        when(adminAppService.requireEnabledByAppKey(APP_KEY))
                .thenReturn(app(LocalDateTime.now().minus(GRACE), false));

        assertThat(newProvider(GRACE).load(APP_KEY).previousPublicKey()).isNull();
    }

    @Test
    @DisplayName("宽限期配置为 0/负:关闭宽限,轮换即时全量生效")
    void zeroOrNegativeGraceDisablesFallback() {
        when(adminAppService.requireEnabledByAppKey(APP_KEY))
                .thenReturn(app(LocalDateTime.now(), false));

        assertThat(newProvider(Duration.ZERO).load(APP_KEY).previousPublicKey()).isNull();
        assertThat(newProvider(Duration.ofHours(-1)).load(APP_KEY).previousPublicKey()).isNull();
    }

    @Test
    @DisplayName("从未轮换(previous/rotated_at 为 NULL):无宽限公钥")
    void noRotationMeansNoPreviousKey() {
        AppRegistration neverRotated = app(null, false);
        neverRotated.setPreviousSignPublicKey(null);
        when(adminAppService.requireEnabledByAppKey(APP_KEY)).thenReturn(neverRotated);

        assertThat(newProvider(GRACE).load(APP_KEY).previousPublicKey()).isNull();
    }

    @Test
    @DisplayName("旧公钥非法(存量脏数据):跳过宽限验签,不阻断当前 key 验签")
    void malformedPreviousKeyIsSkipped() {
        when(adminAppService.requireEnabledByAppKey(APP_KEY))
                .thenReturn(app(LocalDateTime.now(), true));

        assertThat(newProvider(GRACE).load(APP_KEY).previousPublicKey()).isNull();
    }

    @Test
    @DisplayName("应用未知/禁用:401 语义透传(宽限逻辑不改变鉴权)")
    void unknownOrDisabledAppStillRejected() {
        when(adminAppService.requireEnabledByAppKey(APP_KEY))
                .thenThrow(new BusinessException(401, "未知或禁用的应用: " + APP_KEY));

        assertThatThrownBy(() -> newProvider(GRACE).load(APP_KEY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining(APP_KEY);
    }
}
