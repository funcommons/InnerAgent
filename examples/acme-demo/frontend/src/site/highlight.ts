/**
 * 极简代码高亮 tokenizer(零依赖,不引重库)。
 *
 * 按语言家族给出一条「优先级从高到低」的交替正则,扫描出着色 token:
 * 注释 > 字符串 > 标签/键 > 注解 > 数字 > 关键字 > 其余 plain。
 * 只做着色,不做语法校验;输出 token 序列的文本拼接与输入恒等(round-trip)。
 */

export type TokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number' | 'annotation' | 'tag' | 'key'

export interface CodeToken {
  text: string
  kind: TokenKind
}

type LangFamily = 'c' | 'xml' | 'yaml' | 'bash' | 'text'

// 非 xml/yaml/bash/text 的语言(java/js/ts/json 等)一律按 c 家族处理
const XML_LANGS = new Set(['xml', 'html', 'vue'])
const YAML_LANGS = new Set(['yaml', 'yml'])
const BASH_LANGS = new Set(['bash', 'sh', 'shell', 'console'])

function familyOf(lang: string): LangFamily {
  const l = lang.toLowerCase()
  if (XML_LANGS.has(l)) return 'xml'
  if (YAML_LANGS.has(l)) return 'yaml'
  if (BASH_LANGS.has(l)) return 'bash'
  if (l === 'text' || l === '') return 'text'
  return 'c'
}

/** java/js 常用关键字并集(够 demo 文档着色用) */
const KEYWORDS = [
  'abstract', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'default', 'do', 'else', 'export', 'extends', 'false', 'final', 'finally', 'from', 'function',
  'get', 'if', 'implements', 'import', 'instanceof', 'interface', 'let', 'long', 'new', 'null',
  'package', 'private', 'protected', 'public', 'readonly', 'return', 'static', 'super', 'switch',
  'this', 'throw', 'throws', 'true', 'try', 'type', 'typeof', 'var', 'void', 'while', 'with',
]

interface FamilyPattern {
  source: string
  kind: TokenKind
}

function patternsOf(family: LangFamily): FamilyPattern[] {
  const stringPat = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + '`(?:[^`\\\\]|\\\\.)*`'
  const patterns: FamilyPattern[] = []
  switch (family) {
    case 'xml':
      patterns.push({ source: String.raw`<!--[\s\S]*?-->`, kind: 'comment' })
      patterns.push({ source: stringPat, kind: 'string' })
      patterns.push({ source: String.raw`</?[\w.-]+|/?>`, kind: 'tag' })
      break
    case 'yaml':
      patterns.push({ source: String.raw`#[^\n]*`, kind: 'comment' })
      patterns.push({ source: stringPat, kind: 'string' })
      patterns.push({ source: String.raw`^[ \t]*-?[ \t]*[\w.$-]+(?=[ \t]*:)`, kind: 'key' })
      break
    case 'bash':
      patterns.push({ source: String.raw`#[^\n]*`, kind: 'comment' })
      patterns.push({ source: stringPat, kind: 'string' })
      break
    default:
      patterns.push({ source: String.raw`/\*[\s\S]*?\*/|//[^\n]*`, kind: 'comment' })
      patterns.push({ source: stringPat, kind: 'string' })
      break
  }
  patterns.push({ source: String.raw`@[\w.$]+`, kind: 'annotation' })
  patterns.push({ source: String.raw`\b\d[\d._a-fx]*\b`, kind: 'number' })
  patterns.push({ source: String.raw`\b(?:${KEYWORDS.join('|')})\b`, kind: 'keyword' })
  return patterns
}

/** 把代码切成着色 token;token 文本拼接与输入恒等 */
export function tokenize(code: string, lang: string): CodeToken[] {
  const family = familyOf(lang)
  if (family === 'text' || !code) return [{ text: code, kind: 'plain' }]

  const patterns = patternsOf(family)
  const master = new RegExp(patterns.map((p) => `(${p.source})`).join('|'), 'gm')
  const tokens: CodeToken[] = []

  let last = 0
  for (let m = master.exec(code); m !== null; m = master.exec(code)) {
    if (m.index > last) tokens.push({ text: code.slice(last, m.index), kind: 'plain' })
    let kind: TokenKind = 'plain'
    for (let i = 1; i <= patterns.length; i++) {
      if (m[i] !== undefined) {
        kind = patterns[i - 1]!.kind
        break
      }
    }
    tokens.push({ text: m[0], kind })
    last = m.index + m[0].length
    if (m[0].length === 0) master.lastIndex++ // 空匹配保护
  }
  if (last < code.length) tokens.push({ text: code.slice(last), kind: 'plain' })
  return tokens
}
