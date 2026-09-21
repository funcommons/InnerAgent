package com.inneragent.agent.mcp;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.inneragent.agent.entity.McpServerConfig;
import com.inneragent.agent.entity.McpUserServer;
import com.inneragent.agent.mapper.McpServerConfigMapper;
import com.inneragent.agent.mapper.McpUserServerMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.tenant.TenantContext;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpSchema;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 三方 MCP 每 server 工具清单 LRU 缓存(P4-W13;PRD M2,需求 #3)。
 *
 * <p>键 = 服务器坐标(应用级 {@code app|appId|serverKey} / 用户级
 * {@code user|appId|userId|serverKey}),值 = tools/list 快照。Caffeine LRU:
 * TTL 可配({@code inneragent.mcp.third-party-tool-list-ttl},缺省 5min),
 * 容量 LRU 上限;任何服务器配置变更(注册/更新/启停/删除)经
 * {@link McpThirdPartyConfigInvalidator} 全量失效(懒回填)。
 *
 * <p>加载 = 现读配置行(免疫配置漂移)→ 建 Streamable HTTP 客户端(静态头
 * 经 httpRequestCustomizer 注入;<strong>不带 X-IA-Act</strong>——act token
 * 仅限宿主桥内环,02-技术方案 §6.1)→ initialize + listTools → close。
 * 服务器不可达:WARN + 跳过(返回空清单,目录不含该 server 条目,对齐
 * AgentUserMcpRuntimeRegistry「跳过不可用」先例);OAUTH 配置:501 语义
 * (注册层已拦截,此处防御性兜底)。
 */
@Component
@Slf4j
public class McpThirdPartyToolListCache implements McpThirdPartyConfigInvalidator {

    /** 单工具清单快照(目录条目派生源;schemaJson 恒为合法 JSON 对象)。 */
    public record ThirdPartyTool(
            String name,
            String description,
            String parametersSchemaJson,
            boolean readOnlyHint,
            boolean destructiveHint,
            boolean idempotentHint,
            boolean openWorldHint) {
    }

    /** 服务器坐标(应用级 userId=null;定位 + 加载用,配置行现读)。 */
    public record ServerRef(String scope, long appId, Long userId, String serverKey) {

        public static ServerRef app(long appId, String serverKey) {
            return new ServerRef("app", appId, null, serverKey);
        }

        public static ServerRef user(long appId, long userId, String serverKey) {
            return new ServerRef("user", appId, userId, serverKey);
        }

        String cacheKey() {
            return scope + "|" + appId
                    + (userId == null ? "" : "|" + userId)
                    + "|" + serverKey;
        }
    }

    private final McpServerConfigMapper appServerMapper;
    private final McpUserServerMapper userServerMapper;
    private final ObjectMapper objectMapper;
    private final McpInvokerProperties properties;

    private final Cache<String, List<ThirdPartyTool>> toolLists;

    public McpThirdPartyToolListCache(McpServerConfigMapper appServerMapper,
                                      McpUserServerMapper userServerMapper,
                                      ObjectMapper objectMapper,
                                      McpInvokerProperties properties) {
        this.appServerMapper = Objects.requireNonNull(appServerMapper, "appServerMapper");
        this.userServerMapper = Objects.requireNonNull(userServerMapper, "userServerMapper");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.properties = Objects.requireNonNull(properties, "properties");
        this.toolLists = Caffeine.newBuilder()
                .expireAfterWrite(properties.getThirdPartyToolListTtl())
                .maximumSize(properties.getThirdPartyMaxCachedServers())
                .build();
    }

    /** 应用级 server 工具清单(LRU 命中即返回;miss 现拉 tools/list)。 */
    public List<ThirdPartyTool> tools(ServerRef ref) {
        return Objects.requireNonNull(
                toolLists.get(ref.cacheKey(), key -> load(ref)), "tool list");
    }

    /** 应用内启用中的三方 server 坐标(目录聚合序:应用级先行)。 */
    public List<ServerRef> enabledAppServers(long appId) {
        return TenantContext.runAsSystem(() -> appServerMapper.selectList(
                        new LambdaQueryWrapper<McpServerConfig>()
                                .eq(McpServerConfig::getAppId, appId)
                                .eq(McpServerConfig::getEnabled, true)
                                .orderByAsc(McpServerConfig::getServerKey))
                .stream()
                .filter(row -> row.getAppId() != null && row.getAppId() == appId)
                .filter(row -> Boolean.TRUE.equals(row.getEnabled()))
                .map(row -> ServerRef.app(appId, row.getServerKey()))
                .toList());
    }

    /** 用户启用中的三方 server 坐标(行级 userId 隔离;目录聚合序:用户级殿后)。 */
    public List<ServerRef> enabledUserServers(long appId, long userId) {
        return userServerMapper.selectList(new LambdaQueryWrapper<McpUserServer>()
                        .eq(McpUserServer::getAppId, appId)
                        .eq(McpUserServer::getUserId, userId)
                        .eq(McpUserServer::getEnabled, true)
                        .orderByAsc(McpUserServer::getServerKey))
                .stream()
                .filter(row -> row.getAppId() != null && row.getAppId() == appId)
                .filter(row -> Long.valueOf(userId).equals(row.getUserId()))
                .filter(row -> Boolean.TRUE.equals(row.getEnabled()))
                .map(row -> ServerRef.user(appId, userId, row.getServerKey()))
                .toList();
    }

    /** 显式失效单 server(预留;配置变更走全量失效)。 */
    public void invalidate(ServerRef ref) {
        toolLists.invalidate(ref.cacheKey());
    }

    @Override
    public void invalidateThirdPartyConfigs() {
        toolLists.invalidateAll();
    }

    // ------------------------------------------------------------------
    // 加载
    // ------------------------------------------------------------------

    /** 加载器(protected:测试子类可桩;生产实现见上)。 */
    protected List<ThirdPartyTool> load(ServerRef ref) {
        Endpoint endpoint = "app".equals(ref.scope())
                ? appEndpoint(ref)
                : userEndpoint(ref);
        if (endpoint == null) {
            // 配置行已删除/停用:目录不含该 server 条目
            return List.of();
        }
        if (McpThirdPartyServerSupport.AUTH_OAUTH.equals(endpoint.authType())) {
            throw new BusinessException(501,
                    "三方 MCP OAuth(CIMD/DCR + RFC 8707)暂未实现: serverKey=" + ref.serverKey());
        }
        McpSyncClient client = null;
        try {
            client = createClient(ref, endpoint);
            // McpSyncClient 为阻塞壳:initialize() 成功后 listTools() 直接返回
            client.initialize();
            List<McpSchema.Tool> tools = client.listTools().tools();
            if (tools == null) {
                log.warn("三方 MCP 未返回工具清单(跳过): serverKey={}, endpoint={}",
                        ref.serverKey(), endpoint.endpointUrl());
                return List.of();
            }
            List<ThirdPartyTool> mapped = tools.stream()
                    .filter(tool -> tool.name() != null && !tool.name().isBlank())
                    .map(this::toTool)
                    .toList();
            log.info("三方 MCP 工具清单已加载: serverKey={}, tools={}(凭据不落日志)",
                    ref.serverKey(), mapped.size());
            return List.copyOf(mapped);
        } catch (BusinessException rethrow) {
            throw rethrow;
        } catch (Exception failure) {
            // 不可达即跳过(WARN):目录不含该 server,运行期注册表/白名单不受影响
            log.warn("三方 MCP 工具清单拉取失败(跳过该 server): serverKey={}, endpoint={}, cause={}",
                    ref.serverKey(), endpoint == null ? "?" : endpoint.endpointUrl(),
                    String.valueOf(failure.getMessage()));
            return List.of();
        } finally {
            closeQuietly(client, ref.serverKey());
        }
    }

    private ThirdPartyTool toTool(McpSchema.Tool tool) {
        String schemaJson;
        try {
            schemaJson = tool.inputSchema() == null
                    ? "{\"type\":\"object\"}"
                    : objectMapper.writeValueAsString(tool.inputSchema());
        } catch (Exception serializationFailure) {
            schemaJson = "{\"type\":\"object\"}";
        }
        McpSchema.ToolAnnotations annotations = tool.annotations();
        return new ThirdPartyTool(
                tool.name(),
                tool.description() == null ? "" : tool.description(),
                schemaJson,
                annotations != null && Boolean.TRUE.equals(annotations.readOnlyHint()),
                annotations != null && Boolean.TRUE.equals(annotations.destructiveHint()),
                annotations != null && Boolean.TRUE.equals(annotations.idempotentHint()),
                annotations != null && Boolean.TRUE.equals(annotations.openWorldHint()));
    }

    private Endpoint appEndpoint(ServerRef ref) {
        return TenantContext.runAsSystem(() -> appServerMapper.selectList(
                        new LambdaQueryWrapper<McpServerConfig>()
                                .eq(McpServerConfig::getAppId, ref.appId())
                                .eq(McpServerConfig::getServerKey, ref.serverKey())
                                .eq(McpServerConfig::getEnabled, true))
                .stream()
                .filter(row -> row.getAppId() != null && row.getAppId() == ref.appId())
                .filter(row -> Boolean.TRUE.equals(row.getEnabled()))
                .findFirst()
                .map(Endpoint::of)
                .orElse(null));
    }

    private Endpoint userEndpoint(ServerRef ref) {
        return userServerMapper.selectList(new LambdaQueryWrapper<McpUserServer>()
                        .eq(McpUserServer::getAppId, ref.appId())
                        .eq(McpUserServer::getUserId, ref.userId())
                        .eq(McpUserServer::getServerKey, ref.serverKey())
                        .eq(McpUserServer::getEnabled, true))
                .stream()
                .filter(row -> row.getAppId() != null && row.getAppId() == ref.appId())
                .filter(row -> ref.userId() != null
                        && Long.valueOf(ref.userId()).equals(row.getUserId()))
                .filter(row -> Boolean.TRUE.equals(row.getEnabled()))
                .findFirst()
                .map(Endpoint::of)
                .orElse(null);
    }

    // ------------------------------------------------------------------
    // 客户端(静态头;无 act token)
    // ------------------------------------------------------------------

    private McpSyncClient createClient(ServerRef ref, Endpoint endpoint) {
        URI uri = URI.create(endpoint.endpointUrl());
        String base = uri.getScheme() + "://" + uri.getRawAuthority();
        String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        Map<String, String> staticHeaders = endpoint.staticHeaders();
        HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport.builder(base)
                .endpoint(path)
                .resumableStreams(false)
                .openConnectionOnStartup(false)
                // 静态头逐请求注入(httpRequestCustomizer 捕获常量映射;
                // 值不落日志——只在此处进请求头)
                .httpRequestCustomizer((builder, method, requestUri, body, context) ->
                        staticHeaders.forEach(builder::header))
                .build();
        McpSyncClient client = McpClient.sync(transport)
                .requestTimeout(endpoint.timeout())
                .build();
        try {
            client.initialize();
        } catch (Exception initializeFailure) {
            try {
                client.close();
            } catch (RuntimeException ignored) {
                // 首次初始化失败为主因
            }
            throw initializeFailure;
        }
        log.info("三方 MCP 客户端已建立(tools/list): serverKey={}, endpoint={}(凭据不落日志)",
                ref.serverKey(), endpoint.endpointUrl());
        return client;
    }

    private static void closeQuietly(McpSyncClient client, String serverKey) {
        if (client == null) {
            return;
        }
        try {
            client.close();
        } catch (RuntimeException closeFailure) {
            log.debug("三方 MCP 客户端关闭失败(忽略): serverKey={}, cause={}",
                    serverKey, String.valueOf(closeFailure.getMessage()));
        }
    }

    /** 配置行归一(endpoint/静态头/超时;静态头仅在内存,不落日志)。 */
    private record Endpoint(
            String endpointUrl,
            String authType,
            String headerName,
            String credentials,
            Duration timeout) {

        static Endpoint of(McpServerConfig row) {
            return new Endpoint(
                    row.getEndpointUrl(),
                    row.getAuthType(),
                    row.getHeaderName(),
                    row.getCredentials(),
                    Duration.ofSeconds(row.getTimeoutSeconds() == null ? 30 : row.getTimeoutSeconds()));
        }

        static Endpoint of(McpUserServer row) {
            return new Endpoint(
                    row.getEndpointUrl(),
                    row.getAuthType(),
                    row.getHeaderName(),
                    row.getCredentials(),
                    Duration.ofSeconds(row.getTimeoutSeconds() == null ? 30 : row.getTimeoutSeconds()));
        }

        Map<String, String> staticHeaders() {
            if (headerName == null || headerName.isBlank()
                    || credentials == null || credentials.isBlank()) {
                return Map.of();
            }
            return Map.of(headerName, credentials);
        }
    }
}
