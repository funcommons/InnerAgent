package com.inneragent.demo.host;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * P1 出口验收演示宿主(开发计划 §2.6 公共测试资产的最小 Spring Boot 形态)。
 *
 * <p>「全新空白应用」接入面:starter 1 条依赖 + 本 yaml + 工具类若干
 * ({@code com.inneragent.demo.host.tool} 包,@IaTool 注解方法)。
 * starter 自动装配经 classpath 上的 AutoConfiguration.imports 生效,
 * 宿主零额外配置:servlet 桥(/ia-mcp,stateless)+ X-IA-Act 验签 Filter。
 */
@SpringBootApplication
public class DemoSpringHostApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoSpringHostApplication.class, args);
    }

}
