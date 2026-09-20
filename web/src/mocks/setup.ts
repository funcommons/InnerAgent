/**
 * [new] Vitest 全局 setup:启动 msw node server(handlers: resolve 真实网络请求),
 * 每条用例后重置 handler 与 session 状态。
 */
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'
import { resetMockData } from './data'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetMockData()
  sessionStorage.clear()
})
afterAll(() => server.close())
