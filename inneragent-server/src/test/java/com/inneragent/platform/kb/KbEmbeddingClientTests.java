package com.inneragent.platform.kb;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * OpenAI 兼容 KB 向量客户端单测(语义检索先导,红测先行):
 * batch-size 边界切分、{@code data[].index} 还原输入顺序、HTTP 失败/畸形
 * 响应的明确异常类型({@link KbEmbeddingException})、
 * {@code inneragent.kb.semantic.*} 默认值绑定、空输入零外呼。
 *
 * <p>外呼经 {@code MockRestServiceServer.bindTo(RestClient.Builder)}
 * 拦截(InnerAgentAdminClientTest 先例):客户端构造刻意与生产一致
 * (配置 + 现成 RestClient),测试只换请求工厂。
 */
class KbEmbeddingClientTests {

    private static final String ENDPOINT = "http://kb-embed.local:18080/v1/embeddings";

    private KbProperties properties;
    private MockRestServiceServer server;
    private OpenAiCompatibleKbEmbeddingClient client;

    @BeforeEach
    void setUp() {
        properties = new KbProperties();
        properties.getSemantic().setEnabled(true);
        properties.getSemantic().setEndpoint(ENDPOINT);
        properties.getSemantic().setApiKey("sk-test");
        properties.getSemantic().setModel("text-embedding-test");
        properties.getSemantic().setBatchSize(2);
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        client = new OpenAiCompatibleKbEmbeddingClient(properties, builder.build());
    }

    @Test
    void splitsRequestsAtBatchSizeBoundaryAndPreservesInputOrder() {
        // 5 条文本、batch-size=2 → 2+2+1 三次外呼;按批内 index 拼回全序
        expectBatch("[{\"index\":0,\"embedding\":[0.1,0.2]},"
                        + "{\"index\":1,\"embedding\":[0.3,0.4]}]",
                "报销制度第一条", "报销制度第二条");
        expectBatch("[{\"index\":0,\"embedding\":[0.5,0.6]},"
                        + "{\"index\":1,\"embedding\":[0.7,0.8]}]",
                "报销制度第三条", "报销制度第四条");
        expectBatch("[{\"index\":0,\"embedding\":[0.9,1.0]}]",
                "报销制度第五条");

        List<float[]> vectors = client.embed(List.of(
                "报销制度第一条", "报销制度第二条",
                "报销制度第三条", "报销制度第四条", "报销制度第五条"));

        assertThat(vectors).hasSize(5);
        assertThat(vectors.get(0)).containsExactly(0.1f, 0.2f);
        assertThat(vectors.get(1)).containsExactly(0.3f, 0.4f);
        assertThat(vectors.get(2)).containsExactly(0.5f, 0.6f);
        assertThat(vectors.get(3)).containsExactly(0.7f, 0.8f);
        assertThat(vectors.get(4)).containsExactly(0.9f, 1.0f);
        server.verify();
    }

    @Test
    void restoresOutputOrderByIndexWhenServerShufflesData() {
        // 响应乱序返回(服务端并发常见):须按 index 还原,而非按到达顺序
        expectBatch("[{\"index\":1,\"embedding\":[9.0,9.5]},"
                + "{\"index\":0,\"embedding\":[1.5,2.5]}]", "查询甲", "查询乙");

        List<float[]> vectors = client.embed(List.of("查询甲", "查询乙"));

        assertThat(vectors).hasSize(2);
        assertThat(vectors.get(0)).containsExactly(1.5f, 2.5f);
        assertThat(vectors.get(1)).containsExactly(9.0f, 9.5f);
        server.verify();
    }

    @Test
    void httpErrorSurfacesKbEmbeddingException() {
        server.expect(requestTo(ENDPOINT))
                .andRespond(withServerError());

        assertThatThrownBy(() -> client.embed(List.of("查询甲")))
                .isInstanceOf(KbEmbeddingException.class);
    }

    @Test
    void malformedResponseSurfacesKbEmbeddingException() {
        // 两条 expect 须全部先声明后调用:Spring 6.2 AbstractRequestExpectationManager
        // 在已有请求后再 expect 会抛 ISE(requests 非空断言)
        // 缺 data 字段
        server.expect(requestTo(ENDPOINT))
                .andRespond(withSuccess("{\"object\":\"list\"}",
                        MediaType.APPLICATION_JSON));
        // embedding 非数值数组
        server.expect(requestTo(ENDPOINT))
                .andRespond(withSuccess(
                        "{\"data\":[{\"index\":0,\"embedding\":[\"abc\"]}]}",
                        MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.embed(List.of("查询甲")))
                .isInstanceOf(KbEmbeddingException.class);
        assertThatThrownBy(() -> client.embed(List.of("查询甲")))
                .isInstanceOf(KbEmbeddingException.class);
        server.verify();
    }

    @Test
    void semanticConfigurationDefaultsMatchSpec() {
        // enabled 默认 false(不配置语义能力时零行为);batch-size=16、
        // timeout-ms=10000 为规格钉死的缺省
        KbProperties fresh = new KbProperties();
        assertThat(fresh.getSemantic().isEnabled()).isFalse();
        assertThat(fresh.getSemantic().getBatchSize()).isEqualTo(16);
        assertThat(fresh.getSemantic().getTimeoutMs()).isEqualTo(10_000);
        assertThat(client).isInstanceOf(KbEmbeddingPort.class);
    }

    @Test
    void emptyInputShortCircuitsWithoutHttpCall() {
        assertThat(client.embed(List.of())).isEmpty();
        server.verify();
    }

    /** 钉一次外呼的请求形态(URL/方法/鉴权头/模型/批量)并按 dataJson 应答。 */
    private void expectBatch(String dataJson, String... texts) {
        StringBuilder input = new StringBuilder("[");
        for (int i = 0; i < texts.length; i++) {
            if (i > 0) {
                input.append(',');
            }
            input.append('"').append(texts[i]).append('"');
        }
        server.expect(requestTo(ENDPOINT))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer sk-test"))
                .andExpect(jsonPath("$.model").value("text-embedding-test"))
                .andExpect(jsonPath("$.input.length()").value(texts.length))
                .andExpect(jsonPath("$.input[0]").value(texts[0]))
                .andRespond(withSuccess("{\"data\":" + dataJson + "}",
                        MediaType.APPLICATION_JSON));
    }
}
