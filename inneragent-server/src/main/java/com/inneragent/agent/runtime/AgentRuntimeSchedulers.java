package com.inneragent.agent.runtime;

import com.inneragent.platform.config.AgentScopeRuntimeProperties;
import com.inneragent.agent.run.AgentRuntimeMetrics;
import com.inneragent.platform.context.AppContext;
import reactor.core.scheduler.Scheduler;
import reactor.core.scheduler.Schedulers;

import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import com.inneragent.platform.tenant.TenantContext;

/**
 * Owns the four bounded schedulers used at blocking AgentScope boundaries.
 */
public final class AgentRuntimeSchedulers implements AutoCloseable {

    /**
     * Reactor 全局调度器(parallel/boundedElastic/single 等)的上下文
     * 捕获-恢复挂钩键(onScheduleHook 按 key 幂等替换)。
     */
    public static final String CONTEXT_SCHEDULE_HOOK_KEY = "inneragent.tenant-app-context";

    /**
     * 任务包装:提交线程捕获租户/应用上下文,任务线程恢复。
     *
     * <p>恢复采用快照精确还原(runInTenant/runAsSystem/runInApp 语义):
     * 池线程上等价于 finally 清理(前一状态恒为空);同步执行类调度器
     * (如 immediate)上则不打扰调用线程既有上下文。
     */
    private static final java.util.function.Function<Runnable, Runnable> CONTEXT_PROPAGATOR =
            task -> {
                Long tenantId = TenantContext.getTenantId();
                boolean ignoreTenant = TenantContext.isIgnored();
                Long appId = AppContext.getAppId();
                Runnable tenantScoped = (ignoreTenant || tenantId == null)
                        ? () -> TenantContext.runAsSystem(task)
                        : () -> TenantContext.runInTenant(tenantId, task);
                if (appId == null) {
                    return tenantScoped;
                }
                return () -> AppContext.runInApp(appId, tenantScoped);
            };

    static {
        // 四个自有线程池由下方 execute 覆盖捕获恢复;但运行链在自有池之外
        // 还有经 Reactor 内建调度器的 hop(如 ReplayWakeGate 的 Mono.delay →
        // Schedulers.parallel()、agentscope 内核内部调度),这些线程提交
        // 后续任务时同样丢失 ThreadLocal——多应用(app≠1)下后续按行级
        // 拦截器缺省回落 app_id=1 查数,产生「Agent run does not exist」。
        // 全局挂钩对所有经 Schedulers 工厂创建的调度器任务做捕获-恢复,
        // 与 execute 覆盖形成分层互补(双重包装幂等无害)。
        Schedulers.onScheduleHook(CONTEXT_SCHEDULE_HOOK_KEY, CONTEXT_PROPAGATOR);
    }

    public static final int STATE_QUEUE_CAPACITY = 512;
    public static final int JOURNAL_QUEUE_CAPACITY = 2048;
    public static final int MODEL_QUEUE_CAPACITY = 256;
    public static final int TOOL_QUEUE_CAPACITY = 256;

    public static final String STATE_OVERLOAD_CODE = "AGENT_STATE_SCHEDULER_OVERLOADED";
    public static final String JOURNAL_OVERLOAD_CODE = "AGENT_JOURNAL_SCHEDULER_OVERLOADED";
    public static final String MODEL_OVERLOAD_CODE = "AGENT_MODEL_BLOCKING_SCHEDULER_OVERLOADED";
    public static final String TOOL_OVERLOAD_CODE = "AGENT_TOOL_BLOCKING_SCHEDULER_OVERLOADED";

    private final OwnedScheduler state;
    private final OwnedScheduler journal;
    private final OwnedScheduler modelBlocking;
    private final OwnedScheduler toolBlocking;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AgentRuntimeMetrics metrics;

    public AgentRuntimeSchedulers(AgentScopeRuntimeProperties properties) {
        this(properties, AgentRuntimeMetrics.noop());
    }

    public AgentRuntimeSchedulers(
            AgentScopeRuntimeProperties properties,
            AgentRuntimeMetrics metrics) {
        Objects.requireNonNull(properties, "properties must not be null");
        this.metrics = Objects.requireNonNull(metrics, "metrics must not be null");
        state = fixedScheduler(
                "agent-state", properties.getStateThreads(), STATE_QUEUE_CAPACITY, STATE_OVERLOAD_CODE);
        journal = fixedScheduler(
                "agent-journal", properties.getJournalThreads(), JOURNAL_QUEUE_CAPACITY, JOURNAL_OVERLOAD_CODE);
        modelBlocking = fixedScheduler(
                "agent-model-blocking", properties.getModelThreads(), MODEL_QUEUE_CAPACITY, MODEL_OVERLOAD_CODE);
        toolBlocking = fixedScheduler(
                "agent-tool-blocking", properties.getToolThreads(), TOOL_QUEUE_CAPACITY, TOOL_OVERLOAD_CODE);
    }

    public Scheduler state() {
        return state.scheduler();
    }

    public Scheduler journal() {
        return journal.scheduler();
    }

    public Scheduler modelBlocking() {
        return modelBlocking.scheduler();
    }

    public Scheduler toolBlocking() {
        return toolBlocking.scheduler();
    }

    public boolean isClosed() {
        return closed.get();
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        close(state);
        close(journal);
        close(modelBlocking);
        close(toolBlocking);
    }

    private OwnedScheduler fixedScheduler(
            String name, int threads, int queueCapacity, String overloadCode) {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                threads,
                threads,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(queueCapacity),
                namedThreadFactory(name),
                (task, rejectedExecutor) -> {
                    if (TOOL_OVERLOAD_CODE.equals(overloadCode)) {
                        metrics.toolSchedulerViolation();
                    } else if (STATE_OVERLOAD_CODE.equals(overloadCode)) {
                        metrics.stateBulkheadRejected();
                    }
                    throw new SchedulerOverloadedException(overloadCode, name, rejectedExecutor.isShutdown());
                }) {
            // Reactor 跨调度器 hop 不传播 ThreadLocal：提交任务时捕获租户/应用上下文，
            // 在工作线程内恢复，保证 Agent 运行链路按发起请求的租户与应用过滤 SQL。
            // 本覆盖只挡四个自有线程池;Reactor 内建调度器上的 hop 由类初始化注册的
            // onScheduleHook 全局捕获-恢复(CONTEXT_PROPAGATOR)分层互补。
            // Agent 运行边界的阻塞操作均以全局唯一 runId 定位数据且入口已鉴权，
            // 提交线程自身已丢失租户上下文（如 agentscope 内部线程）时按系统模式执行；
            // app_id 无系统模式，缺省按单应用默认 1 注入（[adapt] P1-T1 双列隔离）
            @Override
            public void execute(Runnable command) {
                Long tenantId = TenantContext.getTenantId();
                boolean ignoreTenant = TenantContext.isIgnored();
                Long appId = AppContext.getAppId();
                super.execute(() -> {
                    try {
                        if (ignoreTenant || tenantId == null) {
                            TenantContext.setIgnore(true);
                        } else {
                            TenantContext.setTenantId(tenantId);
                        }
                        if (appId != null) {
                            AppContext.setAppId(appId);
                        }
                        command.run();
                    } finally {
                        TenantContext.clear();
                        AppContext.clear();
                    }
                });
            }
        };
        executor.prestartAllCoreThreads();
        return new OwnedScheduler(executor, Schedulers.fromExecutorService(executor, name));
    }

    private ThreadFactory namedThreadFactory(String prefix) {
        AtomicInteger sequence = new AtomicInteger();
        return task -> {
            Thread thread = new Thread(task, prefix + "-" + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    private void close(OwnedScheduler owned) {
        owned.scheduler().dispose();
        owned.executor().shutdownNow();
    }

    private record OwnedScheduler(ThreadPoolExecutor executor, Scheduler scheduler) {
    }

    public static final class SchedulerOverloadedException extends RejectedExecutionException {

        private final String code;
        private final String schedulerName;

        public SchedulerOverloadedException(String code, String schedulerName, boolean shutdown) {
            super(code + ": scheduler=" + schedulerName + ", shutdown=" + shutdown);
            this.code = code;
            this.schedulerName = schedulerName;
        }

        public String getCode() {
            return code;
        }

        public String getSchedulerName() {
            return schedulerName;
        }
    }
}
