package com.inneragent.platform.metrics;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 业务计数门面单测(IA-2/IA-3/IA-4,P4 差距收口):指标名/标签契约与计数
 * 累积;Prometheus 出口改名(点→下划线 + _total)后与大盘契约表同名。
 */
class IaBusinessMetricsTests {

    @Test
    @DisplayName("ia.tool.calls{app,tool,result}:终态计数累积")
    void toolCallCounterAccumulates() {
        IaBusinessMetrics metrics = new IaBusinessMetrics(new SimpleMeterRegistry());

        metrics.toolCall(1L, "asset_query", IaBusinessMetrics.RESULT_OK);
        metrics.toolCall(1L, "asset_query", IaBusinessMetrics.RESULT_OK);
        metrics.toolCall(1L, "mcp__crm__create_lead", IaBusinessMetrics.RESULT_ERROR);
        metrics.toolCall(2L, "asset_query", IaBusinessMetrics.RESULT_OK);

        assertThat(metrics.counterValue(IaBusinessMetrics.TOOL_CALLS,
                "app", "1", "tool", "asset_query", "result", "ok")).isEqualTo(2.0);
        assertThat(metrics.counterValue(IaBusinessMetrics.TOOL_CALLS,
                "app", "1", "tool", "mcp__crm__create_lead", "result", "error"))
                .isEqualTo(1.0);
        assertThat(metrics.counterValue(IaBusinessMetrics.TOOL_CALLS,
                "app", "2", "tool", "asset_query", "result", "ok")).isEqualTo(1.0);
    }

    @Test
    @DisplayName("ia.confirmation{app,decision,source}:approved/rejected/expired 值域")
    void confirmationCounterAccumulates() {
        IaBusinessMetrics metrics = new IaBusinessMetrics(new SimpleMeterRegistry());

        metrics.confirmation(1L, IaBusinessMetrics.DECISION_APPROVED, "live-confirm");
        metrics.confirmation(1L, IaBusinessMetrics.DECISION_REJECTED, "live-confirm");
        metrics.confirmation(1L, IaBusinessMetrics.DECISION_EXPIRED, "expired");

        assertThat(metrics.counterValue(IaBusinessMetrics.CONFIRMATION,
                "app", "1", "decision", "approved", "source", "live-confirm"))
                .isEqualTo(1.0);
        assertThat(metrics.counterValue(IaBusinessMetrics.CONFIRMATION,
                "app", "1", "decision", "rejected", "source", "live-confirm"))
                .isEqualTo(1.0);
        assertThat(metrics.counterValue(IaBusinessMetrics.CONFIRMATION,
                "app", "1", "decision", "expired", "source", "expired"))
                .isEqualTo(1.0);
    }

    @Test
    @DisplayName("ia.reconnect{app,result}:resumed/failed 计数")
    void reconnectCounterAccumulates() {
        IaBusinessMetrics metrics = new IaBusinessMetrics(new SimpleMeterRegistry());

        metrics.reconnect(1L, IaBusinessMetrics.RECONNECT_RESUMED);
        metrics.reconnect(1L, IaBusinessMetrics.RECONNECT_FAILED);

        assertThat(metrics.counterValue(IaBusinessMetrics.RECONNECT,
                "app", "1", "result", "resumed")).isEqualTo(1.0);
        assertThat(metrics.counterValue(IaBusinessMetrics.RECONNECT,
                "app", "1", "result", "failed")).isEqualTo(1.0);
    }

    @Test
    @DisplayName("未计数项读值为 0;ObjectProvider 形态可空装配")
    void missingCountersReadZero() {
        IaBusinessMetrics metrics = new IaBusinessMetrics(new SimpleMeterRegistry());

        assertThat(metrics.counterValue(IaBusinessMetrics.TOOL_CALLS,
                "app", "1", "tool", "never", "result", "ok")).isEqualTo(0.0);
        assertThat(IaBusinessMetrics.noop()).isNotNull();
    }
}
