/**
 * forge.dist 的 JS 版 —— 工程包的分发：出去（清单）与回来（导入）。
 * ==========================================================================
 *
 * `bundle` 把工程打成一个 zip；这里补上另一半。分发的两个麻烦都在「包离开这台
 * 电脑之后」：包到底完不完整（清单：每个文件的字节数与 sha256）、包里的路径能
 * 不能信（zip 条目名是**别人给的字符串**，`../../../Windows/System32/...` 或
 * `C:\...` 都是合法 zip ⇒ 导入时逐条查，绝对路径／盘符／`..` 一律硬拒）。
 *
 * 另一件事：外来卡常常是单张 `.card.json`，那种走 unpack 落成只有内容层的工程。
 *
 * ----------------------------------------------------------------- 移植记号
 *
 * 移植纪律（同 model.mjs / content.mjs / opener.mjs 头上那几条）：**行为照抄，
 * 不顺手改**；能逐字节比的逐字节比。本模块**已知边界**（不是 bug，是兄弟模块
 * 落地进度／两边语言天生不同）：
 *
 *   1. **zip 自己读**（`_读zip()`）：Node 标准库没有 zip。照 `bridge.mjs` 的先例
 *      手写中央目录解析（`zipfile.ZipFile` 本来也只读中央目录）。坏包抛的名字
 *      必须叫 **`BadZipFile`** —— 差分里记的是 `type(exc).__name__`。
 *      只做了 store(0) 与 deflate(8)，zip64 没做（工程包不会那么大）。
 *   2. **本模块自己不写 YAML**：`forgejs` 的 `M.ydump` 直接抛（计划 §二①）。
 *      `_import_card` 里 `pack.unpack` 落的是 **`.spec.yaml`**（照抄 Python 的路径形状，
 *      走 `pack.mjs` 内部那条已备案的落盘路）；`bridge.to_eleckoi` 那条兜底路里
 *      原件写的是 `M.ydump(spec)` ⇒ 这边**改走 `M.jdump`、后缀 `.json`**（差分按
 *      `_树()` 的 `.spec.` 分支比**结构**，不比字节）。清单本身是 JSON，不碰 YAML。
 *   3. **`str.replace` 换全部、JS `String.replace` 只换第一处** ⇒ 一律走
 *      `_替全部()`。`_clean_name()` 里那串非法字符替换是最容易踩的一处。
 *   4. `if x:` 一律走 `CONTENT.pyTruthy()` —— JS 里 `[]` / `{}` 是**真值**。
 *      （`if manifest:`、`if verify and manifest:`、`if info.get("校验")` 都按这条办。）
 *   5. `"%s" % None` → `"None"`、`"%d"` 是整数 ⇒ 用 `_strPy()`（null→'None'、
 *      true→'True'）与 `_intPy()`；别用模板串直接塞（null 会变空串）。
 *      `manifest.get(k, d)` 的**默认值语义**也别写 `??`：`??` 只兜 null/undefined。
 *   6. **`path.join` ≠ `os.path.join`**（Python 只接分隔符、保留原有的 `/`；
 *      Node 会规范化）⇒ 自写 `_join()`，同 `opener.mjs` / `hud.mjs`。
 *      同理 `os.sep` 用 `_SEP`（Windows 反斜杠）。
 *   7. `os.path.relpath` 在 Windows 上**把 `/` 换成 `\`** —— 兄弟模块里没有现成的，
 *      自写 `_relpath()`（**别用 `node:path` 的 `relative`**：它只认 `/`，传
 *      `C:\a\b` 进去会算出整个字符串）。UNC 与跨盘符那两条分岔没复刻。
 *      写进清单前再补一句 `.replace(os.sep, "/")`，与原件逐字对应。
 *   8. **Windows 的 OSError 文本只能硬抄**（Node 错误对象没有 `winerror`）。本模块
 *      唯一一处 `except OSError: continue`（`build_manifest` 里 stat 不到的条目）
 *      把这类差异整个吞了，差分里不必复现。
 *   9. **排序**：Python `sorted(names)` 按**码点**，JS `Array.sort()` 默认按
 *      UTF-16 码元 —— 只在增补平面字符（> U+FFFF）上分岔 ⇒ 走 `_比码点()`。
 *  10. `os.path.relpath` 的跨盘符行为（Windows 上不同盘抛 `ValueError`）没复刻
 *      —— 差分台里工程根与目标同盘（都建在 `差分\` 底下）。
 *  11. `_digest(path, limit=None)` 的 `limit` 在原件里就是死参（从没用过），照抄
 *      签名但不实现任何截断。
 *  12. **`_import_zip` 不还原文件的 mtime**：Python 用 `zipfile.open()` 的流也不还原
 *      （`extract()` 才还原），所以两边落出来的 mtime 都是「此刻」—— 差分只比字节与
 *      sha1，不碰 mtime，这条不算差异。
 *
 * 差分台逮到的四处（都在 `dist.mjs` 自己的代码里，不是语言天生差异）：
 *
 *  13. **`os.path.abspath` ≠ `path.resolve`**：Windows 的 `abspath` 是
 *      `normpath(join(cwd, p))`，**把 `/` 一律折成 `\`**；`resolve()` 会原样留住。
 *      语料里用 `@根@/差分/语料/dist/x.zip` 拼出来的混合分隔符路径，Python 报错时
 *      印的是 `E:\…\dist\x.zip`，JS 印的是 `E:\…\制卡工具/差分/语料/dist/x.zip`。
 *      ⇒ 自写 `_normpath()` / `_abspath()`（见那两处注释），`import_pack` 报错文案、
 *      `_settle`、`build_manifest`、越界检查**全走 `_abspath()`**。
 *      踩中的第二层：盘符开头的串一旦带上 `\\`，`resolve()` 就当它已经绝对、原样返回
 *      ⇒ 自己拼 `cwd + _SEP + 尾` 会把 base 重两遍（报出来是「找不到包」这种离根因
 *      很远的文案）。`_abspath` 里**只调一次 `resolve()`**，不再自己拼。
 *  14. **`_clean_name` 尾巴那句是 `s.strip(".")`**（只管两端的 `.`），我第一版写成
 *      `str.replace` 的语义（换全部）⇒ `甲.spec` 被吃成 `甲spec`。改成
 *      `.replace(/^\.+/, '').replace(/\.+$/, '')`。
 *  15. **`readdirSync` 忘了 import** ⇒ `build_manifest()` 现扫那一段的
 *      `try { readdirSync(...) } catch { return }` 把 `ReferenceError` 一并咽了，
 *      清单静默变空（`node --check` 全绿也照不出来）。**手动写文件操作时，先逐个
 *      对一遍 `node:fs` 的导入清单** —— 原件里那个 `except OSError: continue`
 *      式的兜底会吃掉这类错误。
 *  16. **`build_manifest().生成时间` 走 `M.now_iso()`**，差分台通用脱敏（`_动()`）只
 *      认「日期属性名／id／路径」那几类**键名**，认不出值里嵌的 ISO ⇒ 两侧的
 *      `算_dist` 各加一层 `_稳时间()` / `稳时间()`（把 `_ISO` 命中换成 `<时间>`）。
 *      语料那边 `SKIP_DIRS` 是 **set**：`json.dumps` 直接
 *      `TypeError: Object of type set is not JSON serializable`，JS 这边
 *      `JSON.stringify(Set)` 给 `{}` ⇒ 两侧都折成**按码点排序的数组**再进结构。
 */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync }
  from 'node:fs'
import { resolve } from 'node:path'   // 仅 `_relpath()` 兜底用；**路径语义一律走 `_abspath()`**
import { inflateRawSync } from 'node:zlib'
import * as M from './model.mjs'
import * as P from './pack.mjs'
import * as SB from './sandbox.mjs'
import * as CONTENT from './content.mjs'

// ------------------------------------------------------------------ 兄弟模块（延迟装载）
//
// Python 在 `_card_name_of` / `_report_project` / `_import_card` 里各写一句**函数内**
// `from . import hud|validate|bridge`。JS 的 `import()` 是异步的、同步函数里等不了
// ⇒ 照 `scaffold.mjs` / `opener.mjs` 的口径办：顶层 `await` 动态导入，缺了留 null，
// 真要用到那一行才 `_要()` 报错。**别改成静态 import** —— 静态 import 一个不存在的
// 文件会让整个模块加载失败，连别的支路一起拖死。
const _懒 = async (名) => { try { return await import(`./${名}.mjs`) } catch { return null } }
const HUD = await _懒('hud')
const VALIDATE = await _懒('validate')
const BRIDGE = await _懒('bridge')

function _要(mod, 名) {
  if (!mod) {
    throw new Error(`forgejs 还没搬 ${名}.mjs —— 这条支路暂时走不通（Python 原件里这儿的 import 照原文留着）。`)
  }
  return mod
}

// ------------------------------------------------------------------ Python 语义小工具
const _SEP = '\\'                       // os.sep（本工具只跑 Windows）

/** `"%s" % v` 的语义：None → "None"、True/False 大写、容器走 repr。 */
function _strPy(v) {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'object') return M.pyRepr(v)
  return String(v)
}

const _intPy = (v) => CONTENT.intPy(v)
const _是文件 = (p) => { try { return statSync(p).isFile() } catch { return false } }
const _是目录 = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const _基名 = (p) => {
  const s = String(p).replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i < 0 ? s : s.slice(i + 1)
}
const _目录名 = (p) => {
  const s = String(p).replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i < 0) return ''
  if (i === 0) return s.slice(0, 1)
  return s.slice(0, i)
}
/** `os.path.splitext` —— 只认最后一段里的点，且开头全是点的名字不切。 */
function _splitext(p) {
  const base = _基名(p)
  const i = base.lastIndexOf('.')
  const dir = String(p).slice(0, String(p).length - base.length)
  if (i <= 0) return [String(p), '']
  return [dir + base.slice(0, i), base.slice(i)]
}
/** `os.path.join` —— 只接分隔符，不规范化（Python 会保留路径里原有的 `/`）。 */
const _join = (...parts) => {
  const 有 = parts.filter((x) => x !== undefined && x !== null && String(x) !== '')
  if (!有.length) return ''
  let s = String(有[0])
  for (const p of 有.slice(1)) {
    const q = String(p)
    if (q.startsWith('/') || q.startsWith('\\')) s = q
    else if (s === '' || s.endsWith('/') || s.endsWith('\\')) s = s + q
    else s = s + _SEP + q
  }
  return s
}
const _替全部 = (s, a, b) => String(s).split(a).join(b)

// --------------------------------------------------------------- os.path.relpath
//
// 兄弟模块里没有现成的，自己写（**别用 `node:path` 的 `relative`**：它只认 `/`，
// 传 `C:\a\b` 进去会算出整个字符串）—— 见 `hud.mjs` 头上那条同款理由。
// 只实现差分台用得上的那一半：两边都 `resolve()` 过、同盘符、纯 ASCII 盘符（没有
// UNC 主机名）。`ntpath.relpath` 的 UNC 分岔与「不同盘符抛 ValueError」不复刻。
const _段列 = (p) => String(p).split(/[\\/]+/).filter((x) => x !== '')
const _路径键 = (p) => _段列(p).map((x) => x.toLowerCase()).join('/')

function _relpath(path, start) {
  const p = _段列(path), b = _段列(start)
  const 同盘 = b.length && p.length && _路径键(b[0]) === _路径键(p[0])
  const key = (arr, n) => arr.slice(0, n).map((x) => x.toLowerCase()).join('/')
  let i = 0
  if (同盘) i = 1                      // 盘符段相同，从下一段开始比（盘符大小写不敏感）
  while (i < b.length && i < p.length && _路径键(b[i]) === _路径键(p[i])) i += 1
  const 出 = []
  for (let k = i; k < b.length; k++) 出.push('..')
  for (let k = i; k < p.length; k++) 出.push(p[k])
  return 出.join(_SEP) || '.'
}
/**
 * `ntpath.normpath` —— Windows 上**把 `/` 一律折成 `\`**、折掉 `.` 段、尽量消掉 `..`、
 * 并**去掉除根以外的一切尾分隔符**。开头两个分隔符当 UNC 保住；`\\?\` 前缀原样穿过。
 *
 * 为什么非写不可（差分台逮到的第一处红）：Python `os.path.abspath` 在 Windows 上就是
 * `normpath(join(os.getcwd(), path))` ⇒ 语料里拿 `@根@/差分/语料/dist/x.zip` 拼出来的
 * **混合分隔符**路径，Python 侧报错时打印的是 `E:\…\dist\x.zip`，Node 的 `path.resolve`
 * 会把 `/` 原样留住 ⇒ 报错文本差一个分隔符。兄弟模块里只有 `_join()`（**只接不规范化**，
 * 那是 `os.path.join` 的语义），所以 normpath 这层得自己补。
 */
/**
 * `ntpath.normpath` 的替身。**只有 `_abspath('')` 那一条支路会走到它**
 * （`_abspath` 非空时交给 `resolve()` 自己折，见下）—— 也就是说 UNC / `\\?\` 那两条
 * 分支在本模块是**备而未测**的：差分语料里没有 UNC 形状的路径（差分台本身建在
 * `E:\` 本地盘上，造不出第二台机器／共享名）。
 */
function _normpath(p) {
  const 空 = String(p ?? '')
  if (空 === '') return '.'
  let 盘 = ''
  let 段 = 空
  if (空.length >= 2 && 空[1] === ':') { 盘 = 空.slice(0, 2); 段 = 空.slice(2) }
  else if (空.startsWith('\\\\?\\')) return 空
  else if (空.startsWith('\\\\')) {                       // UNC：前两段是主机名／共享名
    const m = /^\\\\([^\\]+)\\([^\\]+)/.exec(空)
    if (!m) return '\\\\'
    盘 = `\\\\${m[1]}\\${m[2]}`
    段 = 空.slice(m[0].length)
  }
  const 根 = 段.startsWith('/') || 段.startsWith('\\')
  const 真段 = []
  for (const x of 段.split(/[\\/]+/)) {
    if (x === '' || x === '.') continue
    if (x === '..') {
      // `ntpath` 只在能吃掉上一段时才吃；吃到根就丢；剩下前面是 `..` 才保留。
      if (真段.length && 真段[真段.length - 1] !== '..') 真段.pop()
      else if (!根) 真段.push('..')
    } else 真段.push(x)
  }
  let 出 = 盘 + (根 ? _SEP : '') + 真段.join(_SEP)
  if (盘 && !根 && 出 === 盘) 出 += _SEP            // `'C:'` → `'C:\\'`
  return 出 || '.'
}

/**
 * `os.path.abspath`。**不是裸的 `path.resolve`**：Python 在 Windows 上会把 `/` 一律折成
 * `\`（见 `_normpath` 的注释），`resolve()` 却把 `/` 原样留在结果里 ⇒ 再补一层折分隔符。
 * 兄弟模块里只有 `_join()`（**只接不规范化**，那是 `os.path.join` 的语义），补不上这一层。
 */
function _abspath(p) {
  const 空 = String(p ?? '')
  if (空 === '') return _normpath(process.cwd())
  // ★ 这里**只调一次 `resolve()`**，别自己拼 `cwd + 尾`。踩过的坑（差分台第二处红）：
  //   `空.slice(2)`（相对部分）自带一个前导 `\`，`cwd + _SEP + 尾` 会拼出 `\\`，
  //   而**盘符开头的字符串一旦带上 `\\` 就再也不会被 resolve() 重新解释**（它当成
  //   已经绝对、原样返回）⇒ `abspath` 直接回一个坏路径。当初试过
  //   `resolve(`${cwd}${空.slice(2)}`)`：拼出来的中间夹着 `\\`，`resolve` 不折，
  //   出来就是 `E:\…\制卡工具\workGZQ\制卡工具\…`（base 重了两遍）。
  //   `resolve(单参)` 按 Node 的规则处理：有盘符就是绝对的、折 `/`、折 `.`/`..`、
  //   别的盘原样返回 —— 与 `ntpath.abspath` 对得上（已逐形状实测）。
  return resolve(空).split('/').join(_SEP)
}

/** Python 按码点排序；JS 默认按 UTF-16 码元（增补平面才分岔）。 */
const _比码点 = (a, b) => {
  const A = Array.from(String(a)), B = Array.from(String(b))
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const x = A[i].codePointAt(0), y = B[i].codePointAt(0)
    if (x !== y) return x < y ? -1 : 1
  }
  return A.length - B.length
}

// ------------------------------------------------------------------ zip 读取
//
// 照 `bridge.mjs` 的先例：`zipfile.ZipFile` 本来也只读中央目录。坏包抛的名字必须
// 叫 `BadZipFile`（差分记的是 `type(exc).__name__`）。
export class BadZipFile extends Error {
  constructor(msg) { super(msg); this.name = 'BadZipFile' }
}

const _EOCD = 0x06054b50
const _CEN = 0x02014b50
const _LOC = 0x04034b50

function _找EOCD(buf) {
  const 尾 = Math.min(buf.length, 65557)
  for (let i = buf.length - 22; i >= buf.length - 尾 && i >= 0; i--) {
    if (buf.readUInt32LE(i) === _EOCD) return i
  }
  return -1
}
/** 0x800 位置 1 = UTF-8（CPython 对没这个位的名字按 cp437 解；这里用 latin1 顶替）。 */
const _解码名 = (raw, flag) => raw.toString((flag & 0x800) ? 'utf8' : 'latin1')

/**
 * 读中央目录。返回 `[{ 名, 方法, 解 }]`，`解()` 交出该条目的原始字节（Buffer）。
 */
function _读zip(path) {
  const buf = readFileSync(path)
  if (buf.length < 22) throw new BadZipFile('File is not a zip file')
  const eocd = _找EOCD(buf)
  if (eocd < 0) throw new BadZipFile('File is not a zip file')
  const 条数 = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (p === 0xffffffff) throw new BadZipFile('zip64 不支持（工程包不会那么大）')
  const 出 = []
  for (let i = 0; i < 条数; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== _CEN) {
      throw new BadZipFile('Bad magic number for central directory')
    }
    const flag = buf.readUInt16LE(p + 8)
    const 方法 = buf.readUInt16LE(p + 10)
    const 压缩大小 = buf.readUInt32LE(p + 20)
    const 名长 = buf.readUInt16LE(p + 28)
    const 余长 = buf.readUInt16LE(p + 30)
    const 注长 = buf.readUInt16LE(p + 32)
    const 本地 = buf.readUInt32LE(p + 42)
    const 名 = _解码名(buf.subarray(p + 46, p + 46 + 名长), flag)
    出.push({ 名, 方法, 解: () => {
      if (本地 + 30 > buf.length || buf.readUInt32LE(本地) !== _LOC) {
        throw new BadZipFile('Bad magic number for file header')
      }
      const 本名长 = buf.readUInt16LE(本地 + 26)
      const 本余长 = buf.readUInt16LE(本地 + 28)
      const 起 = 本地 + 30 + 本名长 + 本余长
      const 原始 = buf.subarray(起, 起 + 压缩大小)
      if (方法 === 0) return Buffer.from(原始)
      if (方法 === 8) return inflateRawSync(原始)
      throw new BadZipFile(`不支持的压缩方式 ${方法}`)
    } })
    p += 46 + 名长 + 余长 + 注长
  }
  return 出
}

// ------------------------------------------------------------------ 清单
/** 包信息文件名（放在包里最上面那一层目录下）。 */
export const MANIFEST = '包信息.json'
export const MANIFEST_FORMAT = 'forge.工程包'
export const MANIFEST_VERSION = 1

/** 打包时不带走的（与 bundle.SKIP_DIRS 一致；这里再写一份是为了导入方向也独立成立）。 */
export const SKIP_DIRS = new Set(['__pycache__', 'out', '.git', '.forge', 'node_modules'])
export const SKIP_TAILS = ['.pyc', '.pyo']

export class DistError extends Error {
  /** 分发层的硬错：包结构不对、路径不可信、目标已存在。停，不含糊过去。 */
  constructor(msg) { super(msg); this.name = 'DistError' }
}

export function _digest(path, limit = null) {
  /** 文件的 sha256（前 16 位就够用：这是查损坏，不是防篡改）。 */
  void limit
  const h = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const b = Buffer.allocUnsafe(65536)
    for (;;) {
      const n = readSync(fd, b, 0, 65536, null)
      if (!n) break
      h.update(b.subarray(0, n))
    }
  } finally { closeSync(fd) }
  return h.digest('hex').slice(0, 16)
}

export function _card_name_of(project) {
  const H = _要(HUD, 'hud')
  const spec = H.find_spec(project)
  if (!spec) return ''
  const data = M.yload(spec) || {}
  const ch = data.character || {}
  return _strPy(ch.name || '')
}

export function _modules_of(project) {
  /** 这张卡「有界面文件」的模块（= hud/模块/ 下那些目录、conf 里登记的那些）。 */
  const path = _join(project, 'hud', 'hud.conf.json')
  if (!_是文件(path)) return [[], '']
  let conf
  try {
    conf = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return [[], '']
  }
  const mods = (conf.模块 || []).map((x) => _strPy(x))
  return [mods, _strPy(conf.主题 || '')]
}

export function build_manifest(project, name, files = null, with_card = false) {
  /** 算一份包信息。files 是相对工程根的文件路径列表；不给就现扫一遍。 */
  project = _abspath(project)
  if (files === null || files === undefined) {
    files = []
    const 走 = (base) => {
      let 项
      try { 项 = readdirSync(base, { withFileTypes: true }) } catch { return }
      const dirs = 项.filter((e) => e.isDirectory()).map((e) => e.name)
        .filter((d) => !SKIP_DIRS.has(d) && !d.startsWith('.'))
        .sort(_比码点)
      const fs = 项.filter((e) => e.isFile()).map((e) => e.name).sort(_比码点)
      for (const f of fs) {
        if (SKIP_TAILS.some((t) => f.endsWith(t))) continue
        files.push(_join(base, f))
      }
      for (const d of dirs) 走(_join(base, d))
    }
    走(project)
  }

  const listing = {}
  for (const p of files) {
    // `os.path.relpath` 在 Windows 上本来就用 `\`；原件再补一句 `.replace(os.sep, "/")`
    // （`\` → `/`），照抄。
    const rel = _替全部(_relpath(p, project), _SEP, '/')
    if (rel === MANIFEST) continue
    try {
      listing[rel] = { 大小: statSync(p).size, 校验: _digest(p) }
    } catch {
      continue
    }
  }

  const [mods, skin] = _modules_of(project)
  return {
    格式: MANIFEST_FORMAT,
    版本: MANIFEST_VERSION,
    工具: `forge ${_forge_version()}`,
    卡名: _card_name_of(project) || name,
    生成时间: M.nowIso(),
    含酒馆卡: Boolean(with_card),
    界面模块: mods,
    皮肤: skin,
    文件数: Object.keys(listing).length,
    清单: listing,
  }
}

/** 与 `forge\__init__.py:29` 的 `__version__` 对齐（JS 侧没有包级版本号）。 */
export const FORGE_VERSION = '0.28.8'

export function _forge_version() {
  try {
    return FORGE_VERSION
  } catch {
    return '?'
  }
}

export function read_manifest(src) {
  /** 从 zip 或工程目录里读包信息。没有就返回 None（老包不算错）。 */
  if (_是目录(src)) {
    const p = _join(src, MANIFEST)
    if (!_是文件(p)) return null
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      return null
    }
  }
  try {
    for (const 条 of _读zip(src)) {
      if (_基名(条.名) === MANIFEST) {
        return JSON.parse(条.解().toString('utf8'))
      }
    }
  } catch {
    return null
  }
  return null
}

// ------------------------------------------------------------------ 导入
export function _safe_member(name) {
  /** zip 条目名能不能信。返回 True/False —— 这是**安全边界**，不是风格检查。
   *
   *  三类都拒：绝对路径（`/x`、`C:/x`）、向上的跳（`..`）、以及任何一段里带冒号的
   *  （Windows 的盘符与 NTFS 数据流 `a.txt:b` 都靠冒号，正常文件名里不该有）。
   */
  const n = _替全部(name === null || name === undefined ? '' : String(name), '\\', '/')
  if (!n || n.startsWith('/') || n.startsWith('~')) return false
  const parts = n.split('/').filter((p) => p !== '' && p !== '.')
  for (const p of parts) {
    if (p === '..' || p.includes(':')) return false
  }
  return true
}

export function _top_of(names) {
  /** 包里最上面那一层目录名（工程包都是「<卡名>/…」）。 */
  for (const n of names) {
    const n2 = _替全部(n, '\\', '/')
    if (n2.includes('/')) {
      const head = n2.split('/')[0]
      if (head) return head
    }
  }
  return ''
}

export function import_pack(src, dest_root, rename = false, verify = true, out = CONTENT._print) {
  /** 把一个工程包（或单张卡）落到本地。返回工程目录的绝对路径。 */
  const src0 = src === null || src === undefined ? '' : String(src)
  src = _abspath(src0)
  if (!_是文件(src)) {
    // ★ 文案里那份路径**是归一化之后的**：Python 写的是 `src or "(空)"`，而
    //   `src` 在这一行早被上一句 `src = os.path.abspath(src)` 覆盖过 ⇒
    //   报的是含 `\` 的绝对路径，不是调用方给的那串混合分隔符（差分台逮到的第三处红）。
    //   只有 `abspath("")` ⇒ `src = os.getcwd()`（非空），所以 `(空)` 这一支其实够不着。
    throw new DistError(`找不到包：${src || '(空)'}`)
  }
  dest_root = _abspath(dest_root || '.')

  if (src.toLowerCase().endsWith('.zip')) {
    return _import_zip(src, dest_root, rename, verify, out)
  }
  return _import_card(src, dest_root, rename, out)
}

export function _import_zip(src, dest_root, rename, verify, out) {
  let names = []
  let manifest = null
  let dest = ''
  let count = 0
  try {
    const 条目 = _读zip(src)
    names = 条目.map((x) => x.名)
    const bad = names.filter((n) => !_safe_member(n))
    if (bad.length) {
      throw new DistError(
        `这个包里有 ${bad.length} 个路径不可信的条目，整包拒收：\n    `
        + `${bad.slice(0, 4).join('\n    ')}\n`
        + '  包里的条目名是别人给的字符串 —— 照着写出去就是往系统目录塞文件。')
    }

    const top = _top_of(names)
    for (const 条 of 条目) {
      if (_基名(条.名) === MANIFEST) {
        try {
          manifest = JSON.parse(条.解().toString('utf8'))
        } catch {
          manifest = null
        }
        break
      }
    }

    let name = ''
    if (CONTENT.pyTruthy(manifest)) {
      name = _strPy(manifest.卡名 || '')
    }
    name = _clean_name(name) || _clean_name(top)
      || _替全部(_splitext(_基名(src))[0], '.工程包', '')
    if (!name) {
      throw new DistError(`这个包里看不出卡名（既没有 ${MANIFEST}，顶层也没有目录）。`)
    }

    dest = _settle(_join(dest_root, name), rename)
    mkdirSync(dest, { recursive: true })

    out(`收包 ${_基名(src)}`)
    if (CONTENT.pyTruthy(manifest)) {
      const 卡名 = manifest.卡名 !== undefined ? manifest.卡名 : name
      const 工具 = manifest.工具 !== undefined ? manifest.工具 : '?'
      const 时间 = manifest.生成时间 !== undefined ? manifest.生成时间 : '?'
      out(`  ${_strPy(卡名)} · 由 ${_strPy(工具)} 生成 · ${_strPy(时间)}`)
    }
    out('')

    // 解压：剥掉顶层那一层目录（如果有）
    const 按名 = new Map(条目.map((x) => [x.名, x]))
    const destAbs = _abspath(dest)
    for (const n of names.slice().sort(_比码点)) {
      if (n.endsWith('/')) continue
      if (_基名(n) === MANIFEST && ['', top].includes(_目录名(_替全部(n, '\\', '/')))) {
        continue                        // 包信息本身不落进工程（它是包的信封，不是内容）
      }
      let rel = _替全部(n, '\\', '/')
      if (top && rel.startsWith(top + '/')) {
        rel = rel.slice(top.length + 1)
      }
      if (!rel) continue
      const target = _join(dest, _替全部(rel, '/', _SEP))
      const targetAbs = _abspath(target)
      if (!targetAbs.startsWith(destAbs + _SEP) && targetAbs !== destAbs) {
        throw new DistError(`条目越界：${n}`)
      }
      mkdirSync(_目录名(target), { recursive: true })
      writeFileSync(target, 按名.get(n).解())
      count += 1
    }
  } catch (exc) {
    if (exc instanceof BadZipFile) {
      throw new DistError(`这不是一个完好的 zip：${exc.message}`)
    }
    throw exc
  }

  out(`  解开 ${count} 个文件 -> ${dest}`)

  if (verify && CONTENT.pyTruthy(manifest)) {
    _check_manifest(dest, manifest, out)
  }

  _report_project(dest, out)
  return dest
}

export function _import_card(src, dest_root, rename, out) {
  let name = _clean_name(_splitext(_基名(src))[0])
  if (name.endsWith('.card')) {
    name = name.slice(0, name.length - '.card'.length)
  }
  name = _clean_name(name) || '外来卡'
  const dest = _settle(_join(dest_root, name), rename)
  const src_dir = _join(dest, 'source')
  mkdirSync(src_dir, { recursive: true })
  const spec = _join(src_dir, `${name}.spec.yaml`)

  out(`收卡 ${_基名(src)}`)
  out('')
  try {
    P.unpack(src, spec)
    out(`  按 ElecKoi 卡解包 -> ${_relpath(spec, dest)}`)
  } catch (first) {
    try {
      _要(BRIDGE, 'bridge').to_eleckoi(src, spec, out)
      out(`  ElecKoi 解包没成（${_讯(first)}），按酒馆 V2 卡转过来了。`)
    } catch (second) {
      // 收卡失败 → 把这个刚建出来的目录撤掉（沙箱里撤不掉，那就留着，别谎称干净）
      SB.rmtree(dest)
      throw new DistError(`这张卡既不是 ElecKoi 卡也不是酒馆 V2 卡：${_讯(second)}`)
    }
  }
  out('  注意：卡里只有内容层（source/），界面层（hud/）本来就不在卡里 —— 没丢东西。')
  out(`  想要卡内界面：\`forge.py new <卡名> --从 "${_基名(src)}"\` 开一张带界面的新卡，内容用它的。`)
  _report_project(dest, out)
  return dest
}

/** `"%s" % exc` 的语义：Python 打印的是 `str(exc)`，JS 错误对象的 `str()` 是 `message`。 */
const _讯 = (e) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : _strPy(e))

export function _check_manifest(dest, manifest, out) {
  /** 逐条核清单。不对的**如实说出来**，但不禁掉 —— 这是完整性提示，不是城门。 */
  const listing = manifest.清单 || {}
  const bad_size = [], bad_hash = [], missing = []
  for (const rel of Object.keys(listing)) {
    const info = listing[rel]
    const p = _join(dest, _替全部(rel, '/', _SEP))
    if (!_是文件(p)) {
      missing.push(rel)
      continue
    }
    if (info.大小 !== undefined && info.大小 !== null && statSync(p).size !== info.大小) {
      bad_size.push(rel)
      continue
    }
    if (CONTENT.pyTruthy(info.校验) && _digest(p) !== info.校验) {
      bad_hash.push(rel)
    }
  }
  if (!(bad_size.length || bad_hash.length || missing.length)) {
    out(`  清单核过：${Object.keys(listing).length} 个文件与包信息一致。`)
    return
  }
  out('')
  out('  ⚠ 清单对不上（包在路上坏了，或者包被动过）：')
  if (missing.length) {
    out(`      少文件 ${missing.length} 个：${missing.slice(0, 3).join('、')}`)
  }
  if (bad_size.length) {
    out(`      字节数不符 ${bad_size.length} 个：${bad_size.slice(0, 3).join('、')}`)
  }
  if (bad_hash.length) {
    out(`      内容不符 ${bad_hash.length} 个：${bad_hash.slice(0, 3).join('、')}`)
  }
  out('      文件已经解出来了，能看能改；但别直接拿来出卡 —— 先跟发卡的人对一下。')
}

export function _report_project(dest, out) {
  const H = _要(HUD, 'hud')
  const spec = H.find_spec(dest)
  if (!spec) {
    out('')
    out('  （这个目录里没有 source/*.spec.yaml —— 包结构可能不对。）')
    return
  }
  try {
    const card = P.spec_to_card(spec)
    const V = _要(VALIDATE, 'validate')
    const s = V.summarize(card)
    const issues = V.validate_card(card, _基名(dest))
    const errs = issues.filter((i) => i.level === 'ERROR')
    const warns = issues.filter((i) => i.level === 'WARN')
    out('')
    out(`  ${_strPy(s.name) || '(无名)'}：条目 ${_intPy(s.entries)} · 分组 ${_intPy(s.groups)}`
      + ` · 变量 ${_intPy(s.variables)} · 正则 ${_intPy(s.regex)}`)
    out(`  体检：${errs.length} 错 · ${warns.length} 警告 · `
      + `${issues.filter((i) => i.level === 'INFO').length} 提示`)
  } catch (exc) {
    out(`  （体检没跑成：${_讯(exc)}）`)
  }
  out('')
  out(`下一步： python forge.py check "${dest}"`)
  out(`        python forge.py ui --根 "${_目录名(dest)}"`)
}

// ------------------------------------------------------------------ 小工具
export function _clean_name(s) {
  /** 把卡名收拾成能当目录名的样子（去掉包名后缀与非法字符）。 */
  s = _strPy(s || '').trim()
  for (const tail of ['.工程包', '.spec', '.card']) {
    if (s.endsWith(tail)) {
      s = s.slice(0, s.length - tail.length)
    }
  }
  for (const ch of '\\/:*?"<>|') {
    s = _替全部(s, ch, '_')
  }
  // ★ 收尾那句 Python 是 `s.strip(".")` —— 只管**两端**的 `.`，中间的点必须留着。
  //   我第一版写成了 `_替全部(s.trim(), '.', '')`（`str.replace` 的语义）⇒
  //   `甲.spec` 被吃成 `甲spec`，差分台把这条逮出来了。`_替全部` 在这句话里是错的。
  return s.trim().replace(/^\.+/, '').replace(/\.+$/, '')
}

export function _settle(dest, rename) {
  /** 目标已经在了怎么办。rename=True 就自动错开一个；否则停 —— 不覆盖别人的东西。 */
  if (!existsSync(dest)) return dest
  if (!CONTENT.pyTruthy(rename)) {
    throw new DistError(
      `目标已经存在：${dest}\n`
      + '  换个地方（--到 目录），或者加 --改名 让它自动叫「…-2」。')
  }
  let i = 2
  while (existsSync(`${dest}-${i}`)) {
    i += 1
  }
  return `${dest}-${i}`
}
