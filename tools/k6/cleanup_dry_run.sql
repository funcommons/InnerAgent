-- =============================================================================
-- k6 压测脏数据清理 —— DRY RUN(只读,绝不删除)
-- =============================================================================
-- 与 cleanup-loadtest-data.sql 完全同谓词,仅输出计数与抽样,供执行前核对。
--   docker exec -i inneragent-postgres psql -U inneragent -d inneragent \
--     -v ON_ERROR_STOP=1 < tools/k6/cleanup_dry_run.sql
-- 详细背景(窗口/特征/快照/外键结论)见 cleanup-loadtest-data.sql 头注。
-- =============================================================================

\echo '=== D1. 将删除的 conversation 数(压测锚集合) ==='
SELECT count(*) AS will_delete_conversation
FROM ia_agent_conversation
WHERE user_id = 12993
  AND agent_type = 'demo'
  AND title = '现在几点了?';

\echo '=== D2. 安全反证:12993 下的非压测形态会话,必须 = 0,否则终止! ==='
SELECT count(*) AS must_be_zero_abnormal
FROM ia_agent_conversation
WHERE user_id = 12993
  AND (agent_type IS DISTINCT FROM 'demo' OR title IS DISTINCT FROM '现在几点了?');

\echo '=== D3. title 抽查:12993 最新 10 条(应全部=「现在几点了?」) ==='
SELECT conversation_id, agent_type, title, message_count, status,
       to_char(create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time
FROM ia_agent_conversation
WHERE user_id = 12993
ORDER BY create_time DESC
LIMIT 10;

\echo '=== D4. run 数(压测) ==='
SELECT count(*) AS will_delete_run
FROM ia_agent_run
WHERE user_id = 12993
  AND agent_type = 'demo';

\echo '=== D5. message 数(压测会话) ==='
SELECT count(*) AS will_delete_message
FROM ia_agent_message
WHERE conversation_id IN (
    SELECT conversation_id FROM ia_agent_conversation
    WHERE user_id = 12993 AND agent_type = 'demo' AND title = '现在几点了?'
);

\echo '=== D6. event 数(压测 run;最大表,此查询最重,约数秒) ==='
SELECT count(*) AS will_delete_event
FROM ia_agent_event
WHERE run_id IN (
    SELECT run_id FROM ia_agent_run
    WHERE user_id = 12993 AND agent_type = 'demo'
);

\echo '=== D7. model_call_usage 数(压测 run) ==='
SELECT count(*) AS will_delete_usage
FROM ia_agent_model_call_usage
WHERE run_id IN (
    SELECT run_id FROM ia_agent_run
    WHERE user_id = 12993 AND agent_type = 'demo'
);

\echo '=== D8. state 数:按 conversation 派生 vs 按 user 前缀(差值≈6 条 UUID 残留,故意保留) ==='
SELECT
  (SELECT count(*) FROM ia_agent_state
   WHERE session_id IN (
       SELECT '12993:afv:v2:' || conversation_id || ':demo'
       FROM ia_agent_conversation
       WHERE user_id = 12993 AND agent_type = 'demo' AND title = '现在几点了?'
   )) AS will_delete_state_via_conversation,
  (SELECT count(*) FROM ia_agent_state
   WHERE session_id >= '12993:' AND session_id < '12993:~') AS state_12993_prefix_total;

\echo '=== D9. 保留侧体检:user 10086(演示/回归)与压测窗口内其他用户 ==='
SELECT
  (SELECT count(*) FROM ia_agent_conversation WHERE user_id = 10086)          AS conv_10086_keep,
  (SELECT count(*) FROM ia_agent_run WHERE user_id <> 12993)                  AS runs_others_keep,
  (SELECT count(*) FROM ia_agent_conversation
    WHERE user_id <> 12993 AND create_time >= '2026-09-28 11:00')             AS conv_others_in_window;

\echo '=== D10. 保留侧事件抽样:user 10086 最新 5 条会话(应可见,勿删) ==='
SELECT conversation_id, agent_type, title, message_count,
       to_char(create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time
FROM ia_agent_conversation
WHERE user_id = 10086
ORDER BY create_time DESC
LIMIT 5;

\echo '=== DRY RUN 结束:未执行任何 DELETE/UPDATE ==='
