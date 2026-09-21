package com.inneragent.server.controller;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageParam;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.agent.entity.AgentConversation;
import com.inneragent.agent.entity.AgentMessage;
import com.inneragent.platform.context.AppContext;
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
    private final com.inneragent.platform.safety.ContentSafetyGate safetyGate;

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
        List<AgentMessage> messages = messageService.listByConversation(conversationId);
        // [adapt] P2-safety W6:内容安全 egress 挂点——助手内容对外投递前过滤。
        // 挂点选择(消息投影读取路径,二选一取侵入最小者):
        // ① 投影写路径(AgentMessageProjectionService)带 run 行锁且重投影幂等
        //   断言(requireSameProjection)依赖内容确定性——时间敏感的过滤裁决会
        //   令恢复期重投影误判「投影漂移」崩溃,且在事务内阻塞外呼;
        // ② SSE 外发路径按 CONTENT 增量逐片装配(确认流事件装配只读不改),
        //   无「整段终答」单元,逐片裁决粒度失真;
        // ③ 本挂点在投影读取(记录页/历史接口)以整段助手消息为单位裁决,
        //   单点、零内核侵入、重放安全(只读不改存储)。已知边界:SSE 实时
        //   流的增量片段不经此路径(v1 范围外,报告留痕)。
        // block → 固定占位 + 审计;redact → 以脱敏文本对外;allow 原样。
        long appId = AppContext.currentOrDefault();
        for (AgentMessage message : messages) {
            if (!"assistant".equals(message.getRole()) || message.getContent() == null) {
                continue;
            }
            String filtered = safetyGate.filterEgress(
                    new com.inneragent.platform.safety.ContentSafetyFilter.Context(
                            appId, currentUserId, conversationId, message.getRunId()),
                    message.getContent());
            if (!filtered.equals(message.getContent())) {
                message.setContent(filtered);
            }
        }
        return CommonResult.success(messages);
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
