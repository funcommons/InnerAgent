package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.kb.KbExternalConfigService;
import com.inneragent.platform.kb.KbExternalRetrievalClient;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
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
 * 外部知识库管理 admin API(契约源 06-外部知识库API规范.md §2;形态逐字
 * 对齐 {@link AdminKbController}:CommonResult 包裹 + @Validated + appId
 * 缺省 1,由 {@link AdminTokenFilter} 守卫)。路由
 * {@code /ia/api/v1/admin/kb/external}:POST 登记 / GET 列表(每应用暂限 1;
 * 出参 credentials 恒 null 只写不读出)/ DELETE {id} 软删(软删后可重登)/
 * POST {id}/debug 检索调试(直呼宿主端点,失败按零命中)。编辑(PUT)暂缺:
 * 暂限 1 个语义下删后重登即编辑。服务调用以系统模式执行
 * (AppContext.runAsSystem,AdminKbController 先例):范围由显式 appId 条件
 * 提供,避免无 AppContext 线程被行级拦截器注入 app_id=1 致读写静默落空。
 */
@Tag(name = "外部知识库(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/kb/external")
@RequiredArgsConstructor
@Validated
public class AdminKbExternalController {

    private final KbExternalConfigService configService;

    @PostMapping
    @Operation(summary = "登记外接源(name/endpointUrl 必填;每应用暂限 1,超限 400)")
    public CommonResult<KbExternalConfigService.KbExternalView> register(
            @RequestParam(defaultValue = "1") long appId,
            @Valid @RequestBody RegisterReq request) {
        return success(AppContext.runAsSystem(() -> configService.register(appId,
                request.getName(), request.getEndpointUrl(), request.getAuthType(),
                request.getHeaderName(), request.getCredentials(), request.getTimeoutMs())));
    }

    @GetMapping
    @Operation(summary = "登记清单(credentials 恒 null,只写不读出)")
    public CommonResult<List<KbExternalConfigService.KbExternalView>> list(
            @RequestParam(defaultValue = "1") long appId) {
        return success(AppContext.runAsSystem(() -> configService.list(appId)));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除登记(软删;删除后同应用可重新登记)")
    public CommonResult<Boolean> delete(
            @RequestParam(defaultValue = "1") long appId,
            @PathVariable long id) {
        return success(AppContext.runAsSystem(() -> configService.delete(appId, id)));
    }

    @PostMapping("/{id}/debug")
    @Operation(summary = "检索调试(直呼宿主端点;出站命中形态,失败按零命中)")
    public CommonResult<List<KbExternalRetrievalClient.Hit>> debug(
            @RequestParam(defaultValue = "1") long appId,
            @PathVariable long id,
            @Valid @RequestBody DebugReq request) {
        return success(AppContext.runAsSystem(() ->
                configService.debug(appId, id, request.getQuery(), request.getTopK())));
    }

    // 请求体形态(登记:name/endpointUrl 必填,credentials 只存不回显)

    @Data
    public static class RegisterReq {

        @NotBlank(message = "外接源名称不能为空")
        private String name;

        @NotBlank(message = "检索端点 URL 不能为空")
        private String endpointUrl;

        /** NONE / STATIC_HEADER(缺省 NONE;STATIC_HEADER 时头成对必填) */
        private String authType;

        private String headerName;

        private String credentials;

        /** 单次检索超时(毫秒;缺省 10000) */
        private Integer timeoutMs;
    }

    @Data
    public static class DebugReq {

        @NotBlank(message = "检索查询不能为空")
        private String query;

        /** 建议返回条数(缺省 4,平台侧钳制 ≤50) */
        private Integer topK;
    }
}
