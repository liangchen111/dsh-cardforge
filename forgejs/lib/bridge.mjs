/**
 * forge.bridge 的 JS 版 —— 酒馆（SillyTavern）卡 / 世界书 ⇄ ElecKoi 规格的识别与转换。
 * ==================================================================
 *
 * 支持输入：
 *   *.json    酒馆 V2/V3 卡、V1 旧卡、独立世界书、ElecKoi 卡
 *   *.png     卡数据藏在图片元数据里（chara / ccv3 两种代号）
 *   *.charx   本质是 zip，里面有 card.json
 *   *.webp    少数嵌法也支持
 *
 * 两条命令：
 *   analyze     拆解报告：字段、条目、触发方式、token 估算
 *   to-eleckoi  转成 ElecKoi 规格（spec），再用 forge build 打包
 *
 * ⚠ 两种格式不是一一对应。转换只做能确定的映射，其余一律留白并如实说明，
 *   绝不「尽力解析」（认不出就报错，不猜）。
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 纪律同 model.mjs / content.mjs / opener.mjs 头上那几条：**行为照抄，不顺手改**；
 * 能逐字节比的逐字节比。这个模块到处在拼**人话报告**（`%-26s` / `%6d` 这类
 * 终端排版）与 `str()` / `strip()` / `len()` 这类边角，所以下面照抄了一组
 * 「Python 语义小工具」——少了它们，报告输出会在边角上悄悄跑偏。
 *
 * ★ 本模块的已知边界（不是 bug，是语言天生不同／计划备案过的差异）：
 *
 *   1. **不写 YAML**：`bridge.py` 末尾那句 `M.ydump(spec, out_spec)` 在这里是
 *      `M.jdump`（计划 §二① 备案过的唯一差异）。所以语料里输出名一律用
 *      `.spec.json`，差分按**结构**比（`.spec.` 结尾的文件走 `loadStructured`）。
 *   2. **zip 是自己读的**：Node 标准库没有 zip（`node:zlib` 只有 deflate/gzip）。
 *      `_读zip()` 照 `zipfile` 的语义读中央目录（含「同名后者覆盖前者」）。
 *      坏 zip 抛 `BadZipFile`（名字必须与 Python 一致 —— 差分记的是
 *      `type(exc).__name__`）。
 *   3. **`json` 的报错措辞两边不同**（Python `JSONDecodeError` vs V8 `SyntaxError`），
 *      语料里别拿坏 JSON 去撞 `M.jload`。
 *   4. Python 的 `%.1f`（`analyze` 那句「大小 : N KB」）是**对精确值四舍六入五取偶**，
 *      JS 的 `toFixed` 是 .5 进位。这里用 BigInt 精确算（字节数 ÷ 1024 是有理数）。
 *   5. `re.split(r"(?m)^##[ \t]+")` 的 `^` 在 JS 里还会在 `\r` 后就匹配（Python 只认
 *      `\n`）⇒ `_按二级标题切()` 自己扫行首，不走正则引擎。
 *   6. **zip 里的条目名按 UTF-8 标记位解码**：有 0x800 位走 utf-8，否则 CPython 用
 *      **cp437**（DOS 那个代码页），这里用 latin1 顶替。0x00–0x7F 两边完全一致，
 *      只有「没打 UTF-8 位又含 0x80 以上字节」的名字会差在乱码字符上 —— 名字只进
 *      `classify()` 的 note 文本，而 `.json` 后缀筛选不吃这个差异；语料里也没有这种
 *      名字（搬 cp437 那张 128 项映射表的代价大于收益）。
 *   7. **zip64 没做**（`_EndRecData64`：EOCD 里条目数/偏移填 0xFFFF/0xFFFFFFFF、
 *      真值挪到 zip64 扩展区那支）。语料里没有 zip64 包；真遇上会报
 *      `File is not a zip file`（CPython 能读）。
 *   8. **CPython 的「条目重叠」检查没做**（`open()` 里拿 `zinfo._end_offset` 比
 *      `zef_file.tell() + compress_size`，报 `Overlapped entries: %r (possible zip bomb)`）。
 *      只有「手工造的、后一条的数据压进前一条报的地界」的包会踩到。
 */
import { readFileSync, statSync } from 'node:fs'
import { inflateRawSync, inflateSync } from 'node:zlib'
import * as M from './model.mjs'

export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// 酒馆的插入位置 -> 中文名
export const ST_POSITION = {
  before_char: '角色定义之前', after_char: '角色定义之后',
  before_example: '示例消息之前', after_example: '示例消息之后',
  before_an: '作者注释之前', after_an: '作者注释之后',
  at_depth: '指定深度',
  before_author_note: '作者注释之前', after_author_note: '作者注释之后',
}
export const ST_POSITION_NUM = {
  0: '角色定义之前', 1: '角色定义之后', 2: '作者注释之前', 3: '作者注释之后',
  4: '指定深度', 5: '示例消息之前', 6: '示例消息之后', 7: 'Outlet',
}

export const KIND_LABEL = {
  eleckoi: 'ElecKoi 角色卡',
  tavern_v3: '酒馆角色卡 V3',
  tavern_v2: '酒馆角色卡 V2',
  tavern_v1: '酒馆角色卡 V1（旧版扁平结构）',
  lorebook: '独立世界书',
  unknown: '未识别的结构',
}

/** `ValueError` —— 名字必须与 Python 一致：差分记的是 `type(exc).__name__`。 */
export class ValueError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValueError'
  }
}

/** `zipfile.BadZipFile`。 */
export class BadZipFile extends Error {
  constructor(message) {
    super(message)
    this.name = 'BadZipFile'
  }
}

/**
 * `NotImplementedError` —— `zipfile` 遇到不认识的压缩法号时抛的就是它。
 *
 * 只在 `read()` 里出现，而 `load_any` 那条 `except Exception: continue` 会把它吞掉，
 * 所以差分里看不到这个类名；但名字照样照抄，免得哪天在别的调用点上露馅。
 */
export class NotImplementedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NotImplementedError'
  }
}

/** `RuntimeError` —— `zipfile` 遇到「加了密又没给口令」的条目时抛的就是它。 */
export class RuntimeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RuntimeError'
  }
}

/** `AttributeError` —— 在**不是字典**的东西上取 `.get` 时 Python 抛的就是它。 */
export class AttributeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AttributeError'
  }
}


// ------------------------------------------------------------------ Python 语义小工具

/** Python 的 `str.isspace()` 那一套：比 JS `trim()` 宽 `\x1c`–`\x1f` / `\x85`，又不含 `\ufeff`。 */
const _PY空白 = '\t\n\v\f\r \x1c\x1d\x1e\x1f\x85\u00a0\u1680' +
  '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a' +
  '\u2028\u2029\u202f\u205f\u3000'
const _STRIP = new RegExp(`^[${_PY空白}]+|[${_PY空白}]+$`, 'g')

/**
 * Python 的 `s.strip()`。
 *
 * ★ **非字符串抛 AttributeError，不许替它做 `str()`** —— Python 里
 *   `(5 or "").strip()` / `{"甲": 1}.strip()` 是当场炸，JS 的 `String(x)` 却会算出
 *   `"5"` / `"[object Object]"`，把「炸」悄悄变成「算下去」。
 *   差分到 `decode_card_text` 收到字典那条才把它逼出来（bridge.py:104）。
 */
const _strip = (s) => {
  if (typeof s !== 'string') throw new AttributeError(`'${_类型名(s)}' object has no attribute 'strip'`)
  return s.replace(_STRIP, '')
}

/** Python 的 `s.rstrip(集)`（按码点，不是码元）—— 同样只接字符串。 */
function _rstrip集(s, 集) {
  if (typeof s !== 'string') throw new AttributeError(`'${_类型名(s)}' object has no attribute 'rstrip'`)
  const A = Array.from(s)
  let i = A.length
  while (i > 0 && 集.includes(A[i - 1])) i -= 1
  return A.slice(0, i).join('')
}

/**
 * 「这在 Python 那边是 OrderedDict」的记号。
 *
 * ★ `forge/model.py` 的 `jload` 是 `json.load(f, object_pairs_hook=OrderedDict)`
 *   ⇒ 凡是从 `M.jload` 读进来的对象都是 **OrderedDict**，`str()` / `repr()` 会带上
 *   类名：`str(OrderedDict({'甲': 1}))` 是 `"OrderedDict({'甲': 1})"`（空的是
 *   `"OrderedDict()"`），而 bridge.py 自己手写的 `{...}` 仍是普通 dict、`str()` 是
 *   `"{...}"`。差分到「personality 是列表、表里套字典」这条才把它逼出来：
 *   黄金 `32 字` vs JS `19 字`。JS 没有 OrderedDict 这个类型，用弱集打记号代替。
 *
 *   **注意**：`load_any` 的 zip 支用的是裸 `json.loads`（bridge.py:130）⇒ 那边的对象
 *   是普通 dict，不许打记号。
 */
const _有序 = new WeakSet()

function _标记有序(v) {
  if (v === null || typeof v !== 'object' || _有序.has(v)) return v
  _有序.add(v)
  if (Array.isArray(v)) {
    for (const x of v) _标记有序(x)
  } else {
    for (const k of Object.keys(v)) _标记有序(v[k])
  }
  return v
}

/** `M.jload` ＋ 打「有序字典」记号（Python 侧 jload 用 object_pairs_hook=OrderedDict）。 */
function _jload(path) {
  return _标记有序(M.jload(path))
}

/** 照 `M.pyRepr` 递归，只多认「有序字典」这一层。 */
function _pyRepr(v) {
  if (Array.isArray(v)) return `[${v.map(_pyRepr).join(', ')}]`
  if (v !== null && typeof v === 'object') {
    const 体 = Object.entries(v).map(([k, x]) => `${M.pyRepr(k)}: ${_pyRepr(x)}`).join(', ')
    if (_有序.has(v)) return Object.keys(v).length ? `OrderedDict({${体}})` : 'OrderedDict()'
    return `{${体}}`
  }
  return M.pyRepr(v)
}

/** Python 的 `str()` —— 标量原样，容器走 `repr()`（`str(['a'])` 就是 `['a']`）。 */
function _pyStr(v) {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return _pyRepr(v)
}
const _str = (v) => (v !== null && typeof v === 'object' ? _pyRepr(v) : _pyStr(v))

/** Python 的 `bool(x)`（`if x:` 的真值判定）。 */
function _真(v) {
  if (v === null || v === undefined || v === false) return false
  if (v === true) return true
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

/** Python 的 `a or b or …`。 */
const _或 = (...xs) => {
  for (const x of xs.slice(0, -1)) if (_真(x)) return x
  return xs.length ? xs[xs.length - 1] : null
}

/**
 * Python 的 `type(x).__name__` —— `AttributeError` 的报错文本要用它。
 *
 * ★ OrderedDict 是个例外：`json` 读出来的有序字典，CPython 在报错里写的是**限定名**
 *   `collections.OrderedDict`（`OrderedDict.__module__` + 类名），不是裸 `OrderedDict`。
 *   差分到「`decode_card_text` 收到从 `M.jload` 读出来的字典」那条才逼出来：
 *   黄金 `'collections.OrderedDict' object has no attribute 'strip'`。
 */
function _类型名(v) {
  if (v === null || v === undefined) return 'NoneType'
  if (Array.isArray(v)) return 'list'
  switch (typeof v) {
    case 'string': return 'str'
    case 'boolean': return 'bool'
    case 'number': return Number.isInteger(v) ? 'int' : 'float'
    case 'object': return _有序.has(v) ? 'collections.OrderedDict' : 'dict'
    default: return typeof v
  }
}

/**
 * Python `dict.get(k, 默认)` —— **键在但值是 None 时给 None，不给默认**。
 *
 * ★ 在**不是字典**的东西上取 `.get`，Python 抛 `AttributeError: 'str' object has no
 *   attribute 'get'`（`analyze` 撞上 `character` 是字符串的坏卡就走这条）。这里照抛 ——
 *   悄悄给默认值会让坏输入从「当场炸」变成「默默算出个空报告」，那是另一种行为。
 */
function _取(o, k, 默认 = null) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) {
    throw new AttributeError(`'${_类型名(o)}' object has no attribute 'get'`)
  }
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : 默认
}

/** Python 的 `k in d`（只认自有键）。 */
const _在 = (o, k) => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  Object.prototype.hasOwnProperty.call(o, k)

/** Python 的 `isinstance(x, dict)`。 */
const _是字典 = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

/**
 * Python 的 `for t in x` —— 字符串按**码点**、数组按元素、字典按**键**。
 *
 * ★ bridge.py:558 `"、".join(str(t) for t in (body.get("tags") or []))`：tags 是字符串
 *   时 Python 迭代出字符（`"不是列表"` → `不、是、列、表`），JS 的 `.map` 会当场
 *   `TypeError: ... is not a function`。凡是 Python 用 `for … in (x or [])` 的地方都走这里。
 *   None 返回空表（调用点的 `or []` 已经挡过；Python 真撞上 None 会
 *   `TypeError: 'NoneType' object is not iterable`，目前没有语料走那条）。
 */
function _遍(x, fn) {
  if (typeof x === 'string') return Array.from(x).map(fn)
  if (Array.isArray(x)) return x.map(fn)
  if (x !== null && typeof x === 'object') return Object.keys(x).map(fn)
  return []
}

/**
 * Python 的 `len(x)`（字符串按码点数，dict 按键数）。
 *
 * ★ 数字没有长度：Python 抛 `TypeError: object of type 'int' has no len()`。
 *   （`sum(len(e.get("content") or ""))` 撞上 content 是数字的坏条目就走这条。）
 */
function _len(v) {
  if (typeof v === 'string') return Array.from(v).length
  if (Array.isArray(v)) return v.length
  if (v !== null && typeof v === 'object') return Object.keys(v).length
  throw new TypeError(`object of type '${_类型名(v)}' has no len()`)
}

/** Python 的 `%-Ns`（按码点数补空格，不是显示宽度）。 */
function _ljust(v, 宽) {
  const s = _str(v)
  return s + ' '.repeat(Math.max(0, 宽 - _len(s)))
}

/** Python 的 `%Nd` —— 右对齐整数。 */
function _rjust(v, 宽) {
  const s = _str(v)
  return ' '.repeat(Math.max(0, 宽 - _len(s))) + s
}

/**
 * Python 的 `'%.1f' % (字节数 / 1024.0)`：对**精确值**四舍六入五取偶。
 * 字节数是整数 ⇒ 值是 `字节数/1024` ⇒ 用 BigInt 精确算，别交给 `toFixed`。
 */
function _kb1(字节数) {
  const n = BigInt(Math.trunc(字节数)) * 5n
  const d = 512n
  let q = n / d
  const 两余 = (n % d) * 2n
  if (两余 > d || (两余 === d && q % 2n === 1n)) q += 1n
  return `${q / 10n}.${q % 10n}`
}

/** Python 的 `str.split(sep, 1)`（最多切一刀，返回 1 或 2 段）。 */
function _split1(s, sep) {
  const i = String(s).indexOf(sep)
  return i === -1 ? [String(s)] : [String(s).slice(0, i), String(s).slice(i + sep.length)]
}

/** 默认的 `out=`（Python 的 `print`）。 */
const _print = (s) => process.stdout.write(String(s) + '\n')


// ---- os.path / bytes 那几件（**别用 node:path**：Python 的分隔符规则与它不一样）

/** Python `ntpath.basename`：`/` 与 `\` 都算分隔符。 */
export function _basename(p) {
  const s = String(p)
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1)
}

/** Python `os.path.splitext`（前导点不算扩展名）。 */
export function _splitext(p) {
  const s = String(p)
  const sep = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  const dot = s.lastIndexOf('.')
  if (dot > sep) {
    let i = sep + 1
    while (i < dot) {
      if (s[i] !== '.') return [s.slice(0, dot), s.slice(dot)]
      i += 1
    }
  }
  return [s, '']
}

/** Python 的 `bytes.partition(sep)`：没找到给 `(原串, 空, 空)`。 */
function _partition(buf, sep) {
  const i = buf.indexOf(sep)
  if (i === -1) return [buf, Buffer.alloc(0), Buffer.alloc(0)]
  return [buf.subarray(0, i), sep, buf.subarray(i + sep.length)]
}

/** Python 的 `bytes.decode(编码)` —— 失败抛（照 UnicodeDecodeError 的意思）。 */
function _解码(blob, 编码) {
  if (编码 === 'latin-1') return blob.toString('latin1')
  if (编码 === 'utf-8') return new TextDecoder('utf-8', { fatal: true }).decode(blob)
  // utf-16：有 BOM 按 BOM，没 BOM 按本机序（Windows = LE）；长度奇数算错
  if (blob.length >= 2 && blob[0] === 0xfe && blob[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: true }).decode(blob)
  }
  return new TextDecoder('utf-16le', { fatal: true }).decode(blob)
}

/**
 * `base64.b64decode(text)`（validate=False）的语义：**非字母表字符忽略**、
 * 遇 `=` 截断、数据个数 ≡1 (mod 4) 算错、非 ASCII 算错。
 */
function _b64decode(text) {
  for (const ch of text) {
    if (ch.codePointAt(0) > 127) throw new Error('string argument should contain only ASCII characters')
  }
  const 表 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let 攒 = 0
  let 位数 = 0
  let 数据数 = 0
  const 出 = []
  for (const ch of text) {
    if (ch === '=') break
    const i = 表.indexOf(ch)
    if (i === -1) continue
    数据数 += 1
    攒 = 攒 * 64 + i
    位数 += 6
    while (位数 >= 8) {
      位数 -= 8
      出.push(Math.trunc(攒 / 2 ** 位数) & 0xff)
      攒 %= 2 ** 位数
    }
  }
  if (数据数 % 4 === 1) {
    throw new Error('Invalid base64-encoded string: number of data characters cannot be 1 more than a multiple of 4')
  }
  return Buffer.from(出)
}

/** `json.loads` —— 失败给 undefined（调用点自己接）。 */
function _tryJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** CPython `zipfile` 的 EOCD 签名与各字段偏移。 */
const _EOCD签 = 0x06054b50;
const _中央签 = 0x02014b50;
const _本地签 = 0x04034b50;

/**
 * 按 CPython `ZipFile._RealGetContents` 的规矩解一个 zip 条目名。
 *
 * 有 UTF-8 标记位（0x800）走 utf-8，否则走 cp437 —— 这里降级用 latin1 近似：
 * 两者对 0x00–0x7F 完全一致，只有「没打标记位又含 0x80 以上字节」的条目名会
 * 差在乱码的具体字符上（见文件头「移植记号」）。
 */
function _解名(字节, 标志) {
  if (标志 & 0x800) return 字节.toString('utf8');
  return 字节.toString('latin1');
}

/**
 * `zipfile.ZipFile` 的只读子集 —— 只做 `namelist()` 与 `read(name)`。
 *
 * 差别的关键在**报错分两段**（bridge.py 就吃这两段的差别）：
 *   · 开头解析中央目录（本构造函数）—— 出错直接冒出去；
 *   · 逐个 `read(name)`（读本地头、解压）—— bridge.py 用 `except Exception: continue` 兜住。
 * 所以 `半包.zip` 这种坏文件报的是 `Bad offset for central directory`，而不是
 * 「这条读不出来」。
 */
class _ZipFile {
  constructor(raw) {
    this.流 = raw;
    // ---- `_EndRecData`：先赌「最后 22 字节就是一条无注释的 EOCD」，不行再从尾部回扫
    let 头 = -1;
    const 尾 = raw.length - 22;
    if (尾 >= 0 && raw.readUInt32LE(尾) === _EOCD签 && raw.readUInt16LE(尾 + 20) === 0) {
      头 = 尾;
    } else {
      const 下界 = Math.max(0, raw.length - 22 - 65535);
      for (let i = raw.length - 22; i >= 下界; i -= 1) {
        if (i < 0 || raw.readUInt32LE(i) !== _EOCD签) continue;
        // 注释长度必须与「文件正好到此为止」对得上，否则是正文里撞见的假签名
        if (i + 22 + raw.readUInt16LE(i + 20) === raw.length) { 头 = i; break }
      }
    }
    if (头 === -1) throw new BadZipFile('File is not a zip file');
    const 中央长 = raw.readUInt32LE(头 + 12);
    const 中央偏移 = raw.readUInt32LE(头 + 16);
    // CPython：start_dir = offset_cd + (eocd - size_cd - offset_cd) = eocd - size_cd
    const 起点 = 头 - 中央长;
    if (起点 < 0) throw new BadZipFile('Bad offset for central directory');
    const 补 = 起点 - 中央偏移;   // CPython 的 concat：zip 拼在别的文件后面时非 0
    this.条目 = [];               // filelist 的顺序（可能有同名，`namelist()` 照样重复给）
    this.表 = new Map();          // NameToInfo：同名后者覆盖前者
    const 目录 = raw.subarray(起点, 起点 + 中央长);
    let p = 0;
    while (p < 中央长) {
      if (p + 46 > 目录.length) throw new BadZipFile('Truncated central directory');
      if (目录.readUInt32LE(p) !== _中央签) throw new BadZipFile('Bad magic number for central directory');
      const 标志 = 目录.readUInt16LE(p + 8);
      const 法 = 目录.readUInt16LE(p + 10);
      const 压缩后 = 目录.readUInt32LE(p + 20);
      const 名长 = 目录.readUInt16LE(p + 28);
      const 附长 = 目录.readUInt16LE(p + 30);
      const 注长 = 目录.readUInt16LE(p + 32);
      const 头偏移 = 目录.readUInt32LE(p + 42) + 补;
      const 名 = _解名(目录.subarray(p + 46, p + 46 + 名长), 标志);
      p += 46 + 名长 + 附长 + 注长;
      const 项 = { 名, 标志, 法, 压缩后, 头偏移 };
      this.条目.push(项);
      this.表.set(名, 项);
    }
  }

  namelist() { return this.条目.map((x) => x.名) }

  read(名) {
    const x = this.表.get(名);
    const raw = this.流;
    if (x.头偏移 + 30 > raw.length) throw new BadZipFile('Truncated file header');
    if (raw.readUInt32LE(x.头偏移) !== _本地签) throw new BadZipFile('Bad magic number for file header');
    const 头标志 = raw.readUInt16LE(x.头偏移 + 6);
    const 本名长 = raw.readUInt16LE(x.头偏移 + 26);
    const 本附长 = raw.readUInt16LE(x.头偏移 + 28);
    // CPython 的次序：**先查中央目录里那两条 flag**，再解名、再比名 —— 差一个位报出来的
    // 就不是同一句话了（名字对不上时尤其明显）。
    if (x.标志 & 0x20) throw new NotImplementedError('compressed patched data (flag bit 5)');
    if (x.标志 & 0x40) throw new NotImplementedError('strong encryption (flag bit 6)');
    const 本名 = _解名(raw.subarray(x.头偏移 + 30, x.头偏移 + 30 + 本名长), 头标志);
    if (本名 !== x.名) {
      throw new BadZipFile(`File name in directory ${M.pyRepr(x.名)} and header ${M.pyRepr(本名)} differ.`);
    }
    if (x.标志 & 0x1) throw new RuntimeError(`File ${M.pyRepr(名)} is encrypted, password required for extraction`);
    const 起点 = x.头偏移 + 30 + 本名长 + 本附长;
    const 数据 = raw.subarray(起点, 起点 + x.压缩后);
    if (x.法 === 0) return Buffer.from(数据);
    if (x.法 === 8) return inflateRawSync(数据);
    throw new NotImplementedError('That compression method is not supported');
  }
}

/** 打开一个 zip（只读）—— 对应 `zipfile.ZipFile(path)`。 */
function _读zip(path) {
  return new _ZipFile(readFileSync(path));
}


// ------------------------------------------------------------------ 读取
export function read_chunks_png(path) {
  /** 取出 PNG 里所有文本块的原始字节。 */
  const raw = readFileSync(path)
  if (!raw.subarray(0, 8).equals(PNG_SIG)) throw new ValueError('不是 PNG 文件')
  const out = {}
  let i = 8
  const n = raw.length
  const 零 = Buffer.from([0])
  while (i + 8 <= n) {
    const ln = raw.readUInt32BE(i)
    const typ = raw.subarray(i + 4, i + 8)
    const chunk = raw.subarray(i + 8, i + 8 + ln)
    i += 12 + ln
    try {
      if (typ.equals(Buffer.from('tEXt'))) {
        const [kw, , txt] = _partition(chunk, 零)
        const 键 = kw.toString('latin1')
        if (!(键 in out)) out[键] = txt
      } else if (typ.equals(Buffer.from('zTXt'))) {
        const [kw, , rest] = _partition(chunk, 零)
        const 键 = kw.toString('latin1')
        if (!(键 in out)) out[键] = inflateSync(rest.subarray(1))
      } else if (typ.equals(Buffer.from('iTXt'))) {
        const [kw, , rest0] = _partition(chunk, 零)
        if (rest0.length >= 2) {
          const comp = rest0[0]
          let rest = rest0.subarray(2)
          rest = _partition(rest, 零)[2]
          const txt = _partition(rest, 零)[2]
          const 键 = kw.toString('latin1')
          if (!(键 in out)) out[键] = comp === 1 ? inflateSync(txt) : txt
        }
      }
    } catch {
      // 单个块坏了不影响别的块 —— 照 Python 的 try/except: pass
    }
    if (typ.equals(Buffer.from('IEND'))) break
  }
  return out
}


export function decode_card_text(blob) {
  /** 文本块可能是 base64 的 JSON，也可能是裸 JSON。 */
  let text
  if (Buffer.isBuffer(blob) || blob instanceof Uint8Array) {
    text = null
    for (const trial of ['utf-8', 'utf-16', 'latin-1']) {
      try {
        text = _解码(Buffer.from(blob), trial)
        break
      } catch {
        continue
      }
    }
    if (text === null) return null
  } else {
    text = blob
  }
  text = _strip(text)
  const 直 = _tryJson(text)
  if (直 !== undefined) return 直
  const pad = text + '='.repeat((4 - (text.length % 4)) % 4)
  try {
    const 解 = _b64decode(pad)
    // ★ Python 是 `.decode("utf-8")`（严格）——坏字节要**抛**（被下面的 except 吞掉回 None），
    //   不能像 `Buffer.toString('utf8')` 那样悄悄换成 U+FFFD：`base64.b64decode` 出
    //   `{"a":"\xff"}` 这种字节时，Python 回 None、宽松解码却会解出一个字典。
    return _tryJson(new TextDecoder('utf-8', { fatal: true }).decode(解)) ?? null
  } catch {
    return null
  }
}


export function load_any(path) {
  /** 返回 `[kind, data, note]`。 */
  const ext = _splitext(path)[1].toLowerCase()

  if (ext === '.png') {
    const chunks = read_chunks_png(path)
    for (const key of ['ccv3', 'chara', 'character', 'card']) {
      if (key in chunks) {
        const data = decode_card_text(chunks[key])
        if (_是字典(data)) {
          const note = `PNG 元数据块「${key}」` +
            (Buffer.isBuffer(chunks[key]) ? '（base64 编码）' : '')
          return classify(data, note)
        }
      }
    }
    throw new ValueError('这张 PNG 里没有找到角色卡数据块（chara / ccv3）')
  }

  if (ext === '.charx' || ext === '.byaf' || ext === '.zip') {
    const z = _读zip(path);
    const names = z.namelist().filter((名) => 名.toLowerCase().endsWith('.json'));
    names.sort((a, b) => {
      const ka = a.toLowerCase().includes('card') ? 0 : 1;
      const kb = b.toLowerCase().includes('card') ? 0 : 1;
      return ka !== kb ? ka - kb : _len(a) - _len(b);
    });
    for (const name of names) {
      // Python 是 `try: data = json.loads(z.read(name).decode("utf-8")) except Exception: continue`
      let data;
      try {
        // ★ `.decode("utf-8")` 是**严格**的：非法字节在 Python 那边抛 UnicodeDecodeError
        //   （被这条 except 吞掉 ⇒ continue）。`toString('utf8')` 会换成 U+FFFD 继续解析，
        //   等于把一个「跳过这个条目」变成一个「读出了坏卡」。
        data = JSON.parse(_解码(z.read(name), 'utf-8'));
      } catch {
        continue;
      }
      if (_是字典(data)) {
        return classify(data, `压缩包内的 ${name}`);
      }
    }
    throw new ValueError('压缩包里没有可用的 card.json');
  }

  const data = _jload(path)
  if (!_是字典(data)) throw new ValueError('顶层不是 JSON 对象')
  let d = data
  if ('__meta__' in d && _len(d) === 1 && _是字典(d.__meta__)) d = d.__meta__
  return classify(d, 'JSON 文件')
}


export function classify(data, note = '') {
  if (_str(_取(data, 'format', '')).startsWith('eleckoi.')) return ['eleckoi', data, note]
  if (_取(data, 'spec', null) === 'chara_card_v3' ||
      _str(_取(data, 'spec_version', '')).startsWith('3')) return ['tavern_v3', data, note]
  if (_在(data, 'spec_version') ||
      (_在(data, 'data') && _是字典(data.data) && _在(data.data, 'name'))) {
    return ['tavern_v2', data, note]
  }
  if (_在(data, 'entries') && (Array.isArray(data.entries) || _是字典(data.entries)) &&
      !['description', 'personality', 'first_mes', 'scenario', 'mes_example']
        .some((k) => _在(data, k))) {
    return ['lorebook', data, note]
  }
  if (_在(data, 'name')) return ['tavern_v1', data, note]
  return ['unknown', data, note]
}


export function card_body(data) {
  /** V2/V3 的字段在 `data.data` 里，V1 在顶层。 */
  if (_是字典(_取(data, 'data', null))) return data.data
  return data
}


export function normalize_entries(book) {
  /** 酒馆世界书条目：可能是 list，也可能是 `{id: {...}}`。统一成 `list[dict]`。 */
  if (!_真(book)) return []
  let raw = _是字典(book) ? _取(book, 'entries', null) : book
  if (_是字典(raw)) raw = Object.values(raw)
  if (!Array.isArray(raw)) return []
  const out = []
  for (const e of raw) {
    if (!_是字典(e)) continue
    const ext = _是字典(_取(e, 'extensions', null)) ? e.extensions : {}
    let keys = _或(_取(e, 'keys', null), _取(e, 'key', null), [])
    if (typeof keys === 'string') {
      keys = keys.split(',').map((k) => _strip(k)).filter((k) => _strip(k))
    }
    let sec = _或(_取(e, 'secondary_keys', null), _取(e, 'keysecondary', null), [])
    if (typeof sec === 'string') {
      sec = sec.split(',').map((k) => _strip(k)).filter((k) => _strip(k))
    }
    let pos = _取(e, 'position', null)
    if (pos === null || pos === undefined) pos = _取(ext, 'position', null)
    out.push({
      title: _或(_取(e, 'name', null), _取(e, 'comment', null),
        _真(keys) ? keys[0] : '(无标题)'),
      keys,
      secondary: sec,
      content: _或(_取(e, 'content', null), _取(e, 'entry', null), ''),
      constant: _真(_取(e, 'constant', false)),
      selective: _真(_取(e, 'selective', false)),
      order: _取(e, 'insertion_order', _取(e, 'order', 100)),
      position: pos,
      depth: _取(ext, 'depth', null),
      role: _取(ext, 'role', null),
      probability: _取(ext, 'probability', 100),
      group: _取(ext, 'group', null),
      enabled: _取(e, 'enabled', !_真(_取(e, 'disable', false))),
    })
  }
  return out
}


// ------------------------------------------------------------------ 报告
export function analyze(path, out = _print) {
  const [kind, data, note] = load_any(path)
  const body = card_body(data)

  out('='.repeat(78))
  out(`文件      : ${_basename(path)}`)
  out(`大小      : ${_kb1(statSync(path).size)} KB`)
  if (_真(note)) out(`来源      : ${note}`)
  out(`识别为    : ${_或(KIND_LABEL[kind], kind)}`)

  if (kind === 'eleckoi') {
    _analyze_eleckoi(data, out)
    return [kind, data, body]
  }

  if (kind === 'lorebook') {
    const entries = normalize_entries(data)
    out('-'.repeat(78))
    out(`【世界书】共 ${entries.length} 条`)
    if (_真(_取(data, 'name', null))) out(`  世界书名称：${data.name}`)
    print_book_table(entries, out)
    out(`  正文合计 ${entries.reduce((s, e) => s + _len(_str(e.content)), 0)} 字 ≈ ` +
      `${entries.reduce((s, e) => s + M.estTokens(_str(e.content)), 0)} token`)
    return [kind, data, body]
  }

  const fields = [
    ['name', '名字'], ['creator', '作者'], ['character_version', '版本'],
    ['description', '角色描述 Description'], ['personality', '性格 Personality'],
    ['scenario', '场景 Scenario'], ['first_mes', '开场白 First Message'],
    ['mes_example', '对话示例 Example Messages'],
    ['system_prompt', '系统提示词 System Prompt'],
    ['post_history_instructions', '历史后置指令 Post-History'],
    ['creator_notes', '作者备注 Creator Notes'],
  ]
  out('-'.repeat(78))
  out('【角色字段】')
  let total = 0
  for (const [key, label] of fields) {
    let val = _取(body, key, '')
    if (Array.isArray(val)) val = val.map((v) => _str(v)).join('\n')
    val = _strip(_或(val, ''))
    total += _len(val)
    out(`  ${_ljust(label, 26)} ${_rjust(_len(val), 6)} 字  ≈${_rjust(M.estTokens(val), 5)} token`)
  }

  const tags = _或(_取(body, 'tags', null), [])
  const alts = _或(_取(body, 'alternate_greetings', null), [])
  out(`  ${_ljust('标签 tags', 26)} ${_str(_真(tags) ? tags : '（无）')}`)
  out(`  ${_ljust('备选开场白', 26)} ${_len(alts)} 个`)
  alts.forEach((a, i) => out(`        [${i + 1}] ${_len(_str(a))} 字`))

  const book = _或(_取(body, 'character_book', null), _取(data, 'character_book', null))
  const entries = normalize_entries(book)
  out('-'.repeat(78))
  if (_真(entries)) {
    out(`【内嵌世界书】共 ${entries.length} 条`)
    if (_是字典(book) && _真(_取(book, 'name', null))) out(`  世界书名称：${book.name}`)
    print_book_table(entries, out)
    out(`  世界书正文合计 ${entries.reduce((s, e) => s + _len(_str(_或(_取(e, 'content', null), ''))), 0)} 字 ≈ ` +
      `${entries.reduce((s, e) => s + M.estTokens(_str(_或(_取(e, 'content', null), ''))), 0)} token`)
  } else {
    out('【内嵌世界书】无')
  }
  return [kind, data, body]
}


export function _analyze_eleckoi(data, out) {
  const lib = _obj(_取(data, 'setting_library', null))
  const vc = _obj(_取(data, 'variable_config', null))
  const act = _pick(_或(_取(lib, 'versions', null), []), _取(lib, 'active_version_id', null))
  const va = _pick(_或(_取(vc, 'versions', null), []), _取(vc, 'active_version_id', null))
  out('-'.repeat(78))
  out(`  ${_ljust('名字', 26)} ${_取(_或(_取(data, 'character', null), {}), 'name', '')}`)
  out(`  ${_ljust('设定库', 26)} ${_len(_或(_取(act, 'entries', null), []))} 条 / ` +
    `${_len(_或(_取(act, 'groups', null), []))} 组`)
  out(`  ${_ljust('变量', 26)} ${_len(_或(_取(va, 'objects', null), []))} 个对象 / ` +
    `${_len(_或(_取(va, 'variables', null), []))} 个变量`)
  out(`  ${_ljust('正则', 26)} ${_len(_或(_取(data, 'regex_rules', null), []))} 条`)
  // 开场白其实也是设定库里的一条（kind=opening）—— 单独拎出来说一句。
  // 不然它混在「设定库 N 条」里数不出来，复核成品卡时找不到它在哪
  // （盲跑的最后一问：「成品卡的开场白」到底怎么看）。
  const 开场 = (_或(_取(act, 'entries', null), []))
    .filter((e) => _str(_或(_取(e, 'kind', null), '')) === 'opening')
  if (_真(开场)) {
    const o = 开场[0]
    const 正文 = _str(_或(_取(o, 'content', null), ''))
    const 尾 = _len(正文) - _len(_rstrip集(正文, '\u200b'))
    out(`  ${_ljust('开场白', 26)} ${_len(_rstrip集(正文, '\u200b'))} 字` +
      (_真(尾) ? `（末尾零宽标记 ${尾} 个）` : '（⚠ 末尾没有建卡标记，界面可能不出现）'))
    const 方案 = _或(_取(o, 'opening_messages', null), [])
    if (_len(方案) > 1) out(`  ${_ljust('开场白备选方案', 26)} ${_len(方案)} 个`)
  } else {
    out(`  ${_ljust('开场白', 26)} （没有开场白条目）`)
  }
  const chars = (_或(_取(act, 'entries', null), []))
    .reduce((s, e) => s + _len(_或(_取(e, 'content', null), '')), 0)
  out(`  设定库正文合计 ${chars} 字 ≈ ${M.estTokens('x'.repeat(Math.max(0, chars)))} token`)
}


export function print_book_table(entries, out = _print) {
  out(`  ${_ljust('#', 3)} ${_ljust('标题', 22)} ${_ljust('触发', 8)} ` +
    `${_ljust('关键词', 6)} ${_ljust('插入位置', 16)} ${_ljust('顺序', 6)} ` +
    `${_ljust('概率', 6)} 字数`)
  entries.forEach((e, i) => {
    let trig
    if (!_真(e.enabled)) trig = '已禁用'
    else if (_真(e.constant)) trig = '常驻'
    else if (_真(e.keys)) trig = '关键词'
    else trig = '无键'
    const pos = e.position
    let posname
    if ((typeof pos === 'number') && !(typeof pos === 'boolean')) {
      posname = _或(ST_POSITION_NUM[Math.trunc(pos)], `位置${pos}`)
    } else if (typeof pos === 'string') {
      posname = _或(ST_POSITION[pos], _或(pos, '—'))
    } else {
      posname = '—'
    }
    if (!(e.depth === null || e.depth === undefined || e.depth === '')) {
      posname += `/深度${e.depth}`
    }
    let title = _str(e.title)
    if (_len(title) > 20) title = Array.from(title).slice(0, 19).join('') + '…'
    out(`  ${_ljust(i + 1, 3)} ${_ljust(title, 22)} ${_ljust(trig, 8)} ` +
      `${_ljust(_len(e.keys), 6)} ${_ljust(posname, 16)} ` +
      `${_ljust(e.order === null || e.order === undefined ? '-' : e.order, 6)} ` +
      `${_ljust(e.probability === null || e.probability === undefined ? '-' : e.probability, 6)} ` +
      `${_len(_str(e.content))}`)
  })
  const const_ = entries.filter((e) => _真(e.constant)).length
  out(`  合计：${entries.length} 条（常驻 ${const_} 条，关键词 ${entries.length - const_} 条，` +
    `共 ${entries.reduce((s, e) => s + _len(e.keys), 0)} 个关键词）`)
}


// ------------------------------------------------------------------ 转 ElecKoi
export function to_eleckoi(path, out_spec, out = _print) {
  /** 酒馆卡 -> ElecKoi 规格（spec）。
   *
   * 若这张酒馆卡是 forge to-tavern 导出的（`data.extensions.eleckoi` 里有存档），
   * 会走「回迁」：变量、分组、正则、未映射字段、条目 id 全取回来，
   * ElecKoi -> 酒馆 -> ElecKoi 不掉东西。条目正文以酒馆侧的当前内容为准。
   */
  const [kind, data] = load_any(path)
  if (kind === 'eleckoi') {
    out('这本来就是 ElecKoi 卡，直接用 forge unpack 拆开即可。')
    return null
  }
  if (kind === 'unknown') {
    throw new ValueError('认不出这是什么结构，不猜。请确认是酒馆 V2/V3 卡或世界书。')
  }

  const body = card_body(data)
  const now = M.nowIso()
  const name = _str(_或(_取(body, 'name', null), _splitext(_basename(path))[0]))

  // 反向导出的存档：有它就能无损回迁
  const restore = _restore_payload(body)
  const id_map = new Map()
  if (_真(restore)) {
    for (const row of (_或(_取(restore, 'entry_map', null), []))) {
      const t = _strip(_str(_或(_取(row, 'title', null), '')))
      if (_真(t) && !id_map.has(t)) id_map.set(t, row)
    }
  }

  let groups
  if (_真(restore) && _真(_取(restore, 'groups', null))) {
    groups = restore.groups.map((g) => M.ordered(g, M.GROUP_KEYS))
  } else {
    groups = [
      _group('grp-opening-wrap', '开场', 0),
      _group('grp-core', '核心', 1),
      _group('grp-world', '世界书', 2),
      _group('grp-ref', '参考', 3),
    ]
  }
  const gids = new Set(groups.map((g) => _取(g, 'id', null)))
  const core_gid = gids.has('grp-core') ? 'grp-core' : (_真(groups) ? _取(groups[0], 'id', null) : '')
  const ref_gid = gids.has('grp-ref') ? 'grp-ref' : core_gid

  const entries = []
  let order = 0
  const seq_hint = new Map()   // 条目 -> 原设定库里的位次（回迁时照它排回原顺序）

  const add = (title, content, 选 = {}) => {
    const trigger = _在(选, 'trigger') ? 选.trigger : 'agent_tool'
    const strategy = _在(选, 'strategy') ? 选.strategy : 'normal'
    const keywords = _在(选, 'keywords') ? 选.keywords : null
    const position = _在(选, 'position') ? 选.position : ''
    const role = _在(选, 'role') ? 选.role : 'user'
    const hint = _在(选, 'hint') ? 选.hint : ''
    const group = _在(选, 'group') ? 选.group : ''
    const enabled = _在(选, 'enabled') ? 选.enabled : true
    order += 1
    const row = _或(id_map.get(_strip(_str(title))), {})
    const use_order = _或(_取(row, 'order', null), order)
    entries.push({
      id: _或(_取(row, 'eleckoi_id', null), M.newId('entry')), title,
      icon_id: _或(_取(row, 'icon_id', null), ''),
      kind: _或(_取(row, 'kind', null), 'normal'),
      group_id: _或(_取(row, 'group_id', null), group),
      content,
      opening_messages: [], default_opening_message_id: '',
      agent_selection_hint: _或(_取(row, 'agent_selection_hint', null), hint),
      agent_read_strategy: _或(_取(row, 'agent_read_strategy', null), strategy),
      dynamic_mode: _或(_取(row, 'dynamic_mode', null), 'standard'),
      keywords: _或(_取(row, 'keywords', null), keywords, []),
      keyword_scan_depth: _取(row, 'keyword_scan_depth', 6),
      condition_keywords: _或(_取(row, 'condition_keywords', null), []),
      keyword_condition: _或(_取(row, 'keyword_condition', null), 'none'),
      keyword_use_regex: _真(_取(row, 'keyword_use_regex', null)),
      keyword_ignore_case: _真(_取(row, 'keyword_ignore_case', true)),
      keyword_whole_word: _真(_取(row, 'keyword_whole_word', null)),
      keyword_recursion_depth: _取(row, 'keyword_recursion_depth', 0),
      trigger_mode: _或(_取(row, 'trigger_mode', null), trigger),
      enabled: _真(_取(row, 'enabled', enabled)),
      position: _在(row, 'position') ? row.position : position,
      prompt_position_id: '',
      insert_role: _或(_取(row, 'insert_role', null), role),
      order: use_order,
      view_order: _取(row, 'view_order', 0),
      group_view_order: _取(row, 'group_view_order', 0),
      tree_view_order: _取(row, 'tree_view_order', use_order),
      created_at: now, updated_at: now,
    })
    if (_取(row, 'seq', null) !== null && _取(row, 'seq', null) !== undefined) {
      seq_hint.set(entries[entries.length - 1], row.seq)
    }
  }

  // 固定开场白条目（永远第一条）
  // 开场白在世界书里没有对应条目，回迁时靠存档还原 id / 标题 / 顺序 / 参数；
  // 正文仍以酒馆侧的 first_mes 与备选开场为准。
  const oa = _或(_取(_或(restore, {}), 'opening', null), {})
  const arch_msgs = _或(_取(oa, 'opening_messages', null), [])

  const _arch = (i) => (i < arch_msgs.length ? arch_msgs[i] : {})

  const openings = []
  if (_真(_strip(_str(_或(_取(body, 'first_mes', null), ''))))) {
    const a = _arch(0)
    openings.push({
      id: _或(_取(a, 'id', null), 'opening-default'),
      title: _或(_取(a, 'title', null), '默认开场'),
      content: _str(_取(body, 'first_mes', null)),
      initial_variable_state: _取(a, 'initial_variable_state', ''),
    })
  }
  (_或(_取(body, 'alternate_greetings', null), [])).forEach((alt, i0) => {
    const i = i0 + 1
    if (_真(_strip(_str(alt)))) {
      const a = _arch(i)
      openings.push({
        id: _或(_取(a, 'id', null), `opening-alt-${i}`),
        title: _或(_取(a, 'title', null), `备选开场 ${i}`),
        content: _str(alt),
        initial_variable_state: _取(a, 'initial_variable_state', ''),
      })
    }
  })

  const arch_default = _取(oa, 'default_opening_message_id', '')
  let dflt_id = openings.some((m) => m.id === arch_default) ? arch_default : ''
  dflt_id = _或(dflt_id, _真(openings) ? openings[0].id : '')

  const opening_entry = {
    id: _或(_取(oa, 'id', null), 'fixed-opening-assistant'),
    title: _或(_取(oa, 'title', null), 'AI角色开场白'),
    icon_id: _或(_取(oa, 'icon_id', null), 'chat'),
    kind: 'opening',
    group_id: _取(oa, 'group_id', ''),
    // 正文取「默认方案」那一份，别留空：`oa` 只有走存档回迁时才有 content，
    // 直接转换时它是 {} —— 于是开场白条目**content 空着**，正文只躺在
    // opening_messages 里。后果是接界面时（`new --从` / `hud --写回`）拿不到正文，
    // 开场白被骨架那条占位顶掉，而 check 一个字都不报。
    content: _或(_取(oa, 'content', null), _真(openings) ? openings[0].content : ''),
    opening_messages: openings,
    default_opening_message_id: dflt_id,
    agent_selection_hint: '',
    agent_read_strategy: _或(_取(oa, 'agent_read_strategy', null), 'normal'),
    dynamic_mode: 'standard', keywords: [], keyword_scan_depth: 1,
    condition_keywords: [], keyword_condition: 'none',
    keyword_use_regex: false, keyword_ignore_case: true,
    keyword_whole_word: false, keyword_recursion_depth: 0,
    trigger_mode: _或(_取(oa, 'trigger_mode', null), 'always'), enabled: true,
    position: _取(oa, 'position', ''),
    prompt_position_id: '',
    insert_role: _或(_取(oa, 'insert_role', null), 'assistant'),
    order: _取(oa, 'order', 0),
    view_order: _取(oa, 'view_order', 0),
    group_view_order: _取(oa, 'group_view_order', 0),
    tree_view_order: _取(oa, 'tree_view_order', 0),
    created_at: now, updated_at: now,
  }

  // 角色字段 -> 核心条目（常驻）
  if (_真(_strip(_str(_或(_取(body, 'system_prompt', null), ''))))) {
    add('核心 · 系统提示词', _str(_取(body, 'system_prompt', null)), {
      trigger: 'always', strategy: 'normal', position: 'instructions',
      role: 'system', group: core_gid,
    })
  }

  const desc_text = _str(_或(_取(body, 'description', null), ''))
  if (_真(_strip(desc_text))) {
    if (_真(restore)) {
      // 回迁：description 里装的是当初合并进去的常驻系统块，按「## 标题」拆回来
      for (const [title, content] of _split_description(desc_text)) {
        add(title, content, {
          trigger: 'always', strategy: 'normal', position: 'instructions',
          role: 'system', group: core_gid,
        })
      }
    } else {
      add('核心 · 角色描述', desc_text, {
        trigger: 'always', strategy: 'normal', position: 'instructions',
        role: 'system', group: core_gid,
      })
    }
  }

  for (const [key, title] of [['personality', '核心 · 性格'],
    ['scenario', '核心 · 场景'],
    ['post_history_instructions', '核心 · 历史后置指令']]) {
    if (_真(_strip(_str(_或(_取(body, key, null), ''))))) {
      add(title, _str(_取(body, key, null)), {
        trigger: 'always', strategy: 'normal', position: 'instructions',
        role: 'system', group: core_gid,
      })
    }
  }

  if (_真(_strip(_str(_或(_取(body, 'mes_example', null), ''))))) {
    add('参考 · 对话示例', _str(_取(body, 'mes_example', null)), {
      group: ref_gid, hint: '需要模仿说话腔调、确认输出格式时读取。',
    })
  }

  // 世界书条目
  for (const e of normalize_entries(_取(body, 'character_book', null))) {
    const content = _str(e.content)
    if (!_真(_strip(content))) continue
    const kw = e.keys.map((k) => _str(k)).filter((k) => _真(_strip(k)))
    const const_ = e.constant
    const raw_title = _strip(_str(e.title))
    // 回迁时用原标题（好让 id_map 认得出来），否则加个前缀并截断
    const title = id_map.has(raw_title)
      ? raw_title : Array.from(`世界书 · ${raw_title}`).slice(0, 60).join('')
    // 有键才走 keyword；非常驻又没键 = 原卡里的「AI 自选读」，对应 normal
    add(title, content, {
      trigger: const_ ? 'always' : 'agent_tool',
      strategy: (const_ || !_真(kw)) ? 'normal' : 'keyword',
      keywords: const_ ? [] : kw,
      position: const_ ? 'instructions' : '',
      role: const_ ? 'system' : 'user',
      group: gids.has('grp-world') ? 'grp-world' : core_gid,
      enabled: e.enabled,
      hint: const_ ? '' : (_真(kw)
        ? `涉及 ${kw.slice(0, 6).join('、')} 时读取。`
        : `${Array.from(raw_title).slice(0, 20).join('')} 相关时读取。`),
    })
  }

  // ---- 组装 spec（回迁时把存档里的变量 / 正则 / 未映射字段取回来）
  if (seq_hint.size > 0) {
    entries.sort((a, b) => _或(seq_hint.get(a), 1e6) - _或(seq_hint.get(b), 1e6))
  }

  const lib_meta = _或(_取(_或(restore, {}), 'library_meta', null), {})
  // bridge.py:558 `"、".join(str(t) for t in (body.get("tags") or []))`
  // —— tags 是字符串时 Python 按**码点**迭代（`"不是列表"` → `不、是、列、表`），
  //     `.map` 会在这种夹具上当场炸。走 `_遍`（Python 的 `for t in x`）。
  const tags = _遍(_或(_取(body, 'tags', null), []), (t) => _str(t)).join('、')

  const spec = {}
  spec.format = M.CARD_FORMAT
  spec.version = _或(_取(_或(restore, {}), 'version', 1), 1)

  const char_out = {
    name, group: tags,
    frontend_beauty_enabled: false, profile_age: '', profile_sex: '',
    profile_height: '', profile_birthday: '', profile_like: '',
    image_prompt: '', opening: '', show_opening: false,
  }
  for (const [k, v] of Object.entries(_或(_取(_或(restore, {}), 'character', null), {}))) {
    if (_在(char_out, k) && k !== 'name' && k !== 'group') char_out[k] = v
  }
  spec.character = M.ordered(char_out, M.CHARACTER_KEYS)
  spec.assets = []
  spec.library = {
    snapshot_format: M.LIB_FORMAT, snapshot_version: 1,
    active_version_id: _或(_取(lib_meta, 'active_version_id', null), M.newId('library')),
    version_name: _取(lib_meta, 'version_name', ''),
    list_all_expanded: _取(lib_meta, 'list_all_expanded', true),
    expanded_group_ids: _或(_取(lib_meta, 'expanded_group_ids', null), []),
    prompt_positions: _或(_取(lib_meta, 'prompt_positions', null), []),
    created_at: now, updated_at: now,
    groups, entries: [opening_entry].concat(entries),
  }
  if (_真(restore) && _真(_取(restore, 'variable_config', null))) {
    spec.variables = _variables_from_config(restore.variable_config, now)
  } else {
    spec.variables = {
      config_format: M.VAR_FORMAT, config_version: 1,
      character_id: M.newId('character'), name: '', version_name: '',
      active_version_id: 'variable-config-default',
      initial_state: {}, schema_code: '', objects: [],
      variables: [], expanded_object_ids: [],
      created_at: '', updated_at: '', config_updated_at: now,
    }
  }
  spec.regex_rules = (_或(_取(_或(restore, {}), 'regex_rules', null), []))
    .map((r) => M.ordered(r, M.REGEX_KEYS))

  M.jdump(spec, out_spec)

  out(`已转换 -> ${out_spec}`)
  if (_真(restore)) {
    out('  ↻ 回迁模式：这张卡是 ElecKoi 制卡工具导出的，已从 data.extensions.eleckoi 取回')
    out(`    变量 ${_len(_或(_取(spec.variables, 'variables', null), []))} 项 / 分组 ${groups.length} 个 / ` +
      `正则 ${spec.regex_rules.length} 条 / 条目 id 与顺序。`)
    out('    条目正文以酒馆侧当前内容为准（你在酒馆里改过的会被带上）。')
  }
  out(`  条目 ${entries.length + 1} 条（含开场白）· 分组 ${groups.length} 个 · ` +
    `开场方案 ${openings.length} 套`)
  out('')
  if (!_真(restore)) {
    out('注意：酒馆和 ElecKoi 不是一一对应，以下三处要人工确认——')
    out('  1. 酒馆有 8 个插入位置，这里只按「强约束 → instructions / 其余留空」粗略映射，')
    out('     导入后请在软件里按需调整（常驻条目位置空着会被过滤掉）。')
    out('  2. 酒馆的「概率触发」「包含组」「向量匹配」「递归扫描」在 ElecKoi 侧没有等价字段，未转换。')
    out('  3. 变量需要在 ElecKoi 里重新定义（酒馆卡通常不变量化）。')
    out('')
  }
  out(`下一步： python forge.py check ${out_spec}`)
  return out_spec
}


// ------------------------------------------------------------------ 回迁支持
export function _restore_payload(body) {
  /** 取出 to-tavern 写下的存档（`data.extensions.eleckoi`）。没有就返回 None。 */
  const ext = _取(body, 'extensions', null)
  if (!_是字典(ext)) return null
  const e = _取(ext, 'eleckoi', null)
  if (!_是字典(e) || _取(e, 'format', null) !== M.CARD_FORMAT) return null
  return e
}


export function _split_description(text) {
  /** 把 to-tavern 合并进 description 的常驻系统块按「## 标题」拆回来。
   *
   * 只认二级标题：作者自己写的正文里若有 `##` 会一起被拆，所以这个函数只在
   * 「确认是自家导出的卡」(restore 模式) 时才调用。
   */
  text = _str(_或(text, ''))
  if (!_真(_strip(text))) return []
  const parts = _按二级标题切(text)
  const out = []
  for (const p of parts) {
    if (!_真(_strip(p))) continue
    const seg = _split1(p, '\n\n')
    const title = _strip(seg[0])
    let content = seg.length > 1 ? seg[1] : ''
    // 块与块之间的 "\n\n" 是导出时拼进去的分隔符，还回去
    if (content.endsWith('\n\n')) {
      content = Array.from(content).slice(0, -2).join('')
    }
    if (_真(title)) out.push([title, content])
  }
  return out
}

/**
 * `re.split(r"(?m)^##[ \t]+", text)` —— **自己扫行首**。
 *
 * 不直接用 JS 的 `/^##[ \t]+/m`：JS 的 `m` 里 `^` 还会在 `\r`、`\u2028`、`\u2029`
 * 之后就匹配，Python 的 `(?m)` 只认 `\n`。差一个字符就是差一段正文。
 */
function _按二级标题切(text) {
  const s = String(text)
  const out = []
  let start = 0
  let i = 0
  while (i < s.length) {
    if (s[i] === '#' && s[i + 1] === '#' && (i === 0 || s[i - 1] === '\n')) {
      let j = i + 2
      while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j += 1
      if (j > i + 2) {
        out.push(s.slice(start, i))
        start = j
        i = j
        continue
      }
    }
    i += 1
  }
  out.push(s.slice(start))
  return out
}


export function _variables_from_config(vc, now) {
  /** 把存档里的整份 `variable_config` 还原成 spec 的 `variables` 段。 */
  if (typeof vc === 'string') {
    const 解 = _tryJson(vc)
    vc = 解 === undefined ? {} : 解
  }
  vc = _或(vc, {})
  const versions = _或(_取(vc, 'versions', null), [])
  const act = _或(_pick(versions, _取(vc, 'active_version_id', null)), {})
  return {
    config_format: _取(vc, 'format', M.VAR_FORMAT),
    config_version: _取(vc, 'version', 1),
    character_id: _取(vc, 'character_id', ''),
    name: _取(vc, 'name', ''),
    version_name: _取(act, 'name', _取(vc, 'name', '')),
    active_version_id: _或(_取(act, 'id', null), _取(vc, 'active_version_id', null),
      'variable-config-default'),
    initial_state: _或(_取(act, 'initial_state', {}), {}),
    schema_code: _或(_取(act, 'schema_code', ''), ''),
    objects: (_或(_取(act, 'objects', null), [])).map((o) => M.ordered(o, M.VAR_OBJECT_KEYS)),
    variables: (_或(_取(act, 'variables', null), [])).map((v) => M.ordered(v, M.VAR_ITEM_KEYS)),
    expanded_object_ids: _或(_取(act, 'expanded_object_ids', null), []),
    created_at: _取(act, 'created_at', ''),
    updated_at: _取(act, 'updated_at', ''),
    config_updated_at: _取(vc, 'updated_at', now),
  }
}


export function _group(gid, name, order) {
  return {
    id: gid, name, parent_id: '',
    order, tree_view_order: order,
    created_at: '', updated_at: '',
  }
}


export function _obj(raw) {
  if (typeof raw === 'string') {
    const 解 = _tryJson(raw)
    if (解 === undefined) return {}
    return _或(解, {})
  }
  return _是字典(raw) ? raw : {}
}


export function _pick(versions, active_id) {
  for (const v of versions) {
    if (_取(v, 'id', null) === active_id) return v
  }
  return _真(versions) ? versions[0] : {}
}
