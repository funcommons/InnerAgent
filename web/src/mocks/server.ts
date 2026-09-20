/**
 * [new] Vitest 用 msw node server(请求拦截,api 层测试共用)。
 */
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
