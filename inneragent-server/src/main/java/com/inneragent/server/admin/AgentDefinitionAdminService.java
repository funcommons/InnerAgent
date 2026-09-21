package com.inneragent.server.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.agent.definition.AgentDefinitionSeeder;
import com.inneragent.agent.entity.AgentDefinition;
import com.inneragent.agent.mapper.AgentDefinitionMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Agent 定义管理服务(P2-W5「Agent 定义导入导出与提示词编辑」,02-技术方案
 * §4.6/§7.1;数据落 ia_agent_definition,实体 {@link AgentDefinition})。
 *
 * <p>职责:分页列表/详情(含提示词与规格 JSON)、提示词编辑(编辑留痕:旧值
 * 进审计入参快照,ia_audit_log 仅追加,decision=definition-updated、
 * source=admin——V12 已放宽 decision 列宽 VARCHAR(32))、导出 bundle
 * ({@link AgentDefinitionBundle},schemaVersion=1,形状为 P3/W7 融光定义
 * 导出预留)、导入(校验 → 冲突按 skip/overwrite 策略逐条落库;dryRun 只出
 * 预览报告零副作用;结果 {created,updated,skipped,errors[]} 全量返回)。
 *
 * <p>归属口径:ia_agent_definition 为平台级表(行级拦截器忽略清单),管理面
 * 为显式 appId 视图——列表/导出按 appId 过滤;单条操作按主键定位不做二次
 * app 校验(与审计检索「管理面为跨应用视图」同语义)。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentDefinitionAdminService {

    /** 提示词单槽长度上限(64K;TEXT 列宽松保护,防误粘贴超巨文本)。 */
    public static final int MAX_PROMPT_LENGTH = 65_536;

    /** 已知提示词槽位(= ia_agent_definition 提示词三列)。 */
    private static final Set<String> PROMPT_SLOTS = Set.of(
            AgentDefinitionBundle.SLOT_SYSTEM_PROMPT,
            AgentDefinitionBundle.SLOT_INSTRUCTION_TEMPLATE,
            AgentDefinitionBundle.SLOT_GREETING);

    /** kind 值域(V1 DDL CHECK 约束)。 */
    private static final Set<String> KINDS = Set.of("main", "sub");

    /** 冲突策略值域。 */
    private static final String POLICY_SKIP = "skip";
    private static final String POLICY_OVERWRITE = "overwrite";

    /** 审计 tool_fqn 伪命名(定义本体变更非工具调用;≤200 列宽)。 */
    private static String definitionFqn(String agentKey) {
        return "agent-definition:" + agentKey;
    }

    private final AgentDefinitionMapper definitionMapper;
    private final ToolAuditService auditService;
    private final ObjectMapper objectMapper;

    // ------------------------------------------------------------------
    // 查询(列表分页 / 详情)
    // ------------------------------------------------------------------

    /** 分页列表(agent_key 升序稳定排序;出参含提示词与规格视图)。 */
    public PageResult<DefinitionView> page(long appId, int pageNo, int pageSize) {
        int safePageNo = Math.max(pageNo, 1);
        int safePageSize = Math.min(Math.max(pageSize, 1), 100);
        Page<AgentDefinition> page = definitionMapper.selectPage(
                new Page<>(safePageNo, safePageSize),
                new LambdaQueryWrapper<AgentDefinition>()
                        .eq(AgentDefinition::getAppId, appId)
                        .orderByAsc(AgentDefinition::getAgentKey));
        PageResult<DefinitionView> result = new PageResult<>(
                page.getRecords().stream().map(this::toView).toList(),
                page.getTotal());
        result.setPageNo(safePageNo);
        result.setPageSize(safePageSize);
        return result;
    }

    /** 详情(404 兜底)。 */
    public DefinitionView get(long id) {
        return toView(requireRow(id));
    }

    // ------------------------------------------------------------------
    // 提示词编辑(PUT /{id}/prompt)
    // ------------------------------------------------------------------

    /**
     * 编辑单个提示词槽位:systemPrompt 必须非空白(定义不可无系统提示词),
     * 其余槽位允许空白=清空;统一长度上限。编辑留痕走最小实现——旧值进审计
     * 入参快照(params_masked_json,ia_audit_log 仅追加,不建新历史表)。
     * 审计 fail-closed:落审计失败则本次编辑一并回滚。
     */
    @Transactional
    public DefinitionView updatePrompt(long id, String slot, String content) {
        String normalizedSlot = normalizeSlot(slot);
        if (content == null) {
            throw new BusinessException(400, "content 不能为空(清空槽位传空字符串)");
        }
        if (content.length() > MAX_PROMPT_LENGTH) {
            throw new BusinessException(400, "提示词超过长度上限 " + MAX_PROMPT_LENGTH
                    + " 字符: 当前 " + content.length());
        }
        if (AgentDefinitionBundle.SLOT_SYSTEM_PROMPT.equals(normalizedSlot)
                && content.isBlank()) {
            throw new BusinessException(400, "systemPrompt 不能为空白");
        }
        AgentDefinition row = requireRow(id);
        String oldContent = promptOf(row, normalizedSlot);
        applyPrompt(row, normalizedSlot, content);
        definitionMapper.updateById(row);
        auditService.append(new ToolAuditService.ToolAuditEntry(
                row.getAppId(), null, null, null, null,
                definitionFqn(row.getAgentKey()),
                "definition-updated", ToolDecisionSource.ADMIN.code(),
                null,
                snapshot(objectMapper, Map.of(
                        "definitionId", row.getId(),
                        "agentType", row.getAgentKey(),
                        "slot", normalizedSlot,
                        "oldContent", oldContent == null ? "" : oldContent)),
                "prompt edited via admin; slot=" + normalizedSlot, null, null));
        log.info("Agent 定义提示词已更新: id={}, agentKey={}, slot={}, length={}",
                id, row.getAgentKey(), normalizedSlot, content.length());
        return toView(row);
    }

    // ------------------------------------------------------------------
    // 导出(POST /export)
    // ------------------------------------------------------------------

    /**
     * 导出 bundle:schemaVersion=1 + 定义数组(定义/提示词/版本元数据)。
     * ids 缺省=该 app 全量;ids 指定=按主键过滤(未知 id 静默忽略,幂等)。
     */
    public AgentDefinitionBundle.Bundle export(long appId, List<Long> ids) {
        LambdaQueryWrapper<AgentDefinition> query = new LambdaQueryWrapper<AgentDefinition>()
                .orderByAsc(AgentDefinition::getAgentKey);
        if (ids != null && !ids.isEmpty()) {
            query.in(AgentDefinition::getId, dedupe(ids));
        } else {
            query.eq(AgentDefinition::getAppId, appId);
        }
        List<AgentDefinitionBundle.DefinitionEntry> entries = definitionMapper
                .selectList(query).stream().map(this::toEntry).toList();
        return new AgentDefinitionBundle.Bundle(
                AgentDefinitionBundle.SCHEMA_VERSION,
                OffsetDateTime.now().toString(),
                entries);
    }

    // ------------------------------------------------------------------
    // 导入(POST /import)
    // ------------------------------------------------------------------

    /**
     * 导入 bundle:bundle 级校验(可解析/schemaVersion=1/definitions 数组)
     * 失败 400;条目级校验(必填/specJson 可解析+值域/槽位值域/新定义必带
     * systemPrompt)失败记入 errors[] 继续其余条目。冲突=(appId, agentType)
     * 已有活跃行:skip 保留现库计 skipped;overwrite 按 bundle 覆盖(name+
     * 出现的槽位/规格字段;未出现的列不动)计 updated。dryRun=true 全程只读。
     * 整体 @Transactional:任一条目写路径意外失败(含审计 fail-closed)
     * 全量回滚,fail-closed 与「errors[] 仅收校验错误」口径自洽。
     */
    @Transactional
    public AgentDefinitionBundle.ImportResult importBundle(
            long appId, JsonNode rawBundle, String conflictPolicy, boolean dryRun) {
        String policy = normalizePolicy(conflictPolicy);
        validateBundleShape(rawBundle);
        List<AgentDefinitionBundle.ImportError> errors = new ArrayList<>();
        int created = 0;
        int updated = 0;
        int skipped = 0;
        for (JsonNode element : rawBundle.path("definitions")) {
            String echoType = element.path("agentType").isTextual()
                    ? element.path("agentType").asText() : null;
            try {
                AgentDefinitionBundle.DefinitionEntry entry = parseEntry(element);
                AgentDefinition existing =
                        definitionMapper.selectByAppAndKey(appId, entry.agentType());
                if (existing == null) {
                    if (!dryRun) {
                        definitionMapper.insert(toNewRow(appId, entry));
                        auditImport(appId, entry, "definition-imported", "created");
                    }
                    created++;
                } else if (POLICY_SKIP.equals(policy)) {
                    skipped++;
                } else {
                    if (!dryRun) {
                        applyOverwrite(existing, entry);
                        definitionMapper.updateById(existing);
                        auditImport(appId, entry, "definition-updated", "overwritten");
                    }
                    updated++;
                }
            } catch (BusinessException invalidEntry) {
                // 条目级校验失败:记入 errors[],不落库、不占 skipped,继续其余条目
                errors.add(new AgentDefinitionBundle.ImportError(
                        echoType, invalidEntry.getMessage()));
            }
        }
        log.info("Agent 定义导入{}: appId={}, policy={}, created={}, updated={}, skipped={}, errors={}",
                dryRun ? "(dryRun 预演)" : "", appId, policy, created, updated, skipped, errors.size());
        return new AgentDefinitionBundle.ImportResult(dryRun, created, updated, skipped, errors);
    }

    // ------------------------------------------------------------------
    // 视图装配
    // ------------------------------------------------------------------

    /** 详情/列表视图(prompts 三槽 + spec 规格对象,与 bundle specJson 同构)。 */
    public DefinitionView toView(AgentDefinition row) {
        return new DefinitionView(
                row.getId(),
                row.getAppId(),
                row.getAgentKey(),
                row.getKind(),
                row.getTitle(),
                row.getEnabled(),
                new DefinitionView.PromptsView(
                        row.getSystemPrompt(),
                        row.getInstructionTemplate(),
                        row.getGreeting()),
                specJsonOf(row),
                row.getModelId());
    }

    private AgentDefinitionBundle.DefinitionEntry toEntry(AgentDefinition row) {
        return new AgentDefinitionBundle.DefinitionEntry(
                row.getId(),
                row.getAgentKey(),
                row.getTitle(),
                specJsonOf(row),
                List.of(
                        new AgentDefinitionBundle.PromptEntry(
                                AgentDefinitionBundle.SLOT_SYSTEM_PROMPT,
                                row.getSystemPrompt()),
                        new AgentDefinitionBundle.PromptEntry(
                                AgentDefinitionBundle.SLOT_INSTRUCTION_TEMPLATE,
                                row.getInstructionTemplate()),
                        new AgentDefinitionBundle.PromptEntry(
                                AgentDefinitionBundle.SLOT_GREETING,
                                row.getGreeting())));
    }

    /** 规格对象(bundle specJson 同构;JSON 列解析失败按 null 容错导出)。 */
    private JsonNode specJsonOf(AgentDefinition row) {
        ObjectNode spec = objectMapper.createObjectNode();
        spec.put("kind", row.getKind());
        spec.put("enabled", row.getEnabled());
        if (row.getModelId() != null) {
            spec.put("modelId", row.getModelId());
        } else {
            spec.putNull("modelId");
        }
        spec.set("toolWhitelist", parseOrNull(row.getToolWhitelistJson()));
        spec.set("subAgentTools", parseOrNull(row.getSubAgentToolsJson()));
        spec.set("contextTemplate", parseOrNull(row.getContextTemplateJson()));
        return spec;
    }

    private JsonNode parseOrNull(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (JsonProcessingException malformedStoredJson) {
            // 存量脏数据不阻断导出/详情;原样以文本节点透出供人工排查
            return objectMapper.getNodeFactory().textNode(json);
        }
    }

    // ------------------------------------------------------------------
    // 导入解析与校验
    // ------------------------------------------------------------------

    /** bundle 级校验(非对象/schemaVersion 不符/definitions 非数组 → 400)。 */
    private void validateBundleShape(JsonNode rawBundle) {
        if (rawBundle == null || rawBundle.isNull() || rawBundle.isMissingNode()) {
            throw new BusinessException(400, "bundle 不能为空");
        }
        if (!rawBundle.isObject()) {
            throw new BusinessException(400, "bundle 必须为 JSON 对象");
        }
        JsonNode version = rawBundle.path("schemaVersion");
        if (!version.isInt() || version.asInt() != AgentDefinitionBundle.SCHEMA_VERSION) {
            throw new BusinessException(400, "不支持的 bundle schemaVersion: " + version
                    + ",当前仅支持 " + AgentDefinitionBundle.SCHEMA_VERSION);
        }
        JsonNode definitions = rawBundle.path("definitions");
        if (!definitions.isArray()) {
            throw new BusinessException(400, "bundle.definitions 必须为数组");
        }
    }

    private AgentDefinitionBundle.DefinitionEntry parseEntry(JsonNode element) {
        if (element == null || !element.isObject()) {
            throw new BusinessException(400, "定义条目必须为 JSON 对象");
        }
        String agentType = element.path("agentType").asText(null);
        if (agentType == null || agentType.isBlank()) {
            throw new BusinessException(400, "agentType 不能为空");
        }
        agentType = agentType.trim();
        if (agentType.length() > 64) {
            throw new BusinessException(400, "agentType 超长(≤64): " + agentType);
        }
        String name = element.path("name").asText(null);
        if (name == null || name.isBlank()) {
            throw new BusinessException(400, "name 不能为空: " + agentType);
        }
        if (name.length() > 255) {
            throw new BusinessException(400, "name 超长(≤255): " + agentType);
        }
        JsonNode specJson = element.path("specJson");
        if (!specJson.isMissingNode() && !specJson.isNull() && !specJson.isObject()) {
            throw new BusinessException(400, "specJson 必须为 JSON 对象: " + agentType);
        }
        if (specJson.isObject()) {
            validateSpec(agentType, specJson);
        }
        JsonNode promptsNode = element.path("prompts");
        if (!promptsNode.isMissingNode() && !promptsNode.isNull() && !promptsNode.isArray()) {
            throw new BusinessException(400, "prompts 必须为数组: " + agentType);
        }
        List<AgentDefinitionBundle.PromptEntry> prompts = new ArrayList<>();
        if (promptsNode.isArray()) {
            for (JsonNode promptNode : promptsNode) {
                if (!promptNode.isObject()) {
                    throw new BusinessException(400, "prompts 条目必须为对象: " + agentType);
                }
                String slot = promptNode.path("slot").asText(null);
                if (slot == null || !PROMPT_SLOTS.contains(slot)) {
                    throw new BusinessException(400, "未知提示词槽位: " + slot
                            + ",允许值 " + PROMPT_SLOTS + ": " + agentType);
                }
                JsonNode content = promptNode.path("content");
                prompts.add(new AgentDefinitionBundle.PromptEntry(
                        slot, content.isTextual() ? content.asText() : null));
            }
        }
        return new AgentDefinitionBundle.DefinitionEntry(
                element.path("definitionId").isNumber()
                        ? element.path("definitionId").asLong() : null,
                agentType, name,
                specJson.isObject() ? specJson : null,
                prompts);
    }

    /** 规格已知字段值域校验(kind/enabled/modelId/数组域;未知字段放行)。 */
    private void validateSpec(String agentType, JsonNode spec) {
        JsonNode kind = spec.path("kind");
        if (!kind.isMissingNode() && !kind.isNull()
                && (!kind.isTextual() || !KINDS.contains(kind.asText()))) {
            throw new BusinessException(400, "specJson.kind 仅支持 main/sub: " + agentType);
        }
        JsonNode enabled = spec.path("enabled");
        if (!enabled.isMissingNode() && !enabled.isNull() && !enabled.isBoolean()) {
            throw new BusinessException(400, "specJson.enabled 必须为布尔: " + agentType);
        }
        JsonNode modelId = spec.path("modelId");
        if (!modelId.isMissingNode() && !modelId.isNull()
                && !(modelId.isNumber() || modelId.isTextual())) {
            throw new BusinessException(400, "specJson.modelId 必须为数字: " + agentType);
        }
        for (String arrayField : List.of("toolWhitelist", "subAgentTools")) {
            JsonNode field = spec.path(arrayField);
            if (!field.isMissingNode() && !field.isNull() && !field.isArray()) {
                throw new BusinessException(400,
                        "specJson." + arrayField + " 必须为数组: " + agentType);
            }
        }
    }

    private AgentDefinition toNewRow(long appId, AgentDefinitionBundle.DefinitionEntry entry) {
        AgentDefinition row = new AgentDefinition();
        row.setAppId(appId);
        row.setAgentKey(entry.agentType());
        row.setTitle(entry.name());
        row.setModelId(null);
        row.setEnabled(true);
        row.setKind(AgentDefinitionSeeder.KIND_MAIN);
        applySpec(row, entry.specJson());
        applyPrompts(row, entry.prompts());
        if (row.getSystemPrompt() == null || row.getSystemPrompt().isBlank()) {
            throw new BusinessException(400,
                    "新定义 systemPrompt 不能为空: " + entry.agentType());
        }
        return row;
    }

    /** overwrite:bundle 中出现的字段逐列覆盖,未出现的列保持现值。 */
    private void applyOverwrite(AgentDefinition existing, AgentDefinitionBundle.DefinitionEntry entry) {
        existing.setTitle(entry.name());
        applySpec(existing, entry.specJson());
        applyPrompts(existing, entry.prompts());
    }

    private void applySpec(AgentDefinition row, JsonNode spec) {
        if (spec == null) {
            return;
        }
        JsonNode kind = spec.path("kind");
        if (kind.isTextual()) {
            row.setKind(kind.asText());
        }
        JsonNode enabled = spec.path("enabled");
        if (enabled.isBoolean()) {
            row.setEnabled(enabled.asBoolean());
        }
        JsonNode modelId = spec.path("modelId");
        if (modelId.isNull()) {
            row.setModelId(null);
        } else if (modelId.isNumber()) {
            row.setModelId(modelId.asLong());
        }
        JsonNode toolWhitelist = spec.path("toolWhitelist");
        if (toolWhitelist.isArray()) {
            row.setToolWhitelistJson(compact(toolWhitelist));
        } else if (toolWhitelist.isNull()) {
            row.setToolWhitelistJson(null);
        }
        JsonNode subAgentTools = spec.path("subAgentTools");
        if (subAgentTools.isArray()) {
            row.setSubAgentToolsJson(compact(subAgentTools));
        } else if (subAgentTools.isNull()) {
            row.setSubAgentToolsJson(null);
        }
        JsonNode contextTemplate = spec.path("contextTemplate");
        if (!contextTemplate.isMissingNode()) {
            row.setContextTemplateJson(contextTemplate.isNull() ? null : compact(contextTemplate));
        }
    }

    private void applyPrompts(AgentDefinition row, List<AgentDefinitionBundle.PromptEntry> prompts) {
        if (prompts == null) {
            return;
        }
        // 重复槽位后者生效(Map 归并后再落列)
        Map<String, String> merged = new LinkedHashMap<>();
        for (AgentDefinitionBundle.PromptEntry prompt : prompts) {
            merged.put(prompt.slot(), prompt.content());
        }
        merged.forEach((slot, content) -> applyPrompt(row, slot, content));
    }

    private void applyPrompt(AgentDefinition row, String slot, String content) {
        switch (slot) {
            case AgentDefinitionBundle.SLOT_SYSTEM_PROMPT -> row.setSystemPrompt(content);
            case AgentDefinitionBundle.SLOT_INSTRUCTION_TEMPLATE ->
                    row.setInstructionTemplate(content);
            case AgentDefinitionBundle.SLOT_GREETING -> row.setGreeting(content);
            default -> throw new BusinessException(400, "未知提示词槽位: " + slot);
        }
    }

    private void auditImport(long appId, AgentDefinitionBundle.DefinitionEntry entry,
                             String decision, String action) {
        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId, null, null, null, null,
                definitionFqn(entry.agentType()),
                decision, ToolDecisionSource.ADMIN.code(),
                null,
                snapshot(objectMapper, Map.of(
                        "agentType", entry.agentType(),
                        "action", action,
                        "schemaVersion", AgentDefinitionBundle.SCHEMA_VERSION)),
                "definition imported via admin; action=" + action, null, null));
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private AgentDefinition requireRow(long id) {
        AgentDefinition row = definitionMapper.selectById(id);
        if (row == null) {
            throw new BusinessException(404, "Agent 定义不存在: " + id);
        }
        return row;
    }

    private static String normalizeSlot(String slot) {
        if (slot == null || slot.isBlank()) {
            throw new BusinessException(400, "slot 不能为空,允许值 " + PROMPT_SLOTS);
        }
        String normalized = slot.trim();
        if (!PROMPT_SLOTS.contains(normalized)) {
            throw new BusinessException(400, "未知提示词槽位: " + slot
                    + ",允许值 " + PROMPT_SLOTS);
        }
        return normalized;
    }

    private static String normalizePolicy(String conflictPolicy) {
        if (conflictPolicy == null || conflictPolicy.isBlank()) {
            return POLICY_SKIP;
        }
        String normalized = conflictPolicy.trim().toLowerCase(Locale.ROOT);
        if (!POLICY_SKIP.equals(normalized) && !POLICY_OVERWRITE.equals(normalized)) {
            throw new BusinessException(400,
                    "conflictPolicy 仅支持 skip/overwrite: " + conflictPolicy);
        }
        return normalized;
    }

    private static String promptOf(AgentDefinition row, String slot) {
        return switch (slot) {
            case AgentDefinitionBundle.SLOT_SYSTEM_PROMPT -> row.getSystemPrompt();
            case AgentDefinitionBundle.SLOT_INSTRUCTION_TEMPLATE -> row.getInstructionTemplate();
            case AgentDefinitionBundle.SLOT_GREETING -> row.getGreeting();
            default -> throw new BusinessException(400, "未知提示词槽位: " + slot);
        };
    }

    private static List<Long> dedupe(List<Long> ids) {
        Set<Long> unique = new HashSet<>(ids);
        return new ArrayList<>(unique);
    }

    private String compact(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException impossibleForInMemoryNode) {
            throw new IllegalStateException("JSON 序列化失败", impossibleForInMemoryNode);
        }
    }

    private static String snapshot(ObjectMapper mapper, Map<String, Object> payload) {
        try {
            return mapper.writeValueAsString(payload);
        } catch (JsonProcessingException serializationFailure) {
            // 快照序列化失败不阻断业务(审计 params 可空)
            return null;
        }
    }

    /** 定义视图(GET 列表/详情出参;spec 与 bundle specJson 同构)。 */
    public record DefinitionView(
            Long id,
            Long appId,
            String agentType,
            String kind,
            String name,
            Boolean enabled,
            PromptsView prompts,
            JsonNode spec,
            Long modelId) {

        /** 提示词三槽(列语义原样:可空)。 */
        public record PromptsView(
                String systemPrompt,
                String instructionTemplate,
                String greeting) {
        }
    }
}
