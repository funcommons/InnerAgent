/**
 * [new] ESLint 平面配置(优化建议 #25:过时契约注释 CI 校验)。
 *
 * 自定义规则 local/contract-comments:src 内注释禁止出现「未实现 / not
 * implemented / 待服务端 / 待后端」类漂移字样,除非同一注释块携带跟踪链接
 * (跟踪:<path> / 99-优化建议.md / test-report/ / issue 链接)。
 * 背景:R1 曾出现「头注释称服务端未实现,而端点已落地」的认知税
 * (99-优化建议.md #25);契约注释必须描述实况或显式挂跟踪。
 */
import tsParser from '@typescript-eslint/parser'
import vueParser from 'vue-eslint-parser'

// 已知漂移字样清单(R3 起按实发漂移逐条补录;命中且同块无跟踪链接即报错)。
// 未收录的语义漂移族(R3 复盘):熔断域旧契约「≤5s 生效,经 Redis 取消通道」
// ——无法以关键词区分「漂移主张」与「实况否定」(api/admin.ts「无 Redis 广播/
// ≤5s 生效语义」、views/CircuitView.vue 确认框注记均为合法否定形态),且现存
// 残留 api/types.ts 紧急停用注释仍带旧契约表述,待下批清零后再把
// `≤5s 生效|经 Redis 取消通道` 收进本清单,避免守卫误伤在册实况注释。
const FORBIDDEN = /未实现|not\s*implemented|待服务端|待后端/i

/** 允许条件:同一注释块携带跟踪链接(跟踪:xxx / 已知文档/issue 路径) */
const TRACKING = /跟踪[:：]\s*\S+|99-优化建议\.md|test-report\/|https?:\/\/#\S*|https?:\/\/\S+/i

/** @type {import('eslint').Linter.RulesRecord} */
const contractCommentsRule = {
  meta: {
    type: 'problem',
    docs: {
      description: '契约注释禁止漂移字样(未实现/not implemented/待服务端),须描述实况或带跟踪链接',
    },
    schema: [],
    messages: {
      drift: '契约注释含漂移字样「{{phrase}}」:请更新为实况,或在同一注释块内携带跟踪链接(如 跟踪:99-优化建议.md #N)',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()
    return {
      Program(program) {
        for (const comment of sourceCode.getAllComments()) {
          const match = comment.value.match(FORBIDDEN)
          if (!match) continue
          if (TRACKING.test(comment.value)) continue
          context.report({
            loc: comment.loc,
            messageId: 'drift',
            data: { phrase: match[0] },
            node: program,
          })
        }
      },
    }
  },
}

const localPlugin = { rules: { 'contract-comments': contractCommentsRule } }

export default [
  {
    // 构建产物与 msw 生成物不参与契约注释守卫
    ignores: ['dist/**', 'public/mockServiceWorker.js', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts'],
    plugins: { local: localPlugin },
    languageOptions: { parser: tsParser, sourceType: 'module' },
    rules: { 'local/contract-comments': 'error' },
  },
  {
    files: ['src/**/*.vue'],
    plugins: { local: localPlugin },
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tsParser, sourceType: 'module', extraFileExtensions: ['.vue'] },
    },
    rules: { 'local/contract-comments': 'error' },
  },
]
