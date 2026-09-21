package com.inneragent.server.admin;

import com.inneragent.platform.circuit.CircuitBreakerLimits;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.server.admin.CircuitBreakerAdminService.CircuitEventView;
import com.inneragent.server.admin.CircuitBreakerAdminService.StateView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 熔断与资源上限 admin API(优化建议 #2 服务端半;mock 契约
 * handlers.ts circuitHandlers 为产品契约锚点,路径/方法/请求/响应形状
 * 逐条对齐):GET /circuit-breaker、PUT /limits、POST /emergency-stop、
 * POST /resume、POST /terminate-run,落位 /ia/api/v1/admin/*,由
 * {@link AdminTokenFilter} 双轨守卫(Bearer 管理会话 / X-IA-Admin-Key)。
 *
 * <p>appId 语义:mock 为全局单应用形;服务端按应用级落库(ia_app 行),
 * 单应用部署缺省 1,多应用部署可用 {@code appId} 查询参数定位(附加参数,
 * web 单应用形不受影响)。
 */
@Tag(name = "熔断与资源上限(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/circuit-breaker")
@RequiredArgsConstructor
@Validated
public class AdminCircuitBreakerController {

    private final CircuitBreakerAdminService circuitService;

    @GetMapping
    @Operation(summary = "熔断状态(总开关/limits/活跃 run 数/最近 20 条事件)")
    public CommonResult<StateView> state(
            @RequestParam(defaultValue = "1") long appId) {
        return success(circuitService.state(appId));
    }

    @PutMapping("/limits")
    @Operation(summary = "更新资源上限(body {limits: 部分字段},回全量配置)")
    public CommonResult<CircuitBreakerLimits> updateLimits(
            @RequestParam(defaultValue = "1") long appId,
            @RequestBody(required = false) UpdateLimitsReq request) {
        return success(circuitService.updateLimits(
                appId, request == null ? null : request.limits()));
    }

    @PostMapping("/emergency-stop")
    @Operation(summary = "紧急停用(应用级总开关;新 run 403;在途 run 批量发起取消,"
            + "counts.cancelInitiated 为已发起取消数,异步尽力而为)")
    public CommonResult<CircuitBreakerAdminService.EmergencyStopView> emergencyStop(
            @RequestParam(defaultValue = "1") long appId,
            @RequestBody EmergencyStopReq request) {
        return success(circuitService.emergencyStop(appId, request.reason()));
    }

    @PostMapping("/resume")
    @Operation(summary = "从紧急停用恢复")
    public CommonResult<CircuitEventView> resume(
            @RequestParam(defaultValue = "1") long appId) {
        return success(circuitService.resume(appId));
    }

    @PostMapping("/terminate-run")
    @Operation(summary = "强制终止任意运行(复用取消基建;审计 forced-policy)")
    public Mono<CommonResult<CircuitEventView>> terminateRun(
            @RequestParam(defaultValue = "1") long appId,
            @RequestBody TerminateRunReq request) {
        return circuitService.terminateRun(appId, request.runId(), request.reason())
                .map(CommonResult::success);
    }

    /** PUT /limits 请求体(mock 契约 {limits: Partial<ResourceLimits>})。 */
    public record UpdateLimitsReq(CircuitBreakerLimits.PartialPatch limits) {
    }

    /** 紧急停用请求体(mock 契约 {reason};缺失 400)。 */
    public record EmergencyStopReq(String reason) {
    }

    /** 单运行终止请求体(mock 契约 {runId, reason};任一缺失 400)。 */
    public record TerminateRunReq(String runId, String reason) {
    }
}
