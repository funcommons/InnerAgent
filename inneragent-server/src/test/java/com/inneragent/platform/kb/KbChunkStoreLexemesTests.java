package com.inneragent.platform.kb;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 分段仓库查询词位构造单测(P4-W14):二元切分词位化、标点剥离防
 * to_tsquery 语法注入、AND→OR 兜底的词位串形态。
 */
class KbChunkStoreLexemesTests {

    @Test
    void chineseQueryYieldsBigramLexemes() {
        assertThat(KbChunkStore.lexemes("合同条款"))
                .containsExactly("合同", "同条", "条款");
    }

    @Test
    void punctuationIsStrippedToAvoidTsquerySyntaxInjection() {
        // 单引号/运算符若进入词位串会改变 to_tsquery 语法;标点同时切断
        // CJK 连续段(引号两侧的「合同」「条款」各成独立词位)
        assertThat(KbChunkStore.lexemes("合同' & (条款) | ;DROP"))
                .containsExactly("合同", "条款", "DROP");
    }

    @Test
    void tsqueryJoinsLexemesWithOperator() {
        assertThat(KbChunkStore.tsquery(List.of("合同", "条款"), " & "))
                .isEqualTo("'合同' & '条款'");
        assertThat(KbChunkStore.tsquery(List.of("合同", "条款"), " | "))
                .isEqualTo("'合同' | '条款'");
        assertThat(KbChunkStore.tsquery(List.of(), " & ")).isEmpty();
    }

    @Test
    void emptyOrPunctuationOnlyQueryYieldsNoLexemes() {
        assertThat(KbChunkStore.lexemes("")).isEmpty();
        assertThat(KbChunkStore.lexemes("!?,.;:")).isEmpty();
        assertThat(KbChunkStore.lexemes(null)).isEmpty();
    }

    @Test
    void latinTokensStayWhole() {
        assertThat(KbChunkStore.lexemes("leave policy v2")).containsExactly("leave", "policy", "v2");
    }
}
