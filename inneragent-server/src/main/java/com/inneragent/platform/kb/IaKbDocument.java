package com.inneragent.platform.kb;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * mini 知识库文档实体(ia_kb_document,V20 DDL;P4-W14 PRD M5)。
 *
 * <p>业务表携带 app_id(不在 {@code AppTenantLineInnerInterceptor#IGNORED_TABLES}),
 * 行级 app_id 由拦截器注入/过滤。metadata_json 一律 TEXT 存 JSON 字符串
 * (R3 DEF-08 教训,不用 JSONB)。分段行(ia_kb_chunk)不经本实体——tsv
 * 为 PG TSVECTOR 列,由服务端 to_tsvector 计算,MyBatis 不绑定该类型,
 * 分段读写走 {@link KbChunkStore}(JdbcTemplate,显式携带 app_id)。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ia_kb_document")
public class IaKbDocument extends BaseEntity {

    /** 主键 ID(DDL IDENTITY 自增) */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(单应用部署固定 1) */
    private Long appId;

    /** 文档名(检索命中来源展示) */
    private String title;

    /** 来源标识(upload/api/外部系统等,可空) */
    private String source;

    /** 状态:active-参与检索/inactive-失效(DDL CHECK) */
    private String status;

    /** 分段数(与 ia_kb_chunk 行数一致) */
    private Integer chunkCount;

    /** 正文指纹(sha256,变更判定) */
    private String contentSha256;

    /** 结构化元数据(TEXT 存 JSON 字符串,可空) */
    private String metadataJson;
}
