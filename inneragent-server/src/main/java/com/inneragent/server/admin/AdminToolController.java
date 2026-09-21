package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.toolhub.ToolHealthService;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.ToolSchemaHistory;
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

import java.util.List;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 工具注册管理 admin API(P1-T2a,02-技术方案 §4.3/§7.1)。
 *
 * <p>路由 {@code /ia/api/v1/admin/tools};由 {@link AdminTokenFilter} 保护
 * (X-IA-Admin-Key),与 embed token 体系隔离。注册表变更自动失效
 * McpToolCatalog 缓存并留审计/schema 历史。
 */
@Tag(name = "工具注册(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/tools")
@RequiredArgsConstructor
@Validated
public class AdminToolController {

    private final ToolRegistryService toolRegistryService;
    private final ToolHealthService toolHealthService;

    public record RegisterToolReqVO(
            @NotBlank String serverKey,
            @NotBlank String toolName,
            String description,
            String parametersSchema,
            String annotationsJson,
            String riskLevel,
            String adminPolicy,
            Boolean resumeSafe,
            Boolean concurrencySafe,
            @NotBlank String source,
            String endpointUrl,
            String toolVersion,
            Boolean enabled) {
    }

    public record UpdateToolReqVO(
            String description,
            String riskLevel,
            String adminPolicy,
            Boolean resumeSafe,
            Boolean concurrencySafe,
            String toolVersion) {
    }

    public record RefreshSchemaReqVO(
            String parametersSchema,
            String annotationsJson,
            String toolVersion) {
    }

    /** 活刷新分诊结果(V14):verdict=unchanged/compatible/breaking + 理由。 */
    public record TriageRespVO(
            Long toolId,
            String fqn,
            String verdict,
            List<String> reasons,
            Boolean revalidateRequired,
            String effectiveSchemaSha256,
            String pendingSchemaSha256) {

        static TriageRespVO of(ToolRegistryService.SchemaTriageResult result) {
            ToolRegistryEntry entry = result.entry();
            return new TriageRespVO(
                    entry.getId(),
                    entry.getFqn(),
                    result.verdict(),
                    result.reasons(),
                    entry.getRevalidateRequired(),
                    entry.getSchemaSha256(),
                    entry.getPendingSchemaSha256());
        }
    }

    @PostMapping
    @Operation(summary = "注册工具(FQN 唯一/指纹/注解默认风险级/强制高危)")
    public CommonResult<ToolRegistryEntry> register(
            @Validated @RequestBody RegisterToolReqVO request) {
        return success(toolRegistryService.register(new ToolRegistryService.RegisterCommand(
                request.serverKey(),
                request.toolName(),
                request.description(),
                request.parametersSchema(),
                request.annotationsJson(),
                request.riskLevel(),
                request.adminPolicy(),
                request.resumeSafe(),
                request.concurrencySafe(),
                request.source(),
                request.endpointUrl(),
                request.toolVersion(),
                request.enabled())));
    }

    @GetMapping
    @Operation(summary = "工具列表(serverKey/enabled 过滤)")
    public CommonResult<List<ToolRegistryEntry>> list(
            @RequestParam(required = false) String serverKey,
            @RequestParam(required = false) Boolean enabled) {
        return success(toolRegistryService.list(serverKey, enabled));
    }

    @GetMapping("/{id}")
    @Operation(summary = "工具详情")
    public CommonResult<ToolRegistryEntry> get(@PathVariable long id) {
        return success(toolRegistryService.getRequired(id));
    }

    @GetMapping("/{id}/schema-history")
    @Operation(summary = "schema 指纹变更历史(V14 留痕)")
    public CommonResult<List<ToolSchemaHistory>> schemaHistory(@PathVariable long id) {
        return success(toolRegistryService.history(id));
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新治理元数据(风险级上调级联失效授权)")
    public CommonResult<ToolRegistryEntry> update(
            @PathVariable long id, @Validated @RequestBody UpdateToolReqVO request) {
        return success(toolRegistryService.update(id, new ToolRegistryService.UpdateCommand(
                request.description(),
                request.riskLevel(),
                request.adminPolicy(),
                request.resumeSafe(),
                request.concurrencySafe(),
                request.toolVersion())));
    }

    @PostMapping("/{id}/schema")
    @Operation(summary = "活刷新分诊(宿主重发 schema;V14 矩阵)")
    public CommonResult<TriageRespVO> refreshSchema(
            @PathVariable long id, @RequestBody RefreshSchemaReqVO request) {
        return success(TriageRespVO.of(toolRegistryService.refreshSchema(
                id,
                request.parametersSchema(),
                request.annotationsJson(),
                request.toolVersion())));
    }

    @PostMapping("/{id}/schema/confirm")
    @Operation(summary = "重新确认通过(应用 BREAKING 暂存 schema)")
    public CommonResult<ToolRegistryEntry> confirmPendingSchema(@PathVariable long id) {
        return success(toolRegistryService.confirmPendingSchema(id));
    }

    @PostMapping("/{id}/schema/reject")
    @Operation(summary = "拒绝待确认变更(保持旧 schema)")
    public CommonResult<ToolRegistryEntry> rejectPendingSchema(@PathVariable long id) {
        return success(toolRegistryService.rejectPendingSchema(id));
    }

    @PostMapping("/{id}/disable")
    @Operation(summary = "停用(级联失效授权)")
    public CommonResult<ToolRegistryEntry> disable(@PathVariable long id) {
        return success(toolRegistryService.disable(id));
    }

    @PostMapping("/{id}/enable")
    @Operation(summary = "启用")
    public CommonResult<ToolRegistryEntry> enable(@PathVariable long id) {
        return success(toolRegistryService.enable(id));
    }

    @PostMapping("/{id}/check")
    @Operation(summary = "工具体检 v1(单工具同步:可达/清单/指纹/注解,结论落库)")
    public CommonResult<ToolHealthService.ToolCheckResult> check(@PathVariable long id) {
        return success(toolHealthService.checkOne(id));
    }

    /** 批量体检请求体:ids 为空/缺省 → 全量(全部未删除注册行)。 */
    public record CheckBatchReqVO(List<Long> ids) {
    }

    @PostMapping("/check-batch")
    @Operation(summary = "工具体检 v1(批量/全量异步:受理后逐个执行,结果经详情接口可查)")
    public CommonResult<ToolHealthService.CheckBatchReceipt> checkBatch(
            @RequestBody(required = false) CheckBatchReqVO request) {
        return success(toolHealthService.checkBatch(request == null ? null : request.ids()));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "注销(逻辑删除+级联清除授权)")
    public CommonResult<Boolean> delete(@PathVariable long id) {
        toolRegistryService.delete(id);
        return success(true);
    }
}
