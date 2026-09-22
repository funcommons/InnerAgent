package fun.commons.acmedemo.ia;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import fun.commons.acmedemo.common.BizException;
import fun.commons.acmedemo.config.IaProperties;
import java.time.Duration;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * InnerAgent 管理面客户端(X-IA-Admin-Key 鉴权,接入指南步骤④)。
 *
 * <p><strong>定位是「一次性开通」的说明性封装</strong>:应用注册/公钥登记、
 * 工具注册条目写入、以及本 DEMO 总览页的开通状态自检。运行期的 embed token
 * 签发<strong>不经过</strong>本客户端——签名私钥在宿主本地,签发是纯本地行为
 * (见 {@link EmbedTokenSigner});管理面只在登记/换钥/注册工具时使用。
 *
 * <p>响应信封 {@code {code,msg,data}} 成功判定 code===0(与 InnerAgent
 * CommonResult 一致);HTTP 4xx/5xx(信封在 body)统一转 {@link BizException}。
 * 防爆破注意:管理面密钥错误即 403,调用方不得循环重试。
 */
@Slf4j
@Component
public class InnerAgentAdminClient {

    private final IaProperties props;
    private final RestClient rest;

    @Autowired
    public InnerAgentAdminClient(IaProperties props, RestClient.Builder restBuilder) {
        this(props, restBuilder
                .baseUrl(props.getServerBase())
                .requestFactory(defaultRequestFactory(props))
                .defaultHeader("X-IA-Admin-Key", props.getAdminKey())
                .build());
    }

    /** 内部构造:直接持 RestClient(测试注入 mock 后的 builder 产物,不叠加超时工厂)。 */
    InnerAgentAdminClient(IaProperties props, RestClient rest) {
        this.props = props;
        this.rest = rest;
    }

    /** 显式 .requestFactory 会覆盖 builder 上已有工厂(mock 绑定),故只在生产构造应用超时。 */
    private static SimpleClientHttpRequestFactory defaultRequestFactory(IaProperties props) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) Duration.ofSeconds(props.getConnectTimeoutSeconds()).toMillis());
        factory.setReadTimeout((int) Duration.ofSeconds(props.getReadTimeoutSeconds()).toMillis());
        return factory;
    }

    // ---------- DTO(信封与行记录;字段宽松解析,避免 DEMO 绑定管理面全量 schema) ----------

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Envelope<T>(int code, String msg, T data) {
    }

    /** 应用行(POST /admin/apps 响应 / GET /admin/apps 列表项)。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AppRow(long id, String appKey, String name,
                         String signKeyFingerprint) {
    }

    /** 应用注册请求体(接入指南步骤④.1)。 */
    public record RegisterAppReq(String appKey, String name, String signPublicKey,
                                 String webhookUrl, String webhookSecret) {
    }

    /** 工具注册请求体(接入指南步骤④.2;管理面词表 riskLevel ∈ low/medium/high)。 */
    public record RegisterToolReq(String serverKey, String toolName, String description,
                                  String riskLevel, String source, String endpointUrl,
                                  String parametersSchema) {
    }

    // ---------- 开通动作(一次性) ----------

    /** 注册应用并登记 RSA 公钥;appKey 重复 → 409,非法 PEM → 400。 */
    public AppRow registerApp(RegisterAppReq req) {
        Envelope<AppRow> resp = post("/ia/api/v1/admin/apps", req,
                new ParameterizedTypeReference<Envelope<AppRow>>() {
                });
        requireOk(resp);
        return resp.data();
    }

    /** 登记宿主桥工具条目;同 FQN 重复 → 409。endpointUrl 必须与 act.audiences 一致。 */
    public Object registerTool(RegisterToolReq req) {
        Envelope<Object> resp = post("/ia/api/v1/admin/tools", req,
                new ParameterizedTypeReference<Envelope<Object>>() {
                });
        requireOk(resp);
        return resp.data();
    }

    // ---------- 状态自检(DEMO 总览页实时拉取) ----------

    /** 拉应用列表并找本 DEMO 的 appKey 行;失败返回 null(fail-open,仅自检用)。 */
    public AppView probeAppStatus(String appKey) {
        if (!StringUtils.hasText(props.getAdminKey())) {
            return AppView.adminKeyMissing();
        }
        try {
            Envelope<List<AppRow>> resp = rest.get()
                    .uri("/ia/api/v1/admin/apps")
                    .retrieve()
                    .body(new ParameterizedTypeReference<Envelope<List<AppRow>>>() {
                    });
            if (resp == null || resp.code() != 0 || resp.data() == null) {
                return AppView.unreachable();
            }
            return resp.data().stream()
                    .filter(app -> appKey.equals(app.appKey()))
                    .findFirst()
                    .<AppView>map(AppView::registered)
                    .orElseGet(() -> AppView.notRegistered(appKey));
        } catch (RestClientResponseException e) {
            log.warn("管理面探测失败: HTTP {}", e.getStatusCode().value());
            return AppView.unreachable();
        } catch (Exception e) {
            log.warn("管理面探测失败(fail-open): {}", e.getMessage());
            return AppView.unreachable();
        }
    }

    /** 总览页展示形态:开通状态三分态 + 公钥指纹(核对登记公钥与本地私钥配对)。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AppView(String state, long appId, String appKey,
                          String signKeyFingerprint) {

        static AppView registered(AppRow row) {
            return new AppView("registered", row.id(), row.appKey(), row.signKeyFingerprint());
        }

        static AppView notRegistered(String appKey) {
            return new AppView("not_registered", 0, appKey, null);
        }

        static AppView unreachable() {
            return new AppView("unreachable", 0, null, null);
        }

        static AppView adminKeyMissing() {
            return new AppView("admin_key_missing", 0, null, null);
        }
    }

    // ---------- 内部 ----------

    private <T> Envelope<T> post(String uri, Object body, ParameterizedTypeReference<Envelope<T>> type) {
        try {
            return rest.post().uri(uri)
                    .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve().body(type);
        } catch (RestClientResponseException e) {
            throw toBiz(e);
        }
    }

    /** HTTP 层错误(4xx/5xx,body 是 {code,msg} 信封)→ BizException。 */
    private BizException toBiz(RestClientResponseException e) {
        int status = e.getStatusCode().value();
        String body = e.getResponseBodyAsString();
        int code = status;
        String msg = e.getMessage();
        try {
            var m = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(body, new com.fasterxml.jackson.core.type.TypeReference<java.util.Map<String, Object>>() {
                    });
            if (m.get("code") instanceof Number n) {
                code = n.intValue();
            }
            if (m.get("msg") instanceof String s && !s.isBlank()) {
                msg = s;
            }
        } catch (Exception ignore) {
            // body 非 JSON,保留 HTTP 状态与原始信息
        }
        return new BizException(code, msg);
    }

    private <T> void requireOk(Envelope<T> resp) {
        if (resp == null) {
            throw new BizException(502, "InnerAgent 管理面无响应");
        }
        if (resp.code() != 0) {
            throw new BizException(resp.code(), resp.msg());
        }
        if (resp.data() == null) {
            throw new BizException(502, "管理面响应缺少 data");
        }
    }
}
