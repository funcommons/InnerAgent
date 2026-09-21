package com.inneragent.integration;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.agent.skill.AgentScopeSkillRegistry;
import com.inneragent.agent.skill.AppSkillCatalogPort;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.skillhub.AppSkillCatalogService;
import com.inneragent.platform.skillhub.AppSkillCatalogService.PreviewView;
import com.inneragent.platform.skillhub.AppSkillCatalogService.SkillDetailView;
import com.inneragent.platform.skillhub.AppSkillCatalogService.SkillView;
import com.inneragent.platform.skillhub.IaSkill;
import com.inneragent.platform.skillhub.IaSkillFile;
import com.inneragent.platform.skillhub.mapper.IaSkillFileMapper;
import com.inneragent.platform.skillhub.mapper.IaSkillMapper;
import com.inneragent.platform.toolhub.ToolAuditLog;
import com.inneragent.platform.toolhub.mapper.ToolAuditLogMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 应用级 Skill 全旅程真库集成测试(P4-W13;ia_skill/ia_skill_file 实表,
 * Testcontainers PG,Flyway 全链迁移)。
 *
 * <p>旅程:预览(恶意 zip 零落库)→ 导入(审计 definition-imported/admin)
 * → 未激活时内核端口不可见 → 激活后内核端口可见(含 SKILL.md 正文)
 * → 停用后内核端口不可见 → 同名冲突 409 → overwrite 覆盖(审计
 * definition-updated)→ 删除后同名再导入复活 → 激活上限 8 边界(独立
 * appId 隔离:8 成功、第 9 个 409 明确报错、停用一个后补位成功)→
 * 内置 Skill 经内核注册表可见。连接串与运行态 application.yml 同形。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class SkillHubLifecycleIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            "postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "skill-hub-node");
    }

    @Autowired
    private AppSkillCatalogService skillService;

    @Autowired
    private AppSkillCatalogPort appSkillCatalog;

    @Autowired
    private AgentScopeSkillRegistry skillRegistry;

    @Autowired
    private IaSkillMapper skillMapper;

    @Autowired
    private IaSkillFileMapper fileMapper;

    @Autowired
    private ToolAuditLogMapper auditMapper;

    @AfterEach
    void resetAppContext() {
        AppContext.setAppId(null);
    }

    @Test
    void maliciousZipPreviewFailsWithoutAnyDatabaseWrite() {
        long rowsBefore = skillMapper.selectCount(null);

        Map<String, byte[]> entries = Map.of(
                "../evil/SKILL.md", markdown("evil"));
        PreviewView preview = skillService.preview("evil.zip", zip(entries));

        assertThat(preview.valid()).isFalse();
        assertThat(preview.errors()).anyMatch(e -> e.contains("路径穿越"));
        assertThat(skillMapper.selectCount(null)).isEqualTo(rowsBefore);
    }

    @Test
    void importActivateKernelVisibilityDeactivateRoundtrip() {
        // 1. 导入:inactive 入库 + 文件 + 审计(复用码值 definition-imported/admin)
        long rowsBefore = skillMapper.selectCount(null);
        SkillView imported = importSkill(1L, "roundtrip");

        assertThat(imported.active()).isFalse();
        assertThat(skillMapper.selectCount(null)).isEqualTo(rowsBefore + 1);
        assertThat(auditRows("skill:roundtrip", "definition-imported")).hasSize(1);
        List<IaSkillFile> files = fileMapper.selectList(
                new LambdaQueryWrapper<IaSkillFile>()
                        .eq(IaSkillFile::getSkillId, imported.id())
                        .orderByAsc(IaSkillFile::getPath));
        assertThat(files).extracting(IaSkillFile::getPath)
                .containsExactly("SKILL.md", "references/guide.md");

        // 2. 未激活 → 内核端口不可见(「按需激活」平台侧语义)
        assertThat(appSkillCatalog.activated(1L))
                .noneMatch(skill -> skill.name().equals("roundtrip"));

        // 3. 激活 → 内核端口可见,内容为 SKILL.md 正文,来源 import
        SkillView activated = skillService.activate(imported.id(), 9L);
        assertThat(activated.active()).isTrue();
        List<AppSkillCatalogPort.ActivatedAppSkill> visible =
                appSkillCatalog.activated(1L).stream()
                        .filter(skill -> skill.name().equals("roundtrip"))
                        .toList();
        assertThat(visible).hasSize(1);
        assertThat(visible.getFirst().markdown()).contains("按流程完成文档摘要");
        assertThat(visible.getFirst().source()).isEqualTo("import");

        // 4. 停用 → 内核端口不可见
        SkillView deactivated = skillService.deactivate(imported.id(), 9L);
        assertThat(deactivated.active()).isFalse();
        assertThat(appSkillCatalog.activated(1L))
                .noneMatch(skill -> skill.name().equals("roundtrip"));
        String actions = auditRows("skill:roundtrip", "definition-updated").stream()
                .map(ToolAuditLog::getParamsMaskedJson)
                .collect(java.util.stream.Collectors.joining(","));
        assertThat(actions).contains("\"action\":\"activated\"").contains("\"action\":\"deactivated\"");
    }

    @Test
    void importConflictOverwriteAndReviveLifecycle() {
        SkillView first = importSkill(1L, "lifecycle");

        // 同名活跃行:缺省 409(skip 语义)
        assertThatThrownBy(() -> importSkill(1L, "lifecycle"))
                .isInstanceOf(com.inneragent.platform.common.BusinessException.class)
                .hasMessageContaining("同名 Skill 已存在");

        // overwrite:整包覆盖 + definition-updated 审计
        SkillView overwritten = importSkillOverwrite(1L, "lifecycle", "轮换显示名");
        assertThat(overwritten.id()).isEqualTo(first.id());
        assertThat(overwritten.displayName()).isEqualTo("轮换显示名");
        assertThat(auditRows("skill:lifecycle", "definition-updated")).isNotEmpty();

        // 删除(逻辑)→ 同名再导入复活(不计冲突,回 inactive)
        skillService.delete(first.id(), 9L);
        IaSkill deletedRow = skillMapper.selectAnyByAppAndName(1L, "lifecycle");
        assertThat(deletedRow.getDeleted()).isTrue();
        assertThat(deletedRow.getStatus()).isEqualTo("inactive");
        SkillView revived = importSkill(1L, "lifecycle");
        assertThat(revived.id()).isEqualTo(first.id());
        assertThat(revived.active()).isFalse();
        assertThat(auditRows("skill:lifecycle", "definition-imported")).hasSize(2);
    }

    @Test
    void activationCapEightIsEnforcedPerAppWithExplicitError() {
        // 独立 appId=2 隔离激活计数(行级拦截器随 AppContext 注入)
        AppContext.setAppId(2L);
        List<Long> ids = new java.util.ArrayList<>();
        for (int index = 1; index <= 9; index++) {
            ids.add(importSkill(2L, "cap-%02d".formatted(index)).id());
        }
        for (int index = 0; index < 8; index++) {
            assertThat(skillService.activate(ids.get(index), null).active()).isTrue();
        }

        // 第 9 个:明确 409「上限 8」
        assertThatThrownBy(() -> skillService.activate(ids.get(8), null))
                .isInstanceOf(com.inneragent.platform.common.BusinessException.class)
                .hasMessageContaining("上限 8")
                .extracting("code")
                .isEqualTo(409);

        // 停用一个 → 补位成功(仍是 8 个同时激活)
        skillService.deactivate(ids.get(0), null);
        assertThat(skillService.activate(ids.get(8), null).active()).isTrue();
        assertThat(skillMapper.countActive(2L)).isEqualTo(8L);
    }

    @Test
    void builtinSkillsAreVisibleThroughKernelRegistry() {
        List<String> names = skillRegistry.catalog().stream()
                .map(reference -> reference.name())
                .toList();
        assertThat(names).contains("doc-summary", "meeting-notes", "code-review-guide");
        assertThat(names).contains("test-skill");
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private SkillView importSkill(long appId, String name) {
        Map<String, byte[]> entries = Map.of(
                "skill.json", manifestBytes(name),
                "SKILL.md", markdown(name),
                "references/guide.md", "引用指南".getBytes(StandardCharsets.UTF_8));
        return skillService.importSkill(
                appId, name + ".zip", zip(entries), null, false, null);
    }

    private SkillView importSkillOverwrite(long appId, String name, String displayName) {
        Map<String, byte[]> entries = Map.of(
                "skill.json", manifestBytes(name),
                "SKILL.md", markdown(name),
                "references/guide.md", "引用指南".getBytes(StandardCharsets.UTF_8));
        return skillService.importSkill(
                appId, name + ".zip", zip(entries), displayName, true, null);
    }

    private List<ToolAuditLog> auditRows(String toolFqn, String decision) {
        return auditMapper.selectList(new LambdaQueryWrapper<ToolAuditLog>()
                .eq(ToolAuditLog::getToolFqn, toolFqn)
                .eq(ToolAuditLog::getDecision, decision));
    }

    private static byte[] manifestBytes(String name) {
        return ("{\"name\":\"" + name + "\",\"displayName\":\"" + name
                + "\",\"description\":\"用作文档摘要与要点提取的能力扩展\","
                + "\"version\":\"1.0.0\"}").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] markdown(String name) {
        return ("---\nname: " + name
                + "\ndescription: 用作文档摘要与要点提取的能力扩展\n---\n"
                + "\n按流程完成文档摘要:先通读,再提炼要点。\n")
                .getBytes(StandardCharsets.UTF_8);
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
