package com.inneragent.agent.attachment;

import com.inneragent.model.config.AiModelMultimodalCapabilities;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.controller.vo.AiMultimodalInputVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * 附件 url 形态内联解析(runs 组装前挂点)。
 *
 * <p>sdk-js 发送 url 传输附件时 {@code url} 为服务端签发的 API 根相对路径
 * {@code /attachments/{id}}({@link AgentAttachmentService#RESOURCE_PATH_PREFIX}),
 * 而 {@link AiModelMultimodalCapabilities} 对 url 输入强制 http(s) 绝对地址
 * → 相对路径附件提交 runs 必 400。本组件在该校验之前把该形态内联为
 * base64/data 输入:归属校验借附件读路径既有语义
 * ({@link AgentAttachmentService#read}:不存在/他人附件一律 404 不泄露存在性),
 * 字节经工作空间三后端读回,输出与既有 base64 传输同构(data 携带正文、
 * url 清空不残留),其余元数据(id/name/inputType/mimeType/resourceUrl)保留原值。
 *
 * <p>仅识别本服务签发的相对路径(数字尾缀);绝对 http(s) URL 与 base64 data
 * 输入零触达原样透传,非数字尾缀相对路径不当作附件(交由既有 url 校验定夺)。
 */
@Component
@RequiredArgsConstructor
public class AttachmentInlineResolver {

    private final AgentAttachmentService attachments;

    /**
     * 把 {@code /attachments/{id}} 形态的多模态输入内联为 base64/data 形态。
     *
     * @param inputs 多模态输入(可空)
     * @param userId 当前认证用户(附件归属判定)
     */
    public List<AiMultimodalInputVO> inline(List<AiMultimodalInputVO> inputs, long userId) {
        if (inputs == null) {
            return null;
        }
        if (inputs.isEmpty()) {
            return inputs;
        }
        List<AiMultimodalInputVO> resolved = new ArrayList<>(inputs.size());
        for (AiMultimodalInputVO input : inputs) {
            resolved.add(inlineOne(input, userId));
        }
        return resolved;
    }

    private AiMultimodalInputVO inlineOne(AiMultimodalInputVO input, long userId) {
        Long attachmentId = attachmentIdOf(input);
        if (attachmentId == null) {
            return input;
        }
        AgentAttachmentService.ReadAttachment attachment = attachments.read(userId, attachmentId);
        byte[] bytes = attachment.bytes();
        if (bytes.length > AiModelMultimodalCapabilities.MAX_BASE64_INPUT_BYTES) {
            // url 传输上传上限 20MB > base64 单输入上限 10MB:内联前按既有
            // MAX_BASE64_INPUT_BYTES 校验语义拦截(对齐 store base64 分支)
            throw new BusinessException(400, "附件内联后大小不能超过 10MB");
        }
        // 与既有 base64 传输同构:data 携带存储字节,url 清空(不残留 url 形态);
        // 原地改写即保持 id/name/inputType/mimeType/resourceUrl 输入原值
        input.setTransport(AiModelMultimodalCapabilities.TRANSPORT_BASE64);
        input.setData(Base64.getEncoder().encodeToString(bytes));
        input.setUrl(null);
        input.setSize((long) bytes.length);
        return input;
    }

    /** 识别本服务签发的 {@code /attachments/{id}} 相对路径;非该形态返回 null。 */
    private Long attachmentIdOf(AiMultimodalInputVO input) {
        if (input == null) {
            return null;
        }
        String url = input.getUrl();
        if (url == null || !url.startsWith(AgentAttachmentService.RESOURCE_PATH_PREFIX)) {
            return null;
        }
        String tail = url.substring(AgentAttachmentService.RESOURCE_PATH_PREFIX.length());
        try {
            long id = Long.parseLong(tail);
            return id > 0 ? id : null;
        } catch (NumberFormatException notAnAttachment) {
            // 非数字尾缀(如 /attachments/abc):不当作附件,原样透传给既有 url 校验
            return null;
        }
    }
}
