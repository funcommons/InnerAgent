package com.inneragent.agent.definition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.kernel.AgentPromptVariables;
import lombok.extern.slf4j.Slf4j;

import java.util.Map;

/**
 * 定义提示词装配助手(P4 数据驱动内核;根/子内核共用的 contextTemplate
 * 注入挂点)。
 *
 * <p>ia_agent_definition.context_template_json(「上下文注入模板」)在运行
 * 组装期的最小消费语义:定义级静态上下文材料,与 instructionTemplate 同侧
 * ——渲染提示词变量后追加进系统提示词(子 Agent 见
 * {@code AgentKernelSpecFactory.createChild},根 Agent 见
 * {@code AgentScopePipelineRunService.systemPrompt})。接收形态:
 * <ul>
 *   <li>JSON 对象 {@code {名称: 模板文本}} → 逐项渲染为
 *       {@code <context name="名称">文本</context>} 区块(形状与运行输入侧
 *       {@code <references>/<reference name=...>} 同款,键序保持);</li>
 *   <li>JSON 文本串 → 整体渲染后原文追加;</li>
 *   <li>空白 → 原样返回(未配置);</li>
 *   <li>其他 JSON 形状(数组/数值等)或不可解析 → WARN 降级不注入(定义级
 *       装饰材料不可用不阻断会话,与 KB 注入的可用性口径一致;管理面导入
 *       不校验该域形状,脏值运行期兜底)。</li>
 * </ul>
 */
@Slf4j
public final class AgentDefinitionPrompts {

    private AgentDefinitionPrompts() {
    }

    /**
     * 渲染定义 contextTemplate 并追加到提示词尾部(无配置/降级时原样返回)。
     */
    public static String appendContextTemplate(
            ObjectMapper objectMapper,
            String prompt,
            String contextTemplateJson,
            Map<String, String> variables) {
        if (contextTemplateJson == null || contextTemplateJson.isBlank()) {
            return prompt;
        }
        JsonNode node;
        try {
            node = objectMapper.readTree(contextTemplateJson);
        } catch (RuntimeException | com.fasterxml.jackson.core.JsonProcessingException malformed) {
            log.warn("Agent 定义上下文模板不可解析,跳过注入: {}",
                    malformed.toString());
            return prompt;
        }
        StringBuilder appended = new StringBuilder();
        if (node != null && node.isObject()) {
            node.properties().forEach(entry -> {
                JsonNode value = entry.getValue();
                if (value != null && value.isTextual()) {
                    appended.append("\n\n<context name=\"").append(entry.getKey())
                            .append("\">\n")
                            .append(AgentPromptVariables.render(
                                    value.asText(), variables))
                            .append("\n</context>");
                }
            });
        } else if (node != null && node.isTextual()) {
            appended.append("\n\n").append(
                    AgentPromptVariables.render(node.asText(), variables));
        } else {
            log.warn("Agent 定义上下文模板形状不支持(仅对象/文本串),跳过注入");
        }
        return appended.isEmpty() ? prompt : prompt + appended;
    }
}
