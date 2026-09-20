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
    @Operation(summary = "注册应用(上传验签公钥)")
    public CommonResult<AppRegistration> register(@Validated @RequestBody RegisterAppReqVO request) {
        return success(adminAppService.register(
                request.appKey(),
                request.name(),
                request.signPublicKey(),
                request.webhookUrl(),
                request.webhookSecret()));
    }

    @GetMapping
    @Operation(summary = "应用列表")
    public CommonResult<List<AppRegistration>> list() {
        return success(adminAppService.list());
    }

    @GetMapping("/{id}")
    @Operation(summary = "应用详情")
    public CommonResult<AppRegistration> get(@PathVariable long id) {
        return success(adminAppService.getRequired(id));
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新应用(公钥轮换/webhook/状态)")
    public CommonResult<AppRegistration> update(
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
