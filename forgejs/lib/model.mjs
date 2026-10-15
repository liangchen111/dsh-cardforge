/**
 * forge.model 的 JS 版 —— 卡片数据模型：格式常量、键序、读写助手。
 * ==================================================================
 *
 * 这是重写的**地基**：键序、JSON 读写、宽度与 token 估算，全在这。
 *
 * 三条移植纪律（整份重写都适用）：
 *   1. **行为照抄，不顺手改**：`forge/model.py` 怎么写，这里就怎么写。想改行为，
 *      先改 Python 版、再同步过来 —— 否则差分测试会红，而且说不清是谁的错。
 *   2. **能逐字节比的就逐字节比**：JSON 输出、id 形状、宽度、token 数，全部有黄金样本。
 *   3. **标准库优先**：md5 用 `node:crypto`，临时目录用 `node:os`，一行依赖都不引。
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { 显示宽度 as _显示宽度 } from './east_asian_width.mjs'

export const CARD_FORMAT = 'eleckoi.character-card'
export const LIB_FORMAT = 'eleckoi.setting-library-snapshot'
export const VAR_FORMAT = 'eleckoi.variable-config'

/** 与官方写出的顺序一致。 */
export const CHARACTER_KEYS = [
  'name', 'group', 'frontend_beauty_enabled', 'profile_age', 'profile_sex',
  'profile_height', 'profile_birthday', 'profile_like', 'image_prompt',
  'opening', 'show_opening',
]
export const ENTRY_KEYS = [
  'id', 'title', 'icon_id', 'kind', 'group_id', 'content', 'opening_messages',
  'default_opening_message_id', 'agent_selection_hint', 'agent_read_strategy',
  'dynamic_mode', 'keywords', 'keyword_scan_depth',
  'condition_keywords', 'keyword_condition', 'keyword_use_regex',
  'keyword_ignore_case', 'keyword_whole_word', 'keyword_recursion_depth',
  'trigger_mode', 'enabled', 'position', 'prompt_position_id', 'insert_role',
  'order', 'view_order', 'group_view_order', 'tree_view_order', 'created_at',
  'updated_at',
]
export const ENTRY_MESSAGE_KEYS = ['id', 'title', 'content', 'initial_variable_state']
export const GROUP_KEYS = ['id', 'name', 'parent_id', 'order', 'tree_view_order',
  'created_at', 'updated_at']
export const VAR_OBJECT_KEYS = ['id', 'name', 'parent_id', 'enabled', 'description',
  'update_rule', 'dynamic_key', 'order', 'tree_view_order',
  'created_at', 'updated_at']
export const VAR_ITEM_KEYS = ['id', 'title', 'object_id', 'enabled', 'type', 'default_value',
  'description', 'update_rule', 'read_mode', 'order',
  'tree_view_order', 'created_at', 'updated_at']
export const REGEX_KEYS = ['id', 'name', 'pattern', 'replacement', 'targets', 'enabled',
  'display_only', 'prompt_only', 'run_on_edit', 'order']

/** 变量条件的运行时根路径。 */
export const STAT_ROOT = 'stat_data.'

/** /pattern/flags 形式（软件用这种写法；纯字面量如 〔面板〕 也合法）。 */
export const RE_SLASH = /^\/.*\/[gimsuy]*$/s

const CJK = /[\u3000-\u9fff\uff00-\uffef\u3040-\u30ff]/g

// ------------------------------------------------------------------ 结果类型

/**
 * 一条诊断。level 用 ERROR / WARN / INFO，机器只看前两种。
 * 形状照 Python 那边的 dataclass 抄（含 `fix` 默认空串）。
 */
export class Issue {
  constructor(level, code, where, message, fix = '') {
    this.level = level
    this.code = code
    this.where = where
    this.message = message
    this.fix = fix
  }

  line() {
    const mark = { ERROR: '✗', WARN: '!', INFO: '·' }[this.level] ?? '?'
    const tail = this.fix ? `  → ${this.fix}` : ''
    return `  ${mark} [${this.code}] ${this.where}：${this.message}${tail}`
  }
}

export const err = (code, where, message, fix = '') => new Issue('ERROR', code, where, message, fix)
export const warn = (code, where, message, fix = '') => new Issue('WARN', code, where, message, fix)
export const info = (code, where, message, fix = '') => new Issue('INFO', code, where, message, fix)

// ------------------------------------------------------------------ 小工具

/**
 * 按 keys 顺序重排，keys 之外的额外字段原样跟在后面。
 *
 * JS 的对象对字符串键保留插入顺序，所以直接按序赋值就等于 Python 的 OrderedDict。
 */
export function ordered(src, keys) {
  const out = {}
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const k of keys) if (k in src) out[k] = src[k]
    for (const [k, v] of Object.entries(src)) if (!(k in out)) out[k] = v
  }
  return out
}

/**
 * Python 那个 `plain()` 是为了喂 PyYAML（它不认 OrderedDict）。
 * JS 这边没有这层需要，但留着同名函数，免得调用点改形状。
 */
export function plain(obj) {
  if (Array.isArray(obj)) return obj.map(plain)
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) out[k] = plain(v)
    return out
  }
  return obj
}

export function jload(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * 写 JSON —— 与 Python `json.dumps(obj, ensure_ascii=False, indent=2)` 逐字节对齐。
 *
 * Python 带 indent 时默认分隔符是 `(',', ': ')`，JS 的 `JSON.stringify(v, null, 2)`
 * 正好一样；两边都不在末尾补换行。**唯一要防的是浮点与 NaN**：Python 会写
 * `NaN`/`Infinity`，JS 写成 `null` —— 卡数据里不该有这些，遇到就让差分抓出来。
 */
export function jdump(obj, path, indent = 2) {
  const text = indent === null || indent === undefined
    ? JSON.stringify(obj)
    : JSON.stringify(obj, null, indent)
  writeFileSync(path, text, { encoding: 'utf8' })
}

/** YAML：这一批还没搬，遇到就明说，别悄悄当成 JSON 读。 */
export function yload() {
  throw new Error('forgejs 还没搬 YAML 读取（计划里排在 model 的下一步）—— 先用 .json 卡稿。')
}

export function ydump() {
  throw new Error('forgejs 还没搬 YAML 写出（计划里排在 model 的下一步）—— 先写 .json。')
}

/** 按扩展名读 json / yaml。 */
export function loadStructured(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.yaml' || ext === '.yml') return yload(path)
  return jload(path)
}

export function isYaml(path) {
  const ext = extname(path).toLowerCase()
  return ext === '.yaml' || ext === '.yml'
}

/** 官方的时间戳形状：带微秒、带时区偏移。 */
export function nowIso() {
  const d = new Date()
  const 补 = (n, 位 = 2) => String(n).padStart(位, '0')
  const 偏移 = -d.getTimezoneOffset()
  const 号 = 偏移 >= 0 ? '+' : '-'
  const 绝对值 = Math.abs(偏移)
  return `${d.getFullYear()}-${补(d.getMonth() + 1)}-${补(d.getDate())}` +
    `T${补(d.getHours())}:${补(d.getMinutes())}:${补(d.getSeconds())}` +
    `.${补(d.getMilliseconds(), 3)}000` +
    `${号}${补(Math.floor(绝对值 / 60))}:${补(绝对值 % 60)}`
}

export const uuid4hex = () => randomUUID().replace(/-/g, '')

export const newId = (prefix) => `${prefix}-${uuid4hex()}`

/** 按终端里的显示宽度数：中日韩全角算 2 列，其余算 1 列。 */
export const dispWidth = (text) => _显示宽度(text)

/** 按显示宽度补空格。 */
export function pad(text, width, align = 'left') {
  const s = String(text)
  const gap = Math.max(0, width - dispWidth(s))
  return align === 'right' ? ' '.repeat(gap) + s : s + ' '.repeat(gap)
}

/**
 * 从卡名折出一个合法的 id 前缀：字母开头、纯 ASCII。
 *
 * 纯中文名折不出字母，这时退化成 fallback + 卡名的短哈希 —— 不用同一个
 * 'card' 兜住所有中文卡（那样两张中文卡的 id 会长得一模一样，混起来难认）。
 */
export function asciiPrefix(name, fallback = 'card') {
  let s = String(name ?? '').replace(/[^0-9A-Za-z]/g, '').toLowerCase()
  if (/[a-z]/.test(s)) {
    if (!/^[a-z]/.test(s)) s = fallback + s
    return s.slice(0, 16)
  }
  const h = createHash('md5').update(String(name ?? ''), 'utf8').digest('hex').slice(0, 6)
  return (fallback + h).slice(0, 16)
}

/**
 * Python 的 `round()` 是**银行家舍入**（.5 进到偶数），JS 的 `Math.round` 是 .5 进位。
 * token 估算会撞上这个差别（非 CJK 字符数 = 9 时正好落在 .5），所以照抄 Python 的语义。
 */
function 银行家(x) {
  const 下 = Math.floor(x)
  const 余 = x - 下
  if (余 > 0.5) return 下 + 1
  if (余 < 0.5) return 下
  return 下 % 2 === 0 ? 下 : 下 + 1
}

/** 粗略估算 token：中日韩字符约 1 字 1 token，其余约 3.6 字符 1 token。仅供比较。 */
export function estTokens(text) {
  if (!text) return 0
  const s = String(text)
  const cjk = (s.match(CJK) ?? []).length
  return 银行家(cjk + (s.length - cjk) / 3.6)
}

/** 建一个临时 .json 路径（与 Python 的 `tempfile.mkstemp` 形状对齐：先占位再关掉）。 */
export function tempJson() {
  const dir = mkdtempSync(join(tmpdir(), 'forgejs-'))
  const path = join(dir, 'tmp.json')
  closeSync(openSync(path, 'w'))
  return path
}

/** 去掉上传时附加的 uuid 前缀：'f3e2..._艾瑟兰 (1).json' -> '艾瑟兰 (1)'。 */
export function stripUploadPrefix(base) {
  const i = base.lastIndexOf('_')
  if (i !== -1) {
    const tail = base.slice(i + 1)
    if (tail) return tail
  }
  return base
}

/**
 * Python `repr()` 的字符串版 —— 到处在拼诊断文案（`"%r" % v`），
 * 不照抄这一层，报错文本就会对不上。
 *
 * 规则：默认单引号；串里既有单引号又有双引号、或只有双引号时才换双引号；
 * 反斜杠先转，再转引号，最后转控制字符。
 */
export function pyRepr(v) {
  if (typeof v === 'string') {
    const 有单 = v.includes("'")
    const 有双 = v.includes('"')
    const 引号 = 有单 && !有双 ? '"' : "'"
    let 体 = v.replace(/\\/g, '\\\\')
    体 = 引号 === "'" ? 体.replace(/'/g, "\\'") : 体.replace(/"/g, '\\"')
    体 = 体.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    return 引号 + 体 + 引号
  }
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'number') return String(v)
  // 列表与字典：Python 的 repr 会递归下去，这一步是差分测试逼出来的
  // （`repr(['normal'])` 是 `['normal']`，不是 `normal`）。
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`
  if (typeof v === 'object') {
    return `{${Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`
  }
  return String(v)
}
