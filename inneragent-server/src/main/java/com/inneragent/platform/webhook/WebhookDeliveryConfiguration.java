package com.inneragent.platform.webhook;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 终态 Webhook 装配(任务 #18b):属性绑定 + 投递调度。
 *
 * <p>@EnableScheduling 已由启动类开启,此处不重复;保留注解仅为表达
 * 本配置类即调度器所在模块的装配点。WebhookDeliveryService /
 * WebhookDeliveryScheduler 由类路径扫描注册。
 */
@Configuration
@EnableConfigurationProperties(WebhookDeliveryProperties.class)
public class WebhookDeliveryConfiguration {
}
