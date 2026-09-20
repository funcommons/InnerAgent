package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageResult;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 模型接入配置 admin API(P2-srv 安全收口,web/ 脚手架契约对齐)。
 *
 * <p>路由 {@code /ia/api/v1/admin/model-configs};由 {@link AdminTokenFilter} 以
 * {@code X-IA-Admin-Key} 独立鉴权(env {@code IA_ADMIN_KEY}),不走 embed token
 * 与 @PreAuthorize 体系。
 *
 * <p>融光旧管理面 {@code /api/ai/model/*} 与 {@code /api/ai/api-config/*}
 * (P0 起存在无守卫端点且 {@code /api/ai/model/list} 明文下发接入密钥)整体迁移:
 * <ul>
 *   <li>SDK 消费的启用模型列表已收口 {@code GET /ia/api/v1/me/models?type=}
 *       (MeController,白名单字段,不下发 config/密钥);</li>
 *   <li>管理面 CRUD + 连通性测试收敛到本控制器;{@code apiKey/appSecret/
 *       proxyPassword} 为 write-only,响应密钥一律掩码({@code apiKeyMasked});</li>
 *   <li>旧路径 {@code /api/ai/model/*}、{@code /api/ai/api-config/*} 删除,
 *       不留别名(一次性切换,02-技术方案 §7.1 ADR-T4 同口径)。</li>
 * </ul>
 */
@Tag(name = "模型接入配置(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/model-configs")
@RequiredArgsConstructor
@Validated
public class AdminModelConfigController {

    private final AdminModelConfigService modelConfigService;

    /**
     * 保存请求(web 脚手架 ModelApiConfigSaveReq 对齐)。{@code apiKey/
     * appSecret/proxyPassword} 为 write-only:update 时 {@code apiKey} 空/缺省
     * 表示不修改密钥。
     */
    public record SaveReqVO(
            @NotBlank String name,
            @NotBlank String platform,
            String textProtocol,
            String apiUrl,
            Boolean autoAppendV1Path,
            String proxyType,
            String proxyHost,
            Integer proxyPort,
            String proxyUsername,
            String proxyPassword,
            String apiKey,
            String appId,
            String appSecret,
            Long modelId,
            Integer status,
            String remark) {
    }

    @GetMapping
    @Operation(summary = "模型接入配置分页(name/platform/status 过滤;密钥仅掩码)")
    public CommonResult<PageResult<AdminModelConfigService.ModelConfigView>> page(
            @RequestParam(required = false) String name,
            @RequestParam(required = false) String platform,
            @RequestParam(required = false) Integer status,
            @RequestParam(defaultValue = "1") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize) {
        return success(modelConfigService.page(name, platform, status, pageNo, pageSize));
    }

    @GetMapping("/{id}")
    @Operation(summary = "模型接入配置详情(密钥仅掩码)")
    public CommonResult<AdminModelConfigService.ModelConfigView> get(@PathVariable long id) {
        return success(modelConfigService.getRequired(id));
    }

    @PostMapping
    @Operation(summary = "创建模型接入配置(apiKey 只写)")
    public CommonResult<AdminModelConfigService.ModelConfigView> create(
            @Validated @RequestBody SaveReqVO request) {
        return success(modelConfigService.create(
                request.name(), request.platform(), request.textProtocol(), request.apiUrl(),
                request.autoAppendV1Path(), request.proxyType(), request.proxyHost(),
                request.proxyPort(), request.proxyUsername(), request.proxyPassword(),
                request.apiKey(), request.appId(), request.appSecret(), request.modelId(),
                request.status(), request.remark()));
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新模型接入配置(apiKey 空/缺省 = 不修改密钥)")
    public CommonResult<AdminModelConfigService.ModelConfigView> update(
            @PathVariable long id, @Validated @RequestBody SaveReqVO request) {
        return success(modelConfigService.update(
                id, request.name(), request.platform(), request.textProtocol(),
                request.apiUrl(), request.autoAppendV1Path(), request.proxyType(),
                request.proxyHost(), request.proxyPort(), request.proxyUsername(),
                request.proxyPassword(), request.apiKey(), request.appId(),
                request.appSecret(), request.modelId(), request.status(), request.remark()));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除模型接入配置")
    public CommonResult<Boolean> delete(@PathVariable long id) {
        modelConfigService.delete(id);
        return success(true);
    }

    @PostMapping("/{id}/test")
    @Operation(summary = "连通性测试(拉取远程模型清单;结果含 ok/失败原因)")
    public CommonResult<AdminModelConfigService.ConnectivityResult> test(
            @PathVariable long id) {
        return success(modelConfigService.test(id));
    }
}
