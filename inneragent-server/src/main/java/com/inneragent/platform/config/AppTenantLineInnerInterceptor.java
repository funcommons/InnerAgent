package com.inneragent.platform.config;

import com.baomidou.mybatisplus.extension.plugins.handler.TenantLineHandler;
import com.baomidou.mybatisplus.extension.plugins.inner.InnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.TenantLineInnerInterceptor;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.tenant.TenantContext;
import net.sf.jsqlparser.expression.LongValue;
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.executor.statement.StatementHandler;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.session.ResultHandler;
import org.apache.ibatis.session.RowBounds;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * app_id + tenant_id 双列行级拦截器（P1-T1，02-技术方案 §4.2/§5.2）。
 *
 * <p>MyBatis-Plus 的 {@link TenantLineInnerInterceptor} 只支持单列，本类以
 * <strong>组合两个实例</strong>的方式实现双列：一个注入 tenant_id（取
 * {@link TenantContext}），一个注入 app_id（取 {@link AppContext}），
 * 各持独立 Handler 以免共享忽略表集合。装配必须先于分页拦截器注册
 * （见 MybatisPlusConfig，与融光 TenantLineInnerInterceptor 顺序语义一致）。
 *
 * <p>列取值策略：
 * <ul>
 *   <li>tenant_id：取 {@link TenantContext}；未设置（null）或系统模式
 *       （{@link TenantContext#isIgnored()}，与融光 FusionTenantLineHandler 行为对齐）
 *       时跳过注入，不加租户条件（INSERT 落 DDL 默认 0）；</li>
 *   <li>app_id：取 {@link AppContext}，缺省按单应用默认 1 注入，
 *       单应用部署不弱化（ADR-10，P2 多应用预留）。</li>
 * </ul>
 * 两列均不注入的忽略表（无双列/平台级单例）见 {@link #IGNORED_TABLES}。
 */
public class AppTenantLineInnerInterceptor implements InnerInterceptor {

    /**
     * 无双列/平台级表：不做 app_id/tenant_id 注入（开发计划 P1-T1 硬性清单）。
     *
     * <p>[adapt] P1-T2a：ia_tool_registry / ia_tool_grant 为业务表且携带 app_id，
     * 按约定移出忽略清单（仅系统表忽略），由 app_id Handler 注入与过滤；
     * ia_tool_grant 的 tenant_id 仍按缺省策略（无租户上下文时不注入，落 DDL 默认 0）。
     *
     * <p>[adapt] P2-admin 18a：ia_admin_account / ia_admin_login_log 为管理面
     * 平台级表（管理员跨应用，按 username 全局定位，与 AppContext 无关），
     * 列按迁移规范保留（DEFAULT 1/0）但不参与行级注入。
     *
     * <p>[adapt] 任务 #18b（W5）：ia_webhook_delivery 为平台级投递队列——
     * 投递调度器以系统身份跨应用扫描（行已显式携带 app_id，回调配置按行取），
     * 不参与行级注入/过滤；管理端检索走显式 appId 条件。
     */
    public static final Set<String> IGNORED_TABLES = Set.of(
            "ia_app",
            "ia_admin_account",
            "ia_admin_login_log",
            "ia_agent_definition",
            "ia_model_api_config",
            "ia_ai_model",
            "ia_agent_state",
            "ia_agent_state_cleanup_policy",
            "ia_agent_workspace_config",
            "ia_webhook_delivery",
            "flyway_schema_history");

    private final List<TenantLineInnerInterceptor> delegates = List.of(
            new TenantLineInnerInterceptor(new TenantIdLineHandler()),
            new TenantLineInnerInterceptor(new AppIdLineHandler()));

    @Override
    public void beforeQuery(Executor executor, MappedStatement ms, Object parameter,
                            RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql)
            throws SQLException {
        for (TenantLineInnerInterceptor delegate : delegates) {
            delegate.beforeQuery(executor, ms, parameter, rowBounds, resultHandler, boundSql);
        }
    }

    @Override
    public void beforePrepare(StatementHandler sh, Connection connection,
                              Integer transactionTimeout) {
        for (TenantLineInnerInterceptor delegate : delegates) {
            delegate.beforePrepare(sh, connection, transactionTimeout);
        }
    }

    /**
     * tenant_id 列 Handler：租户未设置/系统模式时整体跳过。
     */
    static final class TenantIdLineHandler implements TenantLineHandler {

        @Override
        public net.sf.jsqlparser.expression.Expression getTenantId() {
            return new LongValue(TenantContext.getTenantId());
        }

        @Override
        public String getTenantIdColumn() {
            return "tenant_id";
        }

        @Override
        public boolean ignoreTable(String tableName) {
            if (IGNORED_TABLES.contains(normalize(tableName))) {
                return true;
            }
            // 与融光 FusionTenantLineHandler 对齐：系统模式(isIgnored)或无租户上下文
            // 直接放行，不加租户条件；运行期落库的归属由会话/运行行显式携带
            return TenantContext.getTenantId() == null || TenantContext.isIgnored();
        }
    }

    /**
     * app_id 列 Handler：缺省按单应用默认 1，始终注入（防误配弱化隔离）。
     */
    static final class AppIdLineHandler implements TenantLineHandler {

        @Override
        public net.sf.jsqlparser.expression.Expression getTenantId() {
            return new LongValue(AppContext.currentOrDefault());
        }

        @Override
        public String getTenantIdColumn() {
            return "app_id";
        }

        @Override
        public boolean ignoreTable(String tableName) {
            return IGNORED_TABLES.contains(normalize(tableName));
        }
    }

    private static String normalize(String tableName) {
        return tableName == null ? "" : tableName.trim().toLowerCase(Locale.ROOT);
    }
}
