# demo-host — InnerAgent SDK 宿主接入演示

纯 HTML + 少量 JS 的宿主页, 演示 `<inneragent-chat>` Web Component 的:

- **Shadow DOM 双向隔离**: 宿主页故意放置"激进"全局样式 (红色段落 / 绿色虚线按钮),
  组件内部不受污染, 组件样式也不泄漏到宿主;
- **主题令牌**: `--ia-primary` 等 CSS 变量在宿主元素上覆写即实时换肤;
- **契约入口**: `init({ appKey, tokenGetter, baseURL })` + `registerInnerAgentChat()`。

## 运行

```bash
# 1. 生成 SDK 构建产物 (首次 / core+components 变更后)
cd sdk-js && pnpm install && pnpm build

# 2. 起宿主页 (http://localhost:5180)
cd examples/demo-host && pnpm install && pnpm dev
```

## 连本机 18090 服务端手工冒烟

1. 启动 inneragent-server (local profile, 端口 18090)。
2. `examples/demo-host/vite.config.js` 已把 `/ia` 反代到 `http://127.0.0.1:18090`,
   SDK `baseURL` 默认 `/ia/api/v1`, 同源直连无需 CORS。
3. `main.js` 中 `tokenGetter` 返回 `null`: 本地联调依赖服务端 local profile 的
   **匿名演示头** (服务端不校验 Authorization); 生产接入时把回调替换为宿主
   embed-token 签发接口即可。
4. 冒烟清单:
   - 页面加载后组件内按钮/输入区为 SDK 样式 (非宿主绿色虚线);
   - 宿主按钮点击后仍为宿主样式 (无样式泄漏);
   - 「切换 --ia-primary 主题」按钮 → 组件主色实时切换;
   - 输入消息发送 → SSE 流式回复 (需服务端 T3b 就绪);
   - DevTools 中组件内容位于 `#shadow-root` 内。

## iframe 模式说明

`init({ mode: 'iframe' })` 当前抛出 `IframeModeNotImplementedError` 占位
(P4/W15 实现 postMessage 桥, 见《02-技术方案》§8.1)。
