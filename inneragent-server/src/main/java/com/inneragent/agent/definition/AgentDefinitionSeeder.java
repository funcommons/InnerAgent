package com.inneragent.agent.definition;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.entity.AgentDefinition;
import com.inneragent.agent.mapper.AgentDefinitionMapper;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import com.inneragent.platform.config.ai.AiAgentRegistry;
import com.inneragent.platform.context.AppContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Agent 定义播种服务(ia_agent_definition;P2-W5 定义数据化第一步)。
 *
 * <p>启动时把 {@link AiAgentRegistry} 的代码定义<strong>补种</strong>进
 * ia_agent_definition(仅按 (app_id, agent_key) 缺失行 INSERT,绝不 UPDATE)——
 * 管理面的列表/导出/提示词编辑因此开箱即有内容;已存在的行(含管理员改过的
 * 提示词)永不被启动播种覆盖,编辑留痕不因重启丢失。运行内核仍读代码注册表,
 * 数据驱动内核切换属后续批次;本播种让两侧在切换日之前保持可对账
 * (导出 bundle ↔ 代码定义)。
 *
 * <p>kind 判定:被其他定义的 subAgentTools.refAgentType 引用者为 sub,
 * 否则 main(与内核「子 Agent 即工具」语义一致)。并发双节点同时播种由
 * 唯一键 uk_ia_agent_definition_key 兜底,DuplicateKeyException 按已存在
 * 处理跳过。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AgentDefinitionSeeder implements ApplicationRunner {

    private final AiAgentRegistry agentRegistry;
    private final AgentDefinitionMapper definitionMapper;
    private final ObjectMapper objectMapper;

    @Override
    public void run(ApplicationArguments args) {
        List<AiAgentDefinition> definitions = agentRegistry.getAll();
        if (definitions.isEmpty()) {
            return;
        }
        long appId = AppContext.currentOrDefault();
        Set<String> existingKeys = new HashSet<>();
        for (AgentDefinition row : definitionMapper.selectList(
                new LambdaQueryWrapper<AgentDefinition>().eq(AgentDefinition::getAppId, appId))) {
            existingKeys.add(row.getAgentKey());
        }
        Set<String> subTypes = collectSubAgentTypes(definitions);
        int seeded = 0;
        for (AiAgentDefinition definition : definitions) {
            if (existingKeys.contains(definition.getType())) {
                continue;
            }
            AgentDefinition row = toRow(appId, definition, subTypes);
            try {
                definitionMapper.insert(row);
                seeded++;
            } catch (DuplicateKeyException concurrentlySeeded) {
                // 双节点竞态:唯一键兜底,按「已存在不覆盖」同语义跳过
                log.info("Agent 定义已被并发播种,跳过: appId={}, agentKey={}",
                        appId, definition.getType());
            }
        }
        if (seeded > 0) {
            log.info("Agent 定义播种完成: appId={}, total={}, seeded={}, existing={}",
                    appId, definitions.size(), seeded, existingKeys.size());
        }
    }

    /** 代码定义 → 表行(insert-only;空白指令模板落 NULL,列语义「未配置」)。 */
    private AgentDefinition toRow(long appId, AiAgentDefinition definition, Set<String> subTypes) {
        AgentDefinition row = new AgentDefinition();
        row.setAppId(appId);
        row.setAgentKey(definition.getType());
        row.setKind(subTypes.contains(definition.getType()) ? KIND_SUB : KIND_MAIN);
        row.setTitle(definition.getName());
        row.setSystemPrompt(blankToNull(definition.getSystemPrompt()));
        row.setInstructionTemplate(blankToNull(definition.getInstructionTemplate()));
        row.setModelId(null);
        row.setToolWhitelistJson(toJsonOrNullOrBlankList(definition.getToolNames()));
        row.setSubAgentToolsJson(toJsonOrNullOrBlankList(definition.getSubAgentTools()));
        row.setContextTemplateJson(null);
        row.setGreeting(null);
        row.setEnabled(true);
        return row;
    }

    /** 收集所有 subAgentTools.refAgentType(被引用者即 sub Agent)。 */
    static Set<String> collectSubAgentTypes(List<AiAgentDefinition> definitions) {
        Set<String> refs = new HashSet<>();
        for (AiAgentDefinition definition : definitions) {
            if (definition.getSubAgentTools() == null) {
                continue;
            }
            for (AiAgentDefinition.SubAgentToolDef sub
                    : definition.getSubAgentTools()) {
                if (sub != null && sub.getRefAgentType() != null && !sub.getRefAgentType().isBlank()) {
                    refs.add(sub.getRefAgentType());
                }
            }
        }
        return refs;
    }

    private String toJsonOrNullOrBlankList(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof List<?> list && list.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception serializationFailure) {
            // 代码内定义的序列化失败属装配缺陷,fail-fast 暴露
            throw new IllegalStateException(
                    "Agent 定义播种序列化失败: " + value, serializationFailure);
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /** kind 码值(与 V1 DDL CHECK 约束一致)。 */
    public static final String KIND_MAIN = "main";
    public static final String KIND_SUB = "sub";
}
