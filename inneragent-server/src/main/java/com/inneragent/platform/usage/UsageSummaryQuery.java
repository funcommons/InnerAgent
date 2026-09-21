package com.inneragent.platform.usage;

import java.time.LocalDateTime;

/**
 * 用量聚合查询条件(admin {@code /ia/api/v1/admin/usage/summary};全部
 * 可选,缺省为全量窗口)。
 *
 * @param appId              应用过滤(冗余显式条件;行级拦截器已按缺省应用注入)
 * @param userId             用户过滤(联查 ia_agent_run.user_id)
 * @param from               起始时间(含,按模型调用 started_at)
 * @param to                 截止时间(不含)
 * @param granularityFormat  统计周期 to_char 格式(服务层收敛 DAY/MONTH 常量)
 */
public record UsageSummaryQuery(
        Long appId,
        Long userId,
        LocalDateTime from,
        LocalDateTime to,
        String granularityFormat) {
}
