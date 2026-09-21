package com.inneragent.platform.kb;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * mini 知识库装配(P4-W14):注册 {@link KbProperties};检索配置解析、
 * 摄取/检索服务、内核端口适配为普通组件扫描覆盖。
 */
@Configuration
@EnableConfigurationProperties(KbProperties.class)
public class KbConfiguration {
}
