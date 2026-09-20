package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * schema 活刷新分诊矩阵测试(V14;P1-T2a)。
 */
class SchemaTriageServiceTests {

    private final SchemaTriageService service = new SchemaTriageService(new ObjectMapper());

    private static final String BASE_SCHEMA = """
            {"type":"object","properties":{
              "userId":{"type":"integer"},
              "remark":{"type":"string"}
            },"required":["userId"]}
            """;

    @Test
    @DisplayName("指纹一致且注解安全位不变 → unchanged(静默刷新)")
    void identicalSchemaIsUnchanged() {
        SchemaTriage triage = service.triage(
                BASE_SCHEMA, ToolAnnotations.empty(),
                """
                        {"required":["userId"],"type":"object","properties":{
                          "remark":{"type":"string"},
                          "userId":{"type":"integer"}
                        }}
                        """,
                ToolAnnotations.empty());
        assertThat(triage.verdict()).isEqualTo(SchemaTriageService.Verdict.UNCHANGED);
    }

    @Test
    @DisplayName("新增可选属性/描述变化 → compatible(纯增量自动接受)")
    void additiveChangeIsCompatible() {
        SchemaTriage triage = service.triage(
                BASE_SCHEMA, ToolAnnotations.empty(),
                """
                        {"type":"object","properties":{
                          "userId":{"type":"integer","description":"用户ID"},
                          "remark":{"type":"string"},
                          "tag":{"type":"string"}
                        },"required":["userId"]}
                        """,
                ToolAnnotations.empty());
        assertThat(triage.verdict()).isEqualTo(SchemaTriageService.Verdict.COMPATIBLE);
    }

    @Test
    @DisplayName("移除必填约束 → compatible(放宽)")
    void removingRequiredIsCompatible() {
        SchemaTriage triage = service.triage(
                BASE_SCHEMA, ToolAnnotations.empty(),
                """
                        {"type":"object","properties":{
                          "userId":{"type":"integer"},
                          "remark":{"type":"string"}
                        },"required":[]}
                        """,
                ToolAnnotations.empty());
        assertThat(triage.verdict()).isEqualTo(SchemaTriageService.Verdict.COMPATIBLE);
    }

    @Test
    @DisplayName("新增必填参数 → breaking(V14 安全相关差异)")
    void addedRequiredParameterIsBreaking() {
        SchemaTriage triage = service.triage(
                BASE_SCHEMA, ToolAnnotations.empty(),
                """
                        {"type":"object","properties":{
                          "userId":{"type":"integer"},
                          "remark":{"type":"string"},
                          "reason":{"type":"string"}
                        },"required":["userId","reason"]}
                        """,
                ToolAnnotations.empty());
        assertThat(triage.verdict()).isEqualTo(SchemaTriageService.Verdict.BREAKING);
        assertThat(triage.reasons()).contains("required_added:reason");
    }

    @Test
    @DisplayName("既有属性 type 变化 → breaking")
    void changedPropertyTypeIsBreaking() {
        SchemaTriage triage = service.triage(
                BASE_SCHEMA, ToolAnnotations.empty(),
                """
                        {"type":"object","properties":{
                          "userId":{"type":"string"},
                          "remark":{"type":"string"}
                        },"required":["userId"]}
                        """,
                ToolAnnotations.empty());
        assertThat(triage.verdict()).isEqualTo(SchemaTriageService.Verdict.BREAKING);
        assertThat(triage.reasons()).anyMatch(reason -> reason.startsWith("type_changed:userId"));
    }

    @Test
    @DisplayName("readOnlyHint true→false → breaking(V14 原文差异)")
    void readOnlyHintFlipToFalseIsBreaking() {
        SchemaTriage triage = service.triage(
                BASE_SCHEMA,
                new ToolAnnotations("{\"readOnlyHint\":true}", true, null, null, null),
                BASE_SCHEMA,
                new ToolAnnotations("{\"readOnlyHint\":false}", false, null, null, null));
        assertThat(triage.verdict()).isEqualTo(SchemaTriageService.Verdict.BREAKING);
        assertThat(triage.reasons()).anyMatch(reason -> reason.startsWith("readOnlyHint_flipped"));
    }

    @Test
    @DisplayName("readOnlyHint false→true(撤确认闸门)同样 breaking(保守扩展)")
    void readOnlyHintFlipToTrueIsAlsoBreaking() {
        SchemaTriage triage = service.triage(
                BASE_SCHEMA,
                new ToolAnnotations("{\"readOnlyHint\":false}", false, null, null, null),
                BASE_SCHEMA,
                new ToolAnnotations("{\"readOnlyHint\":true}", true, null, null, null));
        assertThat(triage.verdict()).isEqualTo(SchemaTriageService.Verdict.BREAKING);
    }

    @Test
    @DisplayName("destructiveHint false→true → breaking;true→false 收紧 → compatible")
    void destructiveHintDirectionMatters() {
        SchemaTriage escalate = service.triage(
                BASE_SCHEMA,
                new ToolAnnotations("{}", null, false, null, null),
                BASE_SCHEMA,
                new ToolAnnotations("{\"destructiveHint\":true}", null, true, null, null));
        assertThat(escalate.verdict()).isEqualTo(SchemaTriageService.Verdict.BREAKING);

        SchemaTriage tighten = service.triage(
                BASE_SCHEMA,
                new ToolAnnotations("{\"destructiveHint\":true}", null, true, null, null),
                BASE_SCHEMA,
                new ToolAnnotations("{}", null, false, null, null));
        assertThat(tighten.verdict()).isEqualTo(SchemaTriageService.Verdict.COMPATIBLE);
    }

    @Test
    @DisplayName("DEF-02:空/空白 next schema = 未重发 → unchanged(schema_not_resent)")
    void blankNextSchemaMeansNotResentAndIsUnchanged() {
        SchemaTriage nullSchema = service.triage(
                BASE_SCHEMA, ToolAnnotations.empty(), null, ToolAnnotations.empty());
        SchemaTriage blankSchema = service.triage(
                BASE_SCHEMA, ToolAnnotations.empty(), "   ", ToolAnnotations.empty());

        assertThat(nullSchema.verdict()).isEqualTo(SchemaTriageService.Verdict.UNCHANGED);
        assertThat(nullSchema.reasons()).containsExactly("schema_not_resent");
        assertThat(blankSchema.verdict()).isEqualTo(SchemaTriageService.Verdict.UNCHANGED);
        assertThat(blankSchema.reasons()).containsExactly("schema_not_resent");
    }

    @Test
    @DisplayName("DEF-02:未重发 schema 不得把「注解未变」误判成 compatible/breaking")
    void blankNextSchemaIgnoresAnnotationComparison() {
        // 空体调用即使携带注解翻转,也因「未重发 schema」走 unchanged(不落 pending/不改指纹)
        SchemaTriage triage = service.triage(
                BASE_SCHEMA,
                new ToolAnnotations("{\"readOnlyHint\":true}", true, null, null, null),
                "",
                new ToolAnnotations("{\"readOnlyHint\":false}", false, null, null, null));
        assertThat(triage.verdict()).isEqualTo(SchemaTriageService.Verdict.UNCHANGED);
        assertThat(triage.reasons()).containsExactly("schema_not_resent");
    }

    @Test
    @DisplayName("指纹不同但顶层矩阵无差异(嵌套变化)→ compatible(nested_schema_changed)")
    void nestedOnlyChangeIsCompatible() {
        SchemaTriage triage = service.triage(
                BASE_SCHEMA, ToolAnnotations.empty(),
                """
                        {"type":"object","properties":{
                          "userId":{"type":"integer","minimum":1},
                          "remark":{"type":"string"}
                        },"required":["userId"]}
                        """,
                ToolAnnotations.empty());
        assertThat(triage.verdict()).isEqualTo(SchemaTriageService.Verdict.COMPATIBLE);
        assertThat(triage.reasons()).containsExactly("nested_schema_changed");
    }
}
