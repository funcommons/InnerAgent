package com.inneragent.agent.mcp;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.server.auth.act.ActTokenIssuer;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 工具体检探活通道(V16,工具体检 v1;[new])。
 *
 * <p>对注册工具的 {@code endpoint_url} 做一次轻量 MCP 握手探活:复用
 * {@link McpClientToolInvoker} 的客户端基建形态(同款 Streamable HTTP 传输 +
 * X-IA-Act 挂点 + 无状态形态,respike T02/T03/FINDINGS §2.5),但不走调用端
 * 客户端缓存——体检是管理面低频操作,每次现建现关客户端,不占用调用端
 * 缓存位、不与 {@code invalidateApp} 编排互相干扰:
 * <ol>
 *   <li>{@code initialize} 握手(携带探活 act token:audience = endpoint_url,
 *       userId/tenantId = 0 系统探活身份);</li>
 *   <li>{@code listTools} 拉取宿主清单(跟随 nextCursor 翻页,封顶
 *       {@value #MAX_LIST_PAGES} 页),归一为宿主工具记录(名称 + inputSchema
 *       序列化 JSON + 注解序列化 JSON,NON_NULL 往返保真)。</li>
 * </ol>
 * 任一步失败(连接拒绝/超时/鉴权/传输)按 {@link ProbeOutcome#unreachable}
 * 返回并携带聚合错误消息;成功返回宿主清单。指纹与注解的比对语义在
 * {@code ToolHealthService}(对比基准是 ia_tool_registry 注册快照)。
 */
@Component
@Slf4j
public class McpToolHealthChecker {

    /** 宿主清单翻页上限(listTools nextCursor;超过按截断处理并在明细标注)。 */
    static final int MAX_LIST_PAGES = 10;

    /** 与调用端同款:act token 经调用线程 ThreadLocal 进传输上下文(spike T03)。 */
    private static final ThreadLocal<String> PROBE_ACT_TOKEN = new ThreadLocal<>();

    private final ActTokenIssuer actTokenIssuer;
    private final ObjectMapper objectMapper;

    public McpToolHealthChecker(ActTokenIssuer actTokenIssuer, ObjectMapper objectMapper) {
        this.actTokenIssuer = Objects.requireNonNull(actTokenIssuer, "actTokenIssuer must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    /**
     * 探活一个注册工具的宿主端点(initialize + listTools)。
     *
     * @param appId        所属应用(错误消息定位用;探活连接本身按 endpoint_url 直连)
     * @param entry        注册行(endpoint_url 为探活目标)
     * @param probeTimeout 握手与清单拉取超时
     */
    public ProbeOutcome probe(long appId, ToolRegistryEntry entry, Duration probeTimeout) {
        Objects.requireNonNull(entry, "entry must not be null");
        String endpointUrl = entry.getEndpointUrl();
        if (endpointUrl == null || endpointUrl.isBlank()) {
            return ProbeOutcome.unreachable(
                    "endpoint_url 未配置(host_app 工具须携带宿主桥地址),无法探活");
        }
        String target = endpointUrl.trim();
        // 探活 act token:系统探活身份(userId/tenantId=0),audience 绑定端点
        // (宿主桥验签 Filter 与调用链同一套强校验,spike T03 形态)
        PROBE_ACT_TOKEN.set(actTokenIssuer.issue(new ActTokenIssuer.ActTokenRequest(
                0L, 0L, null, null, entry.getFqn(), target)));
        McpSyncClient client = null;
        try {
            client = buildClient(target, probeTimeout);
            List<McpSchema.Tool> tools = listAllTools(client, target);
            return ProbeOutcome.reachable(tools.stream().map(this::hostToolOf).toList());
        } catch (Exception probeFailure) {
            String reason = aggregateMessages(probeFailure);
            log.info("工具体检探活失败: appId={}, fqn={}, endpoint={}, cause={}",
                    appId, entry.getFqn(), target, reason);
            return ProbeOutcome.unreachable(reason);
        } finally {
            PROBE_ACT_TOKEN.remove();
            if (client != null) {
                try {
                    client.close();
                } catch (RuntimeException closeFailure) {
                    log.debug("体检探活客户端关闭失败(忽略): {}", String.valueOf(closeFailure.getMessage()));
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // 客户端构建 / 清单拉取
    // ------------------------------------------------------------------

    /**
     * 与 {@link McpClientToolInvoker#createClient} 同形态的探活客户端:
     * Streamable HTTP + 无状态(resumableStreams=false / 不启动即连)+
     * X-IA-Act 头注入;体检不走重连编排,失败即 unreachable 结论。
     */
    private McpSyncClient buildClient(String endpointUrl, Duration probeTimeout) {
        URI uri = URI.create(endpointUrl);
        String base = uri.getScheme() + "://" + uri.getRawAuthority();
        String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport.builder(base)
                .endpoint(path)
                .resumableStreams(false)
                .openConnectionOnStartup(false)
                .httpRequestCustomizer(this::applyActHeader)
                .build();
        McpSyncClient client = McpClient.sync(transport)
                .requestTimeout(probeTimeout)
                .transportContextProvider(() -> McpTransportContext.create(
                        Map.of(McpClientToolInvoker.CTX_ACT_TOKEN,
                                PROBE_ACT_TOKEN.get() == null ? "" : PROBE_ACT_TOKEN.get())))
                .build();
        // initialize 失败按原样上抛(buildClient 失败 = unreachable 主因)
        client.initialize();
        return client;
    }

    private void applyActHeader(java.net.http.HttpRequest.Builder builder, String method, URI uri,
                                String body, McpTransportContext context) {
        if (context == null) {
            return;
        }
        Object token = context.get(McpClientToolInvoker.CTX_ACT_TOKEN);
        if (token instanceof String value && !value.isEmpty()) {
            builder.header(McpClientToolInvoker.ACT_HEADER, value);
        }
    }

    /** listTools 全量拉取(跟随 nextCursor;封顶 {@value #MAX_LIST_PAGES} 页)。 */
    private List<McpSchema.Tool> listAllTools(McpSyncClient client, String target) {
        List<McpSchema.Tool> tools = new ArrayList<>();
        String cursor = null;
        for (int page = 0; page < MAX_LIST_PAGES; page++) {
            // 0.17.0 客户端:listTools(String cursor),首页传 null
            McpSchema.ListToolsResult result = client.listTools(cursor);
            if (result.tools() != null) {
                tools.addAll(result.tools());
            }
            cursor = result.nextCursor();
            if (cursor == null || cursor.isBlank()) {
                return tools;
            }
        }
        log.warn("工具体检宿主清单超过 {} 页,按截断处理: endpoint={}", MAX_LIST_PAGES, target);
        return tools;
    }

    // ------------------------------------------------------------------
    // 宿主工具归一(schema/注解 NON_NULL 序列化往返)
    // ------------------------------------------------------------------

    /**
     * 宿主工具记录:inputSchema / annotations 以 NON_NULL 序列化往返为 JSON
     * (record 反序列化只保留六/六个已知字段——未知顶层键在往返中丢失,
     * 属体检 v1 已知限制:该形态差异会表现为指纹漂移,宁误报不漏报)。
     */
    private HostTool hostToolOf(McpSchema.Tool tool) {
        String schemaJson = writeJsonNon(tool.inputSchema());
        String annotationsJson = writeJsonNon(tool.annotations());
        return new HostTool(tool.name(), schemaJson, annotationsJson);
    }

    /** NON_NULL 序列化(往返保真:宿主未上报的字段不补 null 键)。 */
    private String writeJsonNon(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.copy()
                    .setSerializationInclusion(JsonInclude.Include.NON_NULL)
                    .writeValueAsString(value);
        } catch (Exception serializationFailure) {
            throw new IllegalStateException("宿主工具清单序列化失败: "
                    + serializationFailure.getMessage(), serializationFailure);
        }
    }

    // ------------------------------------------------------------------
    // 结果形状
    // ------------------------------------------------------------------

    /** 单工具探活结果:可达(带宿主清单)或不可达(带聚合原因)。 */
    public record ProbeOutcome(boolean reachable, List<HostTool> tools, String failureReason) {

        public static ProbeOutcome reachable(List<HostTool> tools) {
            return new ProbeOutcome(true, List.copyOf(tools), null);
        }

        public static ProbeOutcome unreachable(String reason) {
            return new ProbeOutcome(false, List.of(), reason);
        }
    }

    /** 宿主清单中的工具记录(name + 归一化 schema/注解 JSON)。 */
    public record HostTool(String name, String inputSchemaJson, String annotationsJson) {

        /** 宿主上报注解解析(与注册行同一解析器;缺失按空注解)。 */
        public com.inneragent.platform.toolhub.ToolAnnotations annotations(ObjectMapper mapper) {
            return com.inneragent.platform.toolhub.ToolAnnotations.parse(mapper, annotationsJson());
        }
    }

    /** 沿 cause 链聚合消息(SDK 薄壳异常的根因在深层,对齐调用端 R5 形态)。 */
    private static String aggregateMessages(Throwable failure) {
        StringBuilder aggregated = new StringBuilder(
                failure.getMessage() == null ? failure.getClass().getName() : failure.getMessage());
        Throwable current = failure;
        int depth = 0;
        while (current.getCause() != null && current.getCause() != current && depth < 8) {
            current = current.getCause();
            String causeMessage = current.getMessage() == null
                    ? current.getClass().getName()
                    : current.getMessage();
            if (aggregated.indexOf(causeMessage) < 0) {
                aggregated.append(" | caused by ").append(causeMessage);
            }
            depth++;
        }
        return aggregated.toString();
    }
}
