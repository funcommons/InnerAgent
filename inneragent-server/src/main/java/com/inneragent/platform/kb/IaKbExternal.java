package com.inneragent.platform.kb;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 外部知识库登记实体(ia_kb_external,V26 DDL,列注释见迁移脚本;契约源
 * 06-外部知识库API规范.md §2)。业务表携带 app_id(不在
 * {@code AppTenantLineInnerInterceptor#IGNORED_TABLES}),行级 app_id/
 * tenant_id 由拦截器注入/过滤(tenant_id 不映射,V24 同款);credentials
 * 只存管理面,出参经 {@link KbExternalConfigService} 脱敏,不回显、不进审计。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ia_kb_external")
public class IaKbExternal extends BaseEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long appId;

    /** 展示名(appId+name 活跃行唯一) */
    private String name;

    /** 宿主检索端点(POST) */
    private String endpointUrl;

    /** 鉴权策略:NONE / STATIC_HEADER(DDL CHECK) */
    private String authType;

    /** 静态头名(authType=STATIC_HEADER 时成对必填) */
    private String headerName;

    /** 静态头值/凭据(只存管理面,不回显、不进审计) */
    private String credentials;

    private String status;

    /** 单次检索超时(毫秒,§3 默认 10s;接线见 {@link KbExternalRetrievalClient}) */
    private Integer timeoutMs;
}
