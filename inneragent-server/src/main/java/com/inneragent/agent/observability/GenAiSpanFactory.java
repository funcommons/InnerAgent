package com.inneragent.agent.observability;

/**
 * GenAI 可观测薄封装 span 工厂(任务 #18b,W5;PRD §8 可观测 / 调研 §3.5.3 V27)。
 *
 * <p>设计目标:约定演进防返工——gen_ai 系与 mcp 系属性键收敛在
 * {@link GenAiSemanticAttributes},业务代码只与本工厂对话;采样与导出不在
 * 本任务范围(默认 noop,classpath 有 otel-api 时由
 * {@code GenAiObservabilityConfiguration} 桥接 {@code GlobalOpenTelemetry})。
 *
 * <p>四类 span(PRD 裁定 V27):run={@code invoke_agent}、模型调用=
 * {@code chat}、工具调用={@code execute_tool}、宿主 MCP=MCP client span。
 * runId 作 trace 关联 ID(见 {@code inneragent.run.id} 属性)。
 */
public interface GenAiSpanFactory {

    /** 全 noop 工厂(classpath 无 otel-api 或未装配时的零开销缺省)。 */
    static GenAiSpanFactory noop() {
        return NoopGenAiSpanFactory.INSTANCE;
    }

    /** 是否 noop 实现(挂点可据此跳过属性装配,保证零开销路径)。 */
    boolean isNoop();

    /**
     * 开一个 span 构造器;调用方按 GenAI 语义约定追加属性后
     * {@link SpanBuilder#startSpan()}。
     */
    SpanBuilder spanBuilder(String spanName);

    /** span 构造器(属性以调用点声明的顺序记录)。 */
    interface SpanBuilder {

        SpanBuilder attr(String key, String value);

        SpanBuilder attr(String key, long value);

        /**
         * 内容属性(prompt/completion 摘要):仅在
         * {@code inneragent.observability.genai.capture-content=true} 时记录
         * (对齐审计脱敏,PRD「消息内容属性默认关闭」)。
         */
        SpanBuilder contentAttr(String key, String value);

        GenAiSpan startSpan();
    }

    /** 进行中的 span;调用方负责在终态路径上 {@link #end()}。 */
    interface GenAiSpan extends AutoCloseable {

        void setAttribute(String key, String value);

        void setAttribute(String key, long value);

        /** 记录异常并置 ERROR 状态(noop 下零开销)。 */
        void error(Throwable failure);

        /**
         * 内容属性(prompt/completion 摘要):仅在
         * {@code inneragent.observability.genai.capture-content=true} 时记录;
         * 缺省实现为不记录(内容默认关)。
         */
        default void contentAttribute(String key, String value) {
        }

        void end();

        /**
         * 进入 span 作用域(同步路径用,子 span 自动挂父;
         * reactor 异步链路不要求)。noop 下为空作用域。
         */
        default AutoCloseable makeCurrent() {
            return () -> { };
        }

        /** 支持 try-with-resources 的同步路径(等价 {@link #end()})。 */
        @Override
        default void close() {
            end();
        }
    }
}
