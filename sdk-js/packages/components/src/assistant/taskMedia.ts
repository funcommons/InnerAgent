/**
 * [adapt] taskMedia — 源: $SRC/src/utils/task-media.ts。
 * 内容「视频地址/下载地址」行抽卡为媒体链接卡片; resolveMediaUrl 改由 core 提供。
 */
/**
 * 任务媒体行抽卡 (对齐旧前端 notification-panel/utils.ts parseTaskContent):
 * 助手/任务完成文本中的「视频地址:」「下载地址:」行不进 markdown 正文,
 * 改抽成结构化媒体链接卡片, 供时间线渲染 + 一键下载。
 */
import { resolveMediaUrl } from '@inneragent/sdk-core'

const TASK_MEDIA_URL_LINE_REGEXP = /((?:视频地址|下载地址)[:：]\s*)(https?:\/\/[^\s)]+|\/media\/[^\s)]+)/g

export interface TaskMediaLinkInfo {
  label: string
  rawUrl: string
  resolvedUrl: string
}

export function parseTaskMediaLinks(content: string): {
  markdownContent: string
  mediaLinks: TaskMediaLinkInfo[]
} {
  const mediaLinks: TaskMediaLinkInfo[] = []
  const markdownLines = content
    .split(/\r?\n/)
    .map((line) => {
      let extracted = false
      const strippedLine = line.replace(
        TASK_MEDIA_URL_LINE_REGEXP,
        (_match: string, prefix: string, rawUrl: string) => {
          const resolvedUrl = resolveMediaUrl(rawUrl) || rawUrl
          mediaLinks.push({
            label: prefix.replace(/[:：]\s*$/, '').trim() || '下载地址',
            rawUrl,
            resolvedUrl,
          })
          extracted = true
          return ''
        },
      )

      if (!extracted) {
        return line
      }

      return strippedLine.replace(/[·:：\s-]+$/g, '').trimEnd()
    })

  return {
    markdownContent: markdownLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    mediaLinks,
  }
}
