package com.inneragent.platform.safety;

/**
 * 内容安全过滤器 SPI(P2-safety W6「内容安全接入点」;PRD §6.9 内容安全 +
 * 02-技术方案 §10 S7:不内置审核引擎,仅提供接入点——过滤器链,可配外部
 * 审核服务或回调宿主)。
 *
 * <p>契约:实现 {@link #check} 对一段文本给出三值裁决;
 * {@link ContentSafetyChain} 按序执行链上全部过滤器——allow 继续流转,
 * redact 以<strong>脱敏后文本</strong>替换后继续流转(后续过滤器看到的是
 * 前序脱敏结果),首个 block 即停(短路,后续过滤器不再执行)。
 *
 * <p>实现要求:<strong>无副作用、不抛异常</strong>——回调型过滤器对网络
 * 失败按失败策略(fail-open/fail-closed)内部消化;链与挂点对未知异常按
 * 全局失败策略兜底。文本仅为纯文本(v1 不做分段/结构化载荷)。
 */
public interface ContentSafetyFilter {

    /**
     * 对一段文本做内容安全裁决。
     *
     * @param direction 方向(ingress=用户消息入库前 / egress=助手内容对外投递前)
     * @param text      待裁决文本(ingress 链上为前序过滤后的文本;可为空串,不为 null)
     * @param context   调用上下文(app/用户/会话/运行;ingress 时 runId 尚未生成,为 null)
     * @return 三值裁决:allow / redact(脱敏后文本)/ block(原因)
     */
    Verdict check(Direction direction, String text, Context context);

    /** 过滤方向(PRD tripwire 建模的 v1 子集:input/output;tool 包裹后续批次)。 */
    enum Direction {
        /** 用户消息入库前(run 发起的用户输入)。 */
        INGRESS("ingress"),
        /** 助手内容对外投递前(消息投影读取路径)。 */
        EGRESS("egress");

        private final String code;

        Direction(String code) {
            this.code = code;
        }

        /** 线上码值(回调请求体 direction 字段)。 */
        public String code() {
            return code;
        }
    }

    /** 调用上下文(最小字段集;conversationId/runId 为 UUID 形态字符串)。 */
    record Context(long appId, Long userId, String conversationId, String runId) {
    }

    /**
     * 三值裁决:v1 以封闭接口建模,杜绝「四值字符串」漂移(V12 审计列宽教训
     * 的上游防御——裁决集封闭,落库枚举才可控)。
     */
    sealed interface Verdict {

        /** 放行(文本原样)。 */
        record Allow() implements Verdict {
        }

        /** 脱敏:text 必须为替换后的文本(非 null;空串合法=整段抹除)。 */
        record Redact(String text) implements Verdict {

            public Redact {
                if (text == null) {
                    throw new IllegalArgumentException("redact verdict requires replacement text");
                }
            }
        }

        /** 拦截:reason 供审计留痕;对外文案由挂点统一收敛,不回显过滤器内部细节。 */
        record Block(String reason) implements Verdict {

            public Block {
                if (reason == null || reason.isBlank()) {
                    reason = "unspecified";
                }
            }
        }

        static Verdict allow() {
            return new Allow();
        }

        static Verdict redact(String text) {
            return new Redact(text);
        }

        static Verdict block(String reason) {
            return new Block(reason);
        }
    }
}
