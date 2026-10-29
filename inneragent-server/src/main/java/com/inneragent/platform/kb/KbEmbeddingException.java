package com.inneragent.platform.kb;

/**
 * KB 向量化失败(可选语义层;升级战役 D2)。
 *
 * <p>覆盖外呼失败(非 2xx/超时/断连)与响应畸形(缺 {@code data}/
 * {@code index} 越界/{@code embedding} 分量非数值)。按降级哲学,本异常
 * 在检索侧被 {@link KbRetrievalService} 捕获降级纯全文、在摄取侧被
 * {@link KbIngestService} 捕获放行(分段照常入库,embedding_json 为 NULL),
 * 不阻断任何主路径。
 */
public class KbEmbeddingException extends RuntimeException {

    public KbEmbeddingException(String message) {
        super(message);
    }

    public KbEmbeddingException(String message, Throwable cause) {
        super(message, cause);
    }
}
