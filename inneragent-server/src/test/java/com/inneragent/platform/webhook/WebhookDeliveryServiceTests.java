package com.inneragent.platform.webhook;

import com.inneragent.platform.mapper.WebhookDeliveryMapper;
import com.inneragent.platform.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpHeaders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.CallbackPreferringPlatformTransactionManager;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Webhook 投递状态机单元测试(任务 #18b):入队、成功/失败/退避/耗尽、
 * 签名头、租约丢失容忍、手动重投。全 Mockito,无数据库。
 */
class WebhookDeliveryServiceTests {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 9, 20, 12, 0, 0);
    /** claim 令牌 = 实例身份 + ":" + 随机串;断言只钉实例前缀。 */
    private static final String CLAIM = "instance-1";
    private static final String URL = "https://host.example/hook";
    private static final String SECRET = "secret-1";
    private static final String BODY = "{\"event\":\"run.finished\",\"runId\":\"run-1\"}";

    private WebhookDeliveryMapper mapper;
    private WebhookDeliveryService service;
    private WebhookDeliveryService.WebhookHttpSender sender;

    @BeforeEach
    void setUp() {
        mapper = mock(WebhookDeliveryMapper.class);
        sender = mock(WebhookDeliveryService.WebhookHttpSender.class);
        service = new WebhookDeliveryService(
                mapper, new WebhookDeliveryProperties(), passthroughTransactionManager());
        service.setSender(sender);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    @Test
    @DisplayName("入队:应用已配置回调时插 PENDING 行,载荷含事件/运行/终态")
    void enqueueInsertsPendingDeliveryWhenConfigured() {
        stubConfig(7L, SECRET);
        when(mapper.selectDatabaseNow()).thenReturn(NOW);

        service.onRunTerminal(WebhookDeliveryService.TerminalEvent.of(
                7L, WebhookDeliveryService.EVENT_RUN_FINISHED, "run-1", "DONE"));

        ArgumentCaptor<WebhookDelivery> captor =
                ArgumentCaptor.forClass(WebhookDelivery.class);
        verify(mapper).insert(captor.capture());
        WebhookDelivery inserted = captor.getValue();
        assertThat(inserted.getAppId()).isEqualTo(7L);
        assertThat(inserted.getEventType()).isEqualTo("run.finished");
        assertThat(inserted.getRunId()).isEqualTo("run-1");
        assertThat(inserted.getStatus()).isEqualTo(WebhookDelivery.STATUS_PENDING);
        assertThat(inserted.getMaxAttempts()).isEqualTo(5);
        assertThat(inserted.getPayloadJson())
                .contains("\"event\":\"run.finished\"")
                .contains("\"runId\":\"run-1\"")
                .contains("\"status\":\"DONE\"");
    }

    @Test
    @DisplayName("入队:未配置回调/异常时静默跳过,不阻断终态")
    void enqueueSkipsWhenNotConfiguredOrFailing() {
        when(mapper.selectWebhookConfig(7L))
                .thenReturn(new WebhookDeliveryMapper.WebhookConfigRow("", ""));
        service.onRunTerminal(WebhookDeliveryService.TerminalEvent.of(
                7L, WebhookDeliveryService.EVENT_RUN_FAILED, "run-2", "ERROR"));
        verify(mapper, never()).insert(any(WebhookDelivery.class));

        when(mapper.selectWebhookConfig(8L)).thenThrow(new IllegalStateException("db down"));
        assertThatCode(() -> service.onRunTerminal(WebhookDeliveryService.TerminalEvent.of(
                        8L, WebhookDeliveryService.EVENT_RUN_CANCELLED, "run-3", "CANCELLED")))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("订阅配置(V14):总开关关闭或事件未订阅 → 不入队;订阅内事件照常")
    void enqueueRespectsSubscriptionConfig() {
        // 总开关关闭:不入队
        when(mapper.selectWebhookConfig(7L)).thenReturn(new WebhookDeliveryMapper.WebhookConfigRow(
                URL, SECRET, false, "run.finished,run.failed,run.cancelled"));
        service.onRunTerminal(WebhookDeliveryService.TerminalEvent.of(
                7L, WebhookDeliveryService.EVENT_RUN_FINISHED, "run-1", "DONE"));
        verify(mapper, never()).insert(any(WebhookDelivery.class));

        // 已订阅事件:入队
        when(mapper.selectWebhookConfig(7L)).thenReturn(new WebhookDeliveryMapper.WebhookConfigRow(
                URL, SECRET, true, "run.finished"));
        when(mapper.selectDatabaseNow()).thenReturn(NOW);
        service.onRunTerminal(WebhookDeliveryService.TerminalEvent.of(
                7L, WebhookDeliveryService.EVENT_RUN_FINISHED, "run-1", "DONE"));
        verify(mapper).insert(any(WebhookDelivery.class));

        // 未订阅事件:不入队
        org.mockito.Mockito.clearInvocations(mapper);
        service.onRunTerminal(WebhookDeliveryService.TerminalEvent.of(
                7L, WebhookDeliveryService.EVENT_RUN_CANCELLED, "run-2", "CANCELLED"));
        verify(mapper, never()).insert(any(WebhookDelivery.class));

        // events 为空(NULL/空白,V14 前形态)= 不过滤,全部放行
        when(mapper.selectWebhookConfig(7L)).thenReturn(
                new WebhookDeliveryMapper.WebhookConfigRow(URL, SECRET));
        service.onRunTerminal(WebhookDeliveryService.TerminalEvent.of(
                7L, WebhookDeliveryService.EVENT_RUN_CANCELLED, "run-3", "CANCELLED"));
        verify(mapper).insert(any(WebhookDelivery.class));
    }

    @Test
    @DisplayName("首投成功:markSuccess 落 SUCCESS,签名/URL/状态码持久化")
    void firstAttemptSuccessMarksSuccess() {
        stubScan(claimedDelivery(1, 5));
        stubConfig(7L, SECRET);
        when(sender.send(anyString(), any(HttpHeaders.class), anyString()))
                .thenReturn(new WebhookDeliveryService.WebhookHttpSender.Result(200, "ok"));

        assertThat(service.deliverDueBatch("instance-1")).isEqualTo(1);

        verify(mapper).markSuccess(
                eq(1L), startsWith(CLAIM), org.mockito.ArgumentMatchers.argThat(signatureHex()),
                eq(URL), eq(200), any(LocalDateTime.class));
        verify(mapper, never()).markFailedRetry(anyLong(), anyString(), any(), any(),
                any(), any(), any(), any());
        verify(mapper, never()).markExhausted(anyLong(), anyString(), any(), any(),
                any(), any(), any());
    }

    @Test
    @DisplayName("首投失败:退避 1m;第 n 次失败按 1m/5m/30m/2h/12h 递增")
    void failureSchedulesBackoff() {
        stubScan(claimedDelivery(1, 5));
        stubConfig(7L, SECRET);
        when(sender.send(anyString(), any(HttpHeaders.class), anyString()))
                .thenReturn(new WebhookDeliveryService.WebhookHttpSender.Result(500, "boom"));

        service.deliverDueBatch("instance-1");

        verify(mapper).markFailedRetry(
                eq(1L), startsWith(CLAIM), any(), eq(URL), eq(500), eq("boom"),
                eq(NOW.plus(Duration.ofMinutes(1))), any(LocalDateTime.class));
    }

    @Test
    @DisplayName("达到上限:markExhausted 落 EXHAUSTED,不再排期")
    void exhaustedWhenAttemptsExhausted() {
        stubScan(claimedDelivery(1, 5, 4));
        stubConfig(7L, SECRET);
        when(sender.send(anyString(), any(HttpHeaders.class), anyString()))
                .thenReturn(new WebhookDeliveryService.WebhookHttpSender.Result(503, ""));

        service.deliverDueBatch("instance-1");

        verify(mapper).markExhausted(
                eq(1L), startsWith(CLAIM), any(), eq(URL), eq(503), any(),
                any(LocalDateTime.class));
        verify(mapper, never()).markFailedRetry(anyLong(), anyString(), any(), any(),
                any(), any(), any(), any());
    }

    @Test
    @DisplayName("传输异常:HTTP 状态码为 NULL 的失败退避(第 2 次失败退 5m)")
    void transportFailureBackoffsWithoutHttpStatus() {
        stubScan(claimedDelivery(1, 5, 1));
        stubConfig(7L, SECRET);
        when(sender.send(anyString(), any(HttpHeaders.class), anyString()))
                .thenThrow(new IllegalStateException("connect timed out"));

        service.deliverDueBatch("instance-1");

        verify(mapper).markFailedRetry(
                eq(1L), startsWith(CLAIM), any(), eq(URL), isNull(),
                contains("IllegalStateException"),
                eq(NOW.plus(Duration.ofMinutes(5))), any(LocalDateTime.class));
    }

    @Test
    @DisplayName("签名头:四头齐备且 X-IA-Signature 可由 secret+ts+nonce+body 复算")
    void sendsVerifiableSignatureHeaders() {
        stubScan(claimedDelivery(1, 5));
        stubConfig(7L, SECRET);
        AtomicReference<String> sentBody = new AtomicReference<>();
        when(sender.send(anyString(), any(HttpHeaders.class), anyString()))
                .thenAnswer(invocation -> {
                    sentBody.set(invocation.getArgument(2));
                    return new WebhookDeliveryService.WebhookHttpSender.Result(204, null);
                });

        service.deliverDueBatch("instance-1");

        ArgumentCaptor<HttpHeaders> headers = ArgumentCaptor.forClass(HttpHeaders.class);
        verify(sender, times(1)).send(eq(URL), headers.capture(), eq(BODY));
        HttpHeaders sent = headers.getValue();
        String signature = sent.getFirst("X-IA-Signature");
        assertThat(sent.getFirst("X-IA-Delivery")).isEqualTo("1");
        assertThat(sent.getFirst("X-IA-Timestamp")).matches("\\d+");
        assertThat(sent.getFirst("X-IA-Nonce")).isNotBlank();
        assertThat(signature).matches("[0-9a-f]{64}");
        assertThat(WebhookSigner.verify(
                SECRET,
                sent.getFirst("X-IA-Timestamp"),
                sent.getFirst("X-IA-Nonce"),
                sentBody.get(),
                signature)).isTrue();
    }

    @Test
    @DisplayName("租约丢失:守卫 UPDATE 返回 0 时不抛异常,批内继续")
    void claimLostIsTolerated() {
        stubScan(claimedDelivery(1, 5));
        stubConfig(7L, SECRET);
        when(sender.send(anyString(), any(HttpHeaders.class), anyString()))
                .thenReturn(new WebhookDeliveryService.WebhookHttpSender.Result(200, "ok"));
        when(mapper.markSuccess(anyLong(), anyString(), any(), any(), anyInt(), any()))
                .thenReturn(0);

        assertThatCode(() -> service.deliverDueBatch("instance-1"))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("回调配置被移除:不再外呼,直接落 EXHAUSTED 可查")
    void removedConfigExhaustsInPlace() {
        stubScan(claimedDelivery(1, 5));
        when(mapper.selectWebhookConfig(7L))
                .thenReturn(new WebhookDeliveryMapper.WebhookConfigRow("", ""));

        service.deliverDueBatch("instance-1");

        verify(sender, never()).send(anyString(), any(HttpHeaders.class), anyString());
        verify(mapper).markExhausted(
                eq(1L), startsWith(CLAIM), isNull(), any(), isNull(),
                contains("webhook config removed"), any(LocalDateTime.class));
    }

    @Test
    @DisplayName("手动重投:redeliver 走 resetForRedeliver")
    void redeliverResetsRow() {
        when(mapper.selectById(9L)).thenReturn(new WebhookDelivery());
        when(mapper.selectDatabaseNow()).thenReturn(NOW);
        when(mapper.resetForRedeliver(eq(9L), any(LocalDateTime.class))).thenReturn(1);

        assertThat(service.redeliver(9L)).isTrue();
        verify(mapper).resetForRedeliver(eq(9L), any(LocalDateTime.class));
    }

    @Test
    @DisplayName("退避档位:默认 1m/5m/30m/2h/12h,越界取最后一档")
    void backoffTiersFollowConfiguration() {
        WebhookDeliveryProperties properties = new WebhookDeliveryProperties();
        assertThat(properties.backoffAfter(1)).isEqualTo(Duration.ofMinutes(1));
        assertThat(properties.backoffAfter(2)).isEqualTo(Duration.ofMinutes(5));
        assertThat(properties.backoffAfter(3)).isEqualTo(Duration.ofMinutes(30));
        assertThat(properties.backoffAfter(4)).isEqualTo(Duration.ofHours(2));
        assertThat(properties.backoffAfter(5)).isEqualTo(Duration.ofHours(12));
        assertThat(properties.backoffAfter(99)).isEqualTo(Duration.ofHours(12));
    }

    private void stubScan(WebhookDelivery... candidates) {
        when(mapper.selectDatabaseNow()).thenReturn(NOW);
        when(mapper.selectDueCandidatesForUpdate(any(LocalDateTime.class), anyInt()))
                .thenReturn(List.of(candidates));
        when(mapper.selectExpiredClaimsForUpdate(any(LocalDateTime.class), anyInt()))
                .thenReturn(List.of());
        when(mapper.claimDelivery(anyLong(), anyString(), any(LocalDateTime.class),
                any(LocalDateTime.class))).thenReturn(1);
    }

    private void stubConfig(long appId, String secret) {
        when(mapper.selectWebhookConfig(appId))
                .thenReturn(new WebhookDeliveryMapper.WebhookConfigRow(URL, secret));
    }

    private static WebhookDelivery claimedDelivery(long id, int maxAttempts) {
        return claimedDelivery(id, maxAttempts, 0);
    }

    /** priorAttempts = 领取前 DB 行上的 attempt_count(领取后 +1)。 */
    private static WebhookDelivery claimedDelivery(
            long id, int maxAttempts, int priorAttempts) {
        WebhookDelivery delivery = new WebhookDelivery();
        delivery.setId(id);
        delivery.setAppId(7L);
        delivery.setEventType(WebhookDeliveryService.EVENT_RUN_FINISHED);
        delivery.setRunId("run-1");
        delivery.setUrl(URL);
        delivery.setPayloadJson(BODY);
        delivery.setStatus(WebhookDelivery.STATUS_PENDING);
        delivery.setAttemptCount(priorAttempts);
        delivery.setMaxAttempts(maxAttempts);
        return delivery;
    }

    private static org.mockito.ArgumentMatcher<String> signatureHex() {
        return value -> value != null && value.matches("[0-9a-f]{64}");
    }

    /**
     * 直通事务管理器:CallbackPreferringPlatformTransactionManager 令
     * TransactionTemplate.execute 原地执行回调,无真实 DB 事务。
     */
    private PlatformTransactionManager passthroughTransactionManager() {
        return new CallbackPreferringPlatformTransactionManager() {
            @Override
            public <T> T execute(
                    TransactionDefinition definition, TransactionCallback<T> callback) {
                return callback.doInTransaction(new SimpleTransactionStatus());
            }

            @Override
            public TransactionStatus getTransaction(TransactionDefinition definition) {
                return new SimpleTransactionStatus();
            }

            @Override
            public void commit(TransactionStatus status) {
            }

            @Override
            public void rollback(TransactionStatus status) {
            }
        };
    }
}
