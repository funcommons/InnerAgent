package com.inneragent.platform.skillhub;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.skillhub.mapper.IaSkillFileMapper;
import com.inneragent.platform.skillhub.mapper.IaSkillMapper;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 应用级 Skill 目录服务(P4-W13 PRD M4;数据落 ia_skill/ia_skill_file,
 * 实体 {@link IaSkill}/{@link IaSkillFile})。
 *
 * <p>职责:zip 导入两段式——预览校验(dryRun 零落库,返回清单+问题列表)
 * 与确认入库(服务端重跑同一校验器,不信任客户端回显);激活门控(应用内
 * 同时上限 {@link SkillHubProperties#getMaxActivePerApp()},缺省 8,超限明确
 * 报错)、停用、逻辑删除(同名再导入按复活处理,见 V19 唯一键说明)。
 *
 * <p>审计复用现有码值不私加:decision=definition-imported(新建/复活导入)
 * /definition-updated(覆盖导入/激活/停用/删除),decision_source=admin,
 * tool_fqn 用伪命名 {@code skill:<name>}(先例 agent-definition:<key>)。
 * 审计 fail-closed:落审计失败即业务失败回滚(与状态存储一致性原则同形)。
 */
@Service
@Slf4j
public class AppSkillCatalogService {

    /** 状态值域(V19 DDL CHECK)。 */
    public static final String STATUS_ACTIVE = "active";
    public static final String STATUS_INACTIVE = "inactive";

    /** 来源值域(V19 DDL CHECK)。 */
    public static final String SOURCE_IMPORT = "import";

    private final SkillHubProperties properties;
    private final IaSkillMapper skillMapper;
    private final IaSkillFileMapper fileMapper;
    private final SkillPackageInspector inspector;
    private final ToolAuditService auditService;
    private final ObjectMapper objectMapper;

    public AppSkillCatalogService(
            SkillHubProperties properties,
            IaSkillMapper skillMapper,
            IaSkillFileMapper fileMapper,
            ToolAuditService auditService,
            ObjectMapper objectMapper) {
        this.properties = properties;
        this.skillMapper = skillMapper;
        this.fileMapper = fileMapper;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
        this.inspector = new SkillPackageInspector(properties);
    }

    // ------------------------------------------------------------------
    // 导入两段式:预览(dryRun)→ 确认入库
    // ------------------------------------------------------------------

    /** 预览校验:零落库,返回清单/文件清单/警告/错误(dryRun 语义)。 */
    public PreviewView preview(String fileName, byte[] zipBytes) {
        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zipBytes);
        return toPreviewView(fileName, inspection);
    }

    /**
     * 确认导入:服务端重跑同一校验器(不信任客户端回显);errors 非空
     * → 400。冲突语义:同名活跃行缺省 409(skip),overwrite=true 覆盖
     * (清单+文件整包替换);软删同名行按复活处理(不计冲突)。整体
     *
     * @Transactional:写行/写文件/审计任一失败全量回滚。
     */
    @Transactional
    public SkillView importSkill(
            long appId,
            String fileName,
            byte[] zipBytes,
            String displayNameOverride,
            boolean overwrite,
            Long operatorId) {
        SkillPackageInspector.Inspection inspection = inspector.inspectZip(zipBytes);
        if (!inspection.valid()) {
            throw new BusinessException(400, "Skill 包未通过校验:"
                    + String.join(";", inspection.errors()));
        }
        SkillPackageInspector.SkillPackage pkg = inspection.packageOrThrow();
        String displayName = displayNameOverride == null || displayNameOverride.isBlank()
                ? pkg.manifest().displayName()
                : displayNameOverride.trim();
        if (displayName.length() > 64) {
            throw new BusinessException(400, "显示名称不能超过 64 个字符");
        }
        String contentSha256 = contentFingerprint(pkg);

        IaSkill existing = skillMapper.selectAnyByAppAndName(appId, pkg.manifest().name());
        IaSkill row;
        String decision;
        String action;
        if (existing == null) {
            row = newRow(pkg, displayName, contentSha256);
            row.setAppId(appId);
            skillMapper.insert(row);
            decision = "definition-imported";
            action = "imported";
        } else if (Boolean.TRUE.equals(existing.getDeleted())) {
            // 复活:deleted 为 @TableLogic 列,须先经显式 SQL 翻转,
            // 再用常规 updateById 覆盖内容字段(激活位复位)
            row = existing;
            skillMapper.undelete(row.getId());
            applyPackage(row, pkg, displayName, contentSha256);
            row.setDeleted(false);
            row.setStatus(STATUS_INACTIVE);
            row.setActivatedAt(null);
            row.setActivatedBy(null);
            skillMapper.updateById(row);
            decision = "definition-imported";
            action = "revived";
        } else if (overwrite) {
            row = existing;
            boolean wasActive = STATUS_ACTIVE.equals(row.getStatus());
            applyPackage(row, pkg, displayName, contentSha256);
            if (wasActive) {
                // 覆盖后保持激活位,但内容指纹已变:激活时间/操作人刷新留痕
                row.setActivatedAt(LocalDateTime.now());
                row.setActivatedBy(operatorId);
            }
            skillMapper.updateById(row);
            decision = "definition-updated";
            action = "overwritten";
        } else {
            throw new BusinessException(409, "同名 Skill 已存在:" + pkg.manifest().name()
                    + "(overwrite=true 覆盖导入)");
        }
        replaceFiles(appId, row.getId(), pkg);

        audit(appId, row.getName(), decision, action, row.getId(), contentSha256);
        log.info("Skill 导入{}: appId={}, name={}, files={}, bytes={}",
                action, appId, row.getName(), pkg.files().size(), pkg.totalBytes());
        return toView(row);
    }

    // ------------------------------------------------------------------
    // 检索 / 激活 / 停用 / 删除
    // ------------------------------------------------------------------

    /** 分页列表(按 create_time 降序;出参含激活状态)。 */
    public PageResult<SkillView> page(long appId, int pageNo, int pageSize) {
        int safePageNo = Math.max(pageNo, 1);
        int safePageSize = Math.min(Math.max(pageSize, 1), 100);
        Page<IaSkill> page = skillMapper.selectPage(
                new Page<>(safePageNo, safePageSize),
                new LambdaQueryWrapper<IaSkill>()
                        .eq(IaSkill::getAppId, appId)
                        .orderByDesc(IaSkill::getId));
        PageResult<SkillView> result = new PageResult<>(
                page.getRecords().stream().map(row -> toView(row)).toList(),
                page.getTotal());
        result.setPageNo(safePageNo);
        result.setPageSize(safePageSize);
        return result;
    }

    /** 详情(含文件内容;总量受导入 128KB 上限约束)。 */
    public SkillDetailView get(long id) {
        IaSkill row = requireRow(id);
        List<FileView> files = fileMapper.selectList(
                        new LambdaQueryWrapper<IaSkillFile>()
                                .eq(IaSkillFile::getSkillId, id)
                                .orderByAsc(IaSkillFile::getPath))
                .stream()
                .map(file -> new FileView(file.getPath(), file.getEncoding(),
                        file.getSizeBytes(), decodeContent(file)))
                .toList();
        return new SkillDetailView(toView(row), files);
    }

    /** 激活:应用内同时上限 8(PRD 缺省,可配),超限 409 明确报错。 */
    @Transactional
    public SkillView activate(long id, Long operatorId) {
        IaSkill row = requireRow(id);
        if (!STATUS_ACTIVE.equals(row.getStatus())) {
            long activeCount = skillMapper.countActive(row.getAppId());
            if (activeCount >= properties.getMaxActivePerApp()) {
                throw new BusinessException(409, "应用内同时激活的 Skill 已达上限 "
                        + properties.getMaxActivePerApp() + ",请先停用后再激活");
            }
            row.setStatus(STATUS_ACTIVE);
            row.setActivatedAt(LocalDateTime.now());
            row.setActivatedBy(operatorId);
            skillMapper.updateById(row);
            audit(row.getAppId(), row.getName(), "definition-updated", "activated",
                    row.getId(), row.getContentSha256());
        }
        return toView(row);
    }

    /** 停用:状态复位 inactive,激活时间/操作人清空。 */
    @Transactional
    public SkillView deactivate(long id, Long operatorId) {
        IaSkill row = requireRow(id);
        if (STATUS_ACTIVE.equals(row.getStatus())) {
            row.setStatus(STATUS_INACTIVE);
            row.setActivatedAt(null);
            row.setActivatedBy(null);
            skillMapper.updateById(row);
            audit(row.getAppId(), row.getName(), "definition-updated", "deactivated",
                    row.getId(), row.getContentSha256());
        }
        return toView(row);
    }

    /** 逻辑删除:先复位激活位再置删除标志(同名再导入按复活处理)。 */
    @Transactional
    public void delete(long id, Long operatorId) {
        IaSkill row = requireRow(id);
        skillMapper.softDelete(id);
        audit(row.getAppId(), row.getName(), "definition-updated", "deleted",
                row.getId(), row.getContentSha256());
        log.info("Skill 已删除: appId={}, name={}", row.getAppId(), row.getName());
    }

    /**
     * 当前应用已激活 Skill 的内核输入形态(PRD「按需激活」:未激活不进
     * 上下文;激活列表经系统提示词随运行快照固化)。内核接线消费点见
     * {@code AppSkillCatalogAdapter}。
     */
    public List<ActivatedSkill> activatedSkills(long appId) {
        List<IaSkill> rows = skillMapper.selectList(
                new LambdaQueryWrapper<IaSkill>()
                        .eq(IaSkill::getAppId, appId)
                        .eq(IaSkill::getStatus, STATUS_ACTIVE)
                        .orderByAsc(IaSkill::getName));
        List<ActivatedSkill> activated = new ArrayList<>(rows.size());
        for (IaSkill row : rows) {
            IaSkillFile skillDoc = fileMapper.selectList(
                            new LambdaQueryWrapper<IaSkillFile>()
                                    .eq(IaSkillFile::getSkillId, row.getId())
                                    .eq(IaSkillFile::getPath,
                                            SkillPackageInspector.SKILL_DOC_FILENAME))
                    .stream()
                    .findFirst()
                    .orElse(null);
            if (skillDoc == null) {
                log.warn("激活 Skill 缺少 SKILL.md 文件行,跳过: {}", row.getName());
                continue;
            }
            activated.add(new ActivatedSkill(
                    row.getId(),
                    row.getName(),
                    row.getDisplayName(),
                    row.getDescription(),
                    decodeContent(skillDoc),
                    row.getSource()));
        }
        return activated;
    }

    // ------------------------------------------------------------------
    // 内核输入形态(对齐 AgentSkill 的 name/description/content/source)
    // ------------------------------------------------------------------

    public record ActivatedSkill(
            Long id,
            String name,
            String displayName,
            String description,
            String markdown,
            String source) {
    }

    // ------------------------------------------------------------------
    // 视图
    // ------------------------------------------------------------------

    /** 预览出参(清单 + 文件清单 + 问题列表;零落库)。 */
    public record PreviewView(
            String fileName,
            boolean valid,
            SkillManifestView manifest,
            List<FileView> files,
            List<String> warnings,
            List<String> errors,
            long totalBytes) {
    }

    public record SkillManifestView(
            String name,
            String displayName,
            String description,
            String version) {
    }

    /** 文件视图(content 仅详情/预览语义携带;列表视图 content=null)。 */
    public record FileView(
            String path,
            String encoding,
            Long sizeBytes,
            String content) {
    }

    /** 列表/导入出参。 */
    public record SkillView(
            Long id,
            Long appId,
            String name,
            String displayName,
            String description,
            String version,
            String status,
            String source,
            String contentSha256,
            boolean active) {
    }

    /** 详情出参(含文件内容)。 */
    public record SkillDetailView(SkillView skill, List<FileView> files) {
    }

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    private PreviewView toPreviewView(String fileName,
                                      SkillPackageInspector.Inspection inspection) {
        SkillPackageInspector.SkillManifest manifest = inspection.valid()
                ? inspection.packageOrThrow().manifest() : null;
        List<FileView> files = inspection.valid()
                ? inspection.packageOrThrow().files().stream()
                .map(file -> new FileView(file.path(), file.encoding(),
                        (long) file.bytes().length, null))
                .toList()
                : List.of();
        return new PreviewView(
                fileName,
                inspection.valid(),
                manifest == null ? null : new SkillManifestView(
                        manifest.name(), manifest.displayName(),
                        manifest.description(), manifest.version()),
                files,
                inspection.warnings(),
                inspection.errors(),
                inspection.totalBytes());
    }

    private SkillView toView(IaSkill row) {
        return new SkillView(
                row.getId(),
                row.getAppId(),
                row.getName(),
                row.getDisplayName(),
                row.getDescription(),
                row.getVersion(),
                row.getStatus(),
                row.getSource(),
                row.getContentSha256(),
                STATUS_ACTIVE.equals(row.getStatus()));
    }

    private IaSkill newRow(SkillPackageInspector.SkillPackage pkg,
                           String displayName, String contentSha256) {
        IaSkill row = new IaSkill();
        row.setStatus(STATUS_INACTIVE);
        row.setSource(SOURCE_IMPORT);
        applyPackage(row, pkg, displayName, contentSha256);
        return row;
    }

    private void applyPackage(IaSkill row, SkillPackageInspector.SkillPackage pkg,
                              String displayName, String contentSha256) {
        row.setName(pkg.manifest().name());
        row.setDisplayName(displayName);
        row.setDescription(pkg.manifest().description());
        row.setVersion(pkg.manifest().version());
        row.setContentSha256(contentSha256);
        row.setManifestJson(manifestJson(pkg));
    }

    /** 清单原文(manifest TEXT 列;service 层序列化,不用 JSONB——R3 DEF-08)。 */
    private String manifestJson(SkillPackageInspector.SkillPackage pkg) {
        try {
            return objectMapper.writeValueAsString(pkg.manifest());
        } catch (JsonProcessingException serializationFailure) {
            throw new BusinessException(400, "清单序列化失败:" + serializationFailure.getMessage());
        }
    }

    private void replaceFiles(long appId, long skillId, SkillPackageInspector.SkillPackage pkg) {
        fileMapper.deleteBySkillId(skillId);
        for (SkillPackageInspector.PackageFile file : pkg.files()) {
            IaSkillFile row = new IaSkillFile();
            row.setAppId(appId);
            row.setSkillId(skillId);
            row.setPath(file.path());
            row.setEncoding(file.encoding());
            row.setSizeBytes((long) file.bytes().length);
            row.setContent(encodeContent(file));
            fileMapper.insert(row);
        }
    }

    private static String encodeContent(SkillPackageInspector.PackageFile file) {
        if ("base64".equals(file.encoding())) {
            return java.util.Base64.getEncoder().encodeToString(file.bytes());
        }
        return new String(file.bytes(), StandardCharsets.UTF_8);
    }

    private static String decodeContent(IaSkillFile file) {
        byte[] bytes = "base64".equals(file.getEncoding())
                ? java.util.Base64.getMimeDecoder().decode(file.getContent())
                : file.getContent().getBytes(StandardCharsets.UTF_8);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /** 内容指纹:SKILL.md 与全部文件按路径排序后的 sha256 规范哈希。 */
    private static String contentFingerprint(SkillPackageInspector.SkillPackage pkg) {
        Set<String> paths = new LinkedHashSet<>();
        pkg.files().forEach(file -> paths.add(file.path()));
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossibleOnJvm) {
            throw new IllegalStateException("SHA-256 unavailable", impossibleOnJvm);
        }
        paths.stream().sorted().forEach(path -> {
            digest.update(path.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            pkg.files().stream()
                    .filter(file -> file.path().equals(path))
                    .findFirst()
                    .ifPresent(file -> digest.update(file.bytes()));
        });
        return HexFormat.of().formatHex(digest.digest());
    }

    private void audit(long appId, String name, String decision, String action,
                       Long skillId, String contentSha256) {
        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId, null, null, null, null,
                "skill:" + name,
                decision,
                ToolDecisionSource.ADMIN.code(),
                null,
                snapshot(action, skillId, name, contentSha256),
                "skill catalog " + action + " via admin", null, null));
    }

    private String snapshot(String action, Long skillId, String name, String contentSha256) {
        try {
            return objectMapper.writeValueAsString(java.util.Map.of(
                    "action", action,
                    "skillId", String.valueOf(skillId),
                    "name", String.valueOf(name),
                    "contentSha256", String.valueOf(contentSha256)));
        } catch (JsonProcessingException serializationFailure) {
            return null;
        }
    }

    private IaSkill requireRow(long id) {
        IaSkill row = skillMapper.selectById(id);
        if (row == null) {
            throw new BusinessException(404, "Skill 不存在: " + id);
        }
        return row;
    }
}
