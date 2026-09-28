-- =============================================================================
-- mock-model-script.sql — CI canned mock 模型播种(2026-09-28,计划.md §10)
--
-- 作用:把 V4__demo_seed.sql 预置的 mock-text(id=1,platform=mock)配置成
-- 「规则式脚本模型」并设为默认对话模型,demo 全量回归(24 用例)即可在无
-- 真实模型的环境(CI/夜间)全绿。
--
-- 规则与 e2e/demo-regression.driver.mjs 的六条话术一一对应,本文件是
-- mockScript 的单一事实源(MockAiProvider 规则式形态见
-- MockAiProvider#parsePlan;捕获组 $1..$9 注入工具入参与回复文案)。
-- 注意:规则对象必须挂在 config 的 "mockScript" 键下
-- (AiProviderContext.getConfig().get("mockScript");裸 rules 对象不生效)。
--
-- 用法(容器内 psql,幂等):
--   docker exec -i inneragent-postgres psql -U inneragent -d inneragent \
--     < examples/acme-demo/seeds/mock-model-script.sql
-- 恢复真实模型默认位:
--   docker exec -i inneragent-postgres psql -U inneragent -d inneragent \
--     < examples/acme-demo/seeds/mock-model-restore.sql
--
-- 注意:mock 模型的回复是脚本固定文案,不是真实模型推理结果;仅限 CI/演示,
-- 生产环境严禁把 mock-text 设为默认(恢复脚本见上)。
-- =============================================================================
UPDATE ia_ai_model
SET config = $json${
  "mockScript": {
    "deltaMs": 60,
    "rules": [
      {
        "match": "帮我建一张工单:标题=(.+?),描述=(.+?),优先级=(\\w+)",
        "tool": "create_ticket",
        "args": {"title": "$1", "description": "$2", "priority": "$3"},
        "reply": "工单「$1」已创建成功:描述=$2,优先级=$3。已同步到工具台账(Agent 渠道),可在工具页查看。"
      },
      {
        "match": "信息无误|提交建单",
        "tool": "create_ticket",
        "args": {"title": "确认流工单", "description": "用户确认后提交", "priority": "normal"},
        "reply": "工单已创建成功(确认流),已同步到工具台账(Agent 渠道)。"
      },
      {
        "match": "年假|假期|请假",
        "reply": "按《员工手册》:入职满 1 年享 5 天年假,满 10 年享 10 天,需提前 3 个工作日在 OA 申请。[KB:demo-kb-annual-leave]"
      },
      {
        "match": "报告|总结|销售|回款",
        "reply": "Q3 销售总结(报告规范 report-style):华东区回款完成率 92%,环比 +5pp;应收账期缩短至 45 天。建议四季度聚焦头部客户续约与账期管控,并复制华东打法至华南区。"
      }
    ],
    "default": "我是 ACME 演示助手(mock 脚本模型)。可以让我帮你建工单、查公司知识库(例如「年假有几天」)、写季度报告小结,或汇总工单情况并给出一句运营建议。"
  }
}$json$,
    status = 1,
    default_model = TRUE,
    sort = 0
WHERE code = 'mock-text';

-- 其余文本模型退出默认位(恢复真实模型执行 mock-model-restore.sql)
UPDATE ia_ai_model
SET default_model = FALSE
WHERE model_type = 1 AND code <> 'mock-text' AND default_model = TRUE;
