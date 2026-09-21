package com.inneragent.platform.safety;

/**
 * 缺省 noop 过滤器(P2-safety W6):恒 allow(pass-through),零外呼。
 *
 * <p>意义在于把「接入点」做成常在结构——链、挂点、审计、配置全部就位,
 * 宿主随后接自有审核(回调过滤器或自声明 {@link ContentSafetyFilter} Bean)
 * 时仅切换实现,运行路径零改动。
 */
public final class NoopContentSafetyFilter implements ContentSafetyFilter {

    @Override
    public Verdict check(Direction direction, String text, Context context) {
        return Verdict.allow();
    }
}
