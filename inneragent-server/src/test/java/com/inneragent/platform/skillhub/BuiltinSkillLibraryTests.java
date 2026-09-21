package com.inneragent.platform.skillhub;

import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.agent.skill.AgentScopeSkillRegistry;
import io.agentscope.core.skill.util.SkillUtil;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 内置 Skill 库启动校验单测(P4-W13 PRD M4「内置仓库:平台内置基础 Skill,
 * 随版本发布」)。锁三件事:
 *
 * <ol>
 *   <li>resources/skills/builtin 下每个 Skill 目录与导入器同构
 *       (skill.json + SKILL.md + references/),并通过导入器同一套
 *       预览校验(零错误零警告——内置库不允许夹带 scripts/);</li>
 *   <li>目录名 = 清单 name = frontmatter name(三处一致);</li>
 *   <li>内核 ClasspathSkillRepository 注册路径真实可加载
 *       (AgentScopeSkillRegistry + SkillUtil 双口径),即 yml 中
 *       repositories.builtin 在应用启动时 fail-fast 校验必过。</li>
 * </ol>
 */
class BuiltinSkillLibraryTests {

    private static final String BUILTIN_LOCATION = "classpath:skills/builtin";

    private final SkillPackageInspector inspector = new SkillPackageInspector(new SkillHubProperties());

    @Test
    void builtinLibraryPassesImporterValidation() throws IOException {
        List<SkillPackageInspector.Inspection> inspections = inspectBuiltins();

        assertThat(inspections).hasSizeGreaterThanOrEqualTo(2);
        for (SkillPackageInspector.Inspection inspection : inspections) {
            assertThat(inspection.errors()).isEmpty();
            // 内置库不允许 scripts/(即或有也只警告;这里直接锁零警告)
            assertThat(inspection.warnings()).isEmpty();
        }
    }

    @Test
    void builtinDirectoryManifestAndFrontmatterNamesAgree() throws IOException {
        for (BuiltinSkill builtin : listBuiltinDirectories()) {
            SkillPackageInspector.Inspection inspection =
                    inspector.inspectDirectory(builtin.directory());
            assertThat(inspection.valid())
                    .as("内置 Skill %s 校验", builtin.directoryName())
                    .isTrue();
            assertThat(builtin.directoryName())
                    .isEqualTo(inspection.packageOrThrow().manifest().name());
        }
    }

    @Test
    void kernelRegistryLoadsBuiltinRepositoryByName() throws IOException {
        Set<String> directoryNames = new LinkedHashSet<>();
        listBuiltinDirectories().forEach(skill -> directoryNames.add(skill.directoryName()));

        AgentScopeV2Properties properties = new AgentScopeV2Properties();
        properties.getSkills().setEnabled(true);
        AgentScopeV2Properties.SkillRepository builtin =
                new AgentScopeV2Properties.SkillRepository();
        builtin.setLocation(BUILTIN_LOCATION);
        builtin.setLazy(false);
        properties.getSkills().setRepositories(Map.of("builtin", builtin));

        AgentScopeSkillRegistry registry = new AgentScopeSkillRegistry(properties);
        try {
            // ClasspathSkillRepository 加载口径:frontmatter name 提取 + 非空正文
            List<String> kernelNames = registry.skills().stream()
                    .map(skill -> {
                        assertThat(skill.getSkillContent()).isNotBlank();
                        assertThat(skill.getDescription()).isNotBlank();
                        return skill.getName();
                    })
                    .sorted()
                    .toList();
            assertThat(kernelNames)
                    .containsExactlyElementsOf(directoryNames.stream().sorted().toList());
        } finally {
            registry.destroy();
        }
        // SkillUtil 解析口径(与用户级编辑/激活一致;输入须带 frontmatter 原文)
        for (BuiltinSkill entry : listBuiltinDirectories()) {
            String raw = Files.readString(
                    entry.directory().resolve("SKILL.md"), StandardCharsets.UTF_8);
            assertThat(SkillUtil.createFrom(raw, null, "builtin").getName())
                    .isEqualTo(entry.directoryName());
        }
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private List<SkillPackageInspector.Inspection> inspectBuiltins() throws IOException {
        List<SkillPackageInspector.Inspection> inspections = new ArrayList<>();
        for (BuiltinSkill builtin : listBuiltinDirectories()) {
            inspections.add(inspector.inspectDirectory(builtin.directory()));
        }
        return inspections;
    }

    private List<BuiltinSkill> listBuiltinDirectories() throws IOException {
        PathMatchingResourceResolver resolver = new PathMatchingResourceResolver();
        List<BuiltinSkill> directories = new ArrayList<>();
        for (Resource directory : resolver.resolve()) {
            Path path = directory.getFile().toPath();
            if (!Files.isDirectory(path)) {
                continue;
            }
            directories.add(new BuiltinSkill(path.getFileName().toString(), path));
        }
        assertThat(directories).hasSizeGreaterThanOrEqualTo(2);
        return directories;
    }

    /** classpath 目录枚举(测试运行时 resources 位于磁盘目录,可 getFile)。 */
    private static final class PathMatchingResourceResolver {

        private final PathMatchingResourcePatternResolver delegate =
                new PathMatchingResourcePatternResolver();

        Resource[] resolve() throws IOException {
            return delegate.getResources(BUILTIN_LOCATION + "/*");
        }
    }

    private record BuiltinSkill(String directoryName, Path directory) {
    }
}
