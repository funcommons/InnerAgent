package com.inneragent.agent.mcp;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.inneragent.platform.toolhub.ToolAnnotations;
import com.inneragent.platform.toolhub.ToolCatalogInvalidator;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.ToolGrantService;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * MCP 工具目录(02-技术方案 §4.3:内核工具清单来源)。
 *
 * <p>按 AppContext 聚合可用工具(注册表 enabled 项 + 用户授权状态标注),
 * caffeine 缓存(appId → 目录快照),注册表任何变更经
 * {@link ToolCatalogInvalidator} 失效(注册/分诊/启停/删除均已挂)。
 *
 * <p>与 AgentScopeMcpRegistry(静态配置驱动、持有真实 MCP 客户端)分层:
 * 本目录是 ia_tool_registry 的只读聚合视图,供白名单/授权/协议判定使用;
 * T2b 宿主桥接入后目录条目经 McpToolInvoker 执行。
 */
@Component
public class McpToolCatalog implements ToolCatalogInvalidator {

    /** resolve_scope 协议工具名(02-技术方案 §4.3;宿主 MCP 可实现)。 */
    public static final String RESOLVE_SCOPE_TOOL = "resolve_scope";

    private final ToolRegistryMapper registryMapper;
    private final ToolGrantService grantService;
    private final ObjectMapper objectMapper;
    /**
     * [P1-T2b] 宿主桥客户端缓存失效委托(可选:McpClientToolInvoker Bean 未装配
     * 时静默跳过)。注册表任何变更在失效目录快照的同时,关闭并清除对应应用的
     * 懒连接 MCP 客户端(endpoint_url/serverKey 变更后下次调用按新端点重建)。
     */
    private final ObjectProvider<McpClientToolInvoker> clientInvokers;

    /** appId → 全量目录(enabled 项;granted 标注不缓存,查询时叠加)。 */
    private final Cache<Long, List<McpToolCatalogEntry>> catalogCache;

    public McpToolCatalog(ToolRegistryMapper registryMapper,
                          ToolGrantService grantService,
                          ObjectMapper objectMapper) {
        this(registryMapper, grantService, objectMapper, null);
    }

    /** Spring 装配入口(多构造器时必须显式标注,否则回退无参构造器——该类没有)。 */
    @Autowired
    public McpToolCatalog(ToolRegistryMapper registryMapper,
                          ToolGrantService grantService,
                          ObjectMapper objectMapper,
                          ObjectProvider<McpClientToolInvoker> clientInvokers) {
        this.registryMapper = Objects.requireNonNull(registryMapper, "registryMapper must not be null");
        this.grantService = Objects.requireNonNull(grantService, "grantService must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.clientInvokers = clientInvokers;
        this.catalogCache = Caffeine.newBuilder()
                .expireAfterWrite(Duration.ofMinutes(10))
                .maximumSize(64)
                .build();
    }

    /**
     * 应用全量目录(enabled 注册项;每条带注解派生位,granted=false)。
     */
    public List<McpToolCatalogEntry> catalog(long appId) {
        return Objects.requireNonNull(catalogCache.get(appId, this::load), "catalog entry");
    }

    /**
     * 用户视角目录:在全量目录上叠加 permanent 授权 granted 标注
     * (授权过滤:未持有授权的写工具在 DEFAULT 模式需确认)。
     */
    public List<McpToolCatalogEntry> catalogForUser(long appId, Long userId) {
        List<McpToolCatalogEntry> base = catalog(appId);
        if (userId == null) {
            return base;
        }
        Set<String> grantedFqns = grantService.activePermanentFqns(userId);
        return base.stream()
                .map(entry -> entry.granted()
                        ? entry
                        : new McpToolCatalogEntry(entry.id(), entry.fqn(), entry.serverKey(),
                                entry.toolName(), entry.description(), entry.parametersSchemaJson(),
                                entry.schemaSha256(), entry.riskLevel(), entry.adminPolicy(),
                                entry.resumeSafe(), entry.concurrencySafe(), entry.enabled(),
                                entry.revalidateRequired(), entry.annotationsTrusted(),
                                entry.readOnlyEffective(), entry.destructiveHint(),
                                entry.idempotentHint(), entry.openWorldHint(),
                                grantedFqns.contains(entry.fqn())))
                .toList();
    }

    /** 按 FQN 或工具名查找(resolve_scope 反查、内核白名单校验用)。 */
    public Optional<McpToolCatalogEntry> find(long appId, String fqnOrToolName) {
        String needle = fqnOrToolName == null ? "" : fqnOrToolName.trim().toLowerCase(Locale.ROOT);
        return catalog(appId).stream()
                .filter(entry -> entry.fqn().toLowerCase(Locale.ROOT).equals(needle)
                        || entry.toolName().toLowerCase(Locale.ROOT).equals(needle))
                .findFirst();
    }

    /**
     * 宿主是否实现了 resolve_scope(降级判定:PRD §6.1.4 —— 未实现时
     * 「无上下文提示 + 全量白名单工具 + 写操作一律确认」)。
     */
    public boolean resolveScopeImplemented(long appId) {
        return find(appId, RESOLVE_SCOPE_TOOL).isPresent();
    }

    @Override
    public void invalidate(long appId) {
        catalogCache.invalidate(appId);
        McpClientToolInvoker invoker = clientInvokers == null ? null : clientInvokers.getIfAvailable();
        if (invoker != null) {
            invoker.invalidateApp(appId);
        }
    }

    public void invalidateAll() {
        catalogCache.invalidateAll();
        McpClientToolInvoker invoker = clientInvokers == null ? null : clientInvokers.getIfAvailable();
        if (invoker != null) {
            invoker.invalidateAll();
        }
    }

    private List<McpToolCatalogEntry> load(long appId) {
        LambdaQueryWrapper<ToolRegistryEntry> query = new LambdaQueryWrapper<ToolRegistryEntry>()
                .eq(ToolRegistryEntry::getEnabled, true)
                .orderByAsc(ToolRegistryEntry::getFqn);
        List<ToolRegistryEntry> rows = registryMapper.selectList(query);
        return rows.stream()
                .map(entry -> McpToolCatalogEntry.of(
                        entry,
                        ToolAnnotations.parse(objectMapper, entry.getAnnotationsJson()),
                        false))
                .toList();
    }
}
