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

    /** 可选语义层(升级战役 D2):缺省关闭,关闭时零行为、零外呼。 */
    private final Semantic semantic = new Semantic();

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

    public Semantic getSemantic() {
        return semantic;
    }

    /**
     * 可选语义检索组({@code inneragent.kb.semantic.*}):enabled=false
     * (缺省)时纯全文路径逐字节不变、零外呼;开启后摄取侧批量向量化落
     * embedding_json(TEXT 存 JSON 数组,DEF-08 铁律),检索侧余弦 + RRF
     * (k=60)与全文融合,任一异常降级纯全文。endpoint 为 embeddings
     * 完整 URL;向量存储不引入 pgvector(mini 规模 TEXT+JVM 余弦足够,
     * 升级路径见外部知识库规范 §7)。
     */
    public static class Semantic {

        /** 语义层总开关(缺省 false:不配置即零行为)。 */
        private boolean enabled = false;

        /** embeddings 完整 URL(OpenAI 兼容,如 http://host/v1/embeddings)。 */
        private String endpoint;

        /** Bearer 鉴权密钥(外呼语义向量服务用;不落日志)。 */
        private String apiKey;

        /** 向量模型名(text-embedding-3-small 等,随端点约定)。 */
        private String model;

        /** 单次外呼最大文本条数(超批切分多次)。 */
        private int batchSize = 16;

        /** 外呼连接/读超时(毫秒,装配 RestClient 时落参)。 */
        private long timeoutMs = 10_000;

        /** 语义路参与 RRF 融合的候选上限(余弦排序截断)。 */
        private int topN = 8;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getEndpoint() {
            return endpoint;
        }

        public void setEndpoint(String endpoint) {
            this.endpoint = normalize(endpoint);
        }

        public String getApiKey() {
            return apiKey;
        }

        public void setApiKey(String apiKey) {
            this.apiKey = normalize(apiKey);
        }

        public String getModel() {
            return model;
        }

        public void setModel(String model) {
            this.model = normalize(model);
        }

        public int getBatchSize() {
            return batchSize;
        }

        public void setBatchSize(int batchSize) {
            if (batchSize < 1) {
                throw new IllegalArgumentException("batchSize must be positive");
            }
            this.batchSize = batchSize;
        }

        public long getTimeoutMs() {
            return timeoutMs;
        }

        public void setTimeoutMs(long timeoutMs) {
            if (timeoutMs <= 0) {
                throw new IllegalArgumentException("timeoutMs must be positive");
            }
            this.timeoutMs = timeoutMs;
        }

        public int getTopN() {
            return topN;
        }

        public void setTopN(int topN) {
            if (topN < 1) {
                throw new IllegalArgumentException("topN must be positive");
            }
            this.topN = topN;
        }

        private static String normalize(String value) {
            return value == null || value.isBlank() ? null : value.trim();
        }
    }
}
