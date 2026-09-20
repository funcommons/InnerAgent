package com.inneragent;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * InnerAgent 微服务入口。
 *
 * <p>内核(会话/运行/事件日志/确认流/Skill/子 Agent/模型接入)自 ai-fusion-video 移植,
 * 包结构见技术方案 §4.1;业务工具一律经 MCP 从宿主应用接入,本项目不包含业务逻辑。
 */
@SpringBootApplication
@EnableCaching
@EnableScheduling
@MapperScan("com.inneragent.**.mapper")
public class InnerAgentApplication {

	public static void main(String[] args) {
		SpringApplication.run(InnerAgentApplication.class, args);
	}
}
