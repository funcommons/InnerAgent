package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageResult;
import com.inneragent.server.admin.WebhookDeliveryAdminService.DeliveryView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 终态 Webhook 投递记录 admin API(任务 #18b,W5)。
 *
 * <p>路由 {@code /ia/api/v1/admin/webhook-deliveries};由 {@link AdminTokenFilter}
 * 以 {@code X-IA-Admin-Key} 独立鉴权,不走 embed token 与 @PreAuthorize 体系。
 * 视图形态对齐 web 契约({@code web/src/api/admin.ts} 的 deliveries):
 * event/success/attempt/maxAttempts/httpStatus/responseSummary/nextRetryAt/
 * deliveredAt,另带 status/appId 扩展;{code POST /{id}/redeliver} 手动重投。
 */
@Tag(name = "终态 Webhook 投递(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/webhook-deliveries")
@RequiredArgsConstructor
@Validated
public class WebhookDeliveryAdminController {

    private final WebhookDeliveryAdminService adminService;

    @GetMapping
    @Operation(summary = "投递记录分页(appId/status/event 过滤;status=PENDING/FAILED/SUCCESS/EXHAUSTED)")
    public CommonResult<PageResult<DeliveryView>> page(
            @RequestParam(required = false) Long appId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String event,
            @RequestParam(defaultValue = "1") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize) {
        return success(adminService.page(appId, status, event, pageNo, pageSize));
    }

    @PostMapping("/{id}/redeliver")
    @Operation(summary = "手动重投(SUCCESS/FAILED/EXHAUSTED → PENDING,清空尝试历史)")
    public CommonResult<DeliveryView> redeliver(@PathVariable long id) {
        return success(adminService.redeliver(id));
    }
}
