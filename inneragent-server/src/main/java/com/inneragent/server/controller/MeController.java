package com.inneragent.server.controller;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.server.controller.vo.AssistantReferenceOptionsRespVO;
import com.inneragent.server.controller.vo.MeModelRespVO;
import com.inneragent.model.config.AiModelService;
import com.inneragent.model.entity.AiModel;
import com.inneragent.agent.kernel.AgentKernelSpecFactory;
import com.inneragent.agent.mcp.AgentScopeMcpRegistry;
import com.inneragent.agent.skill.AgentScopeSkillRegistry;
import com.inneragent.agent.skill.AgentUserSkillService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.inneragent.platform.common.CommonResult.success;
import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * 用户级配置 Controller(SDK 配置页/composer 消费,`me` 域)。
 *
 * <p>[adapt] P1-T3b 契约收口(02-技术方案 §7.1 ADR-T4):
 * <ul>
 *   <li>融光 {@code GET /api/ai/model/list-by-type?type=1} →
 *       {@code GET /ia/api/v1/me/models?type=1}(SDK me.ts aiModelApi.listByType);
 *       响应裁剪为 SDK 契约字段,不下发 config(接入密钥)等管理面字段;</li>
 *   <li>融光 {@code GET /api/ai/assistant/reference-options} →
 *       {@code GET /ia/api/v1/me/reference-options}(SDK me.ts meApi.referenceOptions);
 *       用户级 Skill/MCP/工作区配置端点由 {@link AgentConfigurationController}
 *       收口到同一 {@code /ia/api/v1/me} 基路径。</li>
 * </ul>
 */
@Tag(name = "用户级配置")
@RestController
@RequestMapping("/ia/api/v1/me")
@RequiredArgsConstructor
public class MeController {

    private final AiModelService aiModelService;
    private final AgentScopeSkillRegistry skillRegistry;
    private final AgentScopeMcpRegistry mcpRegistry;
    private final AgentUserSkillService userSkillService;
    /** [adapt] P4-W13:应用级激活 Skill 目录(可空:测试直构免装配)。 */
    private final com.inneragent.agent.skill.AppSkillCatalogPort appSkillCatalog;

    @GetMapping("/models")
    @Operation(summary = "按类型获取当前用户可用模型列表")
    @Parameter(name = "type", description = "模型类型", required = true)
    public CommonResult<List<MeModelRespVO>> models(@RequestParam("type") Integer type) {
        return success(aiModelService.getListByType(type).stream()
                .map(MeController::toMeModel)
                .toList());
    }

    @GetMapping("/reference-options")
    @Operation(summary = "获取助手可主动引用的 Skill 与 MCP 工具")
    public CommonResult<AssistantReferenceOptionsRespVO> referenceOptions() {
        long userId = requireCurrentUserId();
        Map<String, AssistantReferenceOptionsRespVO.SkillOption> skillOptions = new LinkedHashMap<>();
        skillRegistry.catalog().forEach(skill -> skillOptions.put(skill.name(),
                new AssistantReferenceOptionsRespVO.SkillOption(
                        skill.id(), skill.name(), skill.displayName(),
                        skill.description(), skill.source())));
        // P4-W13:应用级已激活 Skill(未激活不下发);同名被用户级覆盖
        if (appSkillCatalog != null) {
            appSkillCatalog.activated(
                            com.inneragent.platform.context.AppContext.currentOrDefault())
                    .forEach(skill -> skillOptions.put(skill.name(),
                            new AssistantReferenceOptionsRespVO.SkillOption(
                                    String.valueOf(skill.id()), skill.name(),
                                    skill.displayName(), skill.description(),
                                    skill.source())));
        }
        userSkillService.catalog(userId).forEach(skill -> skillOptions.put(skill.name(),
                new AssistantReferenceOptionsRespVO.SkillOption(
                        skill.id(), skill.name(), skill.displayName(),
                        skill.description(), skill.source())));
        List<AssistantReferenceOptionsRespVO.SkillOption> skills = skillOptions.values().stream()
                .sorted(Comparator.comparing(
                        AssistantReferenceOptionsRespVO.SkillOption::displayName))
                .toList();
        List<AssistantReferenceOptionsRespVO.McpToolOption> mcpTools = mcpRegistry
                .catalogForAgent(AgentKernelSpecFactory.DEFAULT_AGENT_KEY, userId)
                .stream()
                .map(tool -> new AssistantReferenceOptionsRespVO.McpToolOption(
                        tool.serverName(),
                        tool.toolName(),
                        tool.description(),
                        tool.readOnly()))
                .toList();
        return success(new AssistantReferenceOptionsRespVO(skills, mcpTools));
    }

    private static MeModelRespVO toMeModel(AiModel model) {
        MeModelRespVO response = new MeModelRespVO();
        response.setId(model.getId());
        response.setName(model.getName());
        response.setCode(model.getCode());
        response.setDescription(model.getDescription());
        response.setStatus(model.getStatus());
        response.setDefaultModel(model.getDefaultModel());
        response.setSupportVision(model.getSupportVision());
        response.setMultimodalInputTypes(model.getMultimodalInputTypes());
        response.setMultimodalInputTransports(model.getMultimodalInputTransports());
        response.setSupportReasoning(model.getSupportReasoning());
        response.setReasoningEffortLevels(model.getReasoningEffortLevels());
        response.setContextWindow(model.getContextWindow());
        return response;
    }
}
