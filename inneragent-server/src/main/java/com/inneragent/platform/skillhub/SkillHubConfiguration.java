package com.inneragent.platform.skillhub;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Skill 体系装配(P4-W13):仅注册 {@link SkillHubProperties};
 * 服务/控制器为普通 @Service/@RestController 组件扫描覆盖。
 */
@Configuration
@EnableConfigurationProperties(SkillHubProperties.class)
public class SkillHubConfiguration {
}
