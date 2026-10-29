package com.inneragent.platform.usage;

import java.time.LocalDateTime;

/**
 * 用量时序查询条件(admin {@code /ia/api/v1/admin/usage/timeseries})。
 *
 * @param from              起始时间(含,按模型调用 started_at)
 * @param to                截止时间(不含)
 * @param granularityFormat 统计周期 to_char 格式(服务层收敛 DAY → YYYY-MM-DD)
 * @param provider          服务商过滤(可选)
 * @param modelCode         模型代码过滤(可选)
 */
public record UsageTimeseriesQuery(
        LocalDateTime from,
        LocalDateTime to,
        String granularityFormat,
        String provider,
        String modelCode) {
}
