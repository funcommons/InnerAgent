# InnerAgent 容量校准报告(P4 · W16)

> **状态:模板 —— 全部数值留待真实压测回填**(03-开发计划 §7.1 W16「性能压测与容量校准」、§7.3 验收 7、§7.4)。
> 执行入口:`tools/k6/run.sh`(用法/口径见 `tools/k6/README.md`);本报告回填后按计划 §7.2 作为交付物评审,并回填 PRD §8 容量表。
> 编制约定:每个数值标注来源文件(run.sh 结果目录下);未测到的项保持「待回填」,禁止以估算冒充实测。

---

## 0. 评审结论(回填位)

| 项 | 结论(通过/有条件通过/不通过) | 说明 |
| --- | --- | --- |
| 错误率 <0.1%(30min 稳态) | 待回填 | |
| 首字 P95 ≤3s 不含模型 | 待回填 | |
| 事件透传 P95 ≤200ms | 待回填 | |
| 500 events/s 稳态折算吞吐 | 待回填 | |
| 1000 空闲会话内存稳定 | 待回填 | |
| 容量承诺(单实例规格 → 并发运行数/events/s) | 待回填 | 回填 PRD §8 |

评审人/日期:待回填;缺陷登记(如有):待回填(分级按开发计划 §2.4)。

---

## 1. 环境规格(结果目录 `env.txt` + 部署清单)

### 1.1 拓扑

| 角色 | 规格(CPU/内存/磁盘) | 数量 | 备注(待回填) |
| --- | --- | --- | --- |
| inneragent-server | 待回填 | 待回填 | JVM 版本/参数:`java -version` + 启动参数待回填 |
| PostgreSQL 17 | 待回填 | 待回填 | 容器参数/共享内存配置待回填 |
| Redis 7 | 待回填 | 待回填 | maxmemory 策略:`*-redis.txt` `CONFIG GET maxmemory` |
| k6 负载机 | 待回填 | 待回填 | 与 server 是否同机(时钟口径,README §1) |

### 1.2 软件与口径

| 项 | 值 | 来源 |
| --- | --- | --- |
| server 构建(HEAD) | 待回填 | `git rev-parse HEAD` |
| k6 版本 / SSE 扩展 | 待回填 | run.log 首行 |
| mock 模型并发校准值 | 待回填(默认 1000) | `env.txt` `mock_max_concurrency` |
| 场景参数(节奏/VU 池) | 待回填 | `env.txt` |
| 阈值(是否有覆盖) | 待回填 | `env.txt` `IA_THRESHOLD_*` |

### 1.3 数据规模(压测净增,`baseline/after-pg-slow-queries.txt` 库容量段)

| 表 | 压测前行数 | 压测后行数 |
| --- | --- | --- |
| ia_conversation | 待回填 | 待回填 |
| ia_agent_run | 待回填 | 待回填 |
| ia_agent_event(事件 journal) | 待回填 | 待回填 |
| ia_agent_message(投影) | 待回填 | 待回填 |
| 库总大小 | 待回填 | 待回填 |

---

## 2. 结果总表(验收 7 门槛对照)

数据来源:`<场景>.ia-summary.json` 与 `<场景>-summary.json`;快照见 `*-after-*`。

| # | 验收指标(原文) | 门槛 | 实测 | 判定 | 来源文件 |
| --- | --- | --- | --- | --- | --- |
| 1 | 运行错误率(30min 稳态,100 并发) | <0.1% | 待回填(steady `failedRate`) | 待回填 | steady-30min.ia-summary.json |
| 2 | 首字 P95(不含模型口径,mock 模型环境) | ≤3s | 待回填(`firstContentNoModelP95Ms`) | 待回填 | steady-30min.ia-summary.json |
| 3 | 首字 P95(全含口径,参考) | 观察 | 待回填(`firstContentP95Ms`) | — | 同上 |
| 4 | 事件透传 P95(100 并发稳态) | ≤200ms | 待回填(`passthroughP95Ms`) | 待回填 | 同上 |
| 5 | 事件透传 P95(500 events/s 压力下) | ≤200ms | 待回填 | 待回填 | ramp-events.ia-summary.json |
| 6 | 稳态事件吞吐(折算) | ≥0.9×500 events/s | 待回填(`holdEquivalent`) | 待回填 | ramp-events.ia-summary.json |
| 7 | 空闲会话建立率(1000) | >99% | 待回填 | 待回填 | idle-sessions.ia-summary.json |
| 8 | heap 稳态增长斜率 | \|斜率\|≤1 MiB/min(经验线) | 待回填(`heapGrowthBytesPerMin`) | 待回填 | idle-sessions.ia-summary.json |
| 9 | `runs_waiting` 驻留交叉验证 | ≈1000 | 待回填(`runsWaitingAvg`) | — | 同上 |
| 10 | 时钟偏差丢弃样本(透传可信度) | 占比报告 | 待回填(`ia_clock_skew_samples` count) | — | steady/ramp-summary.json |

附:负载下运行时长 P95 / 事件间间隔 P95 / 每运行事件数(吞吐模型校准)——待回填。

---

## 3. 场景明细(逐场景小节,模板按场景复制)

### 3.1 steady-30min(100 并发运行持续 30 分钟)

- 节奏:warmup 待回填 → 100 VU × 待回填 → rampdown 待回填(`env.txt`)
- 运行数/完成/失败:待回填;事件总数:待回填
- 延迟分布(首事件/首 CONTENT/首 CONTENT 不含模型/透传/事件间隔,avg-p50-p95-p99):待回填(`<场景>-summary.json` values)
- 服务器资源曲线截图/快照位:server CPU/内存(部署侧监控)、`steady-after-prometheus.txt` 关键行(`fusion_agentscope_runtime_*`):
  - `runs_active` / `runs_waiting` 峰值:待回填
  - `event.persist.latency` P95 / `event.persisted` 总量:待回填
  - `outbox.backlog` 峰值 / `outbox.retry` 增量:待回填
  - `event.backpressure_rejected` 增量(应 = 0):待回填
  - `harness.capacity_rejected` / `state.bulkhead_rejected`(应 = 0):待回填

### 3.2 idle-sessions(1000 空闲会话内存稳定)

- 模式:SSE 半开(ALWAYS_ASK → WAITING_CONFIRMATION)/ hold 时长:待回填
- 采样 JSONL 全文位:`idle-sessions-run.log`(`[ia-k6][idle]` 行)
- heap used 曲线(基线/爬坡末/稳态 min-max):待回填
- non-heap、`runs_waiting` 曲线:待回填
- 结论:内存稳定判定 + GC 佐证(jvm_gc_pause 秒级统计,`idle-after-prometheus.txt`):待回填

### 3.3 ramp-events(500 events/s 透传压力)

- 到达节奏与 VU 池:待回填;实测事件/运行数:待回填(校准 `IA_EVENTS_PER_RUN_ESTIMATE`)
- 全期均值 / 稳态折算吞吐 / 判定:待回填
- 压力下错误率、透传 P95、首字 P95:待回填
- fan-out 健康位(`ramp-after-prometheus.txt`):`outbox.backlog` 峰值、`event.backpressure_rejected`、`replay.*` 增量:待回填

### 3.4 smoke(门禁)

- 结论:待回填;runId/事件数:待回填

---

## 4. PG 慢查询清单位(开发计划 §7.4「PG 慢查询审查」)

来源:`baseline/*-pg-slow-queries.txt` 与各 `*-after-pg-slow-queries.txt`。

| 场景 | TOP 慢查询(mean_exec_time) | 调用次数 | 均值 ms | 处置(加索引/重写/接受) |
| --- | --- | --- | --- | --- |
| steady 后 | 待回填 | 待回填 | 待回填 | 待回填 |
| ramp 后 | 待回填 | 待回填 | 待回填 | 待回填 |
| idle 后 | 待回填 | 待回填 | 待回填 | 待回填 |

- pg_stat_statements 启用状态:待回填(未启用时降级快照的说明与启用指引见快照文件头)
- 长事务/活动查询异常:待回填;`ia_%` 表序扫 TOP 与索引建议:待回填
- 压测前后库容量差(净增行数/字节):见 §1.3

## 5. Redis 快照位(开发计划 §7.4「Redis 内存与连接数监控」)

来源:`baseline/*-redis.txt` 与各 `*-after-redis.txt`。

| 指标 | baseline | steady 后 | idle 后 | ramp 后 |
| --- | --- | --- | --- | --- |
| used_memory_human | 待回填 | 待回填 | 待回填 | 待回填 |
| used_memory_peak_human | 待回填 | 待回填 | 待回填 | 待回填 |
| connected_clients(峰值见 stats total_connections_received) | 待回填 | 待回填 | 待回填 | 待回填 |
| rejected_connections | 待回填(应 0) | 待回填 | 待回填 | 待回填 |
| maxmemory / 淘汰策略 / evicted_keys | 待回填 | 待回填 | 待回填 | 待回填 |

结论位(内存水位、连接数峰值、是否触及淘汰):待回填。

## 6. 容量承诺(回填 PRD §8)

| 维度 | 实测容量(规格见 §1.1) | 依据 |
| --- | --- | --- |
| 单实例并发运行数 | 待回填(100 并发稳态下余量:待回填) | steady |
| 单实例事件吞吐 | 待回填 events/s | ramp |
| 单实例会话驻留 | 待回填(1000 空闲会话内存余量) | idle |
| 达到门槛的最低规格 | 待回填 | 全场景 |
| 降档承诺(如不达标:容量承诺降档并同步 PRD,开发计划 §9 风险表) | 待回填 | 评审 |

## 7. 复测记录位

| 日期 | 触发原因(调优/缺陷修复) | 变更点 | 结果摘要 | 结果目录 |
| --- | --- | --- | --- | --- |
| 待回填 | | | | |
