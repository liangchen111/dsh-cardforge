/**
 * 预设 —— 把卡里的那套设定，搬成一份「创作预设」。
 *
 * **为什么要有这一件。**
 *
 * ElecKoi 里有两种容器，各自装不同的东西：
 *
 *     · 角色卡（`eleckoi.character-card`）—— 一次对话演一个人；
 *     · 创作预设（`eleckoi.agent-preset`）—— 一次对话配一套工作方式。
 *
 * 「制卡助手」这种产物，天生属于后者：它不是一张用来扮演的卡，它是一套
 * 「开新卡的时候，AI 该照什么规矩动手」的规程。以前 `forge.py` 只能出前者，
 * 用户拿到的压缩包里有 `.card.json` 却没有预设，等于这件工具最想干的事没落地。
 *
 * **格式是从客户端源码里抄出来的**（`@eleckoi/dsh-product-data` 的
 * `AgentPresetImportCodec.ts`，v2）：
 *
 *     { "format": "eleckoi.agent-preset", "version": 2,
 *       "preset": { "purpose": "creator", "name": …, "entries": [...], … } }
 *
 * 三条客户端规矩，一条都绕不开：
 *
 *     · `version: 2` 才带 `purpose`，且导入时必须与用户选的分类一致
 *       （拿角色扮演分类导创作预设，客户端会拒）；
 *     · 条目 `kind` / `position` / `agent_read_strategy` 等是**白名单枚举**，
 *       值不在表里整条会被拒；`position` 只认 `instructions` 与 `insert_point_1..5`
 *       （艾瑟兰那轮修过的非法 `after_character` 就是栽在这里）；
 *     · 条目里引用的 `prompt_position_id` 必须真的存在。
 *
 * **从卡到预设的搬运是「减」，不是「换」** —— 卡与预设共用同一套设定库条目结构
 * （同一个 `ENTRY_KEYS`，只多一个 `content_mode`），所以这一件不发明；真正要做的
 * 判断只有一条：**卡里的引擎条目（隐藏工具时间线、历史压缩）不进创作预设**，
 * 那是扮演用的机件，搬到创作侧只会让 AI 每轮都去查设定库。
 *
 * ============================================================ 移植记号 ===
 *
 * 从 `forge/preset.py`（500 行）逐字节移植。Python 的边角语义与 JS 差得远，
 * 下面这些是**踩过或差点踩到**的，改这个文件之前先读一遍：
 *
 * ★1 `dict.get(k, d)` ≠ `??`：Python 只在**键不在**时给默认值，键在而值为
 *    `None` 时给的就是 `None`。本文件一律走 `_get(o, k, d)`（`k in o` 判键）。
 *    另外 `_get` 对非字典（str/list/None……）会照 Python 的口气抛
 *    `AttributeError: 'str' object has no attribute 'get'`。
 * ★2 `k in src` 在 Python 里**按 src 的类型走三套语义**：str 是子串、
 *    list/tuple 是成员、dict 是键；对不可迭代的类型抛
 *    `TypeError: argument of type 'int' is not iterable`。⇒ 一律走 `_in(k, o)`。
 * ★3 `bool(x)` 不能用 JS 的 `Boolean(x)`：`[]` / `{}` 在 Python 是**假**，
 *    在 JS 是**真**。⇒ 一律走 `CONTENT.pyTruthy`（`enabled` / `keywords` 那种开关）。
 * ★4 `int(x)` 抛的是 **ValueError**，而 `content.mjs` 的 `intPy()` 抛的是
 *    `TypeError`；差一个类名差分台当场红。⇒ 自带 `_intPy`，口气照抄本机实测：
 *    `invalid literal for int() with base 10: 'abc'` /
 *    `int() argument must be a string, a bytes-like object or a real number, not 'NoneType'`
 *    （Python 3.13 的措辞是 `a real number`，不是旧的 `a number`）/
 *    `cannot convert float NaN to integer`。
 *    已知边界：Python 的 `int()` 还认下划线（`int('1_0')==10`）与全角数字，
 *    `_intPy` 不认 —— 语料不碰这两样。
 * ★5 `str(x)`：容器要走 `repr()`（`str(['a'])` 是 `['a']`、`str({'a':1})` 是
 *    `{'a': 1}`），`content.pyStr` 只管标量。⇒ 本文件的 `_str` 对 object 转 `M.pyRepr`。
 *    同理 `"%s" % None` 是 `None`、`"%s" % True` 是 `True`。
 * ★6 `len(s)` / `s[i]` 按**码点**，JS 按 UTF-16 码元。⇒ `_lenPy`（str 走 `lenPy`，
 *    list 走 `length`，dict 走键数，别的照 Python 抛 `TypeError`）。
 * ★7 `str.strip()` 比 JS 的 `trim()` **宽 `\x1c`–`\x1f`、`\x85`**，又**不吃 `\ufeff`**
 *    （JS 的 trim 会把 BOM 当空白吃掉）。⇒ 照抄 `opener.mjs:113-123` 的
 *    `_PY空白` / `_STRIP` / `_strip`，一个字都别改。
 * ★8 `os.path` 与 JS 的 path 不是一个东西（Python 保留原有 `/`，Node 统一成 `\`）。
 *    ⇒ 路径一律走 `theme.mjs` 的 `_join/_basename/_dirname/_splitext/_abspath/_isdir`
 *    （那份已与 ntpath 逐字节对拍过；`opener.mjs` 里那份是故意不同的另一个）。
 * ★9 读文件的 OSError 文本只能硬抄（Node 的错误对象没有 `winerror`）：
 *    `[Errno 2] No such file or directory: '<原样路径>'`；
 *    读**目录**在 Windows 上 Python 给的是 **`[Errno 13] Permission denied: '<路径>'`**
 *    （不是 Errno 21）—— 这与 `png.mjs` 的 `EISDIR→[Errno 21] Is a directory`
 *    不一样，那条是 png 那边自己的边界，别互相照着改。
 * ★10 `data.decode("utf-8")` 对坏字节抛 `UnicodeDecodeError`，而 Node 的
 *    `Buffer.toString('utf8')` 会**悄悄换成 U+FFFD**（差分台看不出来、落盘却是错的）。
 *    ⇒ 自己扫一遍字节（`_解码`），两种口气逐字照抄本机实测：
 *    `'utf-8' codec can't decode byte 0xff in position 0: invalid start byte` /
 *    `'utf-8' codec can't decode bytes in position 0-1: unexpected end of data`。
 * ★11 JSON 解析失败的措辞两边天生不同（Python `Expecting property name enclosed in
 *    double quotes: line 1 column 2 (char 1)` vs Node 的 `Unexpected token …`），
 *    连**异常类名都不同**（`JSONDecodeError` vs `SyntaxError`）。
 *    ⇒ 唯一一处走纪律 14 的「申报差异」：差分台两侧各有一张同样的折叠表，
 *    把「解析器原话」折成 `<解析器说>`（见 `差分/出黄金.py`、`差分/比一比.mjs` 的 `算_preset`）。
 * ★12 **本地异常类名必须逐字照抄**：差分台按 `exc.constructor.name` 记账
 *    （Python 是 `type(exc).__name__`）。故本文件自带
 *    `PresetError` / `AttributeError` / `ValueError` / `TypeError` / `UnicodeDecodeError`
 *    / `FileNotFoundError` / `PermissionError`（后三个是 WinError 文本的载体）。
 *    `TypeError` 在这里**遮蔽了全局的那个**，这是故意的。
 * ★13 `if not versions` 这类「真值判断」也要走 `pyTruthy`（空的 dict/list 在 Python 是假）。
 * ★14 `json.dumps` 与 `JSON.stringify` 的差异：本模块的数据里没有非整数 float
 *    （`21.0` vs `21` 的坑够不着），`ensure_ascii=False` 与 JS 的裸 UTF-8 一致，
 *    `indent=2` 的分隔符也一致。⇒ `_dump` 直接用 `JSON.stringify(doc, null, 2)`。
 * ★15 `"%r"` 一律 `M.pyRepr`（差分台两侧都用它，别自己拼引号）。
 * ★16 **白名单校验要用「成员测试」，不能用「选取 + 真值」**：`TRIGGER_MODES` 里有一个
 *    **空串**（它就是"不收"这一档的合法值），而空串在 JS 里是**假值** ⇒
 *    `verify` 里若写成 `!_pick(e.trigger_mode, TRIGGER_MODES, null)`，合法的
 *    `trigger_mode=''` 会当场被判成「不收」（差分台第一次红的原话：
 *    `PresetError: 预设自检没过（2 处）：entries[1] trigger_mode='' 不收`）。
 *    Python 那句是 `e.get("trigger_mode") not in TRIGGER_MODES` ⇒ 一律用 `_in(x, 表)`。
 *    （`_entry` 里的 `_pick` 是**取值**，那里照抄 Python 的 `if … in … else ""`，没问题。）
 *
 * 两边语言天生不同、已知边界（**别去撞，也别为了它们改语法**）：
 *
 *     · `pyIn` 用 `pyEq`，而 Python 的 `==` 认为 `True == 1`：`1 in (True,)` 在
 *       Python 是真、在这边是假。本模块的白名单表里没有布尔值，够不着。
 *     · `set` 去重的 `seen`：Python 的 `{1}` 与 `{True}` 是同一个元素，JS 的
 *       `Set` 分得开。`verify` 拿它查 id 重复，id 本该是字符串。
 *     · Python 的 `int()` 认下划线与全角数字（见 ★4）。
 *     · `json.loads` 能解出顶层不是对象的值（`123`、`[1]`），随后 Python 报
 *       `AttributeError: 'int' object has no attribute 'get'` —— `_get` 照抄了这个口气。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import * as M from './model.mjs'
import * as PNG from './png.mjs'
import * as SB from './sandbox.mjs'
import { pyTruthy, pyStr, pyEq, 或, 或 as _或, _错文, _print } from './content.mjs'
import { _join, _basename, _dirname, _splitext, _abspath, _isdir } from './theme.mjs'

export const FORMAT = 'eleckoi.agent-preset'
export const VERSION = 2                       // v2 = 带 purpose，客户端会要求分类对齐
export const PURPOSE = 'creator'
export const PNG_KEY = PNG.KEYWORD.preset      // eleckoi_agent_preset
export const MAX_BYTES = 64 * 1024 * 1024      // 客户端整份输入的上限（codec MAX_INPUT_BYTES）

export const MODEL_FAMILIES = ['general', 'claude', 'openai', 'gemini', 'deepseek', 'other']

// 客户端的白名单（codec 里的 Set）。值落不进去的，整条会被丢掉或报错。
export const KINDS = ['normal', 'opening', 'history_compaction', 'hidden_tool_timeline']
export const READ_STRATEGIES = ['required', 'keyword', 'normal']
export const DYNAMIC_MODES = ['standard', 'ejs_reference']
export const CONTENT_MODES = ['plain_text', 'ejs']
export const KEYWORD_CONDITIONS = ['none', 'any', 'all', 'not_any']
export const POSITIONS = ['instructions', 'insert_point_1', 'insert_point_2',
  'insert_point_3', 'insert_point_4', 'insert_point_5']
export const INSERT_ROLES = ['system', 'user', 'assistant']
export const TRIGGER_MODES = ['always', 'agent_tool', '']
export const SIDES = ['before_setting_position', 'after_setting_position']

// 扮演机件：留在卡里，不搬进创作预设
export const ENGINE_KINDS = ['hidden_tool_timeline', 'history_compaction']

// 条目键序 = 卡的那一套，只在 dynamic_mode 后面插一个 content_mode
export const ENTRY_KEYS = (() => {
  const 键 = [...M.ENTRY_KEYS]
  键.splice(键.indexOf('dynamic_mode') + 1, 0, 'content_mode')
  return 键
})()

export const POSITION_KEYS = ['id', 'name', 'anchor', 'side', 'order', 'created_at', 'updated_at']
export const TOOL_GROUPS_DEFAULT = ['builtin:creator']

// 时间戳写死 —— 同一份卡跑两次必须得到同一份预设（PNG 要进指纹，字节得稳）
export const EPOCH = 0

/** 预设这一层的事 —— 内容/来源不对，说一句人话就够。 */
export class PresetError extends Error {
  constructor(消息) { super(消息); this.name = 'PresetError' }
}

// ---- 本地异常类：**类名是差分台记账的一部分**（见移植记号 ★12）----
export class AttributeError extends Error {
  constructor(消息) { super(消息); this.name = 'AttributeError' }
}
export class ValueError extends Error {
  constructor(消息) { super(消息); this.name = 'ValueError' }
}
/** 遮蔽全局的 TypeError：差分台按 `constructor.name` 记账。 */
export class TypeError extends Error {
  constructor(消息) { super(消息); this.name = 'TypeError' }
}
export class UnicodeDecodeError extends Error {
  constructor(消息) { super(消息); this.name = 'UnicodeDecodeError' }
}
export class FileNotFoundError extends Error {
  constructor(消息) { super(消息); this.name = 'FileNotFoundError' }
}
export class PermissionError extends Error {
  constructor(消息) { super(消息); this.name = 'PermissionError' }
}

// ---------------------------------------------------------------- 小工具
/** Python 的 `type(v).__name__`。 */
export function _类型名(v) {
  if (v === null || v === undefined) return 'NoneType'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float'
  if (typeof v === 'string') return 'str'
  if (Array.isArray(v)) return 'list'
  if (typeof v === 'object') return 'dict'
  return typeof v
}

/** Python 的 `d.get(k, d默认)`（★1）。 */
export function _get(o, k, d = null) {
  if (!(o !== null && typeof o === 'object' && !Array.isArray(o))) {
    throw new AttributeError(`'${_类型名(o)}' object has no attribute 'get'`)
  }
  return k in o ? o[k] : d
}

/** Python 的 `k in o`（★2，按 o 的类型走三套语义）。 */
export function _in(k, o) {
  if (typeof o === 'string') return o.includes(k)
  if (Array.isArray(o)) return o.some((x) => pyEq(x, k))
  if (o !== null && typeof o === 'object') return k in o
  throw new TypeError(`argument of type '${_类型名(o)}' is not iterable`)
}

/** Python 的 `for x in o`（dict 迭代给的是键）。 */
export function _iter(o) {
  if (Array.isArray(o)) return o
  if (typeof o === 'string') return Array.from(o)
  if (o !== null && typeof o === 'object') return Object.keys(o)
  throw new TypeError(`'${_类型名(o)}' object is not iterable`)
}

/** Python 的 `len(o)`（★6）。 */
export function _lenPy(o) {
  if (typeof o === 'string') return Array.from(o).length
  if (Array.isArray(o)) return o.length
  if (o !== null && typeof o === 'object') return Object.keys(o).length
  throw new TypeError(`object of type '${_类型名(o)}' has no len()`)
}

/** Python 的 `str(v)`（★5：容器走 repr）。 */
export function _str(v) {
  return (v !== null && typeof v === 'object') ? M.pyRepr(v) : pyStr(v)
}

// Python 的 `str.isspace()` 那一套：比 JS 的 `trim()` **宽 `\x1c`–`\x1f`、`\x85`**，
// 又**不含 `\ufeff`**（JS 的 trim 会把 BOM 当空白吃掉）。差一个字符就是差一个字节。
// （照抄 opener.mjs:113-123。）
const _PY空白 = '\t\n\v\f\r \x1c\x1d\x1e\x1f\x85\u00a0\u1680' +
  '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a' +
  '\u2028\u2029\u202f\u205f\u3000'
const _STRIP = new RegExp(`^[${_PY空白}]+|[${_PY空白}]+$`, 'g')

/** Python 的 `s.strip()`（★7）。 */
export function _strip(s) { return String(s).replace(_STRIP, '') }

/** Python 的 `int(v)`（★4：抛的是 ValueError，不是 TypeError）。 */
export function _intPy(v) {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') {
    if (Number.isNaN(v)) throw new ValueError('cannot convert float NaN to integer')
    if (!Number.isFinite(v)) {
      throw new ValueError(`cannot convert float ${v > 0 ? 'infinity' : '-infinity'} to integer`)
    }
    return Math.trunc(v)
  }
  if (typeof v === 'string') {
    const t = _strip(v)
    if (!/^[+-]?\d+$/.test(t)) {
      throw new ValueError(`invalid literal for int() with base 10: ${M.pyRepr(v)}`)
    }
    return Number.parseInt(t, 10)
  }
  throw new ValueError('int() argument must be a string, a bytes-like object or a real number,'
    + ` not '${_类型名(v)}'`)
}

/** Python 的 `v if v in 列 else 默认`（★15 之外的白名单选取）。 */
export function _pick(value, allowed, fallback) {
  return allowed.some((x) => pyEq(x, value)) ? value : fallback
}

/** Node 的 `readFileSync` 错误 → Python 的 OSError 文本（★9）。 */
function _文件错(p, exc) {
  const code = exc && exc.code
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new FileNotFoundError(`[Errno 2] No such file or directory: '${p}'`)
  }
  if (code === 'EISDIR' || code === 'EACCES' || code === 'EPERM') {
    return new PermissionError(`[Errno 13] Permission denied: '${p}'`)
  }
  return exc
}

/** `open(p, "rb").read()`。 */
export function _读字节(p) {
  try {
    return readFileSync(p)
  } catch (exc) {
    throw _文件错(p, exc)
  }
}

/** `bytes.decode("utf-8")` —— 严格解码（★10），坏字节的口气照抄 CPython。 */
export function _解码(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const 十六 = (x) => '0x' + x.toString(16).padStart(2, '0')
  let i = 0
  while (i < b.length) {
    const c = b[i]
    if (c < 0x80) { i += 1; continue }
    let 要
    if (c >= 0xc2 && c <= 0xdf) 要 = 2
    else if (c >= 0xe0 && c <= 0xef) 要 = 3
    else if (c >= 0xf0 && c <= 0xf4) 要 = 4
    else {
      throw new UnicodeDecodeError("'utf-8' codec can't decode byte " + 十六(c)
        + ` in position ${i}: invalid start byte`)
    }
    if (i + 要 > b.length) {
      throw new UnicodeDecodeError("'utf-8' codec can't decode bytes in position "
        + `${i}-${b.length - 1}: unexpected end of data`)
    }
    for (let j = 1; j < 要; j += 1) {
      const cc = b[i + j]
      const 首 = b[i]
      const 坏 = (cc < 0x80 || cc > 0xbf)
        || (j === 1 && 首 === 0xe0 && cc < 0xa0)      // 过长的三字节
        || (j === 1 && 首 === 0xed && cc > 0x9f)      // 代理对
        || (j === 1 && 首 === 0xf0 && cc < 0x90)      // 过长的四字节
        || (j === 1 && 首 === 0xf4 && cc > 0x8f)      // 超出 U+10FFFF
      if (坏) {
        throw new UnicodeDecodeError("'utf-8' codec can't decode byte " + 十六(首)
          + ` in position ${i}: invalid continuation byte`)
      }
    }
    i += 要
  }
  return b.toString('utf8')
}

/** `open(p, encoding="utf-8").read()`。 */
export function _读文本(p) { return _解码(_读字节(p)) }

// ---------------------------------------------------------------- 取值
/**
 * 卡里的设定库是一段**字符串化的 JSON**（`setting_library` 是 str，不是 dict）。
 *
 * 直接 `native['setting_library']['versions']` 会报 `'str' object is not
 * subscriptable` —— 这一条踩过一次，写在这里省得下一个人再踩。
 */
export function _lib_snapshot(native) {
  const raw = _get(native, 'setting_library')
  let snap
  if (typeof raw === 'string') {
    try {
      snap = JSON.parse(raw)
    } catch (exc) {
      throw new PresetError(`设定库那段 JSON 解不开：${_错文(exc)}`)
    }
  } else if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    snap = raw
  } else {
    throw new PresetError('这张卡里没有设定库（setting_library 是空的）')
  }

  const 格式 = _get(snap, 'format')
  if (pyTruthy(格式) && 格式 !== M.LIB_FORMAT) {
    throw new PresetError(`设定库格式不对：${M.pyRepr(格式)}（应该是 ${M.pyRepr(M.LIB_FORMAT)}）`)
  }
  return snap
}

export function _active_version(snap) {
  const versions = 或(_get(snap, 'versions'), [])
  if (!pyTruthy(versions)) {
    throw new PresetError('设定库里一条版本都没有')
  }
  const want = _get(snap, 'active_version_id')
  for (const v of _iter(versions)) {
    if (pyTruthy(want) && pyEq(_get(v, 'id'), want)) return v
  }
  return versions[0]
}

/** 一条设定：照卡里的原样搬，缺的补默认，非法的收回白名单内。 */
export function _entry(src, index) {
  const out = {}
  for (const k of ENTRY_KEYS) {
    if (k === 'content_mode') {
      out[k] = _pick(_get(src, 'content_mode'), CONTENT_MODES, 'plain_text')
    } else if (_in(k, src)) {
      out[k] = src[k]
    } else {
      out[k] = (k in _DEFAULTS) ? _DEFAULTS[k] : ''
    }
  }
  out.id = _或(_get(src, 'id'), `entry-${index + 1}`)
  out.kind = _pick(_get(src, 'kind'), KINDS, 'normal')
  out.agent_read_strategy = _pick(_get(src, 'agent_read_strategy'), READ_STRATEGIES, 'normal')
  out.dynamic_mode = _pick(_get(src, 'dynamic_mode'), DYNAMIC_MODES, 'standard')
  out.content_mode = _pick(_get(src, 'content_mode'), CONTENT_MODES, 'plain_text')
  out.keyword_condition = _pick(_get(src, 'keyword_condition'), KEYWORD_CONDITIONS, 'none')
  out.position = _pick(_get(src, 'position'), POSITIONS, null)
  out.insert_role = _pick(_get(src, 'insert_role'), INSERT_ROLES, 'system')
  out.trigger_mode = _pick(_get(src, 'trigger_mode'), TRIGGER_MODES, '')
  out.enabled = pyTruthy(_get(src, 'enabled', true))
  out.keywords = _iter(或(_get(src, 'keywords'), [])).map(_str)
  out.condition_keywords = _iter(或(_get(src, 'condition_keywords'), [])).map(_str)
  const msgs = []
  for (const m of _iter(或(_get(src, 'opening_messages'), []))) {
    const mm = {}
    for (const mk of M.ENTRY_MESSAGE_KEYS) {
      mm[mk] = _get(m, mk, mk === 'initial_variable_state' ? {} : '')
    }
    msgs.push(mm)
  }
  out.opening_messages = msgs
  for (const ik of ['order', 'view_order', 'group_view_order', 'tree_view_order']) {
    out[ik] = _intPy(或(_get(src, ik), 0))
  }
  for (const nk of ['keyword_scan_depth', 'keyword_recursion_depth']) {
    out[nk] = _intPy(或(_get(src, nk), 0))
  }
  for (const bk of ['keyword_use_regex', 'keyword_ignore_case', 'keyword_whole_word']) {
    out[bk] = pyTruthy(_get(src, bk, false))
  }
  return M.plain(out)
}

export const _DEFAULTS = {
  title: '', icon_id: '', group_id: '', content: '',
  default_opening_message_id: '', agent_selection_hint: '',
  prompt_position_id: '', created_at: '', updated_at: '',
}

export function _group(src, index) {
  const out = {}
  for (const k of M.GROUP_KEYS) {
    if (_in(k, src)) out[k] = src[k]
  }
  out.id = _或(_get(src, 'id'), `group-${index + 1}`)
  out.name = _或(_get(src, 'name'), '')
  out.parent_id = _或(_get(src, 'parent_id'), '')
  out.order = _intPy(或(_get(src, 'order'), 0))
  out.tree_view_order = _intPy(或(_get(src, 'tree_view_order'), 0))
  out.created_at = _或(_get(src, 'created_at'), '')
  out.updated_at = _或(_get(src, 'updated_at'), '')
  return M.plain(out)
}

export function _position(src, index) {
  const out = {}
  for (const k of POSITION_KEYS) {
    out[k] = _get(src, k, k === 'order' ? 0 : '')
  }
  out.id = _或(_get(src, 'id'), `position-${index + 1}`)
  out.name = _或(_get(src, 'name'), '')
  out.anchor = _pick(_get(src, 'anchor'), POSITIONS, 'instructions')
  out.side = _pick(_get(src, 'side'), SIDES, 'after_setting_position')
  out.order = _intPy(或(_get(src, 'order'), 0))
  return M.plain(out)
}

export function _regex(src, index) {
  const out = {}
  for (const k of M.REGEX_KEYS) {
    if (_in(k, src)) out[k] = src[k]
  }
  out.id = _或(_get(src, 'id'), `regex-${index + 1}`)
  out.name = _或(_get(src, 'name'), '')
  out.pattern = _或(_get(src, 'pattern'), '')
  out.replacement = _或(_get(src, 'replacement'), '')
  out.targets = [..._iter(或(_get(src, 'targets'), []))]
  for (const bk of ['enabled', 'display_only', 'prompt_only', 'run_on_edit']) {
    out[bk] = pyTruthy(_get(src, bk, false))
  }
  out.order = _intPy(或(_get(src, 'order'), 0))
  return M.plain(out)
}

// ---------------------------------------------------------------- 组装
/**
 * 读一张**原生卡 JSON**，拼出预设信封（dict），不落盘。
 *
 * 返回 `{"doc": 信封, "dropped": [被丢掉的引擎条目标题], "stats": {…}}`。
 */
export function from_card(card_path, name = null, author = '', instructions = null,
  tool_groups = null, version_name = '', drop_engine = true, out = _print) {
  const native = JSON.parse(_读文本(card_path))
  const fmt = _get(native, 'format')
  if (fmt !== M.CARD_FORMAT) {
    throw new PresetError('这不是 ElecKoi 角色卡（format=' + M.pyRepr(fmt)
      + '，应该是 ' + M.pyRepr(M.CARD_FORMAT) + '）')
  }

  const snap = _lib_snapshot(native)
  const ver = _active_version(snap)

  let raw_entries = [..._iter(或(_get(ver, 'entries'), []))]
  const dropped = []
  if (pyTruthy(drop_engine)) {
    const keep = []
    for (const e of raw_entries) {
      if (_pick(_get(e, 'kind'), ENGINE_KINDS, null) !== null) {
        dropped.push(`${_或(_get(e, 'title'), '?')}（${_get(e, 'kind')}）`)
      } else {
        keep.push(e)
      }
    }
    raw_entries = keep
  }

  const entries = raw_entries.map((e, i) => _entry(e, i))
  const groups = _iter(或(_get(ver, 'groups'), [])).map((g, i) => _group(g, i))
  const positions = _iter(或(_get(ver, 'prompt_positions'), [])).map((p, i) => _position(p, i))
  const regexes = _iter(或(_get(native, 'regex_rules'), [])).map((r, i) => _regex(r, i))

  // 条目引用的插入位必须真的存在，否则客户端那侧对不上
  const ids = new Set(positions.map((p) => p.id))
  for (const e of entries) {
    if (pyTruthy(e.prompt_position_id) && !ids.has(e.prompt_position_id)) {
      e.prompt_position_id = ''
    }
  }

  const card_name = _strip(或(_get(或(_get(native, 'character'), {}), 'name'), ''))
  const pname = _strip(或(或(name, card_name), '未命名预设'))
  const pid = 'forge-' + M.asciiPrefix(pname, 'preset')

  if (instructions === null || instructions === undefined) {
    instructions = _auto_instructions(pname, entries, groups)
  }
  const groups_in = 或(tool_groups, TOOL_GROUPS_DEFAULT)

  const content = {}
  content.entries = entries
  content.groups = groups
  content.regex_rules = regexes
  content.prompt_positions = positions
  content.tool_configuration = {
    included_group_ids: [..._iter(groups_in)],
    enabled_group_ids: [..._iter(groups_in)],
  }
  content.roleplay_plan = null
  content.expanded_group_ids = []

  const version = {}
  version.id = `${pid}:v1`
  version.number = 1
  version.name = _strip(或(version_name, pname))
  version.created_at_epoch_ms = EPOCH
  version.usage_instructions = instructions
  version.timeline = []
  for (const [k, v] of Object.entries(content)) version[k] = v

  const preset = {}
  preset.name = pname
  preset.purpose = PURPOSE        // 客户端自己的编码器就是 name 之后（codec :117-119）
  preset.model_family = 'general'
  preset.model_tags = []
  preset.profile = {
    author_name: 或(author, ''),
    usage_instructions: instructions,
    timeline: [],
  }
  preset.active_version_id = version.id
  preset.active_version_number = 1
  for (const [k, v] of Object.entries(content)) preset[k] = v
  preset.versions = [version]

  const doc = { format: FORMAT, version: VERSION, preset }

  const stats = {
    entries: entries.length, groups: groups.length,
    regex: regexes.length, positions: positions.length,
    常驻: entries.filter((e) => e.trigger_mode === 'always').length,
    必读: entries.filter((e) => e.agent_read_strategy === 'required').length,
    字: entries.reduce((n, e) => n + _lenPy(或(e.content, '')), 0),
  }
  if (pyTruthy(out)) {
    out(`  预设内容：${stats.entries} 条设定 · ${stats.groups} 组 · ${stats.regex} 条正则`
      + ` · ${stats.positions} 个插入位`)
    if (dropped.length) {
      out(`  留在卡里没搬过来的引擎条目 ${dropped.length} 条：${dropped.join(' · ')}`)
    }
  }
  return { doc, dropped, stats }
}

/** 没说就自动写一段 —— 预设管理器里那一栏总得有字，否则两个预设分不清。 */
export function _auto_instructions(pname, entries, groups) {
  const titles = entries.filter((e) => pyTruthy(_get(e, 'title'))).map((e) => e.title)
  const head = titles.slice(0, 4).join(' · ') + (titles.length > 4 ? '…' : '')
  return ('「' + _str(pname) + '」的创作预设：把这张卡里的 ' + String(_lenPy(entries)) + ' 条设定搬了过来'
    + (pyTruthy(head) ? `（${head}）` : '') + '。\n'
    + '选中它之后，AI 手里就有这套设定与规程，可以照着开新卡、改老卡。\n'
    + '第一句直接说你要什么就行，比如「我要做一张都市怪谈的卡」。'
    + '说了题材，它会先跟你把规划书过一遍，再一层一层问，不会一上来就写正文。\n'
    + '装了「制卡工坊」插件的话，它自己就能调本机的 forge.py 落盘；'
    + '没装也行，只是最后那步要你自己照它给的内容跑命令。')
}

// ---------------------------------------------------------------- 落盘
/** `制卡助手.card.json` / `制卡助手.preset.json` -> `制卡助手`。 */
export function _stem(name) {
  let stem = _basename(name)
  let 命中 = false
  for (const suf of ['.spec.yaml', '.spec.yml', '.card.json', '.preset.json',
    '.yaml', '.yml', '.json']) {
    if (stem.toLowerCase().endsWith(suf)) {
      stem = stem.slice(0, stem.length - suf.length)
      命中 = true
      break
    }
  }
  if (!命中) stem = _splitext(stem)[0]
  for (const suf of ['.card', '.preset']) {
    if (stem.toLowerCase().endsWith(suf)) stem = stem.slice(0, stem.length - suf.length)
  }
  return stem
}

/** `<名>.card.json` -> `<名>.preset.json`；`source/` 里的出到同工程 `成品/`。 */
export function default_out(src) {
  let d = _dirname(_abspath(src))
  const stem = _stem(src)
  if (_basename(d).toLowerCase() === 'source') {
    const made = _join(_dirname(d), '成品')
    if (_isdir(made)) d = made
  }
  return _join(d, stem + '.preset.json')
}

export function _dump(doc) {
  return Buffer.from(JSON.stringify(doc, null, 2), 'utf8')
}

/** 出一份 `.preset.json`。返回 from_card 的结果 + 落盘信息。 */
export function build(card_path, out_path = null, name = null, author = '', instructions = null,
  tool_groups = null, version_name = '', drop_engine = true, quiet = false, out = _print) {
  const got = from_card(card_path, name, author, instructions,
    tool_groups, version_name, drop_engine, out)
  const doc = got.doc
  const data = _dump(doc)
  if (data.length > MAX_BYTES) {
    throw new PresetError(`预设 ${data.length} 字节，超过客户端 ${MAX_BYTES / 1048576} MB 上限`)
  }
  if (out_path === null || out_path === undefined) {
    out_path = default_out(card_path)
  }

  const d = _dirname(_abspath(out_path))
  if (pyTruthy(d) && !_isdir(d)) {
    mkdirSync(d, { recursive: true })
  }
  const tmp = out_path + '.part'    // 同目录临时文件：跨盘 os.replace 会 WinError 17
  writeFileSync(tmp, data)
  SB.land(tmp, out_path)
  SB.cleanup(tmp)

  got.json = out_path
  got.bytes = data.length
  if (!pyTruthy(quiet)) {
    out(`写出：${out_path}（${data.length} 字节）`)
    out('  用法：ElecKoi「预设管理器 → 导入预设」选这份文件，分类选**创作预设**')
  }
  return got
}

/** 预设也能装进 PNG —— 客户端认的是 `tEXt eleckoi_agent_preset`。 */
export function build_png(preset_path, out_path = null, cover = null, quiet = false, out = _print) {
  out_path = 或(out_path, _join(_dirname(_abspath(preset_path)),
    _stem(preset_path) + '.preset.png'))
  const res = PNG.write(preset_path, out_path, cover, 'preset', quiet, false, out)
  PNG.verify(res.png)
  return res
}

// ---------------------------------------------------------------- 自检
/**
 * 照客户端的口径把产物复读一遍 —— 值落不进白名单的当场报出来。
 *
 * 「导出成功但导不进去」是这份工具最该防的事：`format` 对了不代表条目合法，
 * 客户端的 `entryFromPortable` 遇到表外的 `kind` 会直接抛。
 */
export function verify(path, out = _print) {
  const data = _读字节(path)
  if (data.length > MAX_BYTES) {
    throw new PresetError(`整份 ${data.length} 字节，超过客户端 ${MAX_BYTES / 1048576} MB 上限`)
  }
  let root
  try {
    root = JSON.parse(_解码(data))
  } catch (exc) {
    throw new PresetError(`读不了预设 JSON：${_错文(exc)}`)
  }

  const 格式 = _get(root, 'format')
  if (格式 !== FORMAT) {
    throw new PresetError(`format 不对（拿到 ${M.pyRepr(格式)}，客户端要 ${M.pyRepr(FORMAT)}）`)
  }
  const 版本 = _get(root, 'version')
  if (![1, VERSION].some((x) => pyEq(x, 版本))) {
    throw new PresetError(`version 不对（拿到 ${M.pyRepr(版本)}，客户端只认 1 / ${VERSION}）`)
  }
  const pr = _get(root, 'preset')
  if (!(pr !== null && typeof pr === 'object' && !Array.isArray(pr))) {
    throw new PresetError('没有 preset 这一层（客户端会报「不是 ElecKoi 预设」）')
  }
  if (pyEq(版本, 2) && !pyEq(_get(pr, 'purpose'), PURPOSE)) {
    throw new PresetError(`version 2 的 purpose 必须是 ${M.pyRepr(PURPOSE)}，拿到 `
      + `${M.pyRepr(_get(pr, 'purpose'))} —— 客户端会因为分类对不上而拒收`)
  }

  const entries = 或(_get(pr, 'entries'), [])
  if (!Array.isArray(entries)) {
    throw new PresetError('entries 不是列表')
  }
  const bad = []
  const seen = new Set()
  entries.forEach((e, i) => {
    const where = `entries[${i}]`
    if (!(e !== null && typeof e === 'object' && !Array.isArray(e))) {
      bad.push(`${where} 不是对象`); return
    }
    if (!_in(_get(e, 'kind'), KINDS)) {
      bad.push(`${where} kind=${M.pyRepr(_get(e, 'kind'))} 不在白名单`)
    }
    if (!_in(_get(e, 'agent_read_strategy'), READ_STRATEGIES)) {
      bad.push(`${where} agent_read_strategy=${M.pyRepr(_get(e, 'agent_read_strategy'))} 不在白名单`)
    }
    if (!_in(_get(e, 'dynamic_mode'), DYNAMIC_MODES)) {
      bad.push(`${where} dynamic_mode=${M.pyRepr(_get(e, 'dynamic_mode'))} 不在白名单`)
    }
    if (!_in(_get(e, 'content_mode'), CONTENT_MODES)) {
      bad.push(`${where} content_mode=${M.pyRepr(_get(e, 'content_mode'))} 不在白名单`)
    }
    const pos = _get(e, 'position')
    if (pos !== null && !_in(pos, POSITIONS)) {
      bad.push(`${where} position=${M.pyRepr(pos)} 不在白名单（只认 instructions 与 insert_point_1..5）`)
    }
    // ★ TRIGGER_MODES 里有**空串**（"不收"就是它）⇒ 这里必须是成员测试，
    //   不能写成 `!_pick(...)`：空串在 JS 里是假值，`!_pick` 会把合法的 "" 判成不收。
    if (!_in(_get(e, 'trigger_mode'), TRIGGER_MODES)) {
      bad.push(`${where} trigger_mode=${M.pyRepr(_get(e, 'trigger_mode'))} 不收`)
    }
    const extra = Object.keys(e).filter((k) => !ENTRY_KEYS.includes(k))
    if (extra.length) {
      bad.push(`${where} 带了客户端不认的键：${M.pyRepr(extra)}`)
    }
    const eid = _get(e, 'id')
    if (!pyTruthy(eid)) {
      bad.push(`${where} 没有 id`)
    } else if (seen.has(eid)) {
      bad.push(`${where} id 重复：${_str(eid)}`)
    }
    seen.add(eid)
  })
  const pids = new Set(_iter(或(_get(pr, 'prompt_positions'), [])).map((p) => _get(或(p, {}), 'id')))
  entries.forEach((e, i) => {
    if (e !== null && typeof e === 'object' && !Array.isArray(e)
      && pyTruthy(_get(e, 'prompt_position_id')) && !pids.has(e.prompt_position_id)) {
      bad.push(`entries[${i}] 引用了不存在的插入位 ${M.pyRepr(e.prompt_position_id)}`)
    }
  })

  if (bad.length) {
    throw new PresetError(`预设自检没过（${bad.length} 处）：\n    ${bad.slice(0, 20).join('\n    ')}`)
  }

  if (pyTruthy(out)) {
    out(`✔ 自检：${_basename(path)} · ${data.length} 字节 · ${_str(_get(pr, 'name'))}`
      + ` · ${entries.length} 条设定 · ${_lenPy(或(_get(pr, 'groups'), []))} 组`
      + ` · ${_lenPy(或(_get(pr, 'regex_rules'), []))} 正则`)
  }
  return {
    json: path, bytes: data.length, entries: entries.length,
    name: _get(pr, 'name'), purpose: _get(pr, 'purpose'),
  }
}

/** 独跑：`python -m forge.preset <卡.json> [-o 出.preset.json] [--png [出.png]]`。 */
export function main(argv = null) {
  const 参 = (argv === null || argv === undefined) ? process.argv.slice(2) : [...argv]
  if (!参.length) {
    _print('预设 —— 把卡里的那套设定，搬成一份「创作预设」。')
    _print('用法：python -m forge.preset <卡.json> [-o 出.preset.json] [--png [出.png]]')
    return 2
  }
  const src = 参[0]
  let out_path = null
  let png_out = null
  const rest = 参.slice(1)
  let i = 0
  while (i < rest.length) {
    if ((rest[i] === '-o' || rest[i] === '--out') && i + 1 < rest.length) {
      out_path = rest[i + 1]; i += 2; continue
    }
    if (rest[i] === '--png') {
      if (i + 1 < rest.length && !String(rest[i + 1]).startsWith('-')) {
        png_out = rest[i + 1]; i += 2
      } else {
        png_out = ''; i += 1
      }
      continue
    }
    i += 1
  }
  const got = build(src, out_path)
  verify(got.json)
  if (png_out !== null) {
    build_png(got.json, 或(png_out, null))
  }
  return 0
}
