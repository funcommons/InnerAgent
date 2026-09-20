package com.inneragent.platform.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 异步任务执行器装配([adapt] 自融光 config/AsyncConfig.java,按域裁剪)。
 *
 * <p>仅保留 Agent 工作区迁移执行器(单线程 + 有界队列,迁移任务串行执行);
 * 融光的 videoComposeExecutor(ffmpeg 合成域)与 mvcAsyncExecutor(本项目无消费者)
 * 未移植。本项目无 @Async 方法,故不需要 @EnableAsync。
 */
@Configuration(proxyBeanMethods = false)
public class AsyncConfig {

    private static final int AGENT_WORKSPACE_MIGRATION_QUEUE_CAPACITY = 8;

    @Bean(name = "agentWorkspaceMigrationExecutor")
    public ThreadPoolTaskExecutor agentWorkspaceMigrationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(AGENT_WORKSPACE_MIGRATION_QUEUE_CAPACITY);
        executor.setThreadNamePrefix("agent-workspace-migration-");
        executor.setWaitForTasksToCompleteOnShutdown(false);
        return executor;
    }
}
