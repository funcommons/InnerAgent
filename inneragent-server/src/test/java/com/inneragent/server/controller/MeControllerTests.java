package com.inneragent.server.controller;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.security.SecurityUserDetails;
import com.inneragent.model.config.AiModelService;
import com.inneragent.model.entity.AiModel;
import com.inneragent.agent.mcp.AgentScopeMcpRegistry;
import com.inneragent.agent.skill.AgentScopeSkillRegistry;
import com.inneragent.agent.skill.AgentUserSkillService;
import com.inneragent.server.controller.vo.AssistantReferenceOptionsRespVO;
import com.inneragent.server.controller.vo.MeModelRespVO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * [adapt] P1-T3b:/ia/api/v1/me 域契约测试(SDK me.ts 消费)。
 * 断言 /me/models 只下发 SDK 契约字段(接入密钥 config 不出用户级端点)。
 */
class MeControllerTests {

    private final AiModelService aiModelService = mock(AiModelService.class);
    private final AgentScopeSkillRegistry skillRegistry = mock(AgentScopeSkillRegistry.class);
    private final AgentScopeMcpRegistry mcpRegistry = mock(AgentScopeMcpRegistry.class);
    private final AgentUserSkillService userSkillService = mock(AgentUserSkillService.class);
    private final MeController controller =
            new MeController(aiModelService, skillRegistry, mcpRegistry, userSkillService);

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void modelsByTypeStripManagementOnlyFields() {
        AiModel model = AiModel.builder()
                .id(7L)
                .name("mock-text")
                .code("mock-text")
                .description("演示模型")
                .status(1)
                .defaultModel(true)
                .supportVision(true)
                .multimodalInputTypes(List.of("image"))
                .multimodalInputTransports(Map.of("image", List.of("base64")))
                .supportReasoning(false)
                .reasoningEffortLevels(List.of())
                .contextWindow(8192)
                // 管理面字段:不得出现在 /me/models 响应
                .config("{\"apiKey\":\"secret\"}")
                .apiConfigId(3L)
                .maxConcurrency(5)
                .build();
        when(aiModelService.getListByType(1)).thenReturn(List.of(model));

        CommonResult<List<MeModelRespVO>> result = controller.models(1);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).singleElement().satisfies(vo -> {
            assertThat(vo.getId()).isEqualTo(7L);
            assertThat(vo.getCode()).isEqualTo("mock-text");
            assertThat(vo.getSupportVision()).isTrue();
            assertThat(vo.getMultimodalInputTypes()).containsExactly("image");
            assertThat(vo.getContextWindow()).isEqualTo(8192);
        });
        // MeModelRespVO 契约字段白名单之外无密钥/管理面字段
        assertThat(MeModelRespVO.class.getDeclaredFields())
                .extracting(field -> field.getName())
                .doesNotContain("config", "apiConfigId", "maxConcurrency");
        verify(aiModelService).getListByType(1);
    }

    @Test
    void referenceOptionsReturnConfiguredSkillAndMcpCatalogs() {
        authenticate(42L);
        when(skillRegistry.catalog()).thenReturn(List.of(
                new AgentScopeSkillRegistry.SkillReference(
                        "test-skill_bundled",
                        "test-skill",
                        "测试技能",
                        "测试技能",
                        "bundled")));
        when(mcpRegistry.catalogForAgent("ai_assistant_agent", 42L)).thenReturn(List.of(
                new AgentScopeMcpRegistry.McpToolReference(
                        "assets", "search_assets", "搜索素材", true)));

        CommonResult<AssistantReferenceOptionsRespVO> result = controller.referenceOptions();

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).isNotNull();
        assertThat(result.getData().skills()).singleElement().satisfies(skill ->
                assertThat(skill.name()).isEqualTo("test-skill"));
        assertThat(result.getData().mcpTools()).singleElement().satisfies(tool ->
                assertThat(tool.toolName()).isEqualTo("search_assets"));
    }

    private void authenticate(long userId) {
        SecurityUserDetails user = new SecurityUserDetails(
                userId, "owner", "secret", 1, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }
}
