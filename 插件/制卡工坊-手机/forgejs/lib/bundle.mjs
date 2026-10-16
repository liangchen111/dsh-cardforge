/**
 * forge.bundle 的 JS 版 —— 把一张卡的工程打成一个包。
 *
 * 包里装：`source/<卡>.spec.yaml` · `hud/` · `测试/test_core.js` · `成品/<卡>.card.json` ·
 * `文档/<卡>.手册.html` · `文档/<卡>.索引.md` · `预览.html` · `怎么开工.md` ·
 * `包信息.json`（信封：卡名 / 模块 / 皮肤 / 每文件 sha256 清单）。
 *
 * 打包前**重新构建一遍**（spec -> 卡 -> 手册 -> 索引）；组装不过就停，不拿半成品覆盖。
 * `包信息.json` 只写进 zip，不落工程目录。
 *
 * 用法：
 *   import * as B from './lib/bundle.mjs'
 *   const zip = B.run('E:\\某工程')                   // 默认出口，写 <工程>/<卡>.工程包.zip
 *   B.run('E:\\某工程', 'E:\\out.zip', true)          // 显式出口 + 附酒馆卡
 *
 * 逐字节照抄 `forge/bundle.py`（119 行）。行为一处不改。
 * ------------------------------------------------------------------ 移植记号
 *
 * ★ 记号 1 · `os.path.dirname(base) == project` **恒为假**（`bundle.py:98`）
 *   `os.walk` 吐的 `base` 是**相对**路径（工程根那一层就是 `''`），`project` 是
 *   `os.path.abspath` 过的绝对路径 ⇒ 这一条永远不成立，**工程根那份旧 `包信息.json`
 *   其实没被跳过**，它进了 `plan`；只是 `DIST.build_manifest` 里那句 `if rel == MANIFEST:
 *   continue` 把它从**清单**里剔掉了，zip 里仍照写 ⇒ 与 `z.writestr` 的那份撞名，
 *   CPython 会打一行 `UserWarning: Duplicate name: …`。
 *   实测（`差分/语料/bundle/甲全界面`）：zip 17 条、清单 15 条、重复名 `骨架/包信息.json`。
 *   **这里照抄原样**（同一条恒假判断），不去"顺手修好"。差分台已把这条写进预期。
 *
 * ★ 记号 2 · zip 的字节天生不可比 —— 只保证**可解**
 *   Python 用 CPython 自带的 zlib（`1.3.1`），Node 用它那个 fork（`1.3.1-e00f703`）：
 *   同一个输入、同一个 level，压出来的 deflate 体必然不同（实测 `hud.core.js` 32397 B：
 *   Python `zlib.compress(d, 6)` 11059 B，Node `deflateSync(d, {level: 6})` 11327 B，
 *   差 268 B，`memLevel`/`strategy` 全矩阵也凑不上）。条目头的 mtime 也每次不一样。
 *   ⇒ 本模块的 zip 只保证「CPython `zipfile` 解得开、条目名与解包内容对得上」，
 *   **不保证字节**。差分台照这条比：逐条目记「内部名 / 大小 / 解包后文字」。
 *   也因此 `bundle.py:112` 的 `os.path.getsize(zip_path)` 与 `"%.1f KB"` 两侧必然不同 ——
 *   差分台把那一处浮点折成 `<包大小>`（**申报差异**，不是放宽比对）。
 *
 * ★ 记号 3 · `os.sep` ⇒ `/`（`ZipInfo.__init__`）
 *   `ZipInfo` 在存名字时会把 `os.sep` 一律换成 `/`。故 `_写zip` 里对每个条目名做同一步
 *   替换，调用点照 Python 原文传 `_join(name, …)`（**不在调用点替换**）。
 *
 * ★ 记号 4 · `str.replace(os.sep, "/")` 是**换全部**
 *   Python 的 `str.replace` 换全部、JS 的 `String.replace` 只换第一处 ⇒ 这里写
 *   `.split(_SEP).join('/')`。
 *
 * ★ 记号 5 · `%.1f` 不是 `toFixed`
 *   `bundle.py:115` 的 `"%.1f" % (size / 1024.0)` 抄 `theme.mjs` 的 `_fmt1`（半值取偶、
 *   整值补 `.0`）—— `toFixed` 会给 `152.8` 之外的另一种圆法。
 *
 * ★ 记号 6 · `zipfile` 打不开不存在目录时的错文要手造
 *   Python 抛 `FileNotFoundError`，`str(e)` 是
 *   `[Errno 2] No such file or directory: '<路径>'`，**路径部分是 `repr()` 形式、
 *   反斜杠双写**。Node 自己报的是 `ENOENT: no such file or directory, open '…'`，
 *   对不上 ⇒ 逮住 `ENOENT` 自己按 Python 格式造这句（见 `_zip错`）。
 *   实测先例：`差分/语料/bundle.json` 第 2 个情形（显式 out 指向 `自定路径/`，那层不存在）。
 *
 * ★ 记号 7 · `os.walk` 的序
 *   `dirs[:] = [...]` 是**原地**过滤、**保持 scandir 原序**（不排序）；`files` 每层
 *   `sorted(files)` 按**码点**排。这里 `_walk` 的回调返回过滤后的 dirs，递归照那个序走 ——
 *   不能像 `dist.mjs` 那样把 dirs 也 `_比码点` 排一遍（那是 dist 自己的既有行为，两回事）。
 *
 * ★ 记号 8 · 惰性 import 落成顶层 `_懒()` + 用点 `_要()`
 *   `bundle.py:45` 的 `from . import dist as DIST`（函数内、在 `isdir` 检查之后）与
 *   `bundle.py:80` 的 `from . import export`（`with_card` 支路内）照 `scaffold.mjs` 的口径
 *   办：顶层 `await _懒(...)`、用到时 `_要(mod, 名)` 抛一句写明白的错。
 *
 * ★ 记号 9 · Python 模块级导入了但**全文没用到**的名字照抄
 *   `shutil`（`bundle.py:26`）与 `model as M`（`bundle.py:31`）导入了、函数体里一次没用。
 *   JS 侧没有 `shutil` 这种东西（zip 是自写的），`M` 照原样 import 并转出，不为"整洁"删掉。
 *
 * ★ 记号 10 · `dirs` 不排序但 `files` 排序、`base` 是**相对**的
 *   `os.walk(project)` 里 `project` 是 abspath ⇒ `base` 其实是绝对的（记号 1 里说的
 *   "相对"是指 `os.walk` 内部的 `dirpath` 起点 `''` —— 见 `bundle.py` 上下文）。
 *   这里以 `_walk(project, …)` 起步，`base` 恒为绝对路径，与 Python 一致。
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { crc32, deflateRawSync } from 'node:zlib'
import { resolve } from 'node:path'

import * as HUD from './hud.mjs'
import * as MANUAL from './manual.mjs'
import * as M from './model.mjs'
import * as pack from './pack.mjs'
import { _print } from './content.mjs'
import { _fmt1 } from './theme.mjs'

// 不带进包里的东西
export const SKIP_DIRS = new Set(['__pycache__', 'out', '.git', '.forge', 'node_modules'])
export const SKIP_TAILS = ['.pyc', '.pyo']

/** 同名的 Python 异常类 —— 差分台按 `type(exc).__name__ + ": " + str(exc)` 比，名字要一致。 */
export class FileNotFoundError extends Error {
  constructor(消息) { super(消息); this.name = 'FileNotFoundError' }
}
export class RuntimeError extends Error {
  constructor(消息) { super(消息); this.name = 'RuntimeError' }
}

/* ------------------------------------------------------------------ 惰性兄弟模块 */

const _懒 = async (名) => { try { return await import(`./${名}.mjs`) } catch { return null } }
const _DIST = await _懒('dist')
const _EXPORT = await _懒('export')

export { _懒 }

export function _要(mod, 名) {
  if (!mod) {
    throw new Error(`forgejs 还没搬 ${名}.mjs —— 这条支路暂时走不通（Python 原件里这儿的 import 照原文留着）。`)
  }
  return mod
}

/* ------------------------------------------------------------------ 路径小件（os.path） */

const _SEP = '\\'

export const _是文件 = (p) => { try { return statSync(p).isFile() } catch { return false } }
export const _是目录 = (p) => { try { return statSync(p).isDirectory() } catch { return false } }

/** `os.path.basename` —— 尾分隔符后面是空串，别顺手 rstrip（`'a/b/'` 给 `''`）。 */
export function _基名(p) {
  const s = String(p)
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i < 0 ? s : s.slice(i + 1)
}

/** `os.path.dirname`（ntpath 版：先切、再 rstrip，除非整条都是分隔符）。 */
export function _目录名(p) {
  const s = String(p)
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1
  let head = s.slice(0, i)
  const sep = s.lastIndexOf('\\') > s.lastIndexOf('/') ? '\\' : '/'
  if (head && head !== sep.repeat(head.length)) head = head.replace(/[\\/]+$/, '')
  return head
}

/** `os.path.splitext` 的子集：`i <= 0` 时（点开头的隐藏名、无点）不切。 */
export function _splitext(p) {
  const s = String(p)
  const b = _基名(s)
  const i = b.lastIndexOf('.')
  if (i <= 0) return [s, '']
  return [s.slice(0, s.length - (b.length - i)), b.slice(i)]
}

/** `os.path.join` —— 只接分隔符、不规范化。 */
export function _join(...段) {
  let s = String(段[0] ?? '')
  for (const b0 of 段.slice(1)) {
    const b = String(b0 ?? '')
    if (b.startsWith('/') || b.startsWith('\\')) { s = b; continue }
    if (s && !/[\\/]$/.test(s)) s += _SEP
    s += b
  }
  return s
}

const _段列 = (p) => String(p).split(/[\\/]+/).filter((x) => x !== '')

/** `os.path.relpath` 的常用支（同盘）。不同盘 Python 抛 `ValueError`，这里不分支（本项目用不着）。 */
export function _relpath(path, start) {
  const a = _段列(path)
  const b = _段列(start)
  let i = 0
  while (i < b.length && i < a.length && b[i].toLowerCase() === a[i].toLowerCase()) i += 1
  const 出 = []
  for (let k = i; k < b.length; k += 1) 出.push('..')
  for (let k = i; k < a.length; k += 1) 出.push(a[k])
  return 出.join(_SEP) || '.'
}

/** `os.path.abspath` —— **不是** `path.resolve` 的语义（先例 `dist.mjs`）。空串给 cwd。 */
export function _abspath(p) {
  const 空 = String(p ?? '')
  if (空 === '') return resolve('.').split('/').join(_SEP)
  return resolve(空).split('/').join(_SEP)
}

/** Python 排字符串按**码点**（JS `.sort()` 按 UTF-16 码元，补充平面会不一样）。 */
export function _比码点(a, b) {
  const x = Array.from(String(a))
  const y = Array.from(String(b))
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i += 1) {
    const cx = x[i].codePointAt(0)
    const cy = y[i].codePointAt(0)
    if (cx !== cy) return cx < cy ? -1 : 1
  }
  return x.length - y.length
}

/** `os.walk` 的 topdown 支：`dirs` 由回调原地过滤后返回，递归照返回的序走。 */
export function _walk(根, 收) {
  let 名单
  try {
    名单 = readdirSync(根, { withFileTypes: true })
  } catch {
    return
  }
  const dirs = []
  const files = []
  for (const e of 名单) (e.isDirectory() ? dirs : files).push(e.name)
  for (const d of 收(根, dirs, files)) _walk(_join(根, d), 收)
}

/* ------------------------------------------------------------------ zip 写侧 */

function _dos时间(d) {
  const 年 = Math.max(1980, d.getFullYear())
  return [
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    ((年 - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  ]
}

/** `repr()` 的路径 —— 反斜杠双写（Python 的 `OSError.__str__` 就是这么印文件名的）。 */
const _repr路径 = (p) => `'${String(p).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** 照 Python 的 `FileNotFoundError` 造这句（记号 6）。 */
function _zip错(路径, e) {
  if (e && e.code === 'ENOENT') {
    return new FileNotFoundError(`[Errno 2] No such file or directory: ${_repr路径(路径)}`)
  }
  if (e && e.code === 'EACCES') {
    return new FileNotFoundError(`[Errno 13] Permission denied: ${_repr路径(路径)}`)
  }
  return e
}

/**
 * 写一个 `zipfile.ZipFile(…, "w", zipfile.ZIP_DEFLATED)` 同形的最小 zip。
 *
 * 条目一律走 deflate（Python 那边没有"压不小就存原样"的回退），名字照 `ZipInfo` 那样把
 * `os.sep` 换成 `/`、非 ASCII 名字打 `0x800` 位并用 UTF-8 编码。
 */
export function _写zip(zip_path, 条目) {
  const 头块 = []
  const 中块 = []
  const [时, 日] = _dos时间(new Date())
  let 偏移 = 0
  for (const 条 of 条目) {
    let 名 = String(条.名)
    if (名.includes(_SEP)) 名 = 名.split(_SEP).join('/')     // 记号 3
    const 数据 = Buffer.isBuffer(条.数据) ? 条.数据 : Buffer.from(String(条.数据), 'utf8')
    const 压 = deflateRawSync(数据)
    const crc = crc32(数据) >>> 0
    const 名字节 = Buffer.from(名, 'utf8')
    const 旗 = /^[\x20-\x7e]*$/.test(名) ? 0 : 0x800

    const 本地 = Buffer.alloc(30)
    本地.writeUInt32LE(0x04034b50, 0)
    本地.writeUInt16LE(20, 4)
    本地.writeUInt16LE(旗, 6)
    本地.writeUInt16LE(8, 8)
    本地.writeUInt16LE(时, 10)
    本地.writeUInt16LE(日, 12)
    本地.writeUInt32LE(crc, 14)
    本地.writeUInt32LE(压.length, 18)
    本地.writeUInt32LE(数据.length, 22)
    本地.writeUInt16LE(名字节.length, 26)
    本地.writeUInt16LE(0, 28)
    头块.push(本地, 名字节, 压)

    const 中 = Buffer.alloc(46)
    中.writeUInt32LE(0x02014b50, 0)
    中.writeUInt16LE(20, 4)
    中.writeUInt16LE(20, 6)
    中.writeUInt16LE(旗, 8)
    中.writeUInt16LE(8, 10)
    中.writeUInt16LE(时, 12)
    中.writeUInt16LE(日, 14)
    中.writeUInt32LE(crc, 16)
    中.writeUInt32LE(压.length, 20)
    中.writeUInt32LE(数据.length, 24)
    中.writeUInt16LE(名字节.length, 28)
    中.writeUInt16LE(0, 30)
    中.writeUInt16LE(0, 32)
    中.writeUInt16LE(0, 34)
    中.writeUInt16LE(0, 36)
    中.writeUInt32LE(0, 38)
    中.writeUInt32LE(偏移, 42)
    中块.push(中, 名字节)

    偏移 += 30 + 名字节.length + 压.length
  }
  const 中起 = 偏移
  const 中大小 = 中块.reduce((n, b) => n + b.length, 0)
  const 尾 = Buffer.alloc(22)
  尾.writeUInt32LE(0x06054b50, 0)
  尾.writeUInt16LE(0, 4)
  尾.writeUInt16LE(0, 6)
  尾.writeUInt16LE(条目.length, 8)
  尾.writeUInt16LE(条目.length, 10)
  尾.writeUInt32LE(中大小, 12)
  尾.writeUInt32LE(中起, 16)
  尾.writeUInt16LE(0, 20)

  try {
    writeFileSync(zip_path, Buffer.concat([...头块, ...中块, 尾]))
  } catch (e) {
    throw _zip错(zip_path, e)
  }
}

/* ------------------------------------------------------------------ 正门 */

export function run(project, out = null, with_card = false, out_print = _print) {
  project = _abspath(project)
  if (!_是目录(project)) {
    throw new FileNotFoundError(`找不到工程目录：${project}`)
  }

  const DIST = _要(_DIST, 'dist')        // 清单在 dist 里（记号 8）

  const spec = HUD.find_spec(project)
  if (!spec) {
    throw new FileNotFoundError(
      `工程里没有 source/*.spec.yaml —— 这不是本工具开的工程：${project}`)
  }

  // 卡名 = spec 文件名去掉 `.spec.yaml`（不能只剥最后一段扩展名）
  const base = _基名(spec)
  const name = base.endsWith('.spec.yaml')
    ? base.slice(0, base.length - '.spec.yaml'.length)
    : _splitext(base)[0]
  out_print(`打包 ${name}`)
  out_print('')

  // ---- 1. 界面层先组装（有 hud/ 的话）—— 顺便校验，不过就停
  const hud_dir = _join(project, 'hud')
  if (_是文件(_join(hud_dir, 'hud.conf.json'))) {
    const [problems] = HUD.build(project, true, out_print)
    if (problems.length) {
      throw new RuntimeError(`界面组装有 ${problems.length} 个问题，先修完再打包。`)
    }
  } else {
    out_print('  （这个工程没有 hud/，只打内容层）')
  }

  // ---- 2. 卡 + 手册 + 索引
  const prod = _join(project, '成品')
  mkdirSync(prod, { recursive: true })
  const card_path = _join(prod, `${name}.card.json`)
  pack.build(spec, card_path)
  out_print(`  卡   -> ${_relpath(card_path, project)}`)

  const docs = _join(project, '文档')
  mkdirSync(docs, { recursive: true })
  MANUAL.build_manual(spec, _join(docs, `${name}.手册.html`), out_print)
  MANUAL.build_index(spec, _join(docs, `${name}.索引.md`), out_print)

  if (with_card) {
    const EXPORT = _要(_EXPORT, 'export')
    const st = _join(prod, `${name}.酒馆卡.json`)
    EXPORT.to_tavern(card_path, st, false, out_print)
  }

  // ---- 3. 收进 zip
  let zip_path = out || _join(project, `${name}.工程包.zip`)
  zip_path = _abspath(zip_path)

  // 先清点要收哪些文件 —— 清单得在写 zip 之前算出来
  const plan = []
  _walk(project, (base, dirs, files) => {
    const 留 = dirs.filter((d) => !SKIP_DIRS.has(d) && !d.startsWith('.'))
    for (const f of [...files].sort(_比码点)) {
      if (SKIP_TAILS.some((t) => f.endsWith(t))) continue
      const p = _join(base, f)
      if (_abspath(p) === zip_path) continue
      if (f === DIST.MANIFEST && _目录名(base) === project) continue   // 记号 1
      plan.push(p)
    }
    return 留
  })

  const manifest = DIST.build_manifest(project, name, plan, with_card)
  let count = 0
  const 条目 = [{ 名: _join(name, DIST.MANIFEST), 数据: JSON.stringify(manifest, null, 2) + '\n' }]
  for (const p of plan) {
    const rel = _relpath(p, project)
    条目.push({ 名: _join(name, rel.split(_SEP).join('/')), 数据: readFileSync(p) })   // 记号 4
    count += 1
  }
  _写zip(zip_path, 条目)

  const size = statSync(zip_path).size
  out_print('')
  out_print(`已打包 -> ${zip_path}`)
  out_print(`  ${count} 个文件 · ${_fmt1(size / 1024.0)} KB · 附 ${DIST.MANIFEST}（${Object.keys(manifest['清单'] || {}).length} 条清单）`)
  out_print(`  包里最上面一层是「${name}/」，解开即可用。`)
  out_print(`  收包那一头： python forge.py import "${zip_path}"`)
  return zip_path
}

export { HUD, MANUAL, M, pack }
