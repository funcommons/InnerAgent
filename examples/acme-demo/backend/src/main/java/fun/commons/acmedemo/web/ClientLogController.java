package fun.commons.acmedemo.web;

import fun.commons.acmedemo.common.R;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * [E2 · P3 2026-09-27] 前端控制台错误遥测:demo 前端全局 error /
 * unhandledrejection / console.error 钩子经此上报;内存环形缓冲(最近 100 条)
 * 供演示现场问题回放,GET /recent 便于排查。免登录(错误可能发生在登录前,
 * 与 /api/demo/config 同口径);遥测内容仅限消息/栈/URL,不收用户输入值。
 */
@RestController
@RequestMapping("/api/demo/client-log")
@Slf4j
public class ClientLogController {

    private static final int MAX_ENTRIES = 100;
    private static final int MAX_TEXT_LENGTH = 2000;

    private final ArrayDeque<Map<String, Object>> recent = new ArrayDeque<>();

    public record ClientLogEntry(String level, String message, String stack, String url) { }

    @PostMapping
    public R<Map<String, Object>> report(@RequestBody(required = false) ClientLogEntry entry) {
        ClientLogEntry safe = entry == null
                ? new ClientLogEntry("error", "(empty)", null, null)
                : entry;
        // Map.of 不允许 null 值:缺省字段以空串落库
        Map<String, Object> row = Map.of(
                "at", Instant.now().toString(),
                "level", safe.level() == null || safe.level().isBlank()
                        ? "error" : safe.level(),
                "message", truncateOrEmpty(safe.message()),
                "stack", truncateOrEmpty(safe.stack()),
                "url", truncateOrEmpty(safe.url()));
        synchronized (recent) {
            recent.addLast(row);
            while (recent.size() > MAX_ENTRIES) {
                recent.removeFirst();
            }
        }
        log.warn("[client-log] {}: {}", row.get("level"), row.get("message"));
        return R.ok(Map.of("accepted", true));
    }

    /** 最新在前(演示现场排查口径:最新错误最先看到)。 */
    @GetMapping("/recent")
    public synchronized R<List<Map<String, Object>>> recent() {
        List<Map<String, Object>> snapshot = List.copyOf(recent);
        return R.ok(List.copyOf(snapshot.reversed()));
    }

    private static String truncate(String value) {
        if (value == null) {
            return null;
        }
        return value.length() > MAX_TEXT_LENGTH
                ? value.substring(0, MAX_TEXT_LENGTH) : value;
    }

    private static String truncateOrEmpty(String value) {
        return value == null ? "" : truncate(value);
    }
}
