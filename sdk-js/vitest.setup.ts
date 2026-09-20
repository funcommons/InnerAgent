/**
 * Vitest 全局 setup (任务 P1-T3a)。
 *
 * 本机 Node ≥26 + jsdom 组合下全局/ window 的 localStorage 均不可用
 * (Node 26 的实验性 web storage 需 --localstorage-file; jsdom 环境未暴露),
 * 这里补一个内存版 Storage 兜底, 语义满足 SDK 持久化测试 (键值读写/清空)。
 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (key: string) => map.has(key) ? map.get(key)! : null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key) },
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  let current: Storage | undefined
  try {
    current = (globalThis as Record<string, unknown>)[name] as Storage | undefined
    current?.getItem('__probe__')
  } catch {
    current = undefined
  }
  if (!current) {
    Object.defineProperty(globalThis, name, {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    })
  }
}

