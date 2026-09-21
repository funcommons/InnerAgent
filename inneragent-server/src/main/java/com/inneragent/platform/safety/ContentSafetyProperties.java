package com.inneragent.platform.safety;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.Locale;

/**
 * 内容安全接入点配置(P2-safety W6,前缀 {@code inneragent.safety})。
 *
 * <p>缺省形态 = 接入点就绪但不过滤:enabled=false 时默认链仅含 noop
 * (pass-through),零行为变更;宿主接自有审核服务时配 enabled + callback-url
 * 即为回调过滤器(POST verdict 请求,响应映射三值裁决)。
 *
 * <p>失败策略(回调不可达/超时/响应非法时):
 * <ul>
 *   <li><strong>fail-open</strong>(缺省):放行 + WARN 日志——审核服务故障
 *       不阻断对话主流程(PRD:内容合规责任在宿主,InnerAgent 是接入点);</li>
 *   <li><strong>fail-closed</strong>:一律按 block 处理(高合规宿主可切)。</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "inneragent.safety")
public class ContentSafetyProperties {

    /** 失败策略。 */
    public enum FailurePolicy {
        FAIL_OPEN,
        FAIL_CLOSED;

        /** 解析 yml 值(大小写不敏感,连字符/下划线均可);非法值抛配置异常。 */
        public static FailurePolicy parse(String value) {
            if (value == null || value.isBlank()) {
                return FAIL_OPEN;
            }
            String normalized = value.trim().toLowerCase(Locale.ROOT).replace('-', '_');
            return FailurePolicy.valueOf(normalized.toUpperCase(Locale.ROOT));
        }
    }

    /**
     * 内容安全总开关:false = 默认链仅 noop(pass-through,零外呼);
     * true 且配置了 callback-url = 默认链为回调过滤器。
     */
    private boolean enabled = false;

    /** 宿主审核回调地址(POST verdict 请求;enabled 时必配,缺视为 noop)。 */
    private String callbackUrl;

    /** 单次回调超时(connect/read 同值;缺省 2s,挂点在入库/读取路径上,须短)。 */
    private Duration timeout = Duration.ofSeconds(2);

    /** 回调失败策略(缺省 fail-open + WARN)。 */
    private FailurePolicy failurePolicy = FailurePolicy.FAIL_OPEN;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getCallbackUrl() {
        return callbackUrl;
    }

    public void setCallbackUrl(String callbackUrl) {
        this.callbackUrl = callbackUrl;
    }

    public Duration getTimeout() {
        return timeout;
    }

    public void setTimeout(Duration timeout) {
        this.timeout = timeout;
    }

    public FailurePolicy getFailurePolicy() {
        return failurePolicy;
    }

    public void setFailurePolicy(FailurePolicy failurePolicy) {
        this.failurePolicy = failurePolicy;
    }
}
