package com.inneragent.platform.skillhub;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/**
 * 应用级 Skill 目录实体(ia_skill,V19 DDL;P4-W13 PRD M4)。
 *
 * <p>应用级管理面 Skill:admin zip 导入(预览校验→确认入库)、激活门控
 * (应用内同时上限 {@link SkillHubProperties#getMaxActivePerApp()})、停用/
 * 删除、审计留痕。用户级自定义 Skill 走 workspace 存储
 * ({@code AgentUserSkillService}),不落本表。
 *
 * <p>业务表携带 app_id(不在 {@code AppTenantLineInnerInterceptor#IGNORED_TABLES}),
 * 行级 app_id 由拦截器注入/过滤;唯一键 uk_ia_skill_app_name(app_id, name),
 * 逻辑删除后同名再导入按复活处理(唯一键含软删行)。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ia_skill")
public class IaSkill extends BaseEntity {

    /** 主键 ID(DDL IDENTITY 自增) */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(单应用部署固定 1) */
    private Long appId;

    /** Skill 业务名(= skill.json.name,kebab-case,应用内唯一) */
    private String name;

    /** 显示名称(缺省=name) */
    private String displayName;

    /** 描述(= skill.json.description) */
    private String description;

    /** Skill 版本(= skill.json.version,可空) */
    private String version;

    /** 激活状态:inactive/active(DDL CHECK) */
    private String status;

    /** 来源:import/builtin(DDL CHECK) */
    private String source;

    /** 内容指纹(SKILL.md+全部文件规范哈希) */
    private String contentSha256;

    /** skill.json 清单原文(TEXT 存 JSON 字符串,service 层序列化) */
    private String manifestJson;

    /** 最近一次激活时间(停用后置 NULL) */
    private LocalDateTime activatedAt;

    /** 最近一次激活操作者 */
    private Long activatedBy;
}
