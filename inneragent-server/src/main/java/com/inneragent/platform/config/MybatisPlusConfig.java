package com.inneragent.platform.config;

import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * MyBatis-Plus 拦截器装配：双列行级隔离 + 分页 + 乐观锁。
 *
 * <p>[adapt] 自融光 config/MybatisPlusConfig.java 移植(包名 fusion -> platform)。
 * P1-T1 起注册 {@link AppTenantLineInnerInterceptor}（app_id + tenant_id 双列，
 * 组合两个 TenantLineInnerInterceptor 实现细节见其类注释），<strong>必须先于
 * 分页拦截器注册</strong>（顺序语义与融光 TenantLineInnerInterceptor 一致）。
 */
@Configuration
public class MybatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // 双列行级拦截(P1-T1):先于分页拦截器注册
        interceptor.addInnerInterceptor(new AppTenantLineInnerInterceptor());
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        return interceptor;
    }
}
