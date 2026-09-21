package com.inneragent.platform.config.ai;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * AI Agent 定义（代码内配置）
 * <p>
 * 替代数据库中的 ia_ai_agent 表，在代码中直接定义 Agent 配置，
 * 版本更新时可以直接更新提示词。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiAgentDefinition {

    /** Agent 类型唯一标识 */
    private String type;

    /** Agent 显示名称 */
    private String name;

    /** 系统提示词 */
    private String systemPrompt;

    /** 指令模板 */
    private String instructionTemplate;

    /**
     * 上下文注入模板(JSON 文本;P4 数据驱动内核从 ia_agent_definition
     * context_template_json 透传,代码注册表恒 null)。
     * <p>
     * 形态:JSON 对象 {名称: 模板文本} 逐项渲染为 {@code <context name="...">}
     * 区块,或 JSON 文本串整体渲染;组装点见
     * {@code AgentDefinitionPrompts.appendContextTemplate}(根/子提示词装配
     * 统一消费)。
     */
    private String contextTemplateJson;

    /**
     * 默认用户消息模板（Pipeline 场景下，前端不传 message 时使用）
     * <p>
     * 支持 {projectId}、{scriptId}、{episodeId}、{storyboardId} 等模板变量。
     */
    private String defaultUserMessage;

    /** 是否启用工具（0=不启用，1=启用） */
    @Builder.Default
    private Integer enableTools = 0;

    /** 该 Agent 可用的 callback 工具名列表（白名单），为 null 表示所有已注册工具 */
    private List<String> toolNames;

    /** Agent 类型的子工具定义列表（子 Agent 工具） */
    private List<SubAgentToolDef> subAgentTools;

    /**
     * 子 Agent 工具定义
     * <p>
     * 当父 Agent 的工具列表中含有 type=agent 的工具时，
     * 会根据此定义创建独立的 HarnessAgent 平台子运行并封装为 ToolBase。
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SubAgentToolDef {
        /** 工具标识名 */
        private String toolName;
        /** 工具显示名称 */
        private String displayName;
        /** 工具描述（告诉父 Agent 何时使用此子 Agent） */
        private String description;
        /** 入参 JSON Schema */
        private String parametersSchema;
        /** 关联的子 Agent 类型标识（从 AiAgentRegistry 中查找） */
        private String refAgentType;
        /** 输出 JSON Schema（约束子 Agent 的输出格式） */
        private String outputSchema;
        /** 覆盖子 Agent 的 systemPrompt（优先于子 Agent 自身的配置） */
        private String systemPromptOverride;
        /** 覆盖子 Agent 的 instruction（优先于子 Agent 自身的配置） */
        private String instructionOverride;
    }
}
