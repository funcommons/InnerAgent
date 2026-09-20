package com.inneragent.platform.context;

import java.util.function.Supplier;

/**
 * 应用上下文：基于 ThreadLocal 传递当前应用 ID（ia_app.id，即各业务表 app_id）。
 *
 * <p>P1-T1 引入的双层上下文之外层（02-技术方案 §4.2）：来源为 embed token 的
 * appKey → ia_app.id 映射，由 embed 认证过滤器写入；单应用部署缺省为 1
 * （行级拦截器在上下文缺失时按 1 回填，见 AppTenantLineInnerInterceptor），
 * 为 P2 多应用共享部署预留。
 *
 * <p>跨线程语义与 {@link com.inneragent.platform.tenant.TenantContext} 一致：
 * Reactor 调度器提交任务时捕获、工作线程恢复（AgentRuntimeSchedulers）。
 */
public final class AppContext {

    private static final long DEFAULT_APP_ID = 1L;

    private static final ThreadLocal<Long> APP_ID = new ThreadLocal<>();

    private AppContext() {
    }

    public static void setAppId(Long appId) {
        APP_ID.set(appId);
    }

    /**
     * 当前应用 ID；未设置时返回 null（由行级拦截器按缺省应用处理）。
     */
    public static Long getAppId() {
        return APP_ID.get();
    }

    /**
     * 当前应用 ID；未设置时返回单应用部署缺省值 1。
     */
    public static long currentOrDefault() {
        Long appId = APP_ID.get();
        return appId != null && appId > 0 ? appId : DEFAULT_APP_ID;
    }

    public static void clear() {
        APP_ID.remove();
    }

    public static void runInApp(Long appId, Runnable action) {
        runInApp(appId, () -> {
            action.run();
            return null;
        });
    }

    public static <T> T runInApp(Long appId, Supplier<T> action) {
        Long previous = APP_ID.get();
        APP_ID.set(appId);
        try {
            return action.get();
        } finally {
            if (previous != null) {
                APP_ID.set(previous);
            } else {
                APP_ID.remove();
            }
        }
    }
}
