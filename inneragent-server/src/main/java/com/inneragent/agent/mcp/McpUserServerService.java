package com.inneragent.agent.mcp;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.agent.entity.McpServerConfig;
import com.inneragent.agent.entity.McpUserServer;
import com.inneragent.agent.mapper.McpServerConfigMapper;
import com.inneragent.agent.mapper.McpUserServerMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 用户级三方 MCP 服务器注册服务(V18;PRD M2,03-开发计划 §7.1 W13)。
 *
 * <p>用户面(/ia/api/v1/mcp-servers,embed token 链 requireCurrentUserId)
 * 维护:注册/列表/更新/删除/启停。行级 userId 隔离——他人不可见/不可调用
 * (所有查询/归属校验显式 (appId, userId) 双条件,唯一键
 * uk_ia_mcp_user_server_key 同口径)。
 *
 * <p><strong>防遮蔽</strong>:serverKey 冲突域 =
 * ① 本用户内唯一;② 应用级本表(键混用会因应用级优先解析而不可达);
 * ③ 宿主注册表同应用内同 serverKey。与 AgentMcpServerService(内核路径
 * 用户 MCP,互不相干)并存:本服务是工具中枢路径的用户三方域。
 *
 * <p>用户自接 endpoint 拒绝本机/内网地址(防 SSRF,与
 * AgentMcpServerService 同口径);变更经 {@link McpThirdPartyConfigInvalidator}
 * 失效缓存。用户级配置 CRUD 不落 ia_audit_log(对齐存量用户 MCP 先例——
 * ia_audit_log 为工具裁决语义;目录聚合层的遮蔽丢弃会在 Step 3 落审计)。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class McpUserServerService {

    /** 每用户最多注册的三方 MCP 服务器数(对齐 AgentMcpServerService 护栏)。 */
    static final int MAX_SERVERS_PER_USER = 32;

    private final McpUserServerMapper serverMapper;
    private final McpServerConfigMapper appServerMapper;
    private final ToolRegistryMapper registryMapper;
    private final ObjectProvider<McpThirdPartyConfigInvalidator> configInvalidators;

    /** 本用户全量(含停用)。appId+userId 双条件行级隔离。 */
    public List<McpUserServer> list(long appId, long userId) {
        return serverMapper.selectList(new LambdaQueryWrapper<McpUserServer>()
                .eq(McpUserServer::getAppId, appId)
                .eq(McpUserServer::getUserId, userId)
                .orderByAsc(McpUserServer::getServerKey));
    }

    /** 本用户启用中的服务器(目录聚合/调用定位用)。 */
    public List<McpUserServer> listEnabled(long appId, long userId) {
        return list(appId, userId).stream()
                .filter(server -> Boolean.TRUE.equals(server.getEnabled()))
                .toList();
    }

    /** 归属校验:非本人行一律 404(不泄露存在性)。 */
    public McpUserServer requireOwned(long appId, long userId, long id) {
        McpUserServer server = serverMapper.selectById(id);
        if (server == null
                || !Long.valueOf(appId).equals(server.getAppId())
                || !Long.valueOf(userId).equals(server.getUserId())) {
            throw new BusinessException(404, "三方 MCP 服务不存在");
        }
        return server;
    }

    @Transactional
    public McpUserServer register(long appId, long userId, McpThirdPartyServerSupport.Upsert request) {
        McpThirdPartyServerSupport.Normalized normalized =
                McpThirdPartyServerSupport.normalize(request, true);
        if (list(appId, userId).size() >= MAX_SERVERS_PER_USER) {
            throw new BusinessException(400, "每个用户最多注册 " + MAX_SERVERS_PER_USER + " 个三方 MCP 服务");
        }
        requireServerKeyFree(appId, userId, normalized.serverKey());
        McpUserServer server = McpUserServer.builder()
                .appId(appId)
                .userId(userId)
                .serverKey(normalized.serverKey())
                .build();
        apply(server, normalized);
        serverMapper.insert(server);
        invalidate();
        log.info("用户级三方 MCP 服务已注册: appId={}, userId={}, serverKey={}(凭据不落日志)",
                appId, userId, server.getServerKey());
        return server;
    }

    @Transactional
    public McpUserServer update(long appId, long userId, long id,
                                McpThirdPartyServerSupport.Upsert request) {
        McpUserServer server = requireOwned(appId, userId, id);
        McpThirdPartyServerSupport.Normalized normalized =
                McpThirdPartyServerSupport.normalize(request, true);
        if (!server.getServerKey().equals(normalized.serverKey())) {
            requireServerKeyFree(appId, userId, normalized.serverKey());
        }
        apply(server, normalized);
        serverMapper.updateById(server);
        invalidate();
        return server;
    }

    @Transactional
    public McpUserServer setEnabled(long appId, long userId, long id, boolean enabled) {
        McpUserServer server = requireOwned(appId, userId, id);
        server.setEnabled(enabled);
        serverMapper.updateById(server);
        invalidate();
        return server;
    }

    @Transactional
    public void delete(long appId, long userId, long id) {
        McpUserServer server = requireOwned(appId, userId, id);
        serverMapper.deleteById(id);
        invalidate();
    }

    // ------------------------------------------------------------------
    // 防遮蔽冲突域 / 变更生效
    // ------------------------------------------------------------------

    /** serverKey 冲突三域:本用户 / 应用级本表 / 宿主注册表(同应用)。 */
    private void requireServerKeyFree(long appId, long userId, String serverKey) {
        Long sameUser = serverMapper.selectCount(new LambdaQueryWrapper<McpUserServer>()
                .eq(McpUserServer::getAppId, appId)
                .eq(McpUserServer::getUserId, userId)
                .eq(McpUserServer::getServerKey, serverKey));
        if (sameUser != null && sameUser > 0) {
            throw new BusinessException(409, "serverKey 已被你注册的三方 MCP 服务占用: " + serverKey);
        }
        Long appRows = asSystem(() -> appServerMapper.selectCount(
                new LambdaQueryWrapper<McpServerConfig>()
                        .eq(McpServerConfig::getAppId, appId)
                        .eq(McpServerConfig::getServerKey, serverKey)));
        if (appRows != null && appRows > 0) {
            throw new BusinessException(409, "serverKey 已被应用级三方 MCP 服务占用: " + serverKey);
        }
        Long hostRows = asSystem(() -> registryMapper.selectCount(
                new LambdaQueryWrapper<ToolRegistryEntry>()
                        .eq(ToolRegistryEntry::getAppId, appId)
                        .eq(ToolRegistryEntry::getServerKey, serverKey)));
        if (hostRows != null && hostRows > 0) {
            throw new BusinessException(409,
                    "serverKey 与宿主注册表工具的 serverKey 冲突(防遮蔽): " + serverKey);
        }
    }

    private void apply(McpUserServer server, McpThirdPartyServerSupport.Normalized normalized) {
        server.setName(normalized.name());
        server.setEndpointUrl(normalized.endpointUrl());
        server.setTransport(normalized.transport());
        server.setAuthType(normalized.authType());
        server.setHeaderName(normalized.headerName());
        server.setCredentials(normalized.credentials());
        server.setTimeoutSeconds(normalized.timeoutSeconds());
        server.setEnabled(normalized.enabled());
    }

    private void invalidate() {
        configInvalidators.orderedStream()
                .forEach(McpThirdPartyConfigInvalidator::invalidateThirdPartyConfigs);
    }

    /** 应用级治理表(无 tenant_id 列)读取的系统模式包裹(免疫租户上下文注入)。 */
    private static <T> T asSystem(java.util.function.Supplier<T> action) {
        return com.inneragent.platform.tenant.TenantContext.runAsSystem(action);
    }
}
