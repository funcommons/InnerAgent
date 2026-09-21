package com.inneragent.agent.skill;

import java.util.List;

/**
 * 应用级激活 Skill 目录端口(P4-W13 内核接线;实现落 platform/skillhub,
 * 依赖方向与融光「内核不依赖平台存储」口径一致)。
 *
 * <p>消费点:{@code AgentScopePipelineRunService.resolveActiveSkills}——
 * 已激活的应用级 Skill 并入可用目录(内置仓库 < 应用激活 < 用户自定义,
 * 同名后者覆盖);未激活的 Skill 不出现在目录中,即「按需激活不占常驻
 * 上下文」的平台侧语义。运行期 per-turn 激活仍受每次 ≤8 与 128KB 总量
 * 约束(既有逻辑),激活内容经系统提示词随内核快照固化。
 */
public interface AppSkillCatalogPort {

    /** 指定应用当前已激活的 Skill(name 升序;内容为 SKILL.md 正文)。 */
    List<ActivatedAppSkill> activated(long appId);

    /** 激活 Skill 的内核输入形态(对齐 AgentSkill 四要素)。 */
    record ActivatedAppSkill(
            Long id,
            String name,
            String displayName,
            String description,
            String markdown,
            String source) {
    }
}
