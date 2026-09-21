import { http } from '@/api/request'

/**
 * ACME DEMO 宿主后端接口(对应 backend/ 演示服务,见 docs/接入指南.md)。
 * 认证:轻登录后的演示 token 由 request.ts 统一注入 Bearer。
 */

export interface DemoConfig {
  inneragentBaseUrl: string
  appKey: string
  agentType: string
}

export interface Ticket {
  ticketId: string
  title: string
  description: string
  priority: 'low' | 'normal' | 'high'
  status: string
  /** direct = 宿主表单直建;agent = InnerAgent 会话经 /ia-mcp 桥触发 create_ticket */
  channel: 'direct' | 'agent'
  createdBy: string
  runId: string
}

export interface WebhookEvent {
  event: string
  runId: string
  status: string | null
  deliveryId: string
  known: boolean
  rawBody: string
  receivedAt: string
}

export const demoApi = {
  /** 公开值:InnerAgent server 地址 / appKey / agentType(免登录) */
  config: () => http.get<DemoConfig>('/api/demo/config'),

  /** 工单:宿主表单直建(channel=direct;agent 通道走 InnerAgent 会话+确认卡) */
  createTicket: (body: { title: string; description?: string; priority?: string }) =>
    http.post<Ticket>('/api/tickets', body),

  /** 工单:全量快照(新→旧;两条通道混排,轮询可见 agent 建单实时出现) */
  listTickets: () => http.get<Ticket[]>('/api/tickets'),

  /** InnerAgent webhook 事件流(运行终态回调,X-IA-Delivery 幂等) */
  webhookEvents: () => http.get<WebhookEvent[]>('/api/webhook-events'),
}
