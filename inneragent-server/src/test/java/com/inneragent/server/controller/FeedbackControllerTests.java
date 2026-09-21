package com.inneragent.server.controller;

import com.inneragent.agent.entity.AgentFeedback;
import com.inneragent.agent.feedback.AgentFeedbackService;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.security.SecurityUserDetails;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 用户反馈 API 切片测试(W15):embed 用户态(requireCurrentUserId)驱动的
 * 提交/查询路由语义 + 行级归属透传 + 未登录 401。
 */
class FeedbackControllerTests {

    private static final String BASE = "/ia/api/v1/feedback";

    private AgentFeedbackService feedbackService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        feedbackService = Mockito.mock(AgentFeedbackService.class);
        FeedbackController controller = new FeedbackController(feedbackService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new FeedbackControllerTests.Advice())
                .build();
        authenticate(10001L);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("提交:当前用户态透传服务层;响应回显维度与取向")
    void submitPassesScopedIdentity() throws Exception {
        when(feedbackService.submit(eq(1L), eq(10001L), any()))
                .thenReturn(row(7L));
        mockMvc.perform(post(BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "conversationId": "conv-1",
                                  "messageId": "42",
                                  "rating": "up",
                                  "comment": "很棒"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(7))
                .andExpect(jsonPath("$.data.rating").value("UP"))
                .andExpect(jsonPath("$.data.messageId").value("42"));
    }

    @Test
    @DisplayName("同会话反馈查询:conversationId 过滤透传;无用户态被服务层拒绝")
    void listScopedAndRequiresAuthentication() throws Exception {
        when(feedbackService.listMine(1L, 10001L, "conv-1", null))
                .thenReturn(List.of(row(7L)));
        mockMvc.perform(get(BASE).param("conversationId", "conv-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].conversationId").value("conv-1"));

        // 切片无过滤器链:真实 401 由 EmbedTokenAuthenticationFilter 上游拦截;
        // 此处断言兜底语义——无用户态时 requireCurrentUserId 拒绝进入服务层
        SecurityContextHolder.clearContext();
        mockMvc.perform(get(BASE))
                .andExpect(status().isInternalServerError());
    }

    private static AgentFeedback row(long id) {
        AgentFeedback feedback = AgentFeedback.builder()
                .appId(1L).userId(10001L).conversationId("conv-1")
                .messageId("42").rating("UP").comment("很棒")
                .build();
        feedback.setId(id);
        feedback.setCreateTime(LocalDateTime.of(2026, 9, 21, 0, 0));
        feedback.setUpdateTime(LocalDateTime.of(2026, 9, 21, 0, 0));
        return feedback;
    }

    private void authenticate(long userId) {
        SecurityUserDetails user = new SecurityUserDetails(
                userId, "owner", "secret", 1, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    /** 测试态异常映射:BusinessException.code → HTTP 状态 + CommonResult 体。 */
    @org.springframework.web.bind.annotation.RestControllerAdvice
    static class Advice {

        @org.springframework.web.bind.annotation.ExceptionHandler(BusinessException.class)
        org.springframework.http.ResponseEntity<Object> onBusinessException(BusinessException e) {
            return org.springframework.http.ResponseEntity
                    .status(e.getCode() == null ? 500 : e.getCode())
                    .body(com.inneragent.platform.common.CommonResult.error(
                            e.getCode() == null ? 500 : e.getCode(), e.getMessage()));
        }
    }
}
