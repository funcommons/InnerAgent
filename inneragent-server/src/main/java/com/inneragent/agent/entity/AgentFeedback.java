package com.inneragent.agent.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.TenantBaseEntity;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * 用户反馈事件(W15;PRD M2 用户反馈 👍/👎,03-开发计划 §7.3 验收 6:
 * 反馈事件入库、北极星看板出数)。
 *
 * <p>维度可空:run 级反馈(整体评价)只带 runId;消息级反馈(👍/👎 按钮
 * 主语义)带 conversationId+messageId。幂等键两级:消息级
 * (app_id,user_id,conversation_id,message_id)优先,run 级
 * (app_id,user_id,run_id,且无消息键)兜底——重复反馈=覆盖(upsert),
 * 部分唯一索引见 V21。
 *
 * <p>继承 {@link TenantBaseEntity}(同 {@link McpUserServer} 形态):用户面
 * 请求无租户上下文时 tenant_id 落 DDL 默认 0,行级拦截器口径不变。
 */
@TableName("ia_feedback")
@Data
@EqualsAndHashCode(callSuper = true)
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AgentFeedback extends TenantBaseEntity {

    /** 反馈取向:👍 */
    public static final String RATING_UP = "UP";
    /** 反馈取向:👎 */
    public static final String RATING_DOWN = "DOWN";

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(ia_app.id) */
    private Long appId;

    /** 反馈用户(行级隔离列) */
    private Long userId;

    /** 所属会话(可空;消息级键的一半) */
    private String conversationId;

    /** 所属运行(可空;run 级键,消息级行可作上下文冗余) */
    private String runId;

    /** 反馈消息标识(可空;与 conversationId 组成消息级键) */
    private String messageId;

    /** 反馈取向:UP-👍 / DOWN-👎 */
    private String rating;

    /** 可选文字评语(自由文本) */
    private String comment;
}
