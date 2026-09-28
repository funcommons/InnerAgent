-- =============================================================================
-- k6 压测脏数据清理(制备于 2026-09-28,仅制备未执行;执行前请通读本头注)
-- =============================================================================
--
-- 【目标】
--   删除 2026-09-28 多轮 k6 压测灌入演示库的数据,保留 demo 回归(24 用例)与
--   人工演示数据。删除范围 = 演示用户头 user_id=12993 名下的全部 agent 数据。
--
-- 【时间口径 / 窗口】
--   * 库内相关表全部为 timestamp WITHOUT TIME ZONE,应用按【本地墙钟
--     Asia/Shanghai, UTC+8】写入(验证:库 TimeZone=UTC,db now()=07:42Z 时,
--     最新 create_time=15:42,即本地时间;故下述窗口均为存储值=本地墙钟)。
--   * 今日压测落库窗口(存储值):2026-09-28 11:00 起,制备时仍在低速写入。
--     分时分布(15:43 快照,user 12993):11 点 27,023 / 12 点 181,498 /
--     13 点 8,016 / 14 点 4 / 15 点 72,473;另有 09-21 17:39 的 2 条(早期 smoke)。
--
-- 【特征依据 —— 为什么删 user_id=12993 是安全的】
--   1. k6 压测固定走 X-IA-Demo-User: 12993(tools/k6/lib/auth.js 默认)、
--      agentType=demo、消息固定「现在几点了?」(tools/k6/lib/config.js),
--      每轮新建 conversation。
--   2. 全库 title='现在几点了?' 且 user_id<>12993 的 conversation = 0 条;
--      反之 user 12993 名下(2026-09-21 至今)conversation 的 title 无一例外
--      =「现在几点了?」(non_clock_title=0,含最早 2 条 smoke)→
--      该用户 100% 为压测/smoke 产物,不含任何人工演示数据。
--   3. demo 回归与人工演示数据全部落在 user_id=10086(及 09-23 一次性用户
--      10087~10100),agentType 为具体业务型(ticket-assistant / knowledge-qa /
--      ops-analyst / report-writer / master-demo / ai_media)。压测窗口内
--      user 10086 仅 21 条 conversation、236 条 run,完全不在删除范围。
--   4. 消息内容佐证(12993 会话抽样):user='现在几点了?',
--      assistant=内置 get_current_time 工具话术,tool 行为时间 JSON。
--   5. ia_agent_state.session_id 首段即 user_id,格式
--      <uid>:afv:v2:<conversation_id>:<agent_type>;压测 conversation_id 为
--      32 位 hex(demo 回归为带连字符 UUID,形态不同)。user 12993 名下另有
--      ~6 条 UUID 形态 state(09-22 ai_media/演示残留,其 conversation 已不存在)
--      ——本脚本【故意不删】(保守)。
--
-- 【计数快照(2026-09-28 15:58~16:00 本地 dry-run 实测;当时压测仍在写入,数字持续增长,
--   执行前务必重跑下方 [1] 核对查询或 dry-run,数量级一致即可)】
--   ia_agent_conversation(user 12993)      309,886(安全反证 abnormal=0)
--   ia_agent_run      (user 12993)          309,891
--   ia_agent_message  (12993 的会话)        707,321
--   ia_agent_event    (12993 的 run)      3,445,892
--   ia_agent_model_call_usage(12993 的 run) 357,523
--   ia_agent_state    (按 conversation 派生) 311,793(按 12993 前缀 311,799,差 6 条 UUID 残留)
--   保留侧参照:user 10086 conversation 125 / run 248(压测窗口内其他用户会话=21);
--   user<>12993 的 run 共 248、event 3,569、usage 237。
--   早期快照(供趋势参照):conversation 289,019 @15:43 → 303,762 @15:56;
--   event(12993)3,314,515 @15:52(当时全表 3,318,084,占 99.89%)。
--   预期释放空间:数 GB 量级(event ~3GB + run ~1.1GB + message ~0.5GB + state ~0.5GB)。
--
-- 【外键 / 级联结论】
--   * 数据库层无任何 FOREIGN KEY 约束(information_schema 验证,delete_rule 无记录),
--     关联全在应用层:conversation.conversation_id ← run.conversation_id;
--     run.run_id ← event.run_id / usage.run_id;
--     conversation.conversation_id ← message.conversation_id(及 message.run_id)。
--   * run.agent_state_session_id(afv:v2:<cid>:demo)与 state.session_id
--     (<uid>:afv:v2:<cid>:demo)格式不一致,不能直接 join,须按 user 前缀/
--     conversation 派生匹配。
--   * 因此没有级联,必须按"子表先行"显式排序;顺序错不会报错但会留孤儿行,
--     务必按本脚本顺序:state → message → usage → event → run → conversation。
--
-- 【执行方式】
--   强烈建议:先停 k6 与一切会产生 12993 流量的进程(smoke 脚本同样走 12993),
--   库空闲时执行(大表 DELETE + 索引维护预计数分钟)。脚本幂等,停流后可重跑补删。
--     docker exec -i inneragent-postgres psql -U inneragent -d inneragent \
--       -v ON_ERROR_STOP=1 < tools/k6/cleanup-loadtest-data.sql
--   只看数字不删:改用 tools/k6/cleanup_dry_run.sql(同谓词,只 SELECT)。
--
-- ⚠️ 执行前自查(缺一不可):
--   1) 重跑下方 [1] 全部计数,与上方快照对照(量级一致;因写入增长略大属正常);
--   2) 确认 user_id=12993 下没有你手工产生的数据:运行 dry-run 里的 title 抽查,
--      应全部 =「现在几点了?」;若出现其他标题,停!重新评估;
--   3) 之后如需人工走匿名演示头(12993),演示数据会被下次清理误伤,请换用
--      其他演示用户或在清理脚本中追加排除条件。
--
-- 【可选保守变体:时间窗 + user 双条件】
--   证据显示 user 12993 全量皆测试数据,默认【不设时间窗】一次清干净(留 09-21
--   两条 smoke 也一并删)。若要额外保守,可在每个 DELETE 的 WHERE 追加:
--     AND create_time >= '2026-09-28 11:00'   -- ia_agent_state 用 updated_at/created_at
--   (下限取 11:00 覆盖今日全部压测;上界不必设,停流后无新增;不设上界可顺带
--   清掉 09-21 smoke 残留。)
--
-- 【清理后】
--   DELETE 不归还磁盘空间。事务提交后另行执行(不能在 BEGIN 块内):
--     docker exec inneragent-postgres psql -U inneragent -d inneragent \
--       -c "VACUUM ANALYZE ia_agent_conversation, ia_agent_run, ia_agent_event, ia_agent_message, ia_agent_state, ia_agent_model_call_usage;"
--   如需真正缩表(锁表,择机):VACUUM FULL 或 pg_repack。
-- =============================================================================

BEGIN;

\echo '=== [1/3] 清理前核对计数(与头注快照对照,应同量级) ==='

-- [1.1] conversation:压测集合(也是下面所有删除的锚集合)
SELECT count(*) AS conv_12993
FROM ia_agent_conversation
WHERE user_id = 12993
  AND agent_type = 'demo'
  AND title = '现在几点了?';

-- [1.2] 安全反证:12993 下的"非压测形态"会话,必须为 0,否则停!
SELECT count(*) AS conv_12993_abnormal
FROM ia_agent_conversation
WHERE user_id = 12993
  AND (agent_type IS DISTINCT FROM 'demo' OR title IS DISTINCT FROM '现在几点了?');

-- [1.3] 保留侧:压测窗口内非 12993 的会话(应≈21,即 demo 回归)
SELECT count(*) AS conv_others_in_window
FROM ia_agent_conversation
WHERE user_id <> 12993
  AND create_time >= '2026-09-28 11:00';

-- [1.4] run
SELECT count(*) AS run_12993
FROM ia_agent_run
WHERE user_id = 12993
  AND agent_type = 'demo';

-- [1.5] message(挂在 12993 会话上)
SELECT count(*) AS msg_12993
FROM ia_agent_message
WHERE conversation_id IN (
    SELECT conversation_id FROM ia_agent_conversation
    WHERE user_id = 12993 AND agent_type = 'demo' AND title = '现在几点了?'
);

-- [1.6] event(挂在 12993 的 run 上)
SELECT count(*) AS event_12993
FROM ia_agent_event
WHERE run_id IN (
    SELECT run_id FROM ia_agent_run
    WHERE user_id = 12993 AND agent_type = 'demo'
);

-- [1.7] model_call_usage(挂在 12993 的 run 上)
SELECT count(*) AS usage_12993
FROM ia_agent_model_call_usage
WHERE run_id IN (
    SELECT run_id FROM ia_agent_run
    WHERE user_id = 12993 AND agent_type = 'demo'
);

-- [1.8] state(按 conversation 派生 session_id;对比 user 前缀总数,差值≈UUID 残留,故意保留)
SELECT
  (SELECT count(*) FROM ia_agent_state
   WHERE session_id IN (
       SELECT '12993:afv:v2:' || conversation_id || ':demo'
       FROM ia_agent_conversation
       WHERE user_id = 12993 AND agent_type = 'demo' AND title = '现在几点了?'
   )) AS state_via_conversation,
  (SELECT count(*) FROM ia_agent_state
   WHERE session_id >= '12993:' AND session_id < '12993:~') AS state_via_prefix;

\echo '=== [2/3] DELETE(子表先行;逐表回显删除行数) ==='

-- [2.1] state(最细粒度子表;按 conversation 派生 session_id,避开 UUID 残留)
WITH del AS (
  DELETE FROM ia_agent_state s
  WHERE session_id IN (
      SELECT '12993:afv:v2:' || conversation_id || ':demo'
      FROM ia_agent_conversation
      WHERE user_id = 12993 AND agent_type = 'demo' AND title = '现在几点了?'
  )
  RETURNING 1
)
SELECT count(*) AS deleted_state FROM del;

-- [2.2] message
WITH del AS (
  DELETE FROM ia_agent_message m
  WHERE conversation_id IN (
      SELECT conversation_id FROM ia_agent_conversation
      WHERE user_id = 12993 AND agent_type = 'demo' AND title = '现在几点了?'
  )
  RETURNING 1
)
SELECT count(*) AS deleted_message FROM del;

-- [2.3] model_call_usage
WITH del AS (
  DELETE FROM ia_agent_model_call_usage u
  WHERE run_id IN (
      SELECT run_id FROM ia_agent_run
      WHERE user_id = 12993 AND agent_type = 'demo'
  )
  RETURNING 1
)
SELECT count(*) AS deleted_usage FROM del;

-- [2.4] event(最大表,~331 万行,耐心等)
WITH del AS (
  DELETE FROM ia_agent_event e
  WHERE run_id IN (
      SELECT run_id FROM ia_agent_run
      WHERE user_id = 12993 AND agent_type = 'demo'
  )
  RETURNING 1
)
SELECT count(*) AS deleted_event FROM del;

-- [2.5] run
WITH del AS (
  DELETE FROM ia_agent_run r
  WHERE user_id = 12993
    AND agent_type = 'demo'
  RETURNING 1
)
SELECT count(*) AS deleted_run FROM del;

-- [2.6] conversation(锚表,最后删)
WITH del AS (
  DELETE FROM ia_agent_conversation c
  WHERE user_id = 12993
    AND agent_type = 'demo'
    AND title = '现在几点了?'
  RETURNING 1
)
SELECT count(*) AS deleted_conversation FROM del;

\echo '=== [3/3] 清理后核对(应全为 0;若执行期仍有写入,残留应为极小个位数,重跑本脚本即可) ==='

SELECT
  (SELECT count(*) FROM ia_agent_conversation WHERE user_id = 12993)             AS conv_12993_left,
  (SELECT count(*) FROM ia_agent_run WHERE user_id = 12993)                      AS run_12993_left,
  (SELECT count(*) FROM ia_agent_state
    WHERE session_id >= '12993:' AND session_id < '12993:~')                     AS state_12993_left;

-- 残余校验以 [2.x] 各 deleted_* 计数为准(会话删除后按会话反查 message 恒为 0,不作依据)。
-- 如需校验孤儿消息(应≈0,数量级=执行期新增):执行期仍写入时可能有个位数残留,重跑本脚本补删。

-- 保留侧自检:demo 数据完好(应与清理前一致:conversation ~250 / run 248 / event 3,569)
SELECT
  (SELECT count(*) FROM ia_agent_conversation WHERE user_id = 10086) AS conv_10086_kept,
  (SELECT count(*) FROM ia_agent_run WHERE user_id <> 12993)         AS runs_others_kept;

COMMIT;

-- 提交后(事务外)再执行 VACUUM,见头注【清理后】。
