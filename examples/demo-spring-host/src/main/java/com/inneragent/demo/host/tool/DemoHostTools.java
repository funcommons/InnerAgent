package com.inneragent.demo.host.tool;

import com.inneragent.demo.host.HostRecordStore;
import com.inneragent.starter.IaTool;
import com.inneragent.starter.IaToolParam;
import com.inneragent.starter.ToolRiskLevel;
import com.inneragent.starter.act.IaActClaims;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 演示宿主工具(P1 出口 U5/U1 旅程用):一只读、一写。
 *
 * <p>工具类非 Spring bean,由 starter 经 {@code inneragent.bridge.tool-packages}
 * 扫描实例化;@IaTool 方法在末参数注入验签后的 {@link IaActClaims}
 * (Filter → contextExtractor → McpTransportContext 全链,见 starter 职责②)。
 *
 * <p>[M1] 任务 18c 扩充(PRD 验收锚点):U2 商品简介读写(读直通/写确认 + 版本历史)、
 * U3 流程模板复制(WRITE,名字冲突 409 语义)、U5 登录记录查询(READ 直通,与 U1 对照)。
 */
public class DemoHostTools {

    private static final Logger log = LoggerFactory.getLogger(DemoHostTools.class);

    private final HostRecordStore store;

    public DemoHostTools(HostRecordStore store) {
        this.store = store;
    }

    /** U5 只读工具:返回宿主进程当前时间(READ,直通免确认)。 */
    @IaTool(name = "get_host_time", description = "查询宿主进程当前时间(演示只读工具)", riskLevel = ToolRiskLevel.READ)
    public Map<String, Object> getHostTime(
            @IaToolParam(value = "zone", description = "IANA 时区,缺省宿主时区", required = false) String zone,
            IaActClaims claims) {
        Map<String, Object> claimsView = claimsView(claims);
        this.store.observeInvocation("get_host_time", claimsView);
        ZoneId resolved = zone == null || zone.isBlank() ? ZoneId.systemDefault() : ZoneId.of(zone);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("time", OffsetDateTime.now(resolved).toString());
        result.put("timezone", resolved.getId());
        result.put("userId", claims.userId());
        result.put("runId", claims.runId());
        result.put("toolName", claims.toolName());
        log.info("[demo-host] get_host_time 执行(宿主进程内) claims={}", claimsView);
        return result;
    }

    /** U1 写工具:内存 Map 落一条记录并返回记录 id(WRITE,需确认)。 */
    @IaTool(name = "create_host_record", description = "在宿主内存中创建一条记录并返回记录 id(演示写工具)", riskLevel = ToolRiskLevel.WRITE)
    public Map<String, Object> createHostRecord(
            @IaToolParam(description = "记录标题") String title,
            @IaToolParam(value = "content", description = "记录内容", required = false) String content,
            IaActClaims claims) {
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title 不能为空");
        }
        Map<String, Object> claimsView = claimsView(claims);
        Map<String, Object> record = this.store.create(title, content, claimsView);
        this.store.observeInvocation("create_host_record", claimsView);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("recordId", record.get("recordId"));
        result.put("title", title);
        result.put("createdBy", claims.userId());
        result.put("runId", claims.runId());
        log.info("[demo-host] create_host_record 执行(宿主进程内) recordId={} claims={}",
                record.get("recordId"), claimsView);
        return result;
    }

    // ------------------------------------------------------------------
    // [M1] U2:商品简介读写(READ 直通 / WRITE 确认)
    // ------------------------------------------------------------------

    /** U2 读工具:查商品简介与版本号(READ,直通免确认)。 */
    @IaTool(name = "get_product_brief", description = "查询宿主内存商品表中的商品简介与当前版本号(演示只读工具)",
            riskLevel = ToolRiskLevel.READ)
    public Map<String, Object> getProductBrief(
            @IaToolParam(value = "productId", description = "商品 ID,如 88") String productId,
            IaActClaims claims) {
        Map<String, Object> claimsView = claimsView(claims);
        this.store.observeInvocation("get_product_brief", claimsView);
        Map<String, Object> product = this.store.product(productId);
        Map<String, Object> result = new LinkedHashMap<>();
        if (product == null) {
            result.put("status", "not_found");
            result.put("productId", productId);
            result.put("message", "商品不存在: " + productId);
            log.info("[demo-host] get_product_brief 未命中 productId={} claims={}", productId, claimsView);
            return result;
        }
        result.put("status", "ok");
        result.put("productId", product.get("productId"));
        result.put("name", product.get("name"));
        result.put("brief", product.get("brief"));
        result.put("briefVersion", product.get("briefVersion"));
        result.put("userId", claims.userId());
        result.put("runId", claims.runId());
        log.info("[demo-host] get_product_brief 执行(宿主进程内) productId={} claims={}", productId, claimsView);
        return result;
    }

    /**
     * U2 写工具:更新商品简介并 +1 版本、留版本历史(WRITE,需确认)。
     * PRD 场景 B:「这个产品的简介优化一下」的宿主回写落点。
     */
    @IaTool(name = "update_product_brief", description = "更新宿主内存商品表的商品简介,版本号 +1 并留版本历史(演示写工具)",
            riskLevel = ToolRiskLevel.WRITE)
    public Map<String, Object> updateProductBrief(
            @IaToolParam(value = "productId", description = "商品 ID,如 88") String productId,
            @IaToolParam(value = "brief", description = "优化后的商品简介") String brief,
            IaActClaims claims) {
        if (brief == null || brief.isBlank()) {
            throw new IllegalArgumentException("brief 不能为空");
        }
        Map<String, Object> claimsView = claimsView(claims);
        this.store.observeInvocation("update_product_brief", claimsView);
        Map<String, Object> product = this.store.updateProductBrief(productId, brief, claimsView);
        Map<String, Object> result = new LinkedHashMap<>();
        if (product == null) {
            result.put("status", "not_found");
            result.put("productId", productId);
            result.put("message", "商品不存在,未做任何修改: " + productId);
            log.info("[demo-host] update_product_brief 未命中 productId={} claims={}", productId, claimsView);
            return result;
        }
        result.put("status", "ok");
        result.put("productId", product.get("productId"));
        result.put("briefVersion", product.get("briefVersion"));
        result.put("historySize", ((java.util.List<?>) product.get("briefHistory")).size());
        result.put("updatedBy", claims.userId());
        result.put("runId", claims.runId());
        log.info("[demo-host] update_product_brief 执行(宿主进程内) productId={} version={} claims={}",
                productId, product.get("briefVersion"), claimsView);
        return result;
    }

    // ------------------------------------------------------------------
    // [M1] U3:流程模板复制(WRITE,名字冲突 409 语义)
    // ------------------------------------------------------------------

    /**
     * U3 写工具:源模板 → 新模板(节点全量复制 + 可选追加节点)。WRITE,需确认。
     * 目标名已存在时不执行复制,返回 {@code status=conflict} 与 HTTP 语义码 409
     * (结果结构化回灌模型,由模型/用户决定改名重试)。
     */
    @IaTool(name = "copy_flow_template", description = "以源流程模板为底稿复制出新流程模板,可追加一个节点;目标名已存在则返回冲突(演示写工具)",
            riskLevel = ToolRiskLevel.WRITE)
    public Map<String, Object> copyFlowTemplate(
            @IaToolParam(value = "sourceTemplateId", description = "源流程模板 ID,如 3432") String sourceTemplateId,
            @IaToolParam(value = "newTemplateName", description = "新流程模板名称(不可与既有模板重名)") String newTemplateName,
            @IaToolParam(value = "extraNode", description = "追加到流程末尾的节点名(可空)", required = false) String extraNode,
            IaActClaims claims) {
        if (newTemplateName == null || newTemplateName.isBlank()) {
            throw new IllegalArgumentException("newTemplateName 不能为空");
        }
        Map<String, Object> claimsView = claimsView(claims);
        this.store.observeInvocation("copy_flow_template", claimsView);
        Map<String, Object> result = new LinkedHashMap<>();
        if (this.store.flowTemplateNameExists(newTemplateName.trim())) {
            result.put("status", "conflict");
            result.put("code", 409);
            result.put("message", "模板名已存在,复制未执行: " + newTemplateName.trim());
            result.put("newTemplateName", newTemplateName.trim());
            log.info("[demo-host] copy_flow_template 名字冲突(409 语义) name={} claims={}",
                    newTemplateName.trim(), claimsView);
            return result;
        }
        Map<String, Object> copy = this.store.copyFlowTemplate(sourceTemplateId, newTemplateName.trim(), extraNode, claimsView);
        if (copy == null) {
            result.put("status", "not_found");
            result.put("sourceTemplateId", sourceTemplateId);
            result.put("message", "源模板不存在,未复制: " + sourceTemplateId);
            log.info("[demo-host] copy_flow_template 未命中 sourceTemplateId={} claims={}", sourceTemplateId, claimsView);
            return result;
        }
        result.put("status", "ok");
        result.put("sourceTemplateId", sourceTemplateId);
        result.put("newTemplateId", copy.get("templateId"));
        result.put("newTemplateName", copy.get("name"));
        result.put("nodeCount", ((java.util.List<?>) copy.get("nodes")).size());
        result.put("extraNode", extraNode == null || extraNode.isBlank() ? null : extraNode);
        result.put("copiedBy", claims.userId());
        result.put("runId", claims.runId());
        log.info("[demo-host] copy_flow_template 执行(宿主进程内) newTemplateId={} claims={}",
                copy.get("templateId"), claimsView);
        return result;
    }

    // ------------------------------------------------------------------
    // [M1] U5:登录记录查询(READ,只读直通,与 U1 写确认对照)
    // ------------------------------------------------------------------

    /** U5 读工具:登录记录查询,支持 userId 过滤与时间窗口(READ,直通免确认)。 */
    @IaTool(name = "list_login_records", description = "查询宿主内存登录记录,支持按 userId 过滤与最近 N 天窗口(演示只读工具)",
            riskLevel = ToolRiskLevel.READ)
    public Map<String, Object> listLoginRecords(
            @IaToolParam(value = "userId", description = "按用户 ID 过滤(可空=全部)", required = false) String userId,
            @IaToolParam(value = "days", description = "最近多少天,缺省 30", required = false) Integer days,
            @IaToolParam(value = "limit", description = "最多返回条数,缺省 20", required = false) Integer limit,
            IaActClaims claims) {
        Map<String, Object> claimsView = claimsView(claims);
        this.store.observeInvocation("list_login_records", claimsView);
        int windowDays = days == null || days <= 0 ? 30 : days;
        int maxRows = limit == null || limit <= 0 ? 20 : limit;
        java.util.List<Map<String, Object>> matched = this.store.loginRecords(userId, windowDays, maxRows);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("count", matched.size());
        result.put("windowDays", windowDays);
        result.put("filterUserId", userId == null || userId.isBlank() ? null : userId.trim());
        result.put("records", matched);
        result.put("userId", claims.userId());
        result.put("runId", claims.runId());
        log.info("[demo-host] list_login_records 执行(宿主进程内) filter={} window={}d hit={} claims={}",
                userId, windowDays, matched.size(), claimsView);
        return result;
    }

    private static Map<String, Object> claimsView(IaActClaims claims) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("userId", claims.userId());
        view.put("actSub", claims.actSub());
        view.put("runId", claims.runId());
        view.put("appKey", claims.appKey());
        view.put("tenantId", claims.tenantId());
        view.put("toolName", claims.toolName());
        return view;
    }

}
