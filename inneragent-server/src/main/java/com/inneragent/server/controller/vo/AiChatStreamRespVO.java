package com.inneragent.server.controller.vo;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;
import lombok.experimental.Accessors;

import java.time.Instant;
import java.util.List;

/**
 * AI 助手流式响应 VO（SSE 事件数据）
 */
@Data
@Accessors(chain = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class AiChatStreamRespVO {

    /** Durable wire schema version. */
    private Integer schemaVersion;

    /** Authoritative Agent run ID. */
    private String runId;

    /** Monotonic sequence within runId. */
    private Long sequence;

    /** 消息 ID */
    private String messageId;

    /** 会话 ID */
    private String conversationId;

    /** 输出类型：REASONING / CONTENT / TOOL_CALL_STARTED / TOOL_CALL / TOOL_FINISHED / SUB_AGENT_FINISHED / DONE / ERROR / CANCELLED */
    private String outputType;

    /** 文本内容（增量） */
    private String content;

    /** 思考内容（增量） */
    private String reasoningContent;

    /** 思考开始时间 */
    private Long reasoningStartTime;

    /** 思考耗时（毫秒，首个 CONTENT 事件携带） */
    private Long reasoningDurationMs;

    /** 工具调用信息 */
    private List<ToolCallVO> toolCalls;

    /** 工具调用 ID */
    private String toolCallId;

    /** 工具名 */
    private String toolName;

    /** 工具执行结果 */
    private String toolResult;

    /** 工具执行状态：success / error */
    private String toolStatus;

    /** 父级工具调用 ID（子 Agent 输出时用于归属映射） */
    private String parentToolCallId;

    /**
     * [adapt] P4-W14 父运行 ID(仅子运行自身事件流携带;前端父子层级渲染的
     * 服务端数据支撑,新增可选字段不破既有消费者)。
     */
    private String parentRunId;

    /**
     * [adapt] P4-W14 子运行 ID(仅镜像进父运行事件流的子事件携带,与
     * parentToolCallId/agentName 配套定位子运行)。
     */
    private String childRunId;

    /**
     * [adapt] P4-W14 mini KB 引用溯源:本次运行注入的知识库分段引用
     * (chunk id/来源标题等)。终态 DONE 事件投影时回填(来源为运行行
     * kb_citations_json;事件载荷已有 kbCitations 时透传优先)。可选字段,
     * 无命中/旧事件为 null,不破既有消费者(N-1 兼容)。
     */
    private List<KbCitationVO> kbCitations;

    /** 产生此事件的 Agent 名称 */
    private String agentName;

    /** 是否结束 */
    private Boolean finished;

    /** 错误信息 */
    private String error;

    /** Sanitized AgentScope event source. */
    private String source;

    /** AgentScope reply identity when present. */
    private String replyId;

    /** AgentScope block identity when present. */
    private String blockId;

    /** Stable raw event identity. */
    private String rawEventId;

    /** Exhaustively mapped raw event discriminator. */
    private String rawEventType;

    /** Original event creation time. */
    private Instant createdAt;

    /** Platform control discriminator, currently USER_CONFIRM_REQUIRED. */
    private String controlType;

    /** Server-persisted tool set for an actionable confirmation. */
    private List<PendingToolCallVO> pendingToolCalls;

    /** Exact user decisions for the persisted confirmation tool set. */
    private List<ToolConfirmationDecisionVO> decisions;

    /** Server-authoritative action expiry. */
    private Instant expiresAt;

    /** Machine-readable reason for a terminal cancellation. */
    private String cancellationReason;

    @Data
    @Accessors(chain = true)
    public static class ToolCallVO {
        private String id;
        private String name;
        private String arguments;
    }

    @Data
    @Accessors(chain = true)
    public static class PendingToolCallVO {
        private String toolCallId;
        private String toolName;
        private String argumentsPreview;

        /**
         * [adapt] P2-scope 任务 #15:约束范围可检视(PRD §6.1.4「InnerAgent 传递与呈现
         * scope」)。可选字段 —— 旧持久化事件没有该键,反序列化为 null,前端按降级处理。
         */
        private ScopeVO scope;
    }

    /**
     * [adapt] P2-scope 任务 #15:确认等待事件的约束范围标记。
     * <p>v1 不变式 {@code degraded == !resolved}:resolved=本次运行持有约束范围
     * 上下文(宿主实现 resolve_scope);degraded=PRD §6.1.4 降级(无上下文提示 +
     * 写操作一律确认)。summary 可选(平台未留存运行级 scope 载荷时缺省)。
     */
    @Data
    @Accessors(chain = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class ScopeVO {
        /** 本次运行是否持有约束范围上下文(安全侧缺省 false)。 */
        private boolean resolved;
        /** 是否按 PRD §6.1.4 降级(无上下文提示、写操作一律逐次确认)。 */
        private boolean degraded;
        /** 约束范围人读摘要(可选;平台当前仅降级时给出稳定原因)。 */
        private String summary;
    }

    @Data
    @Accessors(chain = true)
    public static class ToolConfirmationDecisionVO {
        private String toolCallId;
        private Boolean approved;
    }

    /**
     * [adapt] P4-W14 mini KB 引用溯源最小字段集(PRD M5「回答须可溯源,
     * 展示来源」:chunk 定位 + 文档名/章节锚点)。
     */
    @Data
    @Accessors(chain = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class KbCitationVO {
        private Long chunkId;
        private Long documentId;
        private String documentTitle;
        private String anchor;
        private Integer seq;
    }
}
