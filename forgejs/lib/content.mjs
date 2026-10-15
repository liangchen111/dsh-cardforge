/**
 * forge.content 的 JS 版 —— 内容编辑内核：往卡里加东西、从卡里删东西。
 * ==================================================================
 *
 * 在这之前，工具只能改「**已经存在**」的条目：工作台的编辑器是这样，命令行也只能
 * 改已有的键值。做卡的人真正卡住的，是**第一条**和**删错的那一条** —— 所以这一层
 * 补的就是「增」和「删」。命令行与工作台共用这一份，两边不会各说各话。
 *
 * 三条约定，都是硬的：
 *
 *   1. **改的永远是 spec.yaml**（唯一真相）。改完先在内存里编一遍卡：编不出来就整个
 *      不落盘，绝不留半成品。证明在落盘之前，不在之后。
 *   2. **删和改都留底**（`<工程>/.forge/回收站/`），随时能还原。删一目了然，
 *      改是**无声覆盖** —— 被盖掉的那一版同样值得留，所以 `set_entry` 也进回收站。
 *   3. **变量要一次写全三处**（objects 画面板 / initial_state 初值 / schema_code 校验）。
 *      少一处不报错，只是安静地少一块。所以「加一个变量」这件事由工具一次写完，
 *      不该指望人记着。
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 移植纪律（同 model.mjs / validate.mjs 头上那几条）：**行为照抄，不顺手改**；能逐字节
 * 比的逐字节比。这里到处在拼人话诊断（`"%s"` / `"%d"` / `"、".join(...)`），所以下面养了
 * 一组「Python 语义小工具」（pyStr / 或 / 取 / 切 / pyEq / intPy …）—— 少了它们，报告文本
 * 与落盘内容会在边角上悄悄跑偏，而跑偏了差分也抓不住。
 *
 * ★ 本模块有**两处已知的未覆盖边界**（不是 bug，是兄弟模块还没落地）：
 *
 *   1. `commit()` 里那句 `M.ydump(raw, tmp)`：forgejs 的 `model.mjs` **不写 YAML**
 *      （计划 §二①：新产出默认写 `.spec.json`），`M.ydump()` 现在是抛错。Python 版
 *      这一句是把改过的 spec 写成临时 YAML。**代码照抄一份放这儿**，等 YAML 写出器
 *      落地就自动点亮。`M.yload()`（读）是好的，其余分支不受影响。
 *   2. `restore()` 里两处 `from . import opener as OP`（延迟导入，避循环）：forgejs 的
 *      `opener.mjs` 还没搬 ⇒ 只有走「还原开场白 / 还原卡名」这两条支路时才会撞上，
 *      其余全部照抄可用。调用点与 Python 一致（在 `try` **外面**），所以异常照旧往上冒。
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync,
  readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import * as D from './domain.mjs'
import * as M from './model.mjs'
import * as P from './pack.mjs'
import * as ZOD from './zod.mjs'
import * as SB from './sandbox.mjs'

export const TRASH_DIR = '.forge/回收站'
export const TRASH_MAX = 60           // 回收站最多留几条，超了删最旧的

// 新条目用的模板。键名与卡里的字段一一对应，改这里就是改「新建条目」的默认样子。
// ★ 移植记号：Python 用 OrderedDict，JS 对象对**字符串键**保留插入顺序 ⇒ 直接写字面量。
export const 模板表 = {
  常驻: {
    kind: 'normal', trigger_mode: 'always',
    agent_read_strategy: 'normal', position: 'instructions',
    insert_role: 'system',
  },
  必读: {
    kind: 'normal', trigger_mode: 'agent_tool',
    agent_read_strategy: 'required', insert_role: 'user',
  },
  关键词: {
    kind: 'normal', trigger_mode: 'agent_tool',
    agent_read_strategy: 'keyword', insert_role: 'user',
  },
  选读: {
    kind: 'normal', trigger_mode: 'agent_tool',
    agent_read_strategy: 'normal', insert_role: 'user',
  },
  开场: {
    kind: 'opening', trigger_mode: 'always',
    agent_read_strategy: 'normal', insert_role: 'assistant',
  },
}

// 变量类型 -> 初值的默认样子
export const 默认初值 = { boolean: false, number: 0, string: '', array: [], object: {} }

export const 变量类型表 = ['string', 'number', 'boolean', 'array', 'object']


// 一条新条目的完整默认形状。字段名与值照真实卡抄（骨架里的 skel-world-core）——
// 官方写卡时这些键**一个不落**地写出来，缺键虽然软件也读，但键不全会让后来人
// 分不清「没写」和「写了空」。
export const _条目默认 = {
  icon_id: '', kind: 'normal', group_id: '', content: '',
  opening_messages: [], default_opening_message_id: '',
  agent_selection_hint: '', agent_read_strategy: 'normal',
  dynamic_mode: 'standard', keywords: [], keyword_scan_depth: 1,
  condition_keywords: [], keyword_condition: 'none',
  keyword_use_regex: false, keyword_ignore_case: true,
  keyword_whole_word: false, keyword_recursion_depth: 0,
  trigger_mode: 'always', enabled: true, position: '',
  prompt_position_id: '', insert_role: 'user', order: 1,
  view_order: 0, group_view_order: 0, tree_view_order: 1,
}
// 从卡里现有条目继承的「这张卡的偏好」（不继承身份与正文）
// 注意 agent_selection_hint **不在**这里：它是这一条自己的内容（「什么时候读我」），
// 照抄上一条的会得到一句对不上的话 —— 内容是卡主的，工具不替人编。
export const _继承字段 = ['icon_id', 'keyword_scan_depth',
  'keyword_condition', 'keyword_use_regex', 'keyword_ignore_case',
  'keyword_whole_word', 'keyword_recursion_depth']


export class ContentError extends Error {
  /** 内容编辑的硬错。给用户看的，措辞要能直接照着改。 */
  constructor(message) {
    super(message)
    this.name = 'ContentError'
  }
}


// ------------------------------------------------------------------ Python 语义小工具
// 这组不是「顺手加的抽象」，是逐字节比出来的：Python 的 or / str / 切片 / == / int()
// 与 JS 的 || / String / slice / === / Number 在边角上都不一样，而诊断文案与落盘内容
// 天天踩着这些边角。（与 validate.mjs 头上那一组同源，按本模块用到的再取一份。）

/** Python 的真值：null / False / 0 / "" / [] / {} / NaN 都算假。 */
export function pyTruthy(v) {
  if (v === null || v === undefined || v === false) return false
  if (v === true) return true
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return Boolean(v)
}

/** Python 的 `a or b`。 */
export const 或 = (a, b) => (pyTruthy(a) ? a : b)

/** Python 的 `str(v)`（只用于标量与 id，够用）。 */
export function pyStr(v) {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v)
}

/** Python 的 `s[:n]` —— 按**码点**切，不是按 UTF-16 码元。 */
export const 切 = (s, n) => Array.from(String(s)).slice(0, n).join('')

/** Python 的 `len(s)` —— 按码点数。 */
export const lenPy = (s) => Array.from(String(s)).length

/** Python 的 `d.get(k, 默认)` —— 键在、值是 null 时给 null，不是给默认。 */
export const 取 = (o, k, d) => (o && typeof o === 'object' && k in o ? o[k] : d)

/** Python 的 `dict.setdefault(k, d)` —— 键在就原样返回（哪怕是 None）。 */
export function _setdefault(o, k, d) {
  if (!(k in o)) o[k] = d
  return o[k]
}

/** Python 的 `isinstance(v, dict)`。 */
export const 是字典 = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Python 的 `==`。**不能拿 JS 的 `===` 顶**：`False == ""` 在 Python 里是 False，
 * 在 JS 里 `false === ""` 是 false 但 `false == ""` 是 true —— 而这里天天在比
 * 「值有没有变」，差一点点就会多写一条回收记录 / 少写一条。
 */
export function pyEq(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b
  if (typeof a === 'number' && typeof b === 'number') return a === b
  if (typeof a === 'string' || typeof b === 'string') return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => pyEq(x, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => k in b && pyEq(a[k], b[k]))
  }
  return a === b
}

/** Python 的 `x in 列`（列表用 `==` 逐个比）。 */
export const pyIn = (列, v) => 列.some((x) => pyEq(x, v))

/** Python 的 `int(v)`：数字截断、字符串按十进制解析，别的抛错。 */
export function intPy(v) {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`int() 收不了 ${pyStr(v)}`)
    return Math.trunc(v)
  }
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string') {
    const s = v.trim()
    if (!/^[+-]?\d+$/.test(s)) throw new TypeError(`invalid literal for int() with base 10: ${M.pyRepr(v)}`)
    return Number.parseInt(s, 10)
  }
  throw new TypeError('int() argument must be a string or a number')
}

/** Python 的 `float(s)`（认 inf / inf/nan / 指数，不认十六进制与空串）。 */
function _floatPy(s) {
  const t = String(s).trim()
  if (/^[+-]?(inf|infinity)$/i.test(t)) return /^-/.test(t) ? -Infinity : Infinity
  if (/^[+-]?nan$/i.test(t)) return NaN
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    throw new ValueErrorLike(`could not convert string to float: ${M.pyRepr(s)}`)
  }
  return Number(t)
}

class ValueErrorLike extends Error {}

/**
 * `str(exc)` —— Python 的异常文本就是它的 message，JS 的 `String(err)` 会带上
 * `Error: `，直接塞进诊断文案就对不上了。
 */
export const _错文 = (exc) => (exc && typeof exc === 'object' && 'message' in exc
  ? String(exc.message) : pyStr(exc))

/** `out=print` 的 JS 侧代身：每次调用**加一个换行**（同 Python 的 print）。 */
export const _print = (s = '') => process.stdout.write(String(s) + '\n')

/** `os.path.isfile`。 */
function _是文件(p) {
  try { return statSync(p).isFile() } catch { return false }
}

/** `os.path.isdir`。 */
function _是目录(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}

/** `os.path.splitext(base)[0]` —— 末尾那个带点的后缀才算后缀。 */
function splitext0(p) {
  const b = basename(String(p))
  const i = b.lastIndexOf('.')
  return (i <= 0 || i === b.length - 1) ? b : b.slice(0, i)
}

/** `tempfile.mkstemp(suffix=…, prefix=…, dir=…)` 的 JS 侧代身（建好文件再关掉）。 */
function _mkstemp(dir, prefix, suffix) {
  for (let i = 0; i < 200; i += 1) {
    const p = join(dir, prefix + randomBytes(8).toString('hex') + suffix)
    try {
      closeSync(openSync(p, 'wx'))
      return p
    } catch (exc) {
      if (exc && exc.code === 'EEXIST') continue
      throw exc
    }
  }
  throw new Error('建不出临时文件（重名太多次）')
}

/** `str.isdigit()`（能让 `int()` 认的那一类数字）。 */
const isDigitPy = (s) => typeof s === 'string' && s.length > 0 && /^\p{Nd}+$/u.test(s)


// ------------------------------------------------------------------ 位置
export function project_of(spec) {
  let p = resolve(pyStr(spec))
  if (_是文件(p)) p = dirname(p)
  if (['source', '成品', '文档', 'hud'].includes(basename(p))) p = dirname(p)
  return p
}


export function _prefix(spec) {
  /** 条目 / 正则的 id 前缀。以 hud.conf.json 里那份为准（界面层才是事实来源）。 */
  const conf = join(project_of(spec), 'hud', 'hud.conf.json')
  if (_是文件(conf)) {
    try {
      const p = pyStr(或(取(或(JSON.parse(readFileSync(conf, 'utf8')), {}), 'id_prefix', null), '')).trim()
      if (p) return p
    } catch { /* 认不出就当没写 */ }
  }
  let name = ''
  try {
    name = 或(取(取(或(M.loadStructured(spec), {}), 'character', {}), 'name', null), '')
  } catch {
    name = ''
  }
  return M.asciiPrefix(或(name, splitext0(basename(pyStr(spec)))))
}


// ------------------------------------------------------------------ 读写
const _载入快照 = new Map()          // 绝对路径 -> 读出内容那一刻的指纹


export function _指纹(path) {
  try {
    return createHash('sha1').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}


export function load(spec) {
  /** 读 spec，并**记下它此刻的指纹** —— 落盘之前要比一次（见 commit）。 */
  if (!_是文件(spec)) {
    throw new ContentError(`找不到 spec：${pyStr(spec)}`)
  }
  const p = resolve(pyStr(spec))
  _载入快照.set(p, _指纹(p))
  return 或(M.loadStructured(spec), {})
}


export function commit(spec, raw, out = _print) {
  /**
   * 把改过的 spec 编一遍卡，编得出才覆盖落盘；编不出就一个字不写。
   *
   * 落盘前还比一次**载入时的指纹**：文件若在「读它」到「写它」之间被改过，就拒绝落盘。
   * 直接写上去等于把别人那一次改动**静默吃掉** —— 最容易撞上的是「同一条命令被并发跑了两遍」
   * （两条各自读到同一份旧内容、各自打印「已改…成功」，最后只有一条留在盘上，且没有任何提示）。
   * 宁可让人重跑一遍，也不静默丢一次改动。
   */
  const p = resolve(pyStr(spec))
  const 旧 = _载入快照.get(p)
  const 今 = _指纹(p)
  if (旧 != null && 今 != null && 旧 !== 今) {
    throw new ContentError(
      '这个 spec 在你读它之后被改过了 —— 拒绝覆盖（写上去会把那一次改动**静默吃掉**）。\n' +
      '  多半是同一条命令被并发跑了两遍（各自读到同一份旧内容，后落盘的那份赢）。\n' +
      '  串行重跑一遍就好；想看清楚先 `python forge.py diff` 比一下。')
  }
  let d = dirname(p) || '.'
  if (SB.enabled()) {
    // 沙箱里临时文件**别放进工程目录** —— 那儿删不掉，会留下一地 `.forge-tmp-*`。
    // 反正沙箱模式不走改名，就不需要「同盘才能原子换」这个理由了。
    d = tmpdir()
  }
  const tmp = _mkstemp(d, '.forge-tmp-', '.json')
  try {
    // ★ 移植记号：**这一句是计划 §二① 备案过的唯一差异** —— forgejs 不写 YAML，
    //   新产出一律 JSON（JSON 本身是合法 YAML，PyYAML 读得回来），所以 Python 版那句
    //   `M.ydump(raw, tmp)` 在这里换成 `M.jdump`，临时文件后缀也跟着 `.yaml` → `.json`。
    M.jdump(raw, tmp)
    try {
      P.spec_to_card(tmp)
    } catch (exc) {
      throw new ContentError(`改完之后打不出卡（已放弃，spec 一个字没动）：${_错文(exc)}`)
    }
    SB.land(tmp, spec)
    _载入快照.set(p, _指纹(p))
  } finally {
    SB.cleanup(tmp)
  }
  return spec
}


// ------------------------------------------------------------------ 取表
export function entries_of(raw, must = true) {
  const lib = must ? _setdefault(raw, 'library', {}) : 或(取(raw, 'library', null), {})
  return must ? _setdefault(lib, 'entries', []) : 或(取(lib, 'entries', null), [])
}


export function groups_of(raw, must = true) {
  const lib = must ? _setdefault(raw, 'library', {}) : 或(取(raw, 'library', null), {})
  return must ? _setdefault(lib, 'groups', []) : 或(取(lib, 'groups', null), [])
}


export function _vars(raw, must = false) {
  let v = 取(raw, 'variables', null)
  if (!是字典(v)) {
    if (!must) return null
    v = {}
    raw.variables = v
  }
  return v
}


export function _find(rows, who, fields = ['id', 'name', 'title']) {
  /** 按 id / 名字找一个。完全等于优先，其次「以 -名字 收尾」（模块那种写法）。 */
  const w = pyStr(或(who, '')).trim()
  if (!w) return null
  for (const r of rows) {
    for (const f of fields) {
      if (pyStr(或(取(或(r, {}), f, null), '')).trim() === w) return r
    }
  }
  for (const r of rows) {
    for (const f of fields) {
      if (pyStr(或(取(或(r, {}), f, null), '')).trim().endsWith('-' + w)) return r
    }
  }
  return null
}


export function _max_order(rows) {
  let n = 0
  for (const r of rows) {
    try {
      n = Math.max(n, intPy(或(取(或(r, {}), 'order', null), 0)))
    } catch { /* int() 认不出的就跳过（Python 那边是 except (TypeError, ValueError)） */ }
  }
  return n
}


export function list_groups(spec) {
  const raw = load(spec)
  return groups_of(raw, false).map((g) => ({
    id: 取(g, 'id', null), 名: 或(取(g, 'name', null), ''), 父: 或(取(g, 'parent_id', null), ''),
  }))
}


export function list_entries(spec) {
  const raw = load(spec)
  const gname = new Map(groups_of(raw, false).map((g) => [取(g, 'id', null), 取(g, 'name', null)]))
  const out = []
  for (const e of entries_of(raw, false)) {
    out.push({
      id: 取(e, 'id', null), 标题: 或(取(e, 'title', null), ''),
      分组: 或(gname.get(或(取(e, 'group_id', null), '')), ''),
      顺序: 取(e, 'order', null),
      触发: 或(取(e, 'trigger_mode', null), ''),
      策略: 或(取(e, 'agent_read_strategy', null), ''),
      类型: 或(取(e, 'kind', null), 'normal'),
      启用: pyTruthy(取(e, 'enabled', true)),
      关键词: 或(取(e, 'keywords', null), []),
      字数: lenPy(或(取(e, 'content', null), '')),
    })
  }
  return out
}


export function entry_detail(spec, 谁) {
  /**
   * 一条条目的全貌 —— 给「读一条」用。
   *
   * 工具能改条目（--改）、能列条目（--列），却**读不到单条正文**。而
   * 「先看它现在写了什么，再决定怎么改」恰恰是改一张卡的第一步。缺了它，
   * 想改一段话就得把整份 spec（几十条 × 三十来个字段）整个吞进去找。
   */
  const [raw, e] = find_entry(spec, 谁)
  const gname = new Map(groups_of(raw, false).map((g) => [取(g, 'id', null), 或(取(g, 'name', null), '')]))
  const 正文 = pyStr(或(取(e, 'content', null), ''))
  const d = {
    id: pyStr(或(取(e, 'id', null), '')),
    标题: pyStr(或(取(e, 'title', null), '')),
    分组: 或(gname.get(或(取(e, 'group_id', null), '')), '（未分组）'),
    类型: pyStr(或(取(e, 'kind', null), 'normal')),
    启用: pyTruthy(取(e, 'enabled', true)) ? '是' : '否 —— 卡里留着，但不生效',
    顺序: 取(e, 'order', null),
    触发方式: pyStr(或(取(e, 'trigger_mode', null), '')),
    读取策略: pyStr(或(取(e, 'agent_read_strategy', null), '')),
    动态模式: pyStr(或(取(e, 'dynamic_mode', null), '')),
    内容模式: pyStr(或(取(e, 'content_mode', null), '')),
    关键词: Array.from(或(取(e, 'keywords', null), [])),
    关键词条件: pyStr(或(取(e, 'keyword_condition', null), '')),
    读取提示: pyStr(或(取(e, 'agent_selection_hint', null), '')),
    插入位置: pyStr(或(取(e, 'position', null), '')),
    插入角色: pyStr(或(取(e, 'insert_role', null), '')),
    图标: pyStr(或(取(e, 'icon_id', null), '')),
    字数: lenPy(正文),
    正文: 正文,
  }
  if (pyStr(或(取(e, 'kind', null), '')) === 'opening') {
    d.开场白方案 = (或(取(e, 'opening_messages', null), [])).map((m) => ({
      id: pyStr(或(取(m, 'id', null), '')), 标题: pyStr(或(取(m, 'title', null), '')),
      字数: lenPy(或(取(m, 'content', null), '')),
    }))
    d.默认方案 = pyStr(或(取(e, 'default_opening_message_id', null), ''))
  }
  return d
}


// ------------------------------------------------------------------ 回收站
export function trash_dir(spec) {
  return join(project_of(spec), TRASH_DIR)
}


export function put_trash(spec, 种类, 说明, 项) {
  const d = trash_dir(spec)
  mkdirSync(d, { recursive: true })
  const rec = {
    时间: M.nowIso(),
    种类: 种类,
    说明: 说明,
    项: 项,
  }
  // 文件名就是**顺序**：回收站按名字倒排给用户看。所以时间戳要一路到微秒 ——
  // 精确到秒的话，同一秒里删两样东西，谁先谁后就变成随机的了。
  const stamp = 切(M.nowIso(), 26).replace(/:/g, '')       // 2026-10-08T153456.158674
  const name = `${stamp}-${切(M.uuid4hex(), 4)}.json`
  const path = join(d, name)
  writeFileSync(path, JSON.stringify(rec, null, 2) + '\n', 'utf8')
  _trim_trash(d)
  return path
}


export function _trim_trash(d) {
  /**
   * 超出上限就把最老的几条**作废**。
   *
   * 注意上限数的是「还认得的记录」，墓碑不计 —— 否则沙箱里一堆墓碑会把名额占满。
   */
  const files = readdirSync(d).filter((f) => f.endsWith('.json'))
  files.sort(比串)
  const 活 = []
  for (const f of files) {
    const p = join(d, f)
    let rec
    try {
      rec = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      continue
    }
    if (!SB.is_tombstone(rec)) 活.push(p)
  }
  for (const p of 活.slice(0, 活.length - TRASH_MAX)) SB.retire(p)
}


/** Python 的字符串排序按码点；JS 的 `<` 按 UTF-16 码元，星平面字符会排错。 */
export function 比串(a, b) {
  const A = Array.from(String(a), (c) => c.codePointAt(0))
  const B = Array.from(String(b), (c) => c.codePointAt(0))
  const n = Math.min(A.length, B.length)
  for (let i = 0; i < n; i += 1) if (A[i] !== B[i]) return A[i] - B[i]
  return A.length - B.length
}


export function trash_note(out) {
  out('  · 这一份在回收站里，能还原（python forge.py trash --还原 1）')
}


export function list_trash(spec) {
  const d = trash_dir(spec)
  if (!_是目录(d)) {
    return []
  }
  const out = []
  const files = readdirSync(d)
  files.sort(比串)
  files.reverse()
  for (const f of files) {
    if (!f.endsWith('.json')) {
      continue
    }
    const p = join(d, f)
    let rec
    try {
      rec = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      continue
    }
    if (SB.is_tombstone(rec)) {
      continue          // 沙箱里「删掉」的记录写成了墓碑 —— 语义上它已经不在
    }
    rec._文件 = f
    rec._路径 = p
    out.push(rec)
  }
  return out
}


export const _表中文 = {
  entries: '条目', groups: '分组', objects: '变量对象',
  variables: '变量', regex: '正则',
}

export const _表名 = {
  entries: ['library', 'entries'],
  groups: ['library', 'groups'],
  objects: ['variables', 'objects'],
  variables: ['variables', 'variables'],
  regex: [null, 'regex_rules'],
  initial_state: ['variables', 'initial_state'],
  schema: ['variables', 'schema_code'],
}


export function _table(raw, name, must = false) {
  const [a, b] = _表名[name]
  let cur = raw
  if (a) {
    if (!是字典(取(cur, a, null))) {
      if (!must) {
        return null
      }
      cur[a] = {}
    }
    cur = cur[a]
  }
  if (must) {
    // ★ 移植记号：Python 是 OrderedDict()，不是 None
    _setdefault(cur, b, ['entries', 'groups', 'objects', 'variables', 'regex'].includes(name)
      ? [] : {})
  }
  return 取(cur, b, null)
}


/** `_表中文.get(t, t)`。 */
const _中文表 = (t) => (t in _表中文 ? _表中文[t] : t)


export function restore(spec, which, out = _print) {
  /** 按回收站里的记录原样放回去。which = 序号（1 = 最近一条）或记录文件名。 */
  const recs = list_trash(spec)
  if (!recs.length) {
    throw new ContentError('回收站是空的。')
  }
  let rec = null
  const s = pyStr(或(which, '')).trim()
  if (isDigitPy(s)) {
    const i = intPy(s) - 1
    if (!(0 <= i && i < recs.length)) {
      throw new ContentError(`回收站里只有 ${recs.length} 条记录。`)
    }
    rec = recs[i]
  } else {
    for (const r of recs) {
      if (r._文件 === s || r._文件.startsWith(s)) {
        rec = r
        break
      }
    }
  }
  if (rec === null) {
    throw new ContentError(`回收站里没有这一条：${s}`)
  }

  const raw = load(spec)
  const 放回 = []
  const 跳过 = []
  // 开场白这类项不能边循环边做：它动的是 conf 与 spec **两个文件**，
  // 而循环末尾会拿这里读到的 raw 快照整份覆盖 spec —— 会把它吃掉。
  // 所以先收着，等 commit 落完盘再动手。
  const 开场白项 = []
  const 卡名项 = []
  for (const item of (或(取(rec, '项', null), []))) {
    const t = 取(item, '表', null)
    const data = 取(item, '数据', null)
    if (t === 'initial_state') {
      const 父 = _setdefault(_setdefault(raw, 'variables', {}), 'initial_state', {})
      let cur = 父
      const 路径 = 或(取(item, '路径', null), [])
      for (const seg of 路径.slice(0, -1)) {
        cur = _setdefault(cur, seg, {})
      }
      const k = 路径[路径.length - 1]
      if (k in cur) {
        跳过.push(`初值「${路径.join('.')}」（已经有了）`)
      } else {
        cur[k] = data
        放回.push(`初值「${路径.join('.')}」`)
      }
      continue
    }
    if (t === 'regroup') {
      // 删分组时被挪到「未分组」的那些条目：还原时认回来
      let n = 0
      for (const e of entries_of(raw, false)) {
        if (pyStr(取(e, 'id', null)) in 或(data, {}) && !pyStr(或(取(e, 'group_id', null), ''))) {
          e.group_id = 或(data, {})[pyStr(取(e, 'id', null))]
          e.updated_at = M.nowIso()
          n += 1
        }
      }
      if (n) {
        放回.push(`${n} 条条目归回原组`)
      }
      continue
    }
    if (t === '挪变量') {
      // 变量换对象：反向挪回去 —— 挂靠关系、初值那格、Zod 那个字段、顺序，逐一还原。
      // 跟「改名」一样，三处各自独立还原：当时哪一处没跟着改，这里也不凭空编。
      const v = _setdefault(raw, 'variables', {})
      const 键 = pyStr(或(取(item, '键', null), ''))
      const 目标 = _find(或(取(v, 'variables', null), []), 取(item, '变量id', null), ['id'])
      if (目标 === null) {
        跳过.push(`变量「${键}」（已经不在卡里）`)
      } else {
        目标.object_id = 取(item, '旧对象id', null)
        if (取(item, '旧顺序', null) !== null && 取(item, '旧顺序', null) !== undefined) {
          目标.order = 取(item, '旧顺序', null)
        }
        if (取(item, '旧视图序', null) !== null && 取(item, '旧视图序', null) !== undefined) {
          目标.tree_view_order = 取(item, '旧视图序', null)
        }
        目标.updated_at = M.nowIso()
        放回.push(`变量挂回「${取(item, '旧对象', null)}」下`)
      }
      if (_搬格子(或(取(v, 'initial_state', null), {}), 取(item, '新状态路径', null),
        取(item, '旧状态路径', null))) {
        放回.push(`初值那一格搬回「${(Array.from(或(取(item, '旧状态路径', null), []))).join('.')}」`)
      }
      const p从 = 取(item, '新Zod路径', null)
      const p到 = 取(item, '旧Zod路径', null)
      if (pyTruthy(p从) && pyTruthy(p到)) {
        try {
          const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
          const n从 = ZOD.node_at(root, Array.from(p从).slice(0, -1))
          if (n从 instanceof ZOD.Obj && n从.kids.has(pyStr(p从[p从.length - 1]))) {
            const 表达式 = n从.kids.get(pyStr(p从[p从.length - 1])).code
            ZOD.drop(root, Array.from(p从).slice(0, -1), pyStr(p从[p从.length - 1]))
            ZOD.set_leaf(root, Array.from(p到).slice(0, -1), pyStr(p到[p到.length - 1]), 表达式)
            v.schema_code = ZOD.emit(root)
            放回.push(`Zod 字段搬回「${Array.from(p到).join('.')}」`)
          } else {
            跳过.push('Zod 字段（在新位置没找着）')
          }
        } catch (exc) {
          if (!(exc instanceof ZOD.ZodError)) throw exc
          跳过.push(`Zod 字段（${_错文(exc)}）`)
        }
      }
      continue
    }
    if (t === '改名') {
      // 变量 / 变量对象改名：反向挪回去（键名换回来，位置本来就没动）。
      // 三处各自独立还原 —— 哪一处当时没跟着改（比如 Zod 认不出），
      // 这里也不会凭空去编一个。
      const v = _setdefault(raw, 'variables', {})
      const 种类 = pyStr(或(取(item, '种类', null), '变量'))
      const 旧名 = pyStr(或(取(item, '旧', null), ''))
      const 新名 = pyStr(或(取(item, '新', null), ''))
      if (种类 === '变量') {
        const 目标 = _find(或(取(v, 'variables', null), []), 取(item, '变量id', null), ['id'])
        if (目标 === null) {
          跳过.push(`变量「${新名}」（已经不在卡里）`)
        } else {
          目标.title = 旧名
          目标.updated_at = M.nowIso()
          放回.push(`变量名 →「${旧名}」`)
        }
      } else {
        const 目标 = _find(或(取(v, 'objects', null), []), 取(item, '对象id', null), ['id'])
        if (目标 === null) {
          跳过.push(`变量对象「${新名}」（已经不在卡里）`)
        } else {
          目标.name = 旧名
          目标.updated_at = M.nowIso()
          放回.push(`对象名 →「${旧名}」`)
        }
      }
      let p = 取(item, '状态路径', null)
      if (pyTruthy(p)) {
        const [cur, ok] = _走状态(或(取(v, 'initial_state', null), {}), Array.from(p).slice(0, -1))
        if (ok && 是字典(cur) && _改键序(cur, pyStr(p[p.length - 1]), 旧名)) {
          放回.push(`初值那一格 →「${旧名}」`)
        } else {
          跳过.push('初值那一格（路径对不上了）')
        }
      }
      p = 取(item, 'Zod路径', null)
      if (pyTruthy(p)) {
        try {
          const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
          const node = ZOD.node_at(root, Array.from(p).slice(0, -1))
          if (node instanceof ZOD.Obj && ZOD.rename_key(node, pyStr(p[p.length - 1]), 旧名)) {
            v.schema_code = ZOD.emit(root)
            放回.push(`Zod 字段名 →「${旧名}」`)
          }
        } catch (exc) {
          if (!(exc instanceof ZOD.ZodError)) throw exc
          跳过.push(`Zod 字段名（${_错文(exc)}）`)
        }
      }
      continue
    }
    if (t === '挪组') {
      // 批量挪组留下的旧组：**无条件**挪回去（跟上面那条不一样 —— 上面那条是
      // 只在「现在没组」时才认领，因为那是删分组甩出来的）。
      let n = 0
      for (const e of entries_of(raw, false)) {
        if (!(pyStr(取(e, 'id', null)) in 或(data, {}))) {
          continue
        }
        e.group_id = 或(data, {})[pyStr(取(e, 'id', null))]
        e.updated_at = M.nowIso()
        n += 1
      }
      if (n) {
        放回.push(`${n} 条条目归回原组`)
      } else {
        跳过.push('原来的那些条目（已经不在卡里）')
      }
      continue
    }
    if (t === 'schema') {
      const v = _setdefault(raw, 'variables', {})
      try {
        const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
        const 路径 = 或(取(item, '路径', null), [])
        ZOD.set_leaf(root, Array.from(路径).slice(0, -1), 路径[路径.length - 1], data)
        v.schema_code = ZOD.emit(root)
        放回.push(`Zod 字段「${Array.from(路径).join('.')}」`)
      } catch (exc) {
        if (!(exc instanceof ZOD.ZodError)) throw exc
        跳过.push(`Zod 字段「${Array.from(或(取(item, '路径', null), [])).join('.')}」（${_错文(exc)}）`)
      }
      continue
    }
    if (t === '开场白') {
      // 开场白住在 hud/hud.conf.json（spec 里那条只是派生物）—— 得请 opener 动手，
      // 它才知道末尾那三个零宽标记该怎么补。推到 commit 之后再执行，见上面。
      开场白项.push(item)
      continue
    }
    if (t === '卡名') {
      // 卡名也跨两个文件：spec 的 character.name 是真相，conf 的「卡名」给界面用。
      // spec 这一段跟批走（commit 落盘），conf 那一段推到 commit 之后（见 卡名项）。
      const 壳 = _setdefault(raw, 'character', {})
      const 旧名 = pyStr(或(取(或(data, {}), 'name', null), ''))
      壳.name = 旧名
      卡名项.push(item)
      放回.push(`卡名 →「${或(旧名, '（空）')}」`)
      continue
    }
    if (t === 'fields') {
      // 改条目时留下的旧值：还原时把字段写回去。
      // 「改」比「删」更隐蔽地丢数据 —— 删了你至少知道没了，改是无声覆盖。
      const 目标 = _find(entries_of(raw, false), pyStr(或(取(item, '谁', null), '')), ['id'])
      if (目标 === null) {
        跳过.push(`条目「${取(item, '谁', null)}」已经不在，旧值无处可放`)
        continue
      }
      const d = 或(data, {})
      let n = 0
      for (const [k, v] of Object.entries(或(取(d, '旧', null), {}))) {
        目标[k] = v
        n += 1
      }
      for (const k of (或(取(d, '本就无', null), []))) {
        delete 目标[k]
        n += 1
      }
      目标.updated_at = M.nowIso()
      放回.push(`条目「${或(取(目标, 'title', null), 取(item, '谁', null))}」的 ${n} 个字段改回旧值`)
      continue
    }

    const rows = _table(raw, t, true)
    if (!Array.isArray(rows)) {
      continue
    }
    const dd = 或(data, {})
    const key = pyStr(或(或(取(dd, 'id', null), 取(dd, 'name', null)), ''))
    if (key && _find(rows, key, ['id', 'name', 'title'])) {
      跳过.push(`${_中文表(t)}「${key}」（已经有了，没覆盖）`)
      continue
    }
    const pos = 取(item, '位置', null)
    if (typeof pos === 'number' && Number.isInteger(pos) && 0 <= pos && pos <= rows.length) {
      rows.splice(pos, 0, data)
    } else {
      rows.push(data)
    }
    放回.push(`${_中文表(t)}「${或(或(取(dd, 'title', null), 取(dd, 'name', null)), 或(key, '?'))}」`)
  }

  if (!放回.length && !开场白项.length) {
    throw new ContentError(`这一条没有能放回去的东西。${跳过.length ? `（${跳过.join('；')}）` : ''}`)
  }
  commit(spec, raw, out)

  for (const item of 开场白项) {
    // 到这儿 spec 已经落完盘 —— 再动 conf，它写完会顺手把 spec 里那条也灌成一致
    const OP = _OP()
    try {
      // ★ 移植记号：Python 写的是 `out=lambda *a, **k: None`（关键字传参）；
      // opener 的签名是 `改正文(target, 新文, 写回=True, out=print)` ⇒ 这里按位置传。
      OP.改正文(project_of(spec), pyStr(或(取(或(取(item, '数据', null), {}), '正文', null), '')),
        true, () => undefined)
      放回.push('开场白正文（改回改之前那一版）')
    } catch (exc) {
      跳过.push(`开场白（${_错文(exc)}）`)
    }
  }

  for (const item of 卡名项) {
    // spec 那一段已落盘；界面配置里那份也改回来，免得两处又对不上
    const OP = _OP()
    const p = join(project_of(spec), 'hud', 'hud.conf.json')
    if (_是文件(p)) {
      try {
        const conf = 或(OP._读json(p), {})
        conf['卡名'] = pyStr(或(取(或(取(item, '数据', null), {}), 'name', null), ''))
        OP._写json(p, conf)
      } catch (exc) {
        跳过.push(`界面配置里的卡名（${_错文(exc)}）`)
      }
    }
  }

  // 这条记录已经用掉了 —— 正常删掉，沙箱里写成墓碑（列表会跳过）
  SB.retire(rec._路径)
  return { 放回: 放回, 跳过: 跳过, 说明: 或(取(rec, '说明', null), '') }
}


/**
 * ★ 移植记号：Python 在 `restore()` 里两处 `from . import opener as OP`
 * （延迟导入以避开循环引用）。forgejs 的 `opener.mjs` 还没搬 ⇒ 只有走
 * 「还原开场白 / 还原卡名」这两条支路时才会撞上；其余全部照抄可用。
 * 调用点与 Python 一致（在 `try` **外面**），所以异常照旧往上冒。
 */
function _OP() {
  throw new Error('forgejs 还没搬 opener.mjs —— 这一支（开场白 / 卡名的跨文件还原）暂时走不了。')
}


export function clear_trash(spec) {
  const d = trash_dir(spec)
  let n = 0
  if (_是目录(d)) {
    for (const f of list_trash(spec)) {
      if (SB.retire(f._路径)) {
        n += 1
      }
    }
  }
  return n
}


// ------------------------------------------------------------------ 条目
export function add_entry(spec, 标题, 分组 = '', 模板 = '常驻', 正文 = '', 关键词 = null,
  位置 = null, 提示 = null, out = _print) {
  const raw = load(spec)
  const rows = entries_of(raw, true)
  const 名 = pyStr(或(标题, '')).trim()
  if (!名) {
    throw new ContentError('标题不能空。')
  }
  模板 = pyStr(或(模板, '常驻')).trim()
  if (!(模板 in 模板表)) {
    throw new ContentError(`没有这个模板：${模板}（有 ${Object.keys(模板表).join(' / ')}）`)
  }

  let 分组id = ''
  if (pyStr(或(分组, '')).trim()) {
    const g = _find(groups_of(raw, false), 分组, ['id', 'name'])
    if (g === null) {
      throw new ContentError(`这张卡里没有分组「${分组}」。先建：python forge.py group ${spec} --新 ${分组}`)
    }
    分组id = 或(取(g, 'id', null), '')
  }

  // 继承「这张卡的偏好」，不继承身份与正文。
  // 找一个**真实写过的值**：先看同一档（触发方式相同）的条目，再看其它条目。
  // 不拿「第一条条目」的字段照抄 —— 那条多半这一格是空的，照抄等于把
  // 「没人写过」当成一种写法（新条目就会带着空 agent_selection_hint 出生，AI 读不到它）。
  const 形 = 模板表[模板]
  const 同档 = rows.filter((e) => 或(取(e, 'trigger_mode', null), '') === 取(形, 'trigger_mode', null))

  const _偏好 = (k) => {
    for (const 池 of [同档, rows]) {
      for (const e of 池) {
        if (!pyIn([null, '', [], {}], 取(e, k, null))) {
          return e[k]
        }
      }
    }
    return null
  }

  const nw = { ..._条目默认 }
  for (const k of _继承字段) {
    const v = _偏好(k)
    if (v !== null && v !== undefined) {
      nw[k] = v
    }
  }
  nw.id = `${_prefix(spec)}-entry-${切(M.uuid4hex(), 8)}`
  nw.title = 名
  nw.group_id = 分组id
  nw.content = pyStr(或(正文, ''))
  nw.keywords = (或(关键词, [])).map((x) => pyStr(x).trim()).filter((x) => pyStr(x).trim())
  Object.assign(nw, 形)
  if (位置 !== null && 位置 !== undefined) {
    nw.position = pyStr(位置)
  }
  if (pyTruthy(提示)) {  // 空串当作没给 —— 新建时没有「清空」的意义，空着就留继承来的那份
    nw.agent_selection_hint = pyStr(提示)
  }
  if (模板 === '关键词' && !nw.keywords.length) {
    throw new ContentError('模板「关键词」要有关键词，否则这条永远不触发。' +
      '加一个：--关键词 判定,掷骰')
  }
  const prev = _max_order(rows) + 1
  nw.order = prev
  nw.view_order = 0
  nw.group_view_order = 0
  nw.tree_view_order = prev
  nw.created_at = M.nowIso()
  nw.updated_at = nw.created_at
  rows.push(M.ordered(nw, M.ENTRY_KEYS))
  commit(spec, raw, out)

  out(`已加条目「${名}」`)
  out(`  id      ${nw.id}`)
  out(`  模板    ${模板}（触发 ${nw.trigger_mode} · 策略 ${nw.agent_read_strategy} · 角色 ${nw.insert_role}）`)
  out(`  分组    ${或(分组, '（未分组）')}`)
  out(`  位置    ${或(取(nw, 'position', null), '（不占提示词位 —— 关键词命中或 AI 选读时才插入）')}`)
  for (const w of _entry_worry(nw)) {
    out(`  ⚠ ${w}`)
  }
  return nw
}


export function _entry_worry(e) {
  /** 新条目上最该提醒的两件事 —— 不拦，只是说。 */
  const out = []
  // 开场白条目**本来就不填 position**：它由平台当「开卡第一屏」单独处理，
  // 不走常驻条目那条注入链。骨架、演示卡、艾瑟兰（真在跑的卡）三条都是这么写的。
  // `validate` 一直是这么判的（kind=opening 直接 continue 掉位置这一条）；
  // 这里以前没跟上，于是同一条条目「--改 报缺位置、check 说没问题」——两个口径。
  if (pyStr(或(取(e, 'kind', null), '')) !== 'opening'
    && 取(e, 'trigger_mode', null) === 'always'
    && !pyStr(或(取(e, 'position', null), '')).trim()) {
    out.push('常驻条目必须填 position，否则平台放不进去 —— 用 entry --改 "标题" --位置 instructions 补。')
  }
  if (取(e, 'agent_read_strategy', null) === 'keyword' && !(取(e, 'keywords', null) || []).length) {
    out.push('策略是 keyword 但没有关键词，这条永远不触发。')
  }
  if (取(e, 'trigger_mode', null) === 'agent_tool'
    && !pyStr(或(取(e, 'agent_selection_hint', null), '')).trim()) {
    out.push('这条由 AI 读取，却没写 agent_selection_hint（什么时候读我）——' +
      'AI 只在目录里看到路径、标题、策略、读取提示这四项，' +
      "缺这一项它就不知道何时该读。用 entry --改 \"标题\" --提示 '什么时候读我' 补。")
  }
  if (!pyStr(或(取(e, 'content', null), '')).trim()) {
    out.push('正文还是空的 —— 现在是条占位，别就这么出卡。')
  }
  return out
}


export function find_entry(spec, eid) {
  const raw = load(spec)
  const e = _find(entries_of(raw, false), eid, ['id', 'title'])
  if (e === null) {
    throw new ContentError(`这张卡里没有条目 ${eid}。列出来看：python forge.py entry ${spec} --列`)
  }
  return [raw, e]
}


// 条目上允许「改」的字段。改的是内容与偏好；id / order / kind 是身份与排序，
// 换身份请复制一条再删旧的（沿用同一个 id 会让卡里引用它的地方指向改了意思的那条）。
export const 可改字段 = ['title', 'content', 'keywords', 'trigger_mode', 'agent_read_strategy',
  'agent_selection_hint', 'position', 'insert_role', 'content_mode',
  'keyword_condition', 'dynamic_mode', 'icon_id', 'enabled']

// 「改成 None」等于清空的纯文本字段
export const _文本字段 = ['content', 'agent_selection_hint', 'position', 'insert_role']

export const _字段中文 = {
  title: '标题', content: '正文', keywords: '关键词',
  trigger_mode: '触发方式', agent_read_strategy: '读取策略',
  agent_selection_hint: '读取提示', position: '插入位置',
  insert_role: '插入角色', content_mode: '内容模式',
  keyword_condition: '关键词条件', dynamic_mode: '动态模式',
  icon_id: '图标', enabled: '启用',
}

/** `_字段中文.get(k, k)`。 */
const _中文名 = (k) => (k in _字段中文 ? _字段中文[k] : k)


export function _切词(s) {
  return pyStr(或(s, '')).split(/[,，、;；\s]+/).filter((x) => Boolean(x))
}


export function _规整字段值(k, v) {
  /**
   * 把一个待写入字段的值规整成卡里该有的形状。
   *
   * `set_entry`（改一条）与 `set_entries_fields`（一次改一批）共用这一份 ——
   * 两边各写一遍，迟早会有一边漏掉「标题不许空」这类规矩。
   */
  if (k === 'keywords') {
    if (typeof v === 'string') {
      v = _切词(v)
    }
    return (或(v, [])).map((x) => pyStr(x).trim()).filter((x) => pyStr(x).trim())
  }
  if (k === 'title') {
    v = pyStr(或(v, '')).trim()
    if (!v) {
      throw new ContentError('标题不能改成空的。不要这条就删掉它（--删）。')
    }
    return v
  }
  if (_文本字段.includes(k)) {
    return (v === null || v === undefined) ? '' : pyStr(v)
  }
  if (typeof v === 'string') {
    return v.trim()
  }
  return v
}


export function _域错(e) {
  /**
   * 这条条目身上「会被平台静默吃掉」的错（只看 error 级）。
   *
   * 用来做**前后对比**：只拦「因为这次改动而新出现的」错，不翻旧账 ——
   * 否则一条本来就带小毛病的条目会永远改不动，而那条毛病又不是这次改出来的。
   */
  try {
    // Issue.level 是 "ERROR" / "WARN" / "INFO"（大写）—— 这里比错过一次，
    // 结果集永远是空的，「值域拦截」四个字形同虚设。
    // 返回 code -> 人话：拦下时要打人话，只甩一个 DOMAIN-LEGACY 没人看得懂。
    const out = {}
    for (const i of D.checkEntryDomains(e, '')) {
      if (pyStr(i.level).toUpperCase() === 'ERROR') out[i.code] = i.message
    }
    return out
  } catch {
    return {}
  }
}


export function set_entry(spec, eid, 字段 = null, out = _print) {
  /**
   * 改一条已有条目的字段（改内容，不改身份）。
   *
   * 在这之前，「改一条已经存在的条目」只有「删了重建」一条路 —— 那会把 id、
   * 顺序号、分组位置全换掉，卡里引用旧 id 的地方就断了。而真正天天要改的恰恰
   * 是正文：先落一个占位、想清楚了再填。
   *
   * 值域字段（触发方式 / 读取策略 / 内容模式 …）改完当场比一遍，**只拦这次
   * 改动新引入的静默降级**；拦下就整个不落盘，旧值一个字节都没动。
   */
  const [raw, e] = find_entry(spec, eid)
  const 列 = { ...(或(字段, {})) }
  if (pyStr(或(取(e, 'kind', null), '')) === 'opening' && 'content' in 列) {
    throw new ContentError(
      '这条是开场白（kind=opening），正文不走 `--改`：\n' +
      '  · 有界面层的工程里，它的真源是 hud/hud.conf.json，改 spec 里这条是**改了白改**；\n' +
      '  · 它的正文末尾挂着三个零宽标记（建卡界面的触发开关），`--改` 会把标记一起抹掉 ——\n' +
      '    而且一个字都不报，导进 ElecKoi 才发现建卡界面没出来。\n' +
      '  用这个： python forge.py opener <工程 或 spec> --正文@新正文.txt\n' +
      '  （标记补齐、方案正文同步、写回都归它管。标题 / 关键词这些非正文字段，--改 照旧能用。）')
  }
  if (!Object.keys(列).length) {
    throw new ContentError(
      '没说改什么。用法：\n' +
      '  python forge.py entry <spec> --改 "条目标题" --正文 "…" [--标题 "…"]\n' +
      '        [--关键词 a,b] [--提示 "什么时候读我"] [--模板 常驻|必读|关键词|选读]\n' +
      `  能改的字段：${可改字段.join('、')}`)
  }
  const 无名 = Object.keys(列).filter((k) => !可改字段.includes(k))
  if (无名.length) {
    throw new ContentError(
      `这些字段不给改：${无名.join('、')}\n  能改的：${可改字段.join('、')}\n` +
      '  id / order / kind 是身份与排序 —— 要换身份就复制一条再删旧的。')
  }

  const 前 = _域错(e)
  const 改 = {}
  const 旧 = {}
  const 本就无 = []
  for (const [k, v0] of Object.entries(列)) {
    const v = _规整字段值(k, v0)

    if (!(k in e)) {
      本就无.push(k)
    } else if (pyEq(取(e, k, null), v)) {
      continue
    } else {
      旧[k] = M.plain(取(e, k, null))
    }
    e[k] = v
    改[k] = v
  }

  if (!Object.keys(改).length) {
    out('一个字段都没变（值跟现在一样）。')
    return {}
  }

  const 后 = _域错(e)
  const 新错 = Object.entries(后).filter(([c]) => !(c in 前)).map(([, m]) => m)
  if (新错.length) {
    for (const [k, v] of Object.entries(旧)) {
      e[k] = v
    }
    for (const k of 本就无) {
      delete e[k]
    }
    throw new ContentError(
      '这么改会被平台静默吃掉，一个字没落盘：\n' +
      `${新错.map((m) => '  · ' + m).join('\n')}\n` +
      '  看真值域表：python forge.py domains')
  }

  e.updated_at = M.nowIso()
  put_trash(spec, '条目字段', `改了条目「${或(取(e, 'title', null), 取(e, 'id', null))}」的 ${Object.keys(改).map(_中文名).join('、')}`,
    [{ 表: 'fields', 谁: 取(e, 'id', null),
      数据: { 旧: 旧, 本就无: 本就无 } }])
  commit(spec, raw, out)

  out(`已改条目「${或(取(e, 'title', null), 取(e, 'id', null))}」`)
  out(`  ${Object.keys(改).map(_中文名).join('、')}`)
  for (const w of _entry_worry(e)) {
    out(`  ⚠ ${w}`)
  }
  trash_note(out)
  return { id: 取(e, 'id', null), 改了: Object.keys(改) }
}


export function del_entry(spec, eid, out = _print) {
  const [raw, e] = find_entry(spec, eid)
  const rows = entries_of(raw)
  const i = rows.indexOf(e)
  put_trash(spec, '条目', `删了条目「${或(取(e, 'title', null), 取(e, 'id', null))}」`,
    [{ 表: 'entries', 位置: i,
      数据: M.plain(e) }])
  rows.splice(i, 1)
  commit(spec, raw, out)
  out(`已删条目「${或(取(e, 'title', null), '')}」（${lenPy(或(取(e, 'content', null), ''))} 字）`)
  trash_note(out)
  return { id: 取(e, 'id', null), 标题: 或(取(e, 'title', null), '') }
}


// ---------------------------------------------------------- 批量（条目）
export function _认多条(raw, 谁列表, 表 = '条目') {
  /**
   * 一次认出多条 —— 有认不出的就整批停下，**绝不半个批次落盘**。
   *
   * 「一部分成功」是最难收拾的状态：你以为挪了 10 条，其实进了 6 条，还得自己
   * 去数哪 6 条。所以这里宁可整批不做。
   */
  const rows = entries_of(raw, false)
  const 找 = []
  const 缺 = []
  for (const 谁 of (或(谁列表, []))) {
    const e = _find(rows, 谁, ['id', 'title'])
    if (e === null) {
      缺.push(pyStr(谁))
    } else if (!pyIn(找, e)) {
      找.push(e)
    }
  }
  if (缺.length) {
    throw new ContentError(`没有这些${表}：${缺.join('、')}\n  一条都没动。看看 id / 标题：` +
      'python forge.py entry <spec> --列')
  }
  if (!找.length) {
    throw new ContentError(`没给要动哪些${表}。`)
  }
  return 找
}


export function move_entries(spec, 谁列表, 分组, out = _print) {
  /** 批量挪组 —— 一次落盘、一条回收记录（不是 N 条）。 */
  const raw = load(spec)
  const 找 = _认多条(raw, 谁列表)
  let gid = ''
  if (pyStr(或(分组, '')).trim()) {
    const g = _find(groups_of(raw, false), 分组, ['id', 'name'])
    if (g === null) {
      throw new ContentError(`没有分组「${分组}」。建它：python forge.py group <spec> --新 ${分组}`)
    }
    gid = 或(取(g, 'id', null), '')
  }
  const 旧 = {}
  for (const e of 找) {
    if (pyStr(或(取(e, 'group_id', null), '')) !== gid) {
      旧[pyStr(取(e, 'id', null))] = 或(取(e, 'group_id', null), '')
    }
    e.group_id = gid
    e.updated_at = M.nowIso()
  }
  if (Object.keys(旧).length) {
    // 跟「删分组时把条目甩到未分组」用的不是同一种记录：那种只在条目**现在没组**
    // 时才认领，这里要能无条件挪回去，否则批量挪组撤不回来。
    put_trash(spec, '条目', `${找.length} 条挪到「${或(分组, '未分组')}」`,
      [{ 表: '挪组', 数据: 旧 }])
  }
  commit(spec, raw, out)
  out(`已把 ${找.length} 条挪到 ${或(分组, '（未分组）')}`)
  for (const e of 找) {
    out(`  · ${或(取(e, 'title', null), 取(e, 'id', null))}`)
  }
  if (Object.keys(旧).length) {
    trash_note(out)
  } else {
    out(`（这 ${找.length} 条本来就在那儿）`)
  }
  return 找
}


export function set_entries_enabled(spec, 谁列表, 启用, out = _print) {
  /** 批量启用 / 停用。停用的条目**留在卡里但不生效**（从酒馆收来的卡常见）。 */
  const raw = load(spec)
  const 找 = _认多条(raw, 谁列表)
  const 项 = []
  for (const e of 找) {
    const 老 = pyTruthy(取(e, 'enabled', true))
    if (老 !== pyTruthy(启用)) {
      项.push({ 表: 'fields', 谁: 取(e, 'id', null),
        数据: { 旧: { enabled: 老 }, 本就无: [] } })
    }
    e.enabled = pyTruthy(启用)
    e.updated_at = M.nowIso()
  }
  if (项.length) {
    put_trash(spec, '条目字段', `${项.length} 条${启用 ? '启用' : '停用'}`, 项)
  }
  commit(spec, raw, out)
  out(`已${启用 ? '启用' : '停用'} ${找.length} 条`)
  for (const e of 找) {
    out(`  · ${或(取(e, 'title', null), 取(e, 'id', null))}`)
  }
  if (项.length) {
    trash_note(out)
  }
  return 找
}


export function set_entries_fields(spec, 谁列表, 字段, out = _print) {
  /**
   * 给一批条目同时改同一组字段 —— 与 set_entry 同一套规整与值域拦截。
   *
   * 值域按**批次**判定：只要有一条改了会被平台静默吃掉，整批一个字都不落盘。
   * 宁可整批不做，也不做「一半成功」—— 你以为改了 10 条、其实成了 6 条，
   * 还得自己回去数哪 6 条，那才是最难收拾的状态。
   */
  const raw = load(spec)
  const 找 = _认多条(raw, 谁列表)
  const 列 = { ...(或(字段, {})) }
  if (!Object.keys(列).length) {
    throw new ContentError(
      '没说改什么。用法：\n' +
      '  python forge.py entry <spec> --改 "甲" ["乙" …] --正文 "…" [--标题 "…"]\n' +
      '        [--关键词 a,b] [--提示 "什么时候读我"] [--模板 常驻|必读|关键词|选读]\n' +
      `  能改的字段：${可改字段.join('、')}`)
  }
  const 无名 = Object.keys(列).filter((k) => !可改字段.includes(k))
  if (无名.length) {
    throw new ContentError(
      `这些字段不给改：${无名.join('、')}\n  能改的：${可改字段.join('、')}\n` +
      '  id / order / kind 是身份与排序 —— 要换身份就复制一条再删旧的。')
  }
  if ('content' in 列) {
    const 开场 = 找.filter((e) => pyStr(或(取(e, 'kind', null), '')) === 'opening')
    if (开场.length) {
      throw new ContentError(
        `这批里有开场白条目（${开场.slice(0, 3).map((e) => 或(取(e, 'title', null), 取(e, 'id', null))).join('、')}）—— 正文不走 \`--改\`：\n` +
        '  · 有界面层的工程里，它的真源是 hud/hud.conf.json，改 spec 里这条是**改了白改**；\n' +
        '  · 它的正文末尾挂着三个零宽标记，`--改` 会一起抹掉，而且一个字都不报。\n' +
        '  用 python forge.py opener <工程 或 spec> --正文@新正文.txt\n' +
        '  （只改别的字段就把正文去掉，那些不受影响。）')
    }
  }

  const 规整 = {}
  for (const [k, v] of Object.entries(列)) {
    规整[k] = _规整字段值(k, v)
  }
  const 前 = new Map(找.map((e) => [e, _域错(e)]))
  const 批 = []
  for (const e of 找) {
    const 旧 = {}
    const 本就无 = []
    const 本 = {}
    for (const [k, v] of Object.entries(规整)) {
      if (!(k in e)) {
        本就无.push(k)
      } else if (pyEq(取(e, k, null), v)) {
        continue
      } else {
        旧[k] = M.plain(取(e, k, null))
      }
      e[k] = v
      本[k] = v
    }
    if (Object.keys(本).length) {
      批.push([e, 本, 旧, 本就无])
    }
  }
  if (!批.length) {
    out('这些字段的值跟现在一样，一条都没改。')
    return []
  }

  let 新错 = []
  for (const [e, , , ] of 批) {
    const 后 = _域错(e)
    新错 = 新错.concat(Object.entries(后)
      .filter(([c]) => !(c in 前.get(e))).map(([, m]) => m))
  }
  if (新错.length) {
    for (const [e, , 旧, 本就无] of 批) {
      for (const [k, v] of Object.entries(旧)) {
        e[k] = v
      }
      for (const k of 本就无) {
        delete e[k]
      }
    }
    throw new ContentError(
      '这么改会被平台静默吃掉，一个字没落盘：\n' +
      `${新错.map((m) => '  · ' + m).join('\n')}\n` +
      '  看真值域表：python forge.py domains')
  }

  const 汉 = Object.keys(规整).map(_中文名).join('、')
  const 动过 = new Set(批.map(([e]) => e))
  const 项 = []
  for (const [e, , 旧, 本就无] of 批) {
    e.updated_at = M.nowIso()
    项.push({ 表: 'fields', 谁: 取(e, 'id', null),
      数据: { 旧: 旧, 本就无: 本就无 } })
  }
  // 一条回收记录装全部：`trash --还原 N` 一次把这一批的旧值全放回去
  put_trash(spec, '条目字段', `${批.length} 条改了 ${汉}`, 项)
  commit(spec, raw, out)
  out(`已改 ${批.length} 条的 ${汉}`)
  for (const [e, , , ] of 批) {
    out(`  · ${或(取(e, 'title', null), 取(e, 'id', null))}`)
  }
  const 没动 = 找.filter((e) => !动过.has(e))
  if (没动.length) {
    out(`  （另有 ${没动.length} 条这些字段本来就是那个值，没动）`)
  }
  trash_note(out)
  return 批.map(([e]) => e)
}


export function del_entries(spec, 谁列表, out = _print) {
  /**
   * 批量删 —— 一条回收记录装全部，`trash --还原 N` 一次就能全捞回来。
   *
   * 位置按**从小到大**记（还原是照记录顺序逐个插回原位置），真正删的时候反过来
   * 从后往前删 —— 否则删掉靠前的那条，后面记的位置全错一格。
   */
  const raw = load(spec)
  const 找 = _认多条(raw, 谁列表)
  const rows = entries_of(raw)
  const 带位 = 找.map((e) => [rows.indexOf(e), e]).sort((a, b) => a[0] - b[0])
  const 项 = 带位.map(([i, e]) => ({ 表: 'entries', 位置: i, 数据: M.plain(e) }))
  put_trash(spec, '条目', `删了 ${找.length} 条（${找.slice(0, 4).map((e) => 或(取(e, 'title', null), '?')).join('、')
    + (找.length > 4 ? '…' : '')}）`, 项)
  for (const [, e] of [...带位].reverse()) {
    rows.splice(rows.indexOf(e), 1)
  }
  commit(spec, raw, out)
  out(`已删 ${找.length} 条`)
  for (const [, e] of 带位) {
    out(`  · ${或(取(e, 'title', null), 取(e, 'id', null))}（${lenPy(或(取(e, 'content', null), ''))} 字）`)
  }
  trash_note(out)
  return 带位.map(([, e]) => e)
}


export function dup_entries(spec, 谁列表, 标题 = null, 到 = null, out = _print) {
  /**
   * 复制条目 —— 可以一次一串（跟 `--挪 / --删 / --启用` 一个规矩）。
   *
   * · 复制出来的那条**紧跟在原件后面**（顺序号仍在末尾），默认叫「原名（副本）」。
   * · `--到 分组` 能让副本直接落进指定分组；不给就跟着原件待在同一个组。
   * · 复制是「加一条」，跟 `--新` 一样**不写回收记录** —— 不想要了 `--删` 掉它。
   * · 一张卡只有一条开场白，所以开场白条目不许复制。
   */
  const raw = load(spec)
  const 找 = _认多条(raw, 谁列表)
  const 开场 = 找.filter((e) => pyStr(或(取(e, 'kind', null), '')) === 'opening')
  if (开场.length) {
    throw new ContentError(
      `开场白条目不能复制（${开场.slice(0, 3).map((e) => 或(取(e, 'title', null), 取(e, 'id', null))).join('、')}）—— 一张卡只有一条开场白。\n` +
      '  想多一个开场方案：python forge.py opener <工程 或 spec> --列')
  }
  标题 = pyStr(或(标题, '')).trim()
  if (标题 && 找.length > 1) {
    throw new ContentError(
      '一次复制多条时 --标题 只能给一条用。\n' +
      '  想给它们都起名：一条条复制，或复制完用 --改 批量改标题。')
  }
  let gid = null
  if (pyStr(或(到, '')).trim()) {
    const g = _find(groups_of(raw, false), 到, ['id', 'name'])
    if (g === null) {
      throw new ContentError(`没有分组「${到}」。建它：python forge.py group <spec> --新 ${到}`)
    }
    gid = 或(取(g, 'id', null), '')
  }
  const rows = entries_of(raw)
  const 新们 = []
  for (const e of 找) {
    const nw = {}
    for (const [k, v] of Object.entries(e)) {
      nw[k] = v
    }
    nw.id = `${_prefix(spec)}-entry-${切(M.uuid4hex(), 8)}`
    nw.title = 或(标题, `${或(取(e, 'title', null), '')}（副本）`)
    nw.order = _max_order(rows) + 1
    nw.tree_view_order = nw.order
    nw.created_at = M.nowIso()
    nw.updated_at = nw.created_at
    if (gid !== null) {
      nw.group_id = gid
    }
    rows.splice(rows.indexOf(e) + 1, 0, M.ordered(nw, M.ENTRY_KEYS))
    新们.push(nw)
  }
  commit(spec, raw, out)
  out(`已复制 ${新们.length} 条`)
  找.forEach((源, i) => {
    const nw = 新们[i]
    out(`  · ${或(取(源, 'title', null), 取(源, 'id', null))} -> 「${nw.title}」${gid !== null ? `（在「${到}」下）` : ''}`)
  })
  out(`  （顺着原件排 · 顺序号在末尾 · 不要了就 python forge.py entry <spec> --删 "${新们.length ? 新们[0].title : ''}"）`)
  return 新们
}


export function dup_entry(spec, eid, 标题 = null, out = _print) {
  /** 留一个单条入口给工作台用（`ui.py` 的「复制」按钮）。 */
  return dup_entries(spec, [eid], 标题, null, out)[0]
}


export function move_entry(spec, eid, 分组, out = _print) {
  const [raw, e] = find_entry(spec, eid)
  if (pyStr(或(分组, '')).trim()) {
    const g = _find(groups_of(raw, false), 分组, ['id', 'name'])
    if (g === null) {
      throw new ContentError(`没有分组「${分组}」。`)
    }
    e.group_id = 或(取(g, 'id', null), '')
  } else {
    e.group_id = ''
  }
  e.updated_at = M.nowIso()
  commit(spec, raw, out)
  out(`已把「${或(取(e, 'title', null), '')}」挪到 ${或(分组, '（未分组）')}`)
  return e
}


// ------------------------------------------------------------------ 分组
export function add_group(spec, 名, 父 = '', out = _print) {
  const raw = load(spec)
  const rows = groups_of(raw, true)
  名 = pyStr(或(名, '')).trim()
  if (!名) {
    throw new ContentError('分组名不能空。')
  }
  if (_find(rows, 名, ['id', 'name'])) {
    throw new ContentError(`已经有分组「${名}」了。`)
  }
  let 父id = ''
  if (pyStr(或(父, '')).trim()) {
    const g = _find(rows, 父, ['id', 'name'])
    if (g === null) {
      throw new ContentError(`没有父分组「${父}」。`)
    }
    父id = 或(取(g, 'id', null), '')
  }
  const g = {
    id: `${_prefix(spec)}-grp-${切(M.uuid4hex(), 8)}`,
    name: 名, parent_id: 父id, order: _max_order(rows) + 1,
    tree_view_order: _max_order(rows) + 1,
    created_at: M.nowIso(), updated_at: M.nowIso(),
  }
  rows.push(M.ordered(g, M.GROUP_KEYS))
  commit(spec, raw, out)
  out(`已加分组「${名}」${父 ? `（父：${父}）` : ''}`)
  return g
}


export function rename_group(spec, 谁, 新名, out = _print) {
  const raw = load(spec)
  const g = _find(groups_of(raw, false), 谁, ['id', 'name'])
  if (g === null) {
    throw new ContentError(`没有分组「${谁}」。`)
  }
  const 旧 = 或(取(g, 'name', null), '')
  g.name = pyStr(或(新名, '')).trim()
  if (!g.name) {
    throw new ContentError('新名字不能空。')
  }
  g.updated_at = M.nowIso()
  commit(spec, raw, out)
  out(`分组「${旧}」改名成「${g.name}」`)
  return g
}


export function del_group(spec, 谁, out = _print) {
  const raw = load(spec)
  const rows = groups_of(raw)
  const g = _find(rows, 谁, ['id', 'name'])
  if (g === null) {
    throw new ContentError(`没有分组「${谁}」。`)
  }
  const kids = groups_of(raw, false).filter((x) => pyEq(取(x, 'parent_id', null), 取(g, 'id', null)))
  if (kids.length) {
    throw new ContentError(`分组「${或(取(g, 'name', null), '')}」下面还有 ${kids.length} 个子分组，先删子分组。`)
  }
  const moved = entries_of(raw, false).filter((e) => pyEq(取(e, 'group_id', null), 取(g, 'id', null)))
  const 项 = [{ 表: 'groups', 位置: rows.indexOf(g),
    数据: M.plain(g) }]
  if (moved.length) {
    // 把「谁原来在这个组里」也记下来，不然还原了组、条目却留在未分组
    const 数据 = {}
    for (const e of moved) 数据[pyStr(取(e, 'id', null))] = 取(g, 'id', null)
    项.push({
      表: 'regroup',
      数据: 数据,
    })
  }
  put_trash(spec, '分组', `删了分组「${或(取(g, 'name', null), '')}」`, 项)
  rows.splice(rows.indexOf(g), 1)
  for (const e of moved) {
    e.group_id = ''
    e.updated_at = M.nowIso()
  }
  commit(spec, raw, out)
  out(`已删分组「${或(取(g, 'name', null), '')}」`)
  trash_note(out)
  if (moved.length) {
    out(`  里面 ${moved.length} 条条目没删，挪到「未分组」了（删分组不是删内容）`)
  }
  return g
}


// ------------------------------------------------------------------ 变量
export function _get_vars(raw, must = true) {
  const v = _vars(raw, must)
  if (v === null) {
    return null
  }
  _setdefault(v, 'objects', [])
  _setdefault(v, 'variables', [])
  _setdefault(v, 'initial_state', {})
  if (!是字典(取(v, 'initial_state', null))) {
    v.initial_state = {}
  }
  return v
}


export function add_object(spec, 名, 父 = '', 说明 = '', 更新规则 = '', out = _print) {
  const raw = load(spec)
  const v = _get_vars(raw)
  const objs = v.objects
  名 = pyStr(或(名, '')).trim()
  if (!名) {
    throw new ContentError('对象名不能空。')
  }
  if (_find(objs, 名, ['id', 'name'])) {
    throw new ContentError(`已经有对象「${名}」了。`)
  }
  let 父id = ''
  let 父路径 = []
  if (pyStr(或(父, '')).trim()) {
    const p = _find(objs, 父, ['id', 'name'])
    if (p === null) {
      throw new ContentError(`没有父对象「${父}」。`)
    }
    父id = 或(取(p, 'id', null), '')
    父路径 = _对象路径(v, p)
    if (!_可写状态(v.initial_state, 父路径)) {
      const [哪, 什么] = _挡路的(v.initial_state, 父路径)
      throw new ContentError(
        `父对象「${父}」在 initial_state 里对不上号：${哪} 那一格是${_形状(什么)}。\n` +
        '  对象表说它是一层能放子对象的对象，初值那边却不是 —— 形状是卡自己写的，' +
        '工具不猜。去「原文」页把那一格改成一层对象再来。')
    }
  }
  const o = {
    id: `obj-${_prefix(spec)}-${切(M.uuid4hex(), 8)}`,
    name: 名, parent_id: 父id, enabled: true,
    description: pyStr(或(说明, '')), update_rule: pyStr(或(更新规则, '')),
    dynamic_key: false, order: _max_order(objs) + 1,
    tree_view_order: _max_order(objs) + 1,
    created_at: M.nowIso(), updated_at: M.nowIso(),
  }
  objs.push(M.ordered(o, M.VAR_OBJECT_KEYS))

  const 说 = []
  let 节点 = v.initial_state
  for (const seg of 父路径) {
    节点 = _setdefault(节点, seg, {})
  }
  if (!(名 in 节点)) {
    节点[名] = {}
    说.push(`initial_state 里补上「${[...父路径, 名].join('.')}: {}」`)
  }
  try {
    const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
    let _节点 = root
    let _可 = true
    for (const seg of 父路径) {
      if (_节点 instanceof ZOD.Obj && _节点.kids.get(seg) instanceof ZOD.Obj) {
        _节点 = _节点.kids.get(seg)
      } else {
        _可 = false
        break
      }
    }
    if (_可) {
      if (!_节点.kids.has(名)) {
        ZOD.set_leaf(root, Array.from(父路径), 名, 'z.object({})')
        v.schema_code = ZOD.emit(root)
        说.push(`Zod 里补上「${[...父路径, 名].join('.')}: z.object({})」`)
      } else {
        说.push(`Zod 里本来就有「${名}」，原样留着没动`)
      }
    } else {
      说.push(`Zod 里找不到「${父路径.join('.')}」那层（形状对不上），没动它`)
    }
  } catch (exc) {
    if (!(exc instanceof ZOD.ZodError)) throw exc
    说.push(`Zod 那段工具认不出（${_错文(exc)}），没动它 —— 记得手补一行`)
  }
  commit(spec, raw, out)
  out(`已加变量对象「${名}」${父 ? `（父：${父}）` : ''}`)
  for (const s of 说) {
    out(`  · ${s}`)
  }
  return o
}


export function _初值(类型, 值) {
  const t = pyStr(或(类型, 'string')).toLowerCase()
  if (值 === null || 值 === undefined) {
    return 取(默认初值, t, '')
  }
  if (t === 'boolean') {
    if (typeof 值 === 'boolean') {
      return 值
    }
    const s = pyStr(值).trim().toLowerCase()
    return ['1', 'true', 'yes', 'y', '是', '真', 'on'].includes(s)
  }
  if (t === 'number') {
    const s = pyStr(值).trim()
    try {
      return intPy(s)
    } catch {
      try {
        return _floatPy(s)
      } catch {
        throw new ContentError(`«${pyStr(值)}» 不是个数 —— 类型是 number，初值得是数字。`)
      }
    }
  }
  if (t === 'array') {
    if (Array.isArray(值)) {
      return 值
    }
    const s = pyStr(值).trim()
    if (!s) {
      return []
    }
    if (s.startsWith('[')) {
      try {
        return JSON.parse(s)
      } catch { /* 认不出就当逗号串处理 */ }
    }
    return s.replace(/，/g, ',').replace(/、/g, ',').split(',')
      .map((x) => x.trim()).filter((x) => x.trim())
  }
  if (t === 'object') {
    if (是字典(值)) {
      return 值
    }
    const s = pyStr(值).trim()
    if (s.startsWith('{')) {
      try {
        return JSON.parse(s)
      } catch { /* 认不出就往下抛错 */ }
    }
    throw new ContentError(`类型是 object，初值得写成 JSON，比如 --初值 '{"a":1}'`)
  }
  return pyStr(值)
}


export function add_variable(spec, 对象, 标题, 类型 = 'string', 初值 = null, 说明 = '', 更新规则 = '',
  out = _print) {
  const raw = load(spec)
  const v = _get_vars(raw)
  const o = _find(v.objects, 对象, ['id', 'name'])
  if (o === null) {
    throw new ContentError(`没有变量对象「${对象}」。先建：python forge.py var ${spec} --新对象 ${对象}`)
  }
  const 标 = pyStr(或(标题, '')).trim()
  if (!标) {
    throw new ContentError('变量名不能空。')
  }
  const t = pyStr(或(类型, 'string')).trim().toLowerCase()
  if (!变量类型表.includes(t)) {
    throw new ContentError(`没有这个类型：${类型}（有 ${变量类型表.join(' / ')}）`)
  }
  const 同对象 = v.variables.filter((x) => pyEq(取(x, 'object_id', null), 取(o, 'id', null)))
  if (同对象.some((x) => pyStr(或(取(x, 'title', null), '')) === 标)) {
    throw new ContentError(`对象「${取(o, 'name', null)}」里已经有变量「${标}」了。`)
  }
  const 值 = _初值(t, 初值)
  // default_value 在卡里是个**字符串**：字符串原样写，其余转成 JSON 文本。
  // （照真实卡的样子来的：布尔写 'false'、数字写 '1'、数组写 '[]'、字符串就写原话）
  const 存档值 = typeof 值 === 'string' ? 值 : JSON.stringify(值)

  const item = {
    id: `variable-${_prefix(spec)}-${切(M.uuid4hex(), 8)}`,
    title: 标, object_id: 取(o, 'id', null), enabled: true, type: t,
    default_value: 存档值, description: pyStr(或(说明, '')),
    update_rule: pyStr(或(更新规则, '')), read_mode: 'on_demand',
    order: _max_order(同对象) + 1, tree_view_order: _max_order(同对象) + 1,
    created_at: M.nowIso(), updated_at: M.nowIso(),
  }
  v.variables.push(M.ordered(item, M.VAR_ITEM_KEYS))

  // 第二处：初值。先证明这条路径真的是一层层对象，再动笔 ——
  // 半路撞上「不是对象」的值就当场停，绝不往旁边那层乱写。
  const 路径 = _对象路径(v, o)
  const 状态 = v.initial_state
  if (!_可写状态(状态, 路径)) {
    const [哪, 什么] = _挡路的(状态, 路径)
    throw new ContentError(
      `对象「${取(o, 'name', null)}」在 initial_state 里对不上号：${哪} 那一格是${_形状(什么)}，不是一层对象。\n` +
      `  对象表说「${取(o, 'name', null)}」能放变量，初值那边却不是 —— 形状是卡自己写的，工具不猜` +
      '（乱写会把值塞到旁边那一层，而且不报错）。\n' +
      '  两个办法：① 去「原文」页把 initial_state 那格改成一层对象；' +
      '② 或者把这个变量加到别的对象下。')
  }
  let 节点 = 状态
  for (const seg of 路径) {
    节点 = _setdefault(节点, seg, {})
  }
  节点[标] = 值
  const 说 = [`initial_state 里写上「${[...路径, 标].join('.')} = ${JSON.stringify(值)}」`]

  // 第三处：Zod
  try {
    const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
    let 层 = root
    let 可到 = true
    for (const seg of 路径) {
      const kid = 层 instanceof ZOD.Obj ? 层.kids.get(seg) : undefined
      if (kid === undefined) {
        可到 = false
        break
      }
      层 = kid
    }
    if (可到 && 层 instanceof ZOD.Obj && 层.kids.has(标)) {
      说.push(`Zod 里本来就有「${标}」，原样留着没动（要改表达式去「原文」页）`)
    } else {
      ZOD.set_leaf(root, Array.from(路径), 标, ZOD.expr_for(t, 值))
      v.schema_code = ZOD.emit(root)
      说.push(`Zod 里补上「${标}: ${ZOD.expr_for(t, 值)}」`)
    }
  } catch (exc) {
    if (!(exc instanceof ZOD.ZodError)) throw exc
    说.push(`⚠ Zod 那段工具认不出（${_错文(exc)}），只写了另外两处 —— 手补一行，` +
      '否则运行时会静默丢掉这个字段')
  }
  commit(spec, raw, out)
  out(`已加变量「${取(o, 'name', null)}.${标}」（${t}）`)
  for (const s of 说) {
    out(`  · ${s}`)
  }
  return item
}


export function _对象路径(v, o) {
  /** 从根到某个对象的名字路径（跟着 parent_id 往上走）。 */
  const by_id = new Map()
  for (const x of (或(取(v, 'objects', null), []))) by_id.set(取(x, 'id', null), x)
  const names = []
  let cur = o
  const seen = new Set()
  while (cur !== null && cur !== undefined && !seen.has(取(cur, 'id', null))) {
    seen.add(取(cur, 'id', null))
    names.push(或(取(cur, 'name', null), ''))
    cur = by_id.get(或(取(cur, 'parent_id', null), ''))
  }
  return names.filter((n) => n).reverse()
}


export function _形状(v) {
  if (typeof v === 'boolean') {
    return '布尔'
  }
  if (是字典(v)) {
    return '一层对象'
  }
  if (Array.isArray(v)) {
    return '数组'
  }
  if (typeof v === 'number') {
    return '数字'
  }
  if (typeof v === 'string') {
    return '文本'
  }
  return '空'
}


export function _走状态(st, 路径) {
  /** 按路径取初值那一格。返回 (值, 找到没)。 */
  let cur = st
  for (const seg of 路径) {
    if (!是字典(cur) || !(seg in cur)) {
      return [null, false]
    }
    cur = cur[seg]
  }
  return [cur, true]
}


export function _可写状态(st, 路径) {
  /**
   * 这条路径能不能写进去：一路都得是「一层对象」。
   *
   * 中间缺的那几层可以现建（建出来是空的，后面自然也就没有），但**半路撞上一个
   * 不是对象的值**就没法写了 —— 比如对象表说「背包」是一层，初值那边它却是个数组。
   * 这种不一致是卡自己写出来的形状，工具不猜，照实说。
   */
  let cur = st
  for (const seg of 路径) {
    if (!是字典(cur)) {
      return false
    }
    if (!(seg in cur)) {
      return true
    }
    cur = cur[seg]
  }
  return 是字典(cur)
}


export function _挡路的(st, 路径) {
  /** 写不进去时，指出是哪一格挡住的（报错要说到点上）。 */
  let cur = st
  for (let i = 0; i < 路径.length; i += 1) {
    const seg = 路径[i]
    if (!是字典(cur)) {
      return [路径.slice(0, i).join('.') || '(根)', cur]
    }
    if (!(seg in cur)) {
      return [null, null]
    }
    cur = cur[seg]
  }
  return [路径.join('.'), cur]
}


export function _找状态格子(st, 路径, 键) {
  /**
   * 读的时候不必这么严：**存不存在**说了算，两条候选里挑真的那条。
   *
   * 候选甲是对象表直读（艾瑟兰那种规规矩矩的卡走这条）；候选乙是「去掉对象自己
   * 那一层」（手写的卡里偶尔有「列表对象」——对象名就是数据键，不额外加一层）。
   * 只用来**读和删**，选中哪条都只动真找到的那一格。
   */
  const 候选 = [Array.from(路径).concat([键])]
  if (路径.length >= 2) {
    候选.push(Array.from(路径.slice(0, -1)).concat([键]))
  }
  for (const p of 候选) {
    const [cur, ok] = _走状态(st, p.slice(0, -1))
    if (ok && 是字典(cur) && p[p.length - 1] in cur) {
      return [p, cur]
    }
  }
  return [null, null]
}


export function _find_variable(raw, 谁) {
  const v = _get_vars(raw, false)
  if (!v) {
    throw new ContentError('这张卡没有变量层。')
  }
  const rows = 或(取(v, 'variables', null), [])
  let e = _find(rows, 谁, ['id', 'title'])
  if (e === null && pyStr(谁).includes('.')) {
    const s = pyStr(谁)
    const i = s.lastIndexOf('.')
    const 对象 = s.slice(0, i)
    const 标 = s.slice(i + 1)
    const o = _find(或(取(v, 'objects', null), []), 对象, ['id', 'name'])
    if (o !== null) {
      e = _find(rows.filter((x) => pyEq(取(x, 'object_id', null), 取(o, 'id', null))),
        标, ['title', 'id'])
    }
  }
  if (e === null) {
    throw new ContentError(`没有变量「${谁}」。`)
  }
  return [v, e]
}


export function del_variable(spec, 谁, out = _print) {
  const raw = load(spec)
  const [v, item] = _find_variable(raw, 谁)
  const o = _find(或(取(v, 'objects', null), []), 取(item, 'object_id', null), ['id'])
  const 名 = 或(取(或(o, {}), 'name', null), '')
  const 标 = 或(取(item, 'title', null), '')
  const 路径 = o ? _对象路径(v, o) : []
  const 键 = pyStr(或(取(item, 'title', null), ''))
  const 项 = [{ 表: 'variables', 位置: v.variables.indexOf(item),
    数据: M.plain(item) }]
  const st = 或(取(v, 'initial_state', null), {})
  // 读的时候靠**存不存在**认路径：对象表直读那条找不到，就试「去掉对象自己那层」
  const [真路径, 容器] = _找状态格子(st, 路径, 键)
  if (真路径 !== null) {
    const _值 = 容器[键]
    delete 容器[键]
    项.push({ 表: 'initial_state', 路径: 真路径,
      数据: _值 })
  }
  if (真路径 !== null) {
    try {
      const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
      let node = root
      let 存在 = true
      for (const seg of 真路径.slice(0, -1)) {
        node = node instanceof ZOD.Obj ? node.kids.get(seg) : undefined
        if (node === undefined) {
          存在 = false
          break
        }
      }
      if (存在 && node instanceof ZOD.Obj && node.kids.has(真路径[真路径.length - 1])) {
        const 表达式 = node.kids.get(真路径[真路径.length - 1]).code
        ZOD.drop(root, 真路径.slice(0, -1), 真路径[真路径.length - 1])
        v.schema_code = ZOD.emit(root)
        项.push({ 表: 'schema', 路径: 真路径,
          数据: 表达式 })
      }
    } catch (exc) {
      if (!(exc instanceof ZOD.ZodError)) throw exc
    }
  }

  v.variables.splice(v.variables.indexOf(item), 1)
  put_trash(spec, '变量', `删了变量「${名}.${标}」`, 项)
  commit(spec, raw, out)
  out(`已删变量「${名}.${标}」`)
  trash_note(out)
  out(`  三处一起撤了：画面板 · 初值 · Zod${项.length < 3 ? '（Zod 那段认不出，没动）' : ''}`)
  if (真路径 === null) {
    out('  注意：初值与 Zod 里没找到对应的那一格（形状和对象表对不上），只撤了变量条目本身。')
  }
  return item
}


export function del_variables(spec, 谁列表, out = _print) {
  /**
   * 批量删变量 —— 一条回收记录装全部，`trash --还原 N` 一次全捞回来。
   *
   * 每个变量都牵着三处（画面板 + 初值那格 + Zod 那个字段），所以这里是三处 × N。
   * 位置按**从小到大**记（还原是照记录顺序逐个插回原位置），真删时从后往前删 ——
   * 否则删掉靠前那个，后面记的位置全错一格。
   * 有认不出的名字就**整批停下、一个都不删**。
   */
  const raw = load(spec)
  const v = _get_vars(raw, false)
  if (!v) {
    throw new ContentError('这张卡没有变量层。')
  }
  const 找 = []
  const 缺 = []
  for (const 谁 of (或(谁列表, []))) {
    let item
    try {
      [, item] = _find_variable(raw, 谁)
    } catch (exc) {
      if (!(exc instanceof ContentError)) throw exc
      缺.push(pyStr(谁))
      continue
    }
    if (!pyIn(找, item)) {
      找.push(item)
    }
  }
  if (缺.length) {
    throw new ContentError(`没有这些变量：${缺.join('、')}\n  一个都没动。看看有哪些：` +
      'python forge.py var <spec> --列')
  }
  if (!找.length) {
    throw new ContentError('没给要删哪些变量。')
  }

  const rows = v.variables
  const 带位 = 找.map((item) => [rows.indexOf(item), item]).sort((a, b) => a[0] - b[0])
  const st = 或(取(v, 'initial_state', null), {})
  const 项 = []
  const 名们 = []
  for (const [i, item] of 带位) {
    const o = _find(或(取(v, 'objects', null), []), 取(item, 'object_id', null), ['id'])
    const 名 = 或(取(或(o, {}), 'name', null), '')
    const 标 = 或(取(item, 'title', null), '')
    名们.push(`${名}.${标}`)
    const 键 = pyStr(或(取(item, 'title', null), ''))
    项.push({ 表: 'variables', 位置: i,
      数据: M.plain(item) })
    const 路径 = o ? _对象路径(v, o) : []
    // 读的时候靠**存不存在**认路径：对象表直读那条找不到，就试「去掉对象自己那层」
    const [真路径, 容器] = _找状态格子(st, 路径, 键)
    if (真路径 !== null) {
      const _值 = 容器[键]
      delete 容器[键]
      项.push({ 表: 'initial_state', 路径: 真路径,
        数据: _值 })
    }
    if (真路径 !== null) {
      try {
        const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
        let node = root
        let 存在 = true
        for (const seg of 真路径.slice(0, -1)) {
          node = node instanceof ZOD.Obj ? node.kids.get(seg) : undefined
          if (node === undefined) {
            存在 = false
            break
          }
        }
        if (存在 && node instanceof ZOD.Obj && node.kids.has(真路径[真路径.length - 1])) {
          const 表达式 = node.kids.get(真路径[真路径.length - 1]).code
          ZOD.drop(root, 真路径.slice(0, -1), 真路径[真路径.length - 1])
          v.schema_code = ZOD.emit(root)
          项.push({ 表: 'schema', 路径: 真路径,
            数据: 表达式 })
        }
      } catch (exc) {
        if (!(exc instanceof ZOD.ZodError)) throw exc
      }
    }
  }

  for (const [, item] of [...带位].reverse()) {
    rows.splice(rows.indexOf(item), 1)
  }

  const 标题 = 名们.slice(0, 4).join('、') + (名们.length > 4 ? '…' : '')
  put_trash(spec, '变量', `删了 ${找.length} 个变量（${标题}）`, 项)
  commit(spec, raw, out)
  out(`已删 ${找.length} 个变量`)
  for (const 名 of 名们) {
    out(`  · ${名}`)
  }
  const 缺处 = 3 * 找.length - 项.length
  if (缺处) {
    out(`  注意：有 ${缺处} 处（初值 / Zod）没找着对应的格子，只撤了能找到的。`)
  } else {
    out('  三处一起撤了：画面板 · 初值 · Zod')
  }
  trash_note(out)
  return 带位.map(([, item]) => item)
}


// ------------------------------------------------------ 改名（变量 / 变量对象）
export function _改键序(d, 旧, 新) {
  /** 把一个 dict 里的键改名，**原地保序** —— 键换了，位置不换。 */
  if (!(旧 in d) || 旧 === 新) {
    return false
  }
  const 新表 = {}
  for (const [k, val] of Object.entries(d)) {
    新表[k === 旧 ? 新 : k] = val
  }
  for (const k of Object.keys(d)) {
    delete d[k]
  }
  Object.assign(d, 新表)
  return true
}


export function _提到(raw, 名字) {
  /**
   * 条目正文 / 读取提示里提到这个名字的地方 —— **只数，不改**。
   *
   * 正文是人写的句子。工具不知道那个词是「这个变量」还是恰好同字的常用说法
   * （变量叫「名」时会命中一大片）。所以位置如实报出来，改不改由人定 ——
   * 悄悄替换正文才是真正会咬人的那种「贴心」。
   */
  const hits = []
  for (const e of entries_of(raw, false)) {
    for (const [域, 汉] of [['content', '正文'], ['agent_selection_hint', '读取提示']]) {
      const n = _数出现(pyStr(或(取(e, 域, null), '')), pyStr(名字))
      if (n) {
        hits.push([或(取(e, 'title', null), '?'), 汉, n])
      }
    }
  }
  return hits
}


/** Python 的 `str.count(sub)` —— 按**不重叠**出现计数。 */
function _数出现(s, sub) {
  if (!sub) return 0
  let n = 0
  let i = 0
  while (true) {
    const j = s.indexOf(sub, i)
    if (j === -1) break
    n += 1
    i = j + sub.length
  }
  return n
}


export function rename_variable(spec, 谁, 新名, out = _print) {
  /**
   * 给变量改名 —— 一次把**三处**一起挪，顺序与 id 都不动。
   *
   * 在这之前只有「删了重建」一条路：换掉的是 id，卡里按 id 互相引用的地方
   * （正则、条目、变量之间）全部断链，而且另外两处的键名跟着对新不上。
   *
   * 变的名不是一个孤立字符串，它同时是：
   *
   *   · `variables[].title` —— 面板上那一行
   *   · `initial_state` 里那一格的**键**
   *   · `schema_code` 里那个**字段名**
   *
   * 只改一处，另两处就悄悄悬空（`check` 会报 VAR-SYNC-*，但那已经是改完之后了）。
   */
  const raw = load(spec)
  const [v, item] = _find_variable(raw, 谁)
  const o = _find(或(取(v, 'objects', null), []), 取(item, 'object_id', null), ['id'])
  const 对象名 = 或(取(或(o, {}), 'name', null), '')
  const 旧 = pyStr(或(取(item, 'title', null), ''))
  const 新 = pyStr(或(新名, '')).trim()
  if (!新) {
    throw new ContentError('新名字不能空。')
  }
  if (新 === 旧) {
    throw new ContentError(`新名字跟旧的一样（「${旧}」），没改。`)
  }
  const 兄弟 = (或(取(v, 'variables', null), []))
    .filter((x) => x !== item && pyEq(取(x, 'object_id', null), 取(或(o, {}), 'id', null)))
  if (兄弟.some((x) => pyStr(或(取(x, 'title', null), '')) === 新)) {
    throw new ContentError(`对象「${对象名}」里已经有一个叫「${新}」的变量了 —— 同一层里两个同名，` +
      '初值与 Zod 那两格会打架。')
  }

  const 路径 = o ? _对象路径(v, o) : []
  item.title = 新
  item.updated_at = M.nowIso()

  const st = 或(取(v, 'initial_state', null), {})
  const [真路径, 容器] = _找状态格子(st, 路径, 旧)
  let 状态路径 = null
  if (真路径 !== null && _改键序(容器, 旧, 新)) {
    状态路径 = Array.from(真路径.slice(0, -1)).concat([新])          // 改完之后它在哪儿
  }
  let zod路径 = null
  const 基础 = 真路径 ? 真路径.slice(0, -1) : Array.from(路径)
  try {
    const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
    const node = ZOD.node_at(root, Array.from(基础))
    if (node instanceof ZOD.Obj && ZOD.rename_key(node, 旧, 新)) {
      v.schema_code = ZOD.emit(root)
      zod路径 = Array.from(基础).concat([新])
    }
  } catch (exc) {
    if (!(exc instanceof ZOD.ZodError)) throw exc
  }

  put_trash(spec, '变量', `变量「${对象名}.${旧}」改名成「${新}」`,
    [{ 表: '改名', 种类: '变量', 旧: 旧, 新: 新,
       变量id: 取(item, 'id', null), 对象: 对象名,
       状态路径: 状态路径, Zod路径: zod路径 }])
  commit(spec, raw, out)
  out(`变量「${对象名}.${旧}」改名为「${新}」`)
  out(`  三处一起挪：面板 ✓ · 初值 ${状态路径 ? '✓' : '（没找到那一格，没动）'} · Zod ${zod路径 ? '✓' : '（没找到那个字段，没动）'}`)
  if (!(状态路径 && zod路径)) {
    out('  ⚠ 有两处没跟上 —— 跑一遍 check 看 VAR-SYNC-* 报哪一条，再看着补。')
  }
  const 提 = _提到(raw, 旧)
  if (提.length) {
    out(`  另：正文 / 提示里有 ${提.reduce((a, x) => a + x[2], 0)} 处写着「${旧}」—— 工具**没动**（不知道那是变量名还是` +
      `恰好同字的词），你自己扫一眼要不要改：`)
    for (const [标, 域, n] of 提.slice(0, 5)) {
      out(`    · 「${标}」的${域} ${n} 处`)
    }
    if (提.length > 5) {
      out(`    · …还有 ${提.length - 5} 处`)
    }
  }
  trash_note(out)
  return item
}


export function rename_object(spec, 谁, 新名, out = _print) {
  /**
   * 给变量对象改名 —— 对象名同样是**三处**：`objects[].name`、
   * `initial_state` 里那一层的键、Zod 里那个嵌套对象的键。
   *
   * 子对象整棵跟着走（路径是父子链，换上面一段，下面的路自然一起换），
   * `variables[].object_id` 认的是 id，不受影响。
   */
  const raw = load(spec)
  const v = _get_vars(raw)
  const o = _find(或(取(v, 'objects', null), []), 谁, ['id', 'name'])
  if (o === null) {
    throw new ContentError(`没有变量对象「${谁}」。列出来看：python forge.py var ${spec} --列`)
  }
  const 旧 = pyStr(或(取(o, 'name', null), ''))
  const 新 = pyStr(或(新名, '')).trim()
  if (!新) {
    throw new ContentError('新名字不能空。')
  }
  if (新 === 旧) {
    throw new ContentError(`新名字跟旧的一样（「${旧}」），没改。`)
  }
  if (_find((或(取(v, 'objects', null), [])).filter((x) => x !== o), 新, ['name', 'id'])) {
    throw new ContentError(`已经有一个叫「${新}」的对象了 —— 同一层两个同名，路就分不清了。`)
  }
  const 路径 = _对象路径(v, o)
  if (!路径.length) {
    throw new ContentError(`对象「${谁}」没有名字（路径是空的），先给它个名字。`)
  }

  o.name = 新
  o.updated_at = M.nowIso()
  const 父 = Array.from(路径.slice(0, -1))
  let 状态路径 = null
  const [cur, ok] = _走状态(或(取(v, 'initial_state', null), {}), 父)
  if (ok && 是字典(cur) && _改键序(cur, 路径[路径.length - 1], 新)) {
    状态路径 = 父.concat([新])
  }
  let zod路径 = null
  try {
    const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
    const node = ZOD.node_at(root, Array.from(父))
    if (node instanceof ZOD.Obj && ZOD.rename_key(node, 路径[路径.length - 1], 新)) {
      v.schema_code = ZOD.emit(root)
      zod路径 = 父.concat([新])
    }
  } catch (exc) {
    if (!(exc instanceof ZOD.ZodError)) throw exc
  }

  put_trash(spec, '变量', `变量对象「${旧}」改名成「${新}」`,
    [{ 表: '改名', 种类: '对象', 旧: 旧, 新: 新,
       对象id: 取(o, 'id', null), 对象: 新,
       状态路径: 状态路径, Zod路径: zod路径 }])
  commit(spec, raw, out)
  out(`变量对象「${旧}」改名为「${新}」`)
  out(`  三处一起挪：对象表 ✓ · 初值 ${状态路径 ? '✓' : '（没找到那一层，没动）'} · Zod ${zod路径 ? '✓' : '（没找到那一层，没动）'}`)
  if (!(状态路径 && zod路径)) {
    out('  ⚠ 有两处没跟上 —— 跑一遍 check 看 VAR-SYNC-* 报哪一条，再看着补。')
  }
  const 提 = _提到(raw, 旧)
  if (提.length) {
    out(`  另：正文 / 提示里有 ${提.reduce((a, x) => a + x[2], 0)} 处写着「${旧}」—— 工具**没动**，你自己扫一眼。`)
  }
  trash_note(out)
  return o
}


export function _搬格子(st, 从, 到) {
  /**
   * 把 `st` 里「从」那条路径上的值，搬到「到」那条路径下 —— 中途缺的层现建。
   *
   * 只搬**真存在**的那一格（读得到才搬），目标那层写不进去（半路撞上非对象的值）
   * 就一个字节都不动。返回 True 表示真搬了。变量换对象与它的撤销都走这里，
   * 免得正反两条路各写一份、慢慢写岔。
   */
  if (!pyTruthy(从) || !pyTruthy(到) || !是字典(st)) {
    return false
  }
  从 = Array.from(从)
  到 = Array.from(到)
  if (!从.length || !到.length) {
    return false
  }
  const [旧容器, ok] = _走状态(st, 从.slice(0, -1))
  if (!(ok && 是字典(旧容器) && 从[从.length - 1] in 旧容器)) {
    return false
  }
  if (!_可写状态(st, 到.slice(0, -1))) {
    return false
  }
  const 值 = 旧容器[从[从.length - 1]]
  delete 旧容器[从[从.length - 1]]
  let 节点 = st
  for (const seg of 到.slice(0, -1)) {
    节点 = _setdefault(节点, seg, {})
  }
  节点[到[到.length - 1]] = 值
  return true
}


export function move_variable(spec, 谁, 到, out = _print) {
  /**
   * 把一个变量挪到另一个变量对象下 —— **四处一起挪**，变量 id 一个字母不动。
   *
   * 变量名本身不变，变的是它挂在哪：
   *
   *   · `variables[].object_id` —— 挂靠关系
   *   · `initial_state` 里那一格 —— 从旧对象那棵树搬到新对象那棵树下
   *   · `schema_code` 里那个字段 —— 同上，只是换在 Zod 那棵树上
   *   · `order` / `tree_view_order` —— 排到新对象末尾
   *
   * 以前只能「删了重建」：换掉的是 id，而且同一个变量名要在**另一棵子树**下重新
   * 出现，手改两处路径极易漏一处 —— 漏了 Zod 那处，运行时会静默丢掉写进去的值
   * （`check` 的 VAR-SYNC-SCHEMA 兜的就是这种，但那已经是改完之后了）。
   */
  const raw = load(spec)
  const [v, item] = _find_variable(raw, 谁)
  const o = _find(或(取(v, 'objects', null), []), 取(item, 'object_id', null), ['id'])
  if (o === null) {
    throw new ContentError(`变量「${取(item, 'title', null)}」挂的那个对象找不到了（object_id 悬空）——` +
      '先跑一遍 check 看 VAR-SYNC-ORPHAN。')
  }
  const 旧对象名 = pyStr(或(取(o, 'name', null), ''))
  const 旧路径 = _对象路径(v, o)
  const no = _find(或(取(v, 'objects', null), []), 到, ['id', 'name'])
  if (no === null) {
    throw new ContentError(`没有变量对象「${到}」。列出来看：python forge.py var ${spec} --列`)
  }
  const 新对象名 = pyStr(或(取(no, 'name', null), ''))
  if (取(no, 'id', null) === 取(o, 'id', null)) {
    throw new ContentError(`变量「${取(item, 'title', null)}」已经在对象「${新对象名}」下了，没挪。`)
  }
  const 键 = pyStr(或(取(item, 'title', null), ''))
  const 同层 = (或(取(v, 'variables', null), []))
    .filter((x) => x !== item && pyEq(取(x, 'object_id', null), 取(no, 'id', null)))
  if (同层.some((x) => pyStr(或(取(x, 'title', null), '')) === 键)) {
    throw new ContentError(`对象「${新对象名}」下已经有一个叫「${键}」的变量了 —— 同一层两个同名，` +
      '初值与 Zod 那两格会打架。')
  }
  const 新路径 = _对象路径(v, no)
  if (!新路径.length) {
    throw new ContentError(`对象「${新对象名}」没有名字（路径是空的），挪不了。`)
  }

  const st = 或(取(v, 'initial_state', null), {})
  const [旧真路径] = _找状态格子(st, 旧路径, 键)
  // 新位置跟旧位置**同一套写法**：有的卡「对象名就是数据键」，不额外加自己那层。
  const 去层 = pyTruthy(旧真路径) && 旧路径.length >= 2 && !pyEq(旧真路径, 旧路径.concat([键]))
  const 新容器路径 = (去层 && 新路径.length >= 2)
    ? Array.from(新路径.slice(0, -1)) : Array.from(新路径)
  if (!_可写状态(st, 新容器路径)) {
    const [哪, 什么] = _挡路的(st, 新容器路径)
    throw new ContentError(
      `对象「${新对象名}」在 initial_state 里对不上号：${哪} 那一格是${_形状(什么)}，不是一层对象。\n` +
      '  对象表说它是一层能放变量的对象，初值那边却不是 —— 形状是卡自己写的，' +
      '工具不猜（乱写会把值塞到旁边那一层，而且不报错）。\n' +
      '  两个办法：① 去「原文」页把那一格改成一层对象；② 或挑别的对象。')
  }

  const 旧顺序 = 取(item, 'order', null)
  const 旧视图序 = 取(item, 'tree_view_order', null)
  const 新顺序 = _max_order(同层) + 1
  item.object_id = 取(no, 'id', null)
  item.order = 新顺序
  item.tree_view_order = 新顺序
  item.updated_at = M.nowIso()

  let 状态从 = null
  let 状态到 = null
  if (旧真路径 !== null) {
    状态从 = Array.from(旧真路径)
    状态到 = 新容器路径.concat([键])
    if (!_搬格子(st, 状态从, 状态到)) {
      状态从 = null
      状态到 = null
    }
  }

  let zod从 = null
  let zod到 = null
  try {
    const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
    const 旧基础 = 旧真路径 ? 旧真路径.slice(0, -1) : Array.from(旧路径)
    const 旧节点 = ZOD.node_at(root, Array.from(旧基础))
    if (旧节点 instanceof ZOD.Obj && 旧节点.kids.has(键)) {
      const 表达式 = 旧节点.kids.get(键).code
      ZOD.drop(root, Array.from(旧基础), 键)
      ZOD.set_leaf(root, Array.from(新容器路径), 键, 表达式)
      v.schema_code = ZOD.emit(root)
      zod从 = Array.from(旧基础).concat([键])
      zod到 = 新容器路径.concat([键])
    }
  } catch (exc) {
    if (!(exc instanceof ZOD.ZodError)) throw exc
  }

  put_trash(spec, '变量', `变量「${旧对象名}.${键}」挪到「${新对象名}」下`,
    [{ 表: '挪变量', 变量id: 取(item, 'id', null), 键: 键,
       旧对象id: 取(o, 'id', null), 新对象id: 取(no, 'id', null),
       旧对象: 旧对象名, 新对象: 新对象名,
       旧状态路径: 状态从, 新状态路径: 状态到,
       旧Zod路径: zod从, 新Zod路径: zod到,
       旧顺序: 旧顺序, 旧视图序: 旧视图序 }])
  commit(spec, raw, out)
  out(`变量「${旧对象名}.${键}」挪到「${新对象名}」下`)
  out(`  一起挪的：对象表 ✓ · 初值 ${状态到 ? '✓' : '（本来就查不到那一格，没动）'} · Zod ${zod到 ? '✓' : '（没找到那个字段，没动）'} · 排序 → 末尾（order ${新顺序}）`)
  if (!状态到) {
    out('  ⚠ initial_state 里没找着它原来那一格（形状对不上）—— 跑 check 看 VAR-SYNC-STATE。')
  }
  if (!zod到) {
    out('  ⚠ Zod 里那一处没跟上 —— 跑 check 看 VAR-SYNC-SCHEMA，值会静默丢。')
  }
  trash_note(out)
  return item
}


export function del_object(spec, 谁, out = _print) {
  const raw = load(spec)
  const v = _get_vars(raw)
  const o = _find(v.objects, 谁, ['id', 'name'])
  if (o === null) {
    throw new ContentError(`没有变量对象「${谁}」。`)
  }
  // 连子对象一起收（对象树是父子的）
  const 全 = [o]
  let i = 0
  while (i < 全.length) {
    for (const x of v.objects) {
      if (pyEq(取(x, 'parent_id', null), 取(全[i], 'id', null)) && !pyIn(全, x)) {
        全.push(x)
      }
    }
    i += 1
  }
  const ids = new Set(全.map((x) => 取(x, 'id', null)))
  const 变量 = v.variables.filter((x) => ids.has(取(x, 'object_id', null)))
  const 项 = []
  for (const x of 全) {
    项.push({ 表: 'objects', 位置: v.objects.indexOf(x),
      数据: M.plain(x) })
  }
  for (const x of 变量) {
    项.push({ 表: 'variables', 位置: v.variables.indexOf(x),
      数据: M.plain(x) })
  }
  const st = 或(取(v, 'initial_state', null), {})
  for (const x of 全) {
    const 路径 = _对象路径(v, x)
    let cur = st
    let ok = true
    for (const seg of 路径.slice(0, -1)) {
      if (是字典(cur) && 是字典(取(cur, seg, null))) {
        cur = cur[seg]
      } else {
        ok = false
        break
      }
    }
    if (ok && 是字典(cur) && 路径[路径.length - 1] in cur) {
      const _值 = cur[路径[路径.length - 1]]
      delete cur[路径[路径.length - 1]]
      项.push({ 表: 'initial_state', 路径: 路径,
        数据: _值 })
    }
  }
  try {
    const root = ZOD.parse(或(取(v, 'schema_code', null), ''))
    for (const x of 全) {
      const 路径 = _对象路径(v, x)
      let node = root
      let ok = true
      for (const seg of 路径.slice(0, -1)) {
        node = node instanceof ZOD.Obj ? node.kids.get(seg) : undefined
        if (node === undefined) {
          ok = false
          break
        }
      }
      // ★ 移植记号：Python 的 Obj.kids 是 dict（`in` 就在查键），JS 侧是 Map ⇒ 必须 .has
      if (ok && node instanceof ZOD.Obj && node.kids.has(路径[路径.length - 1])) {
        const 表达式 = ZOD.emit(node.kids.get(路径[路径.length - 1]))
        ZOD.drop(root, 路径.slice(0, -1), 路径[路径.length - 1])
        项.push({ 表: 'schema', 路径: 路径,
          数据: 表达式 })
      }
    }
    v.schema_code = ZOD.emit(root)
  } catch (exc) {
    if (!(exc instanceof ZOD.ZodError)) throw exc
  }

  for (const x of 变量) {
    v.variables.splice(v.variables.indexOf(x), 1)
  }
  for (const x of 全) {
    v.objects.splice(v.objects.indexOf(x), 1)
  }
  put_trash(spec, '变量对象',
    `删了变量对象「${或(取(o, 'name', null), '')}」连它下面 ${变量.length} 个变量`, 项)
  commit(spec, raw, out)
  out(`已删变量对象「${或(取(o, 'name', null), '')}」（一起收走 ${变量.length} 个变量、${全.length - 1} 个子对象）`)
  trash_note(out)
  return o
}


export function align_schema(spec, out = _print) {
  /** 把 schema_code 对齐另外两处（对象表 + 初值）。已有的叶子表达式不动。 */
  const raw = load(spec)
  const v = _get_vars(raw)
  let root
  if (!pyStr(或(取(v, 'schema_code', null), '')).trim()) {
    root = new ZOD.Obj()
  } else {
    try {
      root = ZOD.parse(v.schema_code)
    } catch (exc) {
      if (!(exc instanceof ZOD.ZodError)) throw exc
      throw new ContentError(
        `schema_code 的形状工具不认，不敢自动对齐：${_错文(exc)}\n` +
        `  现在长这样（前 80 字）：${切(pyStr(v.schema_code), 80)}`)
    }
  }
  const 类型 = new Map()
  const by_id = new Map(v.objects.map((x) => [取(x, 'id', null), x]))
  for (const it of v.variables) {
    const o = by_id.get(取(it, 'object_id', null))
    if (!o) {
      continue
    }
    类型.set([..._对象路径(v, o), 或(取(it, 'title', null), '')].join('.'), 取(it, 'type', null))
  }
  const 说 = []
  ZOD.sync(root, 或(取(v, 'initial_state', null), {}), 类型, (s) => 说.push(s))
  v.schema_code = ZOD.emit(root)
  commit(spec, raw, out)
  out('Zod 已对齐另两处（对象表 + 初值）')
  for (const s of 说) {
    out(s)
  }
  if (!说.length) {
    out('  · 本来就是齐的，一个字没改')
  }
  return 说
}


// ------------------------------------------------------------------ 正则
export function list_regex(spec) {
  const raw = load(spec)
  return (或(取(raw, 'regex_rules', null), [])).map((r) => ({
    id: 取(r, 'id', null), 名: 或(取(r, 'name', null), ''), 顺序: 取(r, 'order', null),
    开: pyTruthy(取(r, 'enabled', true)),
    模式: pyStr(或(取(r, 'pattern', null), '')),
    目标: 或(取(r, 'targets', null), []),
  }))
}


export function add_regex(spec, 名, 模式, 替换 = '', 目标 = null, 顺序 = null, 显示用 = true, out = _print) {
  const raw = load(spec)
  const rules = _setdefault(raw, 'regex_rules', [])
  名 = pyStr(或(名, '')).trim()
  const pat = pyStr(或(模式, '')).trim()
  if (!名) {
    throw new ContentError('正则名不能空。')
  }
  if (!pat) {
    throw new ContentError('模式不能空。')
  }
  // Git Bash（MSYS）会把以 / 开头的参数当路径，就地展开成 Windows 路径：
  //   --模式 "/〔重点〕/g"  ->  E:/.../PortableGit/〔重点〕/g
  // 这会把一条正则悄悄换成一句乱码，而卡本身不报错。宁可当场拦下并说清怎么绕。
  if (/^[A-Za-z]:[\\/]/.test(pat)) {
    throw new ContentError(
      '这个模式看起来被 shell 改成路径了：\n' +
      `    ${pat}\n` +
      '  Git Bash / MSYS 会把以 / 开头的参数当路径展开。绕法：\n' +
      '    · 跑之前加一句  export MSYS_NO_PATHCONV=1')
  }
  if (_find(rules, 名, ['id', 'name'])) {
    throw new ContentError(`已经有同名正则「${名}」了（宁可重名拦下，也好过两条互相盖）。`)
  }
  const r = {
    id: `regex-${_prefix(spec)}-${切(M.uuid4hex(), 8)}`,
    name: 名, pattern: pat, replacement: pyStr(或(替换, '')),
    targets: (或(目标, ['AiOutput'])).map((x) => pyStr(x)),
    enabled: true, display_only: pyTruthy(显示用), prompt_only: false,
    run_on_edit: true,
    order: (顺序 !== null && 顺序 !== undefined) ? intPy(顺序) : _max_order(rules) + 10,
  }
  rules.push(M.ordered(r, M.REGEX_KEYS))
  commit(spec, raw, out)
  out(`已加正则「${名}」`)
  out(`  ${pat}`)
  out(`  顺序 ${r.order} · 作用 ${r.targets.join('、')}`)
  return r
}


export function del_regex(spec, 谁, out = _print) {
  const raw = load(spec)
  const rules = 或(取(raw, 'regex_rules', null), [])
  const r = _find(rules, 谁, ['id', 'name'])
  if (r === null) {
    throw new ContentError(`没有正则「${谁}」。`)
  }
  put_trash(spec, '正则', `删了正则「${或(取(r, 'name', null), '')}」`,
    [{ 表: 'regex', 位置: rules.indexOf(r),
      数据: M.plain(r) }])
  rules.splice(rules.indexOf(r), 1)
  commit(spec, raw, out)
  out(`已删正则「${或(取(r, 'name', null), '')}」`)
  trash_note(out)
  return r
}


export function set_regex(spec, 谁, 开 = true, out = _print) {
  const raw = load(spec)
  const r = _find(或(取(raw, 'regex_rules', null), []), 谁, ['id', 'name'])
  if (r === null) {
    throw new ContentError(`没有正则「${谁}」。`)
  }
  r.enabled = pyTruthy(开)
  commit(spec, raw, out)
  out(`正则「${或(取(r, 'name', null), '')}」已${开 ? '启用' : '停用'}`)
  return r
}


// ------------------------------------------------------------------ 整体
export function stats(spec) {
  const raw = load(spec)
  const v = 或(取(raw, 'variables', null), {})
  return {
    条目: entries_of(raw, false).length,
    分组: groups_of(raw, false).length,
    对象: (或(取(v, 'objects', null), [])).length,
    变量: (或(取(v, 'variables', null), [])).length,
    正则: (或(取(raw, 'regex_rules', null), [])).length,
  }
}


export function clone(src, dst, out = _print) {
  /** 把一份 spec 拷成一个新工程（只搬内容层，界面层留给 new）。 */
  mkdirSync(dirname(resolve(pyStr(dst))) || '.', { recursive: true })
  copyFileSync(src, dst)
  if (out) {
    out(`已复制 ${src} -> ${dst}`)
  }
  return dst
}
