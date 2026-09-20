package com.inneragent.integration;

import com.inneragent.integration.support.AgentRuntimeContainers;
import com.inneragent.platform.webhook.WebhookDelivery;
import com.inneragent.platform.mapper.WebhookDeliveryMapper;
import com.inneragent.platform.webhook.WebhookDeliveryService;
import com.inneragent.platform.webhook.WebhookSigner;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * 终态 Webhook 投递集成测试(任务 #18b;真实 PostgreSQL + 本地 HTTP 接收端):
 * 入队→投递→签名可验→失败退避→EXHAUSTED→手动重投,以及多实例并发领取不重投。
 * 由 maven-failsafe-plugin 执行(类名 *IT 结尾)。
 */
@SpringBootTest
@Testcontainers
class WebhookDeliveryRetryIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = AgentRuntimeContainers.postgres();

    @Container
    static final GenericContainer<?> REDIS = AgentRuntimeContainers.redis();

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry properties) {
        AgentRuntimeContainers.registerSpringProperties(properties, POSTGRES, REDIS);
        // 退避收紧为 50ms,便于在测试时限内走完「失败→重试→耗尽」链
        properties.add("inneragent.webhook.retry-backoffs[0]", () -> "PT0.05S");
        properties.add("inneragent.webhook.retry-backoffs[1]", () -> "PT0.05S");
        properties.add("inneragent.webhook.retry-backoffs[2]", () -> "PT0.05S");
        properties.add("inneragent.webhook.retry-backoffs[3]", () -> "PT0.05S");
        properties.add("inneragent.webhook.retry-backoffs[4]", () -> "PT0.05S");
    }

    @Autowired
    private WebhookDeliveryService deliveryService;

    @Autowired
    private WebhookDeliveryMapper deliveryMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private HttpServer receiver;
    /** 接收端行为:返回状态码队列(空队尾持续 200) */
    private final java.util.concurrent.ConcurrentLinkedQueue<Integer> respondWith =
            new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<Received> received = new ConcurrentLinkedQueue<>();
    private final AtomicInteger receivedCount = new AtomicInteger();
    private int receiverPort;
    private static final String SECRET = "it-webhook-secret";

    /** 接收端捕获的请求投影 */
    record Received(String signature, String timestamp, String nonce, String body) {
    }

    @BeforeEach
    void startReceiver() throws IOException {
        respondWith.clear();
        received.clear();
        receivedCount.set(0);
        receiver = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        receiver.createContext("/hook", exchange -> {
            byte[] body;
            try (InputStream in = exchange.getRequestBody()) {
                body = in.readAllBytes();
            }
            received.add(new Received(
                    exchange.getRequestHeaders().getFirst("X-IA-Signature"),
                    exchange.getRequestHeaders().getFirst("X-IA-Timestamp"),
                    exchange.getRequestHeaders().getFirst("X-IA-Nonce"),
                    new String(body, StandardCharsets.UTF_8)));
            receivedCount.incrementAndGet();
            int status = respondWith.isEmpty() ? 200 : respondWith.poll();
            byte[] response = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        receiver.start();
        receiverPort = receiver.getAddress().getPort();
    }

    @AfterEach
    void stopReceiver() {
        receiver.stop(0);
    }

    private String receiverUrl() {
        return "http://127.0.0.1:" + receiverPort + "/hook";
    }

    /** 每个测试独立建应用:用例间存量投递行互不干扰(跨用例隔离)。 */
    private long newApp(String url, String secret) {
        String appKey = "it-wh-" + UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO ia_app (app_key, name, webhook_url, webhook_secret, status) "
                        + "VALUES (?, ?, ?, ?, 1)",
                appKey, "IT Webhook App", url, secret);
        return jdbcTemplate.queryForObject(
                "SELECT id FROM ia_app WHERE app_key = ?", Long.class, appKey);
    }

    private void configureAppWebhook(long appId, String url, String secret) {
        jdbcTemplate.update(
                "UPDATE ia_app SET webhook_url = ?, webhook_secret = ? WHERE id = ?",
                url, secret, appId);
    }

    private WebhookDeliveryService.TerminalEvent terminalEvent(long appId, String runId) {
        return WebhookDeliveryService.TerminalEvent.of(
                appId, WebhookDeliveryService.EVENT_RUN_FINISHED, runId, "DONE");
    }

    private List<WebhookDelivery> deliveriesFor(String runId) {
        return deliveryMapper.selectList(
                new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<WebhookDelivery>()
                        .eq(WebhookDelivery::getRunId, runId));
    }

    /** 本行请求(按 runId 过滤;隔离接收端可能收到的历史用例遗留重试)。 */
    private List<Received> requestsFor(String runId) {
        return received.stream()
                .filter(request -> request.body().contains(runId))
                .collect(java.util.stream.Collectors.toList());
    }

    @Test
    @DisplayName("投递成功:签名可由 secret 复算,载荷与终态事件一致,行落 SUCCESS")
    void deliversSignedPayloadAndMarksSuccess() {
        long appId = newApp(receiverUrl(), SECRET);
        String runId = "it-wh-" + UUID.randomUUID();
        deliveryService.onRunTerminal(terminalEvent(appId, runId));

        List<WebhookDelivery> rows = deliveriesFor(runId);
        assertThat(rows).hasSize(1);
        await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(deliveryMapper.selectById(rows.getFirst().getId())
                        .getStatus()).isEqualTo(WebhookDelivery.STATUS_SUCCESS));

        List<Received> requests = requestsFor(runId);
        assertThat(requests).hasSize(1);
        Received request = requests.getFirst();
        assertThat(request.body()).contains("\"event\":\"run.finished\"").contains(runId);
        // 宿主侧验签语义:ts + nonce + body 以共享密钥复算
        assertThat(WebhookSigner.verify(
                SECRET, request.timestamp(), request.nonce(), request.body(),
                request.signature())).isTrue();
    }

    @Test
    @DisplayName("失败退避到耗尽:每次尝试重签,达上限落 EXHAUSTED;手动重投可复活")
    void retriesWithBackoffThenExhaustedThenRedeliver() {
        long appId = newApp(receiverUrl(), SECRET);
        String runId = "it-wh-exh-" + UUID.randomUUID();
        deliveryService.onRunTerminal(terminalEvent(appId, runId));
        WebhookDelivery row = deliveriesFor(runId).getFirst();

        // 首 4 次尝试返回 500,第 5 次成功(max_attempts 默认 5)
        respondWith.addAll(List.of(500, 500, 500, 500));
        deliveryService.deliverDueBatch("it-instance-a");
        await().atMost(java.time.Duration.ofSeconds(5)).until(() ->
                deliveryMapper.selectById(row.getId()).getStatus()
                        .equals(WebhookDelivery.STATUS_FAILED));
        for (int i = 0; i < 4; i++) {
            final int attemptFloor = i + 2;
            await().atMost(java.time.Duration.ofSeconds(5)).until(() -> {
                deliveryService.deliverDueBatch("it-instance-a");
                return requestsFor(runId).size() >= attemptFloor;
            });
        }
        await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(deliveryMapper.selectById(row.getId())
                        .getStatus()).isEqualTo(WebhookDelivery.STATUS_SUCCESS));
        assertThat(requestsFor(runId)).hasSize(5);
        // 每次尝试签名均 fresh 可验(时间戳/nonce 不复用)
        assertThat(requestsFor(runId)).allSatisfy(request ->
                assertThat(WebhookSigner.verify(
                        SECRET, request.timestamp(), request.nonce(), request.body(),
                        request.signature())).isTrue());
    }

    @Test
    @DisplayName("全失败耗尽:5 次尝试后 EXHAUSTED 可查;redeliver 重置回 PENDING")
    void exhaustsAfterMaxAttemptsAndRedeliverResets() {
        long appId = newApp(receiverUrl(), SECRET);
        String runId = "it-wh-redeliver-" + UUID.randomUUID();
        deliveryService.onRunTerminal(terminalEvent(appId, runId));
        WebhookDelivery row = deliveriesFor(runId).getFirst();
        respondWith.addAll(List.of(500, 500, 500, 500, 500));

        // 5 次尝试全部失败(退避 50ms):先投 1 次,随后 4 轮等退避到期再投
        deliveryService.deliverDueBatch("it-instance-a");
        for (int i = 0; i < 4; i++) {
            final int attemptFloor = i + 2;
            await().atMost(java.time.Duration.ofSeconds(5)).until(() -> {
                deliveryService.deliverDueBatch("it-instance-a");
                return deliveryMapper.selectById(row.getId()).getAttemptCount() >= attemptFloor;
            });
        }
        await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() -> {
            WebhookDelivery current = deliveryMapper.selectById(row.getId());
            assertThat(current.getStatus()).isEqualTo(WebhookDelivery.STATUS_EXHAUSTED);
            assertThat(current.getAttemptCount()).isEqualTo(5);
            assertThat(current.getLastHttpStatus()).isEqualTo(500);
        });
        int before = requestsFor(runId).size();

        // 手动重投 → PENDING → 接收端已恢复 200 → SUCCESS
        assertThat(deliveryService.redeliver(row.getId())).isTrue();
        deliveryService.deliverDueBatch("it-instance-a");
        await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(deliveryMapper.selectById(row.getId())
                        .getStatus()).isEqualTo(WebhookDelivery.STATUS_SUCCESS));
        assertThat(requestsFor(runId)).hasSize(before + 1);
    }

    @Test
    @DisplayName("并发不重投:两个实例同时领取同一条到期投递,接收端只收到一次")
    void concurrentInstancesDoNotDoubleDeliver() {
        long appId = newApp(receiverUrl(), SECRET);
        String runId = "it-wh-race-" + UUID.randomUUID();
        deliveryService.onRunTerminal(terminalEvent(appId, runId));
        WebhookDelivery row = deliveriesFor(runId).getFirst();

        Thread first = new Thread(() -> deliveryService.deliverDueBatch("it-instance-a"));
        Thread second = new Thread(() -> deliveryService.deliverDueBatch("it-instance-b"));
        first.start();
        second.start();
        try {
            first.join(10_000);
            second.join(10_000);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }

        await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(deliveryMapper.selectById(row.getId())
                        .getStatus()).isEqualTo(WebhookDelivery.STATUS_SUCCESS));
        assertThat(requestsFor(runId)).hasSize(1);
    }

    @Test
    @DisplayName("未配置回调的应用:终态事件不产生投递记录")
    void skipsAppsWhereWebhookNotConfigured() {
        long appId = newApp("", "");
        String runId = "it-wh-skip-" + UUID.randomUUID();
        deliveryService.onRunTerminal(terminalEvent(appId, runId));

        assertThat(deliveriesFor(runId)).isEmpty();
        assertThat(receivedCount.get()).isZero();
    }

    @Test
    @DisplayName("回调配置被移除:待重试行落 EXHAUSTED,不再外呼")
    void removedConfigExhaustsWithoutHttpCall() {
        long appId = newApp(receiverUrl(), SECRET);
        String runId = "it-wh-removed-" + UUID.randomUUID();
        deliveryService.onRunTerminal(terminalEvent(appId, runId));
        WebhookDelivery row = deliveriesFor(runId).getFirst();
        // 先制造一条 FAILED 待重试行
        respondWith.add(500);
        deliveryService.deliverDueBatch("it-instance-a");
        await().atMost(java.time.Duration.ofSeconds(5)).until(() ->
                deliveryMapper.selectById(row.getId()).getStatus()
                        .equals(WebhookDelivery.STATUS_FAILED));

        configureAppWebhook(appId, "", "");
        int before = requestsFor(runId).size();
        deliveryService.deliverDueBatch("it-instance-a");
        await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(deliveryMapper.selectById(row.getId())
                        .getStatus()).isEqualTo(WebhookDelivery.STATUS_EXHAUSTED));
        assertThat(requestsFor(runId)).hasSize(before);
    }

}
