package com.inneragent.agent.workspace;

import com.inneragent.platform.service.storage.S3ClientFactory;
import com.inneragent.platform.service.storage.S3StorageConfigResolver;
import com.inneragent.platform.service.storage.StorageConfigService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class AgentWorkspacePayloadServiceTests {

    @TempDir
    Path temporaryDirectory;

    @Test
    void databasePayloadRoundTripsWithoutExternalStorage() {
        AgentWorkspacePayloadService service = service();

        AgentWorkspaceStoredPayload stored = service.write(
                "{\"content\":\"hello\"}",
                new AgentWorkspaceLocation(AgentWorkspaceBackend.DATABASE, null, null));

        assertThat(stored.databasePayload()).isEqualTo("{\"content\":\"hello\"}");
        assertThat(stored.contentRef()).isNull();
        assertThat(service.read(stored)).isEqualTo("{\"content\":\"hello\"}");
        service.verify(stored);
    }

    @Test
    void localPayloadUsesConfiguredPersistentRootAndCanBeCleanedUp() {
        AgentWorkspacePayloadService service = service();

        AgentWorkspaceStoredPayload stored = service.write(
                "{\"content\":\"local\"}",
                new AgentWorkspaceLocation(
                        AgentWorkspaceBackend.LOCAL,
                        null,
                        temporaryDirectory.toString()));

        Path storedFile = temporaryDirectory.resolve(stored.contentRef()).normalize();
        assertThat(stored.localPath()).isEqualTo(temporaryDirectory.toAbsolutePath().toString());
        assertThat(storedFile).exists();
        assertThat(service.read(stored)).isEqualTo("{\"content\":\"local\"}");
        service.verify(stored);

        service.delete(stored);
        assertThat(Files.exists(storedFile)).isFalse();
    }

    @Test
    void binaryBytesRoundTripThroughDatabaseBackendAsBase64() {
        AgentWorkspacePayloadService service = service();
        byte[] bytes = new byte[]{0, 1, 2, -1, 127, 42};

        AgentWorkspaceStoredPayload stored = service.writeBytes(
                bytes,
                new AgentWorkspaceLocation(AgentWorkspaceBackend.DATABASE, null, null),
                "png",
                "image/png");

        // TEXT 列兼容:database 后端以 Base64 承载二进制,sha/size 按原始字节
        assertThat(stored.databasePayload())
                .isEqualTo(java.util.Base64.getEncoder().encodeToString(bytes));
        assertThat(stored.size()).isEqualTo(bytes.length);
        assertThat(service.readBytes(stored)).isEqualTo(bytes);
    }

    @Test
    void binaryBytesRoundTripThroughLocalBackendWithExtensionHint() throws Exception {
        AgentWorkspacePayloadService service = service();

        AgentWorkspaceStoredPayload stored = service.writeBytes(
                new byte[]{9, 8, 7},
                new AgentWorkspaceLocation(
                        AgentWorkspaceBackend.LOCAL, null, temporaryDirectory.toString()),
                "png",
                "image/png");

        assertThat(stored.contentRef()).endsWith(".png");
        assertThat(service.readBytes(stored)).isEqualTo(new byte[]{9, 8, 7});
    }

    private AgentWorkspacePayloadService service() {
        return new AgentWorkspacePayloadService(
                mock(StorageConfigService.class),
                mock(S3StorageConfigResolver.class),
                mock(S3ClientFactory.class),
                temporaryDirectory.toString());
    }
}
