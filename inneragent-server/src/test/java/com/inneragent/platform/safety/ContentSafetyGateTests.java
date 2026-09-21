package com.inneragent.platform.safety;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.safety.ContentSafetyFilter.Context;
import com.inneragent.platform.safety.ContentSafetyFilter.Direction;
import com.inneragent.platform.safety.ContentSafetyFilter.Verdict;
import com.inneragent.platform.toolhub.ToolAuditService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 内容安全门面测试(W6):ingress/egress 两方向 × 三值裁决的外显行为 +
 * 审计(block/redact 落 ia_audit_log,decision_source=safety,内容仅指纹留痕)。
 */
class ContentSafetyGateTests {

    private static final Context CONTEXT = new Context(1L, 42L, "conv-7", "run-7");

    private ContentSafetyChain chain;
    private ToolAuditService auditService;
    private ContentSafetyGate gate;

    @BeforeEach
    void setUp() {
        chain = Mockito.mock(ContentSafetyChain.class);
        auditService = Mockito.mock(ToolAuditService.class);
        gate = new ContentSafetyGate(chain, auditService);
    }

    @Test
    @DisplayName("①ingress block → 400 固定安全文案(不回显内部原因)+ blocked 审计")
    void ingressBlockThrows400WithSafeMessage() {
        when(chain.check(eqDirection(Direction.INGRESS), any(), any()))
                .thenReturn(Verdict.block("内部规则 R-114 涉政命中"));

        assertThatThrownBy(() -> gate.filterIngress(CONTEXT, "敏感输入"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getCode())
                .isEqualTo(400);
        assertThatThrownBy(() -> gate.filterIngress(CONTEXT, "敏感输入"))
                .hasMessage(ContentSafetyGate.INGRESS_BLOCK_MESSAGE);

        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService, Mockito.times(2)).append(audit.capture());
        ToolAuditService.ToolAuditEntry entry = audit.getValue();
        assertThat(entry.decision()).isEqualTo("blocked");
        assertThat(entry.decisionSource()).isEqualTo("safety");
        assertThat(entry.resultSummary())
                .contains("direction=ingress")
                .contains("内部规则 R-114 涉政命中")
                .doesNotContain("敏感输入");
        assertThat(entry.conversationId()).isEqualTo("conv-7");
        assertThat(entry.userId()).isEqualTo(42L);
    }

    @Test
    @DisplayName("②ingress redact → 以脱敏文本入库 + redacted 审计")
    void ingressRedactReturnsFilteredText() {
        when(chain.check(eqDirection(Direction.INGRESS), any(), any()))
                .thenReturn(Verdict.redact("脱敏后输入"));

        String result = gate.filterIngress(CONTEXT, "原始输入");

        assertThat(result).isEqualTo("脱敏后输入");
        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("redacted");
        assertThat(audit.getValue().decisionSource()).isEqualTo("safety");
    }

    @Test
    @DisplayName("③ingress allow → 原样,不落审计")
    void ingressAllowSkipsAudit() {
        when(chain.check(eqDirection(Direction.INGRESS), any(), any()))
                .thenReturn(Verdict.allow());

        assertThat(gate.filterIngress(CONTEXT, "正常输入")).isEqualTo("正常输入");
        verify(auditService, never()).append(any());
    }

    @Test
    @DisplayName("④egress block → 固定占位 + blocked 审计(direction=egress)")
    void egressBlockReplacesWithPlaceholder() {
        when(chain.check(eqDirection(Direction.EGRESS), any(), any()))
                .thenReturn(Verdict.block("输出合规拦截"));

        String result = gate.filterEgress(CONTEXT, "模型违规输出");

        assertThat(result).isEqualTo(ContentSafetyGate.EGRESS_BLOCK_PLACEHOLDER);
        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("blocked");
        assertThat(audit.getValue().resultSummary()).contains("direction=egress");
        assertThat(audit.getValue().runId()).isEqualTo("run-7");
    }

    @Test
    @DisplayName("⑤egress redact → 脱敏文本;allow → 原样无审计")
    void egressRedactAndAllow() {
        when(chain.check(eqDirection(Direction.EGRESS), any(), any()))
                .thenReturn(Verdict.redact("安全内容"), Verdict.allow());

        assertThat(gate.filterEgress(CONTEXT, "原文A")).isEqualTo("安全内容");
        assertThat(gate.filterEgress(CONTEXT, "原文B")).isEqualTo("原文B");
        verify(auditService, Mockito.times(1)).append(any());
    }

    private static Direction eqDirection(Direction direction) {
        return Mockito.eq(direction);
    }
}
