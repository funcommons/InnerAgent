package com.inneragent.boot;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import com.inneragent.agent.conversation.AgentConversationService;
import com.inneragent.agent.kernel.AgentScopePipelineRunService;
import com.inneragent.agent.tool.AiToolConfigService;
import com.inneragent.model.config.ChatModelFactory;
import com.inneragent.model.provider.AiProviderService;
import io.agentscope.core.state.AgentStateStore;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * 上下文启动冒烟测试(P0-T5a 验收):证明 inneragent-server 具备「可启动」的运行时装配。
 *
 * <p>Testcontainers 拉起 postgres:17-alpine + redis:7-alpine,@DynamicPropertySource
 * 将 Spring 上下文指向容器;完整启动一次应用上下文(MOCK web 环境,含 Flyway V1-V3
 * 迁移、MyBatis-Plus 装配、AgentScope 内核运行时),断言关键 Bean 全部就位。
 * 由 maven-failsafe-plugin 执行(类名 *IT 结尾)。</p>
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class ApplicationContextBootIT {

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
            return Files.createTempDirectory("ia-agent-workspace-it");
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
    ApplicationContext applicationContext;

    @Test
    void contextBootsAndKernelBeansArePresent() {
        assertThat(applicationContext).isNotNull();

        // 内核运行链路:流水线运行、工具配置、模型接入
        assertThat(applicationContext.getBean(AgentScopePipelineRunService.class))
                .as("AgentScopePipelineRunService 应完成装配")
                .isNotNull();
        assertThat(applicationContext.getBean(AiToolConfigService.class))
                .as("AiToolConfigService 应完成装配")
                .isNotNull();
        assertThat(applicationContext.getBean(AiProviderService.class))
                .as("AiProviderService 应完成装配")
                .isNotNull();

        // 会话域与模型工厂
        assertThat(applicationContext.getBean(AgentConversationService.class))
                .as("AgentConversationService 应完成装配")
                .isNotNull();
        assertThat(applicationContext.getBean(ChatModelFactory.class))
                .as("ChatModelFactory 应完成装配")
                .isNotNull();

        // AgentScopeRuntimeConfiguration 注册的内核状态存储(P0 装配补充项)
        assertThat(applicationContext.getBean(AgentStateStore.class))
                .as("AgentStateStore(fusion.agentscope.v2.state.mode=postgres)应完成装配")
                .isNotNull();
    }
}
