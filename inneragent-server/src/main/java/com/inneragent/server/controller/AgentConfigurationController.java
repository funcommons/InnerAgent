package com.inneragent.server.controller;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.server.controller.vo.AgentSkillImportReqVO;
import com.inneragent.server.controller.vo.AgentSkillSaveReqVO;
import com.inneragent.server.controller.vo.AgentMcpServerRespVO;
import com.inneragent.server.controller.vo.AgentMcpServerSaveReqVO;
import com.inneragent.server.controller.vo.AgentMcpTestRespVO;
import com.inneragent.agent.entity.AgentMcpServer;
import com.inneragent.agent.mcp.AgentMcpServerService;
import com.inneragent.agent.mcp.AgentUserMcpRuntimeRegistry;
import com.inneragent.agent.skill.AgentSkillImportService;
import com.inneragent.agent.skill.AgentUserSkillService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

import static com.inneragent.platform.common.CommonResult.success;
import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * 智能体用户级配置 Controller(skills/mcp)。
 *
 * <p>[adapt] P1-T3b 契约收口(02-技术方案 §7.1 ADR-T4,一次性切换不留旧别名):
 * 融光 {@code /api/ai/agent-config/*} → {@code /ia/api/v1/me/*}(SDK 配置页域);
 * 用户级模型/引用目录端点见 {@link MeController}。
 *
 * <p>[adapt] P2-srv me 语义归位:workspace / state-cleanup 为<strong>应用级</strong>
 * 配置,已迁 {@code /ia/api/v1/admin/workspace*} 与
 * {@code /ia/api/v1/admin/state-cleanup}(X-IA-Admin-Key 守卫,旧 /me 路径删除);
 * 本控制器仅保留按 {@code requireCurrentUserId()} 归属的用户级数据
 * (skills/mcp)。SDK me.ts 消费的 {@code /me/models}、{@code /me/reference-options}
 * 见 MeController,本控制器端点 SDK 暂未消费、契约路径不变。
 */
@Tag(name = "智能体配置")
@RestController
@RequestMapping("/ia/api/v1/me")
@RequiredArgsConstructor
public class AgentConfigurationController {

    private final AgentUserSkillService userSkillService;
    private final AgentSkillImportService skillImportService;
    private final AgentMcpServerService mcpServerService;
    private final AgentUserMcpRuntimeRegistry userMcpRuntimeRegistry;

    @GetMapping("/skills")
    @Operation(summary = "获取当前用户的自定义 Skill")
    public CommonResult<List<AgentUserSkillService.UserSkill>> skills() {
        return success(userSkillService.list(requireCurrentUserId()));
    }

    @PutMapping("/skills")
    @Operation(summary = "创建或更新当前用户的自定义 Skill")
    public CommonResult<AgentUserSkillService.UserSkill> saveSkill(
            @Valid @RequestBody AgentSkillSaveReqVO request) {
        return success(userSkillService.save(
                requireCurrentUserId(),
                request.originalName(),
                request.name(),
                request.displayName(),
                request.description(),
                request.content()));
    }

    @PostMapping(value = "/skills/import/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "预检当前用户要导入的 Skill 包")
    public CommonResult<AgentSkillImportService.ImportPreview> previewSkillImport(
            @RequestPart("files") List<MultipartFile> files,
            @RequestParam("paths") List<String> paths) {
        return success(skillImportService.preview(requireCurrentUserId(), files, paths));
    }

    @PostMapping(value = "/skills/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "导入当前用户选择的 Skill")
    public CommonResult<AgentSkillImportService.ImportResult> importSkills(
            @RequestPart("files") List<MultipartFile> files,
            @RequestParam("paths") List<String> paths,
            @Valid @RequestPart("request") AgentSkillImportReqVO request) {
        List<AgentSkillImportService.ImportSelection> selections = request.selections().stream()
                .map(selection -> new AgentSkillImportService.ImportSelection(
                        selection.rootPath(),
                        selection.displayName(),
                        selection.action()))
                .toList();
        return success(skillImportService.importSkills(
                requireCurrentUserId(), files, paths, selections));
    }

    @DeleteMapping("/skills/{name}")
    @Operation(summary = "删除当前用户的自定义 Skill")
    public CommonResult<Boolean> deleteSkill(@PathVariable String name) {
        userSkillService.delete(requireCurrentUserId(), name);
        return success(true);
    }

    @GetMapping("/mcp")
    @Operation(summary = "获取当前用户的自定义 MCP 服务")
    public CommonResult<List<AgentMcpServerRespVO>> mcpServers() {
        long userId = requireCurrentUserId();
        return success(mcpServerService.list(userId).stream()
                .map(mcpServerService::toResponse)
                .toList());
    }

    @PutMapping("/mcp")
    @Operation(summary = "创建或更新当前用户的自定义 MCP 服务")
    public CommonResult<AgentMcpServerRespVO> saveMcpServer(
            @Valid @RequestBody AgentMcpServerSaveReqVO request) {
        long userId = requireCurrentUserId();
        AgentMcpServer saved = mcpServerService.save(userId, request);
        userMcpRuntimeRegistry.invalidate(userId);
        return success(mcpServerService.toResponse(saved));
    }

    @DeleteMapping("/mcp/{id}")
    @Operation(summary = "删除当前用户的自定义 MCP 服务")
    public CommonResult<Boolean> deleteMcpServer(@PathVariable Long id) {
        long userId = requireCurrentUserId();
        mcpServerService.delete(userId, id);
        userMcpRuntimeRegistry.invalidate(userId);
        return success(true);
    }

    @PostMapping("/mcp/{id}/test")
    @Operation(summary = "测试当前用户的 MCP 服务并发现工具")
    public CommonResult<AgentMcpTestRespVO> testMcpServer(@PathVariable Long id) {
        long userId = requireCurrentUserId();
        AgentMcpServer server = mcpServerService.requireOwned(id, userId);
        AgentMcpTestRespVO result = userMcpRuntimeRegistry.test(server);
        mcpServerService.recordTest(userId, id, result.success(), result.message());
        return success(result);
    }
}
