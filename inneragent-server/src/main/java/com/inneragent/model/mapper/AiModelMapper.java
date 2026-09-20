package com.inneragent.model.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.model.entity.AiModel;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface AiModelMapper extends BaseMapper<AiModel> {

		@Update("""
						UPDATE ia_ai_model
						SET deleted = TRUE,
								deleted_id = id,
								update_time = NOW()
						WHERE id = #{id}
							AND deleted = FALSE
						""")
		int softDeleteById(@Param("id") Long id);
}
