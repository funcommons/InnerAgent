package com.inneragent.platform.kb;

import java.util.ArrayList;
import java.util.List;

/**
 * CJK 二元切分编解码(P4-W14 Q4 降级路径;纯函数)。
 *
 * <p>PG 'simple' 检索配置按「词」切分,连续中文整句会成为单一词位,字面
 * 关键词命中不了。本类把连续 CJK 字符段(Han/假名)切成以空格分隔的
 * 二元(bigram)序列(奇数长度段末尾单元字自成词位),交 'simple' 分词
 * 即得字面倒排近似;拉丁字母/数字词保持原样(西文检索不受影响)。
 *
 * <p>索引入库与查询同用本切分(tsv = to_tsvector(config, forIndex(content)),
 * 查询 = forIndex(query)),两侧一致方能命中。CJK 段与相邻西文词之间补
 * 空格边界——'simple' 解析器把 CJK 表意字视作字母,不补会与 ASCII 词
 * 粘成单词位。zhparser 可用时(服务层 {@link KbSearchConfigResolver} 探测)
 * 本切分仍安全:zhparser 自带分词不受预切空格影响。
 */
public final class CjkBigramTextCodec {

    private CjkBigramTextCodec() {
    }

    /** 对外形态:规范化原文后按 CJK 二元切分(供 tsvector/tsquery 入参)。 */
    public static String forIndex(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        String normalized = normalize(text);
        if (normalized.isEmpty()) {
            return "";
        }
        List<String> tokens = new ArrayList<>();
        StringBuilder latin = new StringBuilder();
        int index = 0;
        int length = normalized.length();
        while (index < length) {
            int codePoint = normalized.codePointAt(index);
            if (isCjk(codePoint)) {
                flushLatin(tokens, latin);
                int end = index;
                while (end < length && isCjk(normalized.codePointAt(end))) {
                    end += Character.charCount(normalized.codePointAt(end));
                }
                collectBigrams(tokens, normalized.substring(index, end));
                index = end;
            } else {
                latin.appendCodePoint(codePoint);
                index += Character.charCount(codePoint);
            }
        }
        flushLatin(tokens, latin);
        return String.join(" ", tokens);
    }

    /**
     * 规范化:连续空白折为单个空格、trim——保证同一文本两次索引切分
     * 结果一致(确定性)。
     */
    static String normalize(String text) {
        return text.replaceAll("\\s+", " ").trim();
    }

    /** CJK 连续段文本 → bigram 序列(奇数长度段末尾单元字自成词位)。 */
    private static void collectBigrams(List<String> tokens, String run) {
        int[] codePoints = run.codePoints().toArray();
        if (codePoints.length == 1) {
            tokens.add(run);
            return;
        }
        for (int i = 0; i + 1 < codePoints.length; i++) {
            tokens.add(new String(Character.toChars(codePoints[i]))
                    + new String(Character.toChars(codePoints[i + 1])));
        }
        if (codePoints.length % 2 == 1) {
            tokens.add(new String(Character.toChars(codePoints[codePoints.length - 1])));
        }
    }

    /** 非 CJK 段攒成的西文词原样成一个 token(纯空白段丢弃,CJK 边界由 join 补齐)。 */
    private static void flushLatin(List<String> tokens, StringBuilder latin) {
        if (latin.length() > 0) {
            String token = latin.toString().strip();
            if (!token.isEmpty()) {
                tokens.add(token);
            }
            latin.setLength(0);
        }
    }

    /** CJK 表意/假名区段(Han 统一表意及扩展 A/兼容 + 平假名/片假名)。 */
    static boolean isCjk(int codePoint) {
        return (codePoint >= 0x3400 && codePoint <= 0x4DBF)      // CJK 扩展 A
                || (codePoint >= 0x4E00 && codePoint <= 0x9FFF)  // CJK 统一表意
                || (codePoint >= 0x3040 && codePoint <= 0x30FF)  // 平假名/片假名
                || (codePoint >= 0xF900 && codePoint <= 0xFAFF); // CJK 兼容表意
    }
}
