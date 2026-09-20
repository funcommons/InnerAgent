package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 审计敏感参数统一脱敏器(W6「审计敏感参数脱敏」随 W5 审计检索提前落地;
 * PRD §6.9:password/token/secret/key 类敏感字段自动打码)。
 *
 * <p><strong>读时脱敏</strong>(与写时脱敏的取舍):ia_audit_log 现有写入点
 * (确认流/注册分诊/授权生命周期)透传原始参数快照,存库为原文;本工具在
 * <strong>读取端点统一脱敏</strong>,存量行同样受保护。取舍:读时脱敏不改变
 * 仅追加语义、不动历史数据,但落库原文在数据库层可读(依赖库层访问控制);
 * 写时脱敏可保存储安全但需改全部写入点且无法恢复存量行——P2 按读时方案收敛,
 * 存量/增量在检索出参一律二次脱敏(双保险:写入方已脱敏的字段再过一遍无害)。
 *
 * <p>规则(递归 key 匹配):
 * <ul>
 *   <li>敏感 key:key 归一化(小写、去 {@code _ - 空格})后命中精确清单
 *       (password/passwd/pwd/secret/token/apikey/accesskey/secretkey/privatekey/
 *       authorization/auth/credential(s)/cookie/sessionid)或以
 *       password/secret/token/key/credential/authorization 结尾(宽匹配,
 *       宁可误杀不漏报,如 {@code decrypt_key}/{@code refreshToken});</li>
 *   <li>命中 key 的整棵子值(标量/对象/数组)替换为 {@code ***};</li>
 *   <li>嵌套深度 >{@value #MAX_DEPTH}:子树截断为 {@value #DEPTH_LIMIT_MARKER}
 *       (防深嵌套炸栈/超长);</li>
 *   <li>数组元素 >{@value #MAX_ARRAY_ITEMS}:仅保留前 N 项 + 截断标记。</li>
 * </ul>
 * 输入非 JSON(写入方序列化失败的字符串退化视图)原样返回——无法按 key 定位,
 * 置信度不足不做内容级扫描(避免误伤业务文本)。
 */
@Slf4j
public final class AuditParamMasker {

    public static final String MASK = "***";
    public static final String DEPTH_LIMIT_MARKER = "(depth-limit)";
    public static final String ARRAY_TRUNCATED_MARKER = "(array-truncated)";
    static final int MAX_DEPTH = 8;
    static final int MAX_ARRAY_ITEMS = 50;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final List<String> EXACT_KEYS = List.of(
            "password", "passwd", "pwd", "secret", "token", "apikey", "accesskey",
            "secretkey", "privatekey", "authorization", "auth",
            "credential", "credentials", "cookie", "sessionid", "webhooksecret");
    private static final List<String> SENSITIVE_SUFFIXES = List.of(
            "password", "secret", "token", "key", "credential", "authorization");

    private AuditParamMasker() {
    }

    /**
     * 对审计参数 JSON 统一脱敏;入参 null/空白原样返回,非 JSON 原样返回,
     * 解析/序列化异常时 WARN 并原样返回(fail-open:审计展示不因脱敏器故障中断,
     * 敏感面由写入口令级字段掩码兜底)。
     */
    public static String mask(String paramsJson) {
        if (paramsJson == null || paramsJson.isBlank()) {
            return paramsJson;
        }
        Object parsed;
        try {
            parsed = MAPPER.readValue(paramsJson, new TypeReference<Object>() {
            });
        } catch (Exception parseFailure) {
            // 非 JSON(写入方退化的字符串视图):不做内容级猜测
            return paramsJson;
        }
        try {
            Object masked = maskNode(parsed, 0);
            return MAPPER.writeValueAsString(masked);
        } catch (Exception maskFailure) {
            log.warn("审计参数脱敏失败,原文返回", maskFailure);
            return paramsJson;
        }
    }

    private static Object maskNode(Object node, int depth) {
        if (depth > MAX_DEPTH) {
            return DEPTH_LIMIT_MARKER;
        }
        if (node instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                if (isSensitiveKey(key)) {
                    result.put(key, MASK);
                } else {
                    result.put(key, maskNode(entry.getValue(), depth + 1));
                }
            }
            return result;
        }
        if (node instanceof List<?> list) {
            List<Object> result = new ArrayList<>();
            int kept = Math.min(list.size(), MAX_ARRAY_ITEMS);
            for (int index = 0; index < kept; index++) {
                result.add(maskNode(list.get(index), depth + 1));
            }
            if (list.size() > MAX_ARRAY_ITEMS) {
                result.add(ARRAY_TRUNCATED_MARKER);
            }
            return result;
        }
        return node;
    }

    /** 敏感 key 判定:归一化(小写、去分隔符)后精确清单或敏感后缀。 */
    static boolean isSensitiveKey(String key) {
        if (key == null || key.isBlank()) {
            return false;
        }
        String normalized = key.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[_\\-\\s]", "");
        if (EXACT_KEYS.contains(normalized)) {
            return true;
        }
        for (String suffix : SENSITIVE_SUFFIXES) {
            if (normalized.endsWith(suffix)) {
                return true;
            }
        }
        return false;
    }
}
