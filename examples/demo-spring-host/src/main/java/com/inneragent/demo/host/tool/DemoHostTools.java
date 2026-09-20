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
 * 扫描实例化;@IaTool 方法在第 4 参数注入验签后的 {@link IaActClaims}
 * (Filter → contextExtractor → McpTransportContext 全链,见 starter 职责②)。
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
