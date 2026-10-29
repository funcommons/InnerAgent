package com.inneragent.platform.kb;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.time.Duration;

/**
 * mini 知识库装配(P4-W14):注册 {@link KbProperties} 与语义向量端口
 * (升级战役 D2);检索配置解析、摄取/检索服务、内核端口适配为普通组件
 * 扫描覆盖。外部知识库出站客户端亦由此装配(client 级超时,请求工厂同款)。
 */
@Configuration
@EnableConfigurationProperties(KbProperties.class)
public class KbConfiguration {

    /**
     * 语义向量端口:恒注册(检索/摄取服务构造依赖,缺席无法装配),
     * {@code semantic.enabled=false}(缺省)时消费侧零调用、零外呼;
     * 超时按 {@code semantic.timeout-ms} 落参(AiProxySupport 同款
     * SimpleClientHttpRequestFactory)。
     */
    @Bean
    public KbEmbeddingPort kbEmbeddingPort(KbProperties properties) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        int timeoutMs = (int) Math.min(properties.getSemantic().getTimeoutMs(), Integer.MAX_VALUE);
        requestFactory.setConnectTimeout(timeoutMs);
        requestFactory.setReadTimeout(timeoutMs);
        return new OpenAiCompatibleKbEmbeddingClient(
                properties, RestClient.builder().requestFactory(requestFactory).build());
    }

    /**
     * 外部知识库出站检索客户端:client 级超时 inneragent.kb.external-http-timeout-ms
     * (缺省 10000,§3);登记行 timeout_ms 为单源口径留档,逐源覆盖接线待 IT。
     */
    @Bean
    public KbExternalRetrievalClient kbExternalRetrievalClient(
            @Value("${inneragent.kb.external-http-timeout-ms:10000}") long timeoutMs) {
        return new KbExternalRetrievalClient(
                KbExternalRetrievalClient.restClient(Duration.ofMillis(timeoutMs)));
    }
}
