package com.inneragent.agent.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.context.ToolExecutionContext;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import com.inneragent.server.auth.act.ActTokenIssuer;
import com.inneragent.server.auth.act.ActTokenKeyManager;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpTransportSessionNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * McpClientToolInvoker 单测(P1-T2b):重连编排(R1:单飞锁 + 指数退避 +
 * 同实例 re-initialize + 重试)、错误细分(401/超时/断连)、act token 请求
 * 组装(audience=endpoint_url)、结构化结果转 payloadJson。
 *
 * <p>宿主链路(真实 HTTP + X-IA-Act 到达宿主)见 IT:McpClientToolInvokerHostBridgeIT。
 */
class McpClientToolInvokerTests {

    private static final String ENDPOINT = "https://host.example.com/ia-mcp";
    private static final ToolExecutionContext ACT_CONTEXT =
            new ToolExecutionContext(10001L, 1, 1L, 7L);

    private ToolRegistryMapper registryMapper;
    private ActTokenIssuer actTokenIssuer;
    private McpInvokerProperties properties;
    private RecordingInvoker invoker;

    /** 记录客户端构建次数;重连编排测试注入「先断后通」的 mock 客户端。 */
    static class RecordingInvoker extends McpClientToolInvoker {

        final ConcurrentLinkedQueue<McpSyncClient> createdClients = new ConcurrentLinkedQueue<>();
        private final ConcurrentLinkedQueue<McpSyncClient> factoryQueue;

        RecordingInvoker(ToolRegistryMapper registryMapper, ActTokenIssuer actTokenIssuer,
                         ObjectMapper objectMapper, McpInvokerProperties properties,
                         ConcurrentLinkedQueue<McpSyncClient> factoryQueue) {
            super(registryMapper, actTokenIssuer, objectMapper, properties);
            this.factoryQueue = factoryQueue;
        }

        @Override
        protected ClientHandle createClient(String clientKey, String endpointUrl,
                                            ToolRegistryEntry entry) {
            McpSyncClient next = factoryQueue.poll();
            if (next == null) {
                throw new AssertionError("客户端工厂耗尽(不应重建): " + clientKey);
            }
            this.createdClients.add(next);
            return new ClientHandle(next);
        }
    }

    @BeforeEach
    void setUp() {
        registryMapper = Mockito.mock(ToolRegistryMapper.class);
        actTokenIssuer = Mockito.spy(new ActTokenIssuer(new ActTokenKeyManager(null, null)));
        properties = new McpInvokerProperties();
        properties.getReconnect().setInitialBackoff(java.time.Duration.ofMillis(5));
        properties.getReconnect().setMaxBackoff(java.time.Duration.ofMillis(20));
        when(registryMapper.selectActiveByToolName("echo")).thenReturn(entry());
    }

    private static ToolRegistryEntry entry() {
        ToolRegistryEntry entry = new ToolRegistryEntry();
        entry.setId(11L);
        entry.setServerKey("crm");
        entry.setToolName("echo");
        entry.setFqn(ToolRegistryService.fqnOf("crm", "echo"));
        entry.setSource(ToolRegistryService.SOURCE_HOST_APP);
        entry.setEnabled(true);
        entry.setEndpointUrl(ENDPOINT);
        return entry;
    }

    /** 定制 invoker:客户端工厂由测试给定(每次 build 消耗队列中的一个 mock)。 */
    private RecordingInvoker invoker(ConcurrentLinkedQueue<McpSyncClient> clients) {
        RecordingInvoker recording = new RecordingInvoker(
                registryMapper, actTokenIssuer, new ObjectMapper(), properties, clients);
        this.invoker = recording;
        return recording;
    }

    private static McpSchema.CallToolResult okStructured(Map<String, Object> structured) {
        return McpSchema.CallToolResult.builder()
                .addTextContent("fallback")
                .structuredContent(structured)
                .build();
    }

    // ------------------------------------------------------------------
    // 正常路径与结果载荷
    // ------------------------------------------------------------------

    @Test
    @DisplayName("invoke 全链(单测层):结构化结果转 payloadJson,error 位映射")
    void structuredResultBecomesPayloadJsonAndErrorFlag() throws Exception {
        McpSyncClient client = mock(McpSyncClient.class);
        when(client.callTool(any())).thenReturn(okStructured(new java.util.LinkedHashMap<>(
                Map.of("status", "ok", "nonce", "n-1"))));
        RecordingInvoker recording = invoker(queueOf(client));

        McpToolInvocationResult result =
                recording.invoke(1L, "echo", Map.of("nonce", "n-1"), ACT_CONTEXT);

        assertThat(result.error()).isFalse();
        assertThat(new ObjectMapper().readTree(result.payloadJson()))
                .isEqualTo(new ObjectMapper().readTree("{\"status\":\"ok\",\"nonce\":\"n-1\"}"));
        ArgumentCaptor<McpSchema.CallToolRequest> request = ArgumentCaptor.forClass(
                McpSchema.CallToolRequest.class);
        verify(client).callTool(request.capture());
        assertThat(request.getValue().name()).isEqualTo("echo");
        assertThat(request.getValue().arguments()).containsEntry("nonce", "n-1");
    }

    @Test
    @DisplayName("宿主工具错误(isError)按端口契约返回 error=true,不抛异常")
    void toolErrorMapsToErrorResultWithoutThrowing() {
        McpSyncClient client = mock(McpSyncClient.class);
        when(client.callTool(any())).thenReturn(McpSchema.CallToolResult.builder()
                .addTextContent("boom: 参数不合法")
                .isError(true)
                .build());
        RecordingInvoker recording = invoker(queueOf(client));

        McpToolInvocationResult result = recording.invoke(1L, "echo", Map.of(), ACT_CONTEXT);

        assertThat(result.error()).isTrue();
        assertThat(result.payloadJson()).isEqualTo("{\"text\":\"boom: 参数不合法\"}");
    }

    @Test
    @DisplayName("act token 请求组装:audience=endpoint_url,toolName=FQN")
    void actTokenRequestBindsAudienceToEndpointUrl() {
        McpSyncClient client = mock(McpSyncClient.class);
        when(client.callTool(any())).thenReturn(okStructured(Map.of("status", "ok")));
        RecordingInvoker recording = invoker(queueOf(client));
        recording.invoke(1L, "echo", Map.of(), ACT_CONTEXT);

        ArgumentCaptor<ActTokenIssuer.ActTokenRequest> request =
                ArgumentCaptor.forClass(ActTokenIssuer.ActTokenRequest.class);
        verify(actTokenIssuer).issue(request.capture());
        assertThat(request.getValue().audience()).isEqualTo(ENDPOINT);
        assertThat(request.getValue().userId()).isEqualTo(10001L);
        assertThat(request.getValue().tenantId()).isEqualTo(7L);
        assertThat(request.getValue().toolName()).isEqualTo("mcp__crm__echo");
    }

    // ------------------------------------------------------------------
    // 注册表定位
    // ------------------------------------------------------------------

    @Test
    @DisplayName("工具未注册/端点未配置 → 明确异常,不触发客户端构建")
    void missingEntryOrEndpointFailsFastWithoutClient() {
        RecordingInvoker recording = invoker(queueOf(mock(McpSyncClient.class)));

        assertThatThrownBy(() -> recording.invoke(1L, "missing", Map.of(), ACT_CONTEXT))
                .isInstanceOf(McpToolCallException.class)
                .hasMessageContaining("未注册");
        assertThat(recording.createdClients).isEmpty();

        ToolRegistryEntry noEndpoint = entry();
        noEndpoint.setEndpointUrl(null);
        when(registryMapper.selectActiveByToolName("echo")).thenReturn(noEndpoint);
        assertThatThrownBy(() -> recording.invoke(1L, "echo", Map.of(), ACT_CONTEXT))
                .isInstanceOf(McpToolCallException.class)
                .hasMessageContaining("endpoint_url");
        assertThat(recording.createdClients).isEmpty();
    }

    // ------------------------------------------------------------------
    // 错误细分(spike R5:0.17.0 传输不分型 → 按类型/消息/状态码归一)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("错误细分:401 → McpToolAuthException(不进入重连编排)")
    void host401MapsToAuthExceptionWithoutReconnect() {
        McpSyncClient client = mock(McpSyncClient.class);
        when(client.callTool(any()))
                .thenThrow(new RuntimeException("HTTP 401 Unauthorized; Status code: 401"));
        RecordingInvoker recording = invoker(queueOf(client));

        assertThatThrownBy(() -> recording.invoke(1L, "echo", Map.of(), ACT_CONTEXT))
                .isInstanceOf(McpToolAuthException.class)
                .isNotInstanceOf(McpToolTransportException.class);
        verify(client, times(1)).callTool(any());   // 鉴权失败不重试
        Mockito.verify(client, never()).initialize();
    }

    @Test
    @DisplayName("错误细分:阻塞读超时 → McpToolTimeoutException")
    void blockingTimeoutMapsToTimeoutException() {
        RecordingInvoker recording = invoker(queueOf(mock(McpSyncClient.class)));
        RuntimeException reactorTimeout = new IllegalStateException(
                "Timeout on blocking read for 300 MILLISECONDS");

        McpToolCallException mapped = recording.mapFailure(reactorTimeout);

        assertThat(mapped).isInstanceOf(McpToolTimeoutException.class);
        assertThat(mapped.getMessage()).contains("超时");
    }

    @Test
    @DisplayName("错误细分:会话失效/连接拒绝 → McpToolTransportException(重连触发信号)")
    void sessionTerminatedAndConnectionRefusedMapToTransportException() {
        RecordingInvoker recording = invoker(queueOf(mock(McpSyncClient.class)));

        assertThat(recording.mapFailure(
                new RuntimeException("MCP session with server terminated")))
                .isInstanceOf(McpToolTransportException.class);
        assertThat(recording.mapFailure(new McpTransportSessionNotFoundException("Session not found")))
                .isInstanceOf(McpToolTransportException.class);
        assertThat(recording.mapFailure(new RuntimeException(
                new java.net.ConnectException("Connection refused"))))
                .isInstanceOf(McpToolTransportException.class);
    }

    @Test
    @DisplayName("错误细分:未知异常 → 基类;已有细分异常原样透传")
    void unknownMapsToBaseAndKnownPassThrough() {
        RecordingInvoker recording = invoker(queueOf(mock(McpSyncClient.class)));

        assertThat(recording.mapFailure(new RuntimeException("weird")))
                .isExactlyInstanceOf(McpToolCallException.class);
        McpToolTimeoutException known = new McpToolTimeoutException("t");
        assertThat(recording.mapFailure(known)).isSameAs(known);
    }

    // ------------------------------------------------------------------
    // 重连编排(R1)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("R1:会话失效 → 同实例 re-initialize → 重试成功;无重建")
    void sessionLossRecoversViaReInitializeAndSingleRetry() {
        McpSyncClient client = mock(McpSyncClient.class);
        AtomicBoolean recovered = new AtomicBoolean(false);
        when(client.callTool(any())).thenAnswer(invocation -> {
            if (recovered.get()) {
                return okStructured(Map.of("status", "ok", "attempt", "after-recovery"));
            }
            throw new RuntimeException("MCP session with server terminated");
        });
        doAnswer(invocation -> {
            recovered.set(true);
            return Mockito.mock(McpSchema.InitializeResult.class);
        }).when(client).initialize();
        RecordingInvoker recording = invoker(queueOf(client));

        McpToolInvocationResult result = recording.invoke(1L, "echo", Map.of(), ACT_CONTEXT);

        assertThat(result.error()).isFalse();
        assertThat(result.payloadJson()).contains("after-recovery");
        verify(client, times(2)).callTool(any());     // 失败一次 + 重试一次(任务规格:重试一次)
        verify(client, times(1)).initialize();        // 同实例 re-initialize
        assertThat(recording.createdClients).hasSize(1); // 无重建
    }

    @Test
    @DisplayName("R1:重连耗尽(max-attempts=1 后重试仍失败)→ McpToolTransportException")
    void exhaustedReconnectAttemptsThrowTransportException() {
        McpSyncClient client = mock(McpSyncClient.class);
        when(client.callTool(any()))
                .thenThrow(new RuntimeException("MCP session with server terminated"));
        RecordingInvoker recording = invoker(queueOf(client));

        assertThatThrownBy(() -> recording.invoke(1L, "echo", Map.of(), ACT_CONTEXT))
                .isInstanceOf(McpToolTransportException.class);
        verify(client, times(2)).callTool(any());     // 首次 + 重试一次
        verify(client, times(1)).initialize();
        assertThat(recording.createdClients).hasSize(1);
    }

    @Test
    @DisplayName("R1 单飞:并发会话失效只执行一次 re-initialize,其余并发方直接重试")
    void concurrentSessionLossReinitializesOnce() throws Exception {
        McpSyncClient client = mock(McpSyncClient.class);
        AtomicBoolean recovered = new AtomicBoolean(false);
        when(client.callTool(any())).thenAnswer(invocation -> {
            if (recovered.get()) {
                return okStructured(Map.of("status", "ok"));
            }
            throw new RuntimeException("MCP session with server terminated");
        });
        doAnswer(invocation -> {
            Thread.sleep(50); // 单飞窗口:其余失败方应在此等待而非重复 re-init
            recovered.set(true);
            return Mockito.mock(McpSchema.InitializeResult.class);
        }).when(client).initialize();
        RecordingInvoker recording = invoker(queueOf(client));

        int callers = 6;
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<McpToolInvocationResult>> futures = new java.util.ArrayList<>();
            for (int i = 0; i < callers; i++) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return recording.invoke(1L, "echo", Map.of("caller", Thread.currentThread().getName()),
                            ACT_CONTEXT);
                }));
            }
            start.countDown();
            for (Future<McpToolInvocationResult> future : futures) {
                assertThat(future.get(10, TimeUnit.SECONDS).error()).isFalse();
            }
        } finally {
            pool.shutdownNow();
        }
        verify(client, atLeastOnce()).callTool(any());
        assertThat(recording.createdClients).hasSize(1);
        // 单飞断言:6 个并发失败方,re-initialize 只允许执行一次
        verify(client, times(1)).initialize();
    }

    @Test
    @DisplayName("指数退避:initial × 2^(attempt-1),封顶 max-backoff")
    void backoffGrowsExponentiallyAndCaps() {
        RecordingInvoker recording = invoker(queueOf(mock(McpSyncClient.class)));
        properties.getReconnect().setInitialBackoff(java.time.Duration.ofMillis(100));
        properties.getReconnect().setMaxBackoff(java.time.Duration.ofMillis(350));

        assertThat(recording.backoff(1)).hasMillis(100);
        assertThat(recording.backoff(2)).hasMillis(200);
        assertThat(recording.backoff(3)).hasMillis(350); // 400 封顶到 350
        assertThat(recording.backoff(9)).hasMillis(350);
    }

    // ------------------------------------------------------------------
    // 缓存失效(注册变更挂钩)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("invalidateApp 关闭并清除客户端;下次调用重建(注册变更失效链路)")
    void invalidateAppClosesAndRebuilds() {
        McpSyncClient clientA = mock(McpSyncClient.class);
        McpSyncClient clientB = mock(McpSyncClient.class);
        when(clientA.callTool(any())).thenReturn(okStructured(Map.of("status", "ok")));
        when(clientB.callTool(any())).thenReturn(okStructured(Map.of("status", "ok")));
        RecordingInvoker recording = invoker(queueOf(clientA, clientB));

        recording.invoke(1L, "echo", Map.of(), ACT_CONTEXT);
        assertThat(recording.createdClients).hasSize(1);

        recording.invalidateApp(1L);
        verify(clientA).close();

        recording.invoke(1L, "echo", Map.of(), ACT_CONTEXT);
        assertThat(recording.createdClients).hasSize(2);
        verify(clientB, times(1)).callTool(any());
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private static ConcurrentLinkedQueue<McpSyncClient> queueOf(McpSyncClient... clients) {
        return new ConcurrentLinkedQueue<>(List.of(clients));
    }
}
