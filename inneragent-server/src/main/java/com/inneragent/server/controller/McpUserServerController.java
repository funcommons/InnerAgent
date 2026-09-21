package com.inneragent.server.controller;

import com.inneragent.agent.entity.McpUserServer;
import com.inneragent.agent.mcp.McpThirdPartyServerSupport;
import com.inneragent.agent.mcp.McpUserServerService;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.context.AppContext;
import com.inneragent.server.controller.vo.McpServerRespVO;
import com.inneragent.server.controller.vo.McpServerSaveReqVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static com.inneragent.platform.common.CommonResult.success;
import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * 用户级三方 MCP 服务器 API(P4-W13;PRD M2,03-开发计划 §7.1 W13)。
 *
 * <p>路由 {@code /ia/api/v1/mcp-servers};embed token 认证链
 * ({@code requireCurrentUserId()},同 /ia/api/v1/me 先例)。行级 userId 隔离
 * ——他人不可见/不可操作;用户自接 endpoint 拒绝本机/内网地址(防 SSRF)。
 * 与 {@code /ia/api/v1/me/mcp}(AgentConfigurationController,AgentScope
 * 内核路径的用户 MCP)并存:本控制器是工具中枢路径的用户三方域。
 */
@Tag(name = "三方 MCP 服务器(用户面)")
@RestController
@RequestMapping("/ia/api/v1/mcp-servers")
@RequiredArgsConstructor
public class McpUserServerController {

    private final McpUserServerService userServerService;

    @PostMapping
    @Operation(summary = "注册本人的三方 MCP 服务器(防 SSRF/OAUTH 即 501)")
    public CommonResult<McpServerRespVO> register(
            @Valid @RequestBody McpServerSaveReqVO request) {
        return success(McpServerRespVO.of(
                userServerService.register(scope(), userId(), toUpsert(request))));
    }

    @GetMapping
    @Operation(summary = "本人的三方 MCP 服务器列表(行级隔离,含停用)")
    public CommonResult<List<McpServerRespVO>> list() {
        return success(userServerService.list(scope(), userId()).stream()
                .map(McpServerRespVO::of)
                .toList());
    }

    @GetMapping("/{id}")
    @Operation(summary = "本人的三方 MCP 服务器详情")
    public CommonResult<McpServerRespVO> get(@PathVariable long id) {
        return success(McpServerRespVO.of(userServerService.requireOwned(
                scope(), userId(), id)));
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新本人的三方 MCP 服务器")
    public CommonResult<McpServerRespVO> update(
            @PathVariable long id, @Valid @RequestBody McpServerSaveReqVO request) {
        return success(McpServerRespVO.of(userServerService.update(
                scope(), userId(), id, toUpsert(request))));
    }

    @PostMapping("/{id}/enable")
    @Operation(summary = "启用")
    public CommonResult<McpServerRespVO> enable(@PathVariable long id) {
        return success(McpServerRespVO.of(userServerService.setEnabled(
                scope(), userId(), id, true)));
    }

    @PostMapping("/{id}/disable")
    @Operation(summary = "停用(从本人目录摘除其全部三方工具)")
    public CommonResult<McpServerRespVO> disable(@PathVariable long id) {
        return success(McpServerRespVO.of(userServerService.setEnabled(
                scope(), userId(), id, false)));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除本人的三方 MCP 服务器")
    public CommonResult<Boolean> delete(@PathVariable long id) {
        userServerService.delete(scope(), userId(), id);
        return success(true);
    }

    // ------------------------------------------------------------------

    private static long scope() {
        return AppContext.currentOrDefault();
    }

    private static long userId() {
        return requireCurrentUserId();
    }

    private static McpThirdPartyServerSupport.Upsert toUpsert(McpServerSaveReqVO request) {
        return new McpThirdPartyServerSupport.Upsert(
                request.serverKey(), request.name(), request.endpointUrl(),
                request.transport(), request.authType(), request.headerName(),
                request.credentials(), request.timeoutSeconds(), request.enabled());
    }
}
