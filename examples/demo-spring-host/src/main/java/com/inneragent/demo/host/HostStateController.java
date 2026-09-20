package com.inneragent.demo.host;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 宿主内存状态观测端点(仅演示/验收用):暴露记录、调用计数与最近一次
 * 验签后 act claims —— 旅程脚本据此断言「工具在宿主进程执行」与
 * 「/ia-mcp 请求携带验签通过的 X-IA-Act」。
 */
@RestController
public class HostStateController {

    private final HostRecordStore store;

    public HostStateController(HostRecordStore store) {
        this.store = store;
    }

    @GetMapping("/ia-demo/state")
    public ResponseEntity<Map<String, Object>> state() {
        return ResponseEntity.ok(this.store.snapshot());
    }

}
