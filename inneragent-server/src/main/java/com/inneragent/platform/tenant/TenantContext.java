package com.inneragent.platform.tenant;

import java.util.function.Supplier;

/**
 * 租户上下文：基于 ThreadLocal 传递当前租户（团队）ID。
 * <p>
 * Web 请求由 {@link TenantContextFilter} 从认证信息填充；
 * 后台线程（定时任务、生成消费者、Agent 运行时）必须显式选择：
 * <ul>
 *   <li>{@link #runInTenant(Long, Runnable)}：以指定租户执行（如按任务行回查）</li>
 *   <li>{@link #runAsSystem(Runnable)}：跨租户系统操作（跳过租户过滤），
 *       调用方必须已经完成租户归属校验，并以全局唯一 ID 定位数据</li>
 * </ul>
 */
public final class TenantContext {

    private static final ThreadLocal<Long> TENANT_ID = new ThreadLocal<>();
    private static final ThreadLocal<Boolean> IGNORE = ThreadLocal.withInitial(() -> Boolean.FALSE);

    private TenantContext() {
    }

    public static void setTenantId(Long tenantId) {
        TENANT_ID.set(tenantId);
    }

    public static Long getTenantId() {
        return TENANT_ID.get();
    }

    public static boolean isIgnored() {
        return Boolean.TRUE.equals(IGNORE.get());
    }

    /**
     * 供跨线程传播（如调度器任务装饰器）显式恢复系统模式
     */
    public static void setIgnore(boolean ignore) {
        IGNORE.set(ignore);
    }

    public static void clear() {
        TENANT_ID.remove();
        IGNORE.remove();
    }

    public static void runAsSystem(Runnable action) {
        runAsSystem(() -> {
            action.run();
            return null;
        });
    }

    public static <T> T runAsSystem(Supplier<T> action) {
        Boolean previous = IGNORE.get();
        IGNORE.set(Boolean.TRUE);
        try {
            return action.get();
        } finally {
            IGNORE.set(previous);
        }
    }

    public static void runInTenant(Long tenantId, Runnable action) {
        runInTenant(tenantId, () -> {
            action.run();
            return null;
        });
    }

    public static <T> T runInTenant(Long tenantId, Supplier<T> action) {
        Long previous = TENANT_ID.get();
        Boolean previousIgnore = IGNORE.get();
        TENANT_ID.set(tenantId);
        IGNORE.set(Boolean.FALSE);
        try {
            return action.get();
        } finally {
            if (previous != null) {
                TENANT_ID.set(previous);
            } else {
                TENANT_ID.remove();
            }
            IGNORE.set(previousIgnore);
        }
    }
}
