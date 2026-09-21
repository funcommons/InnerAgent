package com.inneragent.server.controller;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.skillhub.AppSkillCatalogService;
import com.inneragent.platform.skillhub.AppSkillCatalogService.SkillView;
import com.inneragent.platform.skillhub.AppSkillCatalogService.UserSkillDetailView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static com.inneragent.platform.common.CommonResult.success;
import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * 用户面 Skill 目录 API(P4 差距收口,K 清单①:批次①只落了 admin 面
 * {@code AdminSkillController},本控制器补齐 embed 用户面的只读消费)。
 *
 * <p>路由 {@code /ia/api/v1/skills}:GET 列表(本应用当前激活态 Skill)+
 * GET {id} 详情(SKILL.md 正文 + 资源文件名清单,<strong>不吐文件二进制
 * </strong>——content 仅 admin 详情下发)。embed token 认证链
 * ({@code requireCurrentUserId()},先例 {@code McpUserServerController});
 * 应用维度取 {@link AppContext#currentOrDefault()},与行级拦截器同口径。
 *
 * <p><strong>用户级启停不做</strong>:激活/停用是应用级管理语义(运行目录
 * 由 admin 经 {@code AdminSkillController} 门控,激活上限 8),用户面只读;
 * 用户级自定义 Skill 仍走 {@code /ia/api/v1/me} 域的 workspace 存储。
 *
 * <p><strong>契约对齐(sdk-js 配置视图)</strong>:字段形对齐
 * {@code AgentConfigPanel.vue} 消费的 Skill 条目(id/name/displayName/
 * description/source,现经 {@code meApi.referenceOptions()} 下发)——后续
 * SDK skillsApi 切到本端点时可 1:1 映射,不改组件渲染形。
 */
@Tag(name = "Skill 目录(用户面)")
@RestController
@RequestMapping("/ia/api/v1/skills")
@RequiredArgsConstructor
public class UserSkillController {

    private final AppSkillCatalogService skillService;

    @GetMapping
    @Operation(summary = "本应用可用 Skill 列表(激活态;未激活不下发)")
    public CommonResult<List<SkillView>> list() {
        requireCurrentUserId();
        return success(skillService.listActive(AppContext.currentOrDefault()));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Skill 详情(SKILL.md 正文+资源名清单;不含文件二进制;"
            + "未激活/不存在 404)")
    public CommonResult<UserSkillDetailView> get(@PathVariable long id) {
        requireCurrentUserId();
        return success(skillService.userDetail(id));
    }
}
