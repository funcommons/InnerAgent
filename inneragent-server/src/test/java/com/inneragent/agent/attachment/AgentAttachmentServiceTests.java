package com.inneragent.agent.attachment;

import com.inneragent.agent.entity.AgentAttachment;
import com.inneragent.agent.mapper.AgentAttachmentMapper;
import com.inneragent.agent.workspace.AgentWorkspaceBackend;
import com.inneragent.agent.workspace.AgentWorkspaceConfigService;
import com.inneragent.agent.workspace.AgentWorkspaceLocation;
import com.inneragent.agent.workspace.AgentWorkspacePayloadService;
import com.inneragent.agent.workspace.AgentWorkspaceStoredPayload;
import com.inneragent.model.config.AiModelService;
import com.inneragent.model.entity.AiModel;
import com.inneragent.platform.common.BusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * [new] 对话附件上传服务(P1-T3b):模型能力校验(融光语义)、大小上限、
 * 工作空间三后端落盘与元数据登记、resourceUrl 契约。
 */
class AgentAttachmentServiceTests {

    private static final long USER_ID = 42L;

    private AiModelService aiModelService;
    private AgentWorkspaceConfigService workspaceConfigService;
    private AgentWorkspacePayloadService payloadService;
    private AgentAttachmentMapper attachmentMapper;
    private AgentAttachmentService service;

    @BeforeEach
    void setUp() {
        aiModelService = mock(AiModelService.class);
        workspaceConfigService = mock(AgentWorkspaceConfigService.class);
        payloadService = mock(AgentWorkspacePayloadService.class);
        attachmentMapper = mock(AgentAttachmentMapper.class);
        service = new AgentAttachmentService(
                aiModelService, workspaceConfigService, payloadService, attachmentMapper);
        when(workspaceConfigService.lockWritableLocation()).thenReturn(
                new AgentWorkspaceLocation(AgentWorkspaceBackend.DATABASE, null, null));
    }

    private AiModel visionModel() {
        return AiModel.builder()
                .id(7L)
                .code("mock-text")
                .modelType(1)
                .status(1)
                .multimodalInputTypes(List.of("image", "file"))
                .multimodalInputTransports(Map.of(
                        "image", List.of("url", "base64"),
                        "file", List.of("url", "base64")))
                .build();
    }

    private AgentWorkspaceStoredPayload stored(String payload) {
        return new AgentWorkspaceStoredPayload(
                AgentWorkspaceBackend.DATABASE, null, null, null, payload,
                "a".repeat(64), payload.length());
    }

    @Test
    void storesAttachmentInWorkspaceAndReturnsContractResourceUrl() {
        when(aiModelService.getById(7L)).thenReturn(visionModel());
        when(payloadService.writeBytes(
                any(), any(AgentWorkspaceLocation.class), eq("png"), eq("image/png")))
                .thenReturn(stored("aGVsbG8="));
        when(attachmentMapper.insert(any(AgentAttachment.class))).thenAnswer(invocation -> {
            invocation.getArgument(0, AgentAttachment.class).setId(91L);
            return 1;
        });

        String resourceUrl = service.store(
                USER_ID, "photo.PNG", "image/png", new byte[]{1, 2, 3}, 7L, "base64");

        // P2-srv 最终约定:resourceUrl 为 API 根相对路径(/attachments/{id})。
        // SDK resolveMediaUrl 对 / 开头路径拼接 `${getBaseURL()}${url}`(默认
        // /ia/api/v1),拼出 /ia/api/v1/attachments/91;若服务端回完整前缀会双前缀。
        assertThat(resourceUrl).isEqualTo("/attachments/91");
        ArgumentCaptor<AgentAttachment> row = ArgumentCaptor.forClass(AgentAttachment.class);
        verify(attachmentMapper).insert(row.capture());
        assertThat(row.getValue().getUserId()).isEqualTo(USER_ID);
        assertThat(row.getValue().getModelId()).isEqualTo(7L);
        assertThat(row.getValue().getInputType()).isEqualTo("image");
        assertThat(row.getValue().getTransport()).isEqualTo("base64");
        assertThat(row.getValue().getSizeBytes()).isEqualTo(3L);
        assertThat(row.getValue().getPayload()).isEqualTo("aGVsbG8=");
    }

    @Test
    void readsBackAttachmentBytesForOwningUser() {
        when(attachmentMapper.selectById(91L)).thenReturn(attachment(91L, USER_ID));
        when(payloadService.readBytes(any(AgentWorkspaceStoredPayload.class)))
                .thenReturn(new byte[]{1, 2, 3});

        AgentAttachmentService.ReadAttachment read = service.read(USER_ID, 91L);

        assertThat(read.bytes()).containsExactly(1, 2, 3);
        assertThat(read.mimeType()).isEqualTo("image/png");
        assertThat(read.fileName()).isEqualTo("photo.png");
        assertThat(read.sizeBytes()).isEqualTo(3L);
        ArgumentCaptor<AgentWorkspaceStoredPayload> payload =
                ArgumentCaptor.forClass(AgentWorkspaceStoredPayload.class);
        verify(payloadService).readBytes(payload.capture());
        assertThat(payload.getValue().backendType()).isEqualTo(AgentWorkspaceBackend.DATABASE);
        assertThat(payload.getValue().databasePayload()).isEqualTo("aGVsbG8=");
    }

    @Test
    void readReturns404ForMissingOrForeignAttachment() {
        // 不存在 → 404
        when(attachmentMapper.selectById(404L)).thenReturn(null);
        assertThatThrownBy(() -> service.read(USER_ID, 404L))
                .isInstanceOfSatisfying(BusinessException.class, error ->
                        assertThat(error.getCode()).isEqualTo(404));

        // 他人附件 → 同样 404(不泄露存在性)
        when(attachmentMapper.selectById(91L)).thenReturn(attachment(91L, 999L));
        assertThatThrownBy(() -> service.read(USER_ID, 91L))
                .isInstanceOfSatisfying(BusinessException.class, error ->
                        assertThat(error.getCode()).isEqualTo(404));

        verify(payloadService, never()).readBytes(any());
    }

    private AgentAttachment attachment(Long id, long userId) {
        return AgentAttachment.builder()
                .id(id)
                .userId(userId)
                .modelId(7L)
                .fileName("photo.png")
                .mimeType("image/png")
                .inputType("image")
                .transport("base64")
                .sizeBytes(3L)
                .backendType(AgentWorkspaceBackend.DATABASE)
                .contentRef(null)
                .contentSha256("a".repeat(64))
                .payload("aGVsbG8=")
                .build();
    }

    @Test
    void rejectsUploadWithoutModelCapabilityContract() {
        // modelId 缺失 → 404(融光语义:模型不存在)
        assertThatThrownBy(() -> service.store(
                USER_ID, "a.png", "image/png", new byte[]{1}, null, "base64"))
                .isInstanceOfSatisfying(BusinessException.class, error ->
                        assertThat(error.getCode()).isEqualTo(404));

        // 类型不在模型能力白名单 → 400
        when(aiModelService.getById(7L)).thenReturn(visionModel());
        assertThatThrownBy(() -> service.store(
                USER_ID, "clip.mp4", "video/mp4", new byte[]{1}, 7L, "url"))
                .isInstanceOfSatisfying(BusinessException.class, error ->
                        assertThat(error.getCode()).isEqualTo(400));

        verify(attachmentMapper, never()).insert(any(AgentAttachment.class));
    }

    @Test
    void enforcesTransportSizeCaps() {
        when(aiModelService.getById(7L)).thenReturn(visionModel());
        byte[] oversized = new byte[
                com.inneragent.model.config.AiModelMultimodalCapabilities.MAX_BASE64_INPUT_BYTES + 1];

        assertThatThrownBy(() -> service.store(
                USER_ID, "big.png", "image/png", oversized, 7L, "base64"))
                .isInstanceOfSatisfying(BusinessException.class, error ->
                        assertThat(error.getMessage()).contains("10MB"));
        verify(attachmentMapper, never()).insert(any(AgentAttachment.class));
    }

    @Test
    void rejectsEmptyUpload() {
        assertThatThrownBy(() -> service.store(
                USER_ID, "empty.png", "image/png", new byte[0], 7L, "base64"))
                .isInstanceOfSatisfying(BusinessException.class, error ->
                        assertThat(error.getCode()).isEqualTo(400));
    }

    @Test
    void cleansUpWrittenPayloadWhenMetadataInsertFails() {
        when(aiModelService.getById(7L)).thenReturn(visionModel());
        AgentWorkspaceStoredPayload stored = stored("aGVsbG8=");
        when(payloadService.writeBytes(any(), any(), any(), any())).thenReturn(stored);
        when(attachmentMapper.insert(any(AgentAttachment.class)))
                .thenThrow(new IllegalStateException("db down"));

        assertThatThrownBy(() -> service.store(
                USER_ID, "photo.png", "image/png", new byte[]{1}, 7L, "base64"))
                .isInstanceOf(IllegalStateException.class);

        verify(payloadService).delete(stored);
    }
}
