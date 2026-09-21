package com.inneragent.server.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageResult;
import com.inneragent.server.admin.AgentDefinitionAdminService.DefinitionView;
import com.inneragent.server.admin.AgentDefinitionBundle.ImportResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
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
 * Agent 定义管理 admin API(P2-W5「Agent 定义导入导出与提示词编辑」,W5 任务行;
 * 数据落 ia_agent_definition,运行内核仍读代码注册表,数据驱动内核切换属后续批次)。
 *
 * <p>路由 {@code /ia/api/v1/admin/definitions/**}:GET 列表(分页,PageResult
 * 形与 audit-logs 一致)/GET {id} 详情(含提示词与规格 JSON)/PUT {id}/prompt
 * (单槽编辑,旧值进审计入参快照留痕)/POST export(bundle 形状为 P3/W7 融光
 * 定义导出预留,schemaVersion=1)/POST import(conflictPolicy skip|overwrite,
 * dryRun 预演零副作用,结果 {created,updated,skipped,errors[]})。
 *
 * <p>由 {@link AdminTokenFilter} 双轨守卫(Bearer 管理会话 / X-IA-Admin-Key);
 * appId 缺省单应用 1。
 */
@Tag(name = "Agent 定义(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/definitions")
@RequiredArgsConstructor
@Validated
public class AdminAgentDefinitionController {

    private final AgentDefinitionAdminService definitionService;

    @GetMapping
    @Operation(summary = "定义分页列表(agentKey 升序;出参含提示词与规格 JSON;"
            + "kind 可选过滤 main/sub,P4-W14 区分子 Agent 定义)")
    public CommonResult<PageResult<DefinitionView>> list(
            @RequestParam(defaultValue = "1") long appId,
            @RequestParam(defaultValue = "1") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) String kind) {
        return success(definitionService.page(appId, pageNo, pageSize, kind));
    }

    @GetMapping("/{id}")
    @Operation(summary = "定义详情(含提示词三槽与规格 spec 对象)")
    public CommonResult<DefinitionView> get(@PathVariable long id) {
        return success(definitionService.get(id));
    }

    @PutMapping("/{id}/prompt")
    @Operation(summary = "编辑提示词槽位(slot=systemPrompt/instructionTemplate/greeting;"
            + "旧值快照落审计 definition-updated/admin)")
    public CommonResult<DefinitionView> updatePrompt(
            @PathVariable long id,
            @Validated @RequestBody UpdatePromptReq request) {
        return success(definitionService.updatePrompt(id, request.slot(), request.content()));
    }

    @PostMapping("/export")
    @Operation(summary = "导出 bundle({schemaVersion, exportedAt, definitions[]};"
            + "ids 缺省=该应用全量)")
    public CommonResult<AgentDefinitionBundle.Bundle> export(
            @RequestParam(defaultValue = "1") long appId,
            @RequestBody(required = false) ExportReq request) {
        return success(definitionService.export(
                appId, request == null ? null : request.ids()));
    }

    @PostMapping("/import")
    @Operation(summary = "导入 bundle(conflictPolicy=skip|overwrite;dryRun=true 只出预览"
            + "零副作用;结果 {created,updated,skipped,errors[]})")
    public CommonResult<ImportResult> importBundle(
            @RequestParam(defaultValue = "1") long appId,
            @Validated @RequestBody ImportReq request) {
        return success(definitionService.importBundle(
                appId,
                request.bundle(),
                request.conflictPolicy(),
                request.dryRun() != null && request.dryRun()));
    }

    /** PUT /{id}/prompt 请求体(systemPrompt 必须非空白;其余槽位空白=清空)。 */
    public record UpdatePromptReq(
            @NotBlank String slot,
            String content) {
    }

    /** POST /export 请求体(ids 缺省=全量)。 */
    public record ExportReq(List<Long> ids) {
    }

    /** POST /import 请求体(bundle 内嵌 JSON 对象;conflictPolicy 缺省 skip)。 */
    public record ImportReq(
            JsonNode bundle,
            String conflictPolicy,
            Boolean dryRun) {
    }
}
