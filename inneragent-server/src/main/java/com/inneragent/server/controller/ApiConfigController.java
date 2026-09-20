package com.inneragent.server.controller;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageResult;
import com.inneragent.server.controller.vo.ApiConfigPageReqVO;
import com.inneragent.server.controller.vo.ApiConfigRespVO;
import com.inneragent.server.controller.vo.ApiConfigSaveReqVO;
import com.inneragent.server.controller.vo.RemoteModelVO;
import com.inneragent.platform.convert.ai.ApiConfigConvert;
import com.inneragent.model.entity.ApiConfig;
import com.inneragent.model.config.ApiConfigService;
import com.inneragent.model.provider.AiProviderService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

import static com.inneragent.platform.common.CommonResult.success;

@Tag(name = "API配置管理")
@RestController
@RequestMapping("/api/ai/api-config")
@RequiredArgsConstructor
public class ApiConfigController {

    private final ApiConfigService apiConfigService;
    private final AiProviderService aiProviderService;

    @PostMapping("/create")
    @Operation(summary = "创建API配置")
    @PreAuthorize("hasRole('ADMIN')")
    public CommonResult<Long> create(@Valid @RequestBody ApiConfigSaveReqVO reqVO) {
        ApiConfig config = ApiConfig.builder()
                .name(reqVO.getName()).platform(reqVO.getPlatform())
                .textProtocol(reqVO.getTextProtocol())
                .apiUrl(reqVO.getApiUrl())
                .autoAppendV1Path(reqVO.getAutoAppendV1Path() != null ? reqVO.getAutoAppendV1Path() : true)
                .proxyType(reqVO.getProxyType())
                .proxyHost(reqVO.getProxyHost())
                .proxyPort(reqVO.getProxyPort())
                .proxyUsername(reqVO.getProxyUsername())
                .proxyPassword(reqVO.getProxyPassword())
                .apiKey(reqVO.getApiKey()).platformAppId(reqVO.getAppId()).appSecret(reqVO.getAppSecret())
                .modelId(reqVO.getModelId()).status(reqVO.getStatus() != null ? reqVO.getStatus() : 1)
                .remark(reqVO.getRemark())
                .build();
        return success(apiConfigService.createApiConfig(config));
    }

    @PutMapping("/update")
    @Operation(summary = "更新API配置")
    @PreAuthorize("hasRole('ADMIN')")
    public CommonResult<Boolean> update(@Valid @RequestBody ApiConfigSaveReqVO reqVO) {
        apiConfigService.updateApiConfig(reqVO.getId(), reqVO.getName(), reqVO.getPlatform(),
            reqVO.getTextProtocol(),
            reqVO.getApiUrl(), reqVO.getAutoAppendV1Path(), reqVO.getProxyType(),
            reqVO.getProxyHost(), reqVO.getProxyPort(), reqVO.getProxyUsername(),
            reqVO.getProxyPassword(), reqVO.getApiKey(), reqVO.getAppId(), reqVO.getAppSecret(),
            reqVO.getModelId(), reqVO.getStatus(), reqVO.getRemark());
        return success(true);
    }

    @DeleteMapping("/delete")
    @Operation(summary = "删除API配置")
    @PreAuthorize("hasRole('ADMIN')")
    public CommonResult<Boolean> delete(@RequestParam("id") Long id) {
        apiConfigService.deleteApiConfig(id);
        return success(true);
    }

    @GetMapping("/get")
    @Operation(summary = "获取API配置详情")
    @Parameter(name = "id", description = "配置ID", required = true)
    public CommonResult<ApiConfigRespVO> get(@RequestParam("id") Long id) {
        ApiConfig config = apiConfigService.getById(id);
        return success(config == null ? null : ApiConfigConvert.INSTANCE.convert(config));
    }

    @GetMapping("/page")
    @Operation(summary = "API配置分页列表")
    @PreAuthorize("hasRole('ADMIN')")
    public CommonResult<PageResult<ApiConfigRespVO>> page(@Valid ApiConfigPageReqVO reqVO) {
        return success(apiConfigService.getPage(reqVO.getName(), reqVO.getPlatform(),
                reqVO.getStatus(), reqVO.getPageNo(), reqVO.getPageSize())
                .map(ApiConfigConvert.INSTANCE::convert));
    }

    @GetMapping("/list")
    @Operation(summary = "获取启用的API配置列表")
    public CommonResult<List<ApiConfigRespVO>> list() {
        return success(ApiConfigConvert.INSTANCE.convertList(apiConfigService.getEnabledList()));
    }

    @GetMapping("/remote-models")
    @Operation(summary = "获取远程可用模型列表")
    @Parameter(name = "id", description = "API配置ID", required = true)
    @PreAuthorize("hasRole('ADMIN')")
    public CommonResult<List<RemoteModelVO>> remoteModels(@RequestParam("id") Long id) {
        return success(aiProviderService.listRemoteModels(id));
    }

    // [adapt] /test-comfyui-connectivity 端点随 ComfyUI 工作流域裁剪(依赖未移植的
    // ComfyUiWorkflowValidationService),P1 如需该能力经 MCP 从宿主应用接入
}
