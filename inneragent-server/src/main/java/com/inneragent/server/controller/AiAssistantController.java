package com.inneragent.server.controller;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageParam;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.controller.vo.AssistantReferenceOptionsRespVO;
import com.inneragent.agent.entity.AgentConversation;
import com.inneragent.agent.entity.AgentMessage;
import com.inneragent.agent.conversation.AgentConversationService;
import com.inneragent.agent.conversation.AgentMessageService;
import com.inneragent.agent.kernel.AgentKernelSpecFactory;
import com.inneragent.agent.mcp.AgentScopeMcpRegistry;
import com.inneragent.agent.skill.AgentScopeSkillRegistry;
import com.inneragent.agent.skill.AgentUserSkillService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Comparator;

import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * AI 助手 Controller（对话管理 + 后续多轮 Chat）
 * <p>
 * Pipeline 相关接口已迁移至 {@link AiPipelineController}
 */
@Tag(name = "AI 助手")
@RestController
@RequestMapping("/api/ai/assistant")
@RequiredArgsConstructor
public class AiAssistantController {

    private final AgentConversationService conversationService;
    private final AgentMessageService messageService;
    private final AgentScopeSkillRegistry skillRegistry;
    private final AgentScopeMcpRegistry mcpRegistry;
    private final AgentUserSkillService userSkillService;

    // ========== 对话管理 ==========

    @Operation(summary = "获取助手可主动引用的 Skill 与 MCP 工具")
    @GetMapping("/reference-options")
    public CommonResult<AssistantReferenceOptionsRespVO> referenceOptions() {
        long userId = requireCurrentUserId();
        Map<String, AssistantReferenceOptionsRespVO.SkillOption> skillOptions = new LinkedHashMap<>();
        skillRegistry.catalog().forEach(skill -> skillOptions.put(skill.name(),
                new AssistantReferenceOptionsRespVO.SkillOption(
                        skill.id(), skill.name(), skill.displayName(),
                        skill.description(), skill.source())));
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
        return CommonResult.success(new AssistantReferenceOptionsRespVO(skills, mcpTools));
    }

    @Operation(summary = "获取对话列表（当前用户）")
    @GetMapping("/conversations")
    public CommonResult<PageResult<AgentConversation>> listConversations(
            PageParam pageParam,
            @RequestParam(required = false) String category) {
        Long userId = requireCurrentUserId();
        PageResult<AgentConversation> result;
        if (category != null) {
            result = conversationService.listByUserAndCategory(userId, category,
                    pageParam.getPageNo(), pageParam.getPageSize());
        } else {
            result = conversationService.listByUser(userId,
                    pageParam.getPageNo(), pageParam.getPageSize());
        }
        return CommonResult.success(result);
    }

    @Operation(summary = "获取对话消息列表")
    @GetMapping("/conversations/{conversationId}/messages")
    public CommonResult<List<AgentMessage>> listMessages(@PathVariable String conversationId) {
        long currentUserId = requireCurrentUserId();
        if (conversationService.getOwnedByConversationId(conversationId, currentUserId) == null) {
            // Return the same not-found response for an unknown id and an id
            // owned by another user; this avoids turning the endpoint into an
            // ownership oracle.
            throw new BusinessException(404, "对话不存在");
        }
        return CommonResult.success(messageService.listByConversation(conversationId));
    }

    @Operation(summary = "删除对话")
    @DeleteMapping("/conversations/{id}")
    public Mono<CommonResult<Boolean>> deleteConversation(@PathVariable Long id) {
        long currentUserId = requireCurrentUserId();
        return conversationService.deleteConversation(id, currentUserId)
                .thenReturn(CommonResult.success(true));
    }

    @Operation(summary = "按会话标识删除对话")
    @DeleteMapping("/conversations/by-conversation-id/{conversationId}")
    public Mono<CommonResult<Boolean>> deleteConversationByConversationId(
            @PathVariable String conversationId) {
        long currentUserId = requireCurrentUserId();
        return conversationService.deleteConversationByConversationId(
                        conversationId, currentUserId)
                .thenReturn(CommonResult.success(true));
    }
}

