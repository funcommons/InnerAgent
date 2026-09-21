package com.inneragent.platform.toolhub;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.toolhub.mapper.ToolGrantMapper;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * 用户工具授权服务(ia_tool_grant;PRD §6.2.4,04-调研 V18)。
 *
 * <p>作用域:permanent(总是允许,不过期,业界无 TTL 先例)与
 * conversation(本会话允许,随会话结束失效)。授权快照授予时的风险等级与
 * schema 指纹;风险升级/安全 schema 变更/工具停用注销时按工具 FQN
 * 级联自动失效(invalidated=TRUE,区别于 deleted 主动撤销)。
 * 所有授撤销变更落 ia_audit_log(V22)。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ToolGrantService {

    public static final String SCOPE_PERMANENT = "permanent";
    public static final String SCOPE_CONVERSATION = "conversation";
    private static final Set<String> SCOPES = Set.of(SCOPE_PERMANENT, SCOPE_CONVERSATION);

    public static final String SOURCE_ADMIN = "admin";

    /** 分页每页上限(对齐 PageParam/审计检索惯例)。 */
    static final int MAX_PAGE_SIZE = 100;

    static final String REASON_RISK_UPGRADE = "risk_upgrade";
    static final String REASON_SCHEMA_BREAKING = "schema_breaking";
    static final String REASON_TOOL_DISABLED = "tool_disabled";
    static final String REASON_TOOL_DELETED = "tool_deleted";

    private final ToolGrantMapper grantMapper;
    private final ToolRegistryMapper registryMapper;
    private final ToolAuditService auditService;

    /**
     * 授予授权(appId+toolName+scope+决策记录;授权是确认策略的输入)。
     */
    @Transactional
    public ToolGrant grant(long userId, String toolName, String scope,
                           String conversationId, String decisionNote) {
        String normalizedScope = normalizeScope(scope);
        if (SCOPE_PERMANENT.equals(normalizedScope) && conversationId != null && !conversationId.isBlank()) {
            throw new BusinessException(400, "permanent 授权不携带会话 ID");
        }
        if (SCOPE_CONVERSATION.equals(normalizedScope)
                && (conversationId == null || conversationId.isBlank())) {
            throw new BusinessException(400, "conversation 授权必须携带会话 ID");
        }
        ToolRegistryEntry tool = requireActiveTool(toolName);
        long appId = AppContext.currentOrDefault();

        ToolGrant duplicate = grantMapper.selectActiveByUserAndFqn(userId, tool.getFqn()).stream()
                .filter(existing -> Objects.equals(
                        blankToNull(conversationId), existing.getConversationId())
                        || (SCOPE_PERMANENT.equals(normalizedScope)
                            && SCOPE_PERMANENT.equals(existing.getScope())))
                .findFirst()
                .orElse(null);
        if (duplicate != null) {
            throw new BusinessException(409, "该用户对此工具已存在同作用域的有效授权");
        }

        ToolGrant grantRow = new ToolGrant();
        grantRow.setAppId(appId);
        grantRow.setUserId(userId);
        grantRow.setToolFqn(tool.getFqn());
        grantRow.setScope(normalizedScope);
        grantRow.setConversationId(blankToNull(conversationId));
        grantRow.setRiskAtGrant(tool.getRiskLevel());
        grantRow.setSchemaSha256(tool.getSchemaSha256());
        grantRow.setSource(SOURCE_ADMIN);
        grantRow.setInvalidated(false);
        grantRow.setDecisionNote(decisionNote);
        try {
            grantMapper.insert(grantRow);
        } catch (DuplicateKeyException conflict) {
            // DEF-04:并发窗口下撞活跃行部分唯一索引(uk_ia_tool_grant_active)
            // → 409 业务语义,不再裸 DataIntegrityViolationException → 500
            throw new BusinessException(409, "该用户对此工具已存在同作用域的有效授权");
        }

        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId, null, userId, blankToNull(conversationId), null,
                tool.getFqn(), "granted", ToolDecisionSource.USER_GRANT.code(),
                tool.getRiskLevel(), null,
                "scope=" + normalizedScope + (decisionNote == null ? "" : "; note=" + decisionNote),
                null, null));
        log.info("工具授权授予: appId={}, userId={}, fqn={}, scope={}",
                appId, userId, tool.getFqn(), normalizedScope);
        return grantRow;
    }

    /**
     * 撤销授权(逻辑删除;SDK 配置页/管理站逐条撤销,V18)。
     * 注意:@TableLogic 下 deleteById 生成 UPDATE ... SET deleted=TRUE。
     */
    @Transactional
    public void revoke(long grantId, String note) {
        ToolGrant grantRow = grantMapper.selectById(grantId);
        if (grantRow == null) {
            throw new BusinessException(404, "授权不存在: " + grantId);
        }
        grantMapper.deleteById(grantId);
        auditService.append(new ToolAuditService.ToolAuditEntry(
                grantRow.getAppId(), null, grantRow.getUserId(), grantRow.getConversationId(),
                null, grantRow.getToolFqn(), "revoked", ToolDecisionSource.USER_GRANT.code(),
                grantRow.getRiskAtGrant(), null,
                "grantId=" + grantId + (note == null ? "" : "; note=" + note), null, null));
        log.info("工具授权撤销: grantId={}, fqn={}", grantId, grantRow.getToolFqn());
    }

    /**
     * 按工具 FQN 级联自动失效(风险升级/安全 schema 变更/停用/注销)。
     *
     * @return 失效条数
     */
    @Transactional
    public int invalidateByFqn(String toolFqn, String reason) {
        List<ToolGrant> active = grantMapper.selectActiveByFqn(toolFqn);
        for (ToolGrant grantRow : active) {
            grantRow.setInvalidated(true);
            grantRow.setInvalidatedReason(reason);
            grantMapper.updateById(grantRow);
            auditService.append(new ToolAuditService.ToolAuditEntry(
                    grantRow.getAppId(), null, grantRow.getUserId(), grantRow.getConversationId(),
                    null, toolFqn, "invalidated", ToolDecisionSource.FORCED_POLICY.code(),
                    grantRow.getRiskAtGrant(), null, "reason=" + reason, null, null));
        }
        if (!active.isEmpty()) {
            log.info("工具授权级联失效: fqn={}, reason={}, count={}", toolFqn, reason, active.size());
        }
        return active.size();
    }

    /**
     * 用户的永久授权 FQN 集合(确认档位映射输入:DEFAULT 模式下写操作免确认依据)。
     */
    public Set<String> activePermanentFqns(long userId) {
        return grantMapper.selectActivePermanentByUser(userId).stream()
                .map(ToolGrant::getToolFqn)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    /** 授权列表(按应用/工具/用户过滤;active=true 仅有效授权)。 */
    public List<ToolGrant> list(Long userId, String toolName, String scope, boolean activeOnly) {
        LambdaQueryWrapper<ToolGrant> query = new LambdaQueryWrapper<ToolGrant>()
                .orderByDesc(ToolGrant::getId);
        if (userId != null) {
            query.eq(ToolGrant::getUserId, userId);
        }
        if (scope != null && !scope.isBlank()) {
            query.eq(ToolGrant::getScope, normalizeScope(scope));
        }
        if (toolName != null && !toolName.isBlank()) {
            ToolRegistryEntry tool = registryMapper.selectActiveByToolName(toolName.trim());
            if (tool == null) {
                return List.of();
            }
            query.eq(ToolGrant::getToolFqn, tool.getFqn());
        }
        List<ToolGrant> rows = grantMapper.selectList(query);
        return activeOnly
                ? rows.stream()
                        .filter(row -> !Boolean.TRUE.equals(row.getDeleted())
                                && !Boolean.TRUE.equals(row.getInvalidated()))
                        .toList()
                : rows;
    }

    /**
     * 授权列表分页(P2-W5:与 {@link #list} 同过滤同排序;activeOnly 下推为
     * SQL 条件 invalidated=FALSE(deleted 由 @TableLogic 自动过滤),使分页
     * 计数与内存过滤一致。端点缺省(无 pageNo/pageSize)仍走全量 list,
     * 向后兼容)。
     */
    public Page<ToolGrant> page(Long userId, String toolName, String scope,
                                boolean activeOnly, int pageNo, int pageSize) {
        LambdaQueryWrapper<ToolGrant> query = new LambdaQueryWrapper<ToolGrant>()
                .orderByDesc(ToolGrant::getId);
        if (userId != null) {
            query.eq(ToolGrant::getUserId, userId);
        }
        if (scope != null && !scope.isBlank()) {
            query.eq(ToolGrant::getScope, normalizeScope(scope));
        }
        if (toolName != null && !toolName.isBlank()) {
            ToolRegistryEntry tool = registryMapper.selectActiveByToolName(toolName.trim());
            if (tool == null) {
                // 与 list 同语义:工具未知=空结果(非错误)
                return new Page<>(pageNo, pageSize);
            }
            query.eq(ToolGrant::getToolFqn, tool.getFqn());
        }
        if (activeOnly) {
            query.eq(ToolGrant::getInvalidated, false);
        }
        return grantMapper.selectPage(
                new Page<>(Math.max(pageNo, 1),
                        Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE)),
                query);
    }

    private ToolRegistryEntry requireActiveTool(String toolName) {
        if (toolName == null || toolName.isBlank()) {
            throw new BusinessException(400, "toolName 不能为空");
        }
        ToolRegistryEntry tool = registryMapper.selectActiveByToolName(toolName.trim());
        if (tool == null) {
            throw new BusinessException(404, "工具未注册: " + toolName);
        }
        if (!Boolean.TRUE.equals(tool.getEnabled())) {
            throw new BusinessException(400, "工具已停用,不能授予: " + toolName);
        }
        return tool;
    }

    private static String normalizeScope(String scope) {
        if (scope == null || scope.isBlank()) {
            throw new BusinessException(400, "scope 不能为空(conversation/permanent)");
        }
        String normalized = scope.trim().toLowerCase(Locale.ROOT);
        if (!SCOPES.contains(normalized)) {
            throw new BusinessException(400, "scope 仅支持 conversation/permanent: " + scope);
        }
        return normalized;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
