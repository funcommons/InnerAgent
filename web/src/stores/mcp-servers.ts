/**
 * [new] 三方 MCP 服务器 store(P4-W13,视图清单 #8)。
 * 覆盖 AdminMcpServerController:应用级列表(数组含停用)/注册/更新/启停/删除。
 * credentials 只写:响应永为打码形(credentialsMasked);serverKey 防遮蔽冲突
 * (本表唯一 + 与宿主注册表工具冲突)由服务端 409 把关。
 */
import { defineStore } from 'pinia'
import { mcpServerAdminApi } from '@/api/admin'
import type { IaMcpServer, McpServerSaveReq } from '@/api/types'

export const useMcpServersStore = defineStore('mcp-servers', {
  state: () => ({
    list: [] as IaMcpServer[],
    loading: false,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        this.list = await mcpServerAdminApi.list()
      } finally {
        this.loading = false
      }
    },
    async create(req: McpServerSaveReq): Promise<IaMcpServer> {
      const row = await mcpServerAdminApi.register(req)
      await this.load()
      return row
    },
    async update(id: number, req: McpServerSaveReq): Promise<IaMcpServer> {
      const row = await mcpServerAdminApi.update(id, req)
      await this.load()
      return row
    },
    async setEnabled(id: number, enabled: boolean): Promise<IaMcpServer> {
      const row = enabled ? await mcpServerAdminApi.enable(id) : await mcpServerAdminApi.disable(id)
      await this.load()
      return row
    },
    async remove(id: number): Promise<void> {
      await mcpServerAdminApi.remove(id)
      await this.load()
    },
  },
})
