package com.inneragent.server.admin.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.server.admin.AdminAccount;
import org.apache.ibatis.annotations.Mapper;

/**
 * 管理员账号 Mapper(V10;平台级表,行级拦截器忽略清单内,按 username 全局定位)。
 */
@Mapper
public interface AdminAccountMapper extends BaseMapper<AdminAccount> {
}
