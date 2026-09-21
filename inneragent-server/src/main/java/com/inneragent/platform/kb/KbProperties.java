package com.inneragent.platform.kb;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * mini 知识库配置(P4-W14 M5;前缀 {@code inneragent.kb})。
 *
 * <p>缺省值口径:PRD §6.5 单文档 ≤5MB、单库 ≤1000 文档(超限提示拆库);
 * 分段 size≈500 字 / overlap≈50(任务口径,可配);检索 top-k 缺省 4;
 * 检索配置缺省 'simple'(Q4:zhparser 存在时可配 'zhparser',运行期探测
 * 不可得自动降级并 WARN,见 {@link KbSearchConfigResolver})。全部可配——
 * 测试可将 {@code max-documents-per-app} 缩小做上限边界。
 */
@ConfigurationProperties(prefix = "inneragent.kb")
public class KbProperties {

    /** 单文档正文字节上限(PRD:单文档 ≤ 5MB)。 */
    private long maxDocumentBytes = 5L * 1024 * 1024;

    /** 单应用文档数上限(PRD:单库 ≤ 1000 文档,超限明确报错提示拆库)。 */
    private int maxDocumentsPerApp = 1000;

    /** 分段最大长度(字符;PRD「最大长度切分」任务口径 ≈500 字)。 */
    private int chunkSize = 500;

    /** 相邻分段字面重叠(字符;任务口径 ≈50,须 &lt; chunkSize)。 */
    private int chunkOverlap = 50;

    /** 单文档分段数上限(防病态文档;超限 400 明确报错)。 */
    private int maxChunksPerDocument = 2000;

    /** 运行组装检索 top-k(PRD/任务口径缺省 4)。 */
    private int retrievalTopK = 4;

    /**
     * tsvector 检索配置:缺省 'simple';可配 'zhparser'(Compose 镜像内置
     * 前提)。变更后须重建索引(POST /admin/kb/documents/{id}/rebuild-index)。
     */
    private String searchConfig = "simple";

    /** 检索查询最大取用字符(超长用户消息截断,防 tsquery 膨胀)。 */
    private int maxQueryChars = 200;

    /** 单次运行注入「引用资料」区块的正文预算(字符,整段截停)。 */
    private int maxInjectedChars = 8000;

    public long getMaxDocumentBytes() {
        return maxDocumentBytes;
    }

    public void setMaxDocumentBytes(long maxDocumentBytes) {
        if (maxDocumentBytes <= 0) {
            throw new IllegalArgumentException("maxDocumentBytes must be greater than zero");
        }
        this.maxDocumentBytes = maxDocumentBytes;
    }

    public int getMaxDocumentsPerApp() {
        return maxDocumentsPerApp;
    }

    public void setMaxDocumentsPerApp(int maxDocumentsPerApp) {
        if (maxDocumentsPerApp <= 0) {
            throw new IllegalArgumentException("maxDocumentsPerApp must be greater than zero");
        }
        this.maxDocumentsPerApp = maxDocumentsPerApp;
    }

    public int getChunkSize() {
        return chunkSize;
    }

    public void setChunkSize(int chunkSize) {
        if (chunkSize < 1) {
            throw new IllegalArgumentException("chunkSize must be positive");
        }
        this.chunkSize = chunkSize;
    }

    public int getChunkOverlap() {
        return chunkOverlap;
    }

    public void setChunkOverlap(int chunkOverlap) {
        if (chunkOverlap < 0) {
            throw new IllegalArgumentException("chunkOverlap must not be negative");
        }
        this.chunkOverlap = chunkOverlap;
    }

    public int getMaxChunksPerDocument() {
        return maxChunksPerDocument;
    }

    public void setMaxChunksPerDocument(int maxChunksPerDocument) {
        if (maxChunksPerDocument <= 0) {
            throw new IllegalArgumentException("maxChunksPerDocument must be greater than zero");
        }
        this.maxChunksPerDocument = maxChunksPerDocument;
    }

    public int getRetrievalTopK() {
        return retrievalTopK;
    }

    public void setRetrievalTopK(int retrievalTopK) {
        if (retrievalTopK <= 0) {
            throw new IllegalArgumentException("retrievalTopK must be positive");
        }
        this.retrievalTopK = retrievalTopK;
    }

    public String getSearchConfig() {
        return searchConfig;
    }

    public void setSearchConfig(String searchConfig) {
        if (searchConfig == null || searchConfig.isBlank()) {
            throw new IllegalArgumentException("searchConfig must not be blank");
        }
        this.searchConfig = searchConfig.trim();
    }

    public int getMaxQueryChars() {
        return maxQueryChars;
    }

    public void setMaxQueryChars(int maxQueryChars) {
        if (maxQueryChars <= 0) {
            throw new IllegalArgumentException("maxQueryChars must be positive");
        }
        this.maxQueryChars = maxQueryChars;
    }

    public int getMaxInjectedChars() {
        return maxInjectedChars;
    }

    public void setMaxInjectedChars(int maxInjectedChars) {
        if (maxInjectedChars <= 0) {
            throw new IllegalArgumentException("maxInjectedChars must not be positive");
        }
        this.maxInjectedChars = maxInjectedChars;
    }
}
