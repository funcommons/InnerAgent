package com.inneragent.agent.tool;

import cn.hutool.core.collection.CollUtil;
import com.inneragent.agent.definition.AiAgentService;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

/**
 * AI Tool 配置服务
 * <p>
 * 支持按 Agent 类型获取可用工具列表（白名单过滤），
 * 并支持运行时与前端 enabledTools 取交集。
 * <p>
 * [adapt] P4 数据驱动内核:定义解析统一走 {@link AiAgentService}
 * (ia_agent_definition 优先、代码注册表回落)——DB 定义声明的工具白名单与
 * 子 Agent 工具面在此进入内核组装,管理面改完即生效;直接读代码注册表会使
 * 提示词(数据驱动)与工具面(代码)两侧口径分裂,故本服务不再直连注册表。
 */
@Service
@RequiredArgsConstructor
public class AiToolConfigService {

    private final List<ToolExecutor> toolExecutors;
    private final AiAgentService agentService;

    /**
     * 获取所有已启用的工具执行器
     */
    public List<ToolExecutor> getEnabledTools() {
        return toolExecutors.stream()
                .filter(ToolExecutor::isEnabled)
                .toList();
    }

    /**
     * 获取指定 Agent 下已启用的 callback 工具执行器
     * <p>
     * 逻辑：Agent 白名单（toolNames） ∩ 已注册且已启用的 ToolExecutor
     *
     * @param agentType Agent 类型
     * @return 过滤后的工具列表
     */
    public List<ToolExecutor> getEnabledToolsByAgent(String agentType) {
        if (agentType == null) {
            return getEnabledTools();
        }

        AiAgentDefinition agentDef = agentService.getByType(agentType);
        if (agentDef == null) {
            return Collections.emptyList();
        }

        List<String> toolNames = agentDef.getToolNames();
        // toolNames 为 null 表示该 Agent 可使用所有工具
        if (toolNames == null) {
            return getEnabledTools();
        }

        return toolExecutors.stream()
                .filter(ToolExecutor::isEnabled)
                .filter(t -> toolNames.contains(t.getToolName()))
                .toList();
    }

    /**
     * 获取指定 Agent 下的子 Agent 工具定义
     *
     * @param agentType Agent 类型
     * @return 子 Agent 工具定义列表
     */
    public List<AiAgentDefinition.SubAgentToolDef> getSubAgentTools(String agentType) {
        if (agentType == null) {
            return Collections.emptyList();
        }
        AiAgentDefinition agentDef = agentService.getByType(agentType);
        if (agentDef == null || CollUtil.isEmpty(agentDef.getSubAgentTools())) {
            return Collections.emptyList();
        }
        return agentDef.getSubAgentTools();
    }

    /**
     * 获取所有工具执行器
     */
    public List<ToolExecutor> getAllTools() {
        return toolExecutors;
    }
}
