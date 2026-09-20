package com.inneragent.agent.attachment;

import cn.hutool.core.util.StrUtil;
import com.inneragent.agent.entity.AgentAttachment;
import com.inneragent.agent.mapper.AgentAttachmentMapper;
import com.inneragent.agent.workspace.AgentWorkspaceConfigService;
import com.inneragent.agent.workspace.AgentWorkspaceLocation;
import com.inneragent.agent.workspace.AgentWorkspacePayloadService;
import com.inneragent.agent.workspace.AgentWorkspaceStoredPayload;
import com.inneragent.model.config.AiModelMultimodalCapabilities;
import com.inneragent.model.config.AiModelService;
import com.inneragent.model.entity.AiModel;
import com.inneragent.platform.common.BusinessException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Objects;

/**
 * 对话附件上传/读回服务(02-技术方案 §7.1:POST、GET /ia/api/v1/attachments)。
 *
 * <p>校验沿用融光语义({@link AiModelMultimodalCapabilities#validateUpload}):
 * 附件 MIME 推导的输入类型与请求的传输方式必须落在目标对话模型的能力白名单内;
 * 大小上限对齐既有约定 —— base64 传输 ≤ 10MB(单 Base64 输入上限),
 * url 传输 ≤ 20MB(Spring multipart 上限一致)。
 *
 * <p>正文落智能体工作空间三后端(database/local/object_storage),复用
 * P1 台账④的 ia_agent_workspace_config → ia_storage_config 加载链路;
 * 本服务登记元数据行(ia_agent_attachment)并返回持久化引用 resourceUrl。
 *
 * <p><strong>media URL 最终约定(P2-srv 裁定)</strong>:resourceUrl 返回
 * <strong>API 根相对路径</strong> {@code /attachments/{id}}。SDK
 * {@code resolveMediaUrl}(sdk-js packages/core/src/mediaUrl.ts,禁改)对
 * {@code /} 开头路径拼接 {@code ${getBaseURL()}${url}}(默认 {@code /ia/api/v1},
 * 可配绝对地址),拼出 {@code /ia/api/v1/attachments/{id}} 即可达;若服务端
 * 回完整 {@code /ia/api/v1/...} 前缀会产生双前缀(bug)。
 */
@Service
@RequiredArgsConstructor
public class AgentAttachmentService {

    /**
     * 对外暴露的持久化引用前缀(SDK resourceUrl 契约):API 根相对路径,
     * 由 SDK resolveMediaUrl 拼接 baseURL 后可达(见类注释最终约定)。
     */
    public static final String RESOURCE_PATH_PREFIX = "/attachments/";

    /** url 传输附件上限(与 spring.servlet.multipart.max-file-size 对齐)。 */
    public static final long MAX_URL_TRANSPORT_BYTES = 20L * 1024 * 1024;

    private final AiModelService aiModelService;
    private final AgentWorkspaceConfigService workspaceConfigService;
    private final AgentWorkspacePayloadService payloadService;
    private final AgentAttachmentMapper attachmentMapper;

    /**
     * 校验并保存附件,返回持久化引用(resourceUrl)。
     *
     * @param userId    上传用户(当前认证身份)
     * @param fileName  原始文件名(可空)
     * @param mimeType  文件 MIME 类型(multipart Content-Type)
     * @param bytes     文件字节
     * @param modelId   能力校验所用对话模型 ID(SDK 必传)
     * @param transport 请求传输方式:url/base64
     */
    public String store(
            long userId,
            String fileName,
            String mimeType,
            byte[] bytes,
            Long modelId,
            String transport) {
        if (userId <= 0) {
            throw new IllegalArgumentException("userId must be positive");
        }
        Objects.requireNonNull(bytes, "bytes must not be null");
        if (bytes.length == 0) {
            throw new BusinessException(400, "附件内容为空");
        }
        // 融光语义:modelId 缺失/模型不存在 → 404;类型/传输不在模型能力白名单 → 400
        AiModel model = modelId == null ? null : aiModelService.getById(modelId);
        String inputType = AiModelMultimodalCapabilities.validateUpload(
                model, mimeType, transport);
        String normalizedTransport = transport == null ? "" : transport.trim().toLowerCase(Locale.ROOT);
        if (AiModelMultimodalCapabilities.TRANSPORT_BASE64.equals(normalizedTransport)
                && bytes.length > AiModelMultimodalCapabilities.MAX_BASE64_INPUT_BYTES) {
            throw new BusinessException(400, "base64 传输附件大小不能超过 10MB");
        }
        if (AiModelMultimodalCapabilities.TRANSPORT_URL.equals(normalizedTransport)
                && bytes.length > MAX_URL_TRANSPORT_BYTES) {
            throw new BusinessException(400, "附件大小不能超过 20MB");
        }

        // 迁移锁定期间拒绝写入(lockWritableLocation 读 ia_agent_workspace_config,
        // 其 storage_config_id 经 ia_storage_config 加载,即 P1 台账④链路)
        AgentWorkspaceLocation location = workspaceConfigService.lockWritableLocation();
        AgentWorkspaceStoredPayload stored = payloadService.writeBytes(
                bytes, location, extensionOf(fileName), mimeType);

        try {
            AgentAttachment attachment = AgentAttachment.builder()
                    .userId(userId)
                    .modelId(modelId)
                    .fileName(StrUtil.blankToDefault(fileName, "attachment"))
                    .mimeType(mimeType)
                    .inputType(inputType)
                    .transport(normalizedTransport)
                    .sizeBytes((long) bytes.length)
                    .backendType(stored.backendType())
                    .storageConfigId(stored.storageConfigId())
                    .localPath(stored.localPath())
                    .contentRef(stored.contentRef())
                    .contentSha256(stored.sha256())
                    .payload(stored.databasePayload())
                    .build();
            attachmentMapper.insert(attachment);
            return RESOURCE_PATH_PREFIX + attachment.getId();
        } catch (RuntimeException insertFailure) {
            // 元数据落库失败:回收已写入的正文,避免悬空对象
            payloadService.delete(stored);
            throw insertFailure;
        }
    }

    /**
     * 附件读回(P2-srv GET /ia/api/v1/attachments/{id}):归属用户校验 +
     * 经工作空间三后端读回正文。
     *
     * <p>鉴权语义:附件不存在<strong>或不属于当前用户</strong>一律 404
     * (不向越权方泄露资源存在性)。
     *
     * @param userId       当前认证用户
     * @param attachmentId 附件登记行 ID
     */
    public ReadAttachment read(long userId, long attachmentId) {
        if (userId <= 0) {
            throw new IllegalArgumentException("userId must be positive");
        }
        AgentAttachment attachment = attachmentMapper.selectById(attachmentId);
        if (attachment == null || attachment.getUserId() == null
                || attachment.getUserId() != userId) {
            throw new BusinessException(404, "附件不存在");
        }
        byte[] bytes = payloadService.readBytes(new AgentWorkspaceStoredPayload(
                attachment.getBackendType(),
                attachment.getStorageConfigId(),
                attachment.getLocalPath(),
                attachment.getContentRef(),
                attachment.getPayload(),
                attachment.getContentSha256(),
                attachment.getSizeBytes() == null ? 0L : attachment.getSizeBytes()));
        return new ReadAttachment(
                bytes, attachment.getMimeType(), attachment.getFileName(), bytes.length);
    }

    /** 附件读回结果(正文 + 响应头元数据)。 */
    public record ReadAttachment(
            byte[] bytes,
            String mimeType,
            String fileName,
            long sizeBytes) {
    }

    private static String extensionOf(String fileName) {
        if (StrUtil.isBlank(fileName)) {
            return "bin";
        }
        String name = fileName.trim();
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) {
            return "bin";
        }
        String extension = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        return extension.matches("[a-z0-9]{1,8}") ? extension : "bin";
    }
}
