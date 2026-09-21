package com.inneragent.platform.safety;

import com.inneragent.platform.safety.ContentSafetyFilter.Context;
import com.inneragent.platform.safety.ContentSafetyFilter.Direction;
import com.inneragent.platform.safety.ContentSafetyFilter.Verdict;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 内容安全过滤链单元测试(W6):链序、首 block 即停、redact 脱敏文本向后续
 * 过滤器流转、空链 allow、过滤器异常按失败策略兜底。
 */
class ContentSafetyChainTests {

    private static final Context CONTEXT = new Context(1L, 42L, "conv-1", "run-1");

    /** 记录收到文本的桩过滤器(断言「后续过滤器看到前序脱敏结果」)。 */
    private static final class RecordingFilter implements ContentSafetyFilter {

        final String name;
        final Verdict verdict;
        String receivedText;

        private RecordingFilter(String name, Verdict verdict) {
            this.name = name;
            this.verdict = verdict;
        }

        @Override
        public Verdict check(Direction direction, String text, Context context) {
            this.receivedText = text;
            return verdict;
        }
    }

    private static ContentSafetyChain chain(ContentSafetyProperties.FailurePolicy policy,
                                            ContentSafetyFilter... filters) {
        ContentSafetyProperties properties = new ContentSafetyProperties();
        properties.setFailurePolicy(policy);
        return new ContentSafetyChain(properties, List.of(filters));
    }

    @Test
    @DisplayName("①全 allow → allow;每个过滤器按序执行")
    void allAllowPassesThrough() {
        RecordingFilter first = new RecordingFilter("first", Verdict.allow());
        RecordingFilter second = new RecordingFilter("second", Verdict.allow());

        Verdict verdict = chain(ContentSafetyProperties.FailurePolicy.FAIL_OPEN,
                first, second).check(Direction.INGRESS, "hello", CONTEXT);

        assertThat(verdict).isInstanceOf(Verdict.Allow.class);
        assertThat(first.receivedText).isEqualTo("hello");
        assertThat(second.receivedText).isEqualTo("hello");
    }

    @Test
    @DisplayName("②首 block 即停:后续过滤器不再执行")
    void firstBlockStopsChain() {
        RecordingFilter blocking = new RecordingFilter("blocker", Verdict.block("敏感词"));
        RecordingFilter never = new RecordingFilter("never", Verdict.allow());

        Verdict verdict = chain(ContentSafetyProperties.FailurePolicy.FAIL_OPEN,
                blocking, never).check(Direction.EGRESS, "secret", CONTEXT);

        assertThat(verdict).isInstanceOf(Verdict.Block.class);
        assertThat(((Verdict.Block) verdict).reason()).isEqualTo("敏感词");
        assertThat(never.receivedText).as("block 后过滤器不再执行").isNull();
    }

    @Test
    @DisplayName("③redact 流转:后续过滤器看到脱敏文本,终值为链末端脱敏文本")
    void redactTextFlowsDownstream() {
        RecordingFilter redacting = new RecordingFilter("redactor", Verdict.redact("王***"));
        RecordingFilter approver = new RecordingFilter("approver", Verdict.allow());

        Verdict verdict = chain(ContentSafetyProperties.FailurePolicy.FAIL_OPEN,
                redacting, approver).check(Direction.EGRESS, "王小明", CONTEXT);

        assertThat(verdict).isInstanceOf(Verdict.Redact.class);
        assertThat(((Verdict.Redact) verdict).text()).isEqualTo("王***");
        assertThat(redacting.receivedText).isEqualTo("王小明");
        assertThat(approver.receivedText).as("后续过滤器看到脱敏结果").isEqualTo("王***");
    }

    @Test
    @DisplayName("④后段 redact 亦生效:终值 = 链末端脱敏文本")
    void laterRedactWins() {
        RecordingFilter redact1 = new RecordingFilter("r1", Verdict.redact("one"));
        RecordingFilter redact2 = new RecordingFilter("r2", Verdict.redact("two"));

        Verdict verdict = chain(ContentSafetyProperties.FailurePolicy.FAIL_OPEN,
                redact1, redact2).check(Direction.INGRESS, "origin", CONTEXT);

        assertThat(redact1.receivedText).isEqualTo("origin");
        assertThat(redact2.receivedText).isEqualTo("one");
        assertThat(((Verdict.Redact) verdict).text()).isEqualTo("two");
    }

    @Test
    @DisplayName("⑤空链 → allow(防御形态;缺省装配恒有 noop)")
    void emptyChainAllows() {
        Verdict verdict = chain(ContentSafetyProperties.FailurePolicy.FAIL_OPEN)
                .check(Direction.INGRESS, "anything", CONTEXT);
        assertThat(verdict).isInstanceOf(Verdict.Allow.class);
    }

    @Test
    @DisplayName("⑥过滤器抛异常:fail-open 放行 / fail-closed block")
    void filterDefectFollowsFailurePolicy() {
        ContentSafetyFilter defective = (direction, text, context) -> {
            throw new IllegalStateException("boom");
        };

        Verdict failOpen = chain(ContentSafetyProperties.FailurePolicy.FAIL_OPEN, defective)
                .check(Direction.INGRESS, "hello", CONTEXT);
        assertThat(failOpen).isInstanceOf(Verdict.Allow.class);

        Verdict failClosed = chain(ContentSafetyProperties.FailurePolicy.FAIL_CLOSED, defective)
                .check(Direction.INGRESS, "hello", CONTEXT);
        assertThat(failClosed).isInstanceOf(Verdict.Block.class);
        assertThat(((Verdict.Block) failClosed).reason())
                .isEqualTo(CallbackContentSafetyFilter.FAIL_CLOSED_REASON);
    }

    @Test
    @DisplayName("⑦链序由 @Order 决定(低值在前)")
    void chainRespectsOrderAnnotation() {
        ContentSafetyChain ordered = chain(
                ContentSafetyProperties.FailurePolicy.FAIL_OPEN,
                new LateAllowFilter(), new EarlyAllowFilter());

        assertThat(ordered.filters().getFirst())
                .as("低 @Order 值应排在链首")
                .isInstanceOf(EarlyAllowFilter.class);
    }

    @org.springframework.core.annotation.Order(1)
    private static final class EarlyAllowFilter implements ContentSafetyFilter {
        @Override
        public Verdict check(Direction direction, String text, Context context) {
            return Verdict.allow();
        }
    }

    @org.springframework.core.annotation.Order(2)
    private static final class LateAllowFilter implements ContentSafetyFilter {
        @Override
        public Verdict check(Direction direction, String text, Context context) {
            return Verdict.allow();
        }
    }
}
