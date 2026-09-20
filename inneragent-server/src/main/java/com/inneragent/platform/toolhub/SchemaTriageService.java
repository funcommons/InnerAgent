package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * schema 活刷新分诊服务(V14;02-技术方案 §4.3:注册表层活刷新+差异分诊)。
 *
 * <p><strong>分诊矩阵</strong>(宿主重发 schema+注解时逐条判定,命中即断):
 * <ul>
 *   <li>{@code UNCHANGED}:canonical schema 指纹相同 且 注解安全位(readOnlyHint/
 *       destructiveHint)未翻转 —— 静默刷新,不惊动任何授权;</li>
 *   <li>{@code BREAKING}(安全相关差异,强制重新确认后生效;存量授权自动失效):
 *       <ol>
 *         <li>新增必填参数(新 required 集合多出的属性);</li>
 *         <li>既有属性 type 变化;</li>
 *         <li>readOnlyHint 翻转(任一方向:true→false 可能引入写操作,
 *             false→true 会撤掉确认闸门——对 V14「true→false」的保守扩展);</li>
 *         <li>destructiveHint false→true(安全恶化;true→false 收紧按兼容)。</li>
 *       </ol>
 *       与《04-调研》V14 三条安全相关差异(工具名集合变化/新增必填参数/
 *       readOnlyHint 翻转)对齐:工具名集合变化由注册/注销端点天然承载,
 *       本服务只判单工具内差异;</li>
 *   <li>{@code COMPATIBLE}:其余差异(纯增量:新增可选属性、描述变化、
 *       移除必填约束、enum 放宽等)—— 自动接受并留审计。</li>
 * </ul>
 *
 * <p>比较层级:顶层 properties 的 type/required/enum + 注解安全位
 * (嵌套对象差异不逐层下钻,分层 diff 列为工具体检 P1 增强)。
 * 运行级快照 pinning(ADR-5)不受任何分诊结果影响。
 */
@Service
public class SchemaTriageService {

    /** 分诊档位。 */
    public enum Verdict {
        UNCHANGED,
        COMPATIBLE,
        BREAKING
    }

    private final ObjectMapper objectMapper;

    public SchemaTriageService(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    /**
     * 对比旧(schema+注解)与新(schema+注解),给出分诊结论。
     *
     * <p>DEF-02:next schema 为空/空白视为「未重发 schema」(如管理站「刷新」
     * 按钮的空体调用),无从比对,一律 {@link Verdict#UNCHANGED}——绝不把
     * 「现库 schema vs 空串」判成差异(空串指纹 e3b0c442… 不参与分诊)。
     */
    public SchemaTriage triage(String previousSchemaJson,
                               ToolAnnotations previousAnnotations,
                               String nextSchemaJson,
                               ToolAnnotations nextAnnotations) {
        if (nextSchemaJson == null || nextSchemaJson.isBlank()) {
            return new SchemaTriage(Verdict.UNCHANGED, List.of("schema_not_resent"));
        }
        ToolAnnotations previous = previousAnnotations == null
                ? ToolAnnotations.empty() : previousAnnotations;
        ToolAnnotations next = nextAnnotations == null ? ToolAnnotations.empty() : nextAnnotations;

        String previousFingerprint = ToolSchemaFingerprint.of(objectMapper, previousSchemaJson);
        String nextFingerprint = ToolSchemaFingerprint.of(objectMapper, nextSchemaJson);

        java.util.List<String> reasons = new ArrayList<>();
        if (previousFingerprint.equals(nextFingerprint) && previous.safetyBitsEqual(next)) {
            return new SchemaTriage(Verdict.UNCHANGED, List.of("schema_fingerprint_unchanged"));
        }

        // 注解安全位:readOnlyHint 任一方向翻转都会改变确认口径
        // (true→false 可能引入写操作, false→true 会撤掉确认闸门),一律按安全相关差异;
        // destructiveHint false→true 为安全恶化,true→false 为收紧(按兼容)
        if (!Objects.equals(previous.readOnlyHint(), next.readOnlyHint())) {
            reasons.add("readOnlyHint_flipped(" + previous.readOnlyHint() + "->"
                    + next.readOnlyHint() + ")");
        }
        if (!Boolean.TRUE.equals(previous.destructiveHint())
                && Boolean.TRUE.equals(next.destructiveHint())) {
            reasons.add("destructiveHint_false_to_true");
        } else if (!Objects.equals(previous.destructiveHint(), next.destructiveHint())) {
            reasons.add("destructiveHint_changed");
        }

        JsonNode previousSchema = readSchema(previousSchemaJson, "previous");
        JsonNode nextSchema = readSchema(nextSchemaJson, "next");
        diffProperties(previousSchema, nextSchema, reasons);

        boolean breaking = reasons.stream().anyMatch(reason ->
                reason.startsWith("readOnlyHint_flipped")
                        || reason.equals("destructiveHint_false_to_true")
                        || reason.startsWith("required_added:")
                        || reason.startsWith("type_changed:"));
        if (reasons.isEmpty()) {
            // 指纹不同但顶层矩阵无差异:嵌套层级差异,按纯增量处理(工具体检 P1 下钻)
            return new SchemaTriage(Verdict.COMPATIBLE, List.of("nested_schema_changed"));
        }
        return new SchemaTriage(
                breaking ? Verdict.BREAKING : Verdict.COMPATIBLE,
                reasons);
    }

    private void diffProperties(JsonNode previous, JsonNode next, java.util.List<String> reasons) {
        Set<String> previousRequired = requiredOf(previous);
        Set<String> nextRequired = requiredOf(next);

        for (String name : nextRequired) {
            if (!previousRequired.contains(name)) {
                reasons.add("required_added:" + name);
            }
        }
        JsonNode previousProps = previous.get("properties");
        JsonNode nextProps = next.get("properties");
        if (previousProps == null || !previousProps.isObject()
                || nextProps == null || !nextProps.isObject()) {
            return;
        }
        nextProps.fieldNames().forEachRemaining(name -> {
            JsonNode previousProperty = previousProps.get(name);
            JsonNode nextProperty = nextProps.get(name);
            if (previousProperty == null || !previousProperty.isObject()) {
                return; // 新增属性:必填已判,可选属纯增量
            }
            String previousType = textOf(previousProperty.get("type"));
            String nextType = textOf(nextProperty.get("type"));
            if (previousType != null && nextType != null && !previousType.equals(nextType)) {
                reasons.add("type_changed:" + name + "(" + previousType + "->" + nextType + ")");
            }
        });
    }

    private Set<String> requiredOf(JsonNode schema) {
        Set<String> required = new LinkedHashSet<>();
        JsonNode requiredNode = schema.get("required");
        if (requiredNode != null && requiredNode.isArray()) {
            requiredNode.forEach(entry -> {
                if (entry.isTextual()) {
                    required.add(entry.asText());
                }
            });
        }
        return required;
    }

    private JsonNode readSchema(String schemaJson, String side) {
        if (schemaJson == null || schemaJson.isBlank()) {
            return objectMapper.createObjectNode();
        }
        try {
            JsonNode node = objectMapper.readTree(schemaJson);
            return node == null || !node.isObject() ? objectMapper.createObjectNode() : node;
        } catch (Exception invalid) {
            throw new com.inneragent.platform.common.BusinessException(400,
                    side + " schema 不是合法 JSON: " + invalid.getMessage());
        }
    }

    private static String textOf(JsonNode node) {
        return node != null && node.isTextual() ? node.asText() : null;
    }
}
