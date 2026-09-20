package com.inneragent.demo.host;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/**
 * 内存记录仓 + 工具调用观测台(演示宿主唯一「业务状态」)。
 *
 * <p>create_host_record 写入的记录存内存 Map(进程内证据:工具确在宿主进程执行);
 * 同时记录每个工具最近一次调用的验签后 act claims 与调用次数,经
 * {@code GET /ia-demo/state} 暴露,供 E2E 旅程脚本断言(宿主侧 act token 证据)。
 *
 * <p>[M1] 任务 18c 扩充(PRD 验收锚点 U2/U3/U5):内存商品表(简介 + 版本历史)、
 * 流程模板表(模板复制)、登录记录表(只读查询)。全部进程内存态,宿主重启即复位,
 * 旅程断言一律用「前→后」相对值,保证脚本可复跑。
 */
@Component
public class HostRecordStore {

    private final Map<String, Map<String, Object>> records = new ConcurrentHashMap<>();
    private final AtomicLong sequence = new AtomicLong();
    private final Map<String, AtomicLong> invocations = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> lastClaims = new ConcurrentHashMap<>();

    /** [M1] 内存商品表:productId → 商品(含简介版本号与版本历史)。 */
    private final Map<String, Map<String, Object>> products = new ConcurrentHashMap<>();

    /** [M1] 流程模板表:templateId → 模板(name 唯一,复制用)。 */
    private final Map<String, Map<String, Object>> flowTemplates = new ConcurrentHashMap<>();

    /** [M1] 登录记录表(只读查询用;进程启动时按相对时间生成,重启复位)。 */
    private final List<Map<String, Object>> loginRecords = new ArrayList<>();

    /** [M1] 模板/登录记录主键序列。 */
    private final AtomicLong templateSequence = new AtomicLong(3400);

    public HostRecordStore() {
        seedProducts();
        seedFlowTemplates();
        seedLoginRecords();
    }

    // ------------------------------------------------------------------
    // U1:宿主记录(既有)
    // ------------------------------------------------------------------

    /** create_host_record 的写入动作(内存「落库」)。 */
    public Map<String, Object> create(String title, String content, Map<String, Object> actClaims) {
        String recordId = "rec-" + this.sequence.incrementAndGet();
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("recordId", recordId);
        record.put("title", title);
        record.put("content", content == null ? "" : content);
        record.put("createdBy", actClaims.get("userId"));
        record.put("createdByRun", actClaims.get("runId"));
        record.put("createdAt", Instant.now().toString());
        this.records.put(recordId, record);
        return record;
    }

    public Map<String, Object> find(String recordId) {
        return this.records.get(recordId);
    }

    public int recordCount() {
        return this.records.size();
    }

    // ------------------------------------------------------------------
    // [M1] U2:商品简介读写(更新留版本历史)
    // ------------------------------------------------------------------

    /** 兜底商品(找不到 productId 时的只读展示)。 */
    public Map<String, Object> product(String productId) {
        return this.products.get(String.valueOf(productId));
    }

    public int productCount() {
        return this.products.size();
    }

    /**
     * U2 写路径:更新商品简介,版本号 +1 并追加版本历史(谁改的/哪个 run 改的)。
     * 商品不存在返回 null(工具层转结构化错误)。
     */
    public Map<String, Object> updateProductBrief(String productId, String brief, Map<String, Object> actClaims) {
        Map<String, Object> product = product(productId);
        if (product == null) {
            return null;
        }
        int previousVersion = ((Number) product.get("briefVersion")).intValue();
        int newVersion = previousVersion + 1;
        String updatedAt = Instant.now().toString();
        product.put("brief", brief);
        product.put("briefVersion", newVersion);
        product.put("updatedAt", updatedAt);
        Map<String, Object> historyEntry = new LinkedHashMap<>();
        historyEntry.put("version", newVersion);
        historyEntry.put("brief", brief);
        historyEntry.put("updatedBy", actClaims.get("userId"));
        historyEntry.put("updatedByRun", actClaims.get("runId"));
        historyEntry.put("updatedAt", updatedAt);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> history = (List<Map<String, Object>>) product.get("briefHistory");
        history.add(historyEntry);
        return product;
    }

    // ------------------------------------------------------------------
    // [M1] U3:流程模板复制(名字冲突 = 409 语义)
    // ------------------------------------------------------------------

    public Map<String, Object> flowTemplate(String templateId) {
        return this.flowTemplates.get(String.valueOf(templateId));
    }

    public int flowTemplateCount() {
        return this.flowTemplates.size();
    }

    /** 模板名是否已存在(U3 复制目标名冲突检测)。 */
    public boolean flowTemplateNameExists(String name) {
        return this.flowTemplates.values().stream()
                .anyMatch(template -> name.equals(template.get("name")));
    }

    /**
     * U3 写路径:源模板 → 新模板(节点全量复制 + 可选追加节点)。
     * 调用方先过 {@link #flowTemplateNameExists}(409 语义),本方法不做重名兜底。
     */
    public Map<String, Object> copyFlowTemplate(
            String sourceTemplateId, String newTemplateName, String extraNode, Map<String, Object> actClaims) {
        Map<String, Object> source = flowTemplate(sourceTemplateId);
        if (source == null) {
            return null;
        }
        @SuppressWarnings("unchecked")
        List<String> sourceNodes = (List<String>) source.get("nodes");
        List<String> nodes = new ArrayList<>(sourceNodes);
        if (extraNode != null && !extraNode.isBlank()) {
            nodes.add(extraNode);
        }
        String newTemplateId = "tpl-" + this.templateSequence.incrementAndGet();
        Map<String, Object> copy = new LinkedHashMap<>();
        copy.put("templateId", newTemplateId);
        copy.put("name", newTemplateName);
        copy.put("nodes", nodes);
        copy.put("copiedFrom", source.get("templateId"));
        copy.put("copiedBy", actClaims.get("userId"));
        copy.put("copiedByRun", actClaims.get("runId"));
        copy.put("createdAt", Instant.now().toString());
        this.flowTemplates.put(newTemplateId, copy);
        return copy;
    }

    // ------------------------------------------------------------------
    // [M1] U5:登录记录查询(只读直通)
    // ------------------------------------------------------------------

    /**
     * U5 读路径:按 userId(可空=全部)与天数窗口过滤登录记录,最多 limit 条。
     * 记录按时间倒序生成(新的在前),此处保序截取。
     */
    public List<Map<String, Object>> loginRecords(String userId, int days, int limit) {
        Instant since = Instant.now().minusSeconds((long) days * 24 * 3600);
        List<Map<String, Object>> matched = new ArrayList<>();
        for (Map<String, Object> record : this.loginRecords) {
            if (userId != null && !userId.isBlank()
                    && !String.valueOf(record.get("userId")).equals(userId.trim())) {
                continue;
            }
            Instant loggedAt = Instant.parse((String) record.get("loggedAt"));
            if (loggedAt.isBefore(since)) {
                continue;
            }
            matched.add(record);
            if (matched.size() >= limit) {
                break;
            }
        }
        return matched;
    }

    public int loginRecordCount() {
        return this.loginRecords.size();
    }

    // ------------------------------------------------------------------
    // 观测台(snapshot 供 /ia-demo/state 与旅程断言)
    // ------------------------------------------------------------------

    public Map<String, Object> snapshot() {
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("records", new LinkedHashMap<>(this.records));
        state.put("recordCount", this.records.size());
        state.put("products", deepCopy(this.products));
        state.put("productCount", this.products.size());
        state.put("flowTemplates", deepCopy(this.flowTemplates));
        state.put("flowTemplateCount", this.flowTemplates.size());
        state.put("loginRecordCount", this.loginRecords.size());
        Map<String, Long> counts = new LinkedHashMap<>();
        this.invocations.forEach((tool, counter) -> counts.put(tool, counter.get()));
        state.put("invocations", counts);
        state.put("lastClaims", new LinkedHashMap<>(this.lastClaims));
        return state;
    }

    /** 工具侧观测打点:每个工具进入时记录 claims(供宿主侧 act 证据断言)。 */
    public void observeInvocation(String toolName, Map<String, Object> actClaims) {
        this.invocations.computeIfAbsent(toolName, ignored -> new AtomicLong()).incrementAndGet();
        this.lastClaims.put(toolName, new LinkedHashMap<>(actClaims));
    }

    // ------------------------------------------------------------------
    // 种子数据(演示/验收用;进程内存态,重启复位)
    // ------------------------------------------------------------------

    private void seedProducts() {
        seedProduct("88", "便携磁吸充电宝", "大容量磁吸无线充电宝,支持 20W 快充,一贴即充,出差通勤随身备。",
                "2026-09-01 由运营创建");
        seedProduct("129", "降噪头戴耳机", "主动降噪头戴耳机,40 小时续航,双设备同时连接,通勤与办公皆宜。",
                "2026-09-03 由运营创建");
        seedProduct("306", "多功能桌面支架", "铝合金桌面支架,四档高度调节,兼容手机与平板,走线隐藏设计。",
                "2026-09-05 由运营创建");
    }

    private void seedProduct(String productId, String name, String brief, String createdAt) {
        Map<String, Object> product = new LinkedHashMap<>();
        product.put("productId", productId);
        product.put("name", name);
        product.put("brief", brief);
        product.put("briefVersion", 1);
        product.put("createdAt", createdAt);
        product.put("updatedAt", createdAt);
        List<Map<String, Object>> history = new ArrayList<>();
        Map<String, Object> initial = new LinkedHashMap<>();
        initial.put("version", 1);
        initial.put("brief", brief);
        initial.put("updatedBy", "seed");
        initial.put("updatedAt", createdAt);
        history.add(initial);
        product.put("briefHistory", history);
        this.products.put(productId, product);
    }

    private void seedFlowTemplates() {
        seedFlowTemplate("3432", "标准客服流程", List.of("受理", "分类分级", "处理", "回访"));
        seedFlowTemplate("3433", "轻量咨询流程", List.of("受理", "处理", "回访"));
    }

    private void seedFlowTemplate(String templateId, String name, List<String> nodes) {
        Map<String, Object> template = new LinkedHashMap<>();
        template.put("templateId", templateId);
        template.put("name", name);
        template.put("nodes", new ArrayList<>(nodes));
        template.put("createdAt", "2026-09-01 由运营创建");
        this.flowTemplates.put(templateId, template);
    }

    /** 登录记录:12993(主验证用户)近 30 天 12 条,10001/12994 各 2 条,时间倒序。 */
    private void seedLoginRecords() {
        String[][] seeds = {
                // userId, daysAgo, ip, device, outcome
                {"12993", "0", "203.0.113.7", "iOS App", "success"},
                {"12993", "1", "203.0.113.7", "iOS App", "success"},
                {"12993", "3", "198.51.100.4", "Web Chrome", "success"},
                {"12993", "6", "198.51.100.4", "Web Chrome", "success"},
                {"12993", "9", "203.0.113.9", "Android App", "success"},
                {"12993", "12", "203.0.113.9", "Android App", "failed"},
                {"12993", "15", "198.51.100.8", "Web Safari", "success"},
                {"12993", "19", "198.51.100.8", "Web Safari", "success"},
                {"12993", "23", "203.0.113.12", "iOS App", "success"},
                {"12993", "26", "203.0.113.12", "iOS App", "success"},
                {"12993", "29", "198.51.100.21", "Web Chrome", "success"},
                {"12993", "44", "198.51.100.21", "Web Chrome", "success"},
                {"10001", "2", "192.0.2.30", "Web Chrome", "success"},
                {"10001", "18", "192.0.2.30", "Web Chrome", "success"},
                {"12994", "4", "192.0.2.55", "Android App", "success"},
                {"12994", "21", "192.0.2.55", "Android App", "failed"},
        };
        for (String[] seed : seeds) {
            Map<String, Object> record = new LinkedHashMap<>();
            record.put("recordId", "login-" + (this.loginRecords.size() + 1));
            record.put("userId", seed[0]);
            record.put("loggedAt", Instant.now().minusSeconds(Long.parseLong(seed[1]) * 24 * 3600).toString());
            record.put("ip", seed[2]);
            record.put("device", seed[3]);
            record.put("outcome", seed[4]);
            this.loginRecords.add(record);
        }
    }

    private static Map<String, Map<String, Object>> deepCopy(Map<String, Map<String, Object>> source) {
        Map<String, Map<String, Object>> copy = new LinkedHashMap<>();
        source.forEach((key, value) -> copy.put(key, new LinkedHashMap<>(value)));
        return copy;
    }

}
