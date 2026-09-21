package fun.commons.acmedemo.tool;

import com.inneragent.starter.IaTool;
import com.inneragent.starter.IaToolParam;
import com.inneragent.starter.ToolRiskLevel;
import com.inneragent.starter.act.IaActClaims;
import fun.commons.acmedemo.common.BizException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/**
 * ACME 宿主业务工具 —— 经 starter @IaTool 暴露给 InnerAgent 的演示能力
 * (接入指南步骤②;取代微剧场 DEMO 的「产片提交/轮询」演示位)。
 *
 * <p>InnerAgent 按 (appId, endpoint_url) 连到本进程的 /ia-mcp,每次
 * tools/call 附 60s X-IA-Act;starter 验签后把身份重建为 {@link IaActClaims},
 * 工具方法以此做行级校验(ADR-3:越权拦截由宿主工具侧执行)。
 *
 * <p>返回 Map 原样进 structuredContent;平台 status 契约:业务性失败返回
 * {@code {status:"error", message:…}} 回灌模型可续跑,拒绝文案必须陈述后果。
 * 存储为内存 Map,重启即清(DEMO 语义,与登录会话同边界)。
 */
@Component
public class AcmeTicketTools {

    private final Map<String, Map<String, Object>> tickets = new ConcurrentHashMap<>();
    private final AtomicLong seq = new AtomicLong(1000);

    /** 建单(WRITE):DEFAULT 档位先经用户确认卡批准后执行。 */
    @IaTool(name = "create_ticket",
            description = "在 ACME 宿主系统中创建一张工单,返回工单号;标题必填,优先级 low/normal/high",
            riskLevel = ToolRiskLevel.WRITE)
    public Map<String, Object> createTicket(
            @IaToolParam(value = "title", description = "工单标题,一句话概括问题") String title,
            @IaToolParam(value = "description", description = "工单详情描述", required = false) String description,
            @IaToolParam(value = "priority", description = "优先级:low/normal/high,缺省 normal", required = false) String priority,
            IaActClaims claims) {
        if (title == null || title.isBlank()) {
            // 平台 status 契约:错误回灌模型、可续跑;文案陈述后果(未建单)
            return error("title 为空,工单未创建;请向用户确认标题后重试");
        }
        String prio = priority == null || priority.isBlank() ? "normal" : priority.trim();
        if (!List.of("low", "normal", "high").contains(prio)) {
            return error("priority 必须为 low/normal/high(收到 " + prio + "),工单未创建");
        }
        String ticketId = "T-" + seq.incrementAndGet();
        Map<String, Object> ticket = new LinkedHashMap<>();
        ticket.put("ticketId", ticketId);
        ticket.put("title", title.trim());
        ticket.put("description", description == null ? "" : description.trim());
        ticket.put("priority", prio);
        ticket.put("status", "open");
        ticket.put("channel", "agent");
        ticket.put("createdBy", claims.userId());   // act token 重建的终端用户身份
        ticket.put("runId", claims.runId());
        tickets.put(ticketId, ticket);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("ticketId", ticketId);
        result.put("title", ticket.get("title"));
        result.put("priority", prio);
        result.put("createdBy", claims.userId());
        return result;
    }

    /** 查单(READ):readOnlyHint=true,DEFAULT 档位自动执行不打扰用户。 */
    @IaTool(name = "list_tickets",
            description = "列出 ACME 宿主系统中的工单(可选按状态过滤),返回工单号/标题/优先级/状态",
            riskLevel = ToolRiskLevel.READ)
    public Map<String, Object> listTickets(
            @IaToolParam(value = "status", description = "按状态过滤:open/done;缺省全部", required = false) String status,
            IaActClaims claims) {
        List<Map<String, Object>> rows = snapshot();
        if (status != null && !status.isBlank()) {
            String want = status.trim();
            rows = rows.stream().filter(t -> want.equals(t.get("status"))).toList();
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("count", rows.size());
        result.put("tickets", rows);
        result.put("queriedBy", claims.userId());
        return result;
    }

    /**
     * 约束范围反查(接入指南 §5):宿主在自己的 MCP 工具集中实现同名工具
     * 即视为「已实现」,InnerAgent 据此拿到当前上下文的可见域/可写域/禁止项;
     * 未实现也不危险(降级为写操作一律确认),实现后确认体验更顺。
     */
    @IaTool(name = "resolve_scope",
            description = "返回当前页面上下文的可见对象域/可写字段/禁止操作(宿主是协议最终裁决方)",
            riskLevel = ToolRiskLevel.READ)
    public Map<String, Object> resolveScope(
            @IaToolParam(value = "pageId", description = "宿主页面标识", required = false) String pageId,
            @IaToolParam(value = "objectId", description = "当前业务对象 ID", required = false) String objectId,
            @IaToolParam(value = "objectType", description = "当前业务对象类型", required = false) String objectType,
            IaActClaims claims) {
        Map<String, Object> scope = new LinkedHashMap<>();
        scope.put("visibleDomains", List.of("工单"));
        scope.put("writableFields", List.of("ticket.title", "ticket.description", "ticket.priority"));
        scope.put("forbidden", List.of("删除他人工单"));
        scope.put("hints", List.of("演示环境:userId=" + claims.userId() + " 仅可见工单域"));
        return scope;
    }

    // ---------- 宿主 REST 面与工具共用同一存储(工具调用演示页直读) ----------

    /** 直建(宿主自己的表单通道,不经 InnerAgent);校验失败抛 400。 */
    public Map<String, Object> createDirect(String title, String description, String priority, long userId) {
        if (title == null || title.isBlank()) {
            throw new BizException(400, "title 不能为空");
        }
        String prio = priority == null || priority.isBlank() ? "normal" : priority.trim();
        if (!List.of("low", "normal", "high").contains(prio)) {
            throw new BizException(400, "priority 必须为 low/normal/high");
        }
        String ticketId = "T-" + seq.incrementAndGet();
        Map<String, Object> ticket = new LinkedHashMap<>();
        ticket.put("ticketId", ticketId);
        ticket.put("title", title.trim());
        ticket.put("description", description == null ? "" : description.trim());
        ticket.put("priority", prio);
        ticket.put("status", "open");
        ticket.put("channel", "direct");
        ticket.put("createdBy", String.valueOf(userId));
        ticket.put("runId", "");
        tickets.put(ticketId, ticket);
        return snapshotRow(ticket);
    }

    /** 全量快照(新→旧),供 REST 轮询与 list_tickets 共用。 */
    public List<Map<String, Object>> snapshot() {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> t : tickets.values()) {
            rows.add(snapshotRow(t));
        }
        rows.sort(Comparator.comparing((Map<String, Object> r) -> (String) r.get("ticketId")).reversed());
        return rows;
    }

    private static Map<String, Object> snapshotRow(Map<String, Object> ticket) {
        return new LinkedHashMap<>(ticket);
    }

    private static Map<String, Object> error(String message) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", "error");
        out.put("message", message);
        return out;
    }
}
