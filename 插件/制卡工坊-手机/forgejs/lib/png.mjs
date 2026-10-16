/**
 * forge.png 的 JS 版 —— 把成品卡嵌进一张 PNG。
 * ==================================================================
 *
 * 为什么非得有这一件：ElecKoi 原生导入只认一条路 —— PNG 的 tEXt 块
 * `eleckoi-card`，值是 `base64(gzip(原生卡 JSON))`。读不到就当场报
 * 「图片里没有 ElecKoi 角色卡数据」。所以这一模块只干一件事：**写块，
 * 像素一个字节都不动**；反过来还要照客户端的口径把刚写出来的图复读一遍。
 *
 * 完整背景（官方合同、为什么默认不写酒馆 `chara` 块）见 Python 原件
 * `forge/png.py` 的模块 docstring —— 那是真源，这里不复制一份会走散的话。
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 移植纪律（同 model.mjs / opener.mjs 头上那几条）：**行为照抄，不顺手改**；
 * 能逐字节比的逐字节比。
 *
 * ★ 本模块**自己踩过并解决**的六个坑（差分台逼出来的，删掉任何一条都会红）：
 *
 *   1. **gzip 头的 OS 字节**：CPython 的 `gzip.GzipFile._write_gzip_header()`
 *      末行是 `self.fileobj.write(b'\377')   # OS = unknown` —— **硬编码 0xFF**；
 *      而 Node 绑定的 zlib 用的是编译期 `OS_CODE`（本机 Node v24.14.0 给 **0x0A**）。
 *      实测（见 `_gzipPy`）：`gzip.compress(raw, 9, mtime=0)` 与
 *      `gzipSync(raw, { level: 9, mtime: 0 })` 除了**第 10 个字节（下标 9）**之外
 *      逐字节相同（头 `1f8b080000000000 02 __`、deflate 体、CRC32/ISIZE 尾全同）。
 *      差这一个字节，base64 整串不同 ⇒ 差分必红，所以 `_gzipPy` 把下标 9 改回 0xFF。
 *
 *   2. **`JSON.stringify` 丢 `undefined` 键**：Python 那边同一个位置是 `None`，
 *      `json.dumps` 写的是 `null`。手写 compact JSON 时凡走 `_取()` 取值的地方
 *      都可能是 `undefined` ⇒ `_紧凑()` 进门先跑 `_去无()`（undefined → null）。
 *      （本模块用 compact JSON 的两处：iTXt 的 meta 摘要、酒馆降级外壳。）
 *
 *   3. **`%.2f` 不是 `toFixed`**：`"%.2f" % x` 是**半值取偶**（CPython 走
 *      `_Py_dg_dtoa(d, 3, …)`：round-to-nearest, ties-to-even），`toFixed` 是
 *      半值进位。本模块用它拼「%.2f MB」那一行，而 `len(new)/1048576` 是**二进制
 *      精确值**（分母 2^20）—— 只要字节数是 131072 的整数倍就正好落在 .xx5 上，
 *      两个写法当场差 1 个末位数字。⇒ `_f2()` 用 BigInt 精确算。
 *
 *   4. **`base64.b64encode(...).decode("ascii")` 里的那层 base64 极易漏**：
 *      `write()` 里两处内嵌文本（`eleckoi-card` 的原生包、酒馆 `chara` 外壳）
 *      Python 原文都是 `base64.b64encode(bytes).decode("ascii")`；本模块第一版
 *      两处都写成了 `Buffer.from(x).toString('ascii')` —— 直接吐裸字节，
 *      块长当场差一大截（`chara` 块 3754 → 2816 字节），差分第一处不同就报在这里。
 *      记住形状：**gzip/裸字节 → base64 字符串 → latin-1 写进 tEXt**。
 *
 *   5. **整段 deflate 体不可复现（Node 自带的是 fork 过的 zlib）** ——
 *      这是本模块**唯一一处两边产物天生不同**的地方，差分台已申报差异并退到
 *      结构层比（详见 `差分/语料/png.json` 的「说明」与差分台里的 `_PNG分解`）：
 *        · CPython 3.13.14 用上游 zlib **1.3.1**（`zlib.ZLIB_VERSION`）；
 *          Node v24.14.0 自带的是 **fork**：`process.versions.zlib == '1.3.1-e00f703'`。
 *        · 两边都用默认的 Z_DEFAULT_STRATEGY，产物却不同 —— 实测：
 *          `strategy 1/2/3`（Z_FILTERED / Z_HUFFMAN_ONLY / Z_RLE）**逐字节相同**，
 *          `strategy 0/4`（Z_DEFAULT / Z_FIXED）不同；
 *          `memLevel 1..9 × strategy 0..4` **全矩阵扫过，没有一个组合能复现
 *          Python 的默认产物**。
 *        · 分歧还是**数据相关**的：400×'A'、2400 B 渐变图、500 B 混合载荷都逐字节同，
 *          只有结构化 JSON 触发；388 B 的卡 JSON 按前缀二分，**最短分歧前缀＝42 字节**，
 *          且两个首块都是「BFINAL=1、BTYPE=01（固定 Huffman）」⇒ 分歧在
 *          **literal/match 的选择**，不在码表。
 *        ⇒ `gzip.compress(raw, 9, mtime=0)`（卡支路）与 `zlib.compress(rows, 9)`
 *          （`default_cover`）在 JS 侧**保证不了逐字节一致**（实测整张 PNG
 *          4513 vs 4517）。**不要试图用 memLevel / strategy 去凑** —— 全部试过了。
 *          客户端要的四样（gzip 容器头 10 字节、容器尾 8 字节、gunzip 后原生
 *          字节数与 sha256）两边仍然逐字节相同，差分就比这四样 + 每块的数据 sha1。
 *
 *   6. **`0 / 0` 不抛**：`default_cover(1, 1)` 在 Python 里死在 `t = y / (h - 1)`
 *      （`ZeroDivisionError: division by zero`），JS 给 `NaN`、既不抛也不报，
 *      会**默默出一张 69 字节的图** ⇒ 用本地那个类名就叫 `ZeroDivisionError` 的
 *      类 + `_除()` 照抄 Python 的 `/`（除数为零一律抛）。同类还有 `_乘序列()`
 *      拦 `b"\x00" * [4,3]`（Python `TypeError: can't multiply sequence by
 *      non-int of type 'list'`，JS 会默默造出 `[[4,3]]`）。
 *
 * ★ 另有几处是**两边语言天生不同、已知边界**（不是 bug，差分里别去撞）：
 *
 *   · `json.loads(raw.decode("utf-8"))` 的坏输入异常：Python 给
 *     `JSONDecodeError: Expecting value: line 1 column 1 (char 0)`，JS 给
 *     `SyntaxError: …`（措辞完全不同）；非 UTF-8 字节在 Python 是
 *     `UnicodeDecodeError`，在 JS 被 `Buffer#toString('utf8')` 换成 U+FFFD 后
 *     再炸 JSON 解析。⇒ 差分侧的 `算_png` 把整条 `读不了源卡 JSON：…` 折成
 *     `读不了源卡 JSON：<解析器说>`（两侧同名同义，见差分台里的 `_折读不了`）。
 *   · `base64.b64decode` 的宽容度、`gzip.decompress` 对**多成员** gzip 的处理
 *     都与 `Buffer.from(s,'base64')` / `gunzipSync` 不完全一致（本模块写出来的
 *     都是单成员、规范 base64，走不到这些边角）。
 *   · `native.get(...)` 在 Python 里对非 dict 抛 `AttributeError`；JS 侧走的
 *     `CONTENT.取()` 对非对象给默认值。语料不喂非 dict 的卡就不会岔。
 *   · `buffer.encode("latin-1")` 在 Python 里对非 latin-1 字符抛
 *     `UnicodeEncodeError`，JS 的 `Buffer.from(s,'latin1')` 直接截位。本模块
 *     encode latin-1 的两处都只喂 ASCII（base64 串、块关键字）。
 *   · 空 PNG（`img` 里没有 IHDR）在 Python 是 `IndexError: list index out of range`
 *     （列表推导取 `[0]`）；这里用下面那个**类名就叫 `IndexError`** 的本地类照抄同一句
 *     文本 —— 差分台是按 `exc.constructor.name` 记账的，名字必须逐字对上。
 *
 * ★ 路径工具**不重复发明**：`os.path.join / split / splitroot`（`ntpath` 原文）那几件
 *   在 `theme.mjs` 里已经有一份**逐字节对拍过**的克隆（`_join` / `_split` /
 *   `_basename` / `_dirname` / `_splitext` / `_abspath` / `_isdir`），本模块直接复用 ——
 *   Python 那边这些也是 stdlib（不是 forge 自己写的），对应到 JS 就是"共用那唯一一份
 *   忠实实现"，再fork一份迟早走散。（`opener.mjs:_join` 是**故意**不同的另一份：
 *   它跳过空段，对应 `os.path.join` 的另一种调用形状。）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { crc32, deflateSync, gzipSync, gunzipSync } from 'node:zlib'
import * as M from './model.mjs'
import * as SB from './sandbox.mjs'
import * as EXPORT from './export.mjs'
import { pyTruthy, pyStr, pyEq, 或, _错文, _print, 取 as _取 } from './content.mjs'
import { _join, _basename, _dirname, _splitext, _abspath, _isdir } from './theme.mjs'

export const SIG = Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')

// PNG 里那一块叫什么 —— 客户端写死的就是这两个字符串，改一个字母就导不进去。
export const KEYWORD = { card: 'eleckoi-card', preset: 'eleckoi_agent_preset' }
// 客户端拿到数据后还要验 format / version，对不上同样报「不是 ElecKoi 卡」。
export const FORMAT = { card: 'eleckoi.character-card', preset: 'eleckoi.agent-preset' }
export const MAX_PNG = 96 * 1024 * 1024        // readPngText 的上限，超了客户端直接拒

const 空 = Buffer.alloc(0)
const bIHDR = Buffer.from('IHDR', 'latin1')
const bIDAT = Buffer.from('IDAT', 'latin1')
const bIEND = Buffer.from('IEND', 'latin1')
const bTEXT = Buffer.from('tEXt', 'latin1')
const bITXT = Buffer.from('iTXt', 'latin1')


export class PngError extends Error {
  /** PNG 这张壳的事 —— 内容/来源不对，说一句人话就够，不必打栈。 */
  constructor(message) {
    super(message)
    this.name = 'PngError'
  }
}

/**
 * 本地 `IndexError` —— **类名一个字都不能改**。
 *
 * 差分台记账用的是 `exc.constructor.name`（Python 侧是 `type(exc).__name__`），
 * 而 `chunks()` 里「没有 IHDR」那一支 Python 抛的是 `IndexError: list index out of range`。
 * 叫 `PyIndexError` 之类就会在差分的异常文本里现出原形，只能照抄这个名字（模块内遮蔽全局同名）。
 */
class IndexError extends Error {
  constructor(message) {
    super(message)
    this.name = 'IndexError'
  }
}

/**
 * 本地 `ZeroDivisionError` —— 同上，**类名照抄**。
 *
 * `default_cover(1, 1)` 在 Python 里死在第 124 行 `t = y / (h - 1)` 上
 * （`int / int` 除零 ⇒ `ZeroDivisionError: division by zero`）；JS 的 `0 / 0`
 * 是 `NaN`、既不抛也不报，于是会**默默出一张 69 字节的图**，与 Python 分岔。
 */
class ZeroDivisionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ZeroDivisionError'
  }
}

/** Python 的 `/`：除数为零一律抛（`0 / 0` 也抛，不像 JS 给 NaN）。 */
function _除(a, b) {
  if (b === 0) throw new ZeroDivisionError('division by zero')
  return a / b
}

/**
 * 本地 `OSError` 三兄弟 —— 同上，**类名照抄**（差分按 `exc.constructor.name` 记账）。
 *
 * POSIX 的 `str(exc)` 是 `[Errno 2] No such file or directory: '<路径>'`，Node 那边是
 * `ENOENT: no such file or directory, open '<路径>'`（且 `errno`/`syscall`/`path` 是三个
 * 属性，不是前缀）。Windows 上 CPython 用的是 CRT 的 strerror，文本只能硬抄。
 */
class FileNotFoundError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FileNotFoundError'
  }
}
class IsADirectoryError extends Error {
  constructor(message) {
    super(message)
    this.name = 'IsADirectoryError'
  }
}
class PermissionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PermissionError'
  }
}


// ------------------------------------------------------------------ Python 语义小工具

/** Python `str(v)`（容器走 repr，其余走 pyStr）—— `"%s" % v` 用。 */
const _str = (v) => (v !== null && typeof v === 'object' ? M.pyRepr(v) : pyStr(v))

/**
 * `open(p, "rb").read()` —— ENOENT / EISDIR / EACCES 的文本照抄 Python。
 *
 * ★ 路径用的是**传进来那个字符串**（不是 `exc.path`）：Node 会把 `/` 规范化成 `\`，
 *   而 CPython 原样回显。先例见 `draft.mjs` 的 `_列目录()`。
 */
function _读文件(p) {
  try {
    return readFileSync(p)
  } catch (exc) {
    throw _文件错(p, exc)
  }
}

/** `open(p, "wb").write(数据)` —— 同上。 */
function _写文件(p, 数据) {
  try {
    writeFileSync(p, 数据)
  } catch (exc) {
    throw _文件错(p, exc)
  }
}

function _文件错(p, exc) {
  switch (exc && exc.code) {
    case 'ENOENT': return new FileNotFoundError(`[Errno 2] No such file or directory: '${String(p)}'`)
    case 'EISDIR': return new IsADirectoryError(`[Errno 21] Is a directory: '${String(p)}'`)
    case 'EACCES':
    case 'EPERM': return new PermissionError(`[Errno 13] Permission denied: '${String(p)}'`)
    default: return exc
  }
}

/** Python `type(v).__name__` —— 只覆盖错误文本里可能出现的那几个。 */
function _类型名(v) {
  if (v === null || v === undefined) return 'NoneType'
  if (Array.isArray(v)) return 'list'
  if (Buffer.isBuffer(v)) return 'bytes'
  switch (typeof v) {
    case 'string': return 'str'
    case 'boolean': return 'bool'
    case 'number': return Number.isInteger(v) ? 'int' : 'float'
    case 'object': return 'dict'
    default: return typeof v
  }
}

/**
 * Python `bytes * n`。
 *
 * ★ 乘数**不是整数**时 Python 抛
 *   `TypeError: can't multiply sequence by non-int of type 'list'`
 *   （措辞照抄 `Objects/abstract.c`，类型名取自被乘的那个数）。JS 的
 *   `new Array([4, 3])` 既不抛、还会造出 `[[4, 3]]`，于是默默出一张图 —— 必须自己拦。
 *   布尔是 `int` 的子类，`b"x" * True` 在 Python 里合法，照办。
 */
function _乘序列(seq, n) {
  let k
  if (typeof n === 'boolean') k = n ? 1 : 0
  else if (typeof n === 'number' && Number.isInteger(n)) k = n
  else throw new TypeError(`can't multiply sequence by non-int of type '${_类型名(n)}'`)
  if (k <= 0) return Buffer.alloc(0)
  return Buffer.concat(new Array(k).fill(seq))
}

/** `hashlib.sha256(b).hexdigest()`。 */
const _sha256hex = (b) => createHash('sha256').update(b).digest('hex')

/**
 * `json.dumps(obj, ensure_ascii=False, separators=(",", ":"))` —— 紧凑 JSON。
 *
 * `JSON.stringify(obj)` 的分隔符与转义规则与 Python 那组参数逐字节一致（都不转义非 ASCII、
 * 都按插入序输出键）。**唯一要补的**是 `undefined`：Python 的 dict 里没有这个概念，
 * 而 JS 这边 `_取()` 取不到的键给的是 `undefined`，`JSON.stringify` 会把整个键**丢掉**
 * 而 Python 写的是 `null` ⇒ 先进门折一遍（移植记号 2）。
 */
function _紧凑(obj) {
  return JSON.stringify(_去无(obj))
}

function _去无(x) {
  if (x === undefined) return null
  if (Array.isArray(x)) return x.map(_去无)
  if (x !== null && typeof x === 'object') {
    const o = {}
    for (const k of Object.keys(x)) o[k] = _去无(x[k])
    return o
  }
  return x
}

/**
 * `gzip.compress(raw, level, mtime=0)` —— **补齐 CPython 的 OS 字节**（移植记号 1）。
 *
 * 除了 gzip 头的第 10 个字节（下标 9）之外两边逐字节相同：CPython 在
 * `gzip.py:_write_gzip_header()` 末尾硬编码 `b'\377'`，Node 用 zlib 编译期的 `OS_CODE`
 * （本机 0x0A）。别的都不动 —— deflate 体与 CRC32/ISIZE 尾是同一个 zlib 出来的，实测同。
 */
function _gzipPy(raw, level) {
  const g = gzipSync(raw, { level, mtime: 0 })
  g[9] = 0xff
  return g
}

/**
 * `"%.2f" % x` —— **半值取偶**，不是 `toFixed`（移植记号 3）。
 *
 * 做法：把 IEEE-754 双精度拆成 `mant * 2^exp` 的**精确**二进制有理数（BigInt），
 * 再对 `x * 100` 做一次精确的 round-half-even，最后拼十进制文本。
 * 这样与 CPython `_Py_dg_dtoa(d, 3, 2, …)` 的「正确舍入＋遇半取偶」逐例一致。
 */
function _f2(x) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : (x > 0 ? 'inf' : '-inf')
  const 负 = x < 0 || Object.is(x, -0)
  const dv = new DataView(new ArrayBuffer(8))
  dv.setFloat64(0, Math.abs(x))
  const hi = dv.getUint32(0)
  const lo = dv.getUint32(4)
  let exp = (hi >>> 20) & 0x7ff
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  if (exp === 0) exp = 1                       // 次正规数：没有隐含的 1 位
  else mant |= 1n << 52n
  exp -= 1075                                  // |x| = mant * 2^exp（精确）
  const num = mant * 100n
  let 整
  if (exp >= 0) {
    整 = num << BigInt(exp)
  } else {
    const d = 1n << BigInt(-exp)
    let q = num / d
    const r = num % d
    const 两倍 = r * 2n
    if (两倍 > d) q += 1n
    else if (两倍 === d && q % 2n === 1n) q += 1n
    整 = q
  }
  return `${负 ? '-' : ''}${整 / 100n}.${String(整 % 100n).padStart(2, '0')}`
}


// ------------------------------------------------------------------ PNG 块
/** 按块切开一份 PNG，返回 `[[类型, 数据, 起, 止], …]`（Python 那边是 list of tuple）。 */
export function chunks(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (b.length < SIG.length || !b.subarray(0, SIG.length).equals(SIG)) {
    throw new PngError('不是 PNG（头八个字节不对）')
  }
  const out = []
  let i = 8
  while (i < b.length) {
    if (i + 8 > b.length) {
      throw new PngError('PNG 截断了（块头不完整）')
    }
    const ln = b.readUInt32BE(i)
    const typ = b.subarray(i + 4, i + 8)
    if (i + 12 + ln > b.length) {
      throw new PngError(`PNG 截断了（${typ.toString('latin1')} 块声明 ${ln} 字节，后面不够）`)
    }
    out.push([typ, b.subarray(i + 8, i + 8 + ln), i, i + 12 + ln])
    i += 12 + ln
  }
  if (!out.length || !out[out.length - 1][0].equals(bIEND)) {
    throw new PngError('PNG 没有 IEND 收尾（客户端会当坏图）')
  }
  return out
}


export function _mk(typ, data) {
  const 头 = Buffer.alloc(4)
  头.writeUInt32BE(data.length, 0)
  const 尾 = Buffer.alloc(4)
  尾.writeUInt32BE(crc32(Buffer.concat([typ, data])) >>> 0, 0)
  return Buffer.concat([头, typ, data, 尾])
}


export function _mk_text(keyword, text) {
  return _mk(bTEXT, Buffer.concat([
    Buffer.from(keyword, 'latin1'), Buffer.from([0x00]), Buffer.from(text, 'latin1'),
  ]))
}


export function _mk_itxt(keyword, text) {
  const d = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]),   // 分隔符 + 压缩标志/方法 + 空语言/译文关键字
    Buffer.from(text, 'utf8'),
  ])
  return _mk(bITXT, d)
}


/**
 * 照客户端的读法取文本块：**只认 tEXt**（iTXt 不读），keyword 与值以 `\0` 分隔。
 *
 * 这段是照着 `PngTextChunkCodec.readPngText` 的行为写的，不是照 PNG 规范。
 * 两处不一样的地方正是坑：iTXt 白写、keyword 空的不取、值空的不取。
 */
export function read_text(buf) {
  const got = {}
  for (const [typ, data] of chunks(buf)) {
    if (!typ.equals(bTEXT)) continue
    const sep = data.indexOf(0x00)
    if (sep <= 0 || sep >= data.length - 1) continue
    got[data.subarray(0, sep).toString('latin1')] = data.subarray(sep + 1).toString('latin1')
  }
  return got
}


export function _sha12(b) {
  return createHash('sha256').update(b).digest('hex').slice(0, 12).toUpperCase()
}


/**
 * 没有封面图时现画一张 —— 竖向渐变 + 一道暖色横线。
 *
 * 为什么要自己画：forge 不依赖 Pillow（本工具只有 PyYAML 一个第三方依赖），
 * 而「没有图」不该堵住发卡这条路。图只是外壳，卡数据才是内容。
 */
export function default_cover(w = 640, h = 960) {
  const top = [18, 22, 38]
  const mid = [38, 34, 52]
  const bot = [92, 56, 44]
  const 行s = []
  const band_y = Math.trunc(h * 0.68)
  for (let y = 0; y < h; y += 1) {
    const t = _除(y, h - 1)          // h == 1 时 Python 在这里 ZeroDivisionError（见 _除）
    let u, a, b
    if (t < 0.5) { u = _除(t, 0.5); a = top; b = mid }
    else { u = _除(t - 0.5, 0.5); a = mid; b = bot }
    const px = Buffer.alloc(3)
    for (let i = 0; i < 3; i += 1) px[i] = Math.trunc(a[i] + (b[i] - a[i]) * u)   // Python `int()` 向零截断
    if (Math.abs(y - band_y) <= 2) {
      for (let i = 0; i < 3; i += 1) px[i] = Math.min(255, px[i] + 55)
    }
    行s.push(Buffer.concat([Buffer.from([0x00]), _乘序列(px, w)]))   // 每行头一个 0 = 不过滤
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([SIG, _mk(bIHDR, ihdr), _mk(bIDAT, deflateSync(Buffer.concat(行s), { level: 9 })), _mk(bIEND, 空)])
}


/** `to_tavern` 的打印口 —— 嵌 PNG 时那些进度行是噪音。 */
export function _swallow() {
  return null
}


// ------------------------------------------------------------------ 干活
/**
 * 把 `card_path`（原生卡 .json）嵌进一张 PNG，落到 `out_path`。
 *
 * `tavern=True` 时额外写一个酒馆 `chara` 块（默认**不写**）—— 官方「角色卡同步协议」
 * 明写：ElecKoi 导出**禁止**携带 `chara` / `ccv3` / `chara_card_v2` 这类第三方兼容载荷，
 * 而且验收条款里要查「只有一个 `eleckoi-card` 文本块、不存在 `chara` / `ccv3`」。
 * 所以默认照合同走；真要一份也能喂酒馆的图，显式开这一项。
 *
 * 返回 `{"png": …, "bytes": …, "native_bytes": …, "sha256": …}`。
 */
export function write(card_path, out_path = null, cover = null, kind = 'card',
                      quiet = false, tavern = false, out = _print) {
  if (!Object.hasOwn(KEYWORD, kind)) {
    throw new PngError(`不认识的产物类型：${_str(kind)}（只会 card / preset）`)
  }

  const raw = _读文件(card_path)
  let native
  try {
    native = JSON.parse(raw.toString('utf8'))
  } catch (exc) {
    throw new PngError(`读不了源卡 JSON：${_错文(exc)}`)
  }

  const fmt = _取(native, 'format')
  if (fmt !== FORMAT[kind]) {
    throw new PngError(`这份文件不是 ${kind === 'card' ? 'ElecKoi 角色卡' : 'ElecKoi 预设'}（format=${M.pyRepr(fmt)}，应该是 ${M.pyRepr(FORMAT[kind])}）`)
  }

  if (out_path === null || out_path === undefined) {
    out_path = default_out(card_path)
  }

  const 名字 = _name_of(native, kind)
  const name = pyTruthy(名字) ? 名字 : _splitext(_basename(card_path))[0]

  // ① 客户端唯一认的那一块。
  //    卡：`base64(gzip(原始字节))` —— 直接压原始字节、不重新 dumps，
  //        取出后才能与 .card.json 逐字节一致。
  //    预设：`base64(utf8(json))` —— **不压缩**。客户端 `encodeElecKoiAgentPresetPng`
  //        只 base64 一次，解码处（`AgentPresetImportCodec.ts:166`）也只
  //        `Buffer.from(encoded,'base64').toString('utf8')`，没有 gunzip。
  //        这里要是顺手压了，对方解出来是 gzip 字节，JSON.parse 当场炸。
  const 原生包 = kind === 'card' ? _gzipPy(raw, 9) : Buffer.from(raw)
  const native_b64 = Buffer.from(原生包.toString('base64'), 'ascii')

  const blocks = [_mk_text(KEYWORD[kind], native_b64.toString('ascii'))]

  // ② 酒馆外壳（只给「显式要一份也能喂酒馆的图」用；默认不写 —— 官方合同禁止）
  let chara_note = ''
  if (kind === 'card' && pyTruthy(tavern)) {
    const chara_bytes = _chara_wrapper(card_path, raw, native)
    blocks.push(_mk_text('chara', Buffer.from(chara_bytes).toString('base64')))
    chara_note = `酒馆 V2 外壳 ${chara_bytes.length} 字节（非默认，按官方合同本不该带）`
  }

  // ③ 给人看的摘要
  const meta = _紧凑({
    title: name,
    kind: kind === 'card' ? 'ElecKoi 角色卡 · PNG 外壳' : 'ElecKoi 创作预设 · PNG 外壳',
    format: fmt,
    version: _取(native, 'version'),
    size_bytes: raw.length,
    native_sha256: _sha256hex(raw),
    read_back: kind === 'card'
      ? `取 tEXt \`${KEYWORD[kind]}\` -> base64 解码 -> gunzip -> 就是原样的 .card.json`
      : `取 tEXt \`${KEYWORD[kind]}\` -> base64 解码 -> 就是原样的 .preset.json（预设不 gzip）`,
  })
  blocks.push(_mk_itxt(`${M.asciiPrefix(name, 'card')}-meta`, meta))

  const img = pyTruthy(cover) ? _读文件(cover) : default_cover()

  const cs = chunks(img)
  const ihdr列 = cs.filter((c) => c[0].equals(bIHDR))
  if (!ihdr列.length) throw new IndexError('list index out of range')
  const ihdr_end = ihdr列[0][3]
  const 新 = Buffer.concat([img.subarray(0, ihdr_end), ...blocks, img.subarray(ihdr_end)])

  // 临时文件必须落在**目标同一个目录**里：跨盘 `os.replace` 会
  // `WinError 17 系统无法将文件移到不同的磁盘驱动器`（系统临时目录在 C:，
  // 而卡可能在 E:）。同目录还能保住原子性。
  const d = _dirname(_abspath(out_path))
  if (pyTruthy(d) && !_isdir(d)) {
    mkdirSync(d, { recursive: true })
  }
  const tmp = out_path + '.part'
  _写文件(tmp, 新)
  SB.land(tmp, out_path)
  SB.cleanup(tmp)

  const res = {
    png: out_path,
    bytes: 新.length,
    native_bytes: raw.length,
    sha256: _sha256hex(新),
  }

  if (!pyTruthy(quiet)) {
    out(`写出：${out_path}（${新.length} 字节，${_f2(新.length / 1048576)} MB）`)
    out(`  内嵌：${KEYWORD[kind]} ${raw.length} 字节（base64 ${native_b64.length}）· ${pyTruthy(chara_note) ? chara_note : '无酒馆外壳'}`)
    out(`  取法：读 PNG 的 tEXt \`${KEYWORD[kind]}\` → base64 解码${kind === 'card' ? ' → gunzip' : '（预设不压缩）'} → 得到与源文件逐字节一致的 ${kind === 'card' ? '.card.json' : '.preset.json'}`)
  }

  return res
}


/**
 * 默认出哪儿：`<名>.card.json` -> `<名>.card.png`，就在旁边。
 *
 * 工程里的 `source/xxx.spec.yaml` 特殊一点 —— 出到同工程的 `成品/`，
 * 因为那是 forge 放产物的地方（`new` 建出来的工程就是这个形状），
 * 让人在 `source/` 里捡到一张卡图会奇怪。
 */
export function default_out(src) {
  const d0 = _dirname(_abspath(src))
  let d = d0
  let stem = _basename(src)
  let 命中 = false
  for (const suf of ['.spec.yaml', '.spec.yml', '.card.json', '.yaml', '.yml', '.json']) {
    if (stem.toLowerCase().endsWith(suf)) {
      stem = stem.slice(0, stem.length - suf.length)      // Python `stem[:-len(suf)]`
      命中 = true
      break
    }
  }
  if (!命中) {                                            // Python 的 for/else
    stem = _splitext(stem)[0]
  }
  if (_basename(d).toLowerCase() === 'source') {
    const made = _join(_dirname(d), '成品')
    if (_isdir(made)) d = made
  }
  return _join(d, stem + '.card.png')
}


export function _name_of(native, kind) {
  if (kind === 'card') {
    const ch = 或(_取(native, 'character'), {})
    return 或(_取(ch, 'name'), _取(native, 'name'))
  }
  return _取(native, 'name')
}


/**
 * 酒馆 V2 外壳：借 `to-tavern` 那套映射，完整卡塞进 `extensions.eleckoi.source_card`。
 *
 * 这么做而不是自己拼一个壳：条目/正则/变量往酒馆字段上的映射是
 * `export.py` 里已经调准过的东西（世界书、regex_scripts、未映射字段兜底），
 * 另写一份迟早与它走散。`keep_raw=True` 让完整卡原样躺在壳里 —— 无损。
 */
export function _chara_wrapper(card_path, raw, native) {
  const tmp = M.tempJson()
  try {
    EXPORT.to_tavern(card_path, tmp, true, _swallow)
    const data = _读文件(tmp)
    const wrapper = JSON.parse(data.toString('utf8'))
    const 一 = 或(_取(wrapper, 'data'), {})
    const 二 = 或(_取(一, 'extensions'), {})
    const 三 = 或(_取(二, 'eleckoi'), {})
    const back = _取(三, 'source_card')
    // Python 的 `back != native` 是**深比较**（比的是整棵嵌套 dict）；JS 的 `!==` 只比引用，
    // 拿它比会把恒不相等的两个对象判成"不等"。用 content.mjs 那份对拍过的 pyEq。
    if (!pyEq(back, native)) {                     // 壳可以少字段，完整卡不能少
      throw new PngError('酒馆外壳里的 source_card 与源卡不等（export.to_tavern 出问题了）')
    }
    return data
  } catch (exc) {
    if (exc instanceof PngError) throw exc
    // 最小卡（没条目、没变量的半成品）不该因为壳拼不出来就发不出 PNG
    // —— 客户端本来也只认 eleckoi-card 那一条。
    const minimal = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 或(_name_of(native, 'card'), '未命名'),
        description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
        creator_notes: '', system_prompt: '', post_history_instructions: '',
        alternate_greetings: [], tags: [], creator: '', character_version: '',
        extensions: {
          eleckoi: {
            source_card: native,
            note: `酒馆外壳降级生成（${_错文(exc)}）`,
          },
        },
      },
    }
    return Buffer.from(_紧凑(minimal), 'utf8')
  } finally {
    SB.cleanup(tmp)
  }
}


/**
 * 照客户端的口径把刚写出来的 PNG 复读一遍。五条断言，一条不落。
 *
 * 任何一条不过都抛 `PngError` —— 「导出成功但导不进去」是这份工具最该防的事。
 */
export function verify(png_path, expect_native = null, allow_tavern = false, out = _print) {
  const buf = _读文件(png_path)
  const cs = chunks(buf)
  if (buf.length > MAX_PNG) {
    throw new PngError(`整张 PNG ${buf.length} 字节，超过客户端 ${Math.trunc(MAX_PNG / 1048576)} MB 上限`)
  }

  const got = read_text(buf)
  const kw = Object.hasOwn(got, 'eleckoi-card') ? 'eleckoi-card' : 'eleckoi_agent_preset'
  if (!Object.hasOwn(got, kw)) {
    throw new PngError('PNG 里没有 `eleckoi-card` 块 —— 手机上仍会报「图片里没有 ElecKoi 角色卡数据」')
  }

  // 卡 gzip 过、预设没有 —— 客户端两处解码器不一样，这里得跟着分叉
  const raw_native = Buffer.from(got[kw], 'base64')
  const native = kw === 'eleckoi-card' ? gunzipSync(raw_native) : raw_native
  if (expect_native !== null && expect_native !== undefined && !native.equals(expect_native)) {
    throw new PngError(`\`${kw}\` 解出来与源文件不一致`)
  }
  const root = JSON.parse(native.toString('utf8'))
  const want = kw === 'eleckoi-card' ? FORMAT.card : FORMAT.preset
  if (_取(root, 'format') !== want) {
    throw new PngError(`format 不对（拿到 ${M.pyRepr(_取(root, 'format'))}，客户端要 ${M.pyRepr(want)}）`)
  }

  // 像素没动：IDAT 与源图逐字节一致（源图不在手边时至少确认块还能解析）
  const idat = Buffer.concat(cs.filter((c) => c[0].equals(bIDAT)).map((c) => c[1]))
  if (!idat.length) {
    throw new PngError('PNG 里没有 IDAT（不是一张真图）')
  }

  // ★ 官方合同：PNG 里**只该有一个** `eleckoi-card` 那条 tEXt，且不得带
  //   `chara` / `ccv3` / `chara_card_v2` 这类第三方兼容载荷。验收条款第 4 条查的就是这个。
  //   （显式开了 `--带酒馆块` 就放行 —— 那是明确选择，不是默认行为。）
  const textz = cs.filter((c) => c[0].equals(bTEXT)).map((c) => _前0(c[1]))
  const 禁止 = [Buffer.from('chara'), Buffer.from('ccv3'), Buffer.from('chara_card_v2')]
    .filter((k) => textz.some((t) => t.equals(k)))
  if (禁止.length && !pyTruthy(allow_tavern)) {
    throw new PngError(`PNG 里带了官方禁止的第三方块：${禁止.map((k) => k.toString('ascii')).join('、')}（ElecKoi 导出的合同第 4 条验收会挂）`)
  }
  if (kw === 'eleckoi-card' && textz.filter((t) => t.equals(Buffer.from('eleckoi-card'))).length !== 1) {
    throw new PngError(`\`eleckoi-card\` 出现了 ${textz.filter((t) => t.equals(Buffer.from('eleckoi-card'))).length} 次，官方合同要求只有一个文本块`)
  }

  if (pyTruthy(out)) {
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    out(`✔ 自检：${kw} · ${w}×${h} · ${buf.length} 字节 · sha256 ${_sha12(buf)}`)
    out(`  \`${kw}\` 解出 ${native.length} 字节，format=${_str(_取(root, 'format'))} version=${_str(_取(root, 'version'))}`)
  }
  return {
    png: png_path,
    keyword: kw,
    native_bytes: native.length,
    format: _取(root, 'format') ?? null,
  }
}


/** `b"...".split(b"\x00", 1)[0]` —— 第一个 NUL 之前那一段（没有 NUL 就是整条）。 */
function _前0(d) {
  const i = d.indexOf(0x00)
  return i === -1 ? d : d.subarray(0, i)
}


/** 独跑：`node forgejs/lib/png.mjs <卡.json> [-o 出.png] [--图 封面.png]`。 */
export function main(argv = null) {
  const 参数 = (argv === null || argv === undefined) ? process.argv.slice(2) : Array.from(argv)
  if (!参数.length) {
    _print('PNG 卡 —— 把成品卡嵌进一张图。')      // Python `__doc__.strip().splitlines()[0]`
    _print('用法：python -m forge.png <卡.json> [-o 出.png] [--图 封面.png]')
    return 2
  }
  const src = 参数[0]
  let out_path = null
  let cover = null
  const rest = 参数.slice(1)
  let i = 0
  while (i < rest.length) {
    if ((rest[i] === '-o' || rest[i] === '--out') && i + 1 < rest.length) {
      out_path = rest[i + 1]; i += 2; continue
    }
    if ((rest[i] === '--图' || rest[i] === '--cover') && i + 1 < rest.length) {
      cover = rest[i + 1]; i += 2; continue
    }
    i += 1
  }
  out_path = pyTruthy(out_path) ? out_path : default_out(src)
  write(src, out_path, cover)
  verify(out_path)
  return 0
}
