package com.inneragent.agent.definition;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.agent.entity.AgentDefinition;
import com.inneragent.agent.mapper.AgentDefinitionMapper;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * ia_agent_definition 数据侧端口实现(P4 数据驱动内核)。
 *
 * <p>本表数据访问的内核侧先行先例是 {@link AgentDefinitionSeeder}(启动播种
 * 直读 ia_agent_definition),故实现落 kernel 侧 {@code agent/definition} 而非
 * 管理面(server/admin 只拥有管理语义);管理面导入/编辑的行经本适配器在
 * <strong>下一次运行组装即生效</strong>——「数据驱动」的核心语义。
 *
 * <p>行 → 内核形态({@link AiAgentDefinition})映射:
 * <ul>
 *   <li>agent_key→type、title→name、system_prompt/instruction_template 原样;</li>
 *   <li><strong>工具面三分法</strong>(toolWhitelistJson → enableTools+toolNames,
 *       与内核 DEF-07「仅非空数组是显式白名单」同构):
 *       <ul>
 *         <li>null/空白 → {@code enableTools=0}(未声明工具面 → 无工具,含
 *             MCP 面一并关闭;播种侧「代码 enableTools=0」与导入侧「未声明」
 *             同收敛,deny-by-default);</li>
 *         <li>{@code []} → {@code enableTools=1} + 空白名单(直连工具面空,
 *             MCP 面仍按缺省可见性);</li>
 *         <li>非空数组 → {@code enableTools=1} + 显式白名单(工具名/FQN 面)。</li>
 *       </ul>
 *       播种回读对账:代码 enableTools=0 播种 null → 还原 enableTools=0;
 *       enableTools=1(必带显式 toolNames,注册表 17/17)播种非空数组 → 还原
 *       白名单,既有 agentType 行为零回归。</li>
 *   <li>subAgentToolsJson → {@link AiAgentDefinition.SubAgentToolDef} 列表:
 *       管理面导入按 bundle 原样落库,故条目内 parametersSchema/outputSchema
 *       兼容对象/数组节点(序列化回字符串)与字符串两种形态;未知字段容忍
 *       (bundle specJson 向前兼容契约,W7 宿主可携带自有规格)。</li>
 *   <li>contextTemplateJson → 内核形态 contextTemplateJson 原样透传(组装点
 *       统一渲染,见 {@link AgentDefinitionPrompts})。</li>
 *   <li>defaultUserMessage:表未承载(随 bundle schemaVersion 升版引入),
 *       由 {@link AiAgentService} 以代码注册表同型定义补缺。</li>
 *   <li>greeting:表已承载,运行入口暂无承接点(遗留,见 AiAgentService)。</li>
 * </ul>
 */
@Component
public class DbAgentDefinitionDataAdapter implements AgentDefinitionDataPort {

    /** 内核形态的 schema 字段名(条目内以字符串承载,与播种 JSON 同形)。 */
    private static final String PARAMETERS_SCHEMA = "parametersSchema";
    private static final String OUTPUT_SCHEMA = "outputSchema";

    private final AgentDefinitionMapper definitionMapper;
    private final ObjectMapper objectMapper;
    /** 子工具条目反序列化容忍未知字段(bundle specJson 向前兼容契约);不改共享实例。 */
    private final ObjectMapper lenientMapper;

    public DbAgentDefinitionDataAdapter(
            AgentDefinitionMapper definitionMapper, ObjectMapper objectMapper) {
        this.definitionMapper = definitionMapper;
        this.objectMapper = objectMapper;
        this.lenientMapper = objectMapper.copy()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    @Override
    public AiAgentDefinition loadEnabled(long appId, String agentKey) {
        AgentDefinition row = definitionMapper.selectByAppAndKey(appId, agentKey);
        if (row == null || !Boolean.TRUE.equals(row.getEnabled())) {
            return null;
        }
        return toDefinition(row);
    }

    /** 行 → 内核定义形态(映射语义见类注;fail-closed 口径见端口契约)。 */
    private AiAgentDefinition toDefinition(AgentDefinition row) {
        String rawWhitelist = row.getToolWhitelistJson();
        boolean faceDeclared = rawWhitelist != null && !rawWhitelist.isBlank();
        return AiAgentDefinition.builder()
                .type(row.getAgentKey())
                .name(row.getTitle())
                .systemPrompt(row.getSystemPrompt())
                .instructionTemplate(row.getInstructionTemplate())
                .contextTemplateJson(row.getContextTemplateJson())
                .enableTools(faceDeclared ? 1 : 0)
                .toolNames(faceDeclared ? parseList(row, rawWhitelist) : null)
                .subAgentTools(parseSubAgents(row))
                .build();
    }

    private List<String> parseList(AgentDefinition row, String json) {
        try {
            return objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {
            });
        } catch (JsonProcessingException malformedStoredJson) {
            throw new IllegalStateException(
                    "Agent 定义工具白名单不可解析: agentKey=" + row.getAgentKey(),
                    malformedStoredJson);
        }
    }

    private List<AiAgentDefinition.SubAgentToolDef> parseSubAgents(AgentDefinition row) {
        String json = row.getSubAgentToolsJson();
        if (json == null || json.isBlank()) {
            return List.of();
        }
        JsonNode array;
        try {
            array = objectMapper.readTree(json);
        } catch (JsonProcessingException malformedStoredJson) {
            throw new IllegalStateException(
                    "Agent 定义子 Agent 工具规格不可解析: agentKey=" + row.getAgentKey(),
                    malformedStoredJson);
        }
        if (!array.isArray()) {
            throw new IllegalStateException(
                    "Agent 定义子 Agent 工具规格须为数组: agentKey=" + row.getAgentKey());
        }
        List<AiAgentDefinition.SubAgentToolDef> subAgents = new ArrayList<>();
        for (JsonNode entry : array) {
            subAgents.add(lenientMapper.convertValue(
                    normalizeSchemaNodes(entry), AiAgentDefinition.SubAgentToolDef.class));
        }
        return List.copyOf(subAgents);
    }

    /** 条目内 schema 字段(对象/数组节点)规整为内核形态的字符串文本。 */
    private JsonNode normalizeSchemaNodes(JsonNode entry) {
        if (!entry.isObject()) {
            return entry;
        }
        ObjectNode object = (ObjectNode) entry;
        for (String field : List.of(PARAMETERS_SCHEMA, OUTPUT_SCHEMA)) {
            JsonNode schema = object.get(field);
            if (schema != null && (schema.isObject() || schema.isArray())) {
                object.put(field, schema.toString());
            }
        }
        return object;
    }
}
