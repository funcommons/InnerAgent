package com.inneragent.agent.observability;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanBuilder;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;

import java.util.Objects;

/**
 * OTel 桥接实现(io.opentelemetry:opentelemetry-api,版本经
 * opentelemetry-bom 对齐;技术方案未定桥型,选 otel-api 直连并报告)。
 *
 * <p>tracer 取 {@link GlobalOpenTelemetry#get()}:默认 noop;部署侧以
 * OTel javaagent / SDK 注册 provider 后 span 自然生效,服务内不强制
 * 引入 exporter 全家桶(采样与导出不在本任务)。
 *
 * <p>注意:reactor 异步链路不做全量 context 注入(挂点以显式属性
 * {@code inneragent.run.id} 关联 trace,PRD「runId 作 trace 关联 ID」),
 * 同步路径(tools)可用 {@link GenAiSpanFactory.GenAiSpan#makeCurrent()}。
 */
public final class OtelGenAiSpanFactory implements GenAiSpanFactory {

    private static final String INSTRUMENTATION_SCOPE = "com.inneragent.genai";

    private final Tracer tracer;
    private final boolean captureContent;
    private final int contentMaxChars;

    public OtelGenAiSpanFactory(OpenTelemetry openTelemetry, boolean captureContent, int contentMaxChars) {
        Objects.requireNonNull(openTelemetry, "openTelemetry must not be null");
        this.tracer = openTelemetry.getTracer(INSTRUMENTATION_SCOPE);
        this.captureContent = captureContent;
        this.contentMaxChars = Math.max(1, contentMaxChars);
    }

    /** 以 GlobalOpenTelemetry 构造(生产缺省形态)。 */
    public static OtelGenAiSpanFactory global(boolean captureContent, int contentMaxChars) {
        return new OtelGenAiSpanFactory(GlobalOpenTelemetry.get(), captureContent, contentMaxChars);
    }

    @Override
    public boolean isNoop() {
        return false;
    }

    @Override
    public SpanBuilder spanBuilder(String spanName) {
        Objects.requireNonNull(spanName, "spanName must not be null");
        return new OtelBuilder(tracer.spanBuilder(spanName), captureContent, contentMaxChars);
    }

    private static final class OtelBuilder implements SpanBuilder {

        private final io.opentelemetry.api.trace.SpanBuilder delegate;
        private final boolean captureContent;
        private final int contentMaxChars;

        OtelBuilder(
                io.opentelemetry.api.trace.SpanBuilder delegate,
                boolean captureContent,
                int contentMaxChars) {
            this.delegate = delegate;
            this.captureContent = captureContent;
            this.contentMaxChars = contentMaxChars;
        }

        @Override
        public SpanBuilder attr(String key, String value) {
            if (GenAiSemanticAttributes.meaningful(value)) {
                delegate.setAttribute(key, value);
            }
            return this;
        }

        @Override
        public SpanBuilder attr(String key, long value) {
            delegate.setAttribute(key, value);
            return this;
        }

        @Override
        public SpanBuilder contentAttr(String key, String value) {
            if (captureContent && GenAiSemanticAttributes.meaningful(value)) {
                delegate.setAttribute(key, truncate(value));
            }
            return this;
        }

        @Override
        public GenAiSpan startSpan() {
            return new OtelSpan(delegate.startSpan(), captureContent, contentMaxChars);
        }

        private String truncate(String value) {
            return value.length() <= contentMaxChars
                    ? value
                    : value.substring(0, contentMaxChars);
        }
    }

    private static final class OtelSpan implements GenAiSpan {

        private final Span delegate;
        private final boolean captureContent;
        private final int contentMaxChars;

        OtelSpan(Span delegate, boolean captureContent, int contentMaxChars) {
            this.delegate = delegate;
            this.captureContent = captureContent;
            this.contentMaxChars = contentMaxChars;
        }

        @Override
        public void setAttribute(String key, String value) {
            if (GenAiSemanticAttributes.meaningful(value)) {
                delegate.setAttribute(key, value);
            }
        }

        @Override
        public void setAttribute(String key, long value) {
            delegate.setAttribute(key, value);
        }

        @Override
        public void error(Throwable failure) {
            if (failure != null) {
                delegate.recordException(failure);
                delegate.setStatus(StatusCode.ERROR, failure.getMessage());
            }
        }

        @Override
        public void contentAttribute(String key, String value) {
            if (captureContent && GenAiSemanticAttributes.meaningful(value)) {
                delegate.setAttribute(key, value.length() <= contentMaxChars
                        ? value
                        : value.substring(0, contentMaxChars));
            }
        }

        @Override
        public void end() {
            delegate.end();
        }

        @Override
        public AutoCloseable makeCurrent() {
            io.opentelemetry.context.Scope scope = delegate.makeCurrent();
            return scope::close;
        }
    }
}
