package com.inneragent.platform.skillhub;

import com.inneragent.agent.skill.AppSkillCatalogPort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * {@link AppSkillCatalogPort} 的 DB 实现(P4-W13):委托
 * {@link AppSkillCatalogService#activatedSkills(long)},把 ia_skill
 * 中 status=active 的应用级 Skill 以内核输入形态(AgentSkill 四要素)
 * 供给运行期组装。
 */
@Component
@RequiredArgsConstructor
public class AppSkillCatalogAdapter implements AppSkillCatalogPort {

    private final AppSkillCatalogService skillService;

    @Override
    public List<ActivatedAppSkill> activated(long appId) {
        return skillService.activatedSkills(appId).stream()
                .map(skill -> new ActivatedAppSkill(
                        skill.id(),
                        skill.name(),
                        skill.displayName(),
                        skill.description(),
                        skill.markdown(),
                        skill.source()))
                .toList();
    }
}
