package com.inneragent.agent.mcp;

import com.inneragent.platform.common.BusinessException;

import java.net.InetAddress;
import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 三方 MCP 服务器注册的共享校验口径(V18 / P4-W13;PRD M2,03-开发计划 §7.1 W13)。
 *
 * <p>应用级({@code McpAppServerService})与用户级({@code McpUserServerService})
 * 共用同一套字段规则,仅冲突域/SSRF 策略不同:
 * <ul>
 *   <li><strong>serverKey 防遮蔽</strong>:仅字母/数字/连字符(避用下划线,与
 *       ia_tool_registry FQN 命名 {@code mcp__<serverKey>__<tool>} 同一口径);
 *       非法字符/超长拒绝注册。</li>
 *   <li><strong>鉴权策略</strong>:{@code STATIC_HEADER}(静态头名+值必填)或
 *       {@code OAUTH}——OAuth 走 CIMD/DCR + RFC 8707(02-技术方案 §6.1),
 *       P4-W13 仅落枚举位,配置即 501(流程后续批次实现)。</li>
 *   <li><strong>传输</strong>:P4-W13 仅 {@code streamable-http}。</li>
 *   <li><strong>凭据</strong>:值不进审计/日志(本类与调用方均不 toString 落值);
 *       加密存储可延后。</li>
 * </ul>
 */
final class McpThirdPartyServerSupport {

    /** 鉴权策略:静态头(P4-W13 唯一可用形态)。 */
    static final String AUTH_STATIC_HEADER = "STATIC_HEADER";

    /** 鉴权策略:OAuth(CIMD/DCR + RFC 8707;P4-W13 枚举位,配置即 501)。 */
    static final String AUTH_OAUTH = "OAUTH";

    /** 传输方式(P4-W13 仅 Streamable HTTP;SSE 待后续批次按需放开)。 */
    static final String TRANSPORT = "streamable-http";

    /** serverKey 字符集:与 ToolRegistryService 同口径(字母/数字/连字符,避用下划线)。 */
    private static final Pattern SERVER_KEY = Pattern.compile("[A-Za-z0-9-]{1,64}");

    /** 单次 tools/call 超时上限(秒;对齐 §4.7护栏量级)。 */
    static final int MAX_TIMEOUT_SECONDS = 600;

    private McpThirdPartyServerSupport() {
    }

    /** 注册/更新请求体(应用级与用户级同形)。 */
    record Upsert(
            String serverKey,
            String name,
            String endpointUrl,
            String transport,
            String authType,
            String headerName,
            String credentials,
            Integer timeoutSeconds,
            Boolean enabled) {
    }

    /** 归一化结果(服务层据此写实体)。 */
    record Normalized(
            String serverKey,
            String name,
            String endpointUrl,
            String transport,
            String authType,
            String headerName,
            String credentials,
            int timeoutSeconds,
            boolean enabled) {
    }

    /** 字段级校验 + 归一化(userFacing=true 时附加内网/本机地址拒绝——用户自接防 SSRF)。 */
    static Normalized normalize(Upsert request, boolean userFacing) {
        String serverKey = requireText(request.serverKey(), "serverKey");
        if (!SERVER_KEY.matcher(serverKey).matches()) {
            throw new BusinessException(400,
                    "serverKey 仅允许字母/数字/连字符(避用下划线,FQN 命名空间): " + serverKey);
        }
        String name = requireText(request.name(), "名称");
        if (name.length() > 128) {
            throw new BusinessException(400, "名称超长(≤128)");
        }
        String transport = request.transport() == null || request.transport().isBlank()
                ? TRANSPORT
                : request.transport().trim().toLowerCase(Locale.ROOT);
        if (!TRANSPORT.equals(transport)) {
            throw new BusinessException(400,
                    "三方 MCP 当前仅支持 streamable-http 传输: " + transport);
        }
        String authType = request.authType() == null || request.authType().isBlank()
                ? AUTH_STATIC_HEADER
                : request.authType().trim().toUpperCase(Locale.ROOT);
        String headerName;
        String credentials;
        if (AUTH_OAUTH.equals(authType)) {
            // P4-W13 仅枚举位:OAuth(CIMD/DCR + RFC 8707 resource 参数)流程由
            // P4 后续批次实现,配置阶段即报 501(Not Implemented 语义)
            throw new BusinessException(501,
                    "三方 MCP OAuth(CIMD/DCR + RFC 8707)暂未实现:当前仅支持 STATIC_HEADER 静态头鉴权");
        }
        if (!AUTH_STATIC_HEADER.equals(authType)) {
            throw new BusinessException(400,
                    "authType 仅支持 STATIC_HEADER/OAUTH: " + authType);
        }
        headerName = requireText(request.headerName(), "静态头名");
        if (headerName.length() > 128) {
            throw new BusinessException(400, "静态头名超长(≤128)");
        }
        credentials = requireText(request.credentials(), "静态头值");
        String endpointUrl = validateUrl(request.endpointUrl(), userFacing);
        int timeoutSeconds = request.timeoutSeconds() == null ? 30 : request.timeoutSeconds();
        if (timeoutSeconds < 1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
            throw new BusinessException(400,
                    "timeoutSeconds 须在 1-" + MAX_TIMEOUT_SECONDS + " 之间: " + timeoutSeconds);
        }
        return new Normalized(serverKey, name, endpointUrl, transport, authType,
                headerName, credentials, timeoutSeconds,
                request.enabled() == null || request.enabled());
    }

    private static String validateUrl(String value, boolean userFacing) {
        String url = requireText(value, "endpoint URL");
        try {
            URI uri = URI.create(url);
            if (!("http".equalsIgnoreCase(uri.getScheme())
                    || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null) {
                throw new BusinessException(400, "endpoint URL 必须是有效的 HTTP(S) URL");
            }
            if (uri.getUserInfo() != null) {
                throw new BusinessException(400, "endpoint URL 不能包含 URL 用户凭据");
            }
            if (userFacing) {
                // 用户自接防 SSRF(与 AgentMcpServerService 同口径):拒绝本机/
                // 内网/链路本地/组播地址;应用级为管理面可信配置,不设此限
                // (对齐宿主桥 AdminToolController 注册不过滤内网的先例)
                for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
                    if (address.isAnyLocalAddress()
                            || address.isLoopbackAddress()
                            || address.isLinkLocalAddress()
                            || address.isSiteLocalAddress()
                            || address.isMulticastAddress()) {
                        throw new BusinessException(400, "endpoint URL 不能指向本机或内网地址");
                    }
                }
            }
            return uri.normalize().toString();
        } catch (BusinessException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new BusinessException(400, "无法解析 endpoint URL: " + failure.getMessage());
        }
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new BusinessException(400, field + "不能为空");
        }
        return value.trim();
    }
}
