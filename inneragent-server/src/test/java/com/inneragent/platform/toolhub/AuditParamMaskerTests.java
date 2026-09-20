package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 审计敏感参数统一脱敏器测试矩阵(PRD §6.9:password/token/secret/key 打码):
 * key 匹配(精确/后缀/归一化/大小写)、嵌套对象、数组、深度与元素截断、
 * 非 JSON 原样、null/空白原样、键序保持。
 */
class AuditParamMaskerTests {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode parse(String json) throws Exception {
        return MAPPER.readTree(json);
    }

    @Test
    @DisplayName("精确敏感 key:password/token/secret/apiKey/authorization 等 → ***")
    void exactSensitiveKeysMasked() throws Exception {
        String masked = AuditParamMasker.mask("""
                {"username":"u1","password":"p@ss","token":"tk-1",
                 "secret":"s!","apiKey":"sk-1","api_key":"sk-2",
                 "Authorization":"Bearer x","privateKey":"pk-1"}""");
        JsonNode root = parse(masked);
        assertThat(root.get("username").asText()).isEqualTo("u1");
        assertThat(root.get("password").asText()).isEqualTo("***");
        assertThat(root.get("token").asText()).isEqualTo("***");
        assertThat(root.get("secret").asText()).isEqualTo("***");
        assertThat(root.get("apiKey").asText()).isEqualTo("***");
        assertThat(root.get("api_key").asText()).isEqualTo("***");
        assertThat(root.get("Authorization").asText()).isEqualTo("***");
        assertThat(root.get("privateKey").asText()).isEqualTo("***");
    }

    @Test
    @DisplayName("后缀宽匹配:decrypt_key/refreshToken/userPassword/webhookSecret 误杀方向安全")
    void sensitiveSuffixesMasked() throws Exception {
        String masked = AuditParamMasker.mask("""
                {"decrypt_key":"dk","refreshToken":"rt","userPassword":"up",
                 "webhookSecret":"ws","SESSION-ID":"sid","appSecret":"as"}""");
        JsonNode root = parse(masked);
        assertThat(root.get("decrypt_key").asText()).isEqualTo("***");
        assertThat(root.get("refreshToken").asText()).isEqualTo("***");
        assertThat(root.get("userPassword").asText()).isEqualTo("***");
        assertThat(root.get("webhookSecret").asText()).isEqualTo("***");
        assertThat(root.get("SESSION-ID").asText()).isEqualTo("***");
        assertThat(root.get("appSecret").asText()).isEqualTo("***");
    }

    @Test
    @DisplayName("非敏感 key 不误伤:keyword/monkey/tokens? key 归一化边界")
    void benignKeysKept() throws Exception {
        String masked = AuditParamMasker.mask(
                "{\"keyword\":\"spring\",\"mode\":\"fast\",\"count\":3}");
        JsonNode root = parse(masked);
        assertThat(root.get("keyword").asText()).isEqualTo("spring");
        assertThat(root.get("count").asInt()).isEqualTo(3);
    }

    @Test
    @DisplayName("嵌套对象/数组内递归脱敏;命中 key 的整棵子值(对象/数组)替换为 ***")
    void recursiveMaskingInNestedStructures() throws Exception {
        String masked = AuditParamMasker.mask("""
                {"db":{"host":"h","password":{"salt":"x","hash":"y"}},
                 "items":[{"name":"a","token":"t1"},{"name":"b","token":"t2"}],
                 "blob":["z"]}
                """);
        JsonNode root = parse(masked);
        assertThat(root.get("db").get("host").asText()).isEqualTo("h");
        assertThat(root.get("db").get("password").asText()).isEqualTo("***");
        assertThat(root.get("items").get(0).get("name").asText()).isEqualTo("a");
        assertThat(root.get("items").get(0).get("token").asText()).isEqualTo("***");
        assertThat(root.get("items").get(1).get("token").asText()).isEqualTo("***");
        assertThat(root.get("blob").get(0).asText()).isEqualTo("z");
    }

    @Test
    @DisplayName("数组截断:>50 元素保留前 50 + (array-truncated) 标记")
    void largeArrayTruncated() throws Exception {
        StringBuilder json = new StringBuilder("{\"rows\":[");
        for (int i = 0; i < 60; i++) {
            json.append(i > 0 ? "," : "").append("{\"id\":").append(i).append("}");
        }
        json.append("]}");
        JsonNode root = parse(AuditParamMasker.mask(json.toString()));
        JsonNode rows = root.get("rows");
        assertThat(rows.size()).isEqualTo(AuditParamMasker.MAX_ARRAY_ITEMS + 1);
        assertThat(rows.get(49).get("id").asInt()).isEqualTo(49);
        assertThat(rows.get(50).asText()).isEqualTo(AuditParamMasker.ARRAY_TRUNCATED_MARKER);
    }

    @Test
    @DisplayName("深度截断:>8 层子树替换为 (depth-limit) 标记")
    void deepNestingTruncated() {
        StringBuilder json = new StringBuilder();
        for (int i = 0; i < 20; i++) {
            json.append("{\"level").append(i).append("\":");
        }
        json.append("\"bottom\"");
        for (int i = 0; i < 20; i++) {
            json.append("}");
        }
        String masked = AuditParamMasker.mask(json.toString());
        JsonNode node = null;
        try {
            node = parse(masked);
            // level0..level7 各层仍为对象(深度 1..8),level8 子树在深度 9 被截断
            for (int i = 0; i < 9; i++) {
                node = node.get("level" + i);
            }
        } catch (Exception parseFailure) {
            throw new AssertionError("脱敏结果应为合法 JSON", parseFailure);
        }
        assertThat(node.asText()).isEqualTo(AuditParamMasker.DEPTH_LIMIT_MARKER);
    }

    @Test
    @DisplayName("非 JSON / null / 空白 / 空对象:原样返回(非 JSON 不做内容级猜测)")
    void nonJsonAndBlankInputsPassThrough() {
        assertThat(AuditParamMasker.mask(null)).isNull();
        assertThat(AuditParamMasker.mask("")).isEmpty();
        assertThat(AuditParamMasker.mask("   ")).isEqualTo("   ");
        assertThat(AuditParamMasker.mask("不是 JSON 的写入退化视图"))
                .isEqualTo("不是 JSON 的写入退化视图");
        assertThat(AuditParamMasker.mask("{}")).isEqualTo("{}");
    }

    @Test
    @DisplayName("键序保持:脱敏后 JSON 按原键序(LinkedHashMap)")
    void keyOrderPreserved() {
        String masked = AuditParamMasker.mask(
                "{\"zeta\":\"v\",\"alpha\":\"password-value\",\"beta\":1}");
        assertThat(masked.indexOf("zeta")).isLessThan(masked.indexOf("alpha"));
        assertThat(masked.indexOf("alpha")).isLessThan(masked.indexOf("beta"));
    }

    @Test
    @DisplayName("敏感 key 判定单元:isSensitiveKey 归一化矩阵")
    void sensitiveKeyPredicateMatrix() {
        assertThat(AuditParamMasker.isSensitiveKey("password")).isTrue();
        assertThat(AuditParamMasker.isSensitiveKey("PASSWORD")).isTrue();
        assertThat(AuditParamMasker.isSensitiveKey("client_secret")).isTrue();
        assertThat(AuditParamMasker.isSensitiveKey("X-Api-Key")).isTrue();
        assertThat(AuditParamMasker.isSensitiveKey("accessToken")).isTrue();
        assertThat(AuditParamMasker.isSensitiveKey("")).isFalse();
        assertThat(AuditParamMasker.isSensitiveKey(null)).isFalse();
        assertThat(AuditParamMasker.isSensitiveKey("tokenize")).isFalse();
    }

    @Test
    @DisplayName("写时已脱敏的存量行再过读时脱敏:双保险无害(*** 值保持)")
    void doubleMaskingIsHarmless() throws Exception {
        String alreadyMasked = "{\"password\":\"***\",\"name\":\"n\"}";
        JsonNode root = parse(AuditParamMasker.mask(alreadyMasked));
        assertThat(root.get("password").asText()).isEqualTo("***");
        assertThat(root.get("name").asText()).isEqualTo("n");
    }
}
