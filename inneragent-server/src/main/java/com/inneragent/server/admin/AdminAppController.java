package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
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
 * 应用注册 admin API(管理面,02-技术方案 §6.3/§7.1)。
 *
 * <p>路由 {@code /ia/api/v1/admin/apps};由 {@link AdminTokenFilter} 以
 * {@code X-IA-Admin-Key} 独立鉴权(env {@code IA_ADMIN_KEY}),不走 embed token
 * 与 @PreAuthorize 体系。webhook 两字段可空。
 *
 * <p>响应统一 {@link AdminAppService.AppView}(P2-key):webhookSecret 永不回显
 * (write-only,仅 {@code webhookSecretMasked} 掩码;PUT 空/缺省 = 不修改);
 * PUT signPublicKey 即轮换(旧 key 进入宽限期,响应回 signKeyFingerprint/
 * signKeyRotatedAt)。不再直接序列化 AppRegistration 实体。
 */
@Tag(name = "应用注册(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/apps")
@RequiredArgsConstructor
@Validated
public class AdminAppController {

    private final AdminAppService adminAppService;

    public record RegisterAppReqVO(
            @NotBlank String appKey,
            @NotBlank String name,
            @NotBlank String signPublicKey,
            String webhookUrl,
            String webhookSecret) {
    }

    public record UpdateAppReqVO(
            String name,
            String signPublicKey,
            String webhookUrl,
            String webhookSecret,
            Integer status) {
    }

    @PostMapping
    @Operation(summary = "注册应用(上传验签公钥;webhookSecret 只写)")
    public CommonResult<AdminAppService.AppView> register(@Validated @RequestBody RegisterAppReqVO request) {
        return success(adminAppService.register(
                request.appKey(),
                request.name(),
                request.signPublicKey(),
                request.webhookUrl(),
                request.webhookSecret()));
    }

    @GetMapping
    @Operation(summary = "应用列表(webhookSecret 仅掩码)")
    public CommonResult<List<AdminAppService.AppView>> list() {
        return success(adminAppService.list());
    }

    @GetMapping("/{id}")
    @Operation(summary = "应用详情(webhookSecret 仅掩码)")
    public CommonResult<AdminAppService.AppView> get(@PathVariable long id) {
        return success(adminAppService.getRequiredView(id));
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新应用(signPublicKey=轮换;webhookSecret 空/缺省不修改;响应含公钥指纹)")
    public CommonResult<AdminAppService.AppView> update(
            @PathVariable long id, @Validated @RequestBody UpdateAppReqVO request) {
        return success(adminAppService.update(
                id,
                request.name(),
                request.signPublicKey(),
                request.webhookUrl(),
                request.webhookSecret(),
                request.status()));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "注销应用(逻辑删除)")
    public CommonResult<Boolean> delete(@PathVariable long id) {
        adminAppService.delete(id);
        return success(true);
    }
}
