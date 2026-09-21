package com.inneragent.platform.config;

import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.context.UserContext;
import com.inneragent.platform.tenant.TenantContext;
import com.inneragent.server.auth.EmbedTokenAuthenticationFilter;
import com.inneragent.server.auth.EmbedTokenVerifier;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * embed 请求租户上下文泄漏回归(acme-demo 真机联调 DEF,「embed 带目录构建
 * 的运行必现」500 的端到端复现路径):
 *
 * <ol>
 *   <li>embed 认证过滤器把 token 的 tenantId claim(embed 缺省 0)经
 *       {@link UserContext#set} 联动写入 {@link TenantContext};</li>
 *   <li>请求结束(servlet 线程归还线程池)时 {@link UserContext#clear()} 必须
 *       同步清掉 TenantContext——修复前只清自身,池化线程带着 tenant_id=0 复用;</li>
 *   <li>复用线程上对无 tenant_id 列且不在 {@link AppTenantLineInnerInterceptor
 *       #IGNORED_TABLES} 的表(如 ia_tool_registry)查询时,
 *       {@code TenantIdLineHandler} 会注入 tenant_id 条件 →
 *       {@code column "tenant_id" does not exist} → 500。</li>
 * </ol>
 *
 * <p>测试驻留 platform.config 包:直接断言包私有 {@code TenantIdLineHandler}
 * 的注入判定,把回归绑死在真实 500 路径上,而非仅查 ThreadLocal 状态。
 */
class EmbedTenantContextLeakRegressionTests {

    private final AppTenantLineInnerInterceptor.TenantIdLineHandler tenantHandler =
            new AppTenantLineInnerInterceptor.TenantIdLineHandler();

    @AfterEach
    void tearDown() {
        UserContext.clear();
        TenantContext.clear();
        AppContext.clear();
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("端到端:embed 请求结束后,池化线程复用时 ia_tool_registry 不再被注入 tenant_id")
    void pooledThreadReuseAfterEmbedRequestGetsNoTenantInjection() throws Exception {
        // 单线程池模拟 servlet 容器线程池(core=1、keepAlive=0:任务间线程保活复用)
        ExecutorService servletPool = Executors.newFixedThreadPool(1);
        try {
            AtomicReference<String> firstThreadName = new AtomicReference<>();

            // 请求 A:embed token 无 tenantId claim → 缺省 0(真机故障原样);
            // 过滤器 finally 与生产代码同构:UserContext.clear() 是唯一清理入口
            servletPool.submit(() -> {
                firstThreadName.set(Thread.currentThread().getName());
                filterWithClaims(1L, "acme", 1001L, 0L)
                        .doFilter(request(), response(), (req, res) -> {
                            // 链路内:租户上下文在场(embed 身份生效)
                            assertThat(TenantContext.getTenantId()).isEqualTo(0L);
                            assertThat(UserContext.getUserId()).isEqualTo(1001L);
                            assertThat(AppContext.getAppId()).isEqualTo(1L);
                            // 请求线程内注入判定:ia_tool_registry 无 tenant_id 列,
                            // 此刻租户在场 → 会被注入(这是运行中请求的正常行为)
                            assertThat(tenantHandler.ignoreTable("ia_tool_registry")).isFalse();
                        });
                return null;
            }).get(10, TimeUnit.SECONDS);

            // 请求 B:同一线程复用(无认证头,直通链路)。修复前这里残留
            // tenant_id=0 → ignoreTable=false → 注入 → 缺列 500
            servletPool.submit(() -> {
                assertThat(Thread.currentThread().getName())
                        .isEqualTo(firstThreadName.get());
                assertThat(TenantContext.getTenantId()).isNull();
                assertThat(TenantContext.isIgnored()).isFalse();
                assertThat(UserContext.get()).isNull();
                assertThat(AppContext.getAppId()).isNull();
                // 核心断言:泄漏被清干净,租户条件不再注入(查询安全)
                assertThat(tenantHandler.ignoreTable("ia_tool_registry"))
                        .as("复用线程上 ia_tool_registry 必须跳过 tenant_id 注入(列不存在)")
                        .isTrue();
                return null;
            }).get(10, TimeUnit.SECONDS);
        } finally {
            servletPool.shutdownNow();
        }
    }

    @Test
    @DisplayName("异常路径:链路抛异常时过滤器 finally 仍双清(线程归还无残留)")
    void filterClearsContextsEvenWhenChainThrows() {
        EmbedTokenAuthenticationFilter filter = filterWithClaims(1L, "acme", 1001L, 0L);
        FilterChain failingChain = (req, res) -> {
            assertThat(TenantContext.getTenantId()).isEqualTo(0L);
            throw new ServletException("run pipeline blew up");
        };

        assertThatThrownBy(() -> filter.doFilter(request(), response(), failingChain))
                .isInstanceOf(ServletException.class);

        assertThat(TenantContext.getTenantId()).isNull();
        assertThat(UserContext.get()).isNull();
        assertThat(AppContext.getAppId()).isNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        assertThat(tenantHandler.ignoreTable("ia_tool_registry")).isTrue();
    }

    @Test
    @DisplayName("无 Bearer 请求不过 embed 验签,上下文保持干净(兜底链路不受影响)")
    void requestWithoutBearerLeavesContextsPristine() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/ia/api/v1/runs");
        filterWithClaims(1L, "acme", 1001L, 0L)
                .doFilter(request, response(), (req, res) -> {
                    assertThat(TenantContext.getTenantId()).isNull();
                    assertThat(UserContext.get()).isNull();
                });

        assertThat(TenantContext.getTenantId()).isNull();
        assertThat(tenantHandler.ignoreTable("ia_tool_registry")).isTrue();
    }

    @Test
    @DisplayName("租户在场时注入判定语义不变(防止测试恒真:有租户必注入)")
    void handlerStillInjectsWhenTenantPresent() {
        TenantContext.setTenantId(7L);
        assertThat(tenantHandler.ignoreTable("ia_tool_registry")).isFalse();
        assertThat(tenantHandler.getTenantIdColumn()).isEqualTo("tenant_id");
        // 忽略清单语义不变:清单内表永不注入 tenant_id
        assertThat(tenantHandler.ignoreTable("ia_agent_definition")).isTrue();
    }

    private static EmbedTokenAuthenticationFilter filterWithClaims(
            long appId, String appKey, long userId, long tenantId) {
        // 验签细节不参与本回归(claim→上下文→清理链路才是被测对象),桩化返回固定身份
        return new EmbedTokenAuthenticationFilter(new EmbedTokenVerifier(null) {
            @Override
            public EmbedTokenClaims verify(String token) {
                return new EmbedTokenClaims(appId, appKey, userId, tenantId);
            }
        });
    }

    private static MockHttpServletRequest request() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/ia/api/v1/runs");
        request.addHeader("Authorization", "Bearer stub-token");
        return request;
    }

    private static MockHttpServletResponse response() {
        return new MockHttpServletResponse();
    }
}
