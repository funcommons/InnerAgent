package com.inneragent.platform.toolhub;

import java.util.List;
import java.util.Objects;

/**
 * schema 活刷新分诊结论(V14;PRD §6.2.1 schema 变更规则)。
 *
 * @param verdict 分诊档位:unchanged/compatible/breaking
 * @param reasons 分诊理由列表(落 ia_tool_schema_history.detail)
 */
public record SchemaTriage(SchemaTriageService.Verdict verdict, List<String> reasons) {

    public SchemaTriage {
        Objects.requireNonNull(verdict, "verdict must not be null");
        reasons = reasons == null ? List.of() : List.copyOf(reasons);
    }

    public boolean unchanged() {
        return verdict == SchemaTriageService.Verdict.UNCHANGED;
    }

    public boolean breaking() {
        return verdict == SchemaTriageService.Verdict.BREAKING;
    }
}
