package fun.commons.acmedemo.tool;

import com.inneragent.starter.IaTool;
import com.inneragent.starter.IaToolParam;
import com.inneragent.starter.ToolRiskLevel;
import com.inneragent.starter.act.IaActClaims;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * ACME 宿主业务工具 —— 销售数据查询(ops-analyst 场景配套桥工具,READ)。
 *
 * <p>与 {@link AcmeTicketTools} 同一接入范式:@IaTool 声明能力,starter 扫描
 * 注册进进程内 MCP server(/ia-mcp),InnerAgent 经宿主桥调用;READ 风险级
 * 在 DEFAULT 档位自动执行不打扰用户。数据为内存仿真(重启即清),内置
 * 华东/华北/华南 三区域 × 近 6 个月 × 双产品的模拟销售额,足够演示
 * 「main 定义引用 sub Agent 查数 → 汇总上报」的子 Agent 编排链路。
 */
@Component
public class AcmeSalesTools {

    /** 内存仿真数据:月份 → 区域 → (产品 → 销售额,元);重启即清(DEMO 语义)。 */
    private final Map<String, Map<String, Map<String, Long>>> monthlySales =
            new ConcurrentHashMap<>();

    public AcmeSalesTools() {
        seed("2026-04", "华东", Map.of("智能门锁", 1_286_000L, "扫地机器人", 962_000L));
        seed("2026-04", "华北", Map.of("智能门锁", 733_000L, "扫地机器人", 511_000L));
        seed("2026-04", "华南", Map.of("智能门锁", 640_000L, "扫地机器人", 428_000L));
        seed("2026-05", "华东", Map.of("智能门锁", 1_190_000L, "扫地机器人", 1_020_000L));
        seed("2026-05", "华北", Map.of("智能门锁", 705_000L, "扫地机器人", 562_000L));
        seed("2026-05", "华南", Map.of("智能门锁", 668_000L, "扫地机器人", 455_000L));
        seed("2026-06", "华东", Map.of("智能门锁", 1_352_000L, "扫地机器人", 1_108_000L));
        seed("2026-06", "华北", Map.of("智能门锁", 796_000L, "扫地机器人", 604_000L));
        seed("2026-06", "华南", Map.of("智能门锁", 712_000L, "扫地机器人", 490_000L));
        seed("2026-07", "华东", Map.of("智能门锁", 1_415_000L, "扫地机器人", 1_244_000L));
        seed("2026-07", "华北", Map.of("智能门锁", 821_000L, "扫地机器人", 649_000L));
        seed("2026-07", "华南", Map.of("智能门锁", 758_000L, "扫地机器人", 533_000L));
        seed("2026-08", "华东", Map.of("智能门锁", 1_508_000L, "扫地机器人", 1_371_000L));
        seed("2026-08", "华北", Map.of("智能门锁", 864_000L, "扫地机器人", 702_000L));
        seed("2026-08", "华南", Map.of("智能门锁", 795_000L, "扫地机器人", 588_000L));
        seed("2026-09", "华东", Map.of("智能门锁", 1_642_000L, "扫地机器人", 1_456_000L));
        seed("2026-09", "华北", Map.of("智能门锁", 903_000L, "扫地机器人", 761_000L));
        seed("2026-09", "华南", Map.of("智能门锁", 838_000L, "扫地机器人", 634_000L));
    }

    /**
     * 查询 ACME 销售数据(READ):可选按月份(YYYY-MM)与区域过滤,返回
     * 逐行明细 + 合计;数据由宿主内存仿真,区域/月份不存在时按空结果返回。
     */
    @IaTool(name = "query_sales",
            description = "查询 ACME 销售数据(区域×月份×产品销售额,单位元);"
                    + "可选按 month(YYYY-MM,支持 2026-04 至 2026-09)与 region"
                    + "(华东/华北/华南)过滤,返回明细行与合计汇总",
            riskLevel = ToolRiskLevel.READ)
    public Map<String, Object> querySales(
            @IaToolParam(value = "month", description = "月份,YYYY-MM(如 2026-09);缺省=全部月份",
                    required = false) String month,
            @IaToolParam(value = "region", description = "区域:华东/华北/华南;缺省=全部区域",
                    required = false) String region,
            IaActClaims claims) {
        String wantMonth = normalize(month);
        if (wantMonth != null && !monthlySales.containsKey(wantMonth)) {
            return error("month " + wantMonth + " 无数据(可用范围 2026-04 至 2026-09),未执行查询");
        }
        String wantRegion = normalize(region);
        List<Map<String, Object>> rows = rowsOf(wantMonth, wantRegion);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("count", rows.size());
        result.put("rows", rows);
        result.put("totalAmount", rows.stream()
                .mapToLong(row -> (Long) row.get("amount")).sum());
        result.put("filters", Map.of(
                "month", wantMonth == null ? "全部" : wantMonth,
                "region", wantRegion == null ? "全部" : wantRegion));
        result.put("queriedBy", claims.userId());
        return result;
    }

    // ---------- 内部装配(明细行按月份升序,便于趋势观察) ----------

    private List<Map<String, Object>> rowsOf(String wantMonth, String wantRegion) {
        Map<String, Long> ordered = new TreeMap<>();
        for (var byMonth : monthlySales.entrySet()) {
            if (wantMonth != null && !wantMonth.equals(byMonth.getKey())) {
                continue;
            }
            for (var byRegion : byMonth.getValue().entrySet()) {
                if (wantRegion != null && !wantRegion.equals(byRegion.getKey())) {
                    continue;
                }
                byRegion.getValue().forEach((product, amount) ->
                        ordered.merge(byMonth.getKey() + "|" + byRegion.getKey() + "|" + product,
                                amount, Long::sum));
            }
        }
        return ordered.entrySet().stream().map(entry -> {
            String[] parts = entry.getKey().split("\\|", -1);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("month", parts[0]);
            row.put("region", parts[1]);
            row.put("product", parts[2]);
            row.put("amount", entry.getValue());
            return row;
        }).toList();
    }

    private void seed(String month, String region, Map<String, Long> products) {
        monthlySales.computeIfAbsent(month, ignored -> new ConcurrentHashMap<>())
                .put(region, new LinkedHashMap<>(products));
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }

    /** 平台 status 契约:业务性失败返回 error 回灌模型可续跑,文案陈述后果。 */
    private static Map<String, Object> error(String message) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", "error");
        out.put("message", message);
        out.put("totalAmount", 0L);
        out.put("count", 0);
        return out;
    }
}
