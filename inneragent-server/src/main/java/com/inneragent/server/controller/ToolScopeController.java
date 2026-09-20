package com.inneragent.server.controller;

import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.toolhub.ResolveScopeOutcome;
import com.inneragent.platform.toolhub.ResolveScopeRequest;
import com.inneragent.platform.toolhub.ResolveScopeService;
import com.inneragent.server.controller.vo.ToolResolveScopeReqVO;
import com.inneragent.server.controller.vo.ToolResolveScopeRespVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * 工具域 REST 端点(P1-T3c 收口裁决:保留为薄 REST 封装)。
 *
 * <p>{@code POST /ia/api/v1/tools/resolve-scope} 包一层
 * {@link ResolveScopeService}(宿主 MCP 反查 + 服务端降级/协议裁决),供宿主
 * (inneragent-starter InnerAgentBridgeClient)在自实现 resolve_scope 工具时
 * 转发反查、或非 MCP 场景预览约束范围。P3 起运行链路以 MCP 通道为正道,
 * 本端点保持薄封装不扩面,若两期无消费者再登记退役。
 *
 * <p>响应为 PRD §6.1.4 协议四数组的裸对象(无 CommonResult 信封,见
 * {@link ToolResolveScopeRespVO});降级原因仅落日志。
 */
@Tag(name = "工具")
@Slf4j
@RestController
@RequestMapping("/ia/api/v1/tools")
@RequiredArgsConstructor
public class ToolScopeController {

    private final ResolveScopeService resolveScopeService;

    @PostMapping("/resolve-scope")
    @Operation(summary = "反查当前上下文的约束范围(resolve_scope)")
    public ToolResolveScopeRespVO resolveScope(
            @RequestBody ToolResolveScopeReqVO request) {
        long userId = requireCurrentUserId();
        long appId = AppContext.currentOrDefault();
        ResolveScopeOutcome outcome = resolveScopeService.resolve(
                appId,
                null,
                new ResolveScopeRequest(
                        request.getPageId(),
                        request.getObjectId(),
                        request.getObjectType(),
                        request.getCustom() == null ? Map.of() : request.getCustom()),
                null);
        if (outcome.degraded()) {
            log.info("resolve_scope REST 反查降级: appId={}, userId={}, reason={}",
                    appId, userId, outcome.degradeReason());
        }
        return new ToolResolveScopeRespVO(
                outcome.visibleDomains(),
                outcome.writableFields(),
                outcome.forbidden(),
                outcome.hints());
    }
}
