package com.inneragent.platform.kb;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 文档分段器单测(P4-W14;先测后码):标题/段落边界、overlap 重叠、
 * 超长文档硬切、确定性(同输入同输出)、非法参数拒绝。
 */
class DocumentChunkerTests {

    @Test
    void rejectsInvalidSizeAndOverlap() {
        assertThatThrownBy(() -> new DocumentChunker(0, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new DocumentChunker(100, 100))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new DocumentChunker(100, -1))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatCode(() -> new DocumentChunker(500, 50)).doesNotThrowAnyException();
    }

    @Test
    void emptyAndBlankDocumentsProduceNoChunks() {
        DocumentChunker chunker = new DocumentChunker(500, 50);
        assertThat(chunker.chunk(null)).isEmpty();
        assertThat(chunker.chunk("")).isEmpty();
        assertThat(chunker.chunk("   \n \n")).isEmpty();
    }

    @Test
    void shortDocumentIsSingleChunkWithoutAnchor() {
        DocumentChunker chunker = new DocumentChunker(500, 50);
        List<DocumentChunker.Chunk> chunks = chunker.chunk("只有一段话的文档。");

        assertThat(chunks).hasSize(1);
        assertThat(chunks.getFirst().seq()).isZero();
        assertThat(chunks.getFirst().anchor()).isNull();
        assertThat(chunks.getFirst().content()).isEqualTo("只有一段话的文档。");
    }

    @Test
    void headingsSplitSectionsAndCarryAnchors() {
        DocumentChunker chunker = new DocumentChunker(100, 10);
        String document = """
                # 请假流程
                事假需要提前一天申请。
                年假按司龄折算。

                # 报销流程
                发票需在 30 天内提交。
                """;
        List<DocumentChunker.Chunk> chunks = chunker.chunk(document);

        assertThat(chunks).hasSize(2);
        assertThat(chunks.get(0).anchor()).isEqualTo("请假流程");
        assertThat(chunks.get(0).content()).contains("事假需要提前一天申请").contains("年假按司龄折算");
        assertThat(chunks.get(1).anchor()).isEqualTo("报销流程");
        assertThat(chunks.get(1).content()).contains("发票需在 30 天内提交");
        assertThat(chunks).extracting(DocumentChunker.Chunk::seq)
                .containsExactly(0, 1);
    }

    @Test
    void headingMustBeAtxWithSpaceOtherwiseTreatedAsText() {
        assertThat(DocumentChunker.headingAnchor("# 有效标题")).isEqualTo("有效标题");
        assertThat(DocumentChunker.headingAnchor("###### 六级标题")).isEqualTo("六级标题");
        assertThat(DocumentChunker.headingAnchor("####### 七个井号")).isNull();
        assertThat(DocumentChunker.headingAnchor("#无空格")).isNull();
        assertThat(DocumentChunker.headingAnchor("##")).isNull();
        assertThat(DocumentChunker.headingAnchor("正文 # 不是标题")).isNull();
    }

    @Test
    void paragraphsPackUpToSizeThenStartNewChunkWithOverlap() {
        int size = 20;
        int overlap = 5;
        DocumentChunker chunker = new DocumentChunker(size, overlap);
        // 段 1 = 9 字,段 2 = 8 字 → 同块(9+1+8=18 ≤ 20);段 3 = 8 字 → 超出,落新块
        String document = "一二三四五六七八九\n\n甲乙丙丁戊己庚辛\n\n子丑寅卯辰巳午未";
        List<DocumentChunker.Chunk> chunks = chunker.chunk(document);

        assertThat(chunks).hasSize(2);
        assertThat(chunks.get(0).content()).hasSizeLessThanOrEqualTo(size);
        assertThat(chunks.get(0).content()).contains("一二三四五六七八九").contains("甲乙丙丁戊己庚辛");
        // 新块以前块尾部 5 字面重叠开头("…甲乙丙丁戊己庚辛"的末 5 字)
        assertThat(chunks.get(1).content()).startsWith("丁戊己庚辛");
        assertThat(chunks.get(1).content()).contains("子丑寅卯辰巳午未");
    }

    @Test
    void everyChunkNeverExceedsConfiguredSize() {
        DocumentChunker chunker = new DocumentChunker(30, 8);
        StringBuilder document = new StringBuilder();
        for (int i = 0; i < 40; i++) {
            document.append("第").append(i).append("段内容,长度恰好跨过多行。\n\n");
        }
        List<DocumentChunker.Chunk> chunks = chunker.chunk(document.toString());

        assertThat(chunks).isNotEmpty();
        assertThat(chunks).allSatisfy(chunk ->
                assertThat(chunk.content().length()).isLessThanOrEqualTo(30));
        assertThat(chunks).extracting(DocumentChunker.Chunk::seq)
                .startsWith(0)
                .containsExactlyElementsOf(
                        java.util.stream.IntStream.range(0, chunks.size()).boxed().toList());
    }

    @Test
    void oversizedParagraphIsHardSplitWithLiteralOverlapWindows() {
        int size = 10;
        int overlap = 3;
        DocumentChunker chunker = new DocumentChunker(size, overlap);
        String paragraph = "0123456789ABCDEFGHIJ"; // 20 字
        List<DocumentChunker.Chunk> chunks = chunker.chunk(paragraph);

        // 窗长 10,步长 7:[0,10),[7,17),[14,20)
        assertThat(chunks).hasSize(3);
        assertThat(chunks.get(0).content()).isEqualTo("0123456789");
        assertThat(chunks.get(1).content()).isEqualTo("789ABCDEFG");
        assertThat(chunks.get(2).content()).isEqualTo("EFGHIJ");
        assertThat(chunks).extracting(DocumentChunker.Chunk::seq)
                .containsExactly(0, 1, 2);
        // 窗口间字面重叠:第 2 块开头 3 字 = 第 1 块末尾 3 字
        assertThat(chunks.get(1).content().substring(0, overlap))
                .isEqualTo(chunks.get(0).content().substring(
                        chunks.get(0).content().length() - overlap));
    }

    @Test
    void mixedHeadingsAndOversizedParagraphsStayDeterministic() {
        DocumentChunker chunker = new DocumentChunker(16, 4);
        String longText = "长".repeat(50);
        String document = "# 锚点\n" + longText + "\n\n尾段\n" + longText + "\n\n尾段\n";
        List<DocumentChunker.Chunk> first = chunker.chunk(document);
        List<DocumentChunker.Chunk> second = chunker.chunk(document);

        assertThat(first).isEqualTo(second);
        assertThat(first).allSatisfy(chunk ->
                assertThat(chunk.content().length()).isLessThanOrEqualTo(16));
        // 锚点贯穿:该节所有块的 anchor 一致
        assertThat(first).allSatisfy(chunk -> assertThat(chunk.anchor()).isEqualTo("锚点"));
    }

    @Test
    void crlfLineEndingsAreNormalized() {
        DocumentChunker chunker = new DocumentChunker(100, 10);
        List<DocumentChunker.Chunk> chunks = chunker.chunk("# 标题\r\n正文第一行\r\n\r\n正文第二行");
        assertThat(chunks).hasSize(1);
        assertThat(chunks.getFirst().content())
                .isEqualTo("正文第一行\n正文第二行")
                .doesNotContain("\r");
    }
}
