package com.inneragent.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.toolhub.ToolHealthService;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.net.ServerSocket;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 工具体检 v1 真库落库回读 IT(V16,P2-safety 批次②)。
 *
 * <p>在真实 PostgreSQL(Testcontainers + Flyway 全链)上覆盖体检位的写路径与
 * 读路径:注册工具 → 体检(checkOne,endpoint 指向已关闭端口 → unreachable)
 * → selectById/list 回读 health_status / last_checked_at / health_detail_json,
 * 断言列映射(TEXT 明细 JSON 全文往返,不用 JSONB——R3 DEF-08 教训的守卫:
 * 实体 String + TEXT 列在真实 PG 上读写皆通)。真机 ok/漂移握手链路由
 * McpToolHealthCheckHostIT 覆盖(嵌入式宿主,无真库)。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class ToolHealthPersistenceIT {

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
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "tool-health-node");
    }

    @Autowired
    private ToolRegistryService registryService;

    @Autowired
    private ToolRegistryMapper registryMapper;

    @Autowired
    private ToolHealthService healthService;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("体检落库回读:unreachable 结论 + 时间戳 + 明细 JSON(TEXT)经 selectById/list 回读")
    void checkResultPersistsAndReadsBack() throws Exception {
        int deadPort = nextFreePort();
        ToolRegistryEntry registered = registryService.register(
                new ToolRegistryService.RegisterCommand(
                        "health-it", "probe_me", "体检落库回读用工具",
                        "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"integer\"}}}",
                        "{\"readOnlyHint\":true}",
                        null, null, null, null,
                        ToolRegistryService.SOURCE_HOST_APP,
                        "http://127.0.0.1:" + deadPort + "/ia-mcp",
                        "v1", true));
        long toolId = registered.getId();

        ToolHealthService.ToolCheckResult result = healthService.checkOne(toolId);

        // 同步返回:unreachable(端口关闭,握手失败)
        assertThat(result.status()).isEqualTo("unreachable");
        assertThat(result.checks()).hasSize(1);
        assertThat(result.checks().getFirst().check()).isEqualTo("endpoint_reachable");

        // 真库回读:三列体检位就位,明细 JSON 可解析且含检查项与建议
        ToolRegistryEntry persisted = registryMapper.selectById(toolId);
        assertThat(persisted.getHealthStatus()).isEqualTo("unreachable");
        assertThat(persisted.getLastCheckedAt()).isNotNull();
        assertThat(persisted.getHealthDetailJson()).isNotBlank();
        var detail = objectMapper.readTree(persisted.getHealthDetailJson());
        assertThat(detail.path("status").asText()).isEqualTo("unreachable");
        assertThat(detail.path("checks").isArray()).isTrue();
        assertThat(detail.path("checks").get(0).path("check").asText())
                .isEqualTo("endpoint_reachable");
        assertThat(detail.path("checks").get(0).path("advice").asText())
                .contains("endpoint_url");

        // 第二次体检覆盖更新(update_time 同步刷新;结论仍 unreachable)
        ToolHealthService.ToolCheckResult second = healthService.checkOne(toolId);
        assertThat(second.status()).isEqualTo("unreachable");
        ToolRegistryEntry reread = registryMapper.selectById(toolId);
        assertThat(reread.getHealthStatus()).isEqualTo("unreachable");
        assertThat(reread.getLastCheckedAt())
                .isAfterOrEqualTo(persisted.getLastCheckedAt());

        // 列表回读体检位(管理面列表回显)
        List<ToolRegistryEntry> listed = registryService.list("health-it", null);
        assertThat(listed).extracting(ToolRegistryEntry::getHealthStatus)
                .containsExactly("unreachable");
    }

    @Test
    @DisplayName("从未体检的注册行:体检位三列均为 NULL(NULL=从未体检语义)")
    void unCheckedRowKeepsNullHealthColumns() {
        ToolRegistryEntry registered = registryService.register(
                new ToolRegistryService.RegisterCommand(
                        "health-it-null", "never_checked", "未体检工具",
                        "{\"type\":\"object\"}", null,
                        null, null, null, null,
                        ToolRegistryService.SOURCE_HOST_APP,
                        "http://127.0.0.1:1/ia-mcp",
                        "v1", true));

        ToolRegistryEntry persisted = registryMapper.selectById(registered.getId());
        assertThat(persisted.getHealthStatus()).isNull();
        assertThat(persisted.getLastCheckedAt()).isNull();
        assertThat(persisted.getHealthDetailJson()).isNull();
    }

    private static int nextFreePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }
}
