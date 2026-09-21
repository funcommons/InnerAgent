package com.inneragent.agent.mcp;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.agent.entity.McpServerConfig;
import com.inneragent.agent.entity.McpUserServer;
import com.inneragent.agent.mapper.McpServerConfigMapper;
import com.inneragent.agent.mapper.McpUserServerMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import com.inneragent.platform.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 应用级三方 MCP 服务器注册服务(V18;PRD M2,03-开发计划 §7.1 W13)。
 *
 * <p>管理面(/ia/api/v1/admin/mcp-servers,X-IA-Admin-Key 守卫)维护:
 * 注册/列表/更新/删除/启停。变更后经 {@link McpThirdPartyConfigInvalidator}
 * 失效工具清单 LRU 缓存与已建客户端,目录下次聚合按新配置拉取。
 *
 * <p><strong>防遮蔽(需求 #3)</strong>:serverKey 冲突域 =
 * ① 应用级本表唯一(uk_ia_mcp_server_config_key);② 宿主注册表
 * ia_tool_registry 同应用内同 serverKey 拒绝(键混用会让 FQN 命名空间
 * 归属歧义);③ 用户级同应用内任意用户已占用同 serverKey 拒绝
 * (invoker 解析应用级优先,键混用会让用户级条目不可达)。
 *
 * <p><strong>审计</strong>:注册/更新/启停/删除落 ia_audit_log
 * (decision 沿用 allowed/denied 域,decisionSource=admin 管理面直接写操作,
 * V16 值域口径);credentials 值绝不进审计/日志。ia_mcp_server_config 为
 * app 级治理表(无 tenant_id 列,同 ia_tool_registry 形态),查询显式携带
 * app_id 并以系统模式执行,免疫租户上下文注入。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class McpAppServerService {

    private final McpServerConfigMapper serverMapper;
    private final McpUserServerMapper userServerMapper;
    private final ToolRegistryMapper registryMapper;
    private final ToolAuditService auditService;
    private final ObjectProvider<McpThirdPartyConfigInvalidator> configInvalidators;

    /** 应用内全量(含停用;管理面列表)。查询显式 app_id + 系统模式双层防串。 */
    public List<McpServerConfig> list(long appId) {
        return TenantContext.runAsSystem(() -> serverMapper.selectList(
                new LambdaQueryWrapper<McpServerConfig>()
                        .eq(McpServerConfig::getAppId, appId)
                        .orderByAsc(McpServerConfig::getServerKey)));
    }

    /** 启用中的服务器(目录聚合/调用定位用)。 */
    public List<McpServerConfig> listEnabled(long appId) {
        return list(appId).stream()
                .filter(server -> Boolean.TRUE.equals(server.getEnabled()))
                .toList();
    }

    public McpServerConfig requireOwned(long appId, long id) {
        McpServerConfig server = TenantContext.runAsSystem(() -> serverMapper.selectById(id));
        if (server == null || !Long.valueOf(appId).equals(server.getAppId())) {
            throw new BusinessException(404, "三方 MCP 服务不存在");
        }
        return server;
    }

    @Transactional
    public McpServerConfig register(McpThirdPartyServerSupport.Upsert request) {
        long appId = AppContext.currentOrDefault();
        McpThirdPartyServerSupport.Normalized normalized =
                McpThirdPartyServerSupport.normalize(request, false);
        requireServerKeyFree(appId, normalized.serverKey());
        McpServerConfig server = McpServerConfig.builder()
                .appId(appId)
                .serverKey(normalized.serverKey())
                .build();
        apply(server, normalized);
        TenantContext.runAsSystem(() -> serverMapper.insert(server));
        audit(appId, server, "allowed", "应用级三方 MCP 服务已注册");
        invalidate();
        log.info("应用级三方 MCP 服务已注册: appId={}, serverKey={}, endpoint={}(凭据不落日志)",
                appId, server.getServerKey(), server.getEndpointUrl());
        return server;
    }

    /**
     * 更新(端点/静态头/超时等整包刷新,credentials 除外)。
     *
     * <p><strong>credentials 空值语义定案(K③)</strong>:null/空串 = 保持
     * 原值(实体保留库中旧值,updateById 写回同值);显式非空 = 覆盖(轮换
     * 即重置)。不提供「清空」语义——STATIC_HEADER 无值即残废,MP updateById
     * 跳 null 列,清空会在库层静默失效(webhook url 教训同族),故语义上
     * 直接不设;撤销凭据请删除该三方服务。
     */
    @Transactional
    public McpServerConfig update(long appId, long id, McpThirdPartyServerSupport.Upsert request) {
        McpServerConfig server = requireOwned(appId, id);
        McpThirdPartyServerSupport.Normalized normalized =
                McpThirdPartyServerSupport.normalize(
                        request, false, McpThirdPartyServerSupport.CredentialsMode.KEEP_IF_ABSENT);
        if (!server.getServerKey().equals(normalized.serverKey())) {
            requireServerKeyFree(appId, normalized.serverKey());
        }
        apply(server, normalized);
        TenantContext.runAsSystem(() -> serverMapper.updateById(server));
        audit(appId, server, "allowed", "应用级三方 MCP 服务已更新");
        invalidate();
        return server;
    }

    @Transactional
    public McpServerConfig setEnabled(long appId, long id, boolean enabled) {
        McpServerConfig server = requireOwned(appId, id);
        server.setEnabled(enabled);
        TenantContext.runAsSystem(() -> serverMapper.updateById(server));
        audit(appId, server, enabled ? "allowed" : "denied",
                (enabled ? "应用级三方 MCP 服务已启用" : "应用级三方 MCP 服务已停用")
                        + "(serverKey=" + server.getServerKey() + ")");
        invalidate();
        return server;
    }

    @Transactional
    public void delete(long appId, long id) {
        McpServerConfig server = requireOwned(appId, id);
        TenantContext.runAsSystem(() -> serverMapper.deleteById(id));
        audit(appId, server, "denied", "应用级三方 MCP 服务已删除(serverKey="
                + server.getServerKey() + ")");
        invalidate();
    }

    // ------------------------------------------------------------------
    // 防遮蔽冲突域 / 变更生效
    // ------------------------------------------------------------------

    /** serverKey 冲突三域:本表(同应用)/ 宿主注册表 / 用户级(同应用任意用户)。 */
    private void requireServerKeyFree(long appId, String serverKey) {
        Long sameApp = TenantContext.runAsSystem(() -> serverMapper.selectCount(
                new LambdaQueryWrapper<McpServerConfig>()
                        .eq(McpServerConfig::getAppId, appId)
                        .eq(McpServerConfig::getServerKey, serverKey)));
        if (sameApp != null && sameApp > 0) {
            throw new BusinessException(409, "serverKey 已被应用级三方 MCP 服务占用: " + serverKey);
        }
        Long hostRows = TenantContext.runAsSystem(() -> registryMapper.selectCount(
                new LambdaQueryWrapper<ToolRegistryEntry>()
                        .eq(ToolRegistryEntry::getAppId, appId)
                        .eq(ToolRegistryEntry::getServerKey, serverKey)));
        if (hostRows != null && hostRows > 0) {
            throw new BusinessException(409,
                    "serverKey 与宿主注册表工具的 serverKey 冲突(防遮蔽): " + serverKey);
        }
        Long userRows = TenantContext.runAsSystem(() -> userServerMapper.selectCount(
                new LambdaQueryWrapper<McpUserServer>()
                        .eq(McpUserServer::getAppId, appId)
                        .eq(McpUserServer::getServerKey, serverKey)));
        if (userRows != null && userRows > 0) {
            throw new BusinessException(409,
                    "serverKey 已被用户级三方 MCP 服务占用(键混用致用户级条目不可达): " + serverKey);
        }
    }

    /** 字段落库(credentials=null = 保持原值,见 {@link #update} 语义定案)。 */
    private void apply(McpServerConfig server, McpThirdPartyServerSupport.Normalized normalized) {
        server.setName(normalized.name());
        server.setEndpointUrl(normalized.endpointUrl());
        server.setTransport(normalized.transport());
        server.setAuthType(normalized.authType());
        server.setHeaderName(normalized.headerName());
        if (normalized.credentials() != null) {
            server.setCredentials(normalized.credentials());
        }
        server.setTimeoutSeconds(normalized.timeoutSeconds());
        server.setEnabled(normalized.enabled());
    }

    /** 配置变更 → 全部失效实现(清单 LRU + 目录快照 + 已建客户端)依次触发。 */
    private void invalidate() {
        configInvalidators.orderedStream()
                .forEach(McpThirdPartyConfigInvalidator::invalidateThirdPartyConfigs);
    }

    /**
     * 管理面变更审计(decision 沿用 allowed/denied 域;source=admin 管理面直接
     * 写操作,V16 值域,不含凭据值)。注册/更新 allowed;删除/停用 denied——
     * 语义为「该 serverKey 的工具对目录的可用性裁决」。
     */
    private void audit(long appId, McpServerConfig server, String decision, String summary) {
        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId, null, null, null, null,
                "mcp__" + server.getServerKey(),
                decision,
                ToolDecisionSource.ADMIN.code(),
                null,
                null,
                summary + "(authType=" + server.getAuthType() + ";凭据不落审计)",
                null,
                null));
    }
}
