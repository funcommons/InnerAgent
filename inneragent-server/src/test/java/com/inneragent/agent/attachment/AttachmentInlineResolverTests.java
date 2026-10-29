package com.inneragent.agent.attachment;

import com.inneragent.agent.entity.AgentAttachment;
import com.inneragent.agent.mapper.AgentAttachmentMapper;
import com.inneragent.agent.workspace.AgentWorkspaceBackend;
import com.inneragent.agent.workspace.AgentWorkspaceConfigService;
import com.inneragent.agent.workspace.AgentWorkspacePayloadService;
import com.inneragent.agent.workspace.AgentWorkspaceStoredPayload;
import com.inneragent.model.config.AiModelMultimodalCapabilities;
import com.inneragent.model.config.AiModelService;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.controller.vo.AiMultimodalInputVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * [red] 附件 url 形态内联解析({@code AttachmentInlineResolver},实现待落地)。
 *
 * <p>缺陷背景:sdk-js 发送 url 传输附件时 {@code url} 为 API 根相对路径
 * {@code /attachments/{id}}(sdk-js packages/components/src/assistant/
 * assistantMultimodal.ts:247 附近 {@code url: resourceUrl}),而
 * {@link AiModelMultimodalCapabilities} 对 url 输入强制 http(s) 绝对地址
 * → 相对路径附件提交 runs 必 400。修复语义:runs 组装前把该形态内联为
 * base64/data 输入 —— 归属校验借附件读路径既有语义({@link AgentAttachmentService#read}:
 * 他人/不存在一律 404 不泄露存在性),字节经工作空间三后端读回,输出与
 * 既有 base64 传输同构(data 携带正文、url 清空不残留)。
 *
 * <p>构造方式对齐 {@code AgentAttachmentServiceTests}:真实
 * {@link AgentAttachmentService} 挂 mock 协作者(数据库一律 mock,不碰真库),
 * 使 404/越权用例走的是真实归属判定而非桩替身。
 */
class AttachmentInlineResolverTests {

    private static final long USER_ID = 42L;

    private AgentWorkspacePayloadService payloadService;
    private AgentAttachmentMapper attachmentMapper;
    private AgentAttachmentService attachments;
    private AttachmentInlineResolver resolver;

    @BeforeEach
    void setUp() {
        AiModelService aiModelService = mock(AiModelService.class);
        AgentWorkspaceConfigService workspaceConfigService = mock(AgentWorkspaceConfigService.class);
        payloadService = mock(AgentWorkspacePayloadService.class);
        attachmentMapper = mock(AgentAttachmentMapper.class);
        attachments = new AgentAttachmentService(
                aiModelService, workspaceConfigService, payloadService, attachmentMapper);
        resolver = new AttachmentInlineResolver(attachments);
    }

    @Test
    void inlinesOwnRelativeAttachmentUrlIntoBase64Form() {
        byte[] bytes = {1, 2, 3};
        when(attachmentMapper.selectById(91L)).thenReturn(attachment(91L, USER_ID, bytes.length));
        when(payloadService.readBytes(any(AgentWorkspaceStoredPayload.class))).thenReturn(bytes);

        List<AiMultimodalInputVO> out = resolver.inline(
                List.of(relativeUrlInput(91L)), USER_ID);

        assertThat(out).hasSize(1);
        AiMultimodalInputVO inlined = out.get(0);
        // 与既有 base64 传输同构:data 携带存储字节,url 清空(不残留 url 形态)
        assertThat(inlined.getTransport()).isEqualTo("base64");
        assertThat(inlined.getData())
                .isEqualTo(Base64.getEncoder().encodeToString(bytes));
        assertThat(inlined.getUrl()).isNull();
        assertThat(inlined.getSize()).isEqualTo((long) bytes.length);
        // 其余元数据保持输入原值
        assertThat(inlined.getId()).isEqualTo("att-91");
        assertThat(inlined.getName()).isEqualTo("photo.png");
        assertThat(inlined.getInputType()).isEqualTo("image");
        assertThat(inlined.getMimeType()).isEqualTo("image/png");
    }

    @Test
    void foreignAttachmentYieldsReadPath404() {
        // 他人附件(属主 999):与读路径越权同码(BusinessException 404)
        when(attachmentMapper.selectById(91L)).thenReturn(attachment(91L, 999L, 3));

        assertThatThrownBy(() -> resolver.inline(List.of(relativeUrlInput(91L)), USER_ID))
                .isInstanceOfSatisfying(BusinessException.class, error ->
                        assertThat(error.getCode()).isEqualTo(404));
        // 越权方拿不到任何字节
        verify(payloadService, never()).readBytes(any());
    }

    @Test
    void missingAttachmentYieldsSame404WithoutExistenceLeak() {
        when(attachmentMapper.selectById(404L)).thenReturn(null);
        // 他人附件对照(同一附件 ID,不同属主),证明不存在与越权文案一致
        when(attachmentMapper.selectById(91L)).thenReturn(attachment(91L, 999L, 3));

        BusinessException missing = catchThrowableOfType(
                () -> resolver.inline(List.of(relativeUrlInput(404L)), USER_ID),
                BusinessException.class);
        BusinessException foreign = catchThrowableOfType(
                () -> resolver.inline(List.of(relativeUrlInput(91L)), USER_ID),
                BusinessException.class);

        assertThat(missing.getCode()).isEqualTo(404);
        assertThat(foreign.getCode()).isEqualTo(404);
        // 不泄露存在性:两者异常语义完全一致
        assertThat(missing.getMessage()).isEqualTo(foreign.getMessage());
        verify(payloadService, never()).readBytes(any());
    }

    @Test
    void absoluteHttpAndHttpsUrlsPassThroughUnchanged() {
        AiMultimodalInputVO https = relativeUrlInput(91L);
        https.setUrl("https://example.com/cat.png");
        AiMultimodalInputVO http = relativeUrlInput(92L);
        http.setUrl("http://example.com/dog.png");

        List<AiMultimodalInputVO> out = resolver.inline(List.of(https, http), USER_ID);

        // 原样透传:同对象/同字段,transport/url 均不被改写
        assertThat(out).containsExactly(https, http);
        assertThat(out.get(0).getUrl()).isEqualTo("https://example.com/cat.png");
        assertThat(out.get(1).getUrl()).isEqualTo("http://example.com/dog.png");
        assertThat(out.get(0).getData()).isNull();
        // 绝对 URL 不触发附件解析
        verify(attachmentMapper, never()).selectById(any());
    }

    @Test
    void base64DataInputPassesThroughUnchanged() {
        AiMultimodalInputVO input = relativeUrlInput(91L);
        input.setTransport("base64");
        input.setUrl(null);
        input.setData("AQID");
        input.setSize(3L);

        List<AiMultimodalInputVO> out = resolver.inline(List.of(input), USER_ID);

        assertThat(out).containsExactly(input);
        verify(attachmentMapper, never()).selectById(any());
        verify(payloadService, never()).readBytes(any());
    }

    @Test
    void mixedListResolvesEachKindAndPreservesOrder() {
        byte[] first = {1, 2, 3};
        byte[] second = {4, 5, 6, 7};
        when(attachmentMapper.selectById(91L)).thenReturn(attachment(91L, USER_ID, first.length));
        when(attachmentMapper.selectById(92L)).thenReturn(attachment(92L, USER_ID, second.length));
        when(payloadService.readBytes(any(AgentWorkspaceStoredPayload.class)))
                .thenReturn(first, second);

        AiMultimodalInputVO absolute = relativeUrlInput(93L);
        absolute.setUrl("https://cdn.example.com/cover.png");
        AiMultimodalInputVO data = relativeUrlInput(94L);
        data.setTransport("base64");
        data.setUrl(null);
        data.setData("AQID");
        data.setSize(3L);

        List<AiMultimodalInputVO> out = resolver.inline(List.of(
                relativeUrlInput(91L), absolute, data, relativeUrlInput(92L)), USER_ID);

        assertThat(out).hasSize(4);
        // [0] 相对路径 → 内联 base64
        assertThat(out.get(0).getTransport()).isEqualTo("base64");
        assertThat(out.get(0).getData())
                .isEqualTo(Base64.getEncoder().encodeToString(first));
        assertThat(out.get(0).getUrl()).isNull();
        // [1]/[2] 绝对 URL 与 base64 data → 原样透传
        assertThat(out.get(1)).isSameAs(absolute);
        assertThat(out.get(2)).isSameAs(data);
        // [3] 第二个相对路径 → 各自取到各自字节,顺序保持
        assertThat(out.get(3).getTransport()).isEqualTo("base64");
        assertThat(out.get(3).getData())
                .isEqualTo(Base64.getEncoder().encodeToString(second));
        assertThat(out.get(3).getUrl()).isNull();
    }

    @Test
    void nullAndEmptyInputsAreNullSafe() {
        assertThat(resolver.inline(null, USER_ID)).isNull();
        assertThat(resolver.inline(List.of(), USER_ID)).isEmpty();
        verify(attachmentMapper, never()).selectById(any());
    }

    @Test
    void oversizedAttachmentRejectedWithExistingBase64CapSemantics() {
        // url 传输上传上限 20MB > base64 单输入上限 10MB:url 附件内联为 base64
        // 前必须按既有 MAX_BASE64_INPUT_BYTES 校验语义拦截(400,文案含 10MB)。
        byte[] oversized = new byte[
                AiModelMultimodalCapabilities.MAX_BASE64_INPUT_BYTES + 1];
        when(attachmentMapper.selectById(91L)).thenReturn(attachment(91L, USER_ID, oversized.length));
        when(payloadService.readBytes(any(AgentWorkspaceStoredPayload.class)))
                .thenReturn(oversized);

        assertThatThrownBy(() -> resolver.inline(List.of(relativeUrlInput(91L)), USER_ID))
                .isInstanceOfSatisfying(BusinessException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(400);
                    assertThat(error.getMessage()).contains("10MB");
                });
    }

    /** sdk-js 实际发出的 url 传输附件输入(url = API 根相对路径)。 */
    private AiMultimodalInputVO relativeUrlInput(long attachmentId) {
        AiMultimodalInputVO input = new AiMultimodalInputVO();
        input.setId("att-" + attachmentId);
        input.setName("photo.png");
        input.setInputType("image");
        input.setMimeType("image/png");
        input.setTransport("url");
        input.setUrl(AgentAttachmentService.RESOURCE_PATH_PREFIX + attachmentId);
        input.setSize(3L);
        return input;
    }

    /** 附件登记行(database 后端),字段对齐 AgentAttachmentServiceTests。 */
    private AgentAttachment attachment(Long id, long userId, long sizeBytes) {
        return AgentAttachment.builder()
                .id(id)
                .userId(userId)
                .modelId(7L)
                .fileName("photo.png")
                .mimeType("image/png")
                .inputType("image")
                .transport("url")
                .sizeBytes(sizeBytes)
                .backendType(AgentWorkspaceBackend.DATABASE)
                .contentRef(null)
                .contentSha256("a".repeat(64))
                .payload("AQID")
                .build();
    }
}
