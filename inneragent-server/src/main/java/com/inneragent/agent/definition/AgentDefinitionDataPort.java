package com.inneragent.agent.definition;

import com.inneragent.platform.config.ai.AiAgentDefinition;

/**
 * Agent 定义数据端口(P4 数据驱动内核;内核端口 + ia_agent_definition 实现,
 * 依赖方向与 {@link com.inneragent.agent.skill.AppSkillCatalogPort}(Skill
 * 接线先例)/{@link com.inneragent.agent.kb.AgentKnowledgeBasePort}(KB 接线
 * 先例)一致:内核面向端口编程,不感知存储与管理面细节)。
 *
 * <p>消费点:{@link AiAgentService}——运行内核按 agentType 解析定义时的
 * <strong>DB 优先</strong>侧(ia_agent_definition 命中即数据驱动;未命中回落
 * 代码注册表 {@link com.inneragent.platform.config.ai.AiAgentRegistry},既有
 * agentType 全部零回归)。
 *
 * <p>契约:
 * <ul>
 *   <li><strong>app 隔离</strong>:appId 由消费方显式传入(与
 *       {@code AppSkillCatalogPort.activated(appId)} 同款;实现不得隐式取上下文);</li>
 *   <li><strong>启用态过滤</strong>:仅 enabled=TRUE 且未删行命中;停用/缺失
 *       行返回 {@code null}(= 本端口「未命中」,由消费方回落代码注册表)。</li>
 *   <li><strong>fail-closed</strong>:行命中但规格 JSON(toolWhitelist/
 *       subAgentTools)不可解析时抛异常暴露真实原因,不得静默回落——数据损坏
 *       回落代码注册表会静默改变工具面,违背数据驱动语义。</li>
 * </ul>
 */
public interface AgentDefinitionDataPort {

    /**
     * 加载指定应用下启用态的 Agent 定义并转为内核定义形态。
     *
     * @param appId    所属应用(ia_agent_definition.app_id)
     * @param agentKey Agent 业务标识(ia_agent_definition.agent_key)
     * @return 内核定义形态;未命中(缺行/停用)返回 {@code null}
     */
    AiAgentDefinition loadEnabled(long appId, String agentKey);
}
