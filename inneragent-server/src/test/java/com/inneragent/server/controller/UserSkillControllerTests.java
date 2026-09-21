package com.inneragent.server.controller;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.GlobalExceptionHandler;
import com.inneragent.platform.security.SecurityUserDetails;
import com.inneragent.platform.skillhub.AppSkillCatalogService;
import com.inneragent.platform.skillhub.AppSkillCatalogService.ResourceNameView;
import com.inneragent.platform.skillhub.AppSkillCatalogService.SkillView;
import com.inneragent.platform.skillhub.AppSkillCatalogService.UserSkillDetailView;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 用户面 Skill 目录 API 切片测试(P4 差距收口,K 清单①):embed 用户态驱动
 * 的只读路由语义——激活态列表 + 详情(SKILL.md 正文+资源名清单,不吐文件
 * 二进制);未激活/不存在一律 404。
 */
class UserSkillControllerTests {

    private static final String BASE = "/ia/api/v1/skills";

    private AppSkillCatalogService skillService;
    private MockMvc mockMvc;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        skillService = Mockito.mock(AppSkillCatalogService.class);
        UserSkillController controller = new UserSkillController(skillService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
        authenticate(10001L);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("列表只回激活态 Skill(字段形对齐 sdk-js 配置视图消费)")
    void listReturnsActivatedSkillsOnly() throws Exception {
        when(skillService.listActive(1L)).thenReturn(List.of(
                new SkillView(7L, 1L, "doc-summary", "文档摘要", "摘要与要点提取",
                        "1.0.0", "active", "import", "sha256:abc", true)));

        mockMvc.perform(get(BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(7))
                .andExpect(jsonPath("$.data[0].name").value("doc-summary"))
                .andExpect(jsonPath("$.data[0].displayName").value("文档摘要"))
                .andExpect(jsonPath("$.data[0].description").value("摘要与要点提取"))
                .andExpect(jsonPath("$.data[0].source").value("import"));
    }

    @Test
    @DisplayName("详情回 SKILL.md 正文 + 资源名清单,文件二进制不下发")
    void detailReturnsMarkdownAndResourceNamesWithoutFileBinary() throws Exception {
        when(skillService.userDetail(7L)).thenReturn(new UserSkillDetailView(
                new SkillView(7L, 1L, "doc-summary", "文档摘要", "摘要与要点提取",
                        "1.0.0", "active", "import", "sha256:abc", true),
                "# 文档摘要\n按需摘要长文档。",
                List.of(new ResourceNameView("scripts/run.py", 12L))));

        mockMvc.perform(get(BASE + "/7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.skill.name").value("doc-summary"))
                .andExpect(jsonPath("$.data.markdown").value("# 文档摘要\n按需摘要长文档。"))
                .andExpect(jsonPath("$.data.resources.length()").value(1))
                .andExpect(jsonPath("$.data.resources[0].path").value("scripts/run.py"))
                .andExpect(jsonPath("$.data.resources[0].sizeBytes").value(12));
    }

    @Test
    @DisplayName("未激活/不存在 → 404(未激活对用户不可见)")
    void inactiveOrMissingSkillIs404() throws Exception {
        when(skillService.userDetail(404L))
                .thenThrow(new BusinessException(404, "Skill 不存在或未激活"));

        mockMvc.perform(get(BASE + "/404"))
                .andExpect(status().isNotFound());
    }

    private static void authenticate(long userId) {
        SecurityUserDetails userDetails = new SecurityUserDetails(
                userId, "embed:demo-app", "N/A", 1, null, List.of());
        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                        userDetails, null, userDetails.getAuthorities());
        SecurityContextHolder.getContext().setAuthentication(authentication);
    }
}
