package fun.commons.acmedemo.web;

import fun.commons.acmedemo.common.R;
import fun.commons.acmedemo.config.IaProperties;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 前端启动配置(公开值,免登录;安全责任划分语义同接入指南红线)。
 *
 * 只暴露 inneragentBaseUrl(SDK/WC 请求与 iframe 反代基址)、appKey(SDK init)
 * 与 agentType;密钥类字段(签名私钥/webhookSecret/adminKey)永不出现于此。
 */
@RestController
@RequestMapping("/api/demo")
@RequiredArgsConstructor
public class DemoConfigController {

    private final IaProperties props;

    @GetMapping("/config")
    public R<Map<String, Object>> config() {
        return R.ok(Map.of(
                "inneragentBaseUrl", props.getServerBase(),
                "appKey", props.getAppKey(),
                "agentType", props.getAgentType()));
    }
}
