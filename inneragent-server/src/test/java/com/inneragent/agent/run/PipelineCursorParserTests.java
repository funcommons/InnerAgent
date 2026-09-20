package com.inneragent.agent.run;

import com.inneragent.agent.run.model.RunCursor;
import com.inneragent.platform.common.BusinessException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * P1 遗留台账②:reconnect 的 Last-Event-ID 与目标 run 不一致时必须 400 拒绝。
 * 服务层语义由 PipelineCursorParser 保证(异常 code=400),HTTP 层由
 * GlobalExceptionHandler(P1 遗留台账①)映射为 HTTP 400。
 */
class PipelineCursorParserTests {

    private final PipelineCursorParser parser = new PipelineCursorParser();

    @Test
    void rejectsHeaderForAnotherRun() {
        assertThatThrownBy(() -> parser.parse("run-1", null, "run-2:7"))
                .isInstanceOf(BusinessException.class)
                .satisfies(failure -> assertThat(
                        ((BusinessException) failure).getCode()).isEqualTo(400))
                .hasMessage("Last-Event-ID targets a different run");
    }

    @Test
    void rejectsConflictingHeaderAndQuerySequence() {
        assertThatThrownBy(() -> parser.parse("run-1", 7L, "run-1:8"))
                .isInstanceOf(BusinessException.class)
                .satisfies(failure -> assertThat(
                        ((BusinessException) failure).getCode()).isEqualTo(400))
                .hasMessage("afterSequence conflicts with Last-Event-ID");
    }

    @Test
    void rejectsMalformedHeaders() {
        for (String malformed : new String[] {
                "", "   ", " leading", "trailing ",
                "no-separator", ":7", "run-1:", "run-1:a", "run-1:1.5",
                "run-1:" + Long.MAX_VALUE + "0",
        }) {
            assertThatThrownBy(() -> parser.parse("run-1", null, malformed))
                    .as("Last-Event-ID='%s' 应 400 拒绝", malformed)
                    .isInstanceOf(BusinessException.class)
                    .satisfies(failure -> assertThat(
                            ((BusinessException) failure).getCode()).isEqualTo(400));
        }
    }

    @Test
    void rejectsNegativeQuerySequence() {
        assertThatThrownBy(() -> parser.parse("run-1", -1L, null))
                .isInstanceOf(BusinessException.class)
                .satisfies(failure -> assertThat(
                        ((BusinessException) failure).getCode()).isEqualTo(400))
                .hasMessage("afterSequence must not be negative");
    }

    @Test
    void rejectsBlankRunId() {
        assertThatThrownBy(() -> parser.parse(" ", null, null))
                .isInstanceOf(BusinessException.class)
                .satisfies(failure -> assertThat(
                        ((BusinessException) failure).getCode()).isEqualTo(400));
    }

    @Test
    void defaultsToZeroWhenNoCursorSupplied() {
        RunCursor cursor = parser.parse("run-1", null, null);

        assertThat(cursor.runId()).isEqualTo("run-1");
        assertThat(cursor.afterSequence()).isZero();
    }

    @Test
    void headerSequenceWinsOverMatchingQuerySequence() {
        RunCursor cursor = parser.parse("run-1", 8L, "run-1:8");

        assertThat(cursor.runId()).isEqualTo("run-1");
        assertThat(cursor.afterSequence()).isEqualTo(8L);
    }

    @Test
    void headerWithZeroSequenceIsAcceptedForRunStart() {
        RunCursor cursor = parser.parse("run-1", null, "run-1:0");

        assertThat(cursor.runId()).isEqualTo("run-1");
        assertThat(cursor.afterSequence()).isZero();
    }
}
