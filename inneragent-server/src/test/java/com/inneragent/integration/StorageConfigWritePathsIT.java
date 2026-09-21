package com.inneragent.integration;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.entity.storage.StorageConfig;
import com.inneragent.platform.mapper.storage.StorageConfigMapper;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DEF-08 同族守卫(收尾批次):ia_storage_config 共享实体行的全部写路径在
 * <strong>真实 PostgreSQL</strong> 上必须可用——options 列随行参与
 * insert / updateById(整行)/ 条件更新(.set(options))。
 *
 * <p><strong>为何需要本守卫</strong>:V5 将 options 落为 JSONB 且实体配 MySQL 形
 * {@code JsonbTypeHandler}(ps.setString → varchar),与 R3 DEF-08
 * (ia_app.circuit_limits_json,V15 修复)同族——运行态连接串
 * (application.yml)无 {@code stringtype=unspecified} 时,携带该列的写入在
 * 真实 PG 上绑定失败。既有 {@code StorageConfigServiceIT} 未拦住:其连接串经
 * {@code postgresJdbcUrl} 追加了 {@code stringtype=unspecified},与运行态不同形。
 * <strong>本类刻意不加该参数</strong>(连接串与运行态 application.yml 同形):
 * 一旦有人再把 options 改回 JSONB+字符串直写,此处即以运行态同款失败报警。
 *
 * <p>覆盖三条写路径:StorageConfigService.create(INSERT)、update(updateById
 * 整行,含 options 为 NULL → 非空)、条件更新(LambdaUpdateWrapper 定向
 * SET options);并断言列类型为 TEXT(V22 取舍,照 V15 先例:实体纯 String,
 * JSON 序列化/解析收敛在服务层 StorageConfigOptions/S3StorageConfigResolver)。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class StorageConfigWritePathsIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            "postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        // 运行态同形连接串:刻意不加 stringtype=unspecified(见类注释,DEF-08 同族守卫核心)
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "storage-write-node");
    }

    @Autowired
    private StorageConfigService storageConfigService;

    @Autowired
    private StorageConfigMapper storageConfigMapper;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void optionsColumnIsPlainTextWithoutPgDialectCoupling() throws Exception {
        assertThat(columnType("ia_storage_config", "options"))
                .as("V22 应将 ia_storage_config.options 定为 TEXT(实体纯 String,"
                        + "JSON 语义在服务层;JSONB+MySQL 形 handler 即 DEF-08 同族根因)")
                .isEqualTo("text");
    }

    @Test
    void insertPersistsOptionsVerbatimOnRuntimeShapedConnection() {
        String options = "{\"pathStyleAccessEnabled\":true,\"signingRegion\":\"us-east-1\"}";

        Long id = storageConfigService.create(s3Config("it-insert", options));

        // TEXT 列直存服务层 JSON 文本(无 jsonb 规范化,逐字节可断言)
        StorageConfig reloaded = storageConfigMapper.selectById(id);
        assertThat(reloaded.getOptions()).isEqualTo(options);
        assertThat(reloaded.getProvider()).isEqualTo("generic_s3");
    }

    /**
     * DEF-08 同族核心回归面:整行 updateById 携 options 列——JSONB+MySQL 形
     * handler 在运行态同形连接串上即在此 500;TEXT 化后必须整链可用,
     * 且 options 可由 NULL 改为非空(覆盖 MP 字段策略下 null/非空两态)。
     */
    @Test
    void fullRowUpdateByIdCarriesOptionsColumn() {
        Long id = storageConfigService.create(s3Config("it-update", null));
        assertThat(storageConfigMapper.selectById(id).getOptions()).isNull();

        StorageConfig patch = storageConfigMapper.selectById(id);
        patch.setEndpoint("http://127.0.0.1:9001");
        patch.setOptions("{\"pathStyleAccessEnabled\":false}");
        storageConfigService.update(patch);

        StorageConfig reloaded = storageConfigMapper.selectById(id);
        assertThat(reloaded.getEndpoint()).isEqualTo("http://127.0.0.1:9001");
        assertThat(reloaded.getOptions()).isEqualTo("{\"pathStyleAccessEnabled\":false}");

        // 再改回(非空 → 非空):整行更新持续携列,均不得因列类型/绑定失败
        patch = storageConfigMapper.selectById(id);
        patch.setOptions("{\"pathStyleAccessEnabled\":true,\"signingRegion\":\"eu-central-1\"}");
        storageConfigService.update(patch);
        assertThat(storageConfigMapper.selectById(id).getOptions())
                .isEqualTo("{\"pathStyleAccessEnabled\":true,\"signingRegion\":\"eu-central-1\"}");
    }

    /** 条件更新(.set(options) 定向 SET)亦走真实 PG 绑定,不得被列类型绊倒。 */
    @Test
    void conditionalUpdateWritesOptionsColumn() throws Exception {
        Long id = storageConfigService.create(s3Config("it-conditional", null));

        int updated = storageConfigMapper.update(null, new LambdaUpdateWrapper<StorageConfig>()
                .eq(StorageConfig::getId, id)
                .set(StorageConfig::getOptions, "{\"signingRegion\":\"ap-east-1\"}"));
        assertThat(updated).isEqualTo(1);

        StorageConfig reloaded = storageConfigMapper.selectById(id);
        assertThat(reloaded.getOptions()).isEqualTo("{\"signingRegion\":\"ap-east-1\"}");
        // 服务层 JSON 语义不变:解析回读等价
        assertThat(objectMapper.readTree(reloaded.getOptions())
                .path("signingRegion").asText()).isEqualTo("ap-east-1");
    }

    // ------------------------------------------------------------------
    // 脚手架
    // ------------------------------------------------------------------

    private static StorageConfig s3Config(String purpose, String options) {
        return StorageConfig.builder()
                .name("IT 探针-" + purpose + "-" + UUID.randomUUID().toString().substring(0, 8))
                .type("s3")
                .endpoint("http://127.0.0.1:9000")
                .bucketName("inneragent-write-paths")
                .accessKey("ak-it")
                .secretKey("sk-it")
                .region("us-east-1")
                .basePath("write-paths")
                .options(options)
                .build();
    }

    private String columnType(String table, String column) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT data_type FROM information_schema.columns "
                             + "WHERE table_schema = 'public' AND table_name = ? AND column_name = ?")) {
            statement.setString(1, table);
            statement.setString(2, column);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? resultSet.getString(1) : null;
            }
        }
    }
}
