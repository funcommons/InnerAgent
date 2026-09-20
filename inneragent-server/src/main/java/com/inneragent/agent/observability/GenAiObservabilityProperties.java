package com.inneragent.agent.observability;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * GenAI 可观测配置(任务 #18b,前缀 {@code inneragent.observability.genai})。
 *
 * <p>内容属性默认关闭对齐审计脱敏(PRD §8「消息内容属性默认关闭」):
 * {@code capture-content=true} 时才记录 prompt/completion 摘要,且按
 * {@code content-max-chars} 截断,防止大上下文进属性。
 */
@ConfigurationProperties(prefix = "inneragent.observability.genai")
public class GenAiObservabilityProperties {

    /**
     * 是否记录内容属性(gen_ai.prompt / gen_ai.completion 摘要);
     * 默认 false(仅元数据与用量属性)。
     */
    private boolean captureContent = false;

    /** 内容属性单值最大字符数(超长截断)。 */
    private int contentMaxChars = 512;

    public boolean isCaptureContent() {
        return captureContent;
    }

    public void setCaptureContent(boolean captureContent) {
        this.captureContent = captureContent;
    }

    public int getContentMaxChars() {
        return contentMaxChars;
    }

    public void setContentMaxChars(int contentMaxChars) {
        this.contentMaxChars = contentMaxChars;
    }
}
