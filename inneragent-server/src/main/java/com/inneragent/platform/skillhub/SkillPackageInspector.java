package com.inneragent.platform.skillhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;

/**
 * Skill 包预览校验器(P4-W13;03-开发计划 §7.3 验收 2「恶意 zip 全矩阵」)。
 *
 * <p>包结构(导入与内置库同构):包根 = 单个 Skill 目录——
 * {@code skill.json}(平台清单,必需)+ {@code SKILL.md}(提示词正文,
 * frontmatter name/description 必需)+ 可选 {@code references/**} 与
 * {@code assets/**} 资源。{@code scripts/**} 按 PRD N7「脚本说明不执行」
 * 仅提取为说明文本并出预览警告;清单若声明任何执行入口(夹带脚本声明)
 * 直接拒绝。
 *
 * <p>校验矩阵(全部在本类单测锁定):zip 条目路径穿越({@code ../}、绝对
 * 路径、{@code .}/{@code ..} 变体、反斜杠、盘符)拒;symlink/非常规文件
 * 类型(Unix mode 位,内容链接约定兜底)拒;解压总量/条目数超限拒;
 * zip bomb(压缩比异常)拒;清单缺失/非法/未知字段拒;SKILL.md 缺失/
 * 非 UTF-8/超限拒;重复条目名拒(防解析器歧义);文本资源编码校验。
 *
 * <p>zip 解析走 {@link ZipFile}(中心目录权威:条目数/尺寸/压缩比不可被
 * 本地头伪造),upload 先整读入内存(受 maxUploadBytes 约束)落临时文件。
 */
public final class SkillPackageInspector {

    private static final Logger log = LoggerFactory.getLogger(SkillPackageInspector.class);

    static final String MANIFEST_FILENAME = "skill.json";
    static final String SKILL_DOC_FILENAME = "SKILL.md";
    static final Set<String> RESERVED_FILENAMES = Set.of(".fusion-skill.json");

    /** 清单允许的字段全集(严格制:未知字段拒绝,防夹带执行入口字段)。 */
    private static final Set<String> MANIFEST_FIELDS =
            Set.of("name", "displayName", "description", "version");

    /** 夹带脚本声明的关键字段:命中即按「清单声明脚本执行」拒绝。 */
    private static final Set<String> SCRIPT_DECLARATION_FIELDS = Set.of(
            "scripts", "script", "entry", "entryPoint", "executable", "exec",
            "command", "commands", "hooks", "hook", "bin", "main", "run");

    static final Pattern SKILL_NAME_PATTERN = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");
    private static final Pattern VERSION_PATTERN = Pattern.compile("[A-Za-z0-9][A-Za-z0-9.\\-+]{0,31}");
    private static final Pattern WINDOWS_DRIVE_PATH = Pattern.compile("^[A-Za-z]:.*");
    private static final Pattern FRONTMATTER_PATTERN = Pattern.compile(
            "\\A---[ \\t]*\\r?\\n(.*?)\\r?\\n---[ \\t]*(?:\\r?\\n|\\z)(.*)\\z",
            Pattern.DOTALL);
    private static final Pattern LINK_CONTENT_PATTERN = Pattern.compile(
            "^(?:/|\\./|\\.\\.(?:/[^\\s]+)+|[^/\\s]+/\\.\\./)[^\\s]*$");
    private static final Set<String> TEXT_EXTENSIONS = Set.of(
            "md", "txt", "json", "yaml", "yml", "csv");

    private static final int MAX_PATH_LENGTH = 512;
    private static final int MAX_PATH_DEPTH = 32;
    private static final int MAX_NAME_LENGTH = 64;
    private static final int MAX_DISPLAY_NAME_LENGTH = 64;
    private static final int MAX_DESCRIPTION_LENGTH = 1024;
    private static final long MAX_SINGLE_LINK_CONTENT_BYTES = 512;

    /** Unix mode:S_IFMT 文件类型位段;S_IFREG 普通文件;S_IFLNK 符号链接。 */
    private static final long FILE_TYPE_MASK = 0170000;
    private static final long REGULAR_FILE_TYPE = 0100000;
    private static final long SYMBOLIC_LINK_TYPE = 0120000;

    private final SkillHubProperties properties;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SkillPackageInspector(SkillHubProperties properties) {
        this.properties = properties;
    }

    // ------------------------------------------------------------------
    // 公共入口:zip 模式 / 目录模式
    // ------------------------------------------------------------------

    /** 校验上传的 zip 包字节(整读入内存;超 maxUploadBytes 直接报错)。 */
    public Inspection inspectZip(byte[] zipBytes) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        if (zipBytes == null || zipBytes.length == 0) {
            errors.add("上传内容为空");
            return new Inspection(null, List.of(), errors, warnings, 0);
        }
        if (zipBytes.length > properties.getMaxUploadBytes()) {
            errors.add("zip 上传超过上限 " + properties.getMaxUploadBytes() + " 字节");
            return new Inspection(null, List.of(), errors, warnings, 0);
        }
        Path tempFile = null;
        try {
            tempFile = Files.createTempFile("ia-skill-import-", ".zip");
            Files.write(tempFile, zipBytes);
            try (ZipFile zip = openZipFile(tempFile.toFile(), errors)) {
                if (zip == null) {
                    return new Inspection(null, List.of(), errors, warnings, 0);
                }
                Map<String, Long> externalAttributes = readExternalAttributes(zipBytes);
                ZipScan scan = scanZipEntries(zip, externalAttributes, errors, warnings);
                if (scan == null) {
                    return new Inspection(null, List.of(), errors, warnings, 0);
                }
                return assemble(scan.files(), scan.totalBytes(), scan.readBudgetExceeded(),
                        errors, warnings);
            }
        } catch (IOException readFailure) {
            log.warn("Skill zip 读取失败: {}", readFailure.getMessage());
            errors.add("zip 读取失败:" + concise(readFailure));
            return new Inspection(null, List.of(), errors, warnings, 0);
        } finally {
            if (tempFile != null) {
                try {
                    Files.deleteIfExists(tempFile);
                } catch (IOException ignored) {
                    // 临时文件清理失败不影响校验结论
                }
            }
        }
    }

    /** 校验目录形态的 Skill 包(内置库启动校验共用同一规则集)。 */
    public Inspection inspectDirectory(Path root) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        if (root == null || !Files.isDirectory(root)) {
            errors.add("Skill 目录不存在");
            return new Inspection(null, List.of(), errors, warnings, 0);
        }
        Map<String, byte[]> files = new LinkedHashMap<>();
        long totalBytes = 0;
        try (Stream<Path> stream = Files.walk(root)) {
            List<Path> walk = stream.sorted().toList();
            for (Path path : walk) {
                if (path.equals(root)) {
                    continue;
                }
                String relative = root.relativize(path).toString().replace('\\', '/');
                BasicFileAttributes attributes = Files.readAttributes(
                        path, BasicFileAttributes.class);
                if (attributes.isDirectory()) {
                    continue;
                }
                if (attributes.isSymbolicLink() || !attributes.isRegularFile()) {
                    errors.add("条目包含 symlink 或非常规文件类型:" + relative);
                    continue;
                }
                PathError pathError = validateEntryPath(relative);
                if (pathError != null) {
                    errors.add(pathError.message());
                    continue;
                }
                if (files.containsKey(relative)) {
                    errors.add("导入包含重复路径:" + relative);
                    continue;
                }
                byte[] bytes = Files.readAllBytes(path);
                totalBytes += bytes.length;
                files.put(relative, bytes);
            }
        } catch (IOException walkFailure) {
            errors.add("Skill 目录读取失败:" + concise(walkFailure));
            return new Inspection(null, List.of(), errors, warnings, 0);
        }
        return assemble(files, totalBytes, false, errors, warnings);
    }

    // ------------------------------------------------------------------
    // zip 条目扫描(中心目录权威)
    // ------------------------------------------------------------------

    private ZipFile openZipFile(java.io.File file, List<String> errors) {
        try {
            return new ZipFile(file, StandardCharsets.UTF_8);
        } catch (ZipException encryptedOrInvalid) {
            errors.add("ZIP 文件无效或使用了不支持的加密方式:" + concise(encryptedOrInvalid));
            return null;
        } catch (IOException openFailure) {
            errors.add("ZIP 打开失败:" + concise(openFailure));
            return null;
        }
    }

    private record ZipScan(Map<String, byte[]> files, long totalBytes,
                           boolean readBudgetExceeded) {
    }

    private ZipScan scanZipEntries(
            ZipFile zip,
            Map<String, Long> externalAttributes,
            List<String> errors,
            List<String> warnings) {
        Map<String, byte[]> files = new LinkedHashMap<>();
        Set<String> seenNames = new HashSet<>();
        int entryCount = 0;
        long totalBytes = 0;
        boolean budgetExceeded = false;
        Enumeration<? extends ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            if (entry.isDirectory()) {
                continue;
            }
            entryCount++;
            if (entryCount > properties.getMaxEntries()) {
                errors.add("解压后条目数超过上限 " + properties.getMaxEntries());
                return null;
            }
            String name = entry.getName();
            if (!seenNames.add(name)) {
                errors.add("导入包含重复条目名:" + name);
                continue;
            }
            PathError pathError = validateEntryPath(name);
            if (pathError != null) {
                errors.add(pathError.message());
                continue;
            }
            String path = normalized(name);
            checkUnixFileType(externalAttributes.get(name), path, errors);
            checkCompressionRatio(entry, path, errors);
            if (budgetExceeded) {
                continue;
            }
            long remaining = Math.max(properties.getMaxTotalBytes() - totalBytes, 0);
            ReadOutcome outcome = readCapped(zip, entry, remaining);
            if (outcome.overBudget()) {
                errors.add("解压后总大小超过上限 " + properties.getMaxTotalBytes() + " 字节");
                budgetExceeded = true;
                continue;
            }
            totalBytes += outcome.bytes().length;
            files.put(path, outcome.bytes());
        }
        return new ZipScan(files, totalBytes, budgetExceeded);
    }

    /**
     * Unix 外部属性高 16 位 = mode:符号链接/设备/管道等非常规类型一律拒。
     * mode 缺失(0)时跳过位判断,由内容链接约定兜底校验。
     */
    private void checkUnixFileType(Long externalAttributes, String path, List<String> errors) {
        if (externalAttributes == null) {
            return;
        }
        long mode = (externalAttributes >>> 16) & 0xFFFF;
        if (mode == 0) {
            return;
        }
        long fileType = mode & FILE_TYPE_MASK;
        if (fileType == SYMBOLIC_LINK_TYPE) {
            errors.add("条目包含 symlink(拒绝导入):" + path);
        } else if (fileType != REGULAR_FILE_TYPE) {
            errors.add("条目包含非常规文件类型(mode=" + Long.toOctalString(mode) + "):" + path);
        }
    }

    /**
     * 从中心目录读取各条目的 Unix 外部属性(JDK zip API 不暴露;EOCD→记录
     * 头偏移 +38 处 4 字节小端)。zip64/解析失败时返回空 map(best-effort:
     * 结构合法性已由 ZipFile 保证,mode 缺失走内容链接约定兜底)。
     */
    static Map<String, Long> readExternalAttributes(byte[] zipBytes) {
        Map<String, Long> attributes = new LinkedHashMap<>();
        long eocd = findEocdOffset(zipBytes);
        if (eocd < 0) {
            return attributes;
        }
        int entryCount = readU16(zipBytes, (int) (eocd + 10));
        long centralOffset = readU32(zipBytes, (int) (eocd + 16));
        int cursor = (int) centralOffset;
        for (int index = 0; index < entryCount; index++) {
            if (cursor + 46 > zipBytes.length
                    || readU32(zipBytes, cursor) != CENTRAL_DIRECTORY_SIGNATURE) {
                return attributes;
            }
            int nameLength = readU16(zipBytes, cursor + 28);
            int extraLength = readU16(zipBytes, cursor + 30);
            int commentLength = readU16(zipBytes, cursor + 32);
            long externalAttributes = readU32(zipBytes, cursor + 38);
            if (cursor + 46 + nameLength > zipBytes.length) {
                return attributes;
            }
            String name = new String(zipBytes, cursor + 46, nameLength,
                    StandardCharsets.UTF_8);
            attributes.putIfAbsent(name, externalAttributes);
            cursor += 46 + nameLength + extraLength + commentLength;
        }
        return attributes;
    }

    private static final int EOCD_SIGNATURE = 0x06054b50;
    private static final int CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
    private static final int EOCD_SCAN_WINDOW = 65_571;

    private static long findEocdOffset(byte[] zipBytes) {
        int scanStart = Math.max(0, zipBytes.length - EOCD_SCAN_WINDOW);
        for (int cursor = zipBytes.length - 22; cursor >= scanStart; cursor--) {
            if (readU32(zipBytes, cursor) == EOCD_SIGNATURE) {
                return cursor;
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

    /** zip bomb:单条目 解压后/压缩后 比值超限即拒(中心目录尺寸不可伪造)。 */
    private void checkCompressionRatio(ZipEntry entry, String path, List<String> errors) {
        long compressed = entry.getCompressedSize();
        long uncompressed = entry.getSize();
        if (compressed <= 0 || uncompressed <= 0) {
            return;
        }
        long ratio = uncompressed / compressed;
        if (ratio > properties.getMaxCompressionRatio()) {
            errors.add("条目压缩比 " + ratio + " 超过上限 " + properties.getMaxCompressionRatio()
                    + "(疑似 zip bomb):" + path);
        }
    }

    private record ReadOutcome(byte[] bytes, boolean overBudget) {
    }

    private ReadOutcome readCapped(ZipFile zip, ZipEntry entry, long remaining) {
        try (var input = zip.getInputStream(entry)) {
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            long count = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                count += read;
                if (count > remaining) {
                    return new ReadOutcome(new byte[0], true);
                }
                output.write(buffer, 0, read);
            }
            return new ReadOutcome(output.toByteArray(), false);
        } catch (IOException readFailure) {
            throw new IllegalStateException("读取 zip 条目失败:" + entry.getName(), readFailure);
        }
    }

    // ------------------------------------------------------------------
    // 内容级校验(清单/SKILL.md/资源;zip 与目录模式共用)
    // ------------------------------------------------------------------

    private Inspection assemble(
            Map<String, byte[]> files,
            long totalBytes,
            boolean readBudgetExceeded,
            List<String> errors,
            List<String> warnings) {
        if (readBudgetExceeded) {
            return new Inspection(null, List.copyOf(files.keySet()), List.copyOf(errors),
                    List.copyOf(warnings), totalBytes);
        }
        byte[] manifestBytes = files.get(MANIFEST_FILENAME);
        byte[] skillBytes = files.get(SKILL_DOC_FILENAME);
        if (manifestBytes == null) {
            errors.add("缺少 " + MANIFEST_FILENAME + " 清单(必须位于包根)");
        }
        if (skillBytes == null) {
            errors.add("缺少 " + SKILL_DOC_FILENAME + "(必须位于包根)");
        }
        // 资源级校验(保留文件/链接约定/文本编码)不受清单缺失影响:
        // 预览语义要求一次性给出全量问题列表
        for (Map.Entry<String, byte[]> file : files.entrySet()) {
            validateResource(file.getKey(), file.getValue(), errors, warnings);
        }
        if (manifestBytes == null || skillBytes == null) {
            return new Inspection(null, List.copyOf(files.keySet()), List.copyOf(errors),
                    List.copyOf(warnings), totalBytes);
        }

        ManifestResult manifest = parseManifest(manifestBytes, errors);
        MarkdownResult markdown = parseSkillMarkdown(skillBytes, errors);
        long contentBytes = totalBytes;
        if (contentBytes > properties.getMaxSkillContentBytes()) {
            errors.add("单个 Skill 内容上限 " + properties.getMaxSkillContentBytes()
                    + " 字节(PRD 128KB),当前 " + contentBytes);
        }
        if (manifest.name() != null && markdown.name() != null
                && !manifest.name().equals(markdown.name())) {
            errors.add("清单 name 与 SKILL.md frontmatter name 不一致:"
                    + manifest.name() + " / " + markdown.name());
        }
        if (errors.isEmpty() && manifest.name() != null && markdown.name() != null) {
            SkillManifest sealedManifest = new SkillManifest(
                    manifest.name(),
                    manifest.displayName() == null ? manifest.name() : manifest.displayName(),
                    manifest.description(),
                    manifest.version());
            List<PackageFile> packageFiles = files.entrySet().stream()
                    .filter(file -> !MANIFEST_FILENAME.equals(file.getKey()))
                    .map(file -> PackageFile.of(file.getKey(), file.getValue()))
                    .toList();
            return new Inspection(
                    new SkillPackage(sealedManifest, markdown.markdown(), packageFiles, totalBytes),
                    List.copyOf(files.keySet()), List.of(), List.copyOf(warnings), totalBytes);
        }
        return new Inspection(null, List.copyOf(files.keySet()), List.copyOf(errors),
                List.copyOf(warnings), totalBytes);
    }

    private ManifestResult parseManifest(byte[] bytes, List<String> errors) {
        String json = decodeUtf8(bytes, MANIFEST_FILENAME, errors);
        if (json == null) {
            return new ManifestResult(null, null, null, null);
        }
        JsonNode root;
        try {
            root = objectMapper.readTree(json);
        } catch (IOException malformed) {
            errors.add(MANIFEST_FILENAME + " 不是合法 JSON:" + concise(malformed));
            return new ManifestResult(null, null, null, null);
        }
        if (root == null || !root.isObject()) {
            errors.add(MANIFEST_FILENAME + " 必须是 JSON 对象");
            return new ManifestResult(null, null, null, null);
        }
        List<String> smuggled = new ArrayList<>();
        List<String> unknown = new ArrayList<>();
        root.fieldNames().forEachRemaining(field -> {
            if (SCRIPT_DECLARATION_FIELDS.contains(field)) {
                smuggled.add(field);
            } else if (!MANIFEST_FIELDS.contains(field)) {
                unknown.add(field);
            }
        });
        if (!smuggled.isEmpty()) {
            errors.add("清单声明了脚本执行入口(夹带脚本声明,拒绝导入):" + smuggled);
        }
        if (!unknown.isEmpty()) {
            errors.add("清单存在未知字段(允许 " + MANIFEST_FIELDS + "):" + unknown);
        }
        String name = root.path("name").isTextual() ? root.path("name").asText().trim() : null;
        if (name == null || name.isBlank()) {
            errors.add("清单 name 不能为空");
            name = null;
        } else if (name.length() > MAX_NAME_LENGTH
                || !SKILL_NAME_PATTERN.matcher(name).matches()) {
            errors.add("清单 name 只能包含小写字母、数字和非连续短横线,最长 64 位");
            name = null;
        }
        String displayName = root.path("displayName").isTextual()
                ? root.path("displayName").asText().trim() : null;
        if (displayName != null && displayName.isBlank()) {
            displayName = null;
        }
        if (displayName != null && displayName.length() > MAX_DISPLAY_NAME_LENGTH) {
            errors.add("清单 displayName 不能超过 " + MAX_DISPLAY_NAME_LENGTH + " 个字符");
            displayName = null;
        }
        String description = root.path("description").isTextual()
                ? root.path("description").asText().trim() : null;
        if (description == null || description.isBlank()) {
            errors.add("清单 description 不能为空");
        } else if (description.length() > MAX_DESCRIPTION_LENGTH) {
            errors.add("清单 description 不能超过 " + MAX_DESCRIPTION_LENGTH + " 个字符");
        }
        String version = root.path("version").isTextual()
                ? root.path("version").asText().trim() : null;
        if (version != null && version.isBlank()) {
            version = null;
        }
        if (version != null && !VERSION_PATTERN.matcher(version).matches()) {
            errors.add("清单 version 只能包含字母、数字与 .-+,最长 32 位");
            version = null;
        }
        if (name == null || description == null || description.isBlank()) {
            return new ManifestResult(null, displayName, description, version);
        }
        return new ManifestResult(name, displayName, description, version);
    }

    private MarkdownResult parseSkillMarkdown(byte[] bytes, List<String> errors) {
        String markdown = decodeUtf8(bytes, SKILL_DOC_FILENAME, errors);
        if (markdown == null) {
            return new MarkdownResult(null, null);
        }
        Matcher matcher = FRONTMATTER_PATTERN.matcher(markdown);
        if (!matcher.matches()) {
            errors.add(SKILL_DOC_FILENAME + " 必须以 YAML frontmatter 开头");
            return new MarkdownResult(null, null);
        }
        String frontmatter = matcher.group(1);
        String name = frontmatterValue(frontmatter, "name");
        String description = frontmatterValue(frontmatter, "description");
        if (name == null || name.isBlank()) {
            errors.add(SKILL_DOC_FILENAME + " frontmatter.name 不能为空");
            name = null;
        } else if (name.length() > MAX_NAME_LENGTH
                || !SKILL_NAME_PATTERN.matcher(name).matches()) {
            errors.add(SKILL_DOC_FILENAME + " frontmatter.name 只能包含小写字母、数字"
                    + "和非连续短横线,最长 64 位");
            name = null;
        }
        if (description == null || description.isBlank()) {
            errors.add(SKILL_DOC_FILENAME + " frontmatter.description 不能为空");
        }
        if (matcher.group(2).isBlank()) {
            errors.add(SKILL_DOC_FILENAME + " 正文不能为空");
        }
        if (name == null) {
            return new MarkdownResult(null, null);
        }
        return new MarkdownResult(name, markdown);
    }

    /** 最小 frontmatter 标量取值(单行 key: value;仅取 name/description)。 */
    private static String frontmatterValue(String frontmatter, String key) {
        for (String line : frontmatter.split("\r?\n")) {
            String trimmed = line.strip();
            if (trimmed.startsWith(key + ":")) {
                return trimmed.substring(key.length() + 1).trim()
                        .replaceAll("^[\"']|[\"']$", "");
            }
        }
        return null;
    }

    private void validateResource(
            String path,
            byte[] bytes,
            List<String> errors,
            List<String> warnings) {
        if (RESERVED_FILENAMES.stream().anyMatch(path::endsWith)
                || RESERVED_FILENAMES.contains(fileName(path))) {
            errors.add(path + " 是系统保留文件,不能导入");
            return;
        }
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.startsWith("scripts/")) {
            // PRD N7「脚本说明不执行」:提取为说明文本保留,预览警告
            warnings.add("包含 scripts/:文件会原样保存为说明文本,第一期不会执行脚本:"
                    + path);
            return;
        }
        if (isTextPath(path)) {
            decodeUtf8(bytes, path, errors);
            return;
        }
        // 无扩展名小文件的链接内容约定兜底(部分打包器不写 mode 位)
        String extension = extensionOf(path);
        if (extension.isEmpty() && bytes.length <= MAX_SINGLE_LINK_CONTENT_BYTES) {
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            if (content.chars().noneMatch(Character::isISOControl)
                    && LINK_CONTENT_PATTERN.matcher(content).matches()) {
                errors.add("条目疑似 symlink/链接条目(内容为路径),拒绝导入:" + path);
            }
        }
    }

    private static boolean isTextPath(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (SKILL_DOC_FILENAME.equalsIgnoreCase(fileName(path))
                || MANIFEST_FILENAME.equalsIgnoreCase(fileName(path))) {
            return true;
        }
        return TEXT_EXTENSIONS.contains(extensionOf(lower));
    }

    private static String extensionOf(String path) {
        String name = fileName(path);
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1);
    }

    private static String fileName(String path) {
        int slash = path.lastIndexOf('/');
        return slash < 0 ? path : path.substring(slash + 1);
    }

    private static String decodeUtf8(byte[] bytes, String path, List<String> errors) {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException invalid) {
            errors.add(path + " 必须使用 UTF-8 编码");
            return null;
        }
    }

    // ------------------------------------------------------------------
    // 条目路径校验(穿越矩阵;zip 与目录模式共用)
    // ------------------------------------------------------------------

    private record PathError(String message) {
    }

    private PathError validateEntryPath(String rawPath) {
        if (rawPath == null || rawPath.isBlank()
                || rawPath.codePoints().anyMatch(Character::isISOControl)) {
            return new PathError("导入包含空路径或非法控制字符路径");
        }
        if (rawPath.indexOf('\\') >= 0) {
            return new PathError("导入包含反斜杠路径(拒绝):" + rawPath);
        }
        if (rawPath.startsWith("/") || WINDOWS_DRIVE_PATH.matcher(rawPath).matches()) {
            return new PathError("导入包含绝对路径(拒绝):" + rawPath);
        }
        String path = rawPath;
        while (path.startsWith("./")) {
            path = path.substring(2);
        }
        path = Normalizer.normalize(path, Normalizer.Form.NFC);
        String[] segments = path.split("/", -1);
        if (path.length() > MAX_PATH_LENGTH || segments.length > MAX_PATH_DEPTH) {
            return new PathError("导入路径过长或目录层级过深:" + rawPath);
        }
        for (String segment : segments) {
            if (segment.isBlank() || ".".equals(segment) || "..".equals(segment)) {
                return new PathError("导入包含路径穿越或空目录段(拒绝):" + rawPath);
            }
        }
        return null;
    }

    private static String normalized(String rawPath) {
        String path = rawPath;
        while (path.startsWith("./")) {
            path = path.substring(2);
        }
        return Normalizer.normalize(path, Normalizer.Form.NFC);
    }

    private static String concise(Throwable failure) {
        String message = failure.getMessage();
        if (message == null || message.isBlank()) {
            return failure.getClass().getSimpleName();
        }
        return message.lines().findFirst().orElse(message);
    }

    // ------------------------------------------------------------------
    // 结果形状
    // ------------------------------------------------------------------

    /** 校验通过后的包(清单 + SKILL.md 正文 + 全部文件;清单本体不在 files 内)。 */
    public record SkillPackage(
            SkillManifest manifest,
            String skillMarkdown,
            List<PackageFile> files,
            long totalBytes) {
    }

    /** 平台清单(skill.json;严格字段全集)。 */
    public record SkillManifest(
            String name,
            String displayName,
            String description,
            String version) {
    }

    /** 单文件条目(存储编码已定:utf-8 文本 / base64 二进制)。 */
    public record PackageFile(String path, String encoding, byte[] bytes) {

        public static PackageFile of(String path, byte[] bytes) {
            return new PackageFile(path, isTextFile(path) ? "utf-8" : "base64", bytes);
        }

        private static boolean isTextFile(String path) {
            String name = path.substring(path.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
            if (name.equals(SKILL_DOC_FILENAME.toLowerCase(Locale.ROOT))
                    || name.equals(MANIFEST_FILENAME)) {
                return true;
            }
            int dot = name.lastIndexOf('.');
            String extension = dot < 0 ? "" : name.substring(dot + 1);
            return TEXT_EXTENSIONS.contains(extension);
        }
    }

    /**
     * 校验结论:{@code valid()}=errors 为空且包完整;预览端点直接透出
     * 清单/文件清单/问题列表(dryRun 语义,零落库)。
     */
    public record Inspection(
            SkillPackage pkg,
            List<String> filePaths,
            List<String> errors,
            List<String> warnings,
            long totalBytes) {

        public boolean valid() {
            return pkg != null && errors.isEmpty();
        }

        public SkillPackage packageOrThrow() {
            if (pkg == null) {
                throw new IllegalStateException("Skill 包未通过校验,无可用包对象");
            }
            return pkg;
        }
    }

    private record ManifestResult(
            String name,
            String displayName,
            String description,
            String version) {
    }

    private record MarkdownResult(String name, String markdown) {
    }
}
