package com.inneragent.server.controller;

import com.inneragent.agent.attachment.AgentAttachmentService;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.GlobalExceptionHandler;
import com.inneragent.platform.security.SecurityUserDetails;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * [new] POST /ia/api/v1/attachments 契约(SDK attachments.ts):
 * multipart 字段 file/modelId/transport;data 为持久化引用字符串
 * (P2-srv 起为 API 根相对路径 /attachments/{id},SDK resolveMediaUrl
 * 拼接 baseURL 后可达);模型能力不符 → 400;modelId 缺失模型 → 404;
 * 鉴权走当前认证身份。
 *
 * <p>P2-srv 补 GET /{id} 读回:归属用户校验(他人/不存在一律 404),
 * 经工作空间三后端读回正文,Content-Type 按登记 MIME 回显。
 */
class AgentAttachmentControllerTests {

    private static final long CURRENT_USER_ID = 42L;

    private AgentAttachmentService attachments;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        attachments = mock(AgentAttachmentService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new AgentAttachmentController(attachments))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
        SecurityUserDetails user = new SecurityUserDetails(
                CURRENT_USER_ID, "owner", "secret", 1, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void uploadBindsContractFormFieldsAndReturnsResourceUrl() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file", "photo.png", "image/png", new byte[]{1, 2, 3});
        when(attachments.store(
                eq(CURRENT_USER_ID), eq("photo.png"), eq("image/png"),
                any(), eq(7L), eq("base64")))
                .thenReturn("/attachments/91");

        mockMvc.perform(multipart("/ia/api/v1/attachments")
                        .file(file)
                        .param("modelId", "7")
                        .param("transport", "base64"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data").value("/attachments/91"));

        verify(attachments).store(
                eq(CURRENT_USER_ID), eq("photo.png"), eq("image/png"),
                any(), eq(7L), eq("base64"));
    }

    @Test
    void uploadRejectsModelCapabilityViolationsAs400() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file", "clip.mp4", "video/mp4", new byte[]{1});
        when(attachments.store(
                anyLong(), anyString(), anyString(), any(), anyLong(), anyString()))
                .thenThrow(new BusinessException(400, "当前模型不支持 video 的 url 输入"));

        mockMvc.perform(multipart("/ia/api/v1/attachments")
                        .file(file)
                        .param("modelId", "7")
                        .param("transport", "url"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void readBackReturnsBytesWithRegisteredContentTypeForOwner() throws Exception {
        when(attachments.read(CURRENT_USER_ID, 91L))
                .thenReturn(new AgentAttachmentService.ReadAttachment(
                        new byte[]{1, 2, 3}, "image/png", "photo.png", 3L));

        mockMvc.perform(get("/ia/api/v1/attachments/91"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/png"))
                .andExpect(content().bytes(new byte[]{1, 2, 3}))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));

        verify(attachments).read(CURRENT_USER_ID, 91L);
    }

    @Test
    void readBackFallsBackToOctetStreamWhenMimeMissing() throws Exception {
        when(attachments.read(CURRENT_USER_ID, 92L))
                .thenReturn(new AgentAttachmentService.ReadAttachment(
                        new byte[]{4}, null, "blob.bin", 1L));

        mockMvc.perform(get("/ia/api/v1/attachments/92"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/octet-stream"));
    }

    @Test
    void readBackMapsNotFoundForMissingOrForeignAttachment() throws Exception {
        when(attachments.read(CURRENT_USER_ID, 404L))
                .thenThrow(new BusinessException(404, "附件不存在"));

        mockMvc.perform(get("/ia/api/v1/attachments/404"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(404));
    }
}
