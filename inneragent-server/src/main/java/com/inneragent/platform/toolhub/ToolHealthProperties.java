package com.inneragent.platform.toolhub;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 工具体检配置(V16,前缀 {@code inneragent.tools.health})。
 *
 * <p>体检是管理面低频同步/半异步操作:探活超时对齐「连通性测试」体感
 * (缺省 10s,短于调用端 30s 的 tools/call 上限);批量体检单线程逐个执行
 * (v1 不做并发扫描,避免对宿主桥形成突发压力)。
 */
@ConfigurationProperties(prefix = "inneragent.tools.health")
public class ToolHealthProperties {

    /** 单工具探活超时(initialize/listTools 请求超时,缺省 10s)。 */
    private Duration probeTimeout = Duration.ofSeconds(10);

    public Duration getProbeTimeout() {
        return probeTimeout;
    }

    public void setProbeTimeout(Duration probeTimeout) {
        this.probeTimeout = probeTimeout;
    }
}
