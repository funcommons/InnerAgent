package com.inneragent.agent.mcp;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * MCP 宿主桥调用端配置(P1-T2b,前缀 {@code inneragent.mcp})。
 *
 * <p>超时默认值对齐 02-技术方案 §4.7(单宿主 MCP 调用 30s 上限);
 * 重连编排对应 spike 风险 R1(SDK 无自动重连,会话失效后对同实例
 * re-initialize 需自建,单飞锁 + 指数退避)。
 *
 * <p>关于请求体上限(spike 风险 R6):本工程所钉的 mcp 0.17.0 客户端传输
 * ({@code HttpClientStreamableHttpTransport})不设 maxRequestSize/maxResponseSize
 * 上限(无 413 路径),故本配置段不提供大小旋钮;大参数工具(图像生成等)
 * 在 0.17.0 形态下无需显式调高。服务端桥(后续 starter 任务)如使用带
 * 上限的传输版本,再按宿主形态补配。
 */
@ConfigurationProperties(prefix = "inneragent.mcp")
public class McpInvokerProperties {

    /**
     * 宿主桥调用端总开关:false 时 McpClientToolInvoker Bean 不装配,
     * 自动回退 T2a 缺省实现 UnavailableMcpToolInvoker(调用即抛)。
     */
    private boolean enabled = true;

    /** 单次 tools/call 超时(含重连后的重试;§4.7 默认 30s)。 */
    private Duration callTimeout = Duration.ofSeconds(30);

    /** 客户端缓存:按 (appId, endpointUrl) 懒建,超量按 LRU 淘汰并关闭。 */
    private int maxClients = 32;

    /** 客户端缓存空闲过期(注册变更走显式失效,不依赖过期)。 */
    private Duration clientExpireAfterAccess = Duration.ofMinutes(30);

    /** 重连编排参数(R1)。 */
    private final Reconnect reconnect = new Reconnect();

    /** [P4-W13] 三方 MCP 每 server 工具清单 LRU 缓存 TTL(缺省 5min,可配)。 */
    private Duration thirdPartyToolListTtl = Duration.ofMinutes(5);

    /** [P4-W13] 三方 MCP 工具清单缓存容量(LRU 上限,按 server 计)。 */
    private int thirdPartyMaxCachedServers = 256;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public Duration getCallTimeout() {
        return callTimeout;
    }

    public void setCallTimeout(Duration callTimeout) {
        this.callTimeout = callTimeout;
    }

    public int getMaxClients() {
        return maxClients;
    }

    public void setMaxClients(int maxClients) {
        this.maxClients = maxClients;
    }

    public Duration getClientExpireAfterAccess() {
        return clientExpireAfterAccess;
    }

    public void setClientExpireAfterAccess(Duration clientExpireAfterAccess) {
        this.clientExpireAfterAccess = clientExpireAfterAccess;
    }

    public Reconnect getReconnect() {
        return reconnect;
    }

    public Duration getThirdPartyToolListTtl() {
        return thirdPartyToolListTtl;
    }

    public void setThirdPartyToolListTtl(Duration thirdPartyToolListTtl) {
        this.thirdPartyToolListTtl = thirdPartyToolListTtl;
    }

    public int getThirdPartyMaxCachedServers() {
        return thirdPartyMaxCachedServers;
    }

    public void setThirdPartyMaxCachedServers(int thirdPartyMaxCachedServers) {
        this.thirdPartyMaxCachedServers = thirdPartyMaxCachedServers;
    }

    /**
     * 会话失效/传输断连后的重连编排(spike R1 缓解)。
     *
     * <p>单飞锁:同一客户端只有一位调用者执行「退避 + re-initialize」,
     * 其余并发失败者等待锁;若等待期间他人已恢复(恢复时间晚于自己的
     * 失败时间)则直接重试,不重复退避。
     */
    public static class Reconnect {

        /** 首次重连前的退避基数(指数增长:initial × 2^(attempt-1))。 */
        private Duration initialBackoff = Duration.ofMillis(200);

        /** 单次退避上限。 */
        private Duration maxBackoff = Duration.ofSeconds(5);

        /**
         * 单次 invoke 内「重连 + 重试」的最多轮数;1 = 任务规格的
         * 「re-initialize 后重试一次」。重试仍失败则按传输异常上抛。
         */
        private int maxAttempts = 1;

        public Duration getInitialBackoff() {
            return initialBackoff;
        }

        public void setInitialBackoff(Duration initialBackoff) {
            this.initialBackoff = initialBackoff;
        }

        public Duration getMaxBackoff() {
            return maxBackoff;
        }

        public void setMaxBackoff(Duration maxBackoff) {
            this.maxBackoff = maxBackoff;
        }

        public int getMaxAttempts() {
            return maxAttempts;
        }

        public void setMaxAttempts(int maxAttempts) {
            this.maxAttempts = maxAttempts;
        }
    }
}
