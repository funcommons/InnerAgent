package com.inneragent.platform.common;

import com.baomidou.mybatisplus.annotation.TableField;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 携带租户（tenant_id = ia_team.id）的业务实体基类。
 * 平台级配置实体（系统配置、模型、存储等）继续直接继承 {@link BaseEntity}。
 */
@Data
@EqualsAndHashCode(callSuper = true)
public abstract class TenantBaseEntity extends BaseEntity {

    /** 所属租户（团队）ID */
    @TableField("tenant_id")
    private Long tenantId;
}
