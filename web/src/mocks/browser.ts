/**
 * [new] 浏览器端 msw 启动入口(dev 模式全站 mock,不接真实服务)。
 */
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)
