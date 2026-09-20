package com.inneragent.integration.support;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

public final class AgentRuntimeContainers {

    public static final int REDIS_PORT = 6379;
    public static final DockerImageName POSTGRES_IMAGE =
            DockerImageName.parse("postgres:17-alpine");
    public static final DockerImageName REDIS_IMAGE =
            DockerImageName.parse("redis:7.4.5-alpine");

    private AgentRuntimeContainers() {
    }

    public static PostgreSQLContainer<?> postgres() {
        return new PostgreSQLContainer<>(POSTGRES_IMAGE)
                .withDatabaseName("ai_fusion_video")
                .withUsername("afv")
                .withPassword("afv-test");
    }

    /**
     * JDBC URL 附带 stringtype=unspecified，使 JacksonTypeHandler 能以
     * 字符串写入 jsonb 列
     */
    public static String postgresJdbcUrl(PostgreSQLContainer<?> postgres) {
        String url = postgres.getJdbcUrl();
        return url.contains("?") ? url + "&stringtype=unspecified" : url + "?stringtype=unspecified";
    }

    public static GenericContainer<?> redis() {
        return new GenericContainer<>(REDIS_IMAGE).withExposedPorts(REDIS_PORT);
    }

    public static void registerSpringProperties(
            DynamicPropertyRegistry properties,
            PostgreSQLContainer<?> postgres,
            GenericContainer<?> redis) {
        properties.add("spring.datasource.url", () -> postgresJdbcUrl(postgres));
        properties.add("spring.datasource.username", postgres::getUsername);
        properties.add("spring.datasource.password", postgres::getPassword);
        properties.add("spring.datasource.hikari.minimum-idle", () -> 0);
        properties.add("spring.data.redis.host", redis::getHost);
        properties.add("spring.data.redis.port", () -> redis.getMappedPort(REDIS_PORT));
        properties.add("fusion.agentscope.v2.state.mode", () -> "in-memory");
    }
}
