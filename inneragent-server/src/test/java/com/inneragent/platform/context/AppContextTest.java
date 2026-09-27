package com.inneragent.platform.context;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * [§9.6-1 守卫 2026-09-27] 行级作用域上下文语义:
 * runAsSystem(IGNORE=true)内嵌套 runInApp 不解除 IGNORE(ignoreTable 跳过
 * 注入/过滤 → INSERT 落缺省应用),runInAppScoped 必须同时设归属并解除
 * 系统模式,且两状态按进入前值还原。
 */
class AppContextTest {

    @AfterEach
    void restore() {
        AppContext.clear();
    }

    @Test
    void runInAppDoesNotClearSystemMode() {
        AppContext.runAsSystem((Runnable) () -> {
            AppContext.runInApp(34L, (Runnable) () -> {
                assertThat(AppContext.getAppId()).isEqualTo(34L);
                // 历史缺陷形态:IGNORE 仍在 → ignoreTable() 跳过注入/过滤
                assertThat(AppContext.isIgnored()).isTrue();
            });
        });
    }

    @Test
    void runInAppScopedSetsAppAndClearsIgnore() {
        AppContext.runAsSystem((Runnable) () -> {
            AppContext.runInAppScoped(34L, () -> {
                assertThat(AppContext.getAppId()).isEqualTo(34L);
                assertThat(AppContext.isIgnored()).isFalse();
                assertThat(AppContext.currentOrDefault()).isEqualTo(34L);
                return null;
            });
        });
    }

    @Test
    void runInAppScopedRestoresBothStatesAfterwards() {
        AppContext.runAsSystem((Runnable) () -> {
            AppContext.runInAppScoped(34L, () -> {
                assertThat(AppContext.isIgnored()).isFalse();
                return null;
            });
            // 外层系统模式按进入前值还原
            assertThat(AppContext.isIgnored()).isTrue();
            assertThat(AppContext.getAppId()).isNull();
        });
    }

    @Test
    void runInAppScopedWithoutOuterSystemRestoresCleanState() {
        AppContext.runInAppScoped(34L, () -> {
            assertThat(AppContext.currentOrDefault()).isEqualTo(34L);
            assertThat(AppContext.isIgnored()).isFalse();
            return null;
        });
        assertThat(AppContext.getAppId()).isNull();
        assertThat(AppContext.isIgnored()).isFalse();
    }
}
