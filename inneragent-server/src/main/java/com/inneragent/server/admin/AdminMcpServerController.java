package com.inneragent.server.admin;

import com.inneragent.agent.entity.McpServerConfig;
import com.inneragent.agent.mcp.McpAppServerService;
import com.inneragent.agent.mcp.McpThirdPartyServerSupport;
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

/**
 * 应用级三方 MCP 服务器 admin API(P4-W13;PRD M2,03-开发计划 §7.1 W13)。
 *
 * <p>路由 {@code /ia/api/v1/admin/mcp-servers};由 {@link AdminTokenFilter}
 * 保护(X-IA-Admin-Key),与 embed token 体系隔离(守卫先例同
 * AdminToolController)。注册/更新/启停/删除即失效工具清单 LRU 缓存与目录
 * 快照;serverKey 防遮蔽冲突域校验见 {@link McpAppServerService};credentials
 * 响应永为打码形。
 */
@Tag(name = "三方 MCP 服务器(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/mcp-servers")
@RequiredArgsConstructor
public class AdminMcpServerController {

    private final McpAppServerService appServerService;

    @PostMapping
    @Operation(summary = "注册三方 MCP 服务器(serverKey 防遮蔽/OAUTH 即 501)")
    public CommonResult<McpServerRespVO> register(
            @Valid @RequestBody McpServerSaveReqVO request) {
        return success(McpServerRespVO.of(appServerService.register(toUpsert(request))));
    }

    @GetMapping
    @Operation(summary = "三方 MCP 服务器列表(含停用)")
    public CommonResult<List<McpServerRespVO>> list() {
        return success(appServerService.list(AppContext.currentOrDefault()).stream()
                .map(McpServerRespVO::of)
                .toList());
    }

    @GetMapping("/{id}")
    @Operation(summary = "三方 MCP 服务器详情")
    public CommonResult<McpServerRespVO> get(@PathVariable long id) {
        return success(McpServerRespVO.of(appServerService.requireOwned(
                AppContext.currentOrDefault(), id)));
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新三方 MCP 服务器(端点/静态头/超时等;"
            + "credentials 缺省/null/空串=保持原值,显式非空=覆盖)")
    public CommonResult<McpServerRespVO> update(
            @PathVariable long id, @Valid @RequestBody McpServerSaveReqVO request) {
        return success(McpServerRespVO.of(appServerService.update(
                AppContext.currentOrDefault(), id, toUpsert(request))));
    }

    @PostMapping("/{id}/enable")
    @Operation(summary = "启用")
    public CommonResult<McpServerRespVO> enable(@PathVariable long id) {
        return success(McpServerRespVO.of(appServerService.setEnabled(
                AppContext.currentOrDefault(), id, true)));
    }

    @PostMapping("/{id}/disable")
    @Operation(summary = "停用(目录摘除其全部三方工具)")
    public CommonResult<McpServerRespVO> disable(@PathVariable long id) {
        return success(McpServerRespVO.of(appServerService.setEnabled(
                AppContext.currentOrDefault(), id, false)));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除三方 MCP 服务器")
    public CommonResult<Boolean> delete(@PathVariable long id) {
        appServerService.delete(AppContext.currentOrDefault(), id);
        return success(true);
    }

    private static McpThirdPartyServerSupport.Upsert toUpsert(McpServerSaveReqVO request) {
        return new McpThirdPartyServerSupport.Upsert(
                request.serverKey(), request.name(), request.endpointUrl(),
                request.transport(), request.authType(), request.headerName(),
                request.credentials(), request.timeoutSeconds(), request.enabled());
    }
}
