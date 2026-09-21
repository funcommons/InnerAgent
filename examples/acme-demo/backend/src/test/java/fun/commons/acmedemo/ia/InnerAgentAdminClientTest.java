package fun.commons.acmedemo.ia;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import fun.commons.acmedemo.common.BizException;
import fun.commons.acmedemo.config.IaProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * 管理面客户端(一次性开通封装):X-IA-Admin-Key 头注入、信封 code 判定、
 * 开通状态探测四分态(registered / not_registered / unreachable / admin_key_missing)。
 */
class InnerAgentAdminClientTest {

    private IaProperties props;
    private MockRestServiceServer server;
    private InnerAgentAdminClient client;

    @BeforeEach
    void setUp() {
        props = new IaProperties();
        props.setServerBase("http://localhost:18090");
        props.setAdminKey("test-admin-key");
        // 复刻生产构造的 baseUrl/默认头,但请求工厂交由 mock 绑定
        RestClient.Builder builder = RestClient.builder()
                .baseUrl(props.getServerBase())
                .defaultHeader("X-IA-Admin-Key", props.getAdminKey());
        server = MockRestServiceServer.bindTo(builder).build();
        // 传入 mock 后的 builder 产物(走包内 RestClient 构造,不再叠加超时工厂)
        client = new InnerAgentAdminClient(props, builder.build());
    }

    @Test
    void 注册应用_携带AdminKey_解析指纹() {
        server.expect(requestTo("http://localhost:18090/ia/api/v1/admin/apps"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-IA-Admin-Key", "test-admin-key"))
                .andExpect(jsonPath("$.appKey").value("acme-demo"))
                .andExpect(jsonPath("$.signPublicKey").exists())
                .andRespond(withSuccess(
                        "{\"code\":0,\"msg\":\"success\",\"data\":{\"id\":1,\"appKey\":\"acme-demo\","
                                + "\"name\":\"ACME\",\"signKeyFingerprint\":\"ab12cd34ef567890\"}}",
                        MediaType.APPLICATION_JSON));

        InnerAgentAdminClient.AppRow row = client.registerApp(new InnerAgentAdminClient.RegisterAppReq(
                "acme-demo", "ACME", "-----BEGIN PUBLIC KEY-----\nX\n-----END PUBLIC KEY-----",
                "http://localhost:9300/ia/webhook", "whsec-x"));
        assertThat(row.id()).isEqualTo(1L);
        assertThat(row.signKeyFingerprint()).isEqualTo("ab12cd34ef567890");
        server.verify();
    }

    @Test
    void 注册应用_信封非0code_转BizException() {
        server.expect(requestTo("http://localhost:18090/ia/api/v1/admin/apps"))
                .andRespond(withSuccess("{\"code\":409,\"msg\":\"appKey 已存在\",\"data\":null}",
                        MediaType.APPLICATION_JSON));
        assertThatThrownBy(() -> client.registerApp(new InnerAgentAdminClient.RegisterAppReq(
                "acme-demo", "ACME", "pem", null, null)))
                .isInstanceOfSatisfying(BizException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(409);
                    assertThat(e.getMessage()).contains("appKey 已存在");
                });
    }

    @Test
    void 注册应用_HTTP错误_转BizException() {
        server.expect(requestTo("http://localhost:18090/ia/api/v1/admin/apps"))
                .andRespond(withStatus(org.springframework.http.HttpStatus.FORBIDDEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("{\"code\":403,\"msg\":\"管理面密钥错误\",\"data\":null}"));
        assertThatThrownBy(() -> client.registerApp(new InnerAgentAdminClient.RegisterAppReq(
                "acme-demo", "ACME", "pem", null, null)))
                .isInstanceOfSatisfying(BizException.class, e -> assertThat(e.getCode()).isEqualTo(403));
    }

    @Test
    void 状态探测_已注册_带公钥指纹() {
        server.expect(requestTo("http://localhost:18090/ia/api/v1/admin/apps"))
                .andRespond(withSuccess(
                        "{\"code\":0,\"msg\":\"success\",\"data\":["
                                + "{\"id\":1,\"appKey\":\"other\",\"name\":\"O\",\"signKeyFingerprint\":\"ff\"},"
                                + "{\"id\":2,\"appKey\":\"acme-demo\",\"name\":\"ACME\",\"signKeyFingerprint\":\"ab12cd34ef567890\"}]}",
                        MediaType.APPLICATION_JSON));
        InnerAgentAdminClient.AppView view = client.probeAppStatus("acme-demo");
        assertThat(view.state()).isEqualTo("registered");
        assertThat(view.appId()).isEqualTo(2L);
        assertThat(view.signKeyFingerprint()).isEqualTo("ab12cd34ef567890");
    }

    @Test
    void 状态探测_未注册_不可达_无密钥() {
        // SimpleRequestExpectationManager 要求先声明全部期待,再发请求
        server.expect(requestTo("http://localhost:18090/ia/api/v1/admin/apps"))
                .andRespond(withSuccess("{\"code\":0,\"msg\":\"success\",\"data\":[]}",
                        MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://localhost:18090/ia/api/v1/admin/apps"))
                .andRespond(withStatus(org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR));
        assertThat(client.probeAppStatus("acme-demo").state()).isEqualTo("not_registered");

        // fail-open:HTTP 5xx 不抛出,归为 unreachable
        assertThat(client.probeAppStatus("acme-demo").state()).isEqualTo("unreachable");

        // 连接拒绝(真实指向保留地址,不经 mock)→ unreachable(fail-open)
        props.setServerBase("http://127.0.0.1:1");
        InnerAgentAdminClient direct = new InnerAgentAdminClient(props, RestClient.builder().build());
        assertThat(direct.probeAppStatus("acme-demo").state()).isEqualTo("unreachable");

        // adminKey 未配置:不发起请求,直接给出分态(总览页提示先配 IA_ADMIN_KEY)
        props.setServerBase("http://localhost:18090");
        props.setAdminKey("");
        assertThat(client.probeAppStatus("acme-demo").state()).isEqualTo("admin_key_missing");
    }
}
