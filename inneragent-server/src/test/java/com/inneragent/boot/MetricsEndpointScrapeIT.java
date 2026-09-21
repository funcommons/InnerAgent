package com.inneragent.boot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * IA-1 指标出口端到端验证(docs/灰度与指标大盘.md §7.1 台账 IA-1,W9 双跑前阻塞):
 * 完整应用上下文(容器化 PG/Redis + Flyway + 内核运行时 + Spring Security 链)下:
 * <ul>
 *   <li>GET /actuator/prometheus 返回 text/plain 抓取文本,且含
 *       {@code fusion.agentscope.runtime} 前缀真实指标行(按 Prometheus 改名:
 *       {@code fusion_agentscope_runtime_*})——证明 {@code AgentRuntimeMetrics}
 *       经 Spring 管理的 MeterRegistry 装配(不再是进程内 SimpleMeterRegistry
 *       不可抓取);请求经过完整 security 过滤器链(embed/demo 凭据域已豁免
 *       actuator 前缀),无 token 抓取即达;</li>
 *   <li>GET /actuator/health 只出聚合态(show-details=never),不泄 DB/Redis
 *       组件细节;</li>
 *   <li>白名单之外端点(/actuator/metrics 等)不暴露。</li>
 * </ul>
 * 由 maven-failsafe-plugin 执行(类名 *IT 结尾)。
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@AutoConfigureMockMvc
// Boot 3 起测试态默认禁用指标导出(test 源注入 management.defaults.metrics.export.
// enabled=false 等),显式开启才能验证真实 Prometheus 抓取链路
@AutoConfigureObservability
class MetricsEndpointScrapeIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            DockerImageName.parse("postgres:17-alpine"))
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>(
            DockerImageName.parse("redis:7-alpine"))
            .withExposedPorts(6379)
            .waitingFor(Wait.forListeningPort());

    /** 工作区落盘目录用临时目录,避免测试污染 ./data/agent-workspace */
    static Path agentWorkspaceDir = createWorkspaceDir();

    private static Path createWorkspaceDir() {
        try {
            return Files.createTempDirectory("ia-metrics-it");
        } catch (IOException e) {
            throw new IllegalStateException("无法创建 agent-workspace 临时目录", e);
        }
    }

    @DynamicPropertySource
    static void registerContainerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
        registry.add("spring.data.redis.password", () -> "");
        registry.add("app.agent-workspace.local-base-path",
                () -> agentWorkspaceDir.toString());
    }

    @Autowired
    MockMvc mockMvc;

    @Test
    void prometheusScrapeServesFusionRuntimeMetricLines() throws Exception {
        String body = mockMvc.perform(get("/actuator/prometheus"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_PLAIN))
                .andReturn().getResponse().getContentAsString();

        // 真实指标行(AgentRuntimeMetrics 构造期即注册,PREFIX=fusion.agentscope.runtime;
        // gauge 带运行值,counter 含 status 标签维度)
        assertThat(body)
                .contains("fusion_agentscope_runtime_runs_active")
                .contains("fusion_agentscope_runtime_runs_terminal_total")
                .contains("status=\"COMPLETED\"")
                .contains("fusion_agentscope_runtime_state_latency_seconds_count")
                .contains("fusion_agentscope_runtime_outbox_backlog");
    }

    @Test
    void healthExposesAggregateStatusOnlyWithoutComponentDetail() throws Exception {
        String body = mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("\"status\"");
        // show-details=never:聚合态之外不出 components/db/redis 细节
        assertThat(body)
                .doesNotContain("\"components\"")
                .doesNotContain("\"db\"")
                .doesNotContain("\"redis\"");
    }

    @Test
    void endpointsOutsideExposureWhitelistAreNotServed() throws Exception {
        // exposure 白名单仅 health,info,prometheus;/actuator/metrics 等不暴露
        mockMvc.perform(get("/actuator/metrics")).andExpect(status().isNotFound());
        mockMvc.perform(get("/actuator/env")).andExpect(status().isNotFound());
    }
}
