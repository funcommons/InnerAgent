package com.inneragent.agent.observability;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * GenAI 属性键收敛层(任务 #18b;调研 §3.5.3 V27「经薄内部 span 工厂封装,
 * 防约定演进返工」)。
 *
 * <p>键值对齐 OTel GenAI 语义约定(development;Java 侧 GenAI 属性仍为
 * incubating 工件,故此处以常量声明而非依赖 incubating jar——约定演进时
 * 只改本文件);{@code inneragent.*} 为本产品补充关联键。内容属性
 * ({@code gen_ai.prompt}/{@code gen_ai.completion})默认关闭,
 * 对齐审计脱敏(PRD §8「消息内容属性默认关闭」)。
 */
public final class GenAiSemanticAttributes {

    // ---- GenAI 语义约定(operation/span 级) ----

    /** 操作名:invoke_agent / chat / execute_tool */
    public static final String OPERATION_NAME = "gen_ai.operation.name";
    /** 请求模型名(chat) */
    public static final String REQUEST_MODEL = "gen_ai.request.model";
    /** 响应结束原因(chat;PRD「token 用量/结束原因」) */
    public static final String RESPONSE_FINISH_REASON = "gen_ai.response.finish_reason";
    /** 会话 ID(真实 conversationId) */
    public static final String CONVERSATION_ID = "gen_ai.conversation.id";
    /** Agent 稳定定义 ID(PRD:用稳定定义 ID) */
    public static final String AGENT_ID = "gen_ai.agent.id";
    /** Agent 名称 */
    public static final String AGENT_NAME = "gen_ai.agent.name";
    /** Agent 形态:root / child(子 Agent) */
    public static final String AGENT_TYPE = "gen_ai.agent.type";
    /** 工具名(execute_tool) */
    public static final String TOOL_NAME = "gen_ai.tool.name";
    /** 工具调用 ID */
    public static final String TOOL_CALL_ID = "gen_ai.tool.call.id";
    /** 工具描述 */
    public static final String TOOL_DESCRIPTION = "gen_ai.tool.description";

    // ---- GenAI 用量(chat;token 数来自 ia_agent_model_call_usage 同源数据) ----

    public static final String USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens";
    public static final String USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens";
    /** 缓存命中 token(本产品补充粒度) */
    public static final String USAGE_CACHED_TOKENS = "inneragent.usage.cached_tokens";
    /** 推理 token(本产品补充粒度) */
    public static final String USAGE_REASONING_TOKENS = "inneragent.usage.reasoning_tokens";

    // ---- 内容属性(默认关;capture-content=true 时才记录,超长截断) ----

    public static final String PROMPT = "gen_ai.prompt";
    public static final String COMPLETION = "gen_ai.completion";

    // ---- InnerAgent 补充关联键 ----

    /** 运行 ID(PRD:runId 作 trace 关联 ID) */
    public static final String RUN_ID = "inneragent.run.id";
    /** 应用 ID(ia_app.id) */
    public static final String APP_ID = "inneragent.app.id";
    /** 工具风险级别(READ_ONLY/EDIT/HIGH_RISK) */
    public static final String RISK_LEVEL = "inneragent.risk.level";
    /** MCP server key(宿主 MCP client span) */
    public static final String MCP_SERVER_KEY = "inneragent.mcp.server.key";
    /** AgentState 会话 ID(内核态会话,便于与状态存储对账) */
    public static final String STATE_SESSION_ID = "inneragent.state.session.id";

    /** 操作名常量(span name 与 gen_ai.operation.name 属性共用)。 */
    public static final class Operations {
        public static final String INVOKE_AGENT = "invoke_agent";
        public static final String CHAT = "chat";
        public static final String EXECUTE_TOOL = "execute_tool";
        /** MCP client span 的 method 名(tools/call,对齐 MCP semconv)。 */
        public static final String MCP_TOOLS_CALL = "tools/call";

        private Operations() {
        }
    }

    /** 供桥接实现按需拷贝属性表。 */
    public static Map<String, Object> orderedMap() {
        return new LinkedHashMap<>();
    }

    private GenAiSemanticAttributes() {
    }

    /** 判空辅助:空/空白串不作为属性记录。 */
    public static boolean meaningful(String value) {
        return value != null && !value.isBlank();
    }
}
