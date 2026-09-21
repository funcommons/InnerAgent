package fun.commons.acmedemo.session;

import fun.commons.acmedemo.common.BizException;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Service;

/**
 * 演示登录会话(纯内存,重启即清)。
 *
 * ⚠️ 这不是生产认证——接入指南要求 embed token 只签给「宿主真实登录态」的用户;
 * DEMO 用「任意用户名即登录」模拟宿主登录态。用户名之外的第二个要素是
 * <strong>数字用户 ID</strong>:InnerAgent embed token 契约要求 sub 必须可解析为
 * Long(见 EmbedTokenVerifier.requireUserId),因此本服务为每个用户名分配一个
 * 稳定递增的数字 ID(同一用户名重复登录复用,保证跨会话的 sub 稳定);
 * 生产中这里就是你的用户表主键。
 */
@Service
public class DemoSessionService {

    /** 演示用户 ID 起始值(避开 0/1 这类系统保留位)。 */
    static final long FIRST_USER_ID = 10086L;

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final Map<String, Long> userIdByName = new ConcurrentHashMap<>();
    private final AtomicLong userIdSeq = new AtomicLong(FIRST_USER_ID);

    /** 登录结果:演示 token + 用户名 + 数字用户 ID(sub 的来源)。 */
    public record LoginResult(String token, String username, long userId) {
    }

    /** 登录:校验用户名 → 签发演示 token(opaque,仅内存可查)。 */
    public LoginResult login(String username) {
        if (username == null || username.isBlank()) {
            throw new BizException(400, "username 不能为空");
        }
        String name = username.trim();
        if (name.length() > 64) {
            throw new BizException(400, "username 不能超过 64 字符");
        }
        long userId = userIdByName.computeIfAbsent(name,
                ignored -> userIdSeq.getAndIncrement());
        String token = "demo-" + UUID.randomUUID();
        sessions.put(token, new Session(name, userId, Instant.now()));
        return new LoginResult(token, name, userId);
    }

    /** 由 Bearer token 解析登录态;无效/已登出 → empty。 */
    public Optional<Session> resolve(String bearerToken) {
        if (bearerToken == null || bearerToken.isBlank()) {
            return Optional.empty();
        }
        return Optional.ofNullable(sessions.get(bearerToken));
    }

    public boolean logout(String bearerToken) {
        return bearerToken != null && sessions.remove(bearerToken) != null;
    }

    /** 登录会话信息:username = 演示用户名,userId = 稳定数字 ID(embed token sub)。 */
    public record Session(String username, long userId, Instant createdAt) {
    }
}
