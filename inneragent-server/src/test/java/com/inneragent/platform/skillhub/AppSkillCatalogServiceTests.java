package com.inneragent.platform.skillhub;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.skillhub.mapper.IaSkillFileMapper;
import com.inneragent.platform.skillhub.mapper.IaSkillMapper;
import com.inneragent.platform.toolhub.ToolAuditService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 应用级 Skill 目录服务单测(mapper/审计 mock):导入两段式语义、
 * 冲突/覆盖/复活、激活上限 8 边界、审计码值复用。
 */
class AppSkillCatalogServiceTests {

    private static final String DESCRIPTION = "用作文档摘要与要点提取的能力扩展";

    private SkillHubProperties properties;
    private IaSkillMapper skillMapper;
    private IaSkillFileMapper fileMapper;
    private ToolAuditService auditService;
    private AppSkillCatalogService service;

    @BeforeEach
    void setUp() {
        properties = new SkillHubProperties();
        skillMapper = mock(IaSkillMapper.class);
        fileMapper = mock(IaSkillFileMapper.class);
        auditService = mock(ToolAuditService.class);
        service = new AppSkillCatalogService(
                properties, skillMapper, fileMapper, auditService, new ObjectMapper());
    }

    // ------------------------------------------------------------------
    // 预览(dryRun)
    // ------------------------------------------------------------------

    @Test
    void previewReturnsManifestFilesAndWarningsWithoutPersisting() {
        Map<String, byte[]> entries = new java.util.LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary"));
        entries.put("scripts/run.py", "print('ok')".getBytes(StandardCharsets.UTF_8));

        AppSkillCatalogService.PreviewView preview = service.preview(
                "skills.zip", zip(entries));

        assertThat(preview.valid()).isTrue();
        assertThat(preview.manifest().name()).isEqualTo("doc-summary");
        assertThat(preview.files()).extracting(AppSkillCatalogService.FileView::path)
                .containsExactly("SKILL.md", "scripts/run.py");
        assertThat(preview.warnings()).anyMatch(w -> w.contains("不会执行"));
        verify(skillMapper, never()).insert(any(IaSkill.class));
    }

    @Test
    void previewCollectsErrorsInsteadOfThrowing() {
        AppSkillCatalogService.PreviewView preview = service.preview(
                "skills.zip", zip(Map.of("SKILL.md", skillMarkdown("doc-summary"))));

        assertThat(preview.valid()).isFalse();
        assertThat(preview.errors()).anyMatch(e -> e.contains("skill.json"));
    }

    // ------------------------------------------------------------------
    // 导入确认
    // ------------------------------------------------------------------

    @Test
    void importSkillPersistsRowFilesAndAuditsWithReusedDecisionCodes() {
        when(skillMapper.selectAnyByAppAndName(1L, "doc-summary")).thenReturn(null);
        // mock insert 回填主键(真实 MP IDENTITY 行为)
        when(skillMapper.insert(any(IaSkill.class))).thenAnswer(invocation -> {
            invocation.getArgument(0, IaSkill.class).setId(31L);
            return 1;
        });
        Map<String, byte[]> entries = new java.util.LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary"));
        entries.put("references/guide.md", "引用指南".getBytes(StandardCharsets.UTF_8));

        AppSkillCatalogService.SkillView view = service.importSkill(
                1L, "skills.zip", zip(entries), null, false, 7L);

        assertThat(view.status()).isEqualTo("inactive");
        assertThat(view.source()).isEqualTo("import");
        ArgumentCaptor<IaSkill> row = ArgumentCaptor.forClass(IaSkill.class);
        verify(skillMapper).insert(row.capture());
        assertThat(row.getValue().getName()).isEqualTo("doc-summary");
        assertThat(row.getValue().getDisplayName()).isEqualTo("文档摘要");
        assertThat(row.getValue().getContentSha256()).hasSize(64);
        verify(fileMapper).deleteBySkillId(row.getValue().getId());
        verify(fileMapper, org.mockito.Mockito.times(2))
                .insert(any(IaSkillFile.class));
        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("definition-imported");
        assertThat(audit.getValue().decisionSource()).isEqualTo("admin");
        assertThat(audit.getValue().toolFqn()).isEqualTo("skill:doc-summary");
    }

    @Test
    void importSkillRejectsInvalidPackageBeforeAnyWrite() {
        Map<String, byte[]> entries = new java.util.LinkedHashMap<>();
        entries.put("../evil/SKILL.md", skillMarkdown("evil"));

        assertThatThrownBy(() -> service.importSkill(
                1L, "skills.zip", zip(entries), null, false, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("未通过校验")
                .hasMessageContaining("路径穿越");
        verify(skillMapper, never()).insert(any(IaSkill.class));
        verify(auditService, never()).append(any());
    }

    @Test
    void importSkillConflictsWithoutOverwriteAndReplacesWithOverwrite() {
        IaSkill existing = new IaSkill();
        existing.setId(11L);
        existing.setAppId(1L);
        existing.setName("doc-summary");
        existing.setStatus(AppSkillCatalogService.STATUS_ACTIVE);
        existing.setDeleted(false);
        when(skillMapper.selectAnyByAppAndName(1L, "doc-summary")).thenReturn(existing);

        Map<String, byte[]> entries = new java.util.LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary"));
        byte[] zipBytes = zip(entries);

        assertThatThrownBy(() -> service.importSkill(
                1L, "skills.zip", zipBytes, null, false, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("同名 Skill 已存在");

        service.importSkill(1L, "skills.zip", zipBytes, "覆盖名", true, 7L);
        ArgumentCaptor<IaSkill> row = ArgumentCaptor.forClass(IaSkill.class);
        verify(skillMapper).updateById(row.capture());
        assertThat(row.getValue().getDisplayName()).isEqualTo("覆盖名");
        // 覆盖激活行:激活位保持、激活留痕刷新
        assertThat(row.getValue().getStatus()).isEqualTo("active");
        assertThat(row.getValue().getActivatedBy()).isEqualTo(7L);
        verify(fileMapper).deleteBySkillId(11L);
    }

    @Test
    void importSkillRevivesSoftDeletedRow() {
        IaSkill deleted = new IaSkill();
        deleted.setId(12L);
        deleted.setAppId(1L);
        deleted.setName("doc-summary");
        deleted.setStatus(AppSkillCatalogService.STATUS_INACTIVE);
        deleted.setDeleted(true);
        when(skillMapper.selectAnyByAppAndName(1L, "doc-summary")).thenReturn(deleted);

        Map<String, byte[]> entries = new java.util.LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary"));

        AppSkillCatalogService.SkillView view = service.importSkill(
                1L, "skills.zip", zip(entries), null, false, null);

        assertThat(view.id()).isEqualTo(12L);
        assertThat(view.active()).isFalse();
        // 复活:先显式翻转 deleted,再常规 updateById 覆盖内容字段
        verify(skillMapper).undelete(12L);
        verify(skillMapper).updateById(deleted);
        org.mockito.ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                org.mockito.ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("definition-imported");
    }

    // ------------------------------------------------------------------
    // 激活上限(缺省 8)与停用/删除
    // ------------------------------------------------------------------

    @Test
    void activateRejectsExplicitlyWhenCapReached() {
        IaSkill row = inactiveRow(21L);
        when(skillMapper.selectById(21L)).thenReturn(row);
        when(skillMapper.countActive(1L)).thenReturn(8L);

        assertThatThrownBy(() -> service.activate(21L, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("上限 8")
                .extracting("code")
                .isEqualTo(409);
        verify(skillMapper, never()).updateById(any(IaSkill.class));
    }

    @Test
    void activateAtBoundaryUnderCapSucceeds() {
        IaSkill row = inactiveRow(22L);
        when(skillMapper.selectById(22L)).thenReturn(row);
        when(skillMapper.countActive(1L)).thenReturn(7L);

        AppSkillCatalogService.SkillView view = service.activate(22L, 7L);

        assertThat(view.active()).isTrue();
        assertThat(row.getActivatedBy()).isEqualTo(7L);
        verify(skillMapper).updateById(row);
    }

    @Test
    void activateIsIdempotentForAlreadyActiveRow() {
        IaSkill row = inactiveRow(23L);
        row.setStatus(AppSkillCatalogService.STATUS_ACTIVE);
        when(skillMapper.selectById(23L)).thenReturn(row);

        service.activate(23L, null);

        verify(skillMapper, never()).updateById(any(IaSkill.class));
        verify(auditService, never()).append(any());
    }

    @Test
    void deactivateClearsActivationStateAndAudits() {
        IaSkill row = inactiveRow(24L);
        row.setStatus(AppSkillCatalogService.STATUS_ACTIVE);
        row.setActivatedAt(java.time.LocalDateTime.now());
        when(skillMapper.selectById(24L)).thenReturn(row);

        AppSkillCatalogService.SkillView view = service.deactivate(24L, null);

        assertThat(view.active()).isFalse();
        assertThat(row.getActivatedAt()).isNull();
        verify(auditService).append(org.mockito.ArgumentMatchers.argThat(entry ->
                "definition-updated".equals(entry.decision())
                        && entry.paramsMaskedJson().contains("deactivated")));
    }

    @Test
    void deleteResetsActivationAndSoftDeletes() {
        IaSkill row = inactiveRow(25L);
        row.setStatus(AppSkillCatalogService.STATUS_ACTIVE);
        when(skillMapper.selectById(25L)).thenReturn(row);

        service.delete(25L, null);

        // 软删经显式 SQL(deleted 为 @TableLogic 列,不走 updateById)
        verify(skillMapper).softDelete(25L);
        verify(skillMapper, never()).updateById(any(IaSkill.class));
        verify(auditService).append(org.mockito.ArgumentMatchers.argThat(entry ->
                entry.paramsMaskedJson().contains("deleted")));
    }

    @Test
    void getThrowsNotFoundForMissingRow() {
        when(skillMapper.selectById(99L)).thenReturn(null);

        assertThatThrownBy(() -> service.get(99L))
                .isInstanceOf(BusinessException.class)
                .extracting("code")
                .isEqualTo(404);
    }

    // ------------------------------------------------------------------
    // 构造工具
    // ------------------------------------------------------------------

    private static IaSkill inactiveRow(long id) {
        IaSkill row = new IaSkill();
        row.setId(id);
        row.setAppId(1L);
        row.setName("doc-summary");
        row.setStatus(AppSkillCatalogService.STATUS_INACTIVE);
        row.setDeleted(false);
        row.setContentSha256("0".repeat(64));
        return row;
    }

    private static byte[] manifestBytes(String name) {
        return ("{\"name\":\"" + name + "\",\"displayName\":\"文档摘要\",\"description\":\""
                + DESCRIPTION + "\",\"version\":\"1.0.0\"}").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] skillMarkdown(String name) {
        return ("---\nname: " + name + "\ndescription: " + DESCRIPTION
                + "\n---\n\n按流程完成文档摘要。\n").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] zip(Map<String, byte[]> entries) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zipStream = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
            for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
                zipStream.putNextEntry(new ZipEntry(entry.getKey()));
                zipStream.write(entry.getValue());
                zipStream.closeEntry();
            }
        } catch (java.io.IOException failure) {
            throw new IllegalStateException(failure);
        }
        return output.toByteArray();
    }
}
