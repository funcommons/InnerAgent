package com.inneragent.platform.context;

import com.inneragent.platform.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用户上下文与租户上下文的双源同步语义(acme-demo 真机 DEF 回归)。
 *
 * <p>核心契约:<strong>写入与清理对双源对称</strong>——{@link UserContext#set(Long, Long)}
 * 联动 {@link TenantContext#setTenantId},{@link UserContext#clear()} 联动
 * {@link TenantContext#clear()}。修复前 clear 只移除自身 ThreadLocal,servlet
 * 线程池线程归还后残留 tenant_id(embed token 缺省 0),复用线程上对无
 * tenant_id 列的表(如 ia_tool_registry)被行级拦截器注入租户条件 → 500。
 */
class UserContextTests {

    @AfterEach
    void tearDown() {
        UserContext.clear();
        AppContext.clear();
    }

    @Test
    @DisplayName("set 同步写入 TenantContext,clear 必须同步清掉(泄漏回归)")
    void clearAlsoClearsTenantContext() {
        UserContext.set(1001L, 7L);
        assertThat(TenantContext.getTenantId()).isEqualTo(7L);

        UserContext.clear();

        assertThat(UserContext.get()).isNull();
        assertThat(UserContext.getUserId()).isNull();
        assertThat(TenantContext.getTenantId()).isNull();
        assertThat(TenantContext.isIgnored()).isFalse();
    }

    @Test
    @DisplayName("embed 缺省租户 0 同样不残留(tenant_id=0 残留为真机故障原样)")
    void embedDefaultZeroTenantDoesNotSurviveClear() {
        UserContext.set(1001L, 0L);
        assertThat(TenantContext.getTenantId()).isEqualTo(0L);

        UserContext.clear();

        assertThat(TenantContext.getTenantId()).isNull();
    }

    @Test
    @DisplayName("tenantId=null 写入不触碰 TenantContext;clear 仍双清")
    void nullTenantSetLeavesTenantContextAloneButClearSanitizes() {
        TenantContext.setTenantId(42L);
        UserContext.set(2002L, null);
        // tenantId=null:UserContext 不改写租户(演示身份语义)
        assertThat(TenantContext.getTenantId()).isEqualTo(42L);

        UserContext.clear();

        // clear 是统一清理入口:无论租户来自哪条写入路径,一并清空
        assertThat(TenantContext.getTenantId()).isNull();
    }

    @Test
    @DisplayName("空线程上 clear 幂等(过滤器 finally 对未认证请求同样安全)")
    void clearOnPristineThreadIsNoop() {
        UserContext.clear();
        assertThat(TenantContext.getTenantId()).isNull();
        assertThat(UserContext.get()).isNull();
    }

    @Test
    @DisplayName("runAs 作用域恢复不走统一清理:按快照精确还原(含嵌套)")
    void runAsRestoresSnapshotPrecisely() {
        UserContext.set(1L, 11L);
        try {
            UserContext.runAs(2L, 22L, () -> {
                assertThat(UserContext.getUserId()).isEqualTo(2L);
                assertThat(TenantContext.getTenantId()).isEqualTo(22L);
                UserContext.runAs(3L, 33L, () -> {
                    assertThat(TenantContext.getTenantId()).isEqualTo(33L);
                });
                // 内层作用域退出还原到外层快照
                assertThat(UserContext.getUserId()).isEqualTo(2L);
                assertThat(TenantContext.getTenantId()).isEqualTo(22L);
            });
            // 外层作用域退出还原到最初快照
            assertThat(UserContext.getUserId()).isEqualTo(1L);
            assertThat(TenantContext.getTenantId()).isEqualTo(11L);
        } finally {
            UserContext.clear();
        }
    }

    @Test
    @DisplayName("runAs 异常路径同样精确还原(不吞异常)")
    void runAsRestoresOnException() {
        UserContext.set(1L, 11L);
        try {
            try {
                UserContext.runAs(2L, 22L, () -> {
                    throw new IllegalStateException("boom");
                });
            } catch (IllegalStateException expected) {
                // 预期抛出
            }
            assertThat(UserContext.getUserId()).isEqualTo(1L);
            assertThat(TenantContext.getTenantId()).isEqualTo(11L);
        } finally {
            UserContext.clear();
        }
    }

    @Test
    @DisplayName("runAs(tenantId=null) 退出不误清外层租户")
    void runAsWithNullTenantKeepsOuterTenant() {
        TenantContext.setTenantId(99L);
        try {
            UserContext.runAs(5L, null, () ->
                    assertThat(TenantContext.getTenantId()).isEqualTo(99L));
            assertThat(TenantContext.getTenantId()).isEqualTo(99L);
        } finally {
            UserContext.clear();
        }
    }
}
