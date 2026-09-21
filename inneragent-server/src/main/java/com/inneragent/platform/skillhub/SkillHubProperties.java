package com.inneragent.platform.skillhub;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 应用级 Skill 体系配置(P4-W13 M4;前缀 {@code inneragent.skillhub})。
 *
 * <p>导入包校验上限缺省值来自 03-开发计划 §7.3 验收 2 与 PRD §6.4:
 * zip 解压后总量 10MB / 条目 200 / zip bomb 压缩比 100 / 单 Skill 内容
 * 128KB;激活上限 8(应用内同时 active 行数)。全部可配。
 */
@ConfigurationProperties(prefix = "inneragent.skillhub")
public class SkillHubProperties {

    /** zip 原始上传字节上限(防读入内存前的 DoS;缺省 20MB)。 */
    private long maxUploadBytes = 20L * 1024 * 1024;

    /** 解压后全部条目总字节上限(缺省 10MB)。 */
    private long maxTotalBytes = 10L * 1024 * 1024;

    /** 解压后条目数上限(目录条目不计;缺省 200)。 */
    private int maxEntries = 200;

    /**
     * zip bomb 判定:单条目 解压后/压缩后 比值上限(压缩流不可得时按
     * 包级平均比;缺省 100,正常 markdown/文本极少超过 30)。
     */
    private long maxCompressionRatio = 100;

    /** 单 Skill 内容总量上限(PRD:单个 Skill 内容上限 128KB)。 */
    private long maxSkillContentBytes = 128L * 1024;

    /** 应用内同时激活 Skill 数上限(PRD:默认 8)。 */
    private int maxActivePerApp = 8;

    public long getMaxUploadBytes() {
        return maxUploadBytes;
    }

    public void setMaxUploadBytes(long maxUploadBytes) {
        if (maxUploadBytes <= 0) {
            throw new IllegalArgumentException("maxUploadBytes must be greater than zero");
        }
        this.maxUploadBytes = maxUploadBytes;
    }

    public long getMaxTotalBytes() {
        return maxTotalBytes;
    }

    public void setMaxTotalBytes(long maxTotalBytes) {
        if (maxTotalBytes <= 0) {
            throw new IllegalArgumentException("maxTotalBytes must be greater than zero");
        }
        this.maxTotalBytes = maxTotalBytes;
    }

    public int getMaxEntries() {
        return maxEntries;
    }

    public void setMaxEntries(int maxEntries) {
        if (maxEntries <= 0) {
            throw new IllegalArgumentException("maxEntries must be greater than zero");
        }
        this.maxEntries = maxEntries;
    }

    public long getMaxCompressionRatio() {
        return maxCompressionRatio;
    }

    public void setMaxCompressionRatio(long maxCompressionRatio) {
        if (maxCompressionRatio <= 0) {
            throw new IllegalArgumentException("maxCompressionRatio must be greater than zero");
        }
        this.maxCompressionRatio = maxCompressionRatio;
    }

    public long getMaxSkillContentBytes() {
        return maxSkillContentBytes;
    }

    public void setMaxSkillContentBytes(long maxSkillContentBytes) {
        if (maxSkillContentBytes <= 0) {
            throw new IllegalArgumentException("maxSkillContentBytes must be greater than zero");
        }
        this.maxSkillContentBytes = maxSkillContentBytes;
    }

    public int getMaxActivePerApp() {
        return maxActivePerApp;
    }

    public void setMaxActivePerApp(int maxActivePerApp) {
        if (maxActivePerApp <= 0) {
            throw new IllegalArgumentException("maxActivePerApp must be greater than zero");
        }
        this.maxActivePerApp = maxActivePerApp;
    }
}
