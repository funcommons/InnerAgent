package com.inneragent.platform.context;

import com.inneragent.platform.tenant.TenantContext;

import java.util.function.Supplier;

/**
 * 用户上下文：基于 ThreadLocal 传递当前终端用户身份（userId + tenantId）。
 *
 * <p>P1-T1 引入的双层上下文之内层（02-技术方案 §4.2）：来源为 embed token claims
 * （userId 必填、tenantId 由宿主声明透传、缺省 0）；P0 演示链路由
 * {@code DemoUserAuthenticationFilter} 写入演示用户（无租户）。
 *
 * <p><strong>租户单一来源约定</strong>：{@code tenantId} 的读取一律以
 * {@link TenantContext} 为准（行级拦截器、工具执行链路均读 TenantContext）。
 * {@link #set(Long, Long)} 写入时会同步 {@code TenantContext.setTenantId}，
 * {@link #clear()} 同步 {@link TenantContext#clear()}——写入与清理对双源
 * <strong>对称生效</strong>（acme-demo 真机 DEF：embed 请求结束只清本类，
 * 池化线程残留 tenant_id=0，复用线程上对无 tenant_id 列的表注入租户条件
 * → column "tenant_id" does not exist → 500）；本类的 tenantId 仅为随身份
 * 一体传递的便利视图。
 *
 * <p>注意 ThreadLocal 不随 Reactor 调度器 hop 传播：跨线程链路中租户由
 * TenantContext 捕获恢复（AgentRuntimeSchedulers），持久归属以会话/运行行为准。
 */
public final class UserContext {

    private static final ThreadLocal<CurrentUser> CURRENT = new ThreadLocal<>();

    private UserContext() {
    }

    /**
     * 当前用户身份快照（userId + tenantId 视图）。
     */
    public record CurrentUser(Long userId, Long tenantId) {
    }

    /**
     * 写入当前用户并同步租户到 {@link TenantContext}（tenantId 为 null 时不改写租户）。
     */
    public static void set(Long userId, Long tenantId) {
        CURRENT.set(new CurrentUser(userId, tenantId));
        if (tenantId != null) {
            TenantContext.setTenantId(tenantId);
        }
    }

    public static CurrentUser get() {
        return CURRENT.get();
    }

    /**
     * 当前用户 ID；未设置时返回 null。
     */
    public static Long getUserId() {
        CurrentUser current = CURRENT.get();
        return current != null ? current.userId() : null;
    }

    /**
     * 当前租户视图值；权威来源仍是 {@link TenantContext#getTenantId()}。
     */
    public static Long getTenantId() {
        CurrentUser current = CURRENT.get();
        return current != null ? current.tenantId() : null;
    }

    /**
     * 清理当前线程的用户与租户上下文（统一清理入口）。
     *
     * <p>与 {@link #set(Long, Long)} 的同步写入对称：本类写入时会联动
     * {@link TenantContext}，清理若只移除自身 ThreadLocal， servlet 线程池
     * 归复用后租户残留（embed token 缺省 tenantId=0 尤其隐蔽）——同线程后续
     * 请求对不在 {@code AppTenantLineInnerInterceptor#IGNORED_TABLES} 且无
     * tenant_id 列的表被注入租户条件，直接 500。故此处必须双清。
     * {@link #runAs(Long, Long, Supplier)} 的作用域恢复不走本方法（按快照精确还原）。
     */
    public static void clear() {
        CURRENT.remove();
        TenantContext.clear();
    }

    public static void runAs(Long userId, Long tenantId, Runnable action) {
        runAs(userId, tenantId, () -> {
            action.run();
            return null;
        });
    }

    public static <T> T runAs(Long userId, Long tenantId, Supplier<T> action) {
        CurrentUser previous = CURRENT.get();
        Long previousTenant = TenantContext.getTenantId();
        set(userId, tenantId);
        try {
            return action.get();
        } finally {
            if (previous != null) {
                CURRENT.set(previous);
            } else {
                CURRENT.remove();
            }
            if (previousTenant != null) {
                TenantContext.setTenantId(previousTenant);
            } else if (tenantId != null) {
                TenantContext.clear();
            }
        }
    }
}
