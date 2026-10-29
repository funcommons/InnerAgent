package com.inneragent.platform.kb;

import java.util.List;

/**
 * KB 向量化端口(可选语义层;升级战役 D2):文本批 → 等长向量批
 * (顺序与入参一致)。OpenAI 兼容实现见
 * {@link OpenAiCompatibleKbEmbeddingClient};失败统一抛
 * {@link KbEmbeddingException},由调用方按降级哲学处置(检索降级纯全文、
 * 摄取放行 NULL 向量)。
 */
public interface KbEmbeddingPort {

    /** 批量向量化:出参顺序与入参一致;空输入返回空列表(零外呼)。 */
    List<float[]> embed(List<String> texts);

    /** 缺席态:恒返空列表(语义层未装配时的 no-op 实现)。 */
    static KbEmbeddingPort noop() {
        return texts -> List.of();
    }
}
