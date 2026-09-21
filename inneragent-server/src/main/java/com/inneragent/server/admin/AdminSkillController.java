package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.skillhub.AppSkillCatalogService;
import com.inneragent.platform.skillhub.AppSkillCatalogService.PreviewView;
import com.inneragent.platform.skillhub.AppSkillCatalogService.SkillDetailView;
import com.inneragent.platform.skillhub.AppSkillCatalogService.SkillView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 应用级 Skill 管理 admin API(P4-W13 PRD M4「内置 Skill 库、用户/应用
 * Skill 导入与激活」;交互范式照 {@link AdminAgentDefinitionController}:
 * 预览=dryRun 零副作用,确认入库服务端重校验)。
 *
 * <p>路由 {@code /ia/api/v1/admin/skills/**}:POST import/preview(zip,
 * 返回清单+文件清单+警告+错误问题列表,不落库)/ POST import(确认入库;
 * overwrite=true 覆盖同名活跃行,缺省 409)/ GET 列表(分页)/ GET {id}
 * 详情(含文件内容)/ POST {id}/activate(应用内同时上限 8,超限 409)/
 * POST {id}/deactivate / DELETE {id}(逻辑删除)。
 *
 * <p>由 {@link AdminTokenFilter} 双轨守卫;审计复用 definition-imported /
 * definition-updated 码值(decision_source=admin,tool_fqn=skill:{name}),
 * 不私加字典。appId 缺省单应用 1。
 */
@Tag(name = "Skill 目录(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/skills")
@RequiredArgsConstructor
public class AdminSkillController {

    private final AppSkillCatalogService skillService;

    @PostMapping(value = "/import/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "预览校验要导入的 Skill zip(不落库;返回清单+问题列表)")
    public CommonResult<PreviewView> preview(
            @RequestPart("file") MultipartFile file) throws IOException {
        return success(skillService.preview(file.getOriginalFilename(), file.getBytes()));
    }

    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "确认导入 Skill zip(服务端重校验;overwrite=true 覆盖同名,"
            + "缺省同名 409;软删同名行复活)")
    public CommonResult<SkillView> importSkill(
            @RequestParam(defaultValue = "1") long appId,
            @RequestPart("file") MultipartFile file,
            @RequestParam(required = false) String displayName,
            @RequestParam(defaultValue = "false") boolean overwrite) throws IOException {
        return success(skillService.importSkill(
                appId, file.getOriginalFilename(), file.getBytes(), displayName,
                overwrite, null));
    }

    @GetMapping
    @Operation(summary = "Skill 分页列表(含激活状态;id 降序)")
    public CommonResult<PageResult<SkillView>> list(
            @RequestParam(defaultValue = "1") long appId,
            @RequestParam(defaultValue = "1") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize) {
        return success(skillService.page(appId, pageNo, pageSize));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Skill 详情(含全部文件内容)")
    public CommonResult<SkillDetailView> get(@PathVariable long id) {
        return success(skillService.get(id));
    }

    @PostMapping("/{id}/activate")
    @Operation(summary = "激活 Skill(应用内同时上限 8;超限 409 明确报错)")
    public CommonResult<SkillView> activate(@PathVariable long id) {
        return success(skillService.activate(id, null));
    }

    @PostMapping("/{id}/deactivate")
    @Operation(summary = "停用 Skill(未激活不进上下文)")
    public CommonResult<SkillView> deactivate(@PathVariable long id) {
        return success(skillService.deactivate(id, null));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除 Skill(逻辑删除;同名再导入按复活处理)")
    public CommonResult<Boolean> delete(@PathVariable long id) {
        skillService.delete(id, null);
        return success(true);
    }
}
