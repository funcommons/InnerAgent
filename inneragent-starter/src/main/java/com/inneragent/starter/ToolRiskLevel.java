package com.inneragent.starter;

/**
 * 宿主工具风险等级(PRD §6.2.1:风险等级由工具注册方声明 + InnerAgent 校验;
 * 删除/资金/凭据类工具后台强制标为高危)。注解声明的是「默认值」,InnerAgent 注册时
 * 可人工确认/覆盖 —— 本枚举只负责把声明落到 MCP annotations(FINDINGS §2.4:
 * annotations 是 hint 不是安全边界,R7:仅可信宿主采信)。
 */
public enum ToolRiskLevel {

	/** 只读:readOnlyHint=true,写确认策略默认放行 */
	READ,

	/** 写操作:默认需用户确认 */
	WRITE,

	/** 破坏性(删除/资金/凭据):destructiveHint=true,一律强制确认 */
	DESTRUCTIVE;

	public boolean readOnlyHint() {
		return this == READ;
	}

	public boolean destructiveHint() {
		return this == DESTRUCTIVE;
	}

}
