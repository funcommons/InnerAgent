package com.inneragent.platform.safety;

import lombok.extern.slf4j.Slf4j;
import org.springframework.core.annotation.AnnotationAwareOrderComparator;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Objects;

/**
 * 内容安全过滤器链(P2-safety W6):按序执行全部 {@link ContentSafetyFilter}。
 *
 * <p>链语义(任务规格):链式多过滤器按序,首个 block 即停;redact 以脱敏
 * 后文本替换继续流转(后续过滤器看到的是前序脱敏结果,终值是链末端文本)。
 * 链序 = Spring Bean 顺序(实现可标 {@code @Order} 参与;缺省 Bean 殿后)。
 *
 * <p>异常兜底:过滤器实现抛出的未知异常按全局失败策略
 * ({@code inneragent.safety.failure-policy})处理——fail-open 放行 + WARN /
 * fail-closed block(回调型过滤器自身已在实现内消化网络失败,本兜底面向
 * 宿主自声明过滤器的缺陷)。
 */
@Component
@Slf4j
public class ContentSafetyChain {

    private final ContentSafetyProperties properties;
    private final List<ContentSafetyFilter> filters;

    public ContentSafetyChain(ContentSafetyProperties properties,
                              List<ContentSafetyFilter> filters) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.filters = filters == null ? List.of() : ordered(filters);
    }

    /** 过滤器只读视图(测试/诊断用)。 */
    public List<ContentSafetyFilter> filters() {
        return filters;
    }

    /**
     * 执行链,返回终局裁决(redact 携带链末端脱敏文本)。
     * 空链(理论上不会:缺省装配 noop)= allow。
     */
    public ContentSafetyFilter.Verdict check(ContentSafetyFilter.Direction direction,
                                             String text,
                                             ContentSafetyFilter.Context context) {
        String current = text == null ? "" : text;
        boolean redacted = false;
        for (ContentSafetyFilter filter : filters) {
            ContentSafetyFilter.Verdict verdict;
            try {
                verdict = filter.check(direction, current, context);
            } catch (RuntimeException filterDefect) {
                verdict = onChainFailure(direction, filter, filterDefect);
            }
            if (verdict instanceof ContentSafetyFilter.Verdict.Block block) {
                return block;
            }
            if (verdict instanceof ContentSafetyFilter.Verdict.Redact redact) {
                current = redact.text();
                redacted = true;
            }
            // Allow → 下一过滤器(文本不变)
        }
        // 无 block 时终值 = 链末端文本(发生过 redact 即以 Redact 回传,
        // 让挂点以脱敏文本替换;未发生则原样 allow)
        return redacted ? ContentSafetyFilter.Verdict.redact(current)
                : ContentSafetyFilter.Verdict.allow();
    }

    private ContentSafetyFilter.Verdict onChainFailure(
            ContentSafetyFilter.Direction direction,
            ContentSafetyFilter filter,
            RuntimeException failure) {
        if (properties.getFailurePolicy()
                == ContentSafetyProperties.FailurePolicy.FAIL_CLOSED) {
            log.warn("过滤器链异常(fail-closed 按 block 处理): direction={}, filter={}, cause={}",
                    direction.code(), filter.getClass().getSimpleName(),
                    String.valueOf(failure.getMessage()));
            return ContentSafetyFilter.Verdict.block(
                    CallbackContentSafetyFilter.FAIL_CLOSED_REASON);
        }
        log.warn("过滤器链异常(fail-open 放行): direction={}, filter={}, cause={}",
                direction.code(), filter.getClass().getSimpleName(),
                String.valueOf(failure.getMessage()));
        return ContentSafetyFilter.Verdict.allow();
    }

    private static List<ContentSafetyFilter> ordered(List<ContentSafetyFilter> filters) {
        List<ContentSafetyFilter> sorted = new java.util.ArrayList<>(filters);
        sorted.sort(AnnotationAwareOrderComparator.INSTANCE);
        return List.copyOf(sorted);
    }
}
