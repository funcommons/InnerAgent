/*
 * tools/k6/lib/sse-client.js — SSE 模块装载(k6/x/sse 社区扩展)。
 *
 * 重要事实(2026-09-21 以 k6 官方仓库逐 tag 核实):
 *   - k6 官方二进制至今(含 v2.2.0)不含任何内置 SSE JS 模块;
 *     `k6/experimental/sse` 与 `k6/sse` 在 v0.49–v2.2.0 的模块树中均不存在
 *     (grafana/k6#746:原生 SSE 支持排期在 v2 开发周期)。
 *   - k6 生态的 SSE 事实标准是社区扩展 phymbert/xk6-sse(模块名 `k6/x/sse`),
 *     自 k6 支持扩展自动装配(automatic extension resolution)起,装了 Go
 *     工具链的机器无需 xk6 自定义构建,k6 会现场解析并编译;
 *     无法自动装配时需自定义构建:
 *       xk6 build --with github.com/phymbert/xk6-sse@latest
 *     (k6 官方构建产物可从 GitHub releases 下载 xk6 二进制。)
 *
 * 装载策略[2026-09-28 改定]:静态 import。
 *
 * 历史与实测:本文件原用动态 import(`await import('k6/x/sse')`),让无扩展
 * 机器的 `k6 inspect`/语法校验也能通过;但 xk6 自定义构建(k6 v1.8.1 +
 * phymbert/xk6-sse v0.2.0)实测:即使扩展已静态内嵌,动态 import 仍会走
 * k6 的 provisioning/动态模块子系统并报「dynamic modules not enabled in
 * the host program」,静态 import 则正常 —— 故改静态。代价:无扩展二进制在
 * 模块装载期即报 k6 自己的 unknown module 错误;安装指引见 README「依赖」。
 *
 * 扩展 API(xk6-sse,详见其 README):
 *   sse.open(url, params, function (client) {
 *     client.on('open',  () => {...});
 *     client.on('event', (event) => {...});   // event: { id, name, data }
 *     client.on('error', (e) => {...});
 *   });
 *   - open() 阻塞至连接关闭(服务端终态关流 / client.close() / 场景 gracefulStop);
 *   - params 支持 { method, headers, body, tags }(POST + 请求体可用);
 *   - 返回 HTTP Response(可取 status)。
 */

import sseModule from 'k6/x/sse';

const cached = sseModule;

/**
 * 装载并缓存 SSE 模块(静态导入后仅剩兼容性校验;签名保持 async 不变,
 * 调用方无须感知策略切换):
 *   const sse = await loadSse();
 */
export async function loadSse() {
  if (!cached || typeof cached.open !== 'function') {
    throw new Error(
      '[ia-k6] k6/x/sse 不可用或缺 open() —— 需 xk6 自定义构建:'
      + 'xk6 build --with github.com/phymbert/xk6-sse@latest;'
      + '详见 tools/k6/README.md「依赖」。')
      ;
  }
  return cached;
}

/**
 * 装载 SSE 模块的「不抛出」变体:返回 { sse, error }。
 *
 * 为什么需要它:k6 对异步 VU 函数中拒绝的 promise 只记 "Uncaught (in promise)"
 * 日志,迭代仍算完成 —— 异常被吞后,checks 保持 0 样本,阈值(如 checks
 * rate==1)会因空样本绿灯,产生假通过。场景应改用本方法并在失败时落一条
 * 必然失败的 check,让阈值门禁把整场压测打为退出码非 0(README「实现注记」)。
 */
export async function loadSseSafe() {
  try {
    return { sse: await loadSse(), error: null };
  } catch (e) {
    return { sse: null, error: String(e) };
  }
}

/**
 * 打开一个 SSE 连接并消费到关流(对 xk6-sse open 的薄封装,统一 tags)。
 * handlers: { onOpen, onEvent(event), onError(err), onReady(response) }
 * 返回 HTTP Response(open() 阻塞结束后返回)。
 */
export function consumeSse(sse, url, params, handlers) {
  return sse.open(url, params, (client) => {
    if (handlers.onOpen) {
      client.on('open', handlers.onOpen);
    }
    client.on('event', (event) => {
      // 统一在此层做防御:事件 data 可能缺省(如仅有注释行/心跳)
      handlers.onEvent(event, client);
    });
    if (handlers.onError) {
      client.on('error', handlers.onError);
    }
  });
}
