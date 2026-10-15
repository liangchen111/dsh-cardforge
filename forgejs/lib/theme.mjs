/**
 * forge.theme 的 JS 版 —— 皮肤：主题库、应用到卡上、对比度体检、皮肤巡览。
 * ==================================================================
 *
 * 照抄 `forge/theme.py`（592 行）。零依赖：只有 `node:` 内建与本仓库同级 `.mjs`。
 *
 * 移植记号（踩过的坑，别再踩）
 * ------------------------------------------------------------------
 *   1. **数值必须逐字节一样**：`_composite` 的 `round()` 在 Python 返回 int、
 *      JS 的 `Math.round` 返回 number —— 落 JSON 时 Python 写 `256`、JS 写 `256.0`。
 *      所以这里统一 `_round()` 折成整数（差分按字节比，差一个小数点就红）。
 *      实测过：`** 2.4`、`0.2126*r+...`、`(hi+0.05)/(lo+0.05)` 这套浮点算式
 *      在 CPython 3.13 与 Node v24.14.0 上**逐位相同**（8 组样值全等），
 *      所以 `_luminance`/`_ratio` 里不用做任何补齐。
 *   2. **`os.path.join` ≠ `node:path.join`**：Python 保留已有的 `/`、不规范化 ⇒
 *      自写 `_join()`。`os.path.basename/dirname/splitext` 认两种分隔符，
 *      `node:path` 只认一种（Windows 上认 `\\`）⇒ 这三个也自写，按 CPython 源码照抄。
 *   3. **`if x:` ≠ `if (x)`** —— 空 `[]`/`{}`/`""`/`0` 在 JS 里是真值 ⇒
 *      凡「Python 真值判断」一律走 `CONTENT.pyTruthy()`；`str(x or "")` 走 `CONTENT.或`。
 *   4. **`from . import hud as HUD` 是函数内延迟导入**（原文注释：hud 不依赖 theme、
 *      反过来也一样）⇒ 照 `opener.mjs` 的 `await _懒('hud')` ＋ `_要(HUD,'hud')`。
 *   5. **`os.listdir` 的排序**：JS 默认 `sort()` 比 UTF-16 码元、Python 比码点 ⇒
 *      自写 `_排序()` 按 `codePointAt` 比。中文主题名在 BMP 内本来就一致，
 *      但代理对（emoji 主题名）会分叉，所以照 Python 来。
 *   6. **异常类型名要一致**：差分记 `exc.constructor.name` ⇒ `ThemeError.name`
 *      显式写死成 `'ThemeError'`（不然是 `'Error'`）。
 *   7. `os.path.relpath` 是本进程 cwd 的函数，但两边 cwd 都是**工具根**（差分的约定）
 *      ⇒ JS 用 `relative(project, 目标)` 与 `os.path.relpath(x, project)` 同义。
 *   8. **tuple → Array 时解构方式要跟着改**（这里真崩过）：自写的 `_splitTail()` 返回的是
 *      数组 `[head, tail]`，三个调用方却写成 `const { tail } = _splitTail(...)` ⇒ 恒
 *      `undefined`，一路冒到 `_splitext` 才炸成
 *      `TypeError: Cannot read properties of undefined (reading 'lastIndexOf')`；
 *      差分台只报「第 9 行不一致」，从报文里根本看不出根因。`_basename`/`_dirname` 当时
 *      也一样是坏的，只是 `list_themes` 先撞上 `_splitext`。
 *   9. **模块初始化期用不了 `const` 箭头函数**：`const _sep = (p) => …` 写在
 *      `THEMES_DIR = _join(ROOT, …)` 后面 ⇒ 模块一加载就
 *      `ReferenceError: Cannot access '_sep' before initialization`。
 *      常量区要用的助手一律写成 `function` 声明（有提升）。
 *  10. **`ntpath.join` 的空段与盘符**：空段/尾分隔符**照加一个分隔符**
 *      （`join('根','')` == `'根\\'`），后面出现绝对路径或带盘符的段会**丢掉**前面全部。
 *      这与 `opener.mjs` 那版`_join` 不同（那版只需「保留已有的 `/`、不规范化」）；
 *      theme 这版按 `ntpath.join` 原样移植，`_join` 上有注释。
 *  11. **Python `str.replace` 换全部，JS `String.replace(串, …)` 只换第一处** ——
 *      `SHOWCASE_SHELL` 里 `@@card@@` 出现**两次**，必须 `split(旧).join(新)`。
 *  12. **`"%.1f" % v` ≠ `v.toFixed(1)`**：Python 走半值取偶（按二进制真值），
 *      实测 `0.25 → '0.2'`、`2.25 → '2.2'`，而 `toFixed` 给 `'0.3'`/`'2.3'`；
 *      Python 还把整值补成 `'21.0'`。⇒ 自写 `_roundPy(x, n)` ＋ `_fmt1(v)`
 *      （400 组乱数主题对拍，`_contrast_line`/`print_themes` 逐行 400/400 相同）。
 *  13. **沙箱开关是进程级状态，黄金必须与调用顺序无关**：`算_sandbox` 跑完会把沙箱留在
 *      「开」，而 `clear_theme` 走 `SB.shell()`（开＝写空壳、关＝`unlink`）⇒ 单跑
 *      `--刷 theme` 出的黄金是「关」着的行为，整套 `跑.py` 时 JS 还开着 ⇒ 乙工程清皮肤
 *      第 2 次 `回` 会 true/false 分岔（实测差在第 1049 行 · 偏移 26584）。两侧 `算_theme`
 *      都进门 `enable(false)`、出门还原（照 `算_scaffold` 的注释），实测：先跑 `算_sandbox`
 *      再跑 `算_theme`，黄金逐字节不变、进程状态照旧还原。
 *  14. **`splitext` 的前导点**：`.皮肤` 不算扩展名（点是文件名首字符就不切）；
 *      `..a` 里定位点要跳过前导点；全点文件名 `...` 返回 `('...', '')`。
 *      —— 这批边角只能实测对拍（本机解释器是 frozen 版，`inspect.getsource(ntpath.basename)`
 *      直接 `OSError: could not get source code`）。
 *  15. **`json.dumps` 写 `21.0`，`JSON.stringify` 写 `21`**：Python 的浮点保留 `.0` 尾巴。
 *      `_luminance([0,0,0])` 返回 `0.0` / `_ratio` 整值 `21.0` 这一类会在差分的**写法**上分叉
 *      ⇒ 归一化里加一个 `_折浮()`（值为整数的 float 折成 int，`-0.0` 折成 0，两侧对称）。
 *  16. **读不出来的 `.json` 不要待在「齐全」那个主题库里**：解析器原话会进 `一句话`，
 *      而 `showcase` 会把每套主题的 `一句话` 写进 `皮肤巡览.html` —— 差分树里文件是按 sha1
 *      比的，`_折读不出来()` 够不着文件字节（两侧 JSONDecodeError 的措辞天生不同）
 *      ⇒ 拆成独立的「坏json」情形，只比 `list_themes`/`find_theme`/`print_themes` 的回值。
 *  17. **坏掉的 `hud.conf.json` 同理**：`_read_conf()` 读它时 Python 抛
 *      `JSONDecodeError: Expecting …`、Node 抛 `SyntaxError: Expected …` —— 类名与措辞都不同
 *      ⇒ 两侧 `算_theme` 各跑一个 `_折解析器()`，只把**错**这一格折成 `解析器: <解析器说>`。
 *      语料里单开一个「坏conf」情形（`current`/`_read_conf`/`apply_theme`/`clear_theme`/
 *      `export_theme`/`showcase` 六条支路都从这同一处抛出来，一次全踩到）。
 *  18. **`"%s" % exc` 不是 `M.pyRepr(exc)`**：Python 的 `%s` 取 `str(exc)`（**异常的文字**），
 *      `pyRepr` 取的是 `repr()`。Node 的 `SyntaxError` 在这两种里都拿不到 Python 那句话，
 *      而 `M.pyRepr()` 更糟 —— 它对 SyntaxError 返回 `{}`（第三种东西，既不是 Python 的
 *      str 也不是 Node 的 message）⇒ 自写 `_exc文字(exc)`，`list_themes` 与 `import_theme`
 *      两处 `except … as exc` 都走它。`import_theme` 那句 `（不是 json？）：<解析器原话>`
 *      与 `list_themes` 的 `（读不出来：…）` 同族（两侧措辞天生不同）⇒ 两侧归一化各加第二条
 *      正则，把它折成 `（不是 json？）：<解析器说>`。
 *  19. **判定「顶层不是对象」的手写守卫要写在 `try` 之外**：Python 那边 `data["_file"] = name`
 *      在 `except` 块后面，所以顶层是数组/数字时它**从 `list_themes` 抛出去**；一把它塞进
 *      `try` 里，同一个 `except` 会把它收成「（读不出来：…）」—— 看着像对，其实把两个分支
 *      合成一个了。实测抓法：语料里放 `["a","b"]` 与 `123` 两份 `.json`，Python 侧抛
 *      `TypeError: list indices must be integers or slices, not str` /
 *      `TypeError: 'int' object does not support item assignment`。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as M from './model.mjs'
import * as SB from './sandbox.mjs'
import * as CONTENT from './content.mjs'

// ------------------------------------------------------------------ hud（延迟装载）
//
// `_card_name` 与 `showcase` 里各有一句 `from . import hud as HUD`（**函数内**导入）。
// JS 的 `import()` 是异步的、同步函数里等不了 ⇒ 顶层 `await` 动态导入，缺了留 null，
// 真要用到那一行才 `_要()` 报错（照 `opener.mjs`）。
const _懒 = async (名) => { try { return await import(`./${名}.mjs`) } catch { return null } }
const HUD = await _懒('hud')

function _要(mod, 名) {
  if (!mod) {
    throw new Error(`forgejs 还没搬 ${名}.mjs —— 这条支路暂时走不通（Python 原件里这儿的 import 照原文留着）。`)
  }
  return mod
}

// ------------------------------------------------------------------ 常量
//
// ★ 除导入的模块外，Python module 级名字**逐个导出**（含 `_` 开头的）——
//   与 `opener.mjs`（`_spec` / `_读json`）和 `hud.mjs`（`_hex_to_rgb` / `_rgba`）同款：
//   差分台要 `T._contrast_line` 这类私有名，命令行壳也可能直接用。

const 这里 = dirname(fileURLToPath(import.meta.url))
/** = 工具根（`<根>/forgejs/lib/theme.mjs` 往上三层）。 */
export const ROOT = resolve(这里, '..', '..')

/** ★ 主题库目录。Python 那边是模块级常量；这里必须是 `let` ——
 *  差分台要把它指到临时目录（`算_theme` 进门换、出门还原），
 *  否则 `import_theme(install=True)` 会往真仓库的 `assets/主题/` 里落外来主题。
 *  照 `hud.mjs` 的 `export let PROJECT` 先例。
 */
export let THEMES_DIR = _join(ROOT, 'assets', '主题')

/** 差分台专用：改主题库目录（`null` ⇒ 还原成仓库自带那一份）。 */
export function _setThemesDir(p) {
  THEMES_DIR = p === null || p === undefined ? _join(ROOT, 'assets', '主题') : String(p)
  return THEMES_DIR
}

export const THEME_FILE = '主题.css'
export const CONF_KEY = '主题'

export const SLOTS = [
  '--hud-ink', '--hud-ink-2', '--hud-dim', '--hud-paper', '--hud-paper-solid',
  '--hud-field', '--hud-panel', '--hud-line', '--hud-line-2', '--hud-wash',
  '--hud-wash-2', '--hud-accent', '--hud-danger', '--hud-danger-ink',
  '--hud-danger-wash', '--hud-shadow', '--hud-radius', '--hud-radius-s',
  '--hud-font',
]

export class ThemeError extends Error {
  /** 皮肤相关的问题（槽名不认识、主题文件读不出来…）。 */
  constructor(message) {
    super(message)
    this.name = 'ThemeError'
  }
}

// ------------------------------------------------------------------ 路径小工具
//
// 纪律 5：`os.path` 认两种分隔符、还有 `join` 不规范化这一层 ⇒ 自己照 CPython 抄。

/** `os.sep` / `os.altsep` 都算分隔符。**写成函数声明**（不是箭头常量）——
 *  `THEMES_DIR = _join(ROOT, …)` 在模块体里当场就算一次，那时 `const` 还在 TDZ 里。 */
function _sep(ch) { return ch === '/' || ch === '\\' }
const _是字典 = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * `os.path.join`：**保留已有的 `/`、不规范化**（纪律 5），且**照 `ntpath.join` 原文**抄
 * —— 它内部走 `splitdrive`，「后来那一段带盘符」或「带盘符的绝对路径」会把前面整段顶掉。
 *
 * ★ 这里与 `opener.mjs:_join` **故意不同**：opener 那一份把空段直接跳过（`for (const 段 of parts) if (b === '') continue`），
 *   而 CPython 的 `ntpath.join('根', '')` 给的是 `'根\\'`（空段照旧补一个分隔符）。
 *   theme 这边 `os.path.join` 的调用点都带非空段，但差分台按标量逐字节比，所以按原文抄更稳。
 */
export function _join(...零件) {
  const 首 = String(零件[0] ?? '')
  const 尾 = 零件.slice(1).map((x) => String(x ?? ''))
  const 起 = _splitDrivePy(首)
  let resultDrive = 起.drive
  let resultPath = 起.tail
  for (const p of 尾) {
    const { drive: pDrive, tail: pPath } = _splitDrivePy(p)
    if (pPath && _sep(pPath[0])) {
      // 后一段自己带根 ⇒ 它就是新的起点
      if (pDrive || !resultDrive) resultDrive = pDrive
      resultPath = pPath
      continue
    } else if (pDrive && pDrive !== resultDrive) {
      if (pDrive.toLowerCase() !== resultDrive.toLowerCase()) {
        // 盘符都不一样 ⇒ 前面整段作废
        resultDrive = pDrive
        resultPath = pPath
        continue
      }
      // 同一个盘、只是大小写不同
      resultDrive = pDrive
    }
    // 后一段是相对路径
    if (resultPath && !_sep(resultPath[resultPath.length - 1])) resultPath += '\\'
    resultPath = resultPath + pPath
  }
  // UNC 与「非绝对路径」之间要插一个分隔符
  if (resultPath && !_sep(resultPath[0]) && resultDrive && resultDrive[resultDrive.length - 1] !== ':') {
    return resultDrive + '\\' + resultPath
  }
  return resultDrive + resultPath
}

/**
 * CPython `ntpath.splitroot(p)` —— 切成 `[drive, root, tail]` 三段。
 *
 * ★ 本机 CPython 3.13.14 走的是 C 版 `nt._path_splitroot_ex`，下面这段是
 *   `ntpath.py:174-216` 那份纯 Python 回退；两者已用探针逐例对拍（含 UNC、设备盘、
 *   `X:`、`X:\`、`\Windows`、双分隔符、空串），结果全同。
 */
function _splitroot(p) {
  const normp = p.split('/').join('\\')
  if (normp.slice(0, 1) === '\\') {
    if (normp.slice(1, 2) === '\\') {
      // UNC 盘（\\server\share）或设备盘（\\.\device / \\?\device）
      const start = normp.slice(0, 8).toUpperCase() === '\\\\?\\UNC\\' ? 8 : 2
      const index = normp.indexOf('\\', start)
      if (index === -1) return [p, '', '']
      const index2 = normp.indexOf('\\', index + 1)
      if (index2 === -1) return [p, '', '']
      return [p.slice(0, index2), p.slice(index2, index2 + 1), p.slice(index2 + 1)]
    }
    // 带根无盘的相对路径，如 \Windows
    return ['', p.slice(0, 1), p.slice(1)]
  }
  if (normp.slice(1, 2) === ':') {
    if (normp.slice(2, 3) === '\\') return [p.slice(0, 2), p.slice(2, 3), p.slice(3)]
    return [p.slice(0, 2), '', p.slice(2)]
  }
  return ['', '', p]
}

/**
 * CPython `ntpath.split(p)` —— 返回 `[head, tail]`。
 *
 * ★ 这里**不是**「从右往左啃标点」那类土办法：`basename` / `dirname` 在 CPython 里
 *   就是 `split(p)[1]` / `split(p)[0]`（`ntpath.py:256-265`），所以必须照 `split`
 *   抄：先 `splitroot`，再从尾往前找最后一个分隔符，最后把 head 末尾的连续分隔符
 *   `rstrip` 掉（这就是 `basename('a/')` 与 `basename('a')` 不同的原因）。
 */
export function _split(p) {
  const [d, r, rest] = _splitroot(String(p ?? ''))
  let i = rest.length
  while (i && !_sep(rest[i - 1])) i -= 1
  let head = rest.slice(0, i)
  while (head.length && _sep(head[head.length - 1])) head = head.slice(0, -1)
  return [d + r + head, rest.slice(i)]
}

/** `os.path.basename` —— `split(p)[1]`，两种分隔符都算。 */
export function _basename(p) { return _split(p)[1] }

/** `os.path.dirname` —— `split(p)[0]`。 */
export function _dirname(p) { return _split(p)[0] }

/** `os.path.splitext` —— 照 `genericpath._splitext`（**前导点不算扩展名**）。 */
export function _splitext(p) {
  const s = String(p ?? '')
  const sepIndex = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  const dotIndex = s.lastIndexOf('.')
  if (dotIndex > sepIndex) {
    let filenameIndex = sepIndex + 1
    while (filenameIndex < dotIndex) {
      if (s[filenameIndex] !== '.') return [s.slice(0, dotIndex), s.slice(dotIndex)]
      filenameIndex += 1
    }
  }
  return [s, '']
}

/** `os.path.splitdrive`：`(drive, root + tail)`。 */
export function _splitDrivePy(p) {
  const [d, r, rest] = _splitroot(String(p ?? ''))
  return { drive: d, tail: r + rest }
}

/** `os.path.abspath` —— 两边 cwd 都是工具根，`resolve` 同义。 */
export const _abspath = (p) => resolve(String(p))

export function _isfile(p) {
  if (typeof p !== 'string' && !Buffer.isBuffer(p) && !(p instanceof URL)) return false
  try { return statSync(p).isFile() } catch { return false }
}

export function _isdir(p) {
  if (typeof p !== 'string' && !Buffer.isBuffer(p) && !(p instanceof URL)) return false
  try { return statSync(p).isDirectory() } catch { return false }
}

/** 键序稳定的 name→排序列（按 Unicode **码点**，等同 Python `sorted`）。 */
export function _排序(名表) {
  return [...名表].sort((a, b) => {
    const A = Array.from(a, (c) => c.codePointAt(0))
    const B = Array.from(b, (c) => c.codePointAt(0))
    const n = Math.min(A.length, B.length)
    for (let i = 0; i < n; i += 1) {
      if (A[i] !== B[i]) return A[i] - B[i]
    }
    return A.length - B.length
  })
}

/** 读文本 —— 与 Python `open(..., encoding='utf-8')` 一样做 **LF 归一**（通用换行）。 */
export const _读文本 = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

/** 写文本，换行固定 `\n`（Python 那边一律 `open(..., newline='\\n')`）。 */
export const _写文本 = (p, 文本) => writeFileSync(p, String(文本).replace(/\r\n/g, '\n').replace(/\r/g, '\n'), { encoding: 'utf8' })

/**
 * Python 的 `"%s" % exc` —— **是 `str(exc)`（异常的文字），不是 `repr(exc)`**。
 *
 * Python `theme.py:68` 与 `theme.py:308` 都用 `%s` 把异常插进人话里：JSON 解析失败时
 * 插进去的是解析器原话（`Expecting property name enclosed in double quotes: …`）。
 * `M.pyRepr(exc)` 是给 `repr()` 用的，对 Node 的 `SyntaxError` 只会得到 `{}` —— 那既不
 * 是 Python 的 `str()` 也不是 Node 的 message，纯属第三种东西，所以这里单开一个助手。
 */
export function _exc文字(exc) {
  if (exc instanceof Error) return String(exc.message)
  return String(exc)
}

/** Python `round(x, n)` —— 半值取偶；`_round` 只到整数，这里是任意小数位。 */
export function _roundPy(x, n) {
  if (!Number.isFinite(x)) return x
  const s = Number(x).toFixed(20)
  const dot = s.indexOf('.')
  if (dot < 0 || n >= 20) return x
  const frac = s.slice(dot + 1)
  const sign = x < 0 ? -1 : 1
  const digits = frac.slice(0, n)
  const 下一位 = frac.charCodeAt(n) - 48
  const 有余 = /[1-9]/.test(frac.slice(n + 1))
  let 尾 = Number.parseInt(digits === '' ? '0' : digits, 10) || 0
  if (下一位 > 5 || (下一位 === 5 && (有余 || 尾 % 2 === 1))) 尾 += 1
  return sign * (Number.parseInt(s.slice(0, dot), 10) + 尾 / 10 ** n)
}

/** Python `"%.1f"` —— 半值取偶**且整值补 `.0`**（`String(2)` 给的是 `"2"`，差一字节就红）。 */
export function _fmt1(v) {
  const s = String(_roundPy(Number(v), 1))
  if (Number.isInteger(Number(s))) return `${s}.0`
  const m = /^(-?\d+(?:\.\d+)?)e([+-]\d+)$/.exec(s)   // 极端值下的指数写法，展开成定点（同 `%f`）
  if (!m) return s
  const 负 = m[1].startsWith('-')
  const [整, 小 = ''] = m[1].replace('-', '').split('.')
  const 幂 = Number.parseInt(m[2], 10)
  let 定 = 整 + 小
  let 点 = 整.length + 幂
  if (点 <= 0) 定 = '0'.repeat(-点) + 定
  else if (点 < 定.length) 定 = 定.slice(0, 点) + '.' + 定.slice(点)
  else 定 = 定 + '0'.repeat(点 - 定.length)
  return 负 ? `-${定}` : 定
}

/** Python `round()` —— 银行家舍入；返回整数（JS 的 `Math.round` 给的是 number）。 */
export function _round(x) {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  // `Math.round` 是「.5 向上」（round half up），Python 是「.5 取偶」——
  // 只有**恰好落在半整数上**才分叉，但 `_parse_color` 的 alpha 允许 0.5/0.25/…，
  // 底与前景都是整数时正好撞得出来，所以这里单独处理（差分按字节比，差 1 就红）。
  return f % 2 === 0 ? f : f + 1
}

// ------------------------------------------------------------------ 主题库


/**
 * 顶层不是对象时的报错 —— 照抄 Python `data["_file"] = name`（在 `try` 之外）的原话。
 * JSON 的类型映射两边一一对应：array↔list · string↔str · number↔int/float · true↔bool · null↔None。
 */
function _非字典出错(x) {
  if (Array.isArray(x)) return new TypeError('list indices must be integers or slices, not str')
  if (typeof x === 'string') return new TypeError("string indices must be integers, not 'str'")
  if (typeof x === 'boolean') return new TypeError("'bool' object does not support item assignment")
  if (typeof x === 'number') {
    return new TypeError(`${Number.isInteger(x) ? "'int'" : "'float'"} object does not support item assignment`)
  }
  return new TypeError("'NoneType' object does not support item assignment")
}

export function list_themes() {
  if (!_isdir(THEMES_DIR)) return []
  const out = []
  for (const name of _排序(readdirSync(THEMES_DIR))) {
    if (!name.endsWith('.json')) continue
    let data
    try {
      data = JSON.parse(_读文本(_join(THEMES_DIR, name)))
    } catch (exc) {
      data = { 名: _splitext(name)[0], 一句话: `（读不出来：${_exc文字(exc)}）` }
    }
    // Python 那边 `data["_file"] = name` 写在 try **之外** ⇒ 顶层不是对象时它从 list_themes
    // 里**抛出去**（`list indices must be integers or slices, not str` 那一类）。JS 里给数组
    // 挂键不抛、会把垃圾输入当成一套空主题收下 —— 所以这里照 Python 抛。
    if (!_是字典(data)) throw _非字典出错(data)
    data._file = name
    data._名 = CONTENT.或(data.名, _splitext(name)[0])
    out.push(data)
  }
  return out
}


export function find_theme(name) {
  const key = String(CONTENT.或(name, '')).trim()
  if (key === '') return null
  for (const t of list_themes()) {
    if (t._名 === key || _splitext(t._file)[0] === key) return t
  }
  return null
}


export function render_css(theme) {
  const name = CONTENT.或(theme._名, CONTENT.或(theme.名, '(无名)'))
  const variables = CONTENT.或(theme.变量, {})
  const unknown = Object.keys(variables).filter((k) => !SLOTS.includes(k))
  if (unknown.length) {
    throw new ThemeError(
      `主题「${name}」写了核心不认识的槽：${unknown.join('、')}\n`
      + '  核心认识的槽在 forge/theme.py 的 SLOTS 里；写错的槽不会报错、只是永远不生效 —— 所以这里直接停。')
  }
  const lines = []
  lines.push(`/* 主题：${name} —— ${CONTENT.或(theme.一句话, '')}`)
  lines.push(' * 由 `forge theme` 生成：只覆盖 --hud-* 颜色槽，版式来自 hud/hud.css。')
  lines.push(' * 想微调就直接改这一段（下次跑 forge theme 会被覆盖）；')
  lines.push(' * 想长期留住就把它做成 assets/主题/ 下的一个新主题。')
  lines.push(' */')
  lines.push('')
  lines.push('.hud,')
  lines.push('.hud-ball,')
  lines.push('.hud-ballpanel {')
  for (const key of SLOTS) {
    if (key in variables) lines.push(`  ${key}: ${variables[key]};`)
  }
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

// ------------------------------------------------------------------ 卡上那一份


export function _read_conf(project) {
  const path = _join(project, 'hud', 'hud.conf.json')
  if (!_isfile(path)) {
    throw new ThemeError(
      `这个工程里没有 hud/hud.conf.json：${project}\n`
      + '  没有界面层就没有皮肤可换（内容层不受影响）。')
  }
  return [path, JSON.parse(_读文本(path))]
}


export function current(project) {
  const [, conf] = _read_conf(project)
  const named = String(CONTENT.或(conf[CONF_KEY], '')).trim()
  const exists = _isfile(_join(project, 'hud', THEME_FILE))
  if (named !== '' && exists) return named
  return exists ? '（未登记）' : '核心默认（羊皮卷）'
}


export function apply_theme(name, spec_or_project, out = CONTENT._print) {
  const project = _project_of(spec_or_project)
  const theme = find_theme(name)
  if (!theme) throw new ThemeError(`没有这个主题：${name}（跑 \`forge theme\` 看有哪些）`)
  const css_path = _apply(project, theme)
  out(`已换皮肤：${theme._名} -> ${relative(project, css_path)}`)
  out(`  ${CONTENT.或(theme.一句话, '')}`)
  out(`  ${Object.keys(CONTENT.或(theme.变量, {})).length} 个槽写进 ${THEME_FILE}（核心样式一个字没动）`)
  _speak_contrast(theme, out)
  out('')
  out(`下一步： python forge.py hud "${project}"   重新组装，看看新样子`)
  out(`       python forge.py theme --巡览 "${project}"   五套皮肤摆一起对比`)
  return css_path
}


export function _apply(project, theme) {
  const [conf_path, conf] = _read_conf(project)
  const css = render_css(theme)
  const css_path = _join(_join(project, 'hud'), THEME_FILE)
  _写文本(css_path, css)
  conf[CONF_KEY] = theme._名
  const prev = {}
  for (const [k, v] of Object.entries(CONTENT.或(theme.预览, {}))) {
    if (CONTENT.pyTruthy(v)) prev[k] = v
  }
  if (CONTENT.pyTruthy(prev)) conf['预览'] = prev
  else delete conf['预览']
  M.jdump(conf, conf_path)
  writeFileSync(conf_path, '\n', { flag: 'a' })
  return css_path
}


export function _speak_contrast(theme, out) {
  const rep = contrast_report(theme)
  if (CONTENT.pyTruthy(rep)) {
    out(`  可读性：${_contrast_line(theme)}（取最不利的宿主背景）`)
  }
  const poor = Object.entries(rep).filter(([, v]) => !v['够']).map(([k]) => k)
  if (poor.length) {
    out('')
    out(`  ⚠ ${poor.join('、')} 的对比度低于底线 —— 真界面上会发糊。`)
    out('    卡的底是半透明的，实际底色取决于宿主的聊天背景；'
      + '这里按「宿主纯白」和「宿主近黑」各算一遍，取更差的那个。')
  }
}


export function clear_theme(spec_or_project, out = CONTENT._print) {
  const project = _project_of(spec_or_project)
  const [conf_path, conf] = _read_conf(project)
  const css_path = _join(_join(project, 'hud'), THEME_FILE)
  let removed = false
  if (_isfile(css_path)) {
    removed = SB.shell(css_path, 'forge: 皮肤已撤回核心默认（沙箱模式不删文件，这一份是空壳）')
  }
  if (CONF_KEY in conf) {
    delete conf[CONF_KEY]
    removed = true
  }
  delete conf['预览']
  M.jdump(conf, conf_path)
  writeFileSync(conf_path, '\n', { flag: 'a' })
  out(removed ? '已撤掉皮肤，回到核心默认（羊皮卷）。' : '本来就是核心默认，没动。')
  return removed
}


export function _project_of(spec_or_project) {
  let p = _abspath(spec_or_project)
  if (_isfile(p)) p = _dirname(p)
  if (['source', '成品', '文档', 'hud'].includes(_basename(p))) p = _dirname(p)
  return p
}

// ------------------------------------------------------------------ 导出／导入


export function _parse_css_slots(text) {
  const out = {}
  const re = /(--hud-[a-z0-9-]+)\s*:\s*([^;{}]+);/g
  let m
  while ((m = re.exec(text)) !== null) out[m[1].trim()] = m[2].trim()
  return out
}


export function export_theme(spec_or_project, out_path = null, name = null, out = CONTENT._print) {
  const project = _project_of(spec_or_project)
  const [, conf] = _read_conf(project)
  const css_path = _join(_join(project, 'hud'), THEME_FILE)
  if (!_isfile(css_path)) {
    throw new ThemeError(
      `这张卡现在用的是核心默认（没有 hud/${THEME_FILE}），没有自己的槽可导。\n`
      + `  先换一套再导： python forge.py theme <名> "${project}"\n`
      + `  或者在卡上微调 hud/${THEME_FILE} 之后再来导 —— 导出的正是卡上那一份。`)
  }
  const variables = _parse_css_slots(_读文本(css_path))
  if (!CONTENT.pyTruthy(variables)) {
    throw new ThemeError(`hud/${THEME_FILE} 里没抄到任何 --hud-* 槽，导不出东西。`)
  }
  const named = String(CONTENT.或(conf[CONF_KEY], '')).trim()
  const theme = {
    名: _clean_theme_name(CONTENT.或(name, CONTENT.或(named, `${_card_name(project)}皮肤`))),
    一句话: `从「${CONTENT.或(_card_name(project), '某张卡')}」导出。`,
    变量: variables,
  }
  const prev = conf['预览']
  if (_是字典(prev) && CONTENT.pyTruthy(prev)) theme['预览'] = prev
  const rep = contrast_report(theme)
  const poor = Object.entries(rep).filter(([, v]) => !v['够']).map(([k]) => k)
  if (out_path === null || out_path === undefined || out_path === '' || out_path === false) {
    out_path = _join(project, `${theme.名}.皮肤.json`)
  }
  M.jdump(theme, out_path)
  writeFileSync(out_path, '\n', { flag: 'a' })
  out(`已导出皮肤：${theme.名}（${Object.keys(variables).length} 个槽）`)
  out(`  -> ${out_path}`)
  if (CONTENT.pyTruthy(rep)) {
    out(`  可读性：${_contrast_line(theme)}（取最不利的宿主背景）`)
  }
  if (poor.length) {
    out(`  ⚠ ${poor.join('、')} 的对比度低于底线 —— 换给别的卡同样会发糊。`)
  }
  out('')
  out(`给别人：把这份 json 发过去，对方跑 python forge.py theme --导入 "${_basename(out_path)}" <工程>`)
  return out_path
}


export function import_theme(json_path, spec_or_project, install = false, out = CONTENT._print) {
  json_path = _abspath(CONTENT.或(json_path, ''))
  if (!_isfile(json_path)) {
    throw new ThemeError(`找不到主题文件：${CONTENT.或(json_path, '(空)')}`)
  }
  let theme
  try {
    theme = JSON.parse(_读文本(json_path))
  } catch (exc) {
    throw new ThemeError(`这份主题文件读不出来（不是 json？）：${_exc文字(exc)}`)
  }
  if (!_是字典(theme) || !_是字典(theme['变量'])) {
    throw new ThemeError('这份文件里没有「变量」表 —— 不像是主题文件。'
      + '（用 `forge theme --导出` 出的那一份才是。）')
  }
  theme = { ...theme }
  theme['_名'] = _clean_theme_name(CONTENT.或(theme.名, _splitext(_basename(json_path))[0]))
  if (!CONTENT.pyTruthy(theme['变量'])) {
    throw new ThemeError('这份主题的「变量」是空的。')
  }
  render_css(theme)  // 先预检：槽名不认识就当场停，别写坏了卡
  const project = _project_of(spec_or_project)
  const css_path = _apply(project, theme)
  out(`已套上外来皮肤：${theme._名} -> ${relative(project, css_path)}`)
  out(`  ${Object.keys(theme['变量']).length} 个槽写进 ${THEME_FILE}（核心样式一个字没动）`)
  _speak_contrast(theme, out)
  if (install) {
    if (!existsSync(THEMES_DIR)) mkdirSync(THEMES_DIR, { recursive: true })
    const target = _join(THEMES_DIR, `${theme._名}.json`)
    if (existsSync(target)) {
      out(`  （assets/主题/${theme._名}.json 已存在，没动它；要用就用 --导出 覆盖。）`)
    } else {
      M.jdump(theme, target)
      writeFileSync(target, '\n', { flag: 'a' })
      out(`  已装进自带主题库：assets/主题/${theme._名}.json`)
      out('  从此 `forge theme` 列表里就有它了，任何卡都能换。')
    }
  }
  out('')
  out(`下一步： python forge.py hud "${project}"   重新组装，看看新样子`)
  return theme._名
}


export function _clean_theme_name(s) {
  s = String(CONTENT.或(s, '')).trim()
  for (const 尾 of ['.皮肤', '.json', '.主题']) {
    if (s.endsWith(尾)) s = s.slice(0, -尾.length)
  }
  for (const ch of '\\/:*?"<>|') s = s.split(ch).join('_')
  return s.trim() || '外来皮肤'
}


export function _card_name(project) {
  _要(HUD, 'hud')
  const spec = HUD.find_spec(project)
  if (!spec) return ''
  const data = M.yload(spec) || {}
  return String(CONTENT.或(CONTENT.或(data['character'], {})['name'], ''))
}

// ------------------------------------------------------------------ 对比度
//
// 卡的底是半透明的 —— 实际底色取决于宿主聊天背景。所以按「宿主纯白」与
// 「宿主近黑」各算一遍，取更差的那个。


export const _HOST_BACKDROPS = [[255, 255, 255], [20, 20, 20]]

export const _CONTRAST_ROLES = [
  ['--hud-ink', '正文', 4.5],
  ['--hud-ink-2', '次级', 3.0],
  ['--hud-dim', '淡字', 2.0],
]


export function _parse_color(value) {
  const v = String(CONTENT.或(value, '')).trim()
  let m = /^#([0-9a-fA-F]{6})$/.exec(v)
  if (m) {
    const h = m[1]
    return [[parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], 1.0]
  }
  m = /^rgba?\(([^)]*)\)$/.exec(v)
  if (m) {
    const parts = m[1].split(',').map((x) => x.trim())
    if (parts.length >= 3) {
      try {
        const rgb = [
          Math.trunc(Number.parseFloat(parts[0])),
          Math.trunc(Number.parseFloat(parts[1])),
          Math.trunc(Number.parseFloat(parts[2])),
        ]
        if (rgb.some((n) => Number.isNaN(n))) throw new Error('nan')
        let alpha = 1.0
        if (parts.length > 3) {
          alpha = Number.parseFloat(parts[3])
          if (Number.isNaN(alpha)) throw new Error('nan')
        }
        return [rgb, alpha]
      } catch {
        return [null, null]
      }
    }
  }
  return [null, null]
}


export function _composite(fg, alpha, bg) {
  return [0, 1, 2].map((i) => _round(fg[i] * alpha + bg[i] * (1 - alpha)))
}


export function _luminance(rgb) {
  const f = (x) => {
    x = x / 255.0
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgb.map(f)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}


export function _ratio(a, b) {
  const la = _luminance(a)
  const lb = _luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}


export function contrast_report(theme) {
  const variables = CONTENT.或(theme.变量, {})
  let [paper, pa] = _parse_color(variables['--hud-paper-solid'])
  if (!CONTENT.pyTruthy(paper)) {
    const r = _parse_color(variables['--hud-paper'])
    paper = r[0]
    pa = r[1]
    if (!CONTENT.pyTruthy(paper)) { paper = null; pa = null }
  }
  const out = {}
  if (!CONTENT.pyTruthy(paper)) return out
  for (const [slot, label, need] of _CONTRAST_ROLES) {
    const [fg, fa] = _parse_color(variables[slot])
    if (!CONTENT.pyTruthy(fg)) continue
    let worst = null
    for (const host of _HOST_BACKDROPS) {
      const base = _composite(paper, pa, host)
      const tone = fa >= 1.0 ? fg : _composite(fg, fa, base)
      const r = _ratio(tone, base)
      worst = worst === null ? r : Math.min(worst, r)
    }
    out[label] = { 比度: worst, 底线: need, 够: worst >= need }
  }
  return out
}


export function _contrast_line(theme) {
  const rep = contrast_report(theme)
  if (!CONTENT.pyTruthy(rep)) return ''
  const bits = []
  for (const [label, got] of Object.entries(rep)) {
    bits.push(`${label} ${_fmt1(got['比度'])}${got['够'] ? '' : '!'}`)
  }
  return bits.join(' · ')
}

// ------------------------------------------------------------------ 巡览

export const SHOWCASE_VIEWS = ['view_create.html', 'view_card.html']

export const SHOWCASE_SHELL = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@@card@@ · 皮肤巡览</title>
<style>
body{margin:0;background:#0f0e0c;color:#b9ae9b;font:14px/1.7 -apple-system,"PingFang SC",system-ui,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:26px 18px 80px}
h1{font-size:19px;letter-spacing:.2em;color:#c8a23c;margin:0 0 6px}
p.lead{margin:0 0 26px;color:#8d8677;font-size:12.5px;line-height:1.85}
.t{margin:0 0 34px;padding-top:22px;border-top:1px solid rgba(200,162,60,.2)}
.t__h{display:flex;align-items:baseline;gap:10px;margin:0 0 4px}
.t__n{font-size:16px;font-weight:700;letter-spacing:.12em;color:#d9c58a}
.t__now{font-size:11px;letter-spacing:.1em;color:#0f0e0c;background:#c8a23c;border-radius:2px;padding:1px 6px}
.t__d{margin:0 0 12px;color:#8d8677;font-size:12.5px}
.f{width:100%;height:300px;border:1px solid rgba(200,162,60,.22);border-radius:10px;background:#0a0908;display:block}
.f + .f{margin-top:10px}
.cap{margin:6px 0 0;font-size:11px;letter-spacing:.14em;color:#6f6757}
</style>
</head>
<body>
<div class="wrap">
  <h1>@@card@@ · 皮肤巡览</h1>
  <p class="lead">同一张卡、同一份代码，只换了那一组 <b>--hud-*</b> 颜色槽。<br>每套皮肤下面是同一间建卡器与同一块面板 —— 版式一个字没变，变的只有色。</p>
  @@blocks@@
</div>
</body>
</html>
`


export function showcase(spec_or_project, out_path = null, out = CONTENT._print) {
  _要(HUD, 'hud')
  const project = _project_of(spec_or_project)
  const themes = list_themes()
  if (!CONTENT.pyTruthy(themes)) throw new ThemeError(`没有找到任何主题（${THEMES_DIR}）`)
  let now = ''
  try { now = current(project) } catch (exc) { if (!(exc instanceof ThemeError)) throw exc; now = '' }
  let card = ''
  const blocks = []
  for (const t of themes) {
    const docs = HUD.render_views(project, render_css(t))   // 第二参就是 theme_override（Python 侧位置的）
    card = card || _card_of(project)
    const frames = []
    for (const view of SHOWCASE_VIEWS) {
      const doc = docs[view]
      if (!CONTENT.pyTruthy(doc)) continue
      const label = view === 'view_create.html' ? '建卡器' : '面板'
      const payload = HUD.srcdoc_escape(doc)
      frames.push(`<p class="cap">${label}</p>`
        + `<iframe class="f" title="${t._名} ${label}" srcdoc="${payload}"></iframe>`)
    }
    const mark = t._名 === now ? '<span class="t__now">现在这套</span>' : ''
    blocks.push(`<section class="t">\n  <h2 class="t__h"><span class="t__n">${t._名}</span>${mark}</h2>\n`
      + `  <p class="t__d">${CONTENT.或(t.一句话, '')}</p>\n  ${frames.join('\n  ')}\n</section>`)
  }
  // ★ Python 的 `str.replace` 换**所有**出现处（`@@card@@` 在 shell 里出现两次：title 与 h1），
  //   而 JS 的 `String.prototype.replace(串, …)` 只换第一处 ⇒ 一律走 split/join。
  let page = SHOWCASE_SHELL.split('@@card@@').join(card || '卡')
  page = page.split('@@blocks@@').join(blocks.join('\n'))
  if (out_path === null || out_path === undefined || out_path === '' || out_path === false) {
    out_path = _join(project, '皮肤巡览.html')
  }
  _写文本(out_path, page)
  out(`已生成皮肤巡览（${themes.length} 套皮肤 × ${SHOWCASE_VIEWS.length} 个视图）-> ${out_path}`)
  out(`  ${Math.floor(Array.from(page).length / 1024)} KB —— 双击就能看，不用装任何东西。`)
  out('  （只是给人挑的对照图，工程现在的皮肤没动。）')
  return out_path
}


export function _card_of(project) {
  _要(HUD, 'hud')
  const spec = HUD.find_spec(project)
  if (!spec) return ''
  const data = M.yload(spec) || {}
  return String(CONTENT.或(CONTENT.或(data['character'], {})['name'], ''))
}

// ------------------------------------------------------------------ 列表


export function print_themes(project = null, out = CONTENT._print) {
  const themes = list_themes()
  if (!CONTENT.pyTruthy(themes)) {
    out(`没有找到任何主题（${THEMES_DIR}）`)
    return
  }
  let now = ''
  if (CONTENT.pyTruthy(project)) {
    try { now = current(project) } catch (exc) { if (!(exc instanceof ThemeError)) throw exc; now = '' }
  }
  out(`可用主题（${themes.length} 套）—— 换法：python forge.py theme <名> <工程>`)
  out('')
  const weak = []
  for (const t of themes) {
    const mark = CONTENT.pyTruthy(now) && t._名 === now ? ' ← 现在这套' : ''
    out(`  ${M.pad(t._名, 8)} ${CONTENT.或(t.一句话, '')}${mark}`)
    const n = Object.keys(CONTENT.或(t.变量, {})).length
    let line = `         ${n} 个槽${n >= 12 ? '' : '（其余落核心默认）'}`
    const cl = _contrast_line(t)
    if (CONTENT.pyTruthy(cl)) line += ' · 对比度 ' + cl
    out(line)
    const rep = contrast_report(t)
    for (const [label, got] of Object.entries(rep)) {
      if (!got['够']) {
        weak.push(`${t._名} 的${label}（${_fmt1(got['比度'])} < ${_fmt1(got['底线'])}）`)
      }
    }
    out('')
  }
  if (CONTENT.pyTruthy(weak)) {
    out(`⚠ 可读性低于底线：${weak.join('；')}`)
    out('  对比度按「宿主纯白 / 宿主近黑」两种背景各算一遍取更差 —— 卡的底是半透明的。')
    out('')
  }
}
