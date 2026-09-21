package fun.commons.acmedemo.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * InnerAgent 接入配置(application.yml `ia.*`,对应 docs/接入指南.md
 * 步骤①~④ 的开通交付物与 env:IA_SERVER_BASE / IA_APP_KEY / IA_SIGN_PRIVATE_KEY)。
 *
 * 红线(接入指南 §2.5 语义):签名私钥 / webhookSecret / 管理面 adminKey 仅后端
 * 环境变量持有,出现在前端包/浏览器存储/URL/日志即为事故;对外接口只允许暴露
 * serverBase / appKey / agentType(见 {@code DemoConfigController})。
 */
@Data
@ConfigurationProperties(prefix = "ia")
public class IaProperties {

    /** InnerAgent 主服务地址(运行内核 + 管理面 /ia/api/v1/admin/**)。 */
    private String serverBase = "http://localhost:18090";

    /** 应用标识:embed token 的 iss,与管理面注册的 appKey 一致。 */
    private String appKey = "acme-demo";

    /** 对话使用的 Agent 类型(SDK init agentType,随 POST /runs 请求体发送)。 */
    private String agentType = "ai_media";

    /**
     * embed token 签名私钥(RSA PEM;与管理面登记的 signPublicKey 配对,
     * 私钥不出宿主)。接受 PKCS#8("BEGIN PRIVATE KEY")与 PKCS#1
     * ("BEGIN RSA PRIVATE KEY")两种 PEM 形态。
     */
    private String signPrivateKeyPem = "";

    /** embed token 有效期(秒);接入指南建议 12h,配合 SDK 401 懒换无缝续签。 */
    private int embedTtlSeconds = 12 * 3600;

    /** 透传给 InnerAgent 的租户声明(embed token 可选 claim tenantId,缺省 0)。 */
    private long tenantId = 0L;

    /** Webhook 验签密钥(管理面注册应用/配置 webhook 时下发的 secret)。 */
    private String webhookSecret = "";

    /**
     * 管理面 API Key(env IA_ADMIN_KEY):仅用于「一次性开通」的说明性封装
     * (应用注册/公钥登记/注册状态查询,见 {@code InnerAgentAdminClient});
     * 运行期签发 embed token 不依赖它。
     */
    private String adminKey = "";

    private int connectTimeoutSeconds = 5;

    private int readTimeoutSeconds = 30;
}
