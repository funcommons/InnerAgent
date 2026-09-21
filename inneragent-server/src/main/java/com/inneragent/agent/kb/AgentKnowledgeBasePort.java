package com.inneragent.agent.kb;

import java.util.List;

/**
 * mini 知识库内核端口(P4-W14 内核接线;实现落 platform/kb,依赖方向与
 * {@code AppSkillCatalogPort}(Skill 接线先例)一致:内核端口+平台实现)。
 *
 * <p>消费点:{@code AgentScopePipelineRunService.prepare}——会话运行组装时
 * 按用户消息检索 top-k(缺省 4)分段,<strong>命中才注入</strong>:以
 * 「引用资料」区块({@link KbReferencesBlock})随执行输入进上下文,
 * <strong>不改变系统提示词</strong>(防提示注入语义,03-开发计划 §7.4);
 * 命中清单经 {@link #recordRunCitations} 随运行留痕,终态 DONE 事件投影时
 * 回填引用 chunk id/来源标题(事件契约可选字段,不破既有消费者)。
 *
 * <p>实现允许检索失败降级(返回空列表):KB 不可用不阻断会话可用性,
 * 平台侧记 WARN(装配缺失/查询异常同形)。
 */
public interface AgentKnowledgeBasePort {

    /**
     * 按查询文本检索当前应用知识库的 top-k 命中分段(仅 active 且未删
     * 文档;无命中返回空列表)。query 为用户可见消息文本(安全过滤后),
     * 实现自行截断至可配上限。
     */
    List<KbHit> retrieve(long appId, String query, int topK);

    /**
     * 运行引用留痕:组装命中的分段清单以 JSON(TEXT)落
     * {@code ia_agent_run.kb_citations_json}。best-effort:落库失败仅 WARN,
     * 不使运行失败(执行输入已组装完毕,缺引用展示属可观测降级)。
     */
    void recordRunCitations(String runId, long appId, List<KbHit> hits);

    /** 检索命中的分段(引用溯源最小字段集;content 为分段正文)。 */
    record KbHit(
            long chunkId,
            long documentId,
            String documentTitle,
            String anchor,
            int seq,
            String content) {
    }
}
