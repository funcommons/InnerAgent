package com.inneragent.platform.kb;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 文档分段器(P4-W14 M5;纯函数,确定性)。
 *
 * <p>PRD §6.5「按标题/段落 + 最大长度切分,保留来源(文档名/章节/锚点)」:
 * 先按 Markdown 标题(#..######)切节并记章节锚点,节内按空行段落装箱;
 * 段落超过最大长度时按字符窗硬切(窗长 size,步长 size-overlap,窗口间
 * 字面重叠)。装箱跨段/跨窗时携带前块尾部 ≤overlap 字符作重叠前缀
 * (放不下则截短前缀,保证每块 ≤ size)。空段/纯空白丢弃,分段序号按
 * 输出顺序 0 起连续。
 *
 * <p>参数约束:size ≥ 1;0 ≤ overlap &lt; size(overlap ≥ size 会使硬切
 * 不前进,构造期拒绝)。
 */
public final class DocumentChunker {

    private final int size;
    private final int overlap;

    public DocumentChunker(int size, int overlap) {
        if (size < 1) {
            throw new IllegalArgumentException("chunk size must be positive");
        }
        if (overlap < 0 || overlap >= size) {
            throw new IllegalArgumentException(
                    "chunk overlap must be in [0, size)");
        }
        this.size = size;
        this.overlap = overlap;
    }

    public int size() {
        return size;
    }

    public int overlap() {
        return overlap;
    }

    /** 分段结果:seq 文档内连续,anchor 章节锚点(无标题节为 null)。 */
    public record Chunk(int seq, String anchor, String content) {
        public Chunk {
            Objects.requireNonNull(content, "content must not be null");
        }
    }

    public List<Chunk> chunk(String document) {
        List<Chunk> chunks = new ArrayList<>();
        if (document == null || document.isBlank()) {
            return chunks;
        }
        int seq = 0;
        for (Section section : sections(document)) {
            String block = "";   // 当前装箱块(不含待挂重叠前缀)
            String carry = "";   // 等待挂到下一块开头的重叠前缀(≤overlap 字符)
            for (String paragraph : section.paragraphs()) {
                if (paragraph.length() > size) {
                    seq = flush(chunks, seq, block, section.anchor());
                    block = "";
                    seq = hardSplit(chunks, seq, section.anchor(), paragraph);
                    carry = tail(chunks.getLast().content());
                    continue;
                }
                if (block.isEmpty()) {
                    block = prefixFor(carry, paragraph) + paragraph;
                    carry = "";
                    continue;
                }
                if (block.length() + 1 + paragraph.length() <= size) {
                    block = block + "\n" + paragraph;
                    continue;
                }
                // 装不下:落当前块,新块以前块尾部重叠开头(前缀截短保 ≤ size)
                seq = flush(chunks, seq, block, section.anchor());
                carry = tail(block.strip());
                block = prefixFor(carry, paragraph) + paragraph;
            }
            seq = flush(chunks, seq, block, section.anchor());
            // carry 在节末丢弃:它只是上一块尾部的重叠,单独成块会成为重复噪声
        }
        return chunks;
    }

    // ------------------------------------------------------------------
    // 标题切节
    // ------------------------------------------------------------------

    private record Section(String anchor, List<String> paragraphs) {
    }

    private List<Section> sections(String document) {
        List<Section> sections = new ArrayList<>();
        Section current = new Section(null, new ArrayList<>());
        StringBuilder paragraph = new StringBuilder();
        for (String line : document.replace("\r\n", "\n").replace('\r', '\n')
                .split("\n", -1)) {
            String heading = headingAnchor(line);
            if (heading != null) {
                flushParagraph(current.paragraphs(), paragraph);
                if (!current.paragraphs().isEmpty()) {
                    sections.add(current);
                }
                current = new Section(heading, new ArrayList<>());
                continue;
            }
            if (line.isBlank()) {
                flushParagraph(current.paragraphs(), paragraph);
            } else {
                if (paragraph.length() > 0) {
                    paragraph.append('\n');
                }
                paragraph.append(line.strip());
            }
        }
        flushParagraph(current.paragraphs(), paragraph);
        if (!current.paragraphs().isEmpty()) {
            sections.add(current);
        }
        return sections;
    }

    /** Markdown 标题行锚点(ATX #..######;非标题行返回 null)。 */
    static String headingAnchor(String line) {
        String stripped = line.strip();
        if (!stripped.startsWith("#")) {
            return null;
        }
        int level = 0;
        while (level < stripped.length() && stripped.charAt(level) == '#') {
            level++;
        }
        if (level > 6 || level >= stripped.length()
                || stripped.charAt(level) != ' ') {
            return null;
        }
        String text = stripped.substring(level).strip();
        return text.isEmpty() ? null : text;
    }

    private static void flushParagraph(List<String> paragraphs, StringBuilder paragraph) {
        if (paragraph.length() > 0) {
            String text = paragraph.toString().strip();
            if (!text.isEmpty()) {
                paragraphs.add(text);
            }
            paragraph.setLength(0);
        }
    }

    // ------------------------------------------------------------------
    // 段落装箱 + 超长硬切
    // ------------------------------------------------------------------

    /** 落当前装箱块(空白块跳过,seq 不前进),返回未前进一步后的 seq。 */
    private int flush(List<Chunk> chunks, int seq, String block, String anchor) {
        String stripped = block.strip();
        if (!stripped.isEmpty()) {
            chunks.add(new Chunk(seq, anchor, stripped));
            return seq + 1;
        }
        return seq;
    }

    /** 超长段落按 [size 窗, size-overlap 步长] 硬切,返回下一 seq。 */
    private int hardSplit(
            List<Chunk> chunks, int seq, String anchor, String paragraph) {
        int step = size - overlap;
        int start = 0;
        while (start < paragraph.length()) {
            String window = paragraph.substring(
                    start, Math.min(start + size, paragraph.length()));
            chunks.add(new Chunk(seq++, anchor, window.strip()));
            start += step;
        }
        return seq;
    }

    /** 重叠前缀:放不下则截短(保证 prefix + "\n" + paragraph ≤ size)。 */
    private String prefixFor(String previousTail, String paragraph) {
        int allowed = size - paragraph.length() - 1;
        if (previousTail.isEmpty() || allowed <= 0) {
            return "";
        }
        return previousTail.length() <= allowed
                ? previousTail + "\n"
                : previousTail.substring(previousTail.length() - allowed) + "\n";
    }

    /** 前块尾部 ≤overlap 字符(下一块的字面重叠)。 */
    private String tail(String text) {
        return text.length() <= overlap ? text : text.substring(text.length() - overlap);
    }
}
