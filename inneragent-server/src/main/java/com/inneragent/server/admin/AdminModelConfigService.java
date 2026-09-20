package com.inneragent.server.admin;

import com.inneragent.model.config.ApiConfigService;
import com.inneragent.model.entity.ApiConfig;
import com.inneragent.model.provider.AiProviderService;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import cn.hutool.core.util.StrUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;

/**
 * 模型接入配置 admin 服务(P2-srv 安全收口,02-技术方案 §7.1 / §5.1
 * {@code ia_model_api_config})。
 *
 * <p>融光旧管理面 {@code /api/ai/api-config/*} 与 {@code /api/ai/model/*} 的
 * 管理面能力收敛到本服务(由 {@link AdminTokenFilter} 的 X-IA-Admin-Key 守卫);
 * SDK 用户级模型列表走 {@code GET /ia/api/v1/me/models?type=}(白名单字段)。
 *
 * <p><strong>密钥掩码铁律</strong>:{@code apiKey/appSecret/proxyPassword} 为
 * write-only 字段,响应一律不回明文,仅以 {@link #maskSecret}(对齐 web 脚手架
 * {@code utils/api-config.ts maskSecret} 语义)回显 {@code apiKeyMasked}。
 */
@Service
@RequiredArgsConstructor
public class AdminModelConfigService {

    private final ApiConfigService apiConfigService;
    private final AiProviderService aiProviderService;

    /** 响应视图(web 脚手架 IaModelApiConfig 契约形;秘密字段只回掩码)。 */
    public record ModelConfigView(
            long id,
            String name,
            String platform,
            String textProtocol,
            String apiUrl,
            boolean autoAppendV1Path,
            String proxyType,
            String proxyHost,
            Integer proxyPort,
            String proxyUsername,
            String apiKeyMasked,
            Integer status,
            String remark,
            Instant createTime,
            Instant updateTime) {
    }

    /** 连通性测试结果(web 脚手架 ModelConnectivityResult 契约形)。 */
    public record ConnectivityResult(
            long configId,
            boolean ok,
            String responseText,
            long durationMs,
            Instant testedAt) {
    }

    public PageResult<ModelConfigView> page(
            String name, String platform, Integer status, int pageNo, int pageSize) {
        return apiConfigService.getPage(name, platform, status, pageNo, pageSize)
                .map(AdminModelConfigService::toView);
    }

    public ModelConfigView getRequired(long id) {
        return toView(requireConfig(id));
    }

    public ModelConfigView create(
            String name, String platform, String textProtocol, String apiUrl,
            Boolean autoAppendV1Path, String proxyType, String proxyHost, Integer proxyPort,
            String proxyUsername, String proxyPassword, String apiKey, String appId,
            String appSecret, Long modelId, Integer status, String remark) {
        ApiConfig config = new ApiConfig();
        config.setName(name);
        config.setPlatform(platform);
        config.setTextProtocol(textProtocol);
        config.setApiUrl(apiUrl);
        config.setAutoAppendV1Path(autoAppendV1Path);
        config.setProxyType(proxyType);
        config.setProxyHost(proxyHost);
        config.setProxyPort(proxyPort);
        config.setProxyUsername(proxyUsername);
        config.setProxyPassword(proxyPassword);
        config.setApiKey(apiKey);
        config.setPlatformAppId(appId);
        config.setAppSecret(appSecret);
        config.setModelId(modelId);
        config.setStatus(status);
        config.setRemark(remark);
        long id = apiConfigService.createApiConfig(config);
        return getRequired(id);
    }

    /**
     * 更新配置;{@code apiKey} 空/缺省 = 不修改密钥(与 web 脚手架「只写」语义一致),
     * 其余 null 字段维持 ApiConfigService 的「不修改」语义。
     */
    public ModelConfigView update(
            long id, String name, String platform, String textProtocol, String apiUrl,
            Boolean autoAppendV1Path, String proxyType, String proxyHost, Integer proxyPort,
            String proxyUsername, String proxyPassword, String apiKey, String appId,
            String appSecret, Long modelId, Integer status, String remark) {
        requireConfig(id);
        String effectiveApiKey = apiKey != null && apiKey.isBlank() ? null : apiKey;
        apiConfigService.updateApiConfig(id, name, platform, textProtocol, apiUrl,
                autoAppendV1Path, proxyType, proxyHost, proxyPort, proxyUsername,
                proxyPassword, effectiveApiKey, appId, appSecret, modelId, status, remark);
        return getRequired(id);
    }

    public void delete(long id) {
        requireConfig(id);
        apiConfigService.deleteApiConfig(id);
    }

    /**
     * 连通性测试:经 provider 拉取远程模型清单。结果(成功/失败)作为数据返回
     * (HTTP 200 + ok 布尔),仅配置不存在时 404。探测按 {@link Throwable} 兜底
     * ——链路级缺陷(如依赖冲突的 {@link NoSuchMethodError})也应回 ok=false
     * 而非 500,管理面测试语义是「探针」而非业务调用。
     */
    public ConnectivityResult test(long id) {
        requireConfig(id);
        long start = System.nanoTime();
        try {
            int remoteCount = aiProviderService.listRemoteModels(id).size();
            return new ConnectivityResult(
                    id, true, "连接正常,发现 " + remoteCount + " 个远程模型",
                    durationMs(start), Instant.now());
        } catch (Throwable failure) {
            return new ConnectivityResult(
                    id, false, "连接失败: " + failure.getMessage(),
                    durationMs(start), Instant.now());
        }
    }

    /**
     * 密钥掩码(对齐 web 脚手架 maskSecret 语义):空 → 空串;
     * 长度 ≤ 8 → 全掩码;否则前 4 + •••• + 后 4。
     */
    public static String maskSecret(String secret) {
        if (StrUtil.isBlank(secret)) {
            return "";
        }
        String value = secret.trim();
        if (value.length() <= 8) {
            return "••••••••";
        }
        return value.substring(0, 4) + "••••" + value.substring(value.length() - 4);
    }

    private ApiConfig requireConfig(long id) {
        ApiConfig config = apiConfigService.getById(id);
        if (config == null) {
            throw new BusinessException(404, "模型接入配置不存在");
        }
        return config;
    }

    private static ModelConfigView toView(ApiConfig config) {
        return new ModelConfigView(
                config.getId(),
                config.getName(),
                config.getPlatform(),
                config.getTextProtocol(),
                config.getApiUrl(),
                Boolean.TRUE.equals(config.getAutoAppendV1Path()),
                config.getProxyType(),
                config.getProxyHost(),
                config.getProxyPort(),
                config.getProxyUsername(),
                maskSecret(config.getApiKey()),
                config.getStatus(),
                config.getRemark(),
                toInstant(config.getCreateTime()),
                toInstant(config.getUpdateTime()));
    }

    private static Instant toInstant(java.time.LocalDateTime value) {
        return value == null ? null : value.toInstant(java.time.ZoneOffset.UTC);
    }

    private static long durationMs(long startNanos) {
        return Math.max(0, (System.nanoTime() - startNanos) / 1_000_000);
    }
}
