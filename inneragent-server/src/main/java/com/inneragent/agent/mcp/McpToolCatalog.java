package com.inneragent.agent.mcp;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.inneragent.platform.toolhub.ToolAnnotations;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolCatalogInvalidator;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.ToolGrantService;
import com.inneragent.platform.toolhub.ToolRiskLevel;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * MCP 工具目录(02-技术方案 §4.3:内核工具清单来源)。
 *
 * <p>聚合顺序(P4-W13,需求 #3:<strong>宿主 → 应用级三方 → 用户级三方</strong>;
 * 内置工具不在本目录,由内核 ToolExecutorRegistry 另行装配):
 * <ol>
 *   <li>宿主:ia_tool_registry enabled 项(appId 聚合,caffeine 缓存);</li>
 *   <li>应用级三方:ia_mcp_server_config enabled 项,工具清单经
 *       {@link McpThirdPartyToolListCache}(LRU,TTL 可配缺省 5min);</li>
 *   <li>用户级三方:ia_mcp_user_server enabled 项(行级 userId 隔离,
 *       catalogForUser 叠加)。</li>
 * </ol>
 * 三方工具 FQN 强制命名空间 {@code mcp__<serverKey>__<toolName>};<strong>
 * 防遮蔽</strong>:与更高优先层工具(FQN 或裸名)冲突的三方工具被丢弃并
 * WARN + 审计(denied/forced-policy,同 TTL 窗口去重)。三方条目治理位:
 * 注解不可信(annotationsTrusted=false)、readOnlyEffective=false(V15 口径:
 * 三方一律按写操作确认)。
 *
 * <p>注册表任何变更经 {@link ToolCatalogInvalidator} 失效(注册/分诊/启停/
 * 删除均已挂);三方服务器配置变更经 {@link McpThirdPartyConfigInvalidator}
 * 失效(本目录与工具清单缓存双实现,服务层 orderedStream 全量触发)。
 */
@Component
public class McpToolCatalog implements ToolCatalogInvalidator, McpThirdPartyConfigInvalidator {

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(McpToolCatalog.class);

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
    /** [P4-W13] 三方工具清单 LRU 缓存(可选:未装配时目录仅含宿主层)。 */
    private final ObjectProvider<McpThirdPartyToolListCache> thirdPartyCaches;
    /** [P4-W13] 遮蔽丢弃审计(decision=denied,source=forced-policy)。 */
    private final ToolAuditService auditService;

    /** appId → 全量目录(host + 应用级三方;granted 标注与用户级不缓存)。 */
    private final Cache<Long, List<McpToolCatalogEntry>> catalogCache;

    /** 遮蔽丢弃审计去重(同 TTL 窗口一 fqn 一条;目录聚合可能多次触发)。 */
    private final Cache<String, Boolean> auditedDrops;

    public McpToolCatalog(ToolRegistryMapper registryMapper,
                          ToolGrantService grantService,
                          ObjectMapper objectMapper) {
        this(registryMapper, grantService, objectMapper, null, null, null);
    }

    /** Spring 装配入口(多构造器时必须显式标注,否则回退无参构造器——该类没有)。 */
    @Autowired
    public McpToolCatalog(ToolRegistryMapper registryMapper,
                          ToolGrantService grantService,
                          ObjectMapper objectMapper,
                          ObjectProvider<McpClientToolInvoker> clientInvokers,
                          ObjectProvider<McpThirdPartyToolListCache> thirdPartyCaches,
                          ToolAuditService auditService) {
        this.registryMapper = Objects.requireNonNull(registryMapper, "registryMapper must not be null");
        this.grantService = Objects.requireNonNull(grantService, "grantService must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.clientInvokers = clientInvokers;
        this.thirdPartyCaches = thirdPartyCaches;
        this.auditService = auditService;
        this.catalogCache = Caffeine.newBuilder()
                .expireAfterWrite(Duration.ofMinutes(10))
                .maximumSize(64)
                .build();
        this.auditedDrops = Caffeine.newBuilder()
                .expireAfterWrite(Duration.ofMinutes(10))
                .maximumSize(1024)
                .build();
    }

    /**
     * 应用全量目录(host → 应用级三方;每条带注解派生位,granted=false)。
     */
    public List<McpToolCatalogEntry> catalog(long appId) {
        return Objects.requireNonNull(catalogCache.get(appId, this::loadCombined), "catalog entry");
    }

    /**
     * 用户视角目录:宿主 → 应用级三方 → <strong>用户级三方</strong>(行级隔离)
     * → 叠加 permanent 授权 granted 标注(授权过滤:未持有授权的写工具在
     * DEFAULT 模式需确认)。
     */
    public List<McpToolCatalogEntry> catalogForUser(long appId, Long userId) {
        if (userId == null) {
            // catalog(appId) 已是「宿主 + 应用级三方」聚合快照,直接返回
            return catalog(appId);
        }
        List<McpToolCatalogEntry> base = appendThirdParty(appId, userId, catalog(appId));
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

    /** 按 FQN 或工具名查找(resolve_scope 反查、内核白名单校验用;应用级目录)。 */
    public Optional<McpToolCatalogEntry> find(long appId, String fqnOrToolName) {
        String needle = normalize(fqnOrToolName);
        return catalog(appId).stream()
                .filter(entry -> normalize(entry.fqn()).equals(needle)
                        || normalize(entry.toolName()).equals(needle))
                .findFirst();
    }

    /** 用户视角查找(catalogForUser 同序聚合;用户级三方条目可被指名)。 */
    public Optional<McpToolCatalogEntry> findForUser(long appId, long userId, String fqnOrToolName) {
        String needle = normalize(fqnOrToolName);
        return catalogForUser(appId, userId).stream()
                .filter(entry -> normalize(entry.fqn()).equals(needle)
                        || normalize(entry.toolName()).equals(needle))
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

    /** 三方服务器配置变更:目录快照 + 已建客户端全量失效(清单缓存自身另行失效)。 */
    @Override
    public void invalidateThirdPartyConfigs() {
        invalidateAll();
    }

    // ------------------------------------------------------------------
    // 聚合
    // ------------------------------------------------------------------

    private List<McpToolCatalogEntry> loadCombined(long appId) {
        // 应用级三方随宿主层进目录快照;用户级三方仅 catalogForUser 叠加
        return appendThirdParty(appId, null, load(appId));
    }

    private List<McpToolCatalogEntry> load(long appId) {
        // [adapt] P2-srv U1 遗留修复:显式按 app_id 过滤,不再单靠
        // AppTenantLineInnerInterceptor 行级注入(SQL 条件 + 内存兜底双层),
        // 拦截器被绕过/直连 mapper 时目录也不串应用;appId 由调用方按
        // AppContext.currentOrDefault()(embed 认证写入)解析。
        List<ToolRegistryEntry> rows = registryMapper.selectList(
                new LambdaQueryWrapper<ToolRegistryEntry>()
                        .eq(ToolRegistryEntry::getAppId, appId)
                        .eq(ToolRegistryEntry::getEnabled, true)
                        .orderByAsc(ToolRegistryEntry::getFqn));
        return rows.stream()
                .filter(entry -> entry.getAppId() != null && entry.getAppId() == appId)
                // 内存兜底双层(与 app_id 同款):enabled 与 SQL 条件同口径,
                // 拦截器/SQL 被绕过时停用工具也不进目录(DEF-07 回归口径依赖)
                .filter(entry -> Boolean.TRUE.equals(entry.getEnabled()))
                .map(entry -> McpToolCatalogEntry.of(
                        entry,
                        ToolAnnotations.parse(objectMapper, entry.getAnnotationsJson()),
                        false))
                .toList();
    }

    /**
     * 三方层聚合(需求 #3):userId 为空 → 追加应用级(入目录快照);
     * userId 非空 → 仅追加该用户级(行级隔离;higher 已含应用级)。
     * 与更高优先层 FQN/裸名冲突的工具被丢弃(WARN + 审计)。
     */
    private List<McpToolCatalogEntry> appendThirdParty(
            long appId, Long userId, List<McpToolCatalogEntry> higher) {
        McpThirdPartyToolListCache cache =
                thirdPartyCaches == null ? null : thirdPartyCaches.getIfAvailable();
        if (cache == null) {
            return higher;
        }
        Set<String> occupiedFqns = new LinkedHashSet<>();
        Set<String> occupiedNames = new LinkedHashSet<>();
        for (McpToolCatalogEntry entry : higher) {
            occupiedFqns.add(normalize(entry.fqn()));
            occupiedNames.add(normalize(entry.toolName()));
        }
        List<McpThirdPartyToolListCache.ServerRef> refs = userId == null
                ? cache.enabledAppServers(appId)
                : cache.enabledUserServers(appId, userId);
        List<McpToolCatalogEntry> combined = new ArrayList<>(higher);
        for (McpThirdPartyToolListCache.ServerRef ref : refs) {
            for (McpThirdPartyToolListCache.ThirdPartyTool tool : cache.tools(ref)) {
                String fqn = ToolRegistryService.fqnOf(ref.serverKey(), tool.name());
                String dropReason;
                if (occupiedFqns.contains(normalize(fqn))) {
                    dropReason = "fqn_conflict";
                } else if (occupiedNames.contains(normalize(tool.name()))) {
                    dropReason = "name_shadow";
                } else {
                    combined.add(thirdPartyEntry(ref, tool, fqn));
                    occupiedFqns.add(normalize(fqn));
                    occupiedNames.add(normalize(tool.name()));
                    continue;
                }
                log.warn("三方工具被丢弃(防遮蔽,{}): serverKey={}, tool={}, fqn={}",
                        dropReason, ref.serverKey(), tool.name(), fqn);
                auditShadowDrop(appId, userId, fqn, ref.serverKey(), tool.name(), dropReason);
            }
        }
        return combined;
    }

    /** 三方条目治理位:注解不可信、readOnlyEffective=false(V15:三方一律写操作确认)。 */
    private McpToolCatalogEntry thirdPartyEntry(
            McpThirdPartyToolListCache.ServerRef ref,
            McpThirdPartyToolListCache.ThirdPartyTool tool,
            String fqn) {
        ToolAnnotations annotations = new ToolAnnotations(
                null, tool.readOnlyHint(), tool.destructiveHint(),
                tool.idempotentHint(), tool.openWorldHint());
        ToolRiskLevel risk = ToolRiskLevel.defaultFromAnnotations(annotations);
        return new McpToolCatalogEntry(
                null,
                fqn,
                ref.serverKey(),
                tool.name(),
                tool.description(),
                tool.parametersSchemaJson(),
                null,
                risk.code(),
                null,
                tool.idempotentHint(),
                false,
                true,
                false,
                false,
                false,
                tool.destructiveHint(),
                tool.idempotentHint(),
                tool.openWorldHint(),
                false);
    }

    /** 遮蔽丢弃审计(denied/forced-policy,现有值域;同窗口去重)。 */
    private void auditShadowDrop(
            long appId, Long userId, String fqn, String serverKey, String toolName, String reason) {
        if (auditService == null) {
            return;
        }
        if (auditedDrops.asMap().putIfAbsent(appId + "|" + fqn, Boolean.TRUE) != null) {
            return;
        }
        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId,
                null,
                userId,
                null,
                null,
                fqn,
                "denied",
                ToolDecisionSource.FORCED_POLICY.code(),
                null,
                null,
                "三方工具被丢弃(防遮蔽:" + reason + ";serverKey=" + serverKey
                        + ",tool=" + toolName + ")",
                null,
                null));
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}
