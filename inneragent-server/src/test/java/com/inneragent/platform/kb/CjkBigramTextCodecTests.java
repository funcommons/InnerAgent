package com.inneragent.platform.kb;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * CJK 二元切分编解码单测(P4-W14 Q4 降级路径;先测后码):
 * 中文词 bigram 命中、西文原样、混排边界、奇数段尾字、确定性。
 */
class CjkBigramTextCodecTests {

    @Test
    void nullAndEmptyInputsMapToEmpty() {
        assertThat(CjkBigramTextCodec.forIndex(null)).isEmpty();
        assertThat(CjkBigramTextCodec.forIndex("")).isEmpty();
        assertThat(CjkBigramTextCodec.forIndex("   ")).isEmpty();
    }

    @Test
    void chineseRunBecomesSpaceSeparatedBigrams() {
        assertThat(CjkBigramTextCodec.forIndex("合同条款"))
                .isEqualTo("合同 同条 条款");
    }

    @Test
    void oddLengthRunEndsWithSingleTailToken() {
        assertThat(CjkBigramTextCodec.forIndex("合同法"))
                .isEqualTo("合同 同法 法");
        assertThat(CjkBigramTextCodec.forIndex("假"))
                .isEqualTo("假");
    }

    @Test
    void latinWordsAndDigitsPassThrough() {
        assertThat(CjkBigramTextCodec.forIndex("hello world 123"))
                .isEqualTo("hello world 123");
    }

    @Test
    void cjkAndLatinGetExplicitBoundarySpaces() {
        // 'simple' 解析器把 CJK 表意字视作字母:不补空格会与西文粘成单词位
        assertThat(CjkBigramTextCodec.forIndex("合同模板v2"))
                .isEqualTo("合同 同模 模板 v2");
    }

    @Test
    void whitespaceIsNormalizedDeterministically() {
        // 空白归一化后,CJK 连续段以空白为界(空白隔开的字不成 bigram)
        assertThat(CjkBigramTextCodec.forIndex("知识  库\n检索"))
                .isEqualTo(CjkBigramTextCodec.forIndex("知识 库 检索"))
                .isEqualTo("知识 库 检索");
    }

    @Test
    void queryAndDocumentSidesAgreeOnSharedSubstring() {
        // 检索命中近似:文档句与查询词共享 bigram("合同 条款")
        String document = CjkBigramTextCodec.forIndex("这是融光员工手册中的合同条款章节。");
        String query = CjkBigramTextCodec.forIndex("合同条款");
        for (String token : query.split(" ")) {
            assertThat(document).contains(token);
        }
    }

    @Test
    void kanaIsSegmentedWhileAsciiStaysIntact() {
        // 奇数长度段(3 字)按规约带单元字尾 token
        assertThat(CjkBigramTextCodec.forIndex("テストabc"))
                .isEqualTo("テス スト ト abc");
    }

    @Test
    void cjkRangesAreClassifiedConsistently() {
        assertThat(CjkBigramTextCodec.isCjk('中')).isTrue();
        assertThat(CjkBigramTextCodec.isCjk('ぁ')).isTrue();
        assertThat(CjkBigramTextCodec.isCjk('ア')).isTrue();
        assertThat(CjkBigramTextCodec.isCjk('a')).isFalse();
        assertThat(CjkBigramTextCodec.isCjk('1')).isFalse();
        assertThat(CjkBigramTextCodec.isCjk('。')).isFalse();
    }
}
