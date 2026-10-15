/**
 * forge.zod 的 JS 版 —— Zod 结构的小解析器 / 保形生成器。
 * ========================================================
 *
 * 为什么需要它：一条变量在卡里要写**三处** —— 画面板的 objects、初始值 initial_state、
 * 以及 Zod 校验代码 schema_code。第三处是一整段 JS 代码（在卡里就是个字符串），
 * 往对象里加一个字段就得同时往那段代码里加一行；漏了不报错，运行时**静默丢掉**
 * 写进去的值（validate 里的 VAR-SYNC-SCHEMA 就是在事后兜这个）。
 *
 * 于是这一层只做一件事：把 `z.object({...})` 拆成一棵树，**原样存住**每个叶子的
 * 表达式，再按稳定格式拼回去。
 *
 * 移植注意：Python 那边用 OrderedDict，这里一律用 **Map** —— JS 对象的键序对
 * 「像整数的字符串键」会重排，而 Zod 里的字段名没理由受这个委屈。
 */
import { pyRepr } from './model.mjs'

export class ZodError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ZodError'
  }
}

/** 一个 z.object({...})。kids 按原顺序存子节点，raw 存键的原始写法。 */
export class Obj {
  constructor(kids = null, raw = null) {
    this.kids = new Map(kids ?? [])
    this.raw = new Map(raw ?? [])
  }

  toString() {
    return `Obj(${[...this.kids.keys()].join(', ')})`
  }
}

/** 其余一切：一段原样留着的表达式（z.string()、z.array(z.any())…）。 */
export class Leaf {
  constructor(code) {
    this.code = code
  }

  toString() {
    return `Leaf(${pyRepr(this.code)})`
  }
}

// ------------------------------------------------------------------ 扫描
const _QUOTES = "\"'`"
const _OPEN = '([{'
const _CLOSE = ')]}'

/** s[i] 是左括号，返回配对右括号的下标。字符串里的括号不算。 */
function _scan_close(s, i) {
  let depth = 0
  let q = null
  let j = i
  const n = s.length
  while (j < n) {
    const c = s[j]
    if (q) {
      if (c === '\\') { j += 2; continue }
      if (c === q) q = null
      j += 1
      continue
    }
    if (_QUOTES.includes(c)) q = c
    else if (_OPEN.includes(c)) depth += 1
    else if (_CLOSE.includes(c)) {
      depth -= 1
      if (depth === 0) return j
    }
    j += 1
  }
  throw new ZodError('括号没配平')
}

/** 在括号深度 0 处按逗号切开。 */
function _split_top(s) {
  const parts = []
  let depth = 0
  let q = null
  let start = 0
  let i = 0
  const n = s.length
  while (i < n) {
    const c = s[i]
    if (q) {
      if (c === '\\') { i += 2; continue }
      if (c === q) q = null
      i += 1
      continue
    }
    if (_QUOTES.includes(c)) q = c
    else if (_OPEN.includes(c)) depth += 1
    else if (_CLOSE.includes(c)) {
      depth -= 1
      if (depth < 0) throw new ZodError('右括号比左括号多')
    } else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
    i += 1
  }
  if (q) throw new ZodError('引号没关上')
  if (depth !== 0) throw new ZodError('括号没配平')
  parts.push(s.slice(start))
  return parts
}

/** 把 `键: 表达式` 在顶部那个冒号处切开。切不出冒号说明我们切错了地方。 */
function _split_key(part) {
  let depth = 0
  let q = null
  let i = 0
  while (i < part.length) {
    const c = part[i]
    if (q) {
      if (c === '\\') { i += 2; continue }
      if (c === q) q = null
      i += 1
      continue
    }
    if (_QUOTES.includes(c)) q = c
    else if (_OPEN.includes(c)) depth += 1
    else if (_CLOSE.includes(c)) depth -= 1
    else if (c === ':' && depth === 0) return [part.slice(0, i), part.slice(i + 1)]
    i += 1
  }
  return [null, null]
}

/**
 * JS 标识符（中日韩汉字在 JS 里本来就是合法标识符字符，所以中文裸键放行）。
 *
 * ⚠️ 这里不能用 JS 的 `\w`：它只认 ASCII，而 Python 的 `\w` 是**Unicode 感知**的。
 * 用 `\p{L}\p{N}` 配 `u` 旗才等价。
 */
const _IDENT = /^[A-Za-z_$\u00a0-\uffff][\p{L}\p{N}_$\u00a0-\uffff]*$/u

function _key_of(raw) {
  const t = raw.trim()
  if (t.length >= 2 && t[0] === t[t.length - 1] && _QUOTES.includes(t[0])) {
    return [t.slice(1, -1), t]
  }
  if (_IDENT.test(t)) return [t, t]
  throw new ZodError(`键的写法认不出：${raw.trim().slice(0, 24) || '(空)'}`)
}

// ------------------------------------------------------------------ 解析
/** 一段 Zod 代码 -> 树。顶层不是单个干净的 z.object(...) 就抛错。 */
export function parse(code) {
  let t = String(code ?? '').trim()
  if (t.endsWith(';')) t = t.slice(0, -1).trim()
  if (!t) return new Obj()
  return _parse_object(t)
}

function _parse_object(s) {
  const t = s.trim()
  if (!t.startsWith('z.object')) {
    throw new ZodError(`顶层不是 z.object(...)：开头是「${t.slice(0, 24)}」`)
  }
  const k = 'z.object'.length
  if (k >= t.length || t[k] !== '(') throw new ZodError('z.object 后面不是左括号')
  const close = _scan_close(t, k)
  const tail = t.slice(close + 1).trim()
  if (tail) throw new ZodError(`z.object(...) 后面还跟着「${tail.slice(0, 16)}」—— 这种形状工具不碰`)
  const inner = t.slice(k + 1, close).trim()
  if (!inner.startsWith('{')) throw new ZodError('z.object(...) 里不是一对花括号')
  const end = _scan_close(inner, 0)
  if (end !== inner.length - 1) throw new ZodError('z.object(...) 里的花括号不止一对')
  const node = new Obj()
  for (const part of _split_top(inner.slice(1, end))) {
    if (!part.trim()) continue
    const [rawkey, expr] = _split_key(part)
    if (rawkey === null) throw new ZodError(`这一段看不懂（找不到冒号）：${part.trim().slice(0, 32)}`)
    const [key, raw] = _key_of(rawkey)
    if (node.kids.has(key)) throw new ZodError(`同一个对象里出现了两次「${key}」`)
    node.kids.set(key, _parse_expr(expr))
    node.raw.set(key, raw)
  }
  return node
}

function _parse_expr(expr) {
  const t = String(expr ?? '').trim()
  if (t.startsWith('z.object')) {
    try {
      return _parse_object(t)
    } catch (错) {
      if (!(错 instanceof ZodError)) throw 错
      // 形状认不出的嵌套对象：原样留着（能整体复制 / 删除，只是进不去）
      return new Leaf(t)
    }
  }
  return new Leaf(t)
}

// ------------------------------------------------------------------ 生成
/** 一行的舒服上限（含缩进）；超了就一层一行。 */
export const MAX_INLINE = 96

/**
 * 树 -> 代码。格式是稳定的：短对象写成一行，长对象一层一行。
 *
 * 「稳」在这里是硬要求 —— 同样的树必须每次都出同样的字。
 */
export function emit(node, indent = 0) {
  if (node instanceof Leaf) return node.code
  const kids = [...node.kids.entries()].filter(([, v]) => v !== null && v !== undefined)
  if (!kids.length) return 'z.object({})'
  if (kids.every(([, v]) => v instanceof Leaf)) {
    const inline = `z.object({ ${kids
      .map(([k, v]) => `${node.raw.get(k) || k}: ${emit(v)}`).join(', ')} })`
    if (inline.length + 2 * indent <= MAX_INLINE) return inline
  }
  const 缩进 = '  '.repeat(indent + 1)
  const body = kids
    .map(([k, v]) => `${缩进}${node.raw.get(k) || k}: ${emit(v, indent + 1)},\n`)
    .join('')
  return `z.object({\n${body}${'  '.repeat(indent)}})`
}

/** 树 -> 普通嵌套结构（字符串=叶子表达式）。给人看、给测试比。 */
export function dump(node) {
  if (node instanceof Leaf) return node.code
  const out = {}
  for (const [k, v] of node.kids) out[k] = dump(v)
  return out
}

export const top_keys = (code) => [...parse(code).kids.keys()]

export function is_object(code) {
  try {
    parse(code)
    return true
  } catch (错) {
    if (错 instanceof ZodError) return false
    throw 错
  }
}

/** 解析 -> 生成 -> 再解析，两棵树必须一模一样。 */
export function roundtrip_ok(code) {
  const a = JSON.stringify(dump(parse(code)))
  const b = JSON.stringify(dump(parse(emit(parse(code)))))
  return a === b
}

// ------------------------------------------------------------------ 类型
const _TYPES = {
  boolean: 'z.boolean()',
  bool: 'z.boolean()',
  string: 'z.string()',
  number: 'z.number()',
  int: 'z.number().int()',
  array: 'z.array(z.any())',
  object: 'z.object({})',
}

/** 按变量的类型名给一个 Zod 表达式；类型名没写就按初值的形状猜。 */
export function expr_for(type_name, value = null) {
  const t = String(type_name ?? '').trim().toLowerCase()
  if (t in _TYPES) return _TYPES[t]
  if (typeof value === 'boolean') return 'z.boolean()'
  if (typeof value === 'number') return 'z.number()'
  if (Array.isArray(value)) return 'z.array(z.any())'
  if (value && typeof value === 'object') return 'z.object({})'
  if (typeof value === 'string') return 'z.string()'
  return 'z.any()'
}

// ------------------------------------------------------------------ 改树
function _walk(node, path, create = true) {
  let cur = node
  for (const seg of path) {
    if (cur instanceof Leaf) {
      throw new ZodError(
        `「${path.join('.')}」在 Zod 里不是纯 z.object({...})（现在写的是 ${cur.code.slice(0, 30)}），` +
        '工具没法往里加字段')
    }
    let child = cur.kids.get(seg)
    if (child === undefined) {
      if (!create) return [null, null]
      child = new Obj()
      cur.kids.set(seg, child)
      cur.raw.set(seg, seg)
    }
    cur = child
  }
  return [cur, cur]
}

/** 在 path 那层放一个叶子。path 为空表示根。 */
export function set_leaf(root, path, key, code) {
  if (root instanceof Leaf) throw new ZodError('顶层不是 z.object，加不了字段')
  const [node] = _walk(root, [...path])
  if (node instanceof Leaf) throw new ZodError(`走不到「${path.join('.')}」那层`)
  node.kids.set(key, new Leaf(String(code).trim()))
  node.raw.set(key, key)
  return root
}

/** 删掉 path 那层的 key；key 为空则整个 path 节点删掉。 */
export function drop(root, path, key = null) {
  const p = [...path]
  if (root instanceof Leaf) throw new ZodError('顶层不是 z.object，删不了')
  if (!p.length) {
    if (root.kids.has(key)) {
      root.kids.delete(key)
      root.raw.delete(key)
    }
    return root
  }
  if (key === null || key === undefined) {
    const [parent] = _walk(root, p.slice(0, -1))
    if (parent instanceof Leaf || parent === null) return root
    if (parent.kids.has(p[p.length - 1])) {
      parent.kids.delete(p[p.length - 1])
      parent.raw.delete(p[p.length - 1])
    }
    return root
  }
  const [node] = _walk(root, p)
  if (!(node instanceof Leaf) && node !== null && node.kids.has(key)) {
    node.kids.delete(key)
    node.raw.delete(key)
  }
  return root
}

/** 一个键该怎么写：能当标识符就裸写（中文在 JS 里本来就是合法标识符），否则加引号。 */
export function key_raw(k) {
  const s = String(k)
  if (_IDENT.test(s)) return s
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 按路径走到某个节点；走不到（或中途是叶子）返回 null。只读，不改树。 */
export function node_at(root, path) {
  let cur = root
  for (const seg of path) {
    if (cur instanceof Leaf) return null
    cur = cur.kids.get(seg)
    if (cur === undefined) return null
  }
  return cur
}

/**
 * 把 node 里 `旧` 这个键改名成 `新` —— **整棵子树跟着走，顺序不动**。
 *
 * 变量改名 / 对象改名都要落到这里：Zod 里那个字段名就是变量的名字本身。
 * 顺序必须保持 —— `emit` 是按 `kids` 的顺序出字的。
 */
export function rename_key(node, 旧键, 新键) {
  if (node instanceof Leaf) return false
  const a = String(旧键)
  const b = String(新键)
  if (!node.kids.has(a) || a === b) return false
  for (const d of [node.kids, node.raw]) {
    const 新表 = new Map()
    for (const [k, v] of d) 新表.set(k === a ? b : k, v)
    d.clear()
    for (const [k, v] of 新表) d.set(k, v)
  }
  node.raw.set(b, key_raw(b))
  return true
}

/**
 * 让 schema 与 initial_state 对齐。
 *
 * 状态里有的补上（用变量的类型推表达式），状态里没有的删掉 —— **已有的叶子
 * 表达式原样保留**，手写的 .min(1).max(20) 不会被抹掉。
 *
 * @param {Obj|Leaf} root
 * @param {Record<string, unknown>} state initial_state 那棵树
 * @param {Map<string,string>|Record<string,string>} types 按点分路径给类型（键如 "对象.字段"）
 * @param {(s: string) => void} [out]
 */
export function sync(root, state, types, out = null) {
  const say = out ?? (() => {})
  const 类型 = types instanceof Map ? types : new Map(Object.entries(types ?? {}))

  function walk(node, st, path) {
    if (node instanceof Leaf) {
      throw new ZodError(`「${path.join('.') || '(根)'}」在 Zod 里不是纯 z.object({...})，对不齐`)
    }
    const want = st && typeof st === 'object' && !Array.isArray(st) ? st : {}
    for (const k of [...node.kids.keys()]) {
      if (!(k in want)) {
        say(`      · schema 里删掉「${[...path, k].join('.')}」—— 另两处已经没有它了`)
        node.kids.delete(k)
        node.raw.delete(k)
      }
    }
    for (const [k, v] of Object.entries(want)) {
      const 路径键 = [...path, k].join('.')
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        let child = node.kids.get(k)
        if (child === undefined || child instanceof Leaf) {
          if (child !== undefined) {
            say(`      · schema 里「${k}」原来是 ${child.code.slice(0, 24)}，状态里它是个对象，改写成 z.object`)
          }
          child = new Obj()
          node.kids.set(k, child)
          node.raw.set(k, k)
        }
        walk(child, v, [...path, k])
      } else {
        if (!node.kids.has(k)) {
          const expr = expr_for(类型.get(路径键), v)
          node.kids.set(k, new Leaf(expr))
          node.raw.set(k, k)
          say(`      · schema 里补上「${k}: ${expr}」`)
        } else if (node.kids.get(k) instanceof Obj) {
          say(`      · schema 里「${k}」本来是个对象，状态里它是个值，改成 ${expr_for(类型.get(路径键), v)}`)
          node.kids.set(k, new Leaf(expr_for(类型.get(路径键), v)))
        }
      }
    }
  }

  walk(root, state && typeof state === 'object' && !Array.isArray(state) ? state : {}, [])
  return root
}
