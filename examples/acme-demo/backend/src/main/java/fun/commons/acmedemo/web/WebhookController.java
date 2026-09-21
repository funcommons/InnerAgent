package fun.commons.acmedemo.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import fun.commons.acmedemo.common.R;
import fun.commons.acmedemo.config.IaProperties;
import fun.commons.acmedemo.ia.IaWebhookVerifier;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * InnerAgent Webhook 接收(接入指南 §6.3)。
 *
 * InnerAgent POST {webhookUrl} 到这里(运行终态回调:
 * run.finished / run.failed / run.cancelled);验签必须用原始字节:
 * Spring 用 byte[] 接收避免任何前置反序列化。语义:
 *  - secret 未配置 → 503(运维问题,不尝试验签)
 *  - 验签失败     → 401(不落事件)
 *  - 成功         → 记录事件并立即 2xx(先应答后处理;重试由 InnerAgent 按
 *                   1m/5m/30m/2h/12h 退避触发,最多 5 次;消费方以
 *                   X-IA-Delivery 幂等去重)
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class WebhookController {

    /** 事件环形缓冲上限;超出丢最旧(DEMO 展示用途)。 */
    static final int MAX_EVENTS = 100;

    /** 运行终态事件白名单(InnerAgent 可订阅事件;非法事件名仅标注不拒收)。 */
    static final Set<String> KNOWN_EVENTS = Set.of("run.finished", "run.failed", "run.cancelled");

    private final IaProperties props;
    private final IaWebhookVerifier verifier;
    private final ObjectMapper objectMapper;

    private final Deque<EventView> events = new ArrayDeque<>();
    private final Set<String> seenDeliveryIds = ConcurrentHashMap.newKeySet();

    /** 投递的事件:事件名/runId/终态/投递 ID/原始体/接收时间。 */
    public record EventView(String event, String runId, String status, String deliveryId,
                            boolean known, String rawBody, Instant receivedAt) {
    }

    @PostMapping("/ia/webhook")
    public ResponseEntity<R<Void>> callback(
            @RequestBody byte[] rawBody,
            @RequestHeader(value = "X-IA-Signature", required = false) String signature,
            @RequestHeader(value = "X-IA-Timestamp", required = false) String timestamp,
            @RequestHeader(value = "X-IA-Nonce", required = false) String nonce,
            @RequestHeader(value = "X-IA-Delivery", required = false) String deliveryId) {
        if (props.getWebhookSecret() == null || props.getWebhookSecret().isBlank()) {
            log.warn("收到 webhook 但 ia.webhook-secret 未配置,拒绝处理");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(R.error(503, "webhookSecret 未配置"));
        }
        if (!verifier.verify(props.getWebhookSecret(), rawBody, timestamp, nonce, signature)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(R.error(401, "签名校验失败"));
        }
        Map<String, String> fields = parseQuietly(rawBody);
        String event = fields.getOrDefault("event", "unknown");
        String runId = fields.getOrDefault("runId", "");
        String delivery = deliveryId == null || deliveryId.isBlank()
                ? "unknown-" + System.nanoTime()
                : deliveryId;
        if (!seenDeliveryIds.add(delivery)) {
            // X-IA-Delivery 幂等去重:重投(管理面 redeliver)不重复消费
            log.info("webhook 重复投递,幂等跳过: deliveryId={}", delivery);
            return ResponseEntity.ok(R.ok());
        }
        synchronized (events) {
            events.addFirst(new EventView(event, runId, fields.get("status"),
                    delivery, KNOWN_EVENTS.contains(event), truncate(rawBody), Instant.now()));
            while (events.size() > MAX_EVENTS) {
                events.removeLast();
            }
        }
        return ResponseEntity.ok(R.ok());
    }

    @GetMapping("/api/webhook-events")
    public R<List<EventView>> list() {
        synchronized (events) {
            return R.ok(new ArrayList<>(events));
        }
    }

    /** 验签已通过的 body 尽力解析(非法 JSON 不回错,按原文存档)。 */
    private Map<String, String> parseQuietly(byte[] rawBody) {
        Map<String, String> out = new LinkedHashMap<>();
        try {
            JsonNode node = objectMapper.readTree(rawBody);
            for (String field : List.of("event", "runId", "status")) {
                if (node.hasNonNull(field)) {
                    out.put(field, node.get(field).asText());
                }
            }
        } catch (Exception e) {
            log.warn("webhook body 非法 JSON(仍已验签通过),按原文存档");
        }
        return out;
    }

    private static String truncate(byte[] rawBody) {
        String s = new String(rawBody, java.nio.charset.StandardCharsets.UTF_8);
        return s.length() <= 2048 ? s : s.substring(0, 2048) + "…";
    }
}
