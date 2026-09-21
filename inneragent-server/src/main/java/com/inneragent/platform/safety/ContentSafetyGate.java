package com.inneragent.platform.safety;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Objects;

/**
 * 内容安全门面(P2-safety W6):挂点调用的唯一入口——执行过滤链 + 对
 * block/redact 落审计(ia_audit_log,decision=blocked/redacted、
 * decision_source=safety,V12 列宽已兼容)。
 *
 * <p>挂点语义:
 * <ul>
 *   <li><strong>ingress</strong>(用户消息入库前):block → 业务异常 400,
 *       文案为固定安全文案——<strong>不回显过滤器内部细节</strong>(真实原因
 *       只入审计);redact → 以脱敏文本继续入库(标题/运行初始消息/内核输入
 *       全部携带脱敏后文本);</li>
 *   <li><strong>egress</strong>(助手内容对外投递前):block → 内容替换为固定
 *       占位 + 审计;redact → 以脱敏文本替换 + 审计;allow 原样。</li>
 * </ul>
 * allow 不落审计(接入点审计只记干预动作,对齐「拒绝的调用留审计」口径,
 * 不放大审计量)。
 */
@Component
@Slf4j
public class ContentSafetyGate {

    /** ingress block 的固定安全文案(对外 400;不回显过滤器内部细节)。 */
    public static final String INGRESS_BLOCK_MESSAGE = "消息未通过内容安全检查,请调整后重试";

    /** egress block 的固定占位内容(替换原文本对外投递)。 */
    public static final String EGRESS_BLOCK_PLACEHOLDER = "[该内容因安全策略被拦截]";

    private final ContentSafetyChain chain;
    private final ToolAuditService auditService;

    public ContentSafetyGate(ContentSafetyChain chain, ToolAuditService auditService) {
        this.chain = Objects.requireNonNull(chain, "chain must not be null");
        this.auditService = Objects.requireNonNull(auditService, "auditService must not be null");
    }

    /**
     * ingress 过滤(用户消息入库前)。
     *
     * @return 入库文本(block 抛 400;redact 返回脱敏文本)
     */
    public String filterIngress(ContentSafetyFilter.Context context, String text) {
        ContentSafetyFilter.Verdict verdict = chain.check(
                ContentSafetyFilter.Direction.INGRESS, text, context);
        if (verdict instanceof ContentSafetyFilter.Verdict.Block block) {
            audit(context, "ingress", "blocked", text, block.reason());
            throw new BusinessException(400, INGRESS_BLOCK_MESSAGE);
        }
        if (verdict instanceof ContentSafetyFilter.Verdict.Redact redact) {
            audit(context, "ingress", "redacted", text, "ingress redaction");
            return redact.text();
        }
        return text;
    }

    /**
     * egress 过滤(助手内容对外投递前)。
     *
     * @return 对外文本(block → 固定占位;redact → 脱敏文本;allow 原样)
     */
    public String filterEgress(ContentSafetyFilter.Context context, String text) {
        ContentSafetyFilter.Verdict verdict = chain.check(
                ContentSafetyFilter.Direction.EGRESS, text, context);
        if (verdict instanceof ContentSafetyFilter.Verdict.Block block) {
            audit(context, "egress", "blocked", text, block.reason());
            return EGRESS_BLOCK_PLACEHOLDER;
        }
        if (verdict instanceof ContentSafetyFilter.Verdict.Redact redact) {
            audit(context, "egress", "redacted", text, "egress redaction");
            return redact.text();
        }
        return text;
    }

    /**
     * 干预动作审计。内容本身不入审计(避免审计表二次扩散被拦内容),以
     * SHA-256 指纹留痕;真实原因入 resultSummary 供管理面检索。
     */
    private void audit(ContentSafetyFilter.Context context, String direction,
                       String decision, String text, String reason) {
        String summary = "direction=" + direction
                + "; reason=" + reason
                + "; textSha256=" + sha256(text);
        try {
            auditService.append(new ToolAuditService.ToolAuditEntry(
                    context == null ? null : context.appId(),
                    null,
                    context == null ? null : context.userId(),
                    context == null ? null : context.conversationId(),
                    context == null ? null : context.runId(),
                    null,
                    decision,
                    ToolDecisionSource.SAFETY.code(),
                    null,
                    null,
                    summary,
                    null,
                    null));
        } catch (RuntimeException auditFailure) {
            // 审计 fail-closed(对齐 ToolAuditService 一致性原则):审计失败即业务失败
            log.error("内容安全审计写入失败: decision={}, cause={}",
                    decision, String.valueOf(auditFailure.getMessage()));
            throw auditFailure;
        }
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest((text == null ? "" : text).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
