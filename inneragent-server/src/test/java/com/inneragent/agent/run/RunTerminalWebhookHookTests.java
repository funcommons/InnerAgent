package com.inneragent.agent.run;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.run.model.AgentEventEnvelope;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import com.inneragent.agent.run.model.RunTerminalRequest;
import com.inneragent.agent.run.model.SystemTerminalActor;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.state.StateStoreFailureGuard;
import com.inneragent.agent.state.StateStoreSlot;
import com.inneragent.platform.config.AgentScopeRuntimeProperties;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.platform.enums.ai.AgentTerminalOutputType;
import com.inneragent.platform.repository.ai.AgentEventRepository;
import com.inneragent.platform.webhook.WebhookDeliveryService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.ObjectProvider;

import java.time.Instant;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 终态→Webhook 入队挂点测试(任务 #18b,[adapt] 挂点):终止事务提交后,
 * DONE/ERROR/CANCELLED 分别映射 run.finished/run.failed/run.cancelled;
 * webhook 未装配/入队异常均不影响终态主链路。
 */
class RunTerminalWebhookHookTests {

    private AgentEventRepository repository;
    private AgentRunRedisSignalService signals;
    private RecordingWebhookService webhookService;
    private MySqlRunTerminalCoordinator coordinator;
    private AutoCloseable schedulers;

    /** 记录入队事件的替身服务 */
    static final class RecordingWebhookService extends WebhookDeliveryService {
        final java.util.List<TerminalEvent> events = new java.util.ArrayList<>();

        RecordingWebhookService() {
            super(mock(WebhookDeliveryMapperForTest.class),
                    new com.inneragent.platform.webhook.WebhookDeliveryProperties(),
                    passthroughTransactionManager());
        }

        @Override
        public void onRunTerminal(TerminalEvent event) {
            events.add(event);
        }

        private static PlatformTransactionManagerForTest passthroughTransactionManager() {
            return Mockito.mock(PlatformTransactionManagerForTest.class);
        }

        /** 名义类型:仅为 Mockito mock 提供 visible 目标 */
        public interface WebhookDeliveryMapperForTest
                extends com.inneragent.platform.mapper.WebhookDeliveryMapper {
        }

        /** 名义类型:仅为 Mockito mock 提供 visible 目标 */
        public interface PlatformTransactionManagerForTest
                extends org.springframework.transaction.PlatformTransactionManager {
        }
    }

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        repository = mock(AgentEventRepository.class);
        signals = mock(AgentRunRedisSignalService.class);
        webhookService = new RecordingWebhookService();
        ObjectProvider<WebhookDeliveryService> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(webhookService);
        AgentRuntimeSchedulers runtimeSchedulers = new AgentRuntimeSchedulers(
                new AgentScopeRuntimeProperties());
        schedulers = runtimeSchedulers;
        coordinator = new MySqlRunTerminalCoordinator(
                repository,
                mock(AgentRunMapper.class),
                mock(StateStoreFailureGuard.class),
                runtimeSchedulers,
                signals,
                provider);
        when(signals.publishWakeup(any(), any(long.class)))
                .thenReturn(reactor.core.publisher.Mono.empty());
    }

    @AfterEach
    void tearDown() throws Exception {
        schedulers.close();
    }

    @Test
    @DisplayName("DONE 终态提交后入队 run.finished,载荷携带 runId/终态")
    void mapsDoneTerminalToRunFinished() {
        RunTerminalRequest request = terminalRequest("DONE");
        when(repository.terminateSystemTx(any(), any())).thenReturn(
                Optional.of(committed(request, "DONE")));

        coordinator.terminateSystem(request, SystemTerminalActor.CANCELLATION_COORDINATOR)
                .block(java.time.Duration.ofSeconds(5));

        assertThat(webhookService.events).hasSize(1);
        WebhookDeliveryService.TerminalEvent event = webhookService.events.getFirst();
        assertThat(event.eventType()).isEqualTo(WebhookDeliveryService.EVENT_RUN_FINISHED);
        assertThat(event.runId()).isEqualTo("run-1");
        assertThat(event.terminalStatus()).isEqualTo("DONE");
    }

    @Test
    @DisplayName("ERROR 终态入队 run.failed 并透传 errorCode/error")
    void mapsErrorTerminalToRunFailedWithErrorCode() {
        // 走 system 路径:owned 路径的 failClosed 预检依赖 MP TableInfo 缓存,
        // mock mapper 下不可用,属既有主链路(已有专门测试),此处仅验挂点映射。
        RunTerminalRequest request = terminalRequest("ERROR");
        when(repository.terminateSystemTx(any(), any())).thenReturn(
                Optional.of(committed(request, "ERROR")));

        coordinator.terminateSystem(request, SystemTerminalActor.OWNER_RECONCILER)
                .block(java.time.Duration.ofSeconds(5));

        assertThat(webhookService.events).hasSize(1);
        WebhookDeliveryService.TerminalEvent event = webhookService.events.getFirst();
        assertThat(event.eventType()).isEqualTo(WebhookDeliveryService.EVENT_RUN_FAILED);
        assertThat(event.errorCode()).isEqualTo("MODEL_TIMEOUT");
        assertThat(event.errorMessage()).isEqualTo("模型调用超时");
    }

    @Test
    @DisplayName("CANCELLED 终态入队 run.cancelled")
    void mapsCancelledTerminalToRunCancelled() {
        RunTerminalRequest request = terminalRequest("CANCELLED");
        when(repository.terminateSystemTx(any(), any())).thenReturn(
                Optional.of(committed(request, "CANCELLED")));

        coordinator.terminateSystem(request, SystemTerminalActor.OWNER_RECONCILER)
                .block(java.time.Duration.ofSeconds(5));

        assertThat(webhookService.events).hasSize(1);
        assertThat(webhookService.events.getFirst().eventType())
                .isEqualTo(WebhookDeliveryService.EVENT_RUN_CANCELLED);
    }

    @Test
    @DisplayName("webhook 未装配(getIfAvailable=null)时终态链路不受影响")
    void toleratesMissingWebhookService() {
        ObjectProvider<WebhookDeliveryService> absent = mock(ObjectProvider.class);
        when(absent.getIfAvailable()).thenReturn(null);
        AgentRuntimeSchedulers runtimeSchedulers = new AgentRuntimeSchedulers(
                new AgentScopeRuntimeProperties());
        MySqlRunTerminalCoordinator bare = new MySqlRunTerminalCoordinator(
                repository,
                mock(AgentRunMapper.class),
                mock(StateStoreFailureGuard.class),
                runtimeSchedulers,
                signals,
                absent);
        RunTerminalRequest request = terminalRequest("DONE");
        when(repository.terminateSystemTx(any(), any())).thenReturn(
                Optional.of(committed(request, "DONE")));

        Optional<CommittedAgentEvent> result = bare
                .terminateSystem(request, SystemTerminalActor.CANCELLATION_COORDINATOR)
                .block(java.time.Duration.ofSeconds(5));

        assertThat(result).isPresent();
    }

    private static RunTerminalRequest terminalRequest(String outputType) {
        AgentTerminalOutputType terminalOutput = switch (outputType) {
            case "DONE" -> AgentTerminalOutputType.DONE;
            case "ERROR" -> AgentTerminalOutputType.ERROR;
            default -> AgentTerminalOutputType.CANCELLED;
        };
        AgentRunStatus status = terminalOutput.terminalStatus();
        JsonNodeFactory factory = JsonNodeFactory.instance;
        var payload = factory.objectNode()
                .put("outputType", outputType)
                .put("finished", true);
        if ("ERROR".equals(outputType)) {
            payload.put("errorCode", "MODEL_TIMEOUT");
            payload.put("error", "模型调用超时");
        }
        AgentEventEnvelope envelope = new AgentEventEnvelope(
                "raw-1",
                "RUN_TERMINAL",
                "platform/test",
                null,
                null,
                null,
                null,
                null,
                outputType,
                payload,
                Instant.now());
        return new RunTerminalRequest(
                "run-1",
                new StateStoreSlot("1", "session-1"),
                Set.of(AgentRunStatus.RUNNING),
                status,
                terminalOutput,
                "ERROR".equals(outputType)
                        ? com.inneragent.platform.enums.ai.AgentRuntimeErrorCode.MODEL_TIMEOUT
                        : null,
                "ERROR".equals(outputType) ? "模型调用超时" : null,
                envelope);
    }

    private static CommittedAgentEvent committed(RunTerminalRequest request, String outputType) {
        return new CommittedAgentEvent(
                1L,
                request.runId(),
                7L,
                request.terminalEnvelope(),
                Instant.now());
    }
}
