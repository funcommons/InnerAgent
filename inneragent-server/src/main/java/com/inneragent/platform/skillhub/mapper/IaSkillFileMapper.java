package com.inneragent.platform.skillhub.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.skillhub.IaSkillFile;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * Skill 文件内容 Mapper(ia_skill_file;V19,P4-W13)。
 */
@Mapper
public interface IaSkillFileMapper extends BaseMapper<IaSkillFile> {

    /** 整包替换第一步:清空旧文件行(同事务内随后重插)。 */
    @Delete("DELETE FROM ia_skill_file WHERE skill_id = #{skillId}")
    int deleteBySkillId(@Param("skillId") long skillId);
}
