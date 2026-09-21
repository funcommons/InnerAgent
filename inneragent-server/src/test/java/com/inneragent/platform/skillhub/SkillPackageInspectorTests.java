package com.inneragent.platform.skillhub;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Skill 包预览校验矩阵单测(P4-W13;03-开发计划 §7.3 验收 2)。
 *
 * <p>恶意 zip 全矩阵:路径穿越(../、绝对路径、.. 变体、反斜杠、盘符)、
 * symlink/非常规文件类型条目、解压总量/条目数超限、zip bomb(压缩比)、
 * skill.json 清单缺失/非法/未知字段/夹带脚本声明、SKILL.md 缺失/编码/
 * 大小、重复条目名。全部以手工构造字节驱动,不依赖外部样例包。
 */
class SkillPackageInspectorTests {

    private static final String DESCRIPTION = "用作文档摘要与要点提取的能力扩展";

    private final SkillPackageInspector inspector = new SkillPackageInspector(new SkillHubProperties());

    // ------------------------------------------------------------------
    // 合法包(基线)
    // ------------------------------------------------------------------

    @Test
    void validPackagePassesWithManifestAndFiles() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("references/guide.md", "引用指南".getBytes(StandardCharsets.UTF_8));
        entries.put("assets/logo.png", new byte[]{(byte) 0x89, 0x50, 0x4E, 0x47});

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isTrue();
        assertThat(inspection.errors()).isEmpty();
        assertThat(inspection.warnings()).isEmpty();
        assertThat(inspection.packageOrThrow().manifest().name()).isEqualTo("doc-summary");
        assertThat(inspection.packageOrThrow().manifest().description()).isEqualTo(DESCRIPTION);
        assertThat(inspection.packageOrThrow().skillMarkdown()).contains("doc-summary");
        assertThat(inspection.packageOrThrow().files()).extracting(
                        SkillPackageInspector.PackageFile::path)
                .containsExactly("SKILL.md", "references/guide.md", "assets/logo.png");
        assertThat(inspection.packageOrThrow().files().get(2).encoding()).isEqualTo("base64");
    }

    @Test
    void scriptsDirectoryIsKeptAsDocumentationWithWarning() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("scripts/run.py", "print('ok')".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        // PRD N7「脚本说明不执行」:scripts/ 保留为说明文本 + 预览警告
        assertThat(inspection.valid()).isTrue();
        assertThat(inspection.warnings()).anyMatch(w -> w.contains("不会执行"));
        assertThat(inspection.packageOrThrow().files())
                .anyMatch(file -> file.path().equals("scripts/run.py"));
    }

    // ------------------------------------------------------------------
    // 路径穿越矩阵
    // ------------------------------------------------------------------

    @Test
    void rejectsParentDirectoryTraversal() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("../evil/SKILL.md", skillMarkdown("evil", false));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("路径穿越"));
    }

    @Test
    void rejectsAbsolutePathEntry() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("/etc/evil.txt", "x".getBytes(StandardCharsets.UTF_8));
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("绝对路径"));
    }

    @Test
    void rejectsDotSegmentVariants() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("references/./x.md", "x".getBytes(StandardCharsets.UTF_8));
        entries.put("references/a/../b.md", "x".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("路径穿越"));
    }

    @Test
    void rejectsBackslashTraversal() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("..\\evil.txt", "x".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("反斜杠"));
    }

    @Test
    void rejectsBackslashSeparator() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("references\\guide.md", "x".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("反斜杠"));
    }

    @Test
    void rejectsWindowsDrivePath() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("C:evil.txt", "x".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("绝对路径"));
    }

    // ------------------------------------------------------------------
    // symlink / 非常规文件类型
    // ------------------------------------------------------------------

    @Test
    void rejectsSymlinkEntryWithUnixModeBits() throws IOException {
        // S_IFLNK(0o120000)|0777:符号链接条目,一律拒
        byte[] zipBytes = zipWithModeledEntries(Map.of("SKILL.md",
                new ModeledEntry("link/pointing/target".getBytes(StandardCharsets.UTF_8),
                        (short) (0120000 | 0777))));
        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zipBytes);

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("symlink"));
    }

    @Test
    void rejectsFifoEntryWithUnixModeBits() throws IOException {
        // S_IFIFO(0o10000)|0777:非常规文件类型(管道),一律拒
        byte[] zipBytes = zipWithModeledEntries(Map.of("fifopipe",
                new ModeledEntry(new byte[0], (short) (010000 | 0777))));
        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zipBytes);

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("非常规"));
    }

    @Test
    void rejectsEntryPointingOutsideByLinkConventionEvenWithoutModeBits() {
        // 部分打包器不写 mode 位,但条目内容为「目标路径」的链接约定;
        // 此场景按内容启发式兜底拒收(误报面极小:SKILL.md 级路径串)
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("link", "../../outside/target.txt".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("链接"));
    }

    // ------------------------------------------------------------------
    // 超限 / zip bomb
    // ------------------------------------------------------------------

    @Test
    void rejectsEntryCountOverLimit() {
        SkillHubProperties tight = new SkillHubProperties();
        tight.setMaxEntries(3);
        SkillPackageInspector tightInspector = new SkillPackageInspector(tight);
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("references/a.md", "a".getBytes(StandardCharsets.UTF_8));
        entries.put("references/b.md", "b".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = tightInspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("条目数"));
    }

    @Test
    void rejectsInflatedTotalOverLimit() {
        SkillHubProperties tight = new SkillHubProperties();
        tight.setMaxTotalBytes(512);
        SkillPackageInspector tightInspector = new SkillPackageInspector(tight);
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("references/big.md", ("# 大文件\n\n" + "正文内容。".repeat(200))
                .getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = tightInspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("总大小"));
    }

    @Test
    void rejectsZipBombByCompressionRatioBeforeTotalSizeMatters() {
        // 5MB 全零:解压总量在缺省 10MB 之下,但压缩比 >1000 → 按 bomb 拒
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("assets/bomb.bin", new byte[5 * 1024 * 1024]);

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("压缩比"));
        assertThat(inspection.errors()).noneMatch(e -> e.contains("总大小"));
    }

    // ------------------------------------------------------------------
    // skill.json 清单
    // ------------------------------------------------------------------

    @Test
    void rejectsMissingManifest() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("skill.json"));
    }

    @Test
    void rejectsManifestNotAnObject() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", "[]".getBytes(StandardCharsets.UTF_8));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("skill.json"));
    }

    @Test
    void rejectsManifestWithUnknownField() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", ("{\"name\":\"doc-summary\",\"description\":\"" + DESCRIPTION
                + "\",\"autoRun\":true}").getBytes(StandardCharsets.UTF_8));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("未知字段"));
    }

    @Test
    void rejectsManifestSmuggledScriptExecutionDeclaration() {
        // 夹带脚本声明:清单声明执行入口 → 预览校验拦截(03-开发计划 §7.3 验收 2)
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", ("{\"name\":\"doc-summary\",\"description\":\"" + DESCRIPTION
                + "\",\"scripts\":{\"entry\":\"scripts/run.py\"}}").getBytes(StandardCharsets.UTF_8));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("scripts/run.py", "print('ok')".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("脚本执行"));
    }

    @Test
    void rejectsManifestScriptEntryKeyVariant() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", ("{\"name\":\"doc-summary\",\"description\":\"" + DESCRIPTION
                + "\",\"executable\":true}").getBytes(StandardCharsets.UTF_8));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("脚本执行"));
    }

    @Test
    void rejectsManifestWithBlankOrMalformedName() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", ("{\"name\":\"Bad Name!\",\"description\":\"" + DESCRIPTION
                + "\"}").getBytes(StandardCharsets.UTF_8));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("name"));
    }

    @Test
    void rejectsManifestDescriptionMissing() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", "{\"name\":\"doc-summary\"}".getBytes(StandardCharsets.UTF_8));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("description"));
    }

    @Test
    void rejectsManifestNameMismatchWithSkillMdFrontmatter() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("other-name", true));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("name"));
    }

    // ------------------------------------------------------------------
    // SKILL.md 与资源
    // ------------------------------------------------------------------

    @Test
    void rejectsMissingSkillMarkdown() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("SKILL.md"));
    }

    @Test
    void rejectsNonUtf8SkillMarkdown() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", new byte[]{(byte) 0xFF, (byte) 0xFE, 0x41, 0x00});

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("UTF-8"));
    }

    @Test
    void rejectsSkillContentOverLimit() {
        SkillHubProperties tight = new SkillHubProperties();
        tight.setMaxSkillContentBytes(256);
        SkillPackageInspector tightInspector = new SkillPackageInspector(tight);
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("references/big.md", ("引用内容。".repeat(100)).getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = tightInspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("内容上限"));
    }

    @Test
    void rejectsNonUtf8TextResource() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put("references/guide.md", new byte[]{(byte) 0xFF, (byte) 0xFE, 0x41});

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("UTF-8"));
    }

    @Test
    void rejectsReservedMetadataFile() {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        entries.put(".fusion-skill.json", "{}".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zip(entries));

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("保留"));
    }

    @Test
    void rejectsDuplicateEntryNames() throws IOException {
        // ZipOutputStream 拒绝重名条目;构造同长度名再用中心目录+本地头
        // 原位改名,得到「dup.txt 出现两次」的真实字节
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("dup.txt", "first".getBytes(StandardCharsets.UTF_8));
        entries.put("dut.txt", "second".getBytes(StandardCharsets.UTF_8));
        entries.put("skill.json", manifestBytes("doc-summary"));
        entries.put("SKILL.md", skillMarkdown("doc-summary", true));
        byte[] zipBytes = renameSecondEntryToDuplicate(zip(entries));

        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zipBytes);

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("重复"));
    }

    /** 把中心目录与本地头中的第二个条目(dut.txt)改名为首个条目(dup.txt)。 */
    private static byte[] renameSecondEntryToDuplicate(byte[] zipBytes) {
        int cursor = findCentralDirectoryOffset(zipBytes);
        int renamed = 0;
        while (cursor + 46 <= zipBytes.length
                && readU32(zipBytes, cursor) == 0x02014b50) {
            int nameLength = readU16(zipBytes, cursor + 28);
            int extraLength = readU16(zipBytes, cursor + 30);
            int commentLength = readU16(zipBytes, cursor + 32);
            String name = new String(zipBytes, cursor + 46, nameLength,
                    StandardCharsets.UTF_8);
            if ("dut.txt".equals(name)) {
                long localOffset = readU32(zipBytes, cursor + 42);
                int localNameLength = readU16(zipBytes, (int) localOffset + 26);
                for (int index = 0; index < localNameLength; index++) {
                    zipBytes[(int) localOffset + 30 + index] =
                            "dup.txt".getBytes(StandardCharsets.UTF_8)[index];
                }
                for (int index = 0; index < nameLength; index++) {
                    zipBytes[cursor + 46 + index] =
                            "dup.txt".getBytes(StandardCharsets.UTF_8)[index];
                }
                renamed++;
            }
            cursor += 46 + nameLength + extraLength + commentLength;
        }
        assertThat(renamed).isEqualTo(1);
        return zipBytes;
    }

    // ------------------------------------------------------------------
    // 目录模式(内置 Skill 启动校验共用)
    // ------------------------------------------------------------------

    @Test
    void directoryModeValidatesBuiltinLayout(@TempDir Path root) throws IOException {
        Files.createDirectories(root.resolve("references"));
        Files.write(root.resolve("skill.json"), manifestBytes("doc-summary"));
        Files.write(root.resolve("SKILL.md"), skillMarkdown("doc-summary", true));
        Files.write(root.resolve("references/guide.md"),
                "引用指南".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectDirectory(root);

        assertThat(inspection.valid()).isTrue();
        assertThat(inspection.packageOrThrow().manifest().name()).isEqualTo("doc-summary");
        assertThat(inspection.packageOrThrow().files()).hasSize(2);
    }

    @Test
    void directoryModeRejectsTraversalLikeNames(@TempDir Path root) throws IOException {
        Files.write(root.resolve("skill.json"), manifestBytes("doc-summary"));
        // 绝对路径片段不可能由目录遍历产生;但空段/保留文件仍由同规则覆盖
        Files.write(root.resolve(".fusion-skill.json"), "{}".getBytes(StandardCharsets.UTF_8));

        SkillPackageInspector.Inspection inspection = inspector.inspectDirectory(root);

        assertThat(inspection.valid()).isFalse();
        assertThat(inspection.errors()).anyMatch(e -> e.contains("保留"));
    }

    // ------------------------------------------------------------------
    // 构造工具
    // ------------------------------------------------------------------

    private static byte[] manifestBytes(String name) {
        return ("{\"name\":\"" + name + "\",\"displayName\":\"文档摘要\",\"description\":\""
                + DESCRIPTION + "\",\"version\":\"1.0.0\"}").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] skillMarkdown(String name, boolean withBody) {
        String body = withBody
                ? "\n按以下流程完成文档摘要:\n1. 通读全文\n2. 提炼要点\n"
                : "";
        return ("---\nname: " + name + "\ndescription: " + DESCRIPTION + "\n---\n" + body)
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
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
        return output.toByteArray();
    }

    /** 构造带 Unix mode 位的条目(见 zipWithModeledEntries)。 */
    private static byte[] zipWithModeledEntries(Map<String, ModeledEntry> entries)
            throws IOException {
        Map<String, byte[]> plain = new LinkedHashMap<>();
        Map<String, Short> modes = new LinkedHashMap<>();
        entries.forEach((path, entry) -> {
            plain.put(path, entry.content());
            modes.put(path, entry.mode());
        });
        return patchExternalAttributes(zip(plain), modes);
    }

    private static byte[] patchExternalAttributes(byte[] zipBytes, Map<String, Short> modes) {
        int cursor = findCentralDirectoryOffset(zipBytes);
        while (cursor + 46 <= zipBytes.length
                && readU32(zipBytes, cursor) == 0x02014b50) {
            int nameLength = readU16(zipBytes, cursor + 28);
            int extraLength = readU16(zipBytes, cursor + 30);
            int commentLength = readU16(zipBytes, cursor + 32);
            String name = new String(zipBytes, cursor + 46, nameLength,
                    StandardCharsets.UTF_8);
            Short mode = modes.get(name);
            if (mode != null) {
                long externalAttributes = (mode & 0xFFFFL) << 16;
                for (int index = 0; index < 4; index++) {
                    zipBytes[cursor + 38 + index] = (byte) (externalAttributes >>> (8 * index));
                }
            }
            cursor += 46 + nameLength + extraLength + commentLength;
        }
        return zipBytes;
    }

    /** 从 EOCD(签名 0x06054b50,倒序扫描末 64KB 窗口)定位中心目录起点。 */
    private static int findCentralDirectoryOffset(byte[] zipBytes) {
        int scanStart = Math.max(0, zipBytes.length - 65_571);
        for (int cursor = zipBytes.length - 22; cursor >= scanStart; cursor--) {
            if (readU32(zipBytes, cursor) == 0x06054b50) {
                return (int) readU32(zipBytes, cursor + 16);
            }
        }
        return -1;
    }

    private static int readU16(byte[] bytes, int offset) {
        return (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
    }

    private static long readU32(byte[] bytes, int offset) {
        return (bytes[offset] & 0xFFL)
                | ((bytes[offset + 1] & 0xFFL) << 8)
                | ((bytes[offset + 2] & 0xFFL) << 16)
                | ((bytes[offset + 3] & 0xFFL) << 24);
    }

    private record ModeledEntry(byte[] content, short mode) {
    }
}
