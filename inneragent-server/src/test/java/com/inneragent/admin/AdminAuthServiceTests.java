package com.inneragent.admin;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.AdminAccount;
import com.inneragent.server.admin.AdminAuthService;
import com.inneragent.server.admin.AdminLoginLog;
import com.inneragent.server.admin.AdminSessionTokenService;
import com.inneragent.server.admin.mapper.AdminAccountMapper;
import com.inneragent.server.admin.mapper.AdminLoginLogMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 管理员账号认证服务测试:Argon2 校验、失败锁定矩阵、登录审计、启动引导。
 */
class AdminAuthServiceTests {

    private static final String SECRET_32B = "0123456789abcdef0123456789abcdef";
    /** 与 AdminAuthService 相同参数的编码器(hash 校验用) */
    private static final Argon2PasswordEncoder ENCODER =
            new Argon2PasswordEncoder(16, 32, 1, 16384, 2);

    private AdminAccountMapper accountMapper;
    private AdminLoginLogMapper loginLogMapper;
    private AdminSessionTokenService sessionTokenService;
    private AdminAuthService service;
    private AdminAccount account;

    @BeforeEach
    void setUp() {
        accountMapper = Mockito.mock(AdminAccountMapper.class);
        loginLogMapper = Mockito.mock(AdminLoginLogMapper.class);
        sessionTokenService = Mockito.mock(AdminSessionTokenService.class);
        service = new AdminAuthService(accountMapper, loginLogMapper, sessionTokenService,
                5, 15, "admin", "");
        account = new AdminAccount();
        account.setId(7L);
        account.setUsername("ops-admin");
        account.setPasswordHash(ENCODER.encode("s3cret-Pass!"));
        account.setFailedAttempts(0);
        account.setStatus(1);
        when(accountMapper.selectOne(any())).thenReturn(account);
        when(accountMapper.updateById(any(AdminAccount.class))).thenReturn(1);
    }

    private void assertAudit(String username, boolean success, String reasonPart) {
        ArgumentCaptor<AdminLoginLog> captor = ArgumentCaptor.forClass(AdminLoginLog.class);
        verify(loginLogMapper, atLeastOnce()).append(captor.capture());
        List<AdminLoginLog> entries = captor.getAllValues();
        assertThat(entries).anySatisfy(entry -> {
            assertThat(entry.getUsername()).isEqualTo(username);
            assertThat(entry.getSuccess()).isEqualTo(success);
            if (reasonPart != null) {
                assertThat(entry.getFailReason()).contains(reasonPart);
            }
        });
    }

    @Test
    @DisplayName("成功登录:Argon2 校验通过→计数清零/last_login_at 更新/签发 token/审计 success")
    void successfulLoginResetsCounterAndIssuesToken() {
        when(sessionTokenService.issue("ops-admin"))
                .thenReturn(new AdminSessionTokenService.IssuedToken("jwt", "ops-admin",
                        "jti-1", java.time.Instant.now().plusSeconds(14400), 14400));

        AdminSessionTokenService.IssuedToken issued = service.login("ops-admin", "s3cret-Pass!", "10.0.0.1");

        assertThat(issued.token()).isEqualTo("jwt");
        ArgumentCaptor<AdminAccount> saved = ArgumentCaptor.forClass(AdminAccount.class);
        verify(accountMapper).updateById(saved.capture());
        assertThat(saved.getValue().getFailedAttempts()).isZero();
        assertThat(saved.getValue().getLockedUntil()).isNull();
        assertThat(saved.getValue().getLastLoginAt()).isNotNull();
        assertAudit("ops-admin", true, null);
    }

    @Test
    @DisplayName("失败锁定:连续 4 次 401 计数递增,第 5 次 423 且锁定 15 分钟、计数清零")
    void fifthConsecutiveFailureLocksAccountFor15Minutes() {
        for (int attempt = 1; attempt <= 4; attempt++) {
            assertThatThrownBy(() -> service.login("ops-admin", "wrong", "10.0.0.1"))
                    .isInstanceOf(AdminAuthService.LoginFailureException.class)
                    .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(401));
        }
        assertThatThrownBy(() -> service.login("ops-admin", "wrong", "10.0.0.1"))
                .isInstanceOf(AdminAuthService.LoginFailureException.class)
                .satisfies(e -> {
                    assertThat(((BusinessException) e).getCode()).isEqualTo(423);
                    assertThat(e.getMessage()).contains("15");
                });

        ArgumentCaptor<AdminAccount> saved = ArgumentCaptor.forClass(AdminAccount.class);
        verify(accountMapper, times(5)).updateById(saved.capture());
        AdminAccount last = saved.getValue();
        assertThat(last.getLockedUntil()).isAfter(LocalDateTime.now().plusMinutes(14));
        assertThat(last.getFailedAttempts()).isZero();
        assertAudit("ops-admin", false, "第 5 次失败");
    }

    @Test
    @DisplayName("锁定期间正确密码也拒绝(423);锁定过期后可登录且解除锁定")
    void lockoutBlocksCorrectPasswordUntilExpiry() {
        // 第 5 次失败触发锁定
        for (int attempt = 0; attempt < 5; attempt++) {
            try {
                service.login("ops-admin", "wrong", "10.0.0.1");
            } catch (BusinessException expected) {
                // ignore
            }
        }
        Mockito.reset(accountMapper);
        when(accountMapper.selectOne(any())).thenReturn(account);
        when(accountMapper.updateById(any(AdminAccount.class))).thenReturn(1);
        account.setLockedUntil(LocalDateTime.now().plusMinutes(10));

        assertThatThrownBy(() -> service.login("ops-admin", "s3cret-Pass!", "10.0.0.1"))
                .isInstanceOf(AdminAuthService.LoginFailureException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(423));
        verify(accountMapper, never()).updateById(any(AdminAccount.class));

        // 锁定过期:锁定截止时间已过 → 正常登录且 locked_until 解除
        account.setLockedUntil(LocalDateTime.now().minusMinutes(1));
        when(sessionTokenService.issue("ops-admin"))
                .thenReturn(new AdminSessionTokenService.IssuedToken("jwt", "ops-admin", "jti",
                        Instant.now().plusSeconds(3600), 3600));
        assertThatCode(() -> service.login("ops-admin", "s3cret-Pass!", "10.0.0.1"))
                .doesNotThrowAnyException();
        ArgumentCaptor<AdminAccount> saved = ArgumentCaptor.forClass(AdminAccount.class);
        verify(accountMapper).updateById(saved.capture());
        assertThat(saved.getValue().getLockedUntil()).isNull();
        assertThat(saved.getValue().getFailedAttempts()).isZero();
    }

    @Test
    @DisplayName("账号不存在/已停用:统一 401 文案(防账号枚举),原样用户名落审计")
    void missingOrDisabledAccountFailsUniformly() {
        when(accountMapper.selectOne(any())).thenReturn(null);
        assertThatThrownBy(() -> service.login("ghost", "x", "10.0.0.1"))
                .isInstanceOf(AdminAuthService.LoginFailureException.class)
                .hasMessage("用户名或密码错误");
        assertAudit("ghost", false, "账号不存在");

        account.setStatus(0);
        when(accountMapper.selectOne(any())).thenReturn(account);
        assertThatThrownBy(() -> service.login("ops-admin", "s3cret-Pass!", "10.0.0.1"))
                .isInstanceOf(AdminAuthService.LoginFailureException.class);
        assertAudit("ops-admin", false, "账号已停用");
    }

    @Test
    @DisplayName("登录审计写失败不阻断登录主流程(尽力而为,与 ia_audit_log fail-closed 相反)")
    void auditWriteFailureDoesNotBlockLogin() {
        Mockito.doThrow(new RuntimeException("db down"))
                .when(loginLogMapper).append(any(AdminLoginLog.class));
        when(sessionTokenService.issue("ops-admin"))
                .thenReturn(new AdminSessionTokenService.IssuedToken("jwt", "ops-admin", "jti",
                        Instant.now().plusSeconds(3600), 3600));

        assertThatCode(() -> service.login("ops-admin", "s3cret-Pass!", "10.0.0.1"))
                .doesNotThrowAnyException();
        verify(sessionTokenService).issue("ops-admin");
    }

    @Test
    @DisplayName("启动引导:表空+配置口令→建号(Argon2id);表非空或未配置口令→不建")
    void bootstrapCreatesFirstAdminOnlyWhenEmptyAndConfigured() {
        // 表空 + 未配置:仅 WARN,不建号
        when(accountMapper.selectCount(null)).thenReturn(0L);
        service.bootstrapAdminAccount();
        verify(accountMapper, never()).insert(any(AdminAccount.class));

        // 表非空:跳过
        when(accountMapper.selectCount(null)).thenReturn(2L);
        service.bootstrapAdminAccount();
        verify(accountMapper, never()).insert(any(AdminAccount.class));

        // 表空 + 配置口令:建 admin 账号,Argon2id 哈希可校验
        AdminAuthService bootstrapping = new AdminAuthService(accountMapper, loginLogMapper,
                sessionTokenService, 5, 15, "root-admin", "boot-Password1");
        when(accountMapper.selectCount(null)).thenReturn(0L);
        bootstrapping.bootstrapAdminAccount();
        ArgumentCaptor<AdminAccount> created = ArgumentCaptor.forClass(AdminAccount.class);
        verify(accountMapper).insert(created.capture());
        AdminAccount bootstrapAccount = created.getValue();
        assertThat(bootstrapAccount.getUsername()).isEqualTo("root-admin");
        assertThat(bootstrapAccount.getPasswordHash()).startsWith("$argon2id$");
        assertThat(ENCODER.matches("boot-Password1", bootstrapAccount.getPasswordHash())).isTrue();
        assertThat(bootstrapAccount.getStatus()).isEqualTo(1);
        assertThat(bootstrapAccount.getAppId()).isEqualTo(1L);
    }

    @Test
    @DisplayName("登出:校验+吊销当前会话 token")
    void logoutRevokesSession() {
        AdminSessionTokenService.SessionPrincipal principal =
                new AdminSessionTokenService.SessionPrincipal("ops-admin", "jti-9",
                        Instant.now().plusSeconds(300));
        when(sessionTokenService.verify("jwt-token")).thenReturn(principal);

        service.logout("jwt-token");
        verify(sessionTokenService).revoke(principal);
    }
}
