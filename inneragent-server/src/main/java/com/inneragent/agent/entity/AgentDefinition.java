package com.inneragent.agent.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * Agent 定义实体(ia_agent_definition,V1 DDL;02-技术方案 §4.6/§5.1)。
 *
 * <p>数据驱动替代代码内 {@link com.inneragent.platform.config.ai.AiAgentRegistry}
 * 的落点:kind(main/sub)、提示词(system_prompt/instruction_template/greeting)、
 * 工具白名单与子 Agent 工具等规格 JSON、上下文模板。P2-W5 起管理面
 * ({@code AdminDefinitionAdminService})读写本表:列表/详情/提示词编辑/
 * 导入导出(bundle 形状为 P3/W7 融光定义导出预留);运行内核仍读
 * AiAgentRegistry(数据驱动内核切换属后续批次)。
 *
 * <p>平台级表(无租户列;app_id 列缺省注入不适用,见
 * {@link com.inneragent.platform.config.AppTenantLineInnerInterceptor#IGNORED_TABLES}),
 * 查询按 appId 显式过滤;唯一键 uk_ia_agent_definition_key(app_id, agent_key)。
 * *_json 列均为 TEXT 纯文本(序列化/解析收敛在服务层,V15 取舍同 ia_app)。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ia_agent_definition")
public class AgentDefinition extends BaseEntity {

    /** 主键 ID(DDL IDENTITY 自增;MP 码值 AUTO=数据库自增回填) */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(单应用部署固定 1) */
    private Long appId;

    /** Agent 业务标识(应用内唯一;bundle 导出形 agentType) */
    private String agentKey;

    /** Agent 种类:main-主 Agent sub-子 Agent(DDL CHECK 约束) */
    private String kind;

    /** Agent 显示名称(bundle 导出形 name) */
    private String title;

    /** 系统提示词(prompt 槽位 systemPrompt) */
    private String systemPrompt;

    /** 指令模板(prompt 槽位 instructionTemplate) */
    private String instructionTemplate;

    /** 默认关联模型 ID(ia_ai_model.id;可空) */
    private Long modelId;

    /** 工具白名单 JSON 文本(工具名/FQN 数组;规格域,导出形 specJson.toolWhitelist) */
    private String toolWhitelistJson;

    /** 子 Agent 可用工具 JSON 文本(规格域,导出形 specJson.subAgentTools) */
    private String subAgentToolsJson;

    /** 上下文注入模板 JSON 文本(规格域,导出形 specJson.contextTemplate) */
    private String contextTemplateJson;

    /** 开场白(prompt 槽位 greeting) */
    private String greeting;

    /** 是否启用:TRUE-启用 FALSE-停用 */
    private Boolean enabled;
}
