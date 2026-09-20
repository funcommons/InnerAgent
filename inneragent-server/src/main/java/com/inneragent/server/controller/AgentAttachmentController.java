package com.inneragent.server.controller;

import com.inneragent.agent.attachment.AgentAttachmentService;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.CommonResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

import static com.inneragent.platform.common.CommonResult.success;
import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * 对话附件 Controller(02-技术方案 §7.1:融光
 * {@code POST /api/storage/assistant-upload} → {@code POST /ia/api/v1/attachments})。
 *
 * <p>契约(SDK attachments.ts):multipart 字段 file/modelId/transport;
 * 响应 data 为服务端持久化地址字符串(resourceUrl)。鉴权走现有链
 * (embed token Bearer 或演示头 X-IA-Demo-User 均可)。
 */
@Tag(name = "对话附件")
@RestController
@RequestMapping("/ia/api/v1/attachments")
@RequiredArgsConstructor
public class AgentAttachmentController {

    private final AgentAttachmentService attachments;

    @PostMapping
    @Operation(summary = "上传对话附件,返回持久化引用")
    public CommonResult<String> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam("modelId") Long modelId,
            @RequestParam("transport") String transport) {
        long userId = requireCurrentUserId();
        if (file == null || file.isEmpty()) {
            throw new BusinessException(400, "附件内容为空");
        }
        String mimeType = file.getContentType();
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException readFailure) {
            throw new BusinessException(400, "附件读取失败: " + readFailure.getMessage());
        }
        return success(attachments.store(
                userId, file.getOriginalFilename(), mimeType, bytes, modelId, transport));
    }
}
