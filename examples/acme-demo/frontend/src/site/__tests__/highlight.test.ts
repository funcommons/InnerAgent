import { describe, it, expect } from 'vitest'
import { tokenize } from '@/site/highlight'

function kindsOf(code: string, lang: string): string[] {
  return tokenize(code, lang).map((t) => t.kind)
}

describe('site/highlight(极简代码着色 tokenizer)', () => {
  it('round-trip:token 文本拼接与输入恒等', () => {
    const samples: Array<[string, string]> = [
      ['const x = 1; // hi\nfoo("bar")', 'js'],
      ['<dependency>\n  <groupId>x</groupId>\n</dependency>', 'xml'],
      ['server-base: http://localhost:18090 # comment', 'yaml'],
      ['curl -s "http://x" # run', 'bash'],
    ]
    for (const [code, lang] of samples) {
      const joined = tokenize(code, lang).map((t) => t.text).join('')
      expect(joined).toBe(code)
    }
  })

  it('java:注释/字符串/注解/关键字/数字 分别着色', () => {
    const kinds = kindsOf('@IaTool(name = "get_customer") // read\npublic String f(long x) { return null; }\nint n = 12;', 'java')
    expect(kinds).toContain('annotation')
    expect(kinds).toContain('string')
    expect(kinds).toContain('comment')
    expect(kinds).toContain('keyword')
    expect(kinds).toContain('number')
  })

  it('xml:标签着色,标签内文本为数字 token', () => {
    const tokens = tokenize('<version>0.1.0</version>', 'xml')
    expect(tokens.some((t) => t.kind === 'tag' && t.text === '<version')).toBe(true)
    expect(tokens.some((t) => t.kind === 'tag' && t.text === '</version')).toBe(true)
    expect(tokens.some((t) => t.kind === 'number' && t.text === '0.1.0')).toBe(true)
  })

  it('yaml:行首键与注释着色', () => {
    const tokens = tokenize('server-base: http://localhost:18090\n# 全量注释行', 'yaml')
    expect(tokens.some((t) => t.kind === 'key' && t.text.includes('server-base'))).toBe(true)
    expect(tokens.some((t) => t.kind === 'comment' && t.text.startsWith('#'))).toBe(true)
  })

  it('text 语言恒为 plain,空输入安全', () => {
    expect(kindsOf('anything # not a comment', 'text')).toEqual(['plain'])
    expect(tokenize('', 'js')).toEqual([{ text: '', kind: 'plain' }])
  })

  it('未知语言按 c 家族处理(注释/字符串生效)', () => {
    const kinds = kindsOf('x = "s" /* block */', 'unknownlang')
    expect(kinds).toContain('string')
    expect(kinds).toContain('comment')
  })
})
