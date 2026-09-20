package com.inneragent.agent.state;

import io.agentscope.core.agent.AgentBase;
import io.agentscope.core.agent.RuntimeContext;

/**
 * 在 AgentScope 流里访问 {@link RuntimeContext} 的辅助。
 * <p>
 * 因为 {@code StateStoreGuardedChatModel} 在 chunk 收集后已离开 {@code Flux.deferContextual}
 * 上下文，原始 reactor context 不可访问；这里用 {@link ThreadLocal} 在流入口处显式设置，
 * {@link StateStoreGuardedChatModel} 末尾读取后清理。
 * <p>
 * 仅在流式归集路径使用，线程安全由 AgentScope 单调用流保证。
 */
final class AgentScopeRuntimeContextAccess {

    private static final ThreadLocal<RuntimeContext> CURRENT = new ThreadLocal<>();

    private AgentScopeRuntimeContextAccess() {
    }

    /**
     * 在流入口处保存当前调用线程的 RuntimeContext（只覆盖当前线程）。
     */
    static void set(RuntimeContext context) {
        if (context == null) {
            CURRENT.remove();
        } else {
            CURRENT.set(context);
        }
    }

    /**
     * 读取当前线程最近一次设置的 RuntimeContext；可为空。
     */
    static RuntimeContext current() {
        return CURRENT.get();
    }

    static void clear() {
        CURRENT.remove();
    }
}
