package com.inneragent.agent.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.TenantBaseEntity;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * 对话附件登记行(V7 ia_agent_attachment;正文落智能体工作空间三后端)。
 */
@TableName("ia_agent_attachment")
@Data
@EqualsAndHashCode(callSuper = true)
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AgentAttachment extends TenantBaseEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    private Long modelId;

    private String fileName;

    private String mimeType;

    /** 输入类型:image/video/audio/file(按 MIME 推导)。 */
    private String inputType;

    /** 请求传输方式:url/base64(须在模型能力白名单内)。 */
    private String transport;

    private Long sizeBytes;

    /** 正文所在后端:database/local/object_storage(随工作空间配置)。 */
    private String backendType;

    private Long storageConfigId;

    private String localPath;

    private String contentRef;

    private String contentSha256;

    /** database 后端正文(Base64);local/object_storage 后端为空。 */
    private String payload;
}
