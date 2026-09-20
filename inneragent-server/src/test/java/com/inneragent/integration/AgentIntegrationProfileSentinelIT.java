package com.inneragent.integration;

import com.inneragent.integration.support.AgentRuntimeContainers;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers(disabledWithoutDocker = false)
class AgentIntegrationProfileSentinelIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = AgentRuntimeContainers.postgres();

    @Container
    private static final GenericContainer<?> REDIS = AgentRuntimeContainers.redis();

    @Test
    void startsPinnedRealPostgresAndRedis() throws Exception {
        assertThat(POSTGRES.isRunning()).isTrue();
        assertThat(REDIS.isRunning()).isTrue();
        assertThat(POSTGRES.getDockerImageName()).isEqualTo("postgres:17-alpine");
        assertThat(REDIS.getDockerImageName()).isEqualTo("redis:7.4.5-alpine");

        try (Connection connection = DriverManager.getConnection(
                        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("SELECT VERSION()")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString(1)).startsWith("PostgreSQL 17");
        }

        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(
                    REDIS.getHost(),
                    REDIS.getMappedPort(AgentRuntimeContainers.REDIS_PORT)), 5_000);
            socket.setSoTimeout(5_000);
            OutputStream output = socket.getOutputStream();
            output.write("*1\r\n$4\r\nPING\r\n".getBytes(StandardCharsets.US_ASCII));
            output.flush();
            BufferedReader input = new BufferedReader(new InputStreamReader(
                    socket.getInputStream(), StandardCharsets.US_ASCII));
            assertThat(input.readLine()).isEqualTo("+PONG");
        }
    }
}
