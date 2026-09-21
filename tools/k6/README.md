# tools/k6 — SSE 性能压测(03-开发计划 §7.1 W16 / §7.4)

InnerAgent 性能压测脚本与容量报告骨架。对应验收(**开发计划 §7.3 验收 7**,原文):

> 性能(30 分钟持续):100 并发运行 + 500 events/s,错误率 <0.1%;首字 P95 ≤3s(不含模型)、事件透传 P95 ≤200ms;1000 空闲会话内存稳定。容量表回填 PRD §8。

数字留空、结论留白的容量报告模板见 **`capacity-report-TEMPLATE.md`**(大厂容量评审文档样式,W16 真实压测后回填,再回填 PRD §8)。

---

## 1. 依赖(重要:k6 官方二进制不含 SSE 模块)

截至 2026-09-21(k6 v2.2.0 核实):**k6 官方二进制(v0.49–v2.2.0)没有任何内置 SSE JS 模块**,`k6/experimental/sse`/`k6/sse` 在官方模块树中不存在(grafana/k6#746:原生 SSE 排期在 v2 开发周期)。本目录脚本使用社区事实标准扩展 **phymbert/xk6-sse**(模块名 `k6/x/sse`),二选一:

| 方式 | 做法 | 适用 |
| --- | --- | --- |
| 自动装配(推荐) | 安装 Go 工具链后直接 `k6 run`,k6 会现场解析并编译扩展(automatic extension resolution) | k6 ≥ 支持扩展自动装配的版本,且有网 |
| 自定义构建 | `xk6 build --with github.com/phymbert/xk6-sse@latest`,用产物替换 `k6` 命令 | 无 Go / 离线 / CI 固定二进制 |

其余依赖:docker(compose 起 PG17+Redis7)、curl、bash;无 server jar 时需 mvn(run.sh 会自动 `mvn -DskipTests package`,1–3 分钟)。

> 实测记录(2026-09-21,本机):Homebrew k6 v2.2.0 构建未启用动态模块装载(`dynamic modules not enabled in the host program`)且未装 Go → 运行期装载 `k6/x/sse` 失败,错误被 `lib/sse-client.js` 捕获并以必然失败的 check 呈现(压测以非零退出码阻断,不会假通过);`k6 inspect` 语法/选项校验不受影响。SSE 场景实跑需按上表准备扩展(此构建形态只能走 xk6 自定义构建)。

其他要求:

- **k6 与 server 同机或 NTP 对齐**。透传延迟口径依赖两端时钟(`lib/metrics.js` 头注「口径 2」);run.sh 默认本机部署,偏差可忽略。
- **负载机规模**:1000 VU(hold 场景)约需 1–2 GB 内存给 k6;400 VU(ramp 默认 VU 池)同理。跨机压测把 `IA_BASE_URL` 指向服务端即可,但须记录时钟口径。

## 2. 快速开始

```bash
# 0) 门禁:单并发冒烟(起库、构建/起 server、跑 smoke、收快照、清理)
tools/k6/run.sh

# 1) 验收 7 主场景:100 并发运行持续 30 分钟
SCENARIOS="smoke,steady" tools/k6/run.sh

# 2) 验收 7 全量:主场景 + 1000 空闲会话 + 500 events/s
SCENARIOS="smoke,steady,idle,ramp" tools/k6/run.sh

# 排查用:跑完不回收环境
SCENARIOS="smoke" KEEP=1 tools/k6/run.sh
```

产物(每次运行一个目录):`tools/k6/results/<UTC 时间戳>/`

| 文件 | 内容 |
| --- | --- |
| `env.txt` | 本次压测全部口径(场景参数/阈值/端口/校准值) |
| `baseline-*.{txt}` | 场景前 Prometheus / Redis / PG 快照 |
| `<场景>-summary.json` | k6 `--summary-export` 全量指标(thresholds+values) |
| `<场景>-run.log` | k6 控制台输出(含 `[ia-k6][idle]` 采样 JSONL 行) |
| `<场景>.ia-summary.json` | 脚本整理的判定摘要(回填容量报告用) |
| `<场景>-after-*.{txt}` | 场景后三类快照(Prometheus / Redis / PG 慢查询) |

单独调试场景(需自备环境与扩展):

```bash
IA_BASE_URL=http://localhost:18090 k6 run tools/k6/scenarios/smoke.js
IA_BASE_URL=http://localhost:18090 IA_IDLE_SESSIONS=100 IA_IDLE_HOLD=2m \
  k6 run tools/k6/scenarios/idle-sessions.js
# 只做语法/选项校验(无需 SSE 扩展):
k6 inspect tools/k6/scenarios/steady-30min.js
```

## 3. 场景 × 验收 7 映射

| 脚本 | 负载模型 | 验收条款 | 门槛(默认,参数化可覆盖) |
| --- | --- | --- | --- |
| `scenarios/smoke.js` | 1 VU × 1 轮对话 | 压测门禁(SSE 连通/CONTENT/DONE/`runId:seq` 事件 id) | checks 全过,退出码非 0 即阻断 |
| `scenarios/steady-30min.js` | ramping-vus:2m 爬到 100 VU × 30m,每迭代一轮完整运行(=100 并发运行) | 100 并发运行持续 30 分钟;错误率 <0.1%;首字 P95 ≤3s(不含模型);透传 P95 ≤200ms | `ia_run_failed_rate rate<0.001`(1m 后熔断);`ia_sse_first_content_no_model_ms p(95)<3000`;`ia_sse_event_passthrough_ms p(95)<200` |
| `scenarios/idle-sessions.js` | ramping-vus 到 1000,每 VU 建一例 **WAITING_CONFIRMATION 空闲会话并保持 SSE 半开**;sampler 每 15s 抓 `/actuator/prometheus` | 1000 空闲会话内存稳定 | `ia_idle_hold_established_rate>0.99`;heap 稳态斜率 \|斜率\|≤1 MiB/min(summary 判定,容量报告裁量) |
| `scenarios/ramp-events.js` | ramping-arrival-rate:到达率爬到 63 运行/s × 10m ≈ 500 events/s(事件/运行数可实测校准) | 500 events/s 透传压力 + 负载下延迟门槛 | 稳态折算吞吐 ≥0.9×500(summary 判定);负载下错误率/透传/首字同 steady 阈值 |

§7.4 对应:本目录即「k6 SSE 长连接 ramping 场景」;**PG 慢查询审查**与 **Redis 内存/连接数** 由 run.sh 每场后快照(`*-pg-slow-queries.txt` / `*-redis.txt`),结论汇入容量报告。

## 4. 阈值口径(参数化)

阈值默认值 = 验收 7 原文数字;全部可经环境变量覆盖(容量报告须记录实际取值):

| 环境变量 | 默认 | 用途 |
| --- | --- | --- |
| `IA_THRESHOLD_ERROR_RATE` | `0.001` | 运行错误率上界(steady/ramp 熔断阈值) |
| `IA_THRESHOLD_FIRST_CHAR_MS` | `3000` | 首字 P95 上界(ms,口径见 §5-1) |
| `IA_THRESHOLD_PASSTHROUGH_MS` | `200` | 事件透传 P95 上界(ms,口径见 §5-2) |
| `IA_THRESHOLD_EVENTS_PER_SEC` | `500` | ramp-events 吞吐目标(summary 折算判定) |
| `IA_CLOCK_SKEW_MS` | `250` | 透传样本负偏差/超界丢弃线(计入 `ia_clock_skew_samples`) |

场景节奏参数:`IA_STEADY_VUS=100`、`IA_STEADY_WARMUP=2m`、`IA_STEADY_DURATION=30m`、`IA_IDLE_SESSIONS=1000`、`IA_IDLE_RAMP=3m`、`IA_IDLE_HOLD=10m`、`IA_IDLE_SAMPLE_INTERVAL=15`、`IA_IDLE_MODE=sse|poll`、`IA_RAMP_HOLD=10m`、`IA_TARGET_EVENTS_PER_SEC=500`、`IA_EVENTS_PER_RUN_ESTIMATE=8`、`IA_RAMP_ARRIVAL`(=500/8)、`IA_RAMP_MAX_VUS`(自动)。

## 5. 指标口径(细定义在 `lib/metrics.js` 头注)

1. **首字「不含模型」**(`ia_sse_first_content_no_model_ms`):客户端黑盒无法直接剥离模型耗时,落三个 Trend —— 首事件(全含)、首 CONTENT(全含)、首 CONTENT − 事件自带 `reasoningDurationMs`(首个 CONTENT 携带的模型思考耗时,出处 `AiChatStreamRespVO`)。**主判定口径 = mock 模型环境(MockAiProvider 确定性脚本,模型贡献≈0)下的首 CONTENT P95 对 3s 线**;接真实模型的环境以扣思考口径为参考值(模型首 token 内部残差须在容量报告注明),并对照服务端 IA-5 计时器 `ia_sse_first_event_seconds`(灰度大盘 B5)。
2. **事件透传延迟**(`ia_sse_event_passthrough_ms`):k6 本地收到事件时刻 − 事件 `createdAt`(服务端事件 journal 创建时刻,随事件体下发),覆盖 journal→投影→SSE 出口→网络全程。负偏差/超 10min 的样本不入 Trend,计入 `ia_clock_skew_samples` 并在报告披露。
3. **事件间间隔**(`ia_sse_inter_event_ms`):同运行相邻事件到达间隔;mock 模型固定 800ms/delta 出字,压测下系统性抬升 = fan-out 积压观察位,不设硬阈值。
4. **吞吐 500 events/s 判定**:k6 Counter 的 `rate` 阈值是全测试均值,含爬坡稀释,不设为硬阈值;ramp-events 在 summary 按 `全期均值 × 总时长 ÷ (0.5·爬坡+稳态+0.5·泄坡)` 折算稳态吞吐,≥0.9×目标 判 PASS,公式随结果输出。
5. **内存稳定判定**:idle-sessions 采样 VU 在**稳态窗口**(保持期,剔除爬坡)对 heap used 做线性回归,斜率(B/min)记入 `ia_idle_heap_growth_bytes_per_min`;|斜率| ≤1 MiB/min 判 PASS(GC 锯齿由全窗口回归抹平;判定线是经验值,容量报告结合 GC/分代曲线裁量)。交叉验证位:`fusion_agentscope_runtime_runs_waiting` 均值应≈1000(运行真实驻留 WAITING_CONFIRMATION)。

## 6. 实现注记(压测脚本易错点,改代码前必读)

- **k6 每 VU 独立脚本实例**:模块级可变全局不能跨 VU 聚合,`setup()` 的修改对 VU 不可见;跨上下文只走两条通道 —— 自定义 metrics(`handleSummary` 读 `data.metrics`)与 console JSONL 行(idle 采样明细)。
- **异步上下文的假通过陷阱**:k6 对异步 VU 函数里拒绝的 promise 只记 "Uncaught (in promise)",迭代仍算完成;若此前 checks 为 0 样本,`checks rate==1` 阈值会空样本绿灯。故所有场景用 `loadSseSafe()`(不抛出)并在失败时落一条必然失败的 check,让门禁以非零退出码阻断(2026-09-21 实测发现并修复)。
- **SSE 连接生命周期**:`sse.open()` 阻塞至连接关闭;终态事件到达后服务端关流(`AgentRunReplayService` 至 terminalSequence 完成 Flux)。idle 场景刻意**不调** `client.close()` 以维持半开(服务端 24h 确认超时兜底),场景收尾由 k6 gracefulStop 打断。
- **动态 import**:`k6/x/sse` 在 `lib/sse-client.js` 里运行期装载(缓存),失败时给出安装指引;因此 `k6 inspect` 无需扩展。
- **`/actuator/prometheus`**(IA-1):白名单 health/info/prometheus,无鉴权(部署层内网端点,见 application.yml 口径注释);指标名 `jvm_memory_used_bytes`、`fusion_agentscope_runtime_*` 见灰度大盘 §2.2。

## 7. 空闲会话为何是 WAITING_CONFIRMATION(口径备忘)

验收的「1000 空闲会话」按真实契约落为:**`toolExecutionMode=ALWAYS_ASK` 发起运行 → mock 模型脚本调用 `get_current_time` → 策略「所有工具一律 ASK 且授权不可绕过」(`AgentToolPermissionPolicy`)→ 运行进入 `WAITING_CONFIRMATION`(确认超时 24h)→ SSE 投出确认事件后半开静默**。这正是生产「用户确认卡挂着不动」的会话形态,且纯平台栈(server+PG+Redis+mock 模型)可复现,无需宿主桥。轮询备选(`IA_IDLE_MODE=poll`)用 `GET /runs/{runId}` 30s 轮询,供不允许长挂连接的环境。

## 8. 已知限制 / 遗留

- **本目录脚本未在真实 SSE 流量下实跑**(本机 k6 无 SSE 扩展且无 Go 工具链;`k6 inspect` 与 `bash -n` 已过,服务端契约已按 `scripts/smoke-sse.sh` 同款请求实测核对)。首次真跑建议:`SCENARIOS="smoke" tools/k6/run.sh` 观察 `xk6` 自动装配是否成功,再放量。
- mock 模型 `DELTA_INTERVAL=800ms`(MockAiProvider 硬编码)决定单运行时长下限与事件节奏;500 events/s 依赖「多运行并发」而非单流提速,`IA_EVENTS_PER_RUN_ESTIMATE` 首跑后按实测 `ia_events_per_run` 校准。
- run.sh 默认把 mock 模型 `max_concurrency` 5→1000(`IA_CALIBRATE=0` 关闭),否则模型并发闸先于事件管道成为瓶颈,测得的是闸而非 fan-out。
- `pg_stat_statements` 需部署侧 `shared_preload_libraries`;未启用时 PG 快照自动降级为 activity 长事务 + 序扫观察位(快照文件内有启用指引)。
- 删除批次①②(引擎与控制器,W16 同周)合入后若 SSE 契约有变,须同步 `lib/config.js`/`lib/metrics.js` 头注的契约出处。
