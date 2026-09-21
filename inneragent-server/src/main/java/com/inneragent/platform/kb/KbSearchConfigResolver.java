package com.inneragent.platform.kb;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * tsvector 检索配置解析与降级(P4-W14;Q4「zhparser 不可得则降级」的
 * 工程答案)。缺省 'simple';配置非 simple(如 'zhparser')时启动期
 * 运行探测:
 *
 * <ol>
 *   <li>{@code pg_ts_config} 已存在同名文本检索配置 → 采信(to_tsvector/
 *       to_tsquery 的 config 实参真正解析之处);</li>
 *   <li>扩展可得(pg_available_extensions)且具备建扩展权限 → CREATE
 *       EXTENSION 后重探(Compose 镜像内置 zhparser 的零配置路径;注意
 *       扩展安装后仍需部署侧建立同名 TEXT SEARCH CONFIGURATION 方可采信);</li>
 *   <li>不可得/无权限 → <strong>自动降级 'simple' 并 WARN</strong>,不阻断
 *       启动(simple + CJK 二元切分仍可用,中文检索按字面近似)。</li>
 * </ol>
 *
 * <p>生效配置进程内常量:tsv 落列与查询同用 {@link #effectiveConfig()};
 * 变更配置后须对文档重建索引(管理接口 rebuild-index)。探测失败(库暂
 * 不可达等)按降级起步并 WARN。
 */
@Component
@Slf4j
public class KbSearchConfigResolver implements SmartInitializingSingleton {

    public static final String SIMPLE = "simple";

    /** 配置名/扩展名标识符白名单(值来自配置项,拼进 DDL 前先校验)。 */
    private static final Pattern IDENTIFIER = Pattern.compile("[a-zA-Z0-9_]+");

    private final KbProperties properties;
    private final JdbcTemplate jdbc;

    private volatile String effectiveConfig = SIMPLE;
    private volatile boolean degraded;

    public KbSearchConfigResolver(KbProperties properties, JdbcTemplate jdbc) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    @Override
    public void afterSingletonsInstantiated() {
        resolve();
    }

    /** 启动解析(也供测试显式调用)。幂等:重复调用按当前库状态重估。 */
    public synchronized void resolve() {
        String requested = properties.getSearchConfig();
        if (requested == null || requested.isBlank()) {
            this.effectiveConfig = SIMPLE;
            this.degraded = false;
            return;
        }
        String config = requested.trim();
        if (!SIMPLE.equals(config) && textSearchConfigExists(config)) {
            this.effectiveConfig = config;
            this.degraded = false;
            log.info("mini KB 检索配置生效: '{}'", config);
            return;
        }
        if (SIMPLE.equals(config)) {
            this.effectiveConfig = SIMPLE;
            this.degraded = false;
            return;
        }
        degrade(config);
    }

    /** 当前生效配置(tsv 落列与查询同源)。 */
    public String effectiveConfig() {
        return effectiveConfig;
    }

    /** 是否发生了降级(请求配置不可得)。 */
    public boolean degraded() {
        return degraded;
    }

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    private void degrade(String requested) {
        log.warn("mini KB 检索配置 '{}' 不可得(pg_ts_config 无同名文本检索配置,"
                        + "扩展安装/配置建立未成功),自动降级 '{}' 并继续(Q4 决策:"
                        + "中文检索退化为二元切分字面近似。如需 '{}' 请在镜像预装扩展、"
                        + "建立同名 TEXT SEARCH CONFIGURATION 并授权 CREATE EXTENSION)",
                requested, SIMPLE, requested);
        this.effectiveConfig = SIMPLE;
        this.degraded = true;
    }

    private boolean textSearchConfigExists(String config) {
        if (!IDENTIFIER.matcher(config).matches()) {
            log.warn("mini KB 检索配置名非法(仅允许字母/数字/下划线): {}", config);
            return false;
        }
        try {
            if (configExists(config)) {
                return true;
            }
            // 未建立:若扩展可得且有权限,就地安装后重探(重探仍不存在——
            // 例如扩展装了但未建同名配置——按不可得降级)
            jdbc.execute("CREATE EXTENSION IF NOT EXISTS " + config);
            return configExists(config);
        } catch (RuntimeException probeFailure) {
            log.warn("mini KB 检索配置探测/安装失败({}),按不可得处理: {}",
                    probeFailure.getClass().getSimpleName(), probeFailure.getMessage());
            return false;
        }
    }

    private boolean configExists(String config) {
        return !jdbc.queryForList(
                "SELECT 1 FROM pg_ts_config WHERE cfgname = ?", String.class, config)
                .isEmpty();
    }
}
