package com.inneragent.platform.skillhub;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * Skill 文件内容实体(ia_skill_file,V19 DDL;P4-W13)。
 *
 * <p>SKILL.md 与资源文件整包落库:文本 utf-8 原文直存、二进制 base64
 * (encoding 列区分,形同 {@code AgentUserSkillService.fileValue} 的
 * 存储约定)。不用 bytea/JSONB——R3 DEF-08 / V15 取舍:一律 TEXT,
 * 序列化收敛在服务层。随主行整包替换(先删后插,uk_ia_skill_file)。
 *
 * <p>不继承 BaseEntity:文件行无逻辑删除语义(整包替换/随主行删除),
 * 仅 create_time 由 DDL 缺省填充(MP 非空字段策略下 null 列不参与 INSERT)。
 */
@Data
@TableName("ia_skill_file")
public class IaSkillFile {

    /** 主键 ID(DDL IDENTITY 自增) */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(与主行一致,便于应用级检索) */
    private Long appId;

    /** 所属 Skill(ia_skill.id) */
    private Long skillId;

    /** Skill 包内相对路径(导入时已拒穿越/绝对路径/symlink) */
    private String path;

    /** 内容编码:utf-8/base64(DDL CHECK) */
    private String encoding;

    /** 文件内容(utf-8 原文或 base64 字符串;TEXT 列) */
    private String content;

    /** 原始字节数(解码后) */
    private Long sizeBytes;

    /** 创建时间(DDL 缺省填充) */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}
