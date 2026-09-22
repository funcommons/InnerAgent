package fun.commons.acmedemo.ia;

import com.fasterxml.jackson.databind.JsonNode;
import fun.commons.acmedemo.common.BizException;
import fun.commons.acmedemo.config.IaProperties;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * DEMO「Agent 管理」页后端编排(创建 / 管理 / 配置 InnerAgent Agent 定义)。
 *
 * <p>演示「宿主应用即管理入口」:前端不接触任何凭据,管理面密钥与签名私钥
 * 都在宿主后端——列表走管理面 definitions API;创建与全量配置走 bundle
 * import(conflictPolicy=overwrite,与 seeds/provision.sh 同通道);模型下拉
 * 数据以宿主自签的内部 embed token(系统态 sub=1)调用户面 /me/models。
 *
 * <p>app 绑定:appId 由 appKey 实时探测(probeAppStatus),未注册即 400 引导
 * 先完成总览页五步开通,不落任何硬编码。
 */
@Service
@RequiredArgsConstructor
public class IaAgentAdminService {

    private final InnerAgentAdminClient adminClient;
    private final EmbedTokenSigner signer;
    private final IaProperties props;

    /** 保存请求(前端表单直传;definitionId 空=创建,非空=覆盖更新)。 */
    public record SaveReq(Long definitionId, String agentType, String name,
                          String kind, Boolean enabled, Long modelId,
                          List<String> toolWhitelist, List<String> subAgentTools,
                          String systemPrompt, String greeting) {
    }

    /** 下拉选项聚合(tools/models 为管理面/用户面原样 data,前端宽松取字段)。 */
    public record AgentOptions(JsonNode tools, JsonNode models,
                               List<Map<String, String>> subAgents) {
    }

    /** 定义分页列表(信封原样透传;data 为 PageResult)。 */
    public JsonNode listDefinitions() {
        long appId = requireAppId();
        JsonNode envelope = adminClient.getEnvelope(
                "/ia/api/v1/admin/definitions?appId=" + appId + "&pageNo=1&pageSize=100");
        return requireData(envelope);
    }

    /** 表单下拉聚合:桥/三方/内置工具 + 对话模型 + 可挂子 Agent。 */
    public AgentOptions options() {
        long appId = requireAppId();
        JsonNode tools = requireData(adminClient.getEnvelope("/ia/api/v1/admin/tools"));
        EmbedTokenSigner.SignedToken systemToken = signer.sign(1L, props.getTenantId());
        JsonNode models = requireData(adminClient.getEnvelopeAsUser(
                "/ia/api/v1/me/models?type=1", systemToken.token()));
        JsonNode defs = requireData(adminClient.getEnvelope(
                "/ia/api/v1/admin/definitions?appId=" + appId + "&pageNo=1&pageSize=100&kind=sub"));
        List<Map<String, String>> subAgents = new ArrayList<>();
        for (JsonNode row : rowsOf(defs)) {
            String agentType = textOrNull(row, "agentType");
            if (agentType != null) {
                subAgents.add(Map.of("agentType", agentType,
                        "name", textOrNull(row, "name") == null ? agentType : textOrNull(row, "name")));
            }
        }
        return new AgentOptions(tools, models, subAgents);
    }

    /**
     * 创建 / 覆盖更新单条定义:组装单定义 bundle 走 import(overwrite)通道,
     * 返回导入结果 {created,updated,skipped,errors[]}。提示词只随传随改
     * (systemPrompt 缺省=保持原值;greeting 缺省=保持原值)。
     */
    public JsonNode save(SaveReq req) {
        long appId = requireAppId();
        validate(req);
        Map<String, Object> spec = new LinkedHashMap<>();
        spec.put("kind", req.kind());
        spec.put("enabled", req.enabled() == null || req.enabled());
        spec.put("modelId", req.modelId());
        spec.put("toolWhitelist", req.toolWhitelist() == null ? List.of() : req.toolWhitelist());
        spec.put("subAgentTools", req.subAgentTools() == null ? List.of() : req.subAgentTools());
        List<Map<String, String>> prompts = new ArrayList<>();
        if (StringUtils.hasText(req.systemPrompt())) {
            prompts.add(Map.of("slot", "systemPrompt", "content", req.systemPrompt()));
        }
        if (req.greeting() != null) {
            prompts.add(Map.of("slot", "greeting", "content", req.greeting()));
        }
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("definitionId", req.definitionId());
        definition.put("agentType", req.agentType().trim());
        definition.put("name", req.name().trim());
        definition.put("specJson", spec);
        definition.put("prompts", prompts);
        Map<String, Object> bundle = Map.of(
                "schemaVersion", 1,
                "definitions", List.of(definition));
        Map<String, Object> body = Map.of(
                "bundle", bundle,
                "conflictPolicy", "overwrite",
                "dryRun", false);
        return requireData(adminClient.postEnvelope(
                "/ia/api/v1/admin/definitions/import?appId=" + appId, body));
    }

    // ---------- 内部 ----------

    private long requireAppId() {
        InnerAgentAdminClient.AppView app =
                adminClient.probeAppStatus(props.getAppKey());
        if (!"registered".equals(app.state())) {
            throw new BizException(400,
                    "应用尚未在 InnerAgent 管理面注册,请先完成总览页五步开通");
        }
        return app.appId();
    }

    private void validate(SaveReq req) {
        if (req.definitionId() == null && !StringUtils.hasText(req.agentType())) {
            throw new BizException(400, "agentType 不能为空");
        }
        if (req.agentType() != null
                && !req.agentType().trim().matches("[a-z0-9][a-z0-9-]{1,63}")) {
            throw new BizException(400, "agentType 仅限小写字母/数字/连字符(2-64 位)");
        }
        if (!StringUtils.hasText(req.name())) {
            throw new BizException(400, "名称不能为空");
        }
        String kind = req.kind() == null ? "main" : req.kind();
        if (!"main".equals(kind) && !"sub".equals(kind)) {
            throw new BizException(400, "kind 仅支持 main / sub");
        }
        if (req.definitionId() == null && !StringUtils.hasText(req.systemPrompt())) {
            throw new BizException(400, "新建定义必须提供 systemPrompt");
        }
    }

    private JsonNode requireData(JsonNode envelope) {
        if (envelope == null) {
            throw new BizException(502, "InnerAgent 管理面无响应");
        }
        if (envelope.path("code").asInt(-1) != 0) {
            throw new BizException(envelope.path("code").asInt(502),
                    envelope.path("msg").asText("管理面响应异常"));
        }
        JsonNode data = envelope.path("data");
        if (data.isMissingNode() || data.isNull()) {
            throw new BizException(502, "管理面响应缺少 data");
        }
        return data;
    }

    /** PageResult 兼容取行(records / list / 裸数组三种形态)。 */
    private static Iterable<JsonNode> rowsOf(JsonNode page) {
        JsonNode rows = page.has("records") ? page.path("records")
                : page.has("list") ? page.path("list") : page;
        return rows.isArray() ? rows : List.<JsonNode>of();
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }
}
