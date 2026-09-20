package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.toolhub.ToolGrant;
import com.inneragent.platform.toolhub.ToolGrantService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 工具授权管理 admin API(P1-T2a;PRD §6.2.4/V18)。
 *
 * <p>路由 {@code /ia/api/v1/admin/grants};授权(appId+toolName+scope+决策记录)
 * 是内核确认档位映射的输入:DEFAULT 模式下用户的 permanent 授权使写操作
 * 免确认(decision_source=user-grant)。授予/撤销均落 ia_audit_log。
 */
@Tag(name = "工具授权(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/grants")
@RequiredArgsConstructor
@Validated
public class AdminGrantController {

    private final ToolGrantService toolGrantService;

    public record GrantToolReqVO(
            @NotNull Long userId,
            @NotBlank String toolName,
            @NotBlank String scope,
            String conversationId,
            String decisionNote) {
    }

    public record RevokeGrantReqVO(String decisionNote) {
    }

    @PostMapping
    @Operation(summary = "授予授权(快照风险级/schema 指纹,落审计)")
    public CommonResult<ToolGrant> grant(@Validated @RequestBody GrantToolReqVO request) {
        return success(toolGrantService.grant(
                request.userId(),
                request.toolName(),
                request.scope(),
                request.conversationId(),
                request.decisionNote()));
    }

    @GetMapping
    @Operation(summary = "授权列表(userId/toolName/scope/activeOnly 过滤)")
    public CommonResult<List<ToolGrant>> list(
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String toolName,
            @RequestParam(required = false) String scope,
            @RequestParam(name = "activeOnly", required = false, defaultValue = "true")
            boolean activeOnly) {
        return success(toolGrantService.list(userId, toolName, scope, activeOnly));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "撤销授权(逻辑删除,落审计)")
    public CommonResult<Boolean> revoke(
            @PathVariable long id,
            @org.springframework.web.bind.annotation.RequestBody(
                    required = false) RevokeGrantReqVO request) {
        toolGrantService.revoke(id, request == null ? null : request.decisionNote());
        return success(true);
    }
}
