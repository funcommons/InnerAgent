package com.inneragent.server.admin;

import com.inneragent.agent.kb.AgentKnowledgeBasePort;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.kb.KbIngestService;
import com.inneragent.platform.kb.KbIngestService.KbDocumentView;
import com.inneragent.platform.kb.KbRetrievalService;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * mini 知识库管理 admin API(P4-W14 PRD M5;交互范式照
 * {@link AdminSkillController}:两参 CommonResult/PageResult 包裹,由
 * {@link AdminTokenFilter} 双轨守卫)。
 *
 * <p>路由 {@code /ia/api/v1/admin/kb/documents}:POST 导入(文本导入,
 * 服务端分块+tsvector 落列;单 app 文档数上限缺省 1000,超限 409 提示
 * 拆库)/ GET 列表(分页)/ GET {id} / PUT {id}(字段级更新,带正文即
 * 重分块)/ POST {id}/deactivate(失效标黄,不参与检索)/ POST {id}/
 * activate(恢复)/ POST {id}/rebuild-index(按当前检索配置重算 tsv)/
 * DELETE {id}(软删+分段清理)。GET /search:检索调试(给管理站接线,
 * 出参含来源字段与降级标记)。
 *
 * <p>审计复用现有码值不私加:definition-imported(导入)/
 * definition-updated(其余变更),decision_source=admin,tool_fqn=
 * {@code kb:<documentId>}。appId 缺省单应用 1。
 */
@Tag(name = "mini 知识库(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/kb/documents")
@RequiredArgsConstructor
@Validated
public class AdminKbController {

    private final KbIngestService ingestService;
    private final KbRetrievalService retrievalService;

    @PostMapping("/import")
    @Operation(summary = "导入文档(文本导入→分块→tsvector 落列;"
            + "单 app 文档数上限缺省 1000,超限 409 明确提示拆库)")
    public CommonResult<KbDocumentView> importDocument(
            @RequestBody KbDocumentImportReq request) {
        return success(ingestService.importDocument(
                AppContext.currentOrDefault(),
                request.getTitle(),
                request.getSource(),
                request.getContent(),
                request.getMetadata(),
                request.getChunkSize(),
                request.getChunkOverlap(),
                null));
    }

    @GetMapping
    @Operation(summary = "文档分页列表(含状态/分段数;id 降序)")
    public CommonResult<PageResult<KbDocumentView>> list(
            @RequestParam(defaultValue = "1") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize) {
        return success(ingestService.page(
                AppContext.currentOrDefault(), pageNo, pageSize));
    }

    @GetMapping("/{id}")
    @Operation(summary = "文档详情")
    public CommonResult<KbDocumentView> get(@PathVariable long id) {
        return success(ingestService.get(AppContext.currentOrDefault(), id));
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新文档(title/source/metadata 字段级;带 content 即重分块)")
    public CommonResult<KbDocumentView> update(
            @PathVariable long id,
            @RequestBody KbDocumentUpdateReq request) {
        return success(ingestService.updateDocument(
                AppContext.currentOrDefault(),
                id,
                request.getTitle(),
                request.getSource(),
                request.getMetadata(),
                request.getContent(),
                request.getChunkSize(),
                request.getChunkOverlap(),
                null));
    }

    @PostMapping("/{id}/deactivate")
    @Operation(summary = "失效文档(标黄语义,不参与检索)")
    public CommonResult<KbDocumentView> deactivate(@PathVariable long id) {
        return success(ingestService.setStatus(
                AppContext.currentOrDefault(), id, false, null));
    }

    @PostMapping("/{id}/activate")
    @Operation(summary = "恢复文档(重新参与检索)")
    public CommonResult<KbDocumentView> activate(@PathVariable long id) {
        return success(ingestService.setStatus(
                AppContext.currentOrDefault(), id, true, null));
    }

    @PostMapping("/{id}/rebuild-index")
    @Operation(summary = "重建索引(按当前生效检索配置重算 tsv;"
            + "search-config 变更或降级恢复后执行)")
    public CommonResult<KbDocumentView> rebuild(@PathVariable long id) {
        return success(ingestService.rebuildIndex(
                AppContext.currentOrDefault(), id, null));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除文档(软删主行+清理分段)")
    public CommonResult<Boolean> delete(@PathVariable long id) {
        ingestService.delete(AppContext.currentOrDefault(), id, null);
        return success(true);
    }

    @GetMapping("/search")
    @Operation(summary = "检索调试(返回 top-k 命中及来源字段;"
            + "出参带当前检索配置与降级标记,给管理站后续接线)")
    public CommonResult<KbSearchDebugView> search(
            @RequestParam("q") String query,
            @RequestParam(required = false) Integer topK,
            @RequestParam(required = false) String source) {
        List<AgentKnowledgeBasePort.KbHit> hits = retrievalService.search(
                AppContext.currentOrDefault(), query, topK, source);
        return success(new KbSearchDebugView(
                query,
                retrievalService.effectiveSearchConfig(),
                retrievalService.degraded(),
                hits.stream()
                        .map(hit -> new KbSearchHitView(
                                hit.chunkId(),
                                hit.documentId(),
                                hit.documentTitle(),
                                hit.anchor(),
                                hit.seq(),
                                hit.content()))
                        .toList()));
    }

    // ------------------------------------------------------------------
    // 请求/出参形态
    // ------------------------------------------------------------------

    @Data
    public static class KbDocumentImportReq {

        @NotBlank(message = "文档标题不能为空")
        @Schema(description = "文档名(检索命中来源展示)", example = "员工手册.md")
        private String title;

        @Schema(description = "来源标识(upload/api/外部系统等,可空)", example = "upload")
        private String source;

        @NotBlank(message = "文档内容不能为空")
        @Schema(description = "文档文本内容(单文档 ≤5MB,服务端分块)")
        private String content;

        @Schema(description = "结构化元数据(JSON 对象字符串,可空)")
        private String metadata;

        @Schema(description = "分段最大长度(字符;缺省 500)")
        private Integer chunkSize;

        @Schema(description = "相邻分段重叠(字符;缺省 50,须小于 chunkSize)")
        private Integer chunkOverlap;
    }

    @Data
    public static class KbDocumentUpdateReq {

        @Schema(description = "文档名(不更新传 null)")
        private String title;

        @Schema(description = "来源标识(不更新传 null)")
        private String source;

        @Schema(description = "结构化元数据(不更新传 null)")
        private String metadata;

        @Schema(description = "文档文本内容(提供即重分块)")
        private String content;

        @Schema(description = "分段最大长度(字符)")
        private Integer chunkSize;

        @Schema(description = "相邻分段重叠(字符)")
        private Integer chunkOverlap;
    }

    public record KbSearchDebugView(
            String query,
            String searchConfig,
            boolean degraded,
            List<KbSearchHitView> hits) {
    }

    public record KbSearchHitView(
            Long chunkId,
            Long documentId,
            String documentTitle,
            String anchor,
            Integer seq,
            String content) {
    }
}
