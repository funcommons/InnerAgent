package com.inneragent.integration;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.agent.entity.AgentConversation;
import com.inneragent.agent.entity.AgentMessage;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.agent.mapper.AgentConversationMapper;
import com.inneragent.agent.mapper.AgentMessageMapper;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.conversation.AgentConversationService;
import com.inneragent.agent.run.AgentRunCoordinator;
import com.inneragent.agent.run.AgentStateSessionIds;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import com.inneragent.agent.run.kernel.AgentKernelSnapshotPayload;
import com.inneragent.agent.run.kernel.CanonicalAgentKernelSnapshotBuilder;
import com.inneragent.agent.run.kernel.ToolManifestSnapshot;
import com.inneragent.agent.run.model.ChildRunAdmission;
import com.inneragent.agent.run.model.ChildRunIdentityConflictException;
import com.inneragent.agent.run.model.StartAgentRunCommand;
import com.inneragent.agent.run.model.StartChildAgentRunCommand;
import com.inneragent.agent.run.model.StartedAgentRun;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers(disabledWithoutDocker = false)
class AgentRunStartIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine")
            .withDatabaseName("ai_fusion_video")
            .withUsername("afv")
            .withPassword("afv-test");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    private AgentRunCoordinator coordinator;

    @Autowired
    private AgentConversationService conversationService;

    @Autowired
    private AgentConversationMapper conversationMapper;

    @Autowired
    private AgentMessageMapper messageMapper;

    @Autowired
    private AgentRunMapper runMapper;

    @Autowired
    private TransactionTemplate transactionTemplate;

    @Test
    void startsRootAndMessageAtomicallyAndRejectsInvalidRootAdmissions() {
        long userId = 42L;
        long projectId = 7L;
        String conversationId = createConversation(userId, projectId);
        AgentKernelSnapshot snapshot = snapshot("assistant", 1L);
        Instant deadline = Instant.now().plus(Duration.ofMinutes(10));
        StartAgentRunCommand command = rootCommand(
                uniqueId("root"), conversationId, userId, projectId,
                snapshot, deadline, null, null, null);

        StartedAgentRun started = await(coordinator.start(command));

        assertThat(started.initialMessageOrder()).isEqualTo(1L);
        assertThat(started.deadline()).isEqualTo(deadline.truncatedTo(ChronoUnit.MILLIS));
        AgentRun persisted = run(command.runId());
        assertThat(persisted.getParentRunId()).isNull();
        assertThat(persisted.getParentToolCallId()).isNull();
        assertThat(persisted.getAgentName()).isNull();
        assertThat(persisted.getDeadlineAt()).isNotNull();
        assertThat(messages(command.runId()))
                .singleElement()
                .satisfies(message -> {
                    assertThat(message.getRole()).isEqualTo("user");
                    assertThat(message.getMessageOrder()).isEqualTo(1L);
                    assertThat(message.getContent()).isEqualTo("hello");
                });
        assertConversationCounters(conversationId, 1, 2L);

        StartAgentRunCommand secondRoot = rootCommand(
                uniqueId("second-root"), conversationId, userId, projectId,
                snapshot, deadline, null, null, null);
        assertThatThrownBy(() -> await(coordinator.start(secondRoot)))
                .isInstanceOf(BusinessException.class)
                .satisfies(failure -> assertThat(((BusinessException) failure).getCode())
                        .isEqualTo(409));
        assertConversationCounters(conversationId, 1, 2L);
        assertThat(run(secondRoot.runId())).isNull();

        String pastConversation = createConversation(userId, projectId);
        StartAgentRunCommand pastDeadline = rootCommand(
                uniqueId("past-root"), pastConversation, userId, projectId,
                snapshot, Instant.now().minusSeconds(1), null, null, null);
        assertThatThrownBy(() -> await(coordinator.start(pastDeadline)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("deadline");
        assertThat(run(pastDeadline.runId())).isNull();

        StartAgentRunCommand invalidRootIdentity = rootCommand(
                uniqueId("invalid-root"), pastConversation, userId, projectId,
                snapshot, deadline, "parent", "tool", "child-agent");
        assertThatThrownBy(() -> await(coordinator.start(invalidRootIdentity)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("parent identity");

        String foreignConversation = createConversation(userId, projectId);
        StartAgentRunCommand foreignUser = rootCommand(
                uniqueId("foreign-root"), foreignConversation, 99L, projectId,
                snapshot, deadline, null, null, null);
        assertThatThrownBy(() -> await(coordinator.start(foreignUser)))
                .isInstanceOf(BusinessException.class)
                .satisfies(failure -> assertThat(((BusinessException) failure).getCode())
                        .isEqualTo(403));
        assertThat(run(foreignUser.runId())).isNull();
    }

    @Test
    void rollsBackRunWhenInitialMessageCannotBeInserted() {
        String conversationId = createConversation(42L, 7L);
        AgentMessage conflictingOrder = AgentMessage.builder()
                .conversationId(conversationId)
                .role("user")
                .content("poison-order")
                .messageOrder(1L)
                .build();
        assertThat(messageMapper.insert(conflictingOrder)).isEqualTo(1);

        StartAgentRunCommand command = rootCommand(
                uniqueId("rollback-root"), conversationId, 42L, 7L,
                snapshot("assistant", 1L), Instant.now().plusSeconds(300),
                null, null, null);

        assertThatThrownBy(() -> await(coordinator.start(command)))
                .isInstanceOf(RuntimeException.class);
        assertThat(run(command.runId())).isNull();
        assertConversationCounters(conversationId, 0, 1L);
        assertThat(messages(command.runId())).isEmpty();
    }

    @Test
    void rotatesStateGenerationAfterInterruptedRootAndReusesItAfterSuccess() {
        String conversationId = createConversation(42L, 7L);
        AgentKernelSnapshot snapshot = snapshot("assistant", 1L);

        StartAgentRunCommand firstCommand = rootCommand(
                uniqueId("interrupted-root"),
                conversationId,
                42L,
                7L,
                snapshot,
                Instant.now().plusSeconds(300),
                null,
                null,
                null);
        StartedAgentRun first = await(coordinator.start(firstCommand));
        assertThat(runMapper.update(null, new LambdaUpdateWrapper<AgentRun>()
                .eq(AgentRun::getRunId, first.runId())
                .set(AgentRun::getStatus, "CANCELLED"))).isEqualTo(1);

        StartAgentRunCommand recoveryCommand = rootCommand(
                uniqueId("recovery-root"),
                conversationId,
                42L,
                7L,
                snapshot,
                Instant.now().plusSeconds(300),
                null,
                null,
                null);
        StartedAgentRun recovery = await(coordinator.start(recoveryCommand));

        assertThat(recovery.agentStateSessionId())
                .isEqualTo(AgentStateSessionIds.recoveryGeneration(
                        conversationId, "assistant", recovery.runId()))
                .startsWith("afv-root:")
                .isNotEqualTo(first.agentStateSessionId());

        assertThat(runMapper.update(null, new LambdaUpdateWrapper<AgentRun>()
                .eq(AgentRun::getRunId, recovery.runId())
                .set(AgentRun::getStatus, "COMPLETED"))).isEqualTo(1);
        StartAgentRunCommand nextTurnCommand = rootCommand(
                uniqueId("next-turn-root"),
                conversationId,
                42L,
                7L,
                snapshot,
                Instant.now().plusSeconds(300),
                null,
                null,
                null);
        StartedAgentRun nextTurn = await(coordinator.start(nextTurnCommand));

        assertThat(nextTurn.agentStateSessionId())
                .isEqualTo(recovery.agentStateSessionId());
    }

    @Test
    void admitsChildFromLockedParentAndMakesDuplicateAdmissionIdempotent() {
        String conversationId = createConversation(42L, 7L);
        AgentKernelSnapshot rootSnapshot = snapshot("root-agent", 1L);
        Instant rootDeadline = Instant.now().plus(Duration.ofMinutes(15));
        StartAgentRunCommand rootCommand = rootCommand(
                uniqueId("root"), conversationId, 42L, 7L,
                rootSnapshot, rootDeadline, null, null, null);
        StartedAgentRun root = await(coordinator.start(rootCommand));

        AgentKernelSnapshot childSnapshot = snapshot("asset-image-gen", 3L);
        Instant childDeadline = root.deadline().minusSeconds(60);
        StartChildAgentRunCommand childCommand = childCommand(
                uniqueId("child"), root.runId(), "tool-call-1",
                root.ownerInstanceId(), root.ownerEpoch(), "Asset image agent",
                "asset_image_gen", childSnapshot, childDeadline);

        ChildRunAdmission admitted = await(coordinator.startChild(childCommand));

        assertThat(admitted.created()).isTrue();
        assertThat(admitted.run().initialMessageOrder()).isEqualTo(2L);
        AgentRun persistedChild = run(childCommand.childRunId());
        assertThat(persistedChild.getConversationId()).isEqualTo(conversationId);
        assertThat(persistedChild.getUserId()).isEqualTo(42L);
        assertThat(persistedChild.getProjectId()).isEqualTo(7L);
        assertThat(persistedChild.getParentRunId()).isEqualTo(root.runId());
        assertThat(persistedChild.getParentToolCallId()).isEqualTo("tool-call-1");
        assertThat(persistedChild.getAgentName()).isEqualTo("Asset image agent");
        assertThat(persistedChild.getDeadlineAt())
                .isBeforeOrEqualTo(run(root.runId()).getDeadlineAt());
        assertThat(persistedChild.getAgentStateSessionId())
                .startsWith("afv-child:")
                .isNotEqualTo(root.agentStateSessionId());
        assertConversationCounters(conversationId, 2, 3L);

        StartChildAgentRunCommand retryWithNewCandidateId = childCommand(
                uniqueId("retry-candidate"), root.runId(), "tool-call-1",
                root.ownerInstanceId(), root.ownerEpoch(), "Asset image agent",
                "asset_image_gen", childSnapshot, childDeadline);
        ChildRunAdmission duplicate = await(coordinator.startChild(retryWithNewCandidateId));
        assertThat(duplicate.created()).isFalse();
        assertThat(duplicate.run().runId()).isEqualTo(childCommand.childRunId());
        assertThat(duplicate.run().initialMessageOrder()).isEqualTo(2L);
        assertConversationCounters(conversationId, 2, 3L);
        assertThat(messages(childCommand.childRunId())).hasSize(1);

        StartChildAgentRunCommand identityConflict = childCommand(
                childCommand.childRunId(), root.runId(), "tool-call-1",
                root.ownerInstanceId(), root.ownerEpoch(), "Different agent",
                "asset_image_gen", childSnapshot, childDeadline);
        assertThatThrownBy(() -> await(coordinator.startChild(identityConflict)))
                .isInstanceOf(ChildRunIdentityConflictException.class);

        // [adapt] P4-W14 子 Agent deadline 钳制:显式超出父截止时间的请求不再
        // 拒绝,而是钳制到父 deadlineAt(WARN 留痕)——子运行生命周期恒不超过父。
        StartChildAgentRunCommand afterParentDeadline = childCommand(
                uniqueId("late-child"), root.runId(), "tool-call-2",
                root.ownerInstanceId(), root.ownerEpoch(), "Late child",
                "asset_image_gen", childSnapshot, root.deadline().plusSeconds(1));
        ChildRunAdmission clamped = await(coordinator.startChild(afterParentDeadline));
        assertThat(clamped.created()).isTrue();
        assertThat(run(afterParentDeadline.childRunId()).getDeadlineAt())
                .isEqualTo(run(root.runId()).getDeadlineAt());

        StartChildAgentRunCommand staleOwner = childCommand(
                uniqueId("stale-owner-child"), root.runId(), "tool-call-3",
                "stale-instance", root.ownerEpoch(), "Stale owner child",
                "asset_image_gen", childSnapshot, childDeadline);
        assertThatThrownBy(() -> await(coordinator.startChild(staleOwner)))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("所有权");

        assertThat(runMapper.update(null, new LambdaUpdateWrapper<AgentRun>()
                .eq(AgentRun::getRunId, root.runId())
                .set(AgentRun::getStatus, "CANCEL_REQUESTED"))).isEqualTo(1);
        StartChildAgentRunCommand cancelledParent = childCommand(
                uniqueId("cancelled-child"), root.runId(), "tool-call-4",
                root.ownerInstanceId(), root.ownerEpoch(), "Cancelled child",
                "asset_image_gen", childSnapshot, childDeadline);
        assertThatThrownBy(() -> await(coordinator.startChild(cancelledParent)))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("不接受子任务");
    }

    /**
     * [adapt] P4-W14 deadline 钳制矩阵(03-开发计划 §7.3 验收 4「子 deadline ≤ 父」):
     * 父剩 10s / 子请 60s → 钳到父截止;子请 5s(更短)→ 按请求原样生效。
     */
    @Test
    void clampsChildDeadlineToParentDeadlineAndHonorsShorterRequests() {
        String conversationId = createConversation(42L, 7L);
        AgentKernelSnapshot snapshot = snapshot("root-agent", 1L);
        Instant parentDeadline = Instant.now().plus(Duration.ofSeconds(10))
                .truncatedTo(ChronoUnit.MILLIS);
        StartedAgentRun parent = await(coordinator.start(rootCommand(
                uniqueId("clamp-root"), conversationId, 42L, 7L,
                snapshot, parentDeadline, null, null, null)));
        Instant parentPersistedDeadline = run(parent.runId()).getDeadlineAt()
                .toInstant(ZoneOffset.UTC);

        StartChildAgentRunCommand beyondParent = childCommand(
                uniqueId("clamp-child"), parent.runId(), "clamp-tool-1",
                parent.ownerInstanceId(), parent.ownerEpoch(), "Clamped child",
                "asset_image_gen", snapshot,
                parentPersistedDeadline.plus(Duration.ofSeconds(60)));
        ChildRunAdmission clamped = await(coordinator.startChild(beyondParent));
        assertThat(clamped.created()).isTrue();
        assertThat(run(beyondParent.childRunId()).getDeadlineAt()
                .toInstant(ZoneOffset.UTC))
                .isEqualTo(parentPersistedDeadline);

        Instant shorter = Instant.now().plus(Duration.ofSeconds(5))
                .truncatedTo(ChronoUnit.MILLIS);
        StartChildAgentRunCommand shorterRequest = childCommand(
                uniqueId("short-child"), parent.runId(), "clamp-tool-2",
                parent.ownerInstanceId(), parent.ownerEpoch(), "Short child",
                "asset_image_gen", snapshot, shorter);
        ChildRunAdmission honored = await(coordinator.startChild(shorterRequest));
        assertThat(honored.created()).isTrue();
        assertThat(run(shorterRequest.childRunId()).getDeadlineAt()
                .toInstant(ZoneOffset.UTC))
                .isEqualTo(shorter);
    }

    /**
     * [adapt] P4-W14 深度/扇出护栏(默认 maxSubAgentDepth=3、
     * maxConcurrentSubAgents=5,可配):超限明确拒绝(429,文案回灌模型);
     * 同一 parentToolCallId 的幂等重试不受扇出上限误伤。
     */
    @Test
    void enforcesSubAgentDepthAndFanoutGuardrails() {
        String conversationId = createConversation(42L, 7L);
        AgentKernelSnapshot snapshot = snapshot("root-agent", 1L);
        Instant deadline = Instant.now().plus(Duration.ofMinutes(5));
        StartedAgentRun root = await(coordinator.start(rootCommand(
                uniqueId("guard-root"), conversationId, 42L, 7L,
                snapshot, deadline, null, null, null)));

        // 深度:根(1) → 子(2) → 孙(3) 放行;曾孙(4) 拒绝。
        StartedAgentRun child = await(coordinator.startChild(childCommand(
                uniqueId("depth-child"), root.runId(), "depth-tool-1",
                root.ownerInstanceId(), root.ownerEpoch(), "Depth child",
                "asset_image_gen", snapshot, deadline.minusSeconds(1)))).run();
        StartedAgentRun grandchild = await(coordinator.startChild(childCommand(
                uniqueId("depth-grandchild"), child.runId(), "depth-tool-2",
                child.ownerInstanceId(), child.ownerEpoch(), "Depth grandchild",
                "asset_image_gen", snapshot, deadline.minusSeconds(1)))).run();
        assertThat(run(grandchild.runId()).getParentRunId()).isEqualTo(child.runId());

        StartChildAgentRunCommand greatGrandchild = childCommand(
                uniqueId("depth-great"), grandchild.runId(), "depth-tool-3",
                grandchild.ownerInstanceId(), grandchild.ownerEpoch(),
                "Depth great grandchild", "asset_image_gen", snapshot,
                deadline.minusSeconds(1));
        assertThatThrownBy(() -> await(coordinator.startChild(greatGrandchild)))
                .isInstanceOf(BusinessException.class)
                .satisfies(failure -> {
                    assertThat(((BusinessException) failure).getCode()).isEqualTo(429);
                    assertThat(failure.getMessage()).contains("深度");
                });
        assertThat(run(greatGrandchild.childRunId())).isNull();

        // 扇出:同一父下 5 个活跃子运行放行,第 6 个拒绝;已有 toolCallId 幂等重试不误伤。
        String fanoutConversation = createConversation(42L, 7L);
        StartedAgentRun fanoutRoot = await(coordinator.start(rootCommand(
                uniqueId("fanout-root"), fanoutConversation, 42L, 7L,
                snapshot, deadline, null, null, null)));
        for (int index = 1; index <= 5; index++) {
            ChildRunAdmission admitted = await(coordinator.startChild(childCommand(
                    uniqueId("fanout-child-" + index), fanoutRoot.runId(),
                    "fanout-tool-" + index,
                    fanoutRoot.ownerInstanceId(), fanoutRoot.ownerEpoch(),
                    "Fanout child " + index, "asset_image_gen", snapshot,
                    deadline.minusSeconds(1))));
            assertThat(admitted.created()).isTrue();
        }
        StartChildAgentRunCommand sixth = childCommand(
                uniqueId("fanout-child-6"), fanoutRoot.runId(), "fanout-tool-6",
                fanoutRoot.ownerInstanceId(), fanoutRoot.ownerEpoch(),
                "Fanout child 6", "asset_image_gen", snapshot,
                deadline.minusSeconds(1));
        assertThatThrownBy(() -> await(coordinator.startChild(sixth)))
                .isInstanceOf(BusinessException.class)
                .satisfies(failure -> {
                    assertThat(((BusinessException) failure).getCode()).isEqualTo(429);
                    assertThat(failure.getMessage()).contains("并发");
                });
        assertThat(run(sixth.childRunId())).isNull();

        StartChildAgentRunCommand idempotentRetry = childCommand(
                uniqueId("fanout-retry"), fanoutRoot.runId(), "fanout-tool-3",
                fanoutRoot.ownerInstanceId(), fanoutRoot.ownerEpoch(),
                "Fanout child 3", "asset_image_gen", snapshot,
                deadline.minusSeconds(1));
        ChildRunAdmission retry = await(coordinator.startChild(idempotentRetry));
        assertThat(retry.created()).isFalse();
    }

    @Test
    void rechecksDatabaseTimeAfterWaitingForTheParentRowLock() throws Exception {
        String conversationId = createConversation(42L, 7L);
        AgentKernelSnapshot snapshot = snapshot("root-agent", 1L);
        StartedAgentRun root = await(coordinator.start(rootCommand(
                uniqueId("lease-root"), conversationId, 42L, 7L,
                snapshot, Instant.now().plusSeconds(300), null, null, null)));

        java.time.LocalDateTime leaseExpiry = runMapper.selectDatabaseNow().plusSeconds(1);
        assertThat(runMapper.update(null, new LambdaUpdateWrapper<AgentRun>()
                .eq(AgentRun::getRunId, root.runId())
                .set(AgentRun::getLeaseUntil, leaseExpiry))).isEqualTo(1);

        CountDownLatch parentLocked = new CountDownLatch(1);
        CountDownLatch releaseParent = new CountDownLatch(1);
        ExecutorService lockHolder = Executors.newSingleThreadExecutor();
        Future<?> lockFuture = lockHolder.submit(() -> transactionTemplate.execute(ignored -> {
            runMapper.selectByRunIdForUpdate(root.runId());
            parentLocked.countDown();
            try {
                if (!releaseParent.await(15, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to release parent lock");
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Parent lock holder was interrupted", interrupted);
            }
            return null;
        }));
        try {
            assertThat(parentLocked.await(10, TimeUnit.SECONDS)).isTrue();
            StartChildAgentRunCommand child = childCommand(
                    uniqueId("expired-child"), root.runId(), "lease-tool-call",
                    root.ownerInstanceId(), root.ownerEpoch(), "Expired child",
                    "asset_image_gen", snapshot, root.deadline().minusSeconds(1));
            CompletableFuture<ChildRunAdmission> admission =
                    coordinator.startChild(child).toFuture();

            org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(10))
                    .until(() -> runMapper.selectDatabaseNow().isAfter(leaseExpiry));
            releaseParent.countDown();

            assertThatThrownBy(() -> admission.get(15, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(BusinessException.class)
                    .hasRootCauseMessage("父 Agent 运行租约已失效");
            assertThat(run(child.childRunId())).isNull();
            lockFuture.get(10, TimeUnit.SECONDS);
        } finally {
            releaseParent.countDown();
            lockHolder.shutdownNow();
            assertThat(lockHolder.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    private String createConversation(long userId, long projectId) {
        String conversationId = uniqueId("conversation");
        conversationService.createOrUpdate(
                conversationId, userId, projectId, "project", projectId,
                "assistant", "Run start test", "chat");
        return conversationId;
    }

    private StartAgentRunCommand rootCommand(
            String runId,
            String conversationId,
            long userId,
            long projectId,
            AgentKernelSnapshot snapshot,
            Instant deadline,
            String parentRunId,
            String parentToolCallId,
            String agentName) {
        return new StartAgentRunCommand(
                runId,
                conversationId,
                userId,
                projectId,
                "assistant",
                parentRunId,
                parentToolCallId,
                agentName,
                "session-" + runId,
                snapshot,
                "instance-a",
                Duration.ofSeconds(30),
                deadline,
                "hello",
                null);
    }

    private StartChildAgentRunCommand childCommand(
            String childRunId,
            String parentRunId,
            String parentToolCallId,
            String parentOwner,
            long parentEpoch,
            String agentName,
            String agentDefinitionStableKey,
            AgentKernelSnapshot snapshot,
            Instant deadline) {
        return new StartChildAgentRunCommand(
                childRunId,
                parentRunId,
                parentToolCallId,
                parentOwner,
                parentEpoch,
                agentName,
                agentDefinitionStableKey,
                snapshot,
                "instance-child",
                Duration.ofSeconds(30),
                deadline,
                "child request",
                null);
    }

    private AgentKernelSnapshot snapshot(String stableKey, long modelVersion) {
        AgentKernelSnapshotPayload payload = new AgentKernelSnapshotPayload(
                AgentKernelSnapshotPayload.CURRENT_SCHEMA_VERSION,
                stableKey,
                stableKey + " name",
                "test agent",
                "You are a test agent.",
                10,
                "model-config-1",
                modelVersion,
                "openai",
                "gpt-test",
                JsonNodeFactory.instance.objectNode().put("temperature", 0.2),
                List.of(new ToolManifestSnapshot(
                        "read_asset", "a".repeat(64), true, true, "test-v1")),
                "1.0.0-test");
        return new CanonicalAgentKernelSnapshotBuilder().build(payload);
    }

    private AgentRun run(String runId) {
        return runMapper.selectOne(new LambdaQueryWrapper<AgentRun>()
                .eq(AgentRun::getRunId, runId));
    }

    private List<AgentMessage> messages(String runId) {
        return messageMapper.selectList(new LambdaQueryWrapper<AgentMessage>()
                .eq(AgentMessage::getRunId, runId)
                .orderByAsc(AgentMessage::getMessageOrder));
    }

    private void assertConversationCounters(
            String conversationId, int messageCount, long nextMessageOrder) {
        AgentConversation conversation = conversationMapper.selectOne(
                new LambdaQueryWrapper<AgentConversation>()
                        .eq(AgentConversation::getConversationId, conversationId));
        assertThat(conversation.getMessageCount()).isEqualTo(messageCount);
        assertThat(conversation.getNextMessageOrder()).isEqualTo(nextMessageOrder);
    }

    private <T> T await(reactor.core.publisher.Mono<T> result) {
        // Blocking is restricted to this integration-test boundary.
        return result.block(Duration.ofSeconds(15));
    }

    private static String uniqueId(String prefix) {
        return prefix + '-' + UUID.randomUUID().toString().replace("-", "");
    }
}
