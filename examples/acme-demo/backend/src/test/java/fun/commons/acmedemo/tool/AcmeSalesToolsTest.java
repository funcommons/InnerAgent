package fun.commons.acmedemo.tool;

import static org.assertj.core.api.Assertions.assertThat;

import com.inneragent.starter.IaToolDefinition;
import com.inneragent.starter.act.IaActClaims;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * query_sales 桥工具(ops-analyst 场景配套)单元测试:
 * 过滤语义 / 汇总口径 / 错误契约(status=error 回灌可续跑,不抛异常)。
 */
class AcmeSalesToolsTest {

    private final AcmeSalesTools tools = new AcmeSalesTools();

    private static IaActClaims claims(String toolName) {
        return new IaActClaims("u-1001", "inneragent-run:run-1", "run-1",
                "acme-demo", "0", toolName);
    }

    @Test
    void 全量查询_返回全部明细与合计() {
        Map<String, Object> result = tools.querySales(null, null, claims("query_sales"));
        assertThat(result.get("status")).isEqualTo("ok");
        // 6 个月 × 3 区域 × 2 产品 = 36 行明细
        assertThat(result.get("count")).isEqualTo(36);
        assertThat(result.get("queriedBy")).isEqualTo("u-1001");
        long total = (Long) result.get("totalAmount");
        assertThat(total).isPositive();
    }

    @Test
    void 组合过滤_月份加区域_仅返回命中行() {
        Map<String, Object> result =
                tools.querySales("2026-09", "华东", claims("query_sales"));
        assertThat(result.get("status")).isEqualTo("ok");
        assertThat(result.get("count")).isEqualTo(2);
        @SuppressWarnings("unchecked")
        java.util.List<Map<String, Object>> rows =
                (java.util.List<Map<String, Object>>) result.get("rows");
        assertThat(rows).allSatisfy(row -> {
            assertThat(row.get("month")).isEqualTo("2026-09");
            assertThat(row.get("region")).isEqualTo("华东");
        });
        long rowSum = rows.stream().mapToLong(row -> (Long) row.get("amount")).sum();
        assertThat(result.get("totalAmount")).isEqualTo(rowSum);
    }

    @Test
    void 未知月份_错误契约回灌_不抛异常() {
        Map<String, Object> result = tools.querySales("2025-01", null, claims("query_sales"));
        assertThat(result.get("status")).isEqualTo("error");
        assertThat((String) result.get("message")).contains("2025-01").contains("未执行查询");
        assertThat(result.get("count")).isEqualTo(0);
    }

    @Test
    void 工具定义_READ风险级_声明为只读() throws Exception {
        IaToolDefinition definition = IaToolDefinition.of(
                AcmeSalesTools.class.getDeclaredMethod("querySales",
                        String.class, String.class, IaActClaims.class),
                new AcmeSalesTools());
        assertThat(definition.name()).isEqualTo("query_sales");
        assertThat(definition.riskLevel())
                .as("READ 工具 DEFAULT 档位自动执行,不进确认卡")
                .isEqualTo(com.inneragent.starter.ToolRiskLevel.READ);
    }
}
