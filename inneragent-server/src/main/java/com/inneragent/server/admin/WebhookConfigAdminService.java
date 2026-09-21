package com.inneragent.server.admin;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.webhook.WebhookSigner;
import com.inneragent.server.admin.mapper.AppRegistrationMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Webhook 订阅配置 admin 服务(优化建议 #2 服务端半;mock 契约
 * handlers.ts webhookHandlers 为产品契约锚点)。配置本体存 ia_app 行:
 * webhook_url/webhook_secret(V2 已有)+ webhook_enabled/webhook_events
 * (V14 新增),secret 沿用 <strong>write-only 铁律</strong>(P2-key:空/缺省
 * = 不修改;响应只回掩码,口径同 AdminModelConfigService#maskSecret)。
 *
 * <p>enabled/events 由 WebhookDeliveryService 在终态事件入队时消费
 * (FALSE 不入队 / 未订阅事件不入队;已入队存量投递继续走既有重试,
 * 「停用 = 不再新增」,不做 destructive 清队)。run.resource-limit 为 web
 * 契约预留值域,服务端终态事件集当前为 run.finished/failed/cancelled
 * (02-技术方案 §7.1),可订阅但不会产生投递。
 *
 * <p>[R4-obs 修复] 保存路径为定向 UPDATE(LambdaUpdateWrapper 显式 SET):
 * url 传空串即库层清空(整行 updateById 会因 MP NOT_NULL 字段策略跳过
 * null 列,清空语义静默失效——OBS-R4-1,与 b04b4fa resume 清空同族)。
 */
@Service
@Slf4j
public class WebhookConfigAdminService {

    /** web 契约 WebhookEvent 全集(订阅值域;超集校验) */
    private static final Set<String> SUBSCRIBABLE_EVENTS = Set.of(
            "run.finished", "run.failed", "run.cancelled", "run.resource-limit");

    private static final int MAX_TEST_ERROR_LENGTH = 200;

    private final AppRegistrationMapper appMapper;
    private final Duration httpTimeout;
    private volatile WebhookHttpSender sender;

    public WebhookConfigAdminService(
            AppRegistrationMapper appMapper,
            com.inneragent.platform.webhook.WebhookDeliveryProperties properties) {
        this.appMapper = Objects.requireNonNull(appMapper, "appMapper must not be null");
        this.httpTimeout = properties.getHttpTimeout() == null
                ? Duration.ofSeconds(10)
                : properties.getHttpTimeout();
        this.sender = new RestClientWebhookHttpSender(this.httpTimeout);
    }

    // ------------------------------------------------------------------
    // GET /admin/webhooks/config
    // ------------------------------------------------------------------

    public ConfigView get(long appId) {
        return toView(appId, requireApp(appId));
    }

    // ------------------------------------------------------------------
    // PUT /admin/webhooks/config(body {url, secret?, enabled?, events?})
    // ------------------------------------------------------------------

    /**
     * 保存配置(OBS-R4-1 修复):传了什么 SET 什么——<strong>定向 UPDATE</strong>
     * ({@code LambdaUpdateWrapper} 显式 SET 列),不再整行 {@code updateById}。
     *
     * <p>根因:整行更新走 MP 缺省字段策略(NOT_NULL),实体置 null 的列被
     * 从 SET 子句剔除——{@code url:""} 清空语义在库层静默失效(响应称已清,
     * GET 回读旧值;与 b04b4fa 修复的 resume 清空缺陷同族)。现 url 传空串
     * 即显式 {@code SET webhook_url = NULL};未传(url=null)不动该列。
     *
     * <p>secret 维持 <strong>write-only 铁律</strong>:空/缺省 = 不修改,
     * 非空 = 重置——不提供「清空」语义(误触代价高于收益,轮换即重置),
     * 与 AdminModelConfigService 的密钥 write-only 口径一致。缺省字段
     * (enabled/events)不修改;update_time 因无实体填充需显式 SET。
     */
    public ConfigView save(long appId, SaveReq request) {
        if (request == null) {
            throw new BusinessException(400, "请求体不能为空");
        }
        requireApp(appId);
        LambdaUpdateWrapper<AppRegistration> update =
                new LambdaUpdateWrapper<AppRegistration>().eq(AppRegistration::getId, appId);
        boolean hasChange = false;
        if (request.url() != null) {
            String url = request.url().trim();
            // 空串 = 显式清空(SET NULL);非空 = 落 trimmed 值
            update.set(AppRegistration::getWebhookUrl, url.isEmpty() ? null : url);
            hasChange = true;
        }
        // write-only:空/缺省 = 不修改;非空 = 重置(与 apps 域 webhookSecret 同款)
        if (request.secret() != null && !request.secret().isBlank()) {
            update.set(AppRegistration::getWebhookSecret, request.secret().trim());
            hasChange = true;
        }
        if (request.enabled() != null) {
            update.set(AppRegistration::getWebhookEnabled, request.enabled());
            hasChange = true;
        }
        if (request.events() != null) {
            update.set(AppRegistration::getWebhookEvents, normalizeEvents(request.events()));
            hasChange = true;
        }
        // 无实体参与(MetaHandler 不触发):update_time 显式维护
        update.set(AppRegistration::getUpdateTime, LocalDateTime.now());
        int changed = appMapper.update(null, update);
        if (changed == 0) {
            // requireApp 已验存在:0 行=并发删除等竞态,按 404 处理
            throw new BusinessException(404, "应用不存在: " + appId);
        }
        AppRegistration reloaded = requireApp(appId);
        log.info("Webhook 配置已保存: appId={}, enabled={}, events={}, urlCleared={}",
                appId, reloaded.getWebhookEnabled(), reloaded.getWebhookEvents(),
                request.url() != null && request.url().isBlank());
        return toView(appId, reloaded);
    }

    // ------------------------------------------------------------------
    // POST /admin/webhooks/config/test(真实外呼:签名 + 单次投递)
    // ------------------------------------------------------------------

    public TestResult test(long appId) {
        AppRegistration app = requireApp(appId);
        String url = app.getWebhookUrl();
        if (url == null || url.isBlank()) {
            throw new BusinessException(400, "尚未配置 Webhook 回调地址,请先保存 url 后再测试");
        }
        String secret = app.getWebhookSecret();
        boolean signatureValid = secret != null && !secret.isBlank();
        String timestamp = String.valueOf(System.currentTimeMillis());
        String nonce = UUID.randomUUID().toString().replace("-", "");
        String payload = testPayload();
        String signature = WebhookSigner.sign(secret, timestamp, nonce, payload);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-IA-Delivery", "test");
        headers.set("X-IA-Timestamp", timestamp);
        headers.set("X-IA-Nonce", nonce);
        if (signature != null) {
            headers.set("X-IA-Signature", signature);
        }
        try {
            WebhookHttpSender.Result result = sender.send(url, headers, payload);
            boolean ok = result.statusCode() >= 200 && result.statusCode() < 300;
            return new TestResult(ok, signatureValid, result.statusCode(),
                    ok ? null : excerpt(result.body()));
        } catch (Exception transportFailure) {
            log.warn("Webhook 测试投递失败: appId={}, {}", appId,
                    transportFailure.getMessage());
            return new TestResult(false, signatureValid, null,
                    excerpt(transportFailure.getClass().getSimpleName() + ": "
                            + transportFailure.getMessage()));
        }
    }

    // ------------------------------------------------------------------
    // 内部装配
    // ------------------------------------------------------------------

    private AppRegistration requireApp(long appId) {
        AppRegistration app = appMapper.selectById(appId);
        if (app == null) {
            throw new BusinessException(404, "应用不存在: " + appId);
        }
        return app;
    }

    private static ConfigView toView(long appId, AppRegistration app) {
        return new ConfigView(
                appId,
                app.getWebhookUrl(),
                AdminModelConfigService.maskSecret(app.getWebhookSecret()),
                !Boolean.FALSE.equals(app.getWebhookEnabled()),
                eventsOf(app.getWebhookEvents()));
    }

    /** CSV → 列表(空配置 → 空列表;mock 契约 events 数组形)。 */
    private static List<String> eventsOf(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .toList();
    }

    /** 列表 → CSV;值域校验(web 契约 WebhookEvent 全集,超集 400)。 */
    private static String normalizeEvents(List<String> events) {
        if (events.isEmpty()) {
            return "";
        }
        for (String event : events) {
            if (event == null || !SUBSCRIBABLE_EVENTS.contains(event.trim().toLowerCase(Locale.ROOT))) {
                throw new BusinessException(400, "非法的订阅事件: " + event
                        + ",允许值: run.finished/run.failed/run.cancelled/run.resource-limit");
            }
        }
        return String.join(",", events.stream().map(String::trim).toList());
    }

    private static String testPayload() {
        return "{\"event\":\"run.finished\",\"test\":true,\"appId\":0,\"runId\":\"test-"
                + UUID.randomUUID().toString().substring(0, 8)
                + "\",\"status\":\"COMPLETED\",\"finishedAt\":\""
                + Instant.now().toString() + "\"}";
    }

    private static String excerpt(String value) {
        if (value == null) {
            return null;
        }
        return value.length() <= MAX_TEST_ERROR_LENGTH
                ? value
                : value.substring(0, MAX_TEST_ERROR_LENGTH);
    }

    /** 测试注入替身发送端(包外测试经 public 入口;生产路径仍为 RestClient)。 */
    public void setSenderForTest(WebhookHttpSender sender) {
        this.sender = Objects.requireNonNull(sender, "sender must not be null");
    }

    /** 配置视图(mock 契约 WebhookConfig 形;secret 仅掩码)。 */
    public record ConfigView(
            long appId,
            String url,
            String secretMasked,
            boolean enabled,
            List<String> events) {
    }

    /** 保存请求(mock 契约 WebhookConfigSaveReq 形;secret 只写)。 */
    public record SaveReq(
            String url,
            String secret,
            Boolean enabled,
            List<String> events) {
    }

    /** 连通性测试结果(mock 契约 {ok, signatureValid} + httpStatus/error 扩展)。 */
    public record TestResult(
            boolean ok,
            boolean signatureValid,
            Integer httpStatus,
            String error) {
    }

    /** 测试投递发送端(可注入替身用于测试;语义同 WebhookDeliveryService 同名口)。 */
    public interface WebhookHttpSender {

        Result send(String url, HttpHeaders headers, String body);

        record Result(int statusCode, String body) {
        }
    }

    /** 缺省实现:Spring RestClient,超时取 inneragent.webhook.http-timeout。 */
    static final class RestClientWebhookHttpSender implements WebhookHttpSender {

        private final RestClient restClient;

        RestClientWebhookHttpSender(Duration timeout) {
            SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
            factory.setConnectTimeout((int) timeout.toMillis());
            factory.setReadTimeout((int) timeout.toMillis());
            this.restClient = RestClient.builder().requestFactory(factory).build();
        }

        @Override
        public Result send(String url, HttpHeaders headers, String body) {
            return restClient.post()
                    .uri(url)
                    .headers(httpHeaders -> httpHeaders.addAll(headers))
                    .body(body)
                    .exchange((request, response) -> new Result(
                            response.getStatusCode().value(),
                            new String(response.getBody().readAllBytes(),
                                    StandardCharsets.UTF_8)));
        }
    }
}
