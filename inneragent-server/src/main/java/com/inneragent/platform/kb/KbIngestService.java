package com.inneragent.platform.kb;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.kb.mapper.IaKbDocumentMapper;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;

/**
 * mini 知识库摄取服务(P4-W14 PRD M5;数据落 ia_kb_document/ia_kb_chunk)。
 *
 * <p>职责:文档导入(admin API,文本导入→分块→tsvector 落列)、更新
 * (正文变更即重分块)、失效/恢复(status 门控检索)、删除(软删主行 +
 * 物理清理分段)、重建索引(按当前生效检索配置重算 tsv,配置变更后用)、
 * 分页/详情。<strong>单 app 文档数上限</strong>(PRD:单库 ≤1000 文档,
 * 可配)超限明确报错提示拆库。
 *
 * <p>审计复用现有码值不私加:decision=definition-imported(导入)/
 * definition-updated(更新/失效/恢复/删除/重建),decision_source=admin,
 * tool_fqn 用伪命名 {@code kb:<documentId>}(先例 skill:<name>)。
 * 审计 fail-closed(落审计失败即业务失败回滚,ToolAuditService 语义)。
 */
@Service
@Slf4j
public class KbIngestService {

    /** 状态值域(V20 DDL CHECK)。 */
    public static final String STATUS_ACTIVE = "active";
    public static final String STATUS_INACTIVE = "inactive";

    private final KbProperties properties;
    private final KbSearchConfigResolver searchConfig;
    private final IaKbDocumentMapper documentMapper;
    private final KbChunkStore chunkStore;
    private final ToolAuditService auditService;
    private final ObjectMapper objectMapper;

    public KbIngestService(KbProperties properties,
                           KbSearchConfigResolver searchConfig,
                           IaKbDocumentMapper documentMapper,
                           KbChunkStore chunkStore,
                           ToolAuditService auditService,
                           ObjectMapper objectMapper) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.searchConfig = Objects.requireNonNull(searchConfig, "searchConfig must not be null");
        this.documentMapper = Objects.requireNonNull(documentMapper, "documentMapper must not be null");
        this.chunkStore = Objects.requireNonNull(chunkStore, "chunkStore must not be null");
        this.auditService = Objects.requireNonNull(auditService, "auditService must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    // ------------------------------------------------------------------
    // 导入 / 更新(摄取主路径)
    // ------------------------------------------------------------------

    /**
     * 导入文档:校验 → 分块 → 主行落库 → 分段落列(tsv 服务端计算)。
     * 单 app 文档数超上限 409 明确提示拆库;分段数超上限 400。
     */
    @Transactional
    public KbDocumentView importDocument(
            long appId, String title, String source, String content,
            String metadataJson, Integer chunkSize, Integer chunkOverlap,
            Long operatorId) {
        int effectiveSize = chunkSize == null ? properties.getChunkSize() : chunkSize;
        int effectiveOverlap = chunkOverlap == null
                ? properties.getChunkOverlap() : chunkOverlap;
        String safeTitle = requireTitle(title);
        String safeContent = requireContent(content);
        long docCount = documentMapper.countActiveDocuments(appId);
        if (docCount >= properties.getMaxDocumentsPerApp()) {
            throw new BusinessException(409, "单应用知识库文档数已达上限 "
                    + properties.getMaxDocumentsPerApp()
                    + ",请先删除失效文档或按主题拆库");
        }

        List<DocumentChunker.Chunk> chunks = chunk(safeContent, effectiveSize, effectiveOverlap);
        IaKbDocument row = new IaKbDocument();
        row.setAppId(appId);
        row.setTitle(safeTitle);
        row.setSource(requireSource(source));
        row.setStatus(STATUS_ACTIVE);
        row.setChunkCount(chunks.size());
        row.setContentSha256(sha256(safeContent));
        row.setMetadataJson(requireMetadata(metadataJson));
        documentMapper.insert(row);
        chunkStore.insertChunks(appId, row.getId(), searchConfig.effectiveConfig(), chunks);

        audit(appId, row.getId(), "definition-imported", "imported",
                safeTitle, chunks.size());
        log.info("KB 文档导入: appId={}, id={}, title={}, chunks={}, bytes={}",
                appId, row.getId(), safeTitle, chunks.size(), contentBytes(safeContent));
        return toView(row);
    }

    /**
     * 更新文档:字段级覆盖(null 不动);提供正文即整文档重分块
     * (旧分段物理清理,附带刷新分段参数的效果)。
     */
    @Transactional
    public KbDocumentView updateDocument(
            long appId, long id, String title, String source, String metadataJson,
            String content, Integer chunkSize, Integer chunkOverlap, Long operatorId) {
        IaKbDocument row = requireRow(appId, id);
        if (title != null) {
            row.setTitle(requireTitle(title));
        }
        if (source != null) {
            row.setSource(requireSource(source));
        }
        if (metadataJson != null) {
            row.setMetadataJson(requireMetadata(metadataJson));
        }
        int effectiveSize = chunkSize == null ? properties.getChunkSize() : chunkSize;
        int effectiveOverlap = chunkOverlap == null
                ? properties.getChunkOverlap() : chunkOverlap;
        if (content != null) {
            String safeContent = requireContent(content);
            row.setContentSha256(sha256(safeContent));
            rechunk(row, safeContent, effectiveSize, effectiveOverlap);
            documentMapper.updateById(row);
            audit(appId, id, "definition-updated", "rechunked",
                    row.getTitle(), row.getChunkCount());
            return toView(row);
        }
        documentMapper.updateById(row);
        audit(appId, id, "definition-updated", "updated", row.getTitle(), row.getChunkCount());
        return toView(row);
    }

    // ------------------------------------------------------------------
    // 门控 / 删除 / 重建 / 查询
    // ------------------------------------------------------------------

    /** 失效(标黄,不参与检索)与恢复。幂等。 */
    @Transactional
    public KbDocumentView setStatus(long appId, long id, boolean active, Long operatorId) {
        IaKbDocument row = requireRow(appId, id);
        String target = active ? STATUS_ACTIVE : STATUS_INACTIVE;
        if (!target.equals(row.getStatus())) {
            row.setStatus(target);
            documentMapper.updateById(row);
            audit(appId, id, "definition-updated", active ? "activated" : "deactivated",
                    row.getTitle(), row.getChunkCount());
        }
        return toView(row);
    }

    /** 删除:软删主行(复位状态)+ 物理清理分段;幂等(不存在 404)。 */
    @Transactional
    public void delete(long appId, long id, Long operatorId) {
        IaKbDocument row = requireRow(appId, id);
        documentMapper.softDelete(id);
        documentMapper.deleteChunks(id);
        audit(appId, id, "definition-updated", "deleted", row.getTitle(), row.getChunkCount());
        log.info("KB 文档删除: appId={}, id={}, title={}", appId, id, row.getTitle());
    }

    /**
     * 重建索引:按当前生效检索配置重算该文档全部分段 tsv
     * (search-config 变更或降级恢复后,使存量列与查询配置一致)。
     */
    @Transactional
    public KbDocumentView rebuildIndex(long appId, long id, Long operatorId) {
        IaKbDocument row = requireRow(appId, id);
        int rebuilt = chunkStore.rebuildTsv(appId,
                searchConfig.effectiveConfig(), chunkStore.listChunks(appId, id));
        audit(appId, id, "definition-updated", "rebuilt", row.getTitle(), rebuilt);
        log.info("KB 索引重建: appId={}, id={}, chunks={}, config={}",
                appId, id, rebuilt, searchConfig.effectiveConfig());
        return toView(row);
    }

    /** 分页列表(id 降序)。 */
    public PageResult<KbDocumentView> page(long appId, int pageNo, int pageSize) {
        int safePageNo = Math.max(pageNo, 1);
        int safePageSize = Math.min(Math.max(pageSize, 1), 100);
        Page<IaKbDocument> page = documentMapper.selectPage(
                new Page<>(safePageNo, safePageSize),
                new LambdaQueryWrapper<IaKbDocument>()
                        .eq(IaKbDocument::getAppId, appId)
                        .orderByDesc(IaKbDocument::getId));
        PageResult<KbDocumentView> result = new PageResult<>(
                page.getRecords().stream().map(this::toView).toList(),
                page.getTotal());
        result.setPageNo(safePageNo);
        result.setPageSize(safePageSize);
        return result;
    }

    /** 详情(不含分段正文;正文经检索调试接口按命中查看)。 */
    public KbDocumentView get(long appId, long id) {
        return toView(requireRow(appId, id));
    }

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    private void rechunk(IaKbDocument row, String content, int size, int overlap) {
        List<DocumentChunker.Chunk> chunks = chunk(content, size, overlap);
        documentMapper.deleteChunks(row.getId());
        chunkStore.insertChunks(row.getAppId(), row.getId(),
                searchConfig.effectiveConfig(), chunks);
        row.setChunkCount(chunks.size());
    }

    private List<DocumentChunker.Chunk> chunk(String content, int size, int overlap) {
        DocumentChunker chunker;
        try {
            chunker = new DocumentChunker(size, overlap);
        } catch (IllegalArgumentException invalidParameter) {
            throw new BusinessException(400, "分段参数不合法:" + invalidParameter.getMessage());
        }
        List<DocumentChunker.Chunk> chunks = chunker.chunk(content);
        if (chunks.isEmpty()) {
            throw new BusinessException(400, "文档内容分块后为空");
        }
        if (chunks.size() > properties.getMaxChunksPerDocument()) {
            throw new BusinessException(400, "文档分段数 " + chunks.size()
                    + " 超过单文档上限 " + properties.getMaxChunksPerDocument()
                    + ",请拆分后导入");
        }
        return chunks;
    }

    private String requireTitle(String title) {
        String safe = normalize(title);
        if (safe == null) {
            throw new BusinessException(400, "文档标题不能为空");
        }
        if (safe.length() > 256) {
            throw new BusinessException(400, "文档标题不能超过 256 个字符");
        }
        return safe;
    }

    private String requireSource(String source) {
        String safe = normalize(source);
        if (safe != null && safe.length() > 256) {
            throw new BusinessException(400, "来源标识不能超过 256 个字符");
        }
        return safe;
    }

    private String requireContent(String content) {
        String safe = normalize(content);
        if (safe == null) {
            throw new BusinessException(400, "文档内容不能为空");
        }
        if (contentBytes(safe) > properties.getMaxDocumentBytes()) {
            throw new BusinessException(400, "单文档内容上限 "
                    + properties.getMaxDocumentBytes() + " 字节(PRD:超限请拆分导入)");
        }
        return safe;
    }

    /** metadata TEXT 存 JSON 字符串(DEF-08:禁 JSONB;非对象形态拒绝)。 */
    private String requireMetadata(String metadataJson) {
        String safe = normalize(metadataJson);
        if (safe == null) {
            return null;
        }
        try {
            if (!objectMapper.readTree(safe).isObject()) {
                throw new BusinessException(400, "metadata 必须是 JSON 对象");
            }
            return safe;
        } catch (JsonProcessingException invalidMetadata) {
            throw new BusinessException(400, "metadata 不是合法 JSON");
        }
    }

    private IaKbDocument requireRow(long appId, long id) {
        IaKbDocument row = documentMapper.selectById(id);
        if (row == null || row.getAppId() == null || row.getAppId() != appId) {
            throw new BusinessException(404, "知识库文档不存在: " + id);
        }
        return row;
    }

    private KbDocumentView toView(IaKbDocument row) {
        return new KbDocumentView(
                row.getId(),
                row.getAppId(),
                row.getTitle(),
                row.getSource(),
                row.getStatus(),
                row.getChunkCount(),
                STATUS_ACTIVE.equals(row.getStatus()));
    }

    private void audit(long appId, long documentId, String decision, String action,
                       String title, int chunkCount) {
        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId, null, null, null, null,
                "kb:" + documentId,
                decision,
                ToolDecisionSource.ADMIN.code(),
                null,
                snapshot(action, documentId, title, chunkCount),
                "kb document " + action + " via admin", null, null));
    }

    private String snapshot(String action, long documentId, String title, int chunkCount) {
        try {
            return objectMapper.writeValueAsString(java.util.Map.of(
                    "action", action,
                    "documentId", String.valueOf(documentId),
                    "title", String.valueOf(title),
                    "chunkCount", String.valueOf(chunkCount)));
        } catch (JsonProcessingException serializationFailure) {
            return null;
        }
    }

    private static String sha256(String content) {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossibleOnJvm) {
            throw new IllegalStateException("SHA-256 unavailable", impossibleOnJvm);
        }
        return HexFormat.of().formatHex(
                digest.digest(content.getBytes(StandardCharsets.UTF_8)));
    }

    private static long contentBytes(String content) {
        return content.getBytes(StandardCharsets.UTF_8).length;
    }

    private static String normalize(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /** 列表/导入/更新出参。 */
    public record KbDocumentView(
            Long id,
            Long appId,
            String title,
            String source,
            String status,
            Integer chunkCount,
            boolean active) {
    }
}
