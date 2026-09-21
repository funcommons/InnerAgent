package com.inneragent.server.admin;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

/**
 * Agent 定义导入导出 bundle(P2-W5;形状为 P3/W7 融光「17 定义 + 22 提示词
 * → JSON → InnerAgent 导入」预留,02-技术方案 §4.6/§9.2)。
 *
 * <p>顶层形:{@code {schemaVersion:1, exportedAt, definitions:[...]}}。
 * 定义条目形 {@code {definitionId, agentType, name, specJson, prompts:[...]}}:
 * <ul>
 *   <li><strong>definitionId</strong>:导出方库内主键,仅回显/对账用;
 *       导入定位一律以 (appId, agentType) 唯一键(跨环境 ID 不稳定);</li>
 *   <li><strong>agentType / name</strong>:业务标识(ia_agent_definition.agent_key)
 *       与显示名(title);</li>
 *   <li><strong>specJson</strong>:规格对象(非提示词的可执行配置)——
 *       {kind, enabled, modelId, toolWhitelist, subAgentTools, contextTemplate},
 *       服务端只校验「可解析对象 + 已知字段值域」,未知字段原样保留(向前兼容,
 *       W7 融光侧可携带宿主自有规格);</li>
 *   <li><strong>prompts</strong>:提示词槽位数组 {@code {slot, content}},
 *       槽位值域 systemPrompt/instructionTemplate/greeting(ia_agent_definition
 *       提示词三列)。W7 融光导出的 22 个提示词文件即落 systemPrompt/
 *       instructionTemplate 槽;扩展槽位(如 defaultUserMessage)随
 *       schemaVersion 升版引入,当前未知槽位按条目级错误处理(不静默丢弃)。</li>
 * </ul>
 */
public final class AgentDefinitionBundle {

    /** 当前 schema 版本(破坏性形状变更时升版;导入仅接受本版本)。 */
    public static final int SCHEMA_VERSION = 1;

    /** 提示词槽位值域(ia_agent_definition 提示词三列)。 */
    public static final String SLOT_SYSTEM_PROMPT = "systemPrompt";
    public static final String SLOT_INSTRUCTION_TEMPLATE = "instructionTemplate";
    public static final String SLOT_GREETING = "greeting";

    private AgentDefinitionBundle() {
    }

    /** 导出/导入 bundle 顶层(exportedAt ISO-8601 文本)。 */
    public record Bundle(
            int schemaVersion,
            String exportedAt,
            List<DefinitionEntry> definitions) {
    }

    /** 定义条目(specJson 为规格对象;prompts 为提示词槽位集合)。 */
    public record DefinitionEntry(
            Long definitionId,
            String agentType,
            String name,
            JsonNode specJson,
            List<PromptEntry> prompts) {
    }

    /** 提示词槽位(content 可空=清空该槽)。 */
    public record PromptEntry(String slot, String content) {
    }

    /** 导入请求(conflictPolicy: skip-遇冲突保留现库 | overwrite-按 bundle 覆盖)。 */
    public record ImportRequest(
            String conflictPolicy,
            Boolean dryRun) {
    }

    /**
     * 导入结果(全量返回)。计数口径:created+updated+skipped 只含有效条目,
     * 校验失败条目只进 errors[](不占 skipped);skipped 专指冲突按 skip
     * 策略保留现库。dryRun=true 时零副作用,计数为「将要发生」的预演值。
     */
    public record ImportResult(
            boolean dryRun,
            int created,
            int updated,
            int skipped,
            List<ImportError> errors) {
    }

    /** 条目级错误(agentType 尽力回显,解析失败可为 null)。 */
    public record ImportError(String agentType, String reason) {
    }
}
