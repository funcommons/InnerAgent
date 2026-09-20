package com.inneragent.agent.tool.builtin;

import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.inneragent.agent.tool.ToolExecutionContext;
import com.inneragent.agent.tool.ToolExecutor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

/**
 * 内置只读工具:查询当前时间(工具名 {@code get_current_time})。
 * <p>
 * P0 冒烟/演示链路的内置工具之一:只读、并发安全、低风险(READ_ONLY 自动放行),
 * 不依赖任何业务表与外部服务,任何用户都可以安全调用。
 * <p>
 * 入参为可选的 IANA 时区 ID;缺省时使用应用时区({@code app.time-zone})。
 * 返回 JSON:{@code {"status":"success","timezone":"Asia/Shanghai","time":"<ISO-8601>","epochMillis":...}}。
 */
@Component
public class CurrentTimeToolExecutor implements ToolExecutor {

    private static final DateTimeFormatter ISO_OFFSET =
            DateTimeFormatter.ISO_OFFSET_DATE_TIME;

    private final ZoneId defaultZone;

    public CurrentTimeToolExecutor(
            @Value("${app.time-zone:Asia/Shanghai}") String timeZone) {
        this.defaultZone = parseZone(timeZone, ZoneId.systemDefault());
    }

    @Override
    public String getToolName() {
        return "get_current_time";
    }

    @Override
    public String getDisplayName() {
        return "查询当前时间";
    }

    @Override
    public String getToolDescription() {
        return "查询当前时间。入参为可选的 IANA 时区 ID(如 Asia/Shanghai),"
                + "缺省使用应用时区;返回 ISO-8601 格式的当前时间与应用时区。";
    }

    @Override
    public String getParametersSchema() {
        return """
                {
                  "type": "object",
                  "properties": {
                    "timezone": {
                      "type": "string",
                      "description": "可选 IANA 时区 ID(如 Asia/Shanghai、UTC),缺省使用应用时区"
                    }
                  },
                  "additionalProperties": false
                }""";
    }

    @Override
    public boolean isReadOnly() {
        return true;
    }

    @Override
    public boolean isConcurrencySafe() {
        return true;
    }

    @Override
    public String execute(String toolInput, ToolExecutionContext context) {
        ZoneId zone = defaultZone;
        if (StrUtil.isNotBlank(toolInput)) {
            try {
                JSONObject input = JSONUtil.parseObj(toolInput);
                String requestedZone = input.getStr("timezone");
                if (StrUtil.isNotBlank(requestedZone)) {
                    zone = parseZone(requestedZone, null);
                    if (zone == null) {
                        return error("非法时区 ID: " + requestedZone);
                    }
                }
            } catch (Exception invalidInput) {
                return error("入参不是合法 JSON 对象");
            }
        }
        Instant now = Instant.now();
        ZonedDateTime zoned = now.atZone(zone);
        return JSONUtil.createObj()
                .set("status", "success")
                .set("timezone", zone.getId())
                .set("time", ISO_OFFSET.format(zoned))
                .set("epochMillis", now.toEpochMilli())
                .toString();
    }

    private static ZoneId parseZone(String zoneId, ZoneId fallback) {
        if (StrUtil.isBlank(zoneId)) {
            return fallback;
        }
        try {
            return ZoneId.of(zoneId.trim());
        } catch (Exception invalidZone) {
            return fallback;
        }
    }

    private static String error(String message) {
        return JSONUtil.createObj()
                .set("status", "error")
                .set("message", message)
                .toString();
    }
}
