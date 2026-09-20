package com.inneragent.platform.config;

import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * MyBatis-Plus 拦截器装配：分页 + 乐观锁。
 *
 * <p>[adapt] 自融光 config/MybatisPlusConfig.java 移植(包名 fusion -> platform)。
 * 注意：未注册 TenantLineInnerInterceptor——InnerAgent 的 app_id/tenant_id 双列行级
 * 隔离属 P1 范围，届时以 MybatisPlusTenantLineHandler 形式补充并保持先于分页拦截器注册。
 */
@Configuration
public class MybatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // P1 接入多租户时,TenantLineInnerInterceptor 必须先于分页拦截器注册
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        return interceptor;
    }
}
