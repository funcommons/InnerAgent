package com.inneragent.platform.kb.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.kb.IaKbDocument;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * mini 知识库文档 Mapper(ia_kb_document;V20,P4-W14)。
 *
 * <p>表为业务表(app_id 参与行级注入,不在 IGNORED_TABLES);注解 SQL 中
 * 显式携带 app_id 条件,拦截器重复注入同值条件语义无害(ia_skill 先例)。
 * deleted 为 @TableLogic 字段:软删与复活走显式 SQL(同 ia_skill 先例)。
 */
@Mapper
public interface IaKbDocumentMapper extends BaseMapper<IaKbDocument> {

    /** 应用内未删文档数(1000 上限判定;含 inactive,占库位)。 */
    @Select("""
            SELECT COUNT(*)
            FROM ia_kb_document
            WHERE app_id = #{appId}
              AND deleted = FALSE
            """)
    long countActiveDocuments(@Param("appId") long appId);

    /** 软删(恢复位复位不做:删除文档不可复活,重导即新文档)。 */
    @Update("""
            UPDATE ia_kb_document
            SET deleted = TRUE,
                status = 'inactive'
            WHERE id = #{id}
              AND deleted = FALSE
            """)
    int softDelete(@Param("id") long id);

    /** 删除文档时清理其全部分段(物理删除,tsv 空间回收)。 */
    @Delete("DELETE FROM ia_kb_chunk WHERE document_id = #{documentId}")
    int deleteChunks(@Param("documentId") long documentId);
}
