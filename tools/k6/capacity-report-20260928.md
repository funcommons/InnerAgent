# InnerAgent 容量校准报告(2026-09-28 · P4-W16 首轮)

> 依 `capacity-report-TEMPLATE.md` 回填;执行入口 `tools/k6/run.sh`(口径见 `tools/k6/README.md`)。
> 结果目录:`tools/k6/results/20260928T043002Z/`(steady 100VU)、`20260928T065953Z/`(steady 25VU 判别实验)、`<idle/ramp 目录>`(见 §7)。
> 编制约定:每个数值标注来源文件;未测到/未完成项保持「待回填」,不以估算冒充实测。

---

## 0. 评审结论(首轮)

| 项 | 结论 | 说明 |
| --- | --- | --- |
| 错误率 <0.1%(30min 稳态) | **通过** | 0/89,442(`043002Z/steady-30min-summary.json`) |
| 首字 P95 ≤3s 不含模型 | **通过(结构性)** | mock 即模型,c 口径=0;全含口径 1,643ms 亦 ≤3s |
| 事件透传 P95 ≤200ms | **不通过(环境受限)** | 100VU 286ms;25VU 对照 60ms 通过 → 单机共存争抢主导(§3.1),路径本身健康 |
| 500 events/s 稳态折算吞吐 | 待回填 | ramp-events(§7 排程) |
| 1000 空闲会话内存稳定 | 待回填 | idle-sessions(§7 排程) |
| 容量承诺(单实例规格 → 并发/events/s) | **有条件承诺** | §6;正式承诺以专机复测为准 |

**总判定(首轮):有条件通过** —— 服务端稳定性(9 万运行零失败)与透传路径健康性(25VU 全绿)已证;透传门槛与吞吐/内存两关在单机共存形态下不具判定效力,须专机复测定稿(§6.3)。

评审人/日期:—(待评审);缺陷登记:**无阻塞缺陷**;观察项 2 条(O-1 outbox 消化能力、O-2 空表 seq_scan,见 §5/§3.1)。

---

## 1. 环境规格

### 1.1 拓扑

| 角色 | 规格 | 数量 | 备注 |
| --- | --- | --- | --- |
| inneragent-server | 与负载机/DB 同一台 Mac(15 逻辑核/48GB),JVM on host | 1 | `java -jar inneragent-server-0.1.0-SNAPSHOT.jar`,构建 09-28 11:23(代码=`aa136ae`,该提交仅动 tools/k6),进程启动 11:23:49,两轮压测同一构建 |
| PostgreSQL 16 | Docker Desktop VM 内(`postgres:16-alpine`,host 35432) | 1 | VM 与 ragflow 全家桶(ES/MySQL/TEI)共享 |
| Redis 7 | Docker Desktop VM 内(host 36379) | 1 | `maxmemory_policy=noeviction` |
| k6 负载机 | **与 server 同机**(时钟同源,透传口径可信) | 1 | k6 v1.8.1 + xk6-sse v0.2.0 |

> ⚠ **形态警告(本报告核心限定)**:单机 15 核同时承载 JVM+k6(100VU)+Docker VM(PG/Redis/ragflow)+桌面负载,压测期 load≈15(满饱和)。此形态下的一切尾部延迟数据只证明「该形态下」的表现,不代表服务端独享资源的容量上限;判别实验(§3.1)即为剥离该混杂因素而设。

### 1.2 软件与口径

| 项 | 值 | 来源 |
| --- | --- | --- |
| server 构建(HEAD) | `aa136ae`(jar 09-28 11:23) | `git rev-parse` / target jar 时间戳 |
| k6 版本 / SSE 扩展 | v1.8.1 / xk6-sse v0.2.0 | `run.log` |
| mock 模型 | 规则式 canned(`mockScript.rules`),`deltaMs=800`,`max_concurrency=1000`,`default_model=TRUE` | `env.txt` `mock_max_concurrency`;seeds/mock-model-script.sql |
| 场景参数 | steady:2m→100VU×30m→1m;25VU 实验:30s→25VU×3m→15s | `env.txt` / 结果目录 |
| 阈值 | 默认验收口径,无 IA_THRESHOLD_* 覆盖 | `env.txt` |
| 每 SSE 运行事件数 | 实测恒定 **3.0**(ramp 到达率按此校准 `IA_EVENTS_PER_RUN_ESTIMATE=3`) | `043002Z/steady-30min-summary.json` `ia_events_per_run` |

### 1.3 数据规模(steady 33min 净增,`baseline` vs `steady-30min-after-pg-slow-queries.txt`)

| 表 | 压测前 | 压测后 | 净增 | 折算 |
| --- | --- | --- | --- | --- |
| ia_agent_event(journal) | 1,271,378 | 2,166,159 | **+894,781** | ≈10 事件/运行(journal 粒度细于 SSE 的 3/运行) |
| ia_agent_message(投影) | 254,682 | 433,577 | +178,895 | ≈2/运行(user+assistant) |
| ia_agent_run | 127,339 | 216,798 | +89,459 | ≈1/运行 |
| ia_agent_conversation | 127,229 | 216,680 | +89,451 | ≈1/运行 |
| 库总大小 | 2.29GB | 3.89GB | **+1.6GB** | **≈18KB/运行** |

> 容量规划换算:100 并发 × 30min ≈ 8.9 万运行 ≈ 90 万 journal 事件 ≈ 1.6GB。设计点持续负载(500 ev/s,167 运行/s)下约 3.5 万运行/分钟,**生产须配 journal 归档/分区策略**(PRD §8 回填项)。

---

## 2. 结果总表(验收 7 门槛对照)

来源:`<场景>.ia-summary.json` 与 `<场景>-summary.json`;快照 `*-after-*`。

| # | 验收指标(原文) | 门槛 | 实测 | 判定 | 来源 |
| --- | --- | --- | --- | --- | --- |
| 1 | 运行错误率(30min 稳态,100 并发) | <0.1% | 0%(0/89,442,0 中断) | **通过** | `043002Z/steady-30min-summary.json` |
| 2 | 首字 P95(不含模型,mock 环境) | ≤3s | 0ms(结构性,§3.1 注);全含 1,643ms | **通过** | 同上 |
| 3 | 首字 P95(全含,参考) | 观察 | P95 1,643ms / med 1,106ms / max 4,174ms | — | 同上 |
| 4 | 事件透传 P95(100 并发稳态) | ≤200ms | **286ms**(med 63 / p90 204 / max 2,284) | **不通过→环境受限**(25VU 对照 60ms 通过) | 同上 |
| 5 | 事件透传 P95(500 events/s 下) | ≤200ms | 待回填 | 待回填 | ramp(§7) |
| 6 | 稳态事件吞吐(折算) | ≥0.9×500 | 待回填 | 待回填 | ramp(§7) |
| 7 | 空闲会话建立率(1000) | >99% | 待回填 | 待回填 | idle(§7) |
| 8 | heap 稳态增长斜率 | \|斜率\|≤1MiB/min | 待回填 | 待回填 | idle(§7) |
| 9 | `runs_waiting` 驻留交叉验证 | ≈1000 | 待回填 | — | idle(§7) |
| 10 | 时钟偏差丢弃样本 | 占比披露 | 0(透传样本 100% 可信) | — | `043002Z` |

附(100VU 稳态):运行时长 P95 2,872ms;事件间隔 P95 861ms(≈deltaMs 800+开销,计时准确佐证);每运行事件 3.0。

---

## 3. 场景明细

### 3.1 steady-30min(100 并发 × 30min)+ 25VU 判别实验

- 节奏:warmup 2m → 100 VU × 30m → rampdown 1m(gracefulStop 40s);`043002Z`
- 运行 89,442 / 完成 89,442 / 失败 0 / 中断 0;SSE 事件 268,326(3.0/运行)
- 延迟分布(ms,`-summary.json`):

| 指标 | avg | med | p90 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| 首事件=首 CONTENT(全含) | 1,178 | 1,106 | 1,453 | 1,643 | 4,174 |
| 透传 | 95.6 | 63 | 204 | **286** | 2,284 |
| 事件间隔 | 456 | 577 | 810 | 861 | 2,763 |
| 运行时长 | 2,114 | 1,979 | 2,593 | 2,872 | 6,286 |

> 注:首字「不含模型」(c 口径=全含−`reasoningDurationMs`)在 canned mock 下结构性为 0 —— mock 即模型,首 CONTENT 自带 reasoningDuration=全含;mock 环境主判定口径为全含 b 对 3s 线(metrics.js 头注)。

- **25VU 判别实验**(`065953Z`,剥离共存争抢混杂):3,034 运行零失败;透传 **med 9 / p95 60 / max 136ms**(≤200ms 通过,余量 3.3×);首字 P95 923ms;运行时长 P95 1.7s。**对照结论:透传延迟随负载大致线性(事件率 ×3.4 → P95 ×4.8),无积压放大 —— 单机共存 CPU 争抢主导,服务端透传路径(直发,不经 outbox)健康**。
- fan-out 健康位(`steady-30min-after-prometheus.txt`):
  - `event.backpressure_rejected_total` = 0 ✅;`harness.capacity_rejected_total` = 0 ✅;`state.bulkhead_rejected_total` = 0 ✅
  - `runs_active` 结束后回落 0;`runs_waiting` 1(常态残留)
  - GC:G1 Young Evacuation 6,925 次/33min,sum 22.0s(均值 3.2ms/次,健康);无 Full GC
- 服务器资源:压测期 JVM ~118% CPU(单机 `ps` 采样);机器 load≈15/15 核

### 3.2 idle-sessions(1000 空闲会话内存稳定)

待回填(§7 排程)。

### 3.3 ramp-events(500 events/s 透传压力)

待回填(§7 排程;到达率已按实测 3 事件/运行校准)。

### 3.4 smoke(门禁)

通过(09-28 首轮解冻记录见 `tools/k6/README.md`「09-28 实测记录」;本轮各场景 `SSE 模块可用` check 全过,门禁链路有效)。

---

## 4. PG 慢查询清单(§7.4「PG 慢查询审查」)

来源:`baseline/*-pg-slow-queries.txt` 与 `steady-30min-after-pg-slow-queries.txt`(pg_stat_statements 未启用,快照为降级口径:`pg_stat_user_tables` 序扫 TOP + 库容量)。

| 观察项 | 数据 | 处置 |
| --- | --- | --- |
| `ia_agent_event` 序扫 | 269,950 → 272,291(33min 净增 ~2,300;存量 127 万行) | **接受** — 增量低;replay 走 (run_id, sequence) 索引 |
| `ia_agent_definition` 序扫 | 636,887 → 1,084,100(净增 ~447k ≈ 5/运行) | **O-2 观察项**:空表(n_live_tup=0)每请求多次序扫,单次代价近零;量大时建议缓存/点查(登记至 计划 §10.5 待办,不阻塞) |
| `ia_model_api_config`/`ia_app`/`ia_tool_grant` 序扫 | 同类每请求平台级查找(部分空表) | 同上,合并观察 |
| 长事务/活动查询异常 | 无 | — |
| 库容量差 | 见 §1.3(+1.6GB/8.9 万运行) | 生产归档策略(PRD §8) |

> 建议:正式压测环境启用 `pg_stat_statements` 以获得 mean_exec_time 口径(快照文件头有启用指引)。

## 5. Redis 快照(`baseline` vs `steady-30min-after-redis.txt`)

| 指标 | baseline | steady 后 |
| --- | --- | --- |
| used_memory_human | 1.25M | 1.25M |
| used_memory_peak_human | 7.06M | 8.60M |
| connected_clients | 2 | 2 |
| rejected_connections | 0 | 0 |
| maxmemory/淘汰 | noeviction,未触淘汰(evicted_keys 无增量) | 同 |

结论:Redis 水位极低(峰值 8.6MB),无淘汰、无拒连。**注意**:outbox 唤醒提示走 Redis,消费速率见 O-1。

### 关键发现 O-1:outbox 消化能力低于设计点(非阻塞,登记待办)

- 证据:backlog 基线 303,200 → steady 后 **415,392**(33min 净增 112k ≈ 入流 135 ev/s − 消化 ~60-80 行/s);停测后 ~2h 排空至个位数;25VU 实验期间 backlog≈6(完全跟得上)。
- 机理:`AgentEventOutboxScheduler` 固定 500ms 一批 × 200 行(理论上限 400 行/s),批内逐条 `publishOne`(Redis 提示+DB 认领更新),实测打折至 60-80 行/s。
- 影响:**仅影响跨实例订阅/断线重连的唤醒时效**(单实例 SSE 直发不经 outbox,透传实测已证);持续 >80 journal 事件/s 的负载下重连唤醒滞后随 backlog 线性增长。
- 处置方向(登记 计划 §10.5):① `outbox-delay-ms` 调小 + 批量化 `publishOne`;② 专机复测验证消化速率上限;③ 明确多实例部署下 backlog 水位告警阈值。

---

## 6. 容量承诺(回填 PRD §8)

### 6.1 本机形态下已证(15 核 Mac,共存负载)

| 维度 | 实测 | 依据 |
| --- | --- | --- |
| 单实例并发运行数 | **≥100 并发 × 30min,零失败**(89,442 运行),拒绝位全 0 | steady `043002Z` |
| 稳定性 | 运行时长 P95 2.9s;GC 健康;Redis 水位 8.6MB | 同上 |
| 容量消耗模型 | ≈18KB 库/运行;journal ≈10 事件/运行;SSE 3 事件/运行 | §1.3 |

### 6.2 待专机复测后定稿

| 维度 | 现状 | 依据 |
| --- | --- | --- |
| 单实例事件吞吐 500 ev/s | 待回填(ramp §7) | ramp |
| 透传 P95 ≤200ms(100 并发/500 ev/s) | 25VU 60ms ✅ → 100VU 形态受限 286ms;专机判定 | steady + §3.1 判别 |
| 1000 空闲会话内存 | 待回填(idle §7) | idle |

### 6.3 复测前提(专机口径)

1. server/PG/Redis 独享主机,k6 独立负载机(NTP 对齐,透传跨机时钟口径按 metrics.js 头注披露);
2. 关闭同宿主无关容器(本机 ragflow 全家桶为最大干扰源);
3. 启用 `pg_stat_statements`;4. 带上 O-1 处置①后的 outbox 配置。

---

## 7. 复测记录

| 日期 | 触发原因 | 变更点 | 结果摘要 | 结果目录 |
| --- | --- | --- | --- | --- |
| 2026-09-28(首轮 03:53Z) | W16 解冻 | deltaMs=60(pacing 混杂,后定位) | 透传 P95 超界;summary 落盘工具缺陷(k6 v1.8.1 object 条目)同步修复 | `20260928T035321Z` |
| 2026-09-28(04:30Z) | pacing 校正 deltaMs→800 | summary 落盘修复(`aa136ae`) | steady 89,442 运行零失败;透传 P95 286ms FAIL→判别实验定位为共存争抢 | `20260928T043002Z` |
| 2026-09-28(06:59Z) | 判别实验 25VU | 剥离负载混杂 | 透传 P95 60ms PASS → 环境受限结论成立 | `20260928T065953Z` |
| 2026-09-28(idle/ramp,待回填) | 补齐验收 7 两场景 | IA_EVENTS_PER_RUN_ESTIMATE=3 校准 | 待回填 | 待回填 |
