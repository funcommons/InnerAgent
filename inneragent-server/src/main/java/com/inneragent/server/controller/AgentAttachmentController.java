package com.inneragent.server.controller;

import cn.hutool.core.util.StrUtil;
import com.inneragent.agent.attachment.AgentAttachmentService;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.CommonResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
 * {@code POST /api/storage/assistant-upload} → {@code POST /ia/api/v1/attachments};
 * P2-srv 补 {@code GET /{id}} 读回)。
 *
 * <p>上传契约(SDK attachments.ts):multipart 字段 file/modelId/transport;
 * 响应 data 为服务端持久化地址字符串 resourceUrl —— API 根相对路径
 * {@code /attachments/{id}}(SDK resolveMediaUrl 拼 baseURL 后可达,见
 * {@link AgentAttachmentService} 类注释最终约定)。鉴权走现有链
 * (embed token Bearer 或演示头 X-IA-Demo-User 均可)。
 *
 * <p>读回契约(P2-srv):归属用户校验(他人/不存在一律 404,不泄露存在性),
 * 经工作空间三后端读回正文;Content-Type 按登记 MIME 回显(缺省
 * application/octet-stream)+ {@code X-Content-Type-Options: nosniff} 防嗅探。
 * <strong>Range 分片请求不支持</strong>(整读整回;SDK 图片预览/媒体卡片
 * 无分片诉求,如未来音视频拖动播放需要再按 RFC 9110 §14 登记 206 语义)。
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

    @GetMapping("/{id}")
    @Operation(summary = "读回附件正文(归属用户校验,404 不泄露存在性)")
    public ResponseEntity<byte[]> read(@PathVariable long id) {
        long userId = requireCurrentUserId();
        AgentAttachmentService.ReadAttachment attachment = attachments.read(userId, id);
        return ResponseEntity.ok()
                .contentType(resolveContentType(attachment.mimeType()))
                .contentLength(attachment.bytes().length)
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                .header("X-Content-Type-Options", "nosniff")
                .body(attachment.bytes());
    }

    /** 登记 MIME → Content-Type(空/非法值回落 application/octet-stream)。 */
    private static MediaType resolveContentType(String mimeType) {
        if (StrUtil.isBlank(mimeType)) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
        try {
            return MediaType.parseMediaType(mimeType);
        } catch (InvalidMediaTypeException invalidMimeType) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
    }
}
