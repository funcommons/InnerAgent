package com.inneragent.integration;

import com.inneragent.agent.workspace.AgentWorkspaceBackend;
import com.inneragent.agent.workspace.AgentWorkspaceConfigService;
import com.inneragent.agent.workspace.AgentWorkspaceLocation;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.entity.storage.StorageConfig;
import com.inneragent.platform.service.storage.ResolvedS3StorageConfig;
import com.inneragent.platform.service.storage.S3StorageConfigResolver;
import com.inneragent.platform.service.storage.StorageConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * P1 遗留台账④:ia_storage_config 表迁移 + 工作区存储配置从表加载。
 * <p>
 * 在真实 PostgreSQL 17 上经 Spring 装配(Flyway 含 V5/V22)验证:存储配置
 * 经 StorageConfigService 落库/回读(options 为 TEXT 列,实体纯 String
 * 往返,V22 DEF-08 同族修复)、默认配置互斥、以及
 * AgentWorkspaceConfigService.validateTarget 面向 object_storage 后端
 * 从表加载并校验配置。</p>
 *
 * <p>本类连接串仍经 {@code postgresJdbcUrl} 追加 stringtype=unspecified
 * (历史形态,现已无害);<strong>运行态同形连接串的写路径守卫</strong>见
 * {@code StorageConfigWritePathsIT}(DEF-08 同族,刻意不加该参数)。</p>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers(disabledWithoutDocker = false)
class StorageConfigServiceIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17-alpine")
                    .withDatabaseName("ai_fusion_video")
                    .withUsername("afv")
                    .withPassword("afv-test");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        // stringtype=unspecified:V22 前为 JsonbTypeHandler 写 JSONB 所需(现列已 TEXT,历史形态保留)
        properties.add("spring.datasource.url",
                () -> AgentRuntimeContainersJdbcUrl.postgresJdbcUrl(POSTGRES));
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "storage-node");
    }

    @Autowired
    private StorageConfigService storageConfigService;

    @Autowired
    private AgentWorkspaceConfigService workspaceConfigService;

    @Autowired
    private S3StorageConfigResolver s3Resolver;

    @Test
    void persistsConfigRowsAndLoadsWorkspaceStorageFromTable() throws Exception {
        StorageConfig local = StorageConfig.builder()
                .name("本地工作区存储")
                .type("local")
                .basePath("./data/agent-workspace")
                .isDefault(true)
                .remark("P1 台账④ 默认本地存储")
                .build();
        Long localId = storageConfigService.create(local);

        StorageConfig s3 = StorageConfig.builder()
                .name("演示对象存储")
                .type("s3")
                .endpoint("http://127.0.0.1:9000")
                .bucketName("inneragent-workspace")
                .accessKey("ak-demo")
                .secretKey("sk-demo")
                .region("us-east-1")
                .basePath("workspaces")
                .options("{\"pathStyleAccessEnabled\":true,\"signingRegion\":\"us-east-1\"}")
                .build();
        Long s3Id = storageConfigService.create(s3);

        // 从表回读(工作区/媒体链路的加载路径):列映射与 JSON 文本往返
        StorageConfig loadedLocal = storageConfigService.getById(localId);
        assertThat(loadedLocal.getName()).isEqualTo("本地工作区存储");
        assertThat(loadedLocal.getType()).isEqualTo("local");
        assertThat(loadedLocal.getProvider()).isNull();
        assertThat(loadedLocal.getIsDefault()).isTrue();

        StorageConfig loadedS3 = storageConfigService.getById(s3Id);
        assertThat(loadedS3.getType()).isEqualTo("s3");
        assertThat(loadedS3.getProvider()).isEqualTo("generic_s3");
        assertThat(loadedS3.getEndpoint()).isEqualTo("http://127.0.0.1:9000");
        assertThat(loadedS3.getBucketName()).isEqualTo("inneragent-workspace");
        // V22 起为 TEXT 列(逐字节往返),按语义断言兼容两种历史形态
        assertThat(new com.fasterxml.jackson.databind.ObjectMapper()
                .readTree(loadedS3.getOptions())
                .get("pathStyleAccessEnabled").asBoolean()).isTrue();

        // DDL 约定:app_id 默认 1,未显式给值时 status=1
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT app_id, status FROM ia_storage_config WHERE id = ?")) {
            statement.setLong(1, s3Id);
            ResultSet resultSet = statement.executeQuery();
            assertThat(resultSet.next()).isTrue();
            assertThat(resultSet.getLong(1)).isEqualTo(1L);
            assertThat(resultSet.getInt(2)).isEqualTo(1);
        }

        // S3 解析(对象存储后端把表配置解析为 SDK 设置)
        ResolvedS3StorageConfig resolved = s3Resolver.resolve(loadedS3);
        assertThat(resolved.provider()).isEqualTo("generic_s3");
        assertThat(resolved.endpoint()).isEqualTo("http://127.0.0.1:9000");
        assertThat(resolved.bucketName()).isEqualTo("inneragent-workspace");
        assertThat(resolved.accessKey()).isEqualTo("ak-demo");
        assertThat(resolved.signingRegion()).isEqualTo("us-east-1");
        assertThat(resolved.pathStyleAccessEnabled()).isTrue();
    }

    @Test
    void keepsSingleDefaultConfigAndRejectsUnusableWorkspaceTargets() {
        StorageConfig first = StorageConfig.builder()
                .name("默认一")
                .type("local")
                .isDefault(true)
                .build();
        storageConfigService.create(first);

        StorageConfig second = StorageConfig.builder()
                .name("默认二")
                .type("local")
                .isDefault(true)
                .build();
        storageConfigService.create(second);

        StorageConfig defaultConfig = storageConfigService.getDefaultConfig();
        assertThat(defaultConfig).isNotNull();
        assertThat(defaultConfig.getName()).isEqualTo("默认二");
        assertThat(storageConfigService.getEnabledList())
                .filteredOn(StorageConfig::getIsDefault)
                .hasSize(1);

        // 工作区对象存储模式:必须选择启用中的 S3 兼容配置(从表校验)
        StorageConfig s3 = StorageConfig.builder()
                .name("可切换对象存储")
                .type("s3")
                .bucketName("bucket")
                .accessKey("ak")
                .secretKey("sk")
                .build();
        Long s3Id = storageConfigService.create(s3);

        AgentWorkspaceLocation target = workspaceConfigService.validateTarget(
                AgentWorkspaceBackend.OBJECT_STORAGE, s3Id, null);
        assertThat(target.backendType()).isEqualTo(AgentWorkspaceBackend.OBJECT_STORAGE);
        assertThat(target.storageConfigId()).isEqualTo(s3Id);
        assertThat(target.localPath()).isNull();

        assertThatThrownBy(() -> workspaceConfigService.validateTarget(
                AgentWorkspaceBackend.OBJECT_STORAGE, 987654321L, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("存储配置不存在");
    }

    private Connection openConnection() throws Exception {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    /** JdbcUrl 工具类的间接引用,避免测试包结构依赖(见 AgentRuntimeContainers)。 */
    static final class AgentRuntimeContainersJdbcUrl {

        private AgentRuntimeContainersJdbcUrl() {
        }

        static String postgresJdbcUrl(PostgreSQLContainer<?> postgres) {
            String url = postgres.getJdbcUrl();
            return url.contains("?")
                    ? url + "&stringtype=unspecified"
                    : url + "?stringtype=unspecified";
        }
    }
}
