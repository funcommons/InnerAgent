package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.agent.entity.AgentFeedback;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Mapper
public interface AgentFeedbackMapper extends BaseMapper<AgentFeedback> {

    /**
     * 反馈取向计数(W15 北极星):窗口内 👍/👎 各自条数。
     * 返回 {up, down}(聚合标量,无业务实体形态)。
     */
    @Select("""
            <script>
            SELECT COALESCE(SUM(CASE WHEN rating = 'UP' THEN 1 ELSE 0 END), 0) AS up,
                   COALESCE(SUM(CASE WHEN rating = 'DOWN' THEN 1 ELSE 0 END), 0) AS down
            FROM ia_feedback
            WHERE create_time &gt;= #{from}
              AND create_time &lt; #{to}
            <if test="appId != null"> AND app_id = #{appId}</if>
            </script>
            """)
    Map<String, Object> selectRatingCounts(
            @Param("from") LocalDateTime from,
            @Param("to") LocalDateTime to,
            @Param("appId") Long appId);

    /**
     * 带反馈 run 的终态分布(W15 北极星「带反馈完成率代理」)——run 级反馈:
     * run_id 直连运行行(反馈锚到哪条算哪条)。返回 [{status, runs}]。
     */
    @Select("""
            <script>
            SELECT r.status AS status, COUNT(DISTINCT f.run_id) AS runs
            FROM ia_feedback f
            JOIN ia_agent_run r ON r.run_id = f.run_id
            WHERE f.run_id IS NOT NULL
              AND f.create_time &gt;= #{from}
              AND f.create_time &lt; #{to}
            <if test="appId != null"> AND f.app_id = #{appId}</if>
            GROUP BY r.status
            </script>
            """)
    List<Map<String, Object>> selectRunLinkedRunStatuses(
            @Param("from") LocalDateTime from,
            @Param("to") LocalDateTime to,
            @Param("appId") Long appId);

    /**
     * 带反馈 run 的终态分布——消息级反馈(无 run_id):经 conversation_id
     * 关联该会话的根运行(parent_run_id IS NULL;B4 口径为用户可见任务,
     * 子运行不计)。返回 [{status, runs}]。
     */
    @Select("""
            <script>
            SELECT r.status AS status, COUNT(DISTINCT r.run_id) AS runs
            FROM ia_feedback f
            JOIN ia_agent_run r
              ON r.conversation_id = f.conversation_id
             AND r.parent_run_id IS NULL
            WHERE f.run_id IS NULL
              AND f.conversation_id IS NOT NULL
              AND f.create_time &gt;= #{from}
              AND f.create_time &lt; #{to}
            <if test="appId != null"> AND f.app_id = #{appId}</if>
            GROUP BY r.status
            </script>
            """)
    List<Map<String, Object>> selectConversationLinkedRunStatuses(
            @Param("from") LocalDateTime from,
            @Param("to") LocalDateTime to,
            @Param("appId") Long appId);
}
