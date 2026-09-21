package com.inneragent.server.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.webhook.WebhookDelivery;
import com.inneragent.platform.mapper.WebhookDeliveryMapper;
import com.inneragent.platform.webhook.WebhookDeliveryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Objects;

/**
 * 终态 Webhook 投递记录 admin 服务(任务 #18b;web 契约
 * {@code web/src/api/admin.ts} 的 deliveries 形)。
 *
 * <p>查询按 appId/status/event 过滤 + pageNo/pageSize 分页;视图字段对齐
 * web 侧 {@code WebhookDelivery}(success=HTTP 投递成功、attempt/maxAttempts、
 * httpStatus、responseSummary、nextRetryAt、deliveredAt),并补 status/
 * appId 供管理端状态机展示。时间序列化为纪元毫秒(IsoDateTime 由前端转换)。
 */
@Service
@RequiredArgsConstructor
public class WebhookDeliveryAdminService {

    private final WebhookDeliveryMapper deliveryMapper;
    private final WebhookDeliveryService deliveryService;

    public PageResult<DeliveryView> page(
            Long appId, String status, String event, int pageNo, int pageSize) {
        // status 缺省/空白 = 不过滤(DEF-09:此前 eq 条件短路但 normalizeStatus
        // 参数仍无条件求值,null.trim() NPE → 500,UI「全部投递记录」首载即命中);
        // 非空白才走值域校验(非法值 400)
        String statusFilter = status == null || status.isBlank() ? null : normalizeStatus(status);
        LambdaQueryWrapper<WebhookDelivery> query = new LambdaQueryWrapper<WebhookDelivery>()
                .eq(appId != null, WebhookDelivery::getAppId, appId)
                .eq(statusFilter != null, WebhookDelivery::getStatus, statusFilter)
                .eq(event != null && !event.isBlank(),
                        WebhookDelivery::getEventType, event)
                .orderByDesc(WebhookDelivery::getId);
        Page<WebhookDelivery> page = deliveryMapper.selectPage(
                PageResult.toPage(pageNo, pageSize), query);
        return PageResult.of(page).map(this::toView);
    }

    /**
     * 手动重投:SUCCESS/FAILED/EXHAUSTED → PENDING;不存在 404,
     * 仍在排队/重试中(PENDING)409。
     */
    public DeliveryView redeliver(long id) {
        WebhookDelivery existing = deliveryMapper.selectById(id);
        if (existing == null) {
            throw new BusinessException(404, "投递记录不存在");
        }
        if (WebhookDelivery.STATUS_PENDING.equals(existing.getStatus())) {
            throw new BusinessException(409, "投递记录已在排队/重试中,无需重投");
        }
        if (!deliveryService.redeliver(id)) {
            throw new BusinessException(409, "投递记录状态已变更,请刷新后重试");
        }
        return toView(deliveryMapper.selectById(id));
    }

    /** 公开可见:测试包(com.inneragent.admin)与切片测试断言视图映射共用。 */
    public DeliveryView toView(WebhookDelivery delivery) {
        return new DeliveryView(
                delivery.getId(),
                delivery.getAppId(),
                delivery.getEventType(),
                delivery.getRunId(),
                delivery.getUrl(),
                WebhookDelivery.STATUS_SUCCESS.equals(delivery.getStatus()),
                delivery.getStatus(),
                delivery.getAttemptCount(),
                delivery.getMaxAttempts(),
                delivery.getLastHttpStatus(),
                delivery.getLastResponse(),
                toEpochMilli(delivery.getNextRetryAt()),
                toEpochMilli(delivery.getDeliveredAt()),
                toEpochMilli(delivery.getCreateTime()));
    }

    private static Long toEpochMilli(LocalDateTime time) {
        return time == null ? null : time.toInstant(ZoneOffset.UTC).toEpochMilli();
    }

    private static String normalizeStatus(String status) {
        String normalized = status.trim().toUpperCase();
        if (!Objects.equals(normalized, WebhookDelivery.STATUS_PENDING)
                && !Objects.equals(normalized, WebhookDelivery.STATUS_FAILED)
                && !Objects.equals(normalized, WebhookDelivery.STATUS_SUCCESS)
                && !Objects.equals(normalized, WebhookDelivery.STATUS_EXHAUSTED)) {
            throw new BusinessException(400, "非法的投递状态过滤值: " + status);
        }
        return normalized;
    }

    /** 投递记录视图(对齐 web 契约 deliveries 形 + status/appId 扩展)。 */
    public record DeliveryView(
            Long id,
            Long appId,
            String event,
            String runId,
            String url,
            boolean success,
            String status,
            Integer attempt,
            Integer maxAttempts,
            Integer httpStatus,
            String responseSummary,
            Long nextRetryAt,
            Long deliveredAt,
            Long createdAt) {
    }
}
