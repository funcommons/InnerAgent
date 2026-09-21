package com.inneragent.platform.kb;

import com.inneragent.agent.kb.AgentKnowledgeBasePort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 分段行读写仓库(ia_kb_chunk;V20,P4-W14)。
 *
 * <p>刻意不走 MyBatis:tsv 为 PG TSVECTOR 列,由服务端
 * {@code to_tsvector(config, 二元切分文本)} 计算(MyBatis 不绑定 tsvector
 * 类型,实体不映射);检索 SQL 含 {@code @@}/{@code ts_rank} 全文算子,
 * 不经行级拦截器 JSqlParser 改写——本仓库以 JdbcTemplate 直行,显式携带
 * app_id 条件(与拦截器同值语义,ia_skill 注解 SQL 先例)。
 *
 * <p>tsv 文本与查询词位均经 {@link CjkBigramTextCodec} 切分,索引入库与
 * 查询两侧一致方得字面命中(Q4 simple 降级的中文检索近似)。查询语义:
 * 词位 AND(精确优先)零命中时降级 OR(召回兜底),命中按 ts_rank 降序、
 * id 平局稳定排序(可重放)。
 */
@Component
public class KbChunkStore {

    private static final String SEARCH_CHUNKS = """
            SELECT c.id          AS chunk_id,
                   c.document_id AS document_id,
                   d.title       AS document_title,
                   c.anchor      AS anchor,
                   c.seq         AS seq,
                   c.content     AS content,
                   ts_rank(c.tsv, to_tsquery(CAST(? AS regconfig), ?)) AS rank
            FROM ia_kb_chunk c
            JOIN ia_kb_document d
              ON d.id = c.document_id
             AND d.app_id = ?
             AND d.deleted = FALSE
             AND d.status = 'active'
            WHERE c.app_id = ?
              AND c.tsv @@ to_tsquery(CAST(? AS regconfig), ?)
            ORDER BY rank DESC, c.id ASC
            LIMIT ?
            """;

    /** 元数据过滤变体:仅命中指定来源(source)文档的检索。 */
    private static final String SEARCH_CHUNKS_BY_SOURCE = SEARCH_CHUNKS.replace(
            "AND d.status = 'active'",
            "AND d.status = 'active' AND d.source = ?");

    private static final String INSERT_CHUNK = """
            INSERT INTO ia_kb_chunk
                (app_id, document_id, seq, anchor, content, char_length, tsv, create_time)
            VALUES (?, ?, ?, ?, ?, ?, to_tsvector(CAST(? AS regconfig), ?), ?)
            """;

    private static final String UPDATE_TSV = """
            UPDATE ia_kb_chunk
            SET tsv = to_tsvector(CAST(? AS regconfig), ?)
            WHERE id = ?
              AND app_id = ?
            """;

    private final JdbcTemplate jdbc;

    public KbChunkStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 全文检索:仅 active 且未删文档;AND 零命中降级 OR;source 非空时
     * 追加文档来源过滤(元数据过滤位,调试接口用)。
     */
    public List<AgentKnowledgeBasePort.KbHit> search(
            long appId, String query, String searchConfig, String source, int limit) {
        List<String> lexemes = lexemes(query);
        if (lexemes.isEmpty()) {
            return List.of();
        }
        String andTsquery = tsquery(lexemes, " & ");
        List<AgentKnowledgeBasePort.KbHit> hits = query(
                appId, andTsquery, searchConfig, source, limit);
        if (!hits.isEmpty()) {
            return hits;
        }
        return query(appId, tsquery(lexemes, " | "), searchConfig, source, limit);
    }

    /** 批量落分段(tsv 服务端按配置计算;同文档 uk(document_id, seq))。 */
    public void insertChunks(long appId, long documentId, String searchConfig,
                             List<DocumentChunker.Chunk> chunks) {
        if (chunks.isEmpty()) {
            return;
        }
        Timestamp now = Timestamp.valueOf(LocalDateTime.now());
        jdbc.batchUpdate(INSERT_CHUNK, chunks, chunks.size(), (statement, chunk) -> {
            statement.setLong(1, appId);
            statement.setLong(2, documentId);
            statement.setInt(3, chunk.seq());
            statement.setString(4, chunk.anchor());
            statement.setString(5, chunk.content());
            statement.setInt(6, chunk.content().length());
            statement.setString(7, searchConfig);
            statement.setString(8, CjkBigramTextCodec.forIndex(chunk.content()));
            statement.setTimestamp(9, now);
        });
    }

    /** 重建索引:按当前配置重算分段 tsv(逐行;十万级内可承受)。 */
    public int rebuildTsv(long appId, String searchConfig, List<ChunkRow> rows) {
        int updated = 0;
        for (ChunkRow row : rows) {
            updated += jdbc.update(UPDATE_TSV,
                    searchConfig, CjkBigramTextCodec.forIndex(row.content()),
                    row.id(), appId);
        }
        return updated;
    }

    /** 文档全部分段(重建用;按 seq 升序)。 */
    public List<ChunkRow> listChunks(long appId, long documentId) {
        return jdbc.query("""
                        SELECT id, seq, content
                        FROM ia_kb_chunk
                        WHERE document_id = ? AND app_id = ?
                        ORDER BY seq ASC
                        """,
                (rs, rowNum) -> new ChunkRow(
                        rs.getLong("id"), rs.getInt("seq"), rs.getString("content")),
                documentId, appId);
    }

    private List<AgentKnowledgeBasePort.KbHit> query(
            long appId, String tsquery, String searchConfig, String source, int limit) {
        boolean filterBySource = source != null && !source.isBlank();
        Object[] args = filterBySource
                // 位置序:SELECT 内 config/tsquery → JOIN d.app_id/source →
                // WHERE c.app_id → @@ config/tsquery → LIMIT
                ? new Object[]{searchConfig, tsquery, appId, source, appId,
                        searchConfig, tsquery, limit}
                : new Object[]{searchConfig, tsquery, appId, appId,
                        searchConfig, tsquery, limit};
        return jdbc.query(filterBySource ? SEARCH_CHUNKS_BY_SOURCE : SEARCH_CHUNKS,
                (rs, rowNum) -> new AgentKnowledgeBasePort.KbHit(
                        rs.getLong("chunk_id"),
                        rs.getLong("document_id"),
                        rs.getString("document_title"),
                        rs.getString("anchor"),
                        rs.getInt("seq"),
                        rs.getString("content")),
                args);
    }

    /**
     * 查询词位:二元切分后仅保留 CJK/字母/数字(标点交 to_tsquery 会被
     * 再解析,防语法注入),词位单引号包裹、内部引号转义。
     */
    static List<String> lexemes(String query) {
        String[] tokens = CjkBigramTextCodec.forIndex(query).split("\\s+");
        List<String> lexemes = new java.util.ArrayList<>(tokens.length);
        for (String token : tokens) {
            StringBuilder safe = new StringBuilder();
            token.codePoints().forEach(codePoint -> {
                if (CjkBigramTextCodec.isCjk(codePoint)
                        || Character.isLetterOrDigit(codePoint)) {
                    safe.appendCodePoint(codePoint);
                }
            });
            if (!safe.isEmpty()) {
                lexemes.add(safe.toString());
            }
        }
        return lexemes;
    }

    static String tsquery(List<String> lexemes, String operator) {
        StringBuilder tsquery = new StringBuilder();
        for (String lexeme : lexemes) {
            if (tsquery.length() > 0) {
                tsquery.append(operator);
            }
            tsquery.append('\'').append(lexeme.replace("'", "''")).append('\'');
        }
        return tsquery.toString();
    }

    /** 分段行(重建索引用最小投影)。 */
    public record ChunkRow(long id, int seq, String content) {
    }
}
