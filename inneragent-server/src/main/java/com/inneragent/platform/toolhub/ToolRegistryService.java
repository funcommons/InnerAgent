package com.inneragent.platform.toolhub;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.tool.ToolExecutorRegistry;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import com.inneragent.platform.toolhub.mapper.ToolSchemaHistoryMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 工具注册管理服务(ia_tool_registry;PRD §6.2.1,02-技术方案 §4.3)。
 *
 * <p>职责:注册/更新(FQN 命名 V25、指纹计算、注解默认风险级 V15、
 * 冲突保护)、活刷新分诊(V14:unchanged 静默刷新/compatible 自动生效/
 * breaking 转待重新确认并级联失效存量授权)、启停(级联失效授权)、
 * 注销(逻辑删除+级联失效授权)、指纹变更历史留痕(ia_tool_schema_history)。
 * 注册表级变更统一经 {@link ToolCatalogInvalidator} 失效目录缓存。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ToolRegistryService {

    public static final String SOURCE_HOST_APP = "host_app";
    public static final String SOURCE_THIRD_PARTY = "third_party";
    private static final Set<String> SOURCES = Set.of(SOURCE_HOST_APP, SOURCE_THIRD_PARTY);
    private static final Set<String> ADMIN_POLICIES = Set.of("force-ask", "force-allow", "deny");

    /** FQN 形态:mcp__&lt;serverKey&gt;__&lt;toolName&gt;(V25;serverKey 避用下划线)。 */
    static final String FQN_PREFIX = "mcp__";
    private static final Pattern SERVER_KEY_PATTERN = Pattern.compile("[A-Za-z0-9-]{1,64}");

    /** 分诊结论/处理结果码值(落 ia_tool_schema_history)。 */
    static final String OUTCOME_SILENT_REFRESH = "silent_refresh";
    static final String OUTCOME_APPLIED = "applied";
    static final String OUTCOME_PENDING_REVIEW = "pending_review";
    static final String OUTCOME_REJECTED = "rejected";

    private final ToolRegistryMapper registryMapper;
    private final ToolSchemaHistoryMapper historyMapper;
    private final ToolGrantService grantService;
    private final ToolAuditService auditService;
    private final SchemaTriageService triageService;
    private final ToolExecutorRegistry toolExecutorRegistry;
    private final ObjectMapper objectMapper;
    private final ObjectProvider<ToolCatalogInvalidator> catalogInvalidators;

    // ------------------------------------------------------------------
    // 注册
    // ------------------------------------------------------------------

    /**
     * 注册工具:计算 FQN 与 schema 指纹,注解生成默认风险级(人工可覆盖),
     * 删除/资金/凭据类强制高危;应用内工具名唯一 + 与内置工具重名拒绝。
     */
    @Transactional
    public ToolRegistryEntry register(RegisterCommand command) {
        long appId = AppContext.currentOrDefault();
        String serverKey = requireText(command.serverKey(), "serverKey");
        if (!SERVER_KEY_PATTERN.matcher(serverKey).matches()) {
            throw new BusinessException(400,
                    "serverKey 仅允许字母/数字/连字符(避用下划线,V25): " + serverKey);
        }
        String toolName = requireText(command.toolName(), "toolName");
        if (toolName.length() > 128) {
            throw new BusinessException(400, "toolName 超长(≤128)");
        }
        String source = requireText(command.source(), "source");
        if (!SOURCES.contains(source)) {
            throw new BusinessException(400, "source 仅支持 host_app/third_party: " + source);
        }
        if (toolExecutorRegistry.findExecutor(toolName) != null) {
            throw new BusinessException(409, "与内置工具重名,拒绝注册: " + toolName);
        }
        String fqn = fqnOf(serverKey, toolName);
        if (fqn.length() > 200) {
            throw new BusinessException(400, "FQN 超长(≤200): " + fqn);
        }

        ToolAnnotations annotations = ToolAnnotations.parse(objectMapper, command.annotationsJson());
        ToolRegistryEntry existing = registryMapper.selectByFqnIncludingDeleted(fqn);
        if (existing != null && !Boolean.TRUE.equals(existing.getDeleted())) {
            throw new BusinessException(409, "工具已注册: " + fqn);
        }
        ToolRegistryEntry nameClash = registryMapper.selectActiveByToolName(toolName);
        if (nameClash != null && !nameClash.getFqn().equals(fqn)) {
            throw new BusinessException(409, "工具名应用内唯一,重名冲突: " + toolName);
        }

        String canonicalSchema = ToolSchemaFingerprint.canonicalJson(
                objectMapper, command.parametersSchema());
        String fingerprint = ToolSchemaFingerprint.of(objectMapper, canonicalSchema);

        ToolRiskLevel requested = ToolRiskLevel.parse(command.riskLevel());
        ToolRiskLevel risk = requested != null
                ? requested
                : ToolRiskLevel.defaultFromAnnotations(annotations);
        if (ToolRiskLevel.forcedHigh(toolName, command.description())) {
            risk = ToolRiskLevel.HIGH;
        }
        String adminPolicy = command.adminPolicy();
        if (adminPolicy != null && !adminPolicy.isBlank()) {
            String normalized = adminPolicy.trim().toLowerCase(Locale.ROOT);
            if (!ADMIN_POLICIES.contains(normalized)) {
                throw new BusinessException(400, "adminPolicy 仅支持 force-ask/force-allow/deny");
            }
            adminPolicy = normalized;
        } else {
            adminPolicy = null;
        }
        // resumeSafe 默认取 MCP idempotentHint(V34;PRD §6.2.1)
        boolean resumeSafe = command.resumeSafe() != null
                ? command.resumeSafe()
                : Boolean.TRUE.equals(annotations.idempotentHint());

        ToolRegistryEntry entry = existing != null ? existing : new ToolRegistryEntry();
        entry.setAppId(appId);
        entry.setServerKey(serverKey);
        entry.setToolName(toolName);
        entry.setFqn(fqn);
        entry.setDescription(command.description());
        entry.setParametersSchema(canonicalSchema.isEmpty() ? null : canonicalSchema);
        entry.setAnnotationsJson(annotations.rawJson());
        entry.setRiskLevel(risk.code());
        entry.setAdminPolicy(adminPolicy);
        entry.setResumeSafe(resumeSafe);
        entry.setConcurrencySafe(Boolean.TRUE.equals(command.concurrencySafe()));
        entry.setSource(source);
        entry.setEndpointUrl(command.endpointUrl());
        entry.setSchemaSha256(fingerprint);
        entry.setToolVersion(command.toolVersion());
        entry.setRevalidateRequired(false);
        entry.setPendingSchema(null);
        entry.setPendingAnnotationsJson(null);
        entry.setPendingSchemaSha256(null);
        entry.setPendingRefreshAt(null);
        entry.setEnabled(command.enabled() == null || command.enabled());
        entry.setDeleted(false);
        if (existing != null) {
            registryMapper.updateById(entry);
        } else {
            registryMapper.insert(entry);
        }

        recordHistory(entry, null, fingerprint, "unchanged", OUTCOME_APPLIED, "register");
        invalidateCatalog(appId);
        log.info("工具注册: appId={}, fqn={}, risk={}, fingerprint={}",
                appId, fqn, risk.code(), fingerprint);
        return entry;
    }

    // ------------------------------------------------------------------
    // 活刷新分诊(V14)
    // ------------------------------------------------------------------

    /**
     * 宿主重发 schema + 注解 → 分诊:
     * <ul>
     *   <li>unchanged:静默刷新(仅元数据/时间戳);</li>
     *   <li>compatible:立即生效 + 留审计(纯增量,存量授权不受影响);</li>
     *   <li>breaking:不生效;暂存 pending_*,置 revalidate_required=TRUE,
     *       按「安全相关 schema 变更存量授权自动失效」级联失效(PRD §6.2.4),
     *       等待管理员重新确认(/schema/confirm)或拒绝(/schema/reject)。</li>
     * </ul>
     * 运行级快照 pinning(ADR-5)不受影响:进行中运行按快照继续。
     */
    @Transactional
    public SchemaTriageResult refreshSchema(long toolId, String nextSchemaJson,
                                            String nextAnnotationsJson, String toolVersion) {
        ToolRegistryEntry entry = getRequired(toolId);
        long appId = AppContext.currentOrDefault();
        ToolAnnotations previousAnnotations =
                ToolAnnotations.parse(objectMapper, entry.getAnnotationsJson());
        ToolAnnotations nextAnnotations =
                ToolAnnotations.parse(objectMapper, nextAnnotationsJson);

        SchemaTriage triage = triageService.triage(
                entry.getParametersSchema(), previousAnnotations, nextSchemaJson, nextAnnotations);

        String nextCanonical = ToolSchemaFingerprint.canonicalJson(objectMapper, nextSchemaJson);
        String nextFingerprint = ToolSchemaFingerprint.of(objectMapper, nextCanonical);

        switch (triage.verdict()) {
            case UNCHANGED -> {
                // 静默刷新:仅刷新可变元数据,不动指纹与授权
                if (toolVersion != null) {
                    entry.setToolVersion(toolVersion);
                }
                registryMapper.updateById(entry);
                recordHistory(entry, entry.getSchemaSha256(), nextFingerprint,
                        "unchanged", OUTCOME_SILENT_REFRESH, triage.reasons());
            }
            case COMPATIBLE -> {
                entry.setParametersSchema(nextCanonical.isEmpty() ? null : nextCanonical);
                entry.setAnnotationsJson(nextAnnotations.rawJson());
                entry.setSchemaSha256(nextFingerprint);
                if (toolVersion != null) {
                    entry.setToolVersion(toolVersion);
                }
                // 纯增量不撤销授权;resumeSafe 跟随新注解的 idempotentHint
                if (nextAnnotations.idempotentHint() != null) {
                    entry.setResumeSafe(nextAnnotations.idempotentHint());
                }
                registryMapper.updateById(entry);
                recordHistory(entry, null, nextFingerprint,
                        "compatible", OUTCOME_APPLIED, triage.reasons());
                auditService.append(new ToolAuditService.ToolAuditEntry(
                        appId, null, null, null, null, entry.getFqn(),
                        "schema_compatible", ToolDecisionSource.FORCED_POLICY.code(),
                        entry.getRiskLevel(), null,
                        "triage=compatible; reasons=" + triage.reasons(), null, null));
            }
            case BREAKING -> {
                entry.setPendingSchema(nextCanonical.isEmpty() ? null : nextCanonical);
                entry.setPendingAnnotationsJson(nextAnnotations.rawJson());
                entry.setPendingSchemaSha256(nextFingerprint);
                entry.setPendingRefreshAt(LocalDateTime.now());
                entry.setRevalidateRequired(true);
                if (toolVersion != null) {
                    entry.setToolVersion(toolVersion);
                }
                registryMapper.updateById(entry);
                int invalidated = grantService.invalidateByFqn(
                        entry.getFqn(), ToolGrantService.REASON_SCHEMA_BREAKING);
                recordHistory(entry, entry.getSchemaSha256(), nextFingerprint,
                        "breaking", OUTCOME_PENDING_REVIEW, triage.reasons());
                auditService.append(new ToolAuditService.ToolAuditEntry(
                        appId, null, null, null, null, entry.getFqn(),
                        "schema_breaking", ToolDecisionSource.FORCED_POLICY.code(),
                        entry.getRiskLevel(), null,
                        "triage=breaking; reasons=" + triage.reasons()
                                + "; grants_invalidated=" + invalidated, null, null));
            }
            default -> throw new BusinessException(500, "未知分诊档位: " + triage.verdict());
        }
        invalidateCatalog(appId);
        log.info("schema 活刷新分诊: fqn={}, verdict={}, reasons={}",
                entry.getFqn(), triage.verdict(), triage.reasons());
        return new SchemaTriageResult(
                entry, triage.verdict().name().toLowerCase(Locale.ROOT), triage.reasons());
    }

    /**
     * 重新确认通过:应用 BREAKING 暂存 schema(存量授权已在分诊时失效,不复活)。
     */
    @Transactional
    public ToolRegistryEntry confirmPendingSchema(long toolId) {
        ToolRegistryEntry entry = getRequired(toolId);
        if (!Boolean.TRUE.equals(entry.getRevalidateRequired())
                || entry.getPendingSchemaSha256() == null) {
            throw new BusinessException(400, "该工具没有待重新确认的 schema 变更");
        }
        long appId = AppContext.currentOrDefault();
        entry.setParametersSchema(entry.getPendingSchema());
        entry.setAnnotationsJson(entry.getPendingAnnotationsJson());
        entry.setSchemaSha256(entry.getPendingSchemaSha256());
        ToolAnnotations applied = ToolAnnotations.parse(objectMapper, entry.getPendingAnnotationsJson());
        if (applied.idempotentHint() != null) {
            entry.setResumeSafe(applied.idempotentHint());
        }
        entry.setPendingSchema(null);
        entry.setPendingAnnotationsJson(null);
        entry.setPendingSchemaSha256(null);
        entry.setPendingRefreshAt(null);
        entry.setRevalidateRequired(false);
        registryMapper.updateById(entry);
        recordHistory(entry, null, entry.getSchemaSha256(), "breaking", OUTCOME_APPLIED,
                List.of("revalidate_confirmed"));
        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId, null, null, null, null, entry.getFqn(),
                "schema_revalidated", ToolDecisionSource.FORCED_POLICY.code(),
                entry.getRiskLevel(), null,
                "breaking schema applied after re-confirmation", null, null));
        invalidateCatalog(appId);
        return entry;
    }

    /**
     * 拒绝待确认变更:丢弃暂存,保持旧 schema 生效,清除标记。
     */
    @Transactional
    public ToolRegistryEntry rejectPendingSchema(long toolId) {
        ToolRegistryEntry entry = getRequired(toolId);
        if (!Boolean.TRUE.equals(entry.getRevalidateRequired())) {
            throw new BusinessException(400, "该工具没有待重新确认的 schema 变更");
        }
        long appId = AppContext.currentOrDefault();
        String rejectedSha = entry.getPendingSchemaSha256();
        entry.setPendingSchema(null);
        entry.setPendingAnnotationsJson(null);
        entry.setPendingSchemaSha256(null);
        entry.setPendingRefreshAt(null);
        entry.setRevalidateRequired(false);
        registryMapper.updateById(entry);
        recordHistory(entry, entry.getSchemaSha256(), rejectedSha, "breaking", OUTCOME_REJECTED,
                List.of("revalidate_rejected"));
        invalidateCatalog(appId);
        return entry;
    }

    // ------------------------------------------------------------------
    // 元数据更新 / 启停 / 注销 / 查询
    // ------------------------------------------------------------------

    /** 更新治理元数据:风险等级(高危关键词不可下调)、管理员策略、resumeSafe、并发安全、启停。 */
    @Transactional
    public ToolRegistryEntry update(long toolId, UpdateCommand command) {
        ToolRegistryEntry entry = getRequired(toolId);
        long appId = AppContext.currentOrDefault();
        if (command.riskLevel() != null && !command.riskLevel().isBlank()) {
            ToolRiskLevel risk = ToolRiskLevel.parse(command.riskLevel());
            if (risk != ToolRiskLevel.HIGH
                    && ToolRiskLevel.forcedHigh(entry.getToolName(), entry.getDescription())) {
                throw new BusinessException(400,
                        "删除/资金/凭据类工具强制高危,不可下调: " + entry.getToolName());
            }
            boolean upgraded = risk.ordinal() > ToolRiskLevel.parse(entry.getRiskLevel()).ordinal();
            entry.setRiskLevel(risk.code());
            if (upgraded) {
                // 工具风险升级:存量「总是允许」授权自动失效(PRD §6.2.2 确认优先级)
                int invalidated = grantService.invalidateByFqn(
                        entry.getFqn(), ToolGrantService.REASON_RISK_UPGRADE);
                auditService.append(new ToolAuditService.ToolAuditEntry(
                        appId, null, null, null, null, entry.getFqn(),
                        "risk_upgraded", ToolDecisionSource.FORCED_POLICY.code(),
                        risk.code(), null, "grants_invalidated=" + invalidated, null, null));
            }
        }
        if (command.adminPolicy() != null) {
            String normalized = command.adminPolicy().trim().toLowerCase(Locale.ROOT);
            if (normalized.isEmpty()) {
                entry.setAdminPolicy(null);
            } else {
                if (!ADMIN_POLICIES.contains(normalized)) {
                    throw new BusinessException(400, "adminPolicy 仅支持 force-ask/force-allow/deny");
                }
                entry.setAdminPolicy(normalized);
            }
        }
        if (command.resumeSafe() != null) {
            entry.setResumeSafe(command.resumeSafe());
        }
        if (command.concurrencySafe() != null) {
            entry.setConcurrencySafe(command.concurrencySafe());
        }
        if (command.description() != null) {
            entry.setDescription(command.description());
        }
        if (command.toolVersion() != null) {
            entry.setToolVersion(command.toolVersion());
        }
        registryMapper.updateById(entry);
        invalidateCatalog(appId);
        return entry;
    }

    /**
     * 停用:从所有白名单摘除(目录聚合过滤 enabled)并级联清除用户授权
     * (PRD §6.2.1 注销/停用);进行中运行按快照继续,新运行不可见。
     */
    @Transactional
    public ToolRegistryEntry disable(long toolId) {
        ToolRegistryEntry entry = getRequired(toolId);
        long appId = AppContext.currentOrDefault();
        entry.setEnabled(false);
        registryMapper.updateById(entry);
        grantService.invalidateByFqn(entry.getFqn(), ToolGrantService.REASON_TOOL_DISABLED);
        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId, null, null, null, null, entry.getFqn(),
                "tool_disabled", ToolDecisionSource.FORCED_POLICY.code(),
                entry.getRiskLevel(), null, null, null, null));
        invalidateCatalog(appId);
        return entry;
    }

    @Transactional
    public ToolRegistryEntry enable(long toolId) {
        ToolRegistryEntry entry = getRequired(toolId);
        entry.setEnabled(true);
        registryMapper.updateById(entry);
        invalidateCatalog(AppContext.currentOrDefault());
        return entry;
    }

    /**
     * 注销(逻辑删除)+ 级联清除该工具的全部用户授权(PRD §6.2.1)。
     */
    @Transactional
    public void delete(long toolId) {
        ToolRegistryEntry entry = getRequired(toolId);
        long appId = AppContext.currentOrDefault();
        grantService.invalidateByFqn(entry.getFqn(), ToolGrantService.REASON_TOOL_DELETED);
        registryMapper.deleteById(toolId);
        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId, null, null, null, null, entry.getFqn(),
                "tool_deleted", ToolDecisionSource.FORCED_POLICY.code(),
                entry.getRiskLevel(), null, null, null, null));
        invalidateCatalog(appId);
        log.info("工具注销: appId={}, fqn={}", appId, entry.getFqn());
    }

    public ToolRegistryEntry getRequired(long toolId) {
        ToolRegistryEntry entry = registryMapper.selectById(toolId);
        if (entry == null) {
            throw new BusinessException(404, "工具不存在: " + toolId);
        }
        return entry;
    }

    public List<ToolRegistryEntry> list(String serverKey, Boolean enabled) {
        LambdaQueryWrapper<ToolRegistryEntry> query = new LambdaQueryWrapper<ToolRegistryEntry>()
                .orderByAsc(ToolRegistryEntry::getServerKey)
                .orderByAsc(ToolRegistryEntry::getToolName);
        if (serverKey != null && !serverKey.isBlank()) {
            query.eq(ToolRegistryEntry::getServerKey, serverKey.trim());
        }
        if (enabled != null) {
            query.eq(ToolRegistryEntry::getEnabled, enabled);
        }
        return registryMapper.selectList(query);
    }

    public List<ToolRegistryEntry> listEnabled() {
        return registryMapper.selectList(new LambdaQueryWrapper<ToolRegistryEntry>()
                .eq(ToolRegistryEntry::getEnabled, true)
                .orderByAsc(ToolRegistryEntry::getFqn));
    }

    /** schema 指纹变更历史(按工具,时间正序)。 */
    public List<ToolSchemaHistory> history(long toolId) {
        ToolRegistryEntry entry = getRequired(toolId);
        return historyMapper.selectList(new LambdaQueryWrapper<ToolSchemaHistory>()
                .eq(ToolSchemaHistory::getFqn, entry.getFqn())
                .orderByAsc(ToolSchemaHistory::getId));
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    /** 确定性 FQN:mcp__&lt;serverKey&gt;__&lt;toolName&gt;(V25)。 */
    public static String fqnOf(String serverKey, String toolName) {
        return FQN_PREFIX + serverKey + "__" + toolName;
    }

    /** 从 FQN 解析工具名(mcp__&lt;serverKey&gt;__&lt;toolName&gt; → toolName)。 */
    public static String toolNameOf(String fqn) {
        Objects.requireNonNull(fqn, "fqn must not be null");
        int marker = fqn.indexOf("__", FQN_PREFIX.length());
        return marker < 0 ? fqn : fqn.substring(marker + 2);
    }

    private void recordHistory(ToolRegistryEntry entry, String previousSha, String newSha,
                               String triage, String outcome, Object detail) {
        ToolSchemaHistory row = new ToolSchemaHistory();
        row.setAppId(AppContext.currentOrDefault());
        row.setToolId(entry.getId());
        row.setFqn(entry.getFqn());
        row.setPreviousSha256(previousSha);
        row.setNewSha256(newSha);
        row.setTriage(triage);
        row.setOutcome(outcome);
        row.setActor("admin");
        row.setDetail(detail == null ? null : String.valueOf(detail));
        historyMapper.insert(row);
    }

    private void invalidateCatalog(long appId) {
        ToolCatalogInvalidator invalidator = catalogInvalidators.getIfAvailable();
        if (invalidator != null) {
            invalidator.invalidate(appId);
        }
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new BusinessException(400, field + " 不能为空");
        }
        return value.trim();
    }

    /** 注册命令(admin API VO → 服务层;schema/注解以原始 JSON 字符串传入)。 */
    public record RegisterCommand(
            String serverKey,
            String toolName,
            String description,
            String parametersSchema,
            String annotationsJson,
            String riskLevel,
            String adminPolicy,
            Boolean resumeSafe,
            Boolean concurrencySafe,
            String source,
            String endpointUrl,
            String toolVersion,
            Boolean enabled) {
    }

    /** 元数据更新命令(null=不修改)。 */
    public record UpdateCommand(
            String description,
            String riskLevel,
            String adminPolicy,
            Boolean resumeSafe,
            Boolean concurrencySafe,
            String toolVersion) {
    }

    /** 活刷新分诊结果。 */
    public record SchemaTriageResult(
            ToolRegistryEntry entry,
            String verdict,
            List<String> reasons) {
    }
}
