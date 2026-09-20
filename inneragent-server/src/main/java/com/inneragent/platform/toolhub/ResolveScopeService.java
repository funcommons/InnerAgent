package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.mcp.McpInvokerUnavailableException;
import com.inneragent.agent.mcp.McpToolCatalog;
import com.inneragent.agent.mcp.McpToolCatalogEntry;
import com.inneragent.agent.mcp.McpToolInvoker;
import com.inneragent.agent.mcp.McpToolInvocationResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * resolve_scope 服务端协议(P1-T2a;02-技术方案 §4.3、PRD §6.1.4)。
 *
 * <p>InnerAgent 内置标准反查工具约定:宿主应用在 MCP 中实现
 * {@code resolve_scope},返回当前上下文下的可见对象域/可写范围/禁止操作。
 * 本服务负责服务端协议的编排与降级:
 * <ol>
 *   <li>目录判定宿主是否实现 resolve_scope 工具 —— 未实现 → 降级
 *       (tool_absent):空 scope + 全量白名单 + 写操作一律确认
 *       (写确认强制经确认档位映射消费);</li>
 *   <li>宿主已实现但调用端口未接管(T2b 前)→ 降级
 *       (invoker_unavailable),同样按 PRD §6.1.4 缺省行为;</li>
 *   <li>正常路径经 {@link McpToolInvoker} 调用宿主,解析四个协议数组字段
 *       (缺字段容错为空列表);宿主工具报错(status:error)按失败回灌上层,
 *       不静默降级——「未实现」与「实现了但失败」语义不同。</li>
 * </ol>
 */
@Service
@Slf4j
public class ResolveScopeService {

    static final String DEGRADE_TOOL_ABSENT = "tool_absent";
    static final String DEGRADE_INVOKER_UNAVAILABLE = "invoker_unavailable";

    private final McpToolCatalog toolCatalog;
    private final ObjectProvider<McpToolInvoker> toolInvokers;
    private final ObjectMapper objectMapper;

    public ResolveScopeService(McpToolCatalog toolCatalog,
                               ObjectProvider<McpToolInvoker> toolInvokers,
                               ObjectMapper objectMapper) {
        this.toolCatalog = Objects.requireNonNull(toolCatalog, "toolCatalog must not be null");
        this.toolInvokers = Objects.requireNonNull(toolInvokers, "toolInvokers must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    /**
     * 反查约束范围;宿主未实现时降级(PRD §6.1.4)。
     *
     * @param appId      所属应用
     * @param toolFqn    resolve_scope 工具 FQN(缺省按工具名 resolve_scope 查目录)
     * @param request    反查入参(page/object/custom)
     * @param actContext 执行身份上下文(透传给调用端口签发 act token;可空,T2b 接管后由运行链路供给)
     */
    public ResolveScopeOutcome resolve(
            long appId, String toolFqn, ResolveScopeRequest request,
            com.inneragent.agent.context.ToolExecutionContext actContext) {
        McpToolCatalogEntry entry = toolCatalog
                .find(appId, toolFqn != null ? toolFqn : McpToolCatalog.RESOLVE_SCOPE_TOOL)
                .orElse(null);
        if (entry == null) {
            log.info("resolve_scope 降级(宿主未实现): appId={}, tool={}",
                    appId, toolFqn);
            return ResolveScopeOutcome.degraded(DEGRADE_TOOL_ABSENT);
        }
        McpToolInvoker invoker = toolInvokers.getIfAvailable();
        if (invoker == null) {
            return ResolveScopeOutcome.degraded(DEGRADE_INVOKER_UNAVAILABLE);
        }
        McpToolInvocationResult result;
        try {
            result = invoker.invoke(appId, entry.toolName(), request.toToolArgs(), actContext);
        } catch (McpInvokerUnavailableException unavailable) {
            log.info("resolve_scope 降级(调用端口未接管): appId={}", appId);
            return ResolveScopeOutcome.degraded(DEGRADE_INVOKER_UNAVAILABLE);
        }
        if (result.error()) {
            // 宿主实现了但执行失败:按失败上抛(错误回灌模型可续跑),不冒充降级
            throw new ToolHubScopeResolutionFailure(
                    "resolve_scope 宿主执行失败: " + result.payloadJson());
        }
        return parseOutcome(result.payloadJson());
    }

    /**
     * 解析宿主出参:{visibleDomains[], writableFields[], forbidden[], hints[]};
     * 缺字段/类型不符容错为空列表(宿主是协议的最终裁决方,字段宽进)。
     */
    ResolveScopeOutcome parseOutcome(String payloadJson) {
        try {
            JsonNode node = objectMapper.readTree(payloadJson);
            if (node == null || !node.isObject()) {
                return ResolveScopeOutcome.resolved(List.of(), List.of(), List.of(), List.of());
            }
            return ResolveScopeOutcome.resolved(
                    readStrings(node, "visibleDomains"),
                    readStrings(node, "writableFields"),
                    readStrings(node, "forbidden"),
                    readStrings(node, "hints"));
        } catch (Exception malformed) {
            throw new ToolHubScopeResolutionFailure(
                    "resolve_scope 出参不是合法 JSON: " + malformed.getMessage(), malformed);
        }
    }

    private List<String> readStrings(JsonNode parent, String field) {
        JsonNode array = parent.get(field);
        if (array == null || !array.isArray()) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        array.forEach(item -> {
            if (item.isTextual()) {
                values.add(item.asText());
            }
        });
        return List.copyOf(values);
    }

    /** 反查执行失败(区别于降级;调用方决定回灌或终止)。 */
    public static final class ToolHubScopeResolutionFailure extends RuntimeException {
        public ToolHubScopeResolutionFailure(String message) {
            super(message);
        }

        public ToolHubScopeResolutionFailure(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
