package com.inneragent.agent.observability;

import java.util.Objects;

/**
 * 缺省 noop 工厂:builder 属性调用全部原地返回同一实例(零集合分配),
 * span 为共享单例——未启用 OTel 时挂点路径零开销、零状态。
 */
final class NoopGenAiSpanFactory implements GenAiSpanFactory {

    static final NoopGenAiSpanFactory INSTANCE = new NoopGenAiSpanFactory();

    private final NoopBuilder builder = new NoopBuilder();
    private final NoopSpan span = new NoopSpan();

    private NoopGenAiSpanFactory() {
    }

    @Override
    public boolean isNoop() {
        return true;
    }

    @Override
    public SpanBuilder spanBuilder(String spanName) {
        Objects.requireNonNull(spanName, "spanName must not be null");
        return builder;
    }

    private static final class NoopBuilder implements SpanBuilder {

        @Override
        public SpanBuilder attr(String key, String value) {
            return this;
        }

        @Override
        public SpanBuilder attr(String key, long value) {
            return this;
        }

        @Override
        public SpanBuilder contentAttr(String key, String value) {
            return this;
        }

        @Override
        public GenAiSpan startSpan() {
            return INSTANCE.span;
        }
    }

    private static final class NoopSpan implements GenAiSpan {

        @Override
        public void setAttribute(String key, String value) {
        }

        @Override
        public void setAttribute(String key, long value) {
        }

        @Override
        public void error(Throwable failure) {
        }

        @Override
        public void end() {
        }
    }
}
