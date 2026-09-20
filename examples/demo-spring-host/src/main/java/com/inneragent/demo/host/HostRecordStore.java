package com.inneragent.demo.host;

import java.time.Instant;
import java.util.LinkedHashMap;
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
 */
@Component
public class HostRecordStore {

    private final Map<String, Map<String, Object>> records = new ConcurrentHashMap<>();
    private final AtomicLong sequence = new AtomicLong();
    private final Map<String, AtomicLong> invocations = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> lastClaims = new ConcurrentHashMap<>();

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

    public Map<String, Object> snapshot() {
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("records", new LinkedHashMap<>(this.records));
        state.put("recordCount", this.records.size());
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

}
