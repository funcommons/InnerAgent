package com.inneragent.server.controller;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageParam;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.agent.entity.AgentConversation;
import com.inneragent.agent.entity.AgentMessage;
import com.inneragent.agent.conversation.AgentConversationService;
import com.inneragent.agent.conversation.AgentMessageService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

import java.util.List;

import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * 对话历史 Controller(当前用户的会话与消息)。
 *
 * <p>[adapt] P1-T3b 契约收口(02-技术方案 §7.1 ADR-T4,一次性切换不留旧别名):
 * 融光 {@code /api/ai/assistant/conversations*} → {@code /ia/api/v1/conversations*}。
 * 可引用 Skill/MCP 目录(reference-options)按 SDK 契约迁至
 * {@link MeController#getReferenceOptions()};流式端点由
 * {@link AiPipelineController} 承载 —— 助手聊天与 Run 共用同一套 SSE 契约。
 */
@Tag(name = "会话")
@RestController
@RequestMapping("/ia/api/v1")
@RequiredArgsConstructor
public class AiAssistantController {

    private final AgentConversationService conversationService;
    private final AgentMessageService messageService;

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
