package com.inneragent.platform.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.springframework.beans.factory.ObjectProvider;

import java.util.Objects;

/**
 * 业务计数门面(灰度大盘 §2.1 B1/B2/B3 时序 counter,docs/灰度与指标大盘.md
 * §7.1 台账 IA-2/IA-3/IA-4 的可行子集;P4 差距收口)。
 *
 * <p>指标名(Prometheus 出口按 Micrometer 约定改名:点→下划线,counter 补
 * {@code _total};与大盘契约表严格同名):
 * <ul>
 *   <li>{@code ia.tool.calls} → {@code ia_tool_calls_total{app,tool,result}}
 *       ——IA-2 工具终态(挂点:内置/子代理工具适配器与宿主桥 MCP 适配器的
 *       callAsync 终态;result=ok|error);</li>
 *   <li>{@code ia.confirmation} → {@code ia_confirmation_total{app,decision,
 *       source}}——IA-3 确认终态(挂点:确认流 approved/rejected 逐工具与
 *       审计同点位;过期协调器 expired 逐工具;source=live-confirm|expired,
 *       与 ia_audit_log.decision_source 值域同源);</li>
 *   <li>{@code ia.reconnect} → {@code ia_reconnect_total{app,result}}
 *       ——IA-4 会话级断点续传(挂点:GET /ia/api/v1/runs/{runId}/events
 *       带 Last-Event-ID/afterSequence 的重连;result=resumed=流正常完结
 *       (终态事件送达追平)|failed=流出错;fresh connect 不计)。</li>
 * </ul>
 *
 * <p>口径对齐:IA-2/IA-3 逐工具计数,与 ia_audit_log 逐工具行一比一(IA-7
 * SQL 校准可对照,防口径漂移);IA-4 会话级。低基数标签:app(应用 ID)、
 * tool(FQN/工具名,受目录规模约束)、decision/source/result(固定值域)。
 * registry 注入模式与 {@code AgentRuntimeMetrics}(IA-1)一致:Spring 管理
 * 的 MeterRegistry(无则回退进程内 SimpleMeterRegistry,仅保语义不破)。
 */
public final class IaBusinessMetrics {

    /** IA-2 工具终态 counter(Prometheus: ia_tool_calls_total)。 */
    public static final String TOOL_CALLS = "ia.tool.calls";
    /** IA-3 确认终态 counter(Prometheus: ia_confirmation_total)。 */
    public static final String CONFIRMATION = "ia.confirmation";
    /** IA-4 会话级重连 counter(Prometheus: ia_reconnect_total)。 */
    public static final String RECONNECT = "ia.reconnect";

    /** IA-2 result 值域。 */
    public static final String RESULT_OK = "ok";
    public static final String RESULT_ERROR = "error";
    /** IA-4 result 值域。 */
    public static final String RECONNECT_RESUMED = "resumed";
    public static final String RECONNECT_FAILED = "failed";
    /** IA-3 decision 值域(大盘契约 B2,与审计 allowed/denied 解耦命名)。 */
    public static final String DECISION_APPROVED = "approved";
    public static final String DECISION_REJECTED = "rejected";
    public static final String DECISION_EXPIRED = "expired";

    private static final IaBusinessMetrics NOOP =
            new IaBusinessMetrics(new SimpleMeterRegistry());

    private final MeterRegistry registry;

    public IaBusinessMetrics(ObjectProvider<MeterRegistry> registries) {
        this(registries.getIfAvailable(SimpleMeterRegistry::new));
    }

    public IaBusinessMetrics(MeterRegistry registry) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
    }

    /** 纯测试/未装配兜底(计数落进程内 registry,不外抛)。 */
    public static IaBusinessMetrics noop() {
        return NOOP;
    }

    /** IA-2:工具终态计数(app/tool/result 三标签)。 */
    public void toolCall(long app, String tool, String result) {
        counter(TOOL_CALLS,
                "app", Long.toString(app),
                "tool", tool,
                "result", result).increment();
    }

    /** IA-3:确认终态逐工具计数(app/decision/source 三标签,审计同点位)。 */
    public void confirmation(long app, String decision, String source) {
        counter(CONFIRMATION,
                "app", Long.toString(app),
                "decision", decision,
                "source", source).increment();
    }

    /** IA-4:会话级重连终局计数(app/result 两标签;fresh connect 不调)。 */
    public void reconnect(long app, String result) {
        counter(RECONNECT,
                "app", Long.toString(app),
                "result", result).increment();
    }

    private Counter counter(String name, String... tags) {
        return Counter.builder(name).tags(tags).register(registry);
    }

    /** 测试断言手柄:按名+标签读 counter 值(未注册计 0)。 */
    public double counterValue(String name, String... tags) {
        Counter counter = registry.find(name).tags(tags).counter();
        return counter == null ? 0.0 : counter.count();
    }
}
