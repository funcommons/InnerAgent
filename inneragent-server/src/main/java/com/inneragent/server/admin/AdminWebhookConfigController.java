package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.server.admin.WebhookConfigAdminService.ConfigView;
import com.inneragent.server.admin.WebhookConfigAdminService.TestResult;
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

import static com.inneragent.platform.common.CommonResult.success;

/**
 * Webhook 订阅配置 admin API(优化建议 #2 服务端半;mock 契约
 * handlers.ts webhookHandlers 为产品契约锚点):GET/PUT
 * {@code /ia/api/v1/admin/webhooks/config} + POST {@code /config/test}
 * (真实外呼单次签名投递)。投递记录观测面(18b 已落库)见
 * {@code /ia/api/v1/admin/webhook-deliveries}(web 侧将改接真路径)。
 *
 * <p>由 {@link AdminTokenFilter} 双轨守卫;appId 缺省单应用 1。
 */
@Tag(name = "Webhook 配置(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/webhooks")
@RequiredArgsConstructor
@Validated
public class AdminWebhookConfigController {

    private final WebhookConfigAdminService configService;

    @GetMapping("/config")
    @Operation(summary = "Webhook 配置(url/掩码 secret/总开关/订阅事件)")
    public CommonResult<ConfigView> get(
            @RequestParam(defaultValue = "1") long appId) {
        return success(configService.get(appId));
    }

    @PutMapping("/config")
    @Operation(summary = "保存 Webhook 配置(secret 只写:空/缺省 = 不修改)")
    public CommonResult<ConfigView> save(
            @RequestParam(defaultValue = "1") long appId,
            @RequestBody WebhookConfigAdminService.SaveReq request) {
        return success(configService.save(appId, request));
    }

    @PostMapping("/config/test")
    @Operation(summary = "连通性测试(签名 + 单次真实投递,2xx 即 ok)")
    public CommonResult<TestResult> test(
            @RequestParam(defaultValue = "1") long appId) {
        return success(configService.test(appId));
    }
}
