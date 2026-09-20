package com.inneragent.server.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.mapper.AdminAccountMapper;
import com.inneragent.server.admin.mapper.AdminLoginLogMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 管理员账号认证(P2-admin 18a,02-技术方案 §6.3:Argon2 口令散列 +
 * 失败锁定 + 登录审计)。
 *
 * <p>锁定策略(可配):连续失败 ≥{@code IA_ADMIN_LOCK_THRESHOLD}(默认 5)
 * 次即锁定 {@code IA_ADMIN_LOCK_MINUTES}(默认 15)分钟,失败计数同时清零
 * (锁定到期后从零起算的新窗口);期间一律拒绝(HTTP 423,提示剩余秒数)。
 * 全部登录尝试(含成功/账号不存在/密码错误/锁定中/已停用)落
 * ia_admin_login_log;登录审计尽力而为,失败不阻断主流程。
 *
 * <p>引导:启动时 ia_admin_account 为空且 env
 * {@code IA_ADMIN_BOOTSTRAP_PASSWORD} 已配置 → 建用户名
 * {@code IA_ADMIN_BOOTSTRAP_USERNAME}(默认 admin)的首个管理员并 WARN
 * (引导口令应尽快轮换);表空且未配置 → WARN 提示配置方式。
 * Argon2 参数(defaultsForSpringSecurity_v5_8):salt 16B / hash 32B /
 * parallelism 1 / memory 16 MiB / iterations 2(封存于 V10 迁移注释)。
 */
@Service
@Slf4j
public class AdminAuthService {

    /** 账号状态:启用 */
    private static final int STATUS_ENABLED = 1;
    /** Argon2 参数(defaultsForSpringSecurity_v5_8;见 V10 迁移注释) */
    private final Argon2PasswordEncoder encoder = new Argon2PasswordEncoder(16, 32, 1, 16384, 2);

    private final AdminAccountMapper accountMapper;
    private final AdminLoginLogMapper loginLogMapper;
    private final AdminSessionTokenService sessionTokenService;
    private final long lockThreshold;
    private final long lockMinutes;
    private final String bootstrapUsername;
    private final String bootstrapPassword;

    public AdminAuthService(
            AdminAccountMapper accountMapper,
            AdminLoginLogMapper loginLogMapper,
            AdminSessionTokenService sessionTokenService,
            @Value("${IA_ADMIN_LOCK_THRESHOLD:5}") long lockThreshold,
            @Value("${IA_ADMIN_LOCK_MINUTES:15}") long lockMinutes,
            @Value("${IA_ADMIN_BOOTSTRAP_USERNAME:admin}") String bootstrapUsername,
            @Value("${IA_ADMIN_BOOTSTRAP_PASSWORD:}") String bootstrapPassword) {
        this.accountMapper = accountMapper;
        this.loginLogMapper = loginLogMapper;
        this.sessionTokenService = sessionTokenService;
        this.lockThreshold = lockThreshold > 0 ? lockThreshold : 5;
        this.lockMinutes = lockMinutes > 0 ? lockMinutes : 15;
        this.bootstrapUsername = bootstrapUsername == null || bootstrapUsername.isBlank()
                ? "admin" : bootstrapUsername.trim();
        this.bootstrapPassword = bootstrapPassword == null ? "" : bootstrapPassword;
    }

    /**
     * 登录:成功签发管理会话 token;一切失败形态抛
     * {@link LoginFailureException}(code 401=凭据无效/停用,423=锁定中,
     * 统一文案「用户名或密码错误」防账号枚举;锁定中另行提示剩余时间)。
     */
    public AdminSessionTokenService.IssuedToken login(String username, String password, String ip) {
        String normalizedUsername = username == null ? "" : username.trim();
        AdminAccount account = accountMapper.selectOne(new LambdaQueryWrapper<AdminAccount>()
                .eq(AdminAccount::getUsername, normalizedUsername));
        if (account == null) {
            recordLogin(normalizedUsername, ip, false, "账号不存在");
            throw new LoginFailureException(401, "用户名或密码错误");
        }
        if (account.getStatus() == null || account.getStatus() != STATUS_ENABLED) {
            recordLogin(normalizedUsername, ip, false, "账号已停用");
            throw new LoginFailureException(401, "用户名或密码错误");
        }
        LocalDateTime now = LocalDateTime.now();
        if (account.getLockedUntil() != null && account.getLockedUntil().isAfter(now)) {
            long remainingSeconds = java.time.Duration.between(
                    now, account.getLockedUntil()).getSeconds();
            recordLogin(normalizedUsername, ip, false, "锁定中(剩余 " + remainingSeconds + "s)");
            throw new LoginFailureException(423, "账号已锁定,请 " + Math.max(remainingSeconds, 1) + " 秒后重试");
        }
        boolean passwordMatches = password != null
                && encoder.matches(password, account.getPasswordHash());
        if (!passwordMatches) {
            int attempts = (account.getFailedAttempts() == null ? 0 : account.getFailedAttempts()) + 1;
            boolean justLocked = attempts >= lockThreshold;
            account.setFailedAttempts(justLocked ? 0 : attempts);
            account.setLockedUntil(justLocked ? now.plusMinutes(lockMinutes) : null);
            account.setUpdateTime(now);
            accountMapper.updateById(account);
            if (justLocked) {
                recordLogin(normalizedUsername, ip, false,
                        "密码错误(第 " + attempts + " 次失败,触发锁定 " + lockMinutes + " 分钟)");
                throw new LoginFailureException(423,
                        "连续失败已达 " + lockThreshold + " 次,账号锁定 " + lockMinutes + " 分钟");
            }
            recordLogin(normalizedUsername, ip, false, "密码错误(第 " + attempts + " 次失败)");
            throw new LoginFailureException(401, "用户名或密码错误");
        }
        // 成功:清零失败计数、解除锁定(过期后自动可登录的语义在此兜底)
        account.setFailedAttempts(0);
        account.setLockedUntil(null);
        account.setLastLoginAt(now);
        account.setUpdateTime(now);
        accountMapper.updateById(account);
        recordLogin(normalizedUsername, ip, true, null);
        log.info("管理员登录成功: username={}, ip={}", normalizedUsername, ip);
        return sessionTokenService.issue(account.getUsername());
    }

    /** 登出:吊销会话 token(jti 黑名单)。 */
    public void logout(String bearerToken) {
        AdminSessionTokenService.SessionPrincipal principal =
                sessionTokenService.verify(bearerToken);
        sessionTokenService.revoke(principal);
        log.info("管理员登出: username={}, jti={}", principal.username(), principal.jti());
    }

    /**
     * 启动引导:表空且配置了引导口令 → 建首个管理员(WARN);
     * 表空未配置 → WARN 提示;已有账号 → 静默跳过。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void bootstrapAdminAccount() {
        Long accountCount = accountMapper.selectCount(null);
        if (accountCount != null && accountCount > 0) {
            log.info("管理员账号表非空({} 个账号),跳过引导", accountCount);
            return;
        }
        if (bootstrapPassword.isBlank()) {
            log.warn("ia_admin_account 为空且未配置 IA_ADMIN_BOOTSTRAP_PASSWORD:"
                    + "管理站账号登录不可用(仅 X-IA-Admin-Key 自动化通道可用);"
                    + "配置该环境变量后重启即可创建首个管理员账号");
            return;
        }
        AdminAccount account = new AdminAccount();
        account.setAppId(1L);
        account.setTenantId(0L);
        account.setUsername(bootstrapUsername);
        account.setPasswordHash(encoder.encode(bootstrapPassword));
        account.setFailedAttempts(0);
        account.setStatus(STATUS_ENABLED);
        LocalDateTime now = LocalDateTime.now();
        account.setCreateTime(now);
        account.setUpdateTime(now);
        accountMapper.insert(account);
        log.warn("已创建首个管理员账号: username={},(Argon2id,defaultsForSpringSecurity_v5_8)"
                        + "——引导口令来自 IA_ADMIN_BOOTSTRAP_PASSWORD,请尽快登录后轮换",
                bootstrapUsername);
    }

    /** 登录审计(尽力而为:审计写失败不阻断登录主流程)。 */
    private void recordLogin(String username, String ip, boolean success, String failReason) {
        AdminLoginLog entry = new AdminLoginLog();
        entry.setAppId(1L);
        entry.setTenantId(0L);
        entry.setUsername(username);
        entry.setIp(ip);
        entry.setSuccess(success);
        entry.setFailReason(failReason);
        try {
            loginLogMapper.append(entry);
        } catch (RuntimeException auditWriteFailure) {
            log.error("登录审计写入失败: username={}, success={}", username, success,
                    auditWriteFailure);
        }
    }

    /** 登录失败(code 由登录流程给出:401 凭据无效/停用,423 锁定中)。 */
    public static final class LoginFailureException extends BusinessException {
        public LoginFailureException(int code, String message) {
            super(code, message);
        }
    }
}
