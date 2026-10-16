/* forge.guard 的 JS 版 —— 只读禁区名单（任何写操作落盘前都要先问它）。
 *
 * 与 `forge/guard.py` 逐字节同行为。名单有三个来源，**都是用户自己配的**，
 * 代码里不写任何人的私有路径：
 *   ① 环境变量 `FORGE_READONLY`（临时用；分隔符照 `os.pathsep`）
 *   ② 工具根下的 `只读名单.txt`（一行一个绝对路径，`#` 起头是注释）—— 每次现读，改完立刻生效
 *   ③ 目录里放一个 `.只读` 空文件（随手用；从被问的路径往上一直查到盘根）
 *
 * --- 移植记号
 *
 *  1. **`os.path.abspath` ≠ `path.resolve`**（手册先例）。Python 走 `GetFullPathNameW`，
 *     会①把 `/` 折成 `\`、②把「整段是点」的段按 Windows 语义折、③剥掉段尾的点与空格。
 *     `path.resolve` 一条都不做 ⇒ 一律走 `plan.mjs` 那套**逐行照抄 CPython 3.13 `ntpath`** 的
 *     `_abspath()`（`plan.mjs:411`，底下连着 `_disp` / `_normpath` / `_splitroot` / `_split`），
 *     不另起一份（`png.mjs` / `preset.mjs` 也是这么从共用件里取的）。
 *     `_norm()` 与 `readonly_reason()` 上的**路径比较**全靠它 —— 差一个尾点就会把「禁区里」判成「外边」。
 *     ★ **一处已申报的边界**（是共用 `_abspath` 的边界，不是本模块的逻辑）：Python 连**非末段**的
 *     单尾点也折（`甲.\卡.json` → `甲\卡.json`），而 `plan.mjs` 的 `_disp` 只折**末段**。
 *     实测矩阵（两边一致 ⇒ 语料照走）：`甲. ` / `甲 ` / `甲...` / `甲\卡.json.` / `甲\卡.json ` **都折**；
 *     `甲..\卡.json` / `甲...\卡.json` / `甲. \卡.json` **都不动**。
 *     **只有「非末段 + 恰好一个尾点且后面不跟空格」这一格两边不同**，语料刻意不摆这一格，
 *     差异就登记在这一行（要修得去 `plan.mjs` 的 `_disp`，别在 guard 里另写一份）。
 *  2. **`path.join` ≠ `os.path.join`**：绝对段会丢掉前面全部、但**盘符要保留**
 *     （`join('E:\\x','/a') === 'E:/a'`）⇒ 用 `plan.mjs` 的 `_join()`，不用 `path.join`。
 *  3. **`str.strip()` ≠ `trim()`**：Python 的空白族多收 `\x1c`–`\x1f` 与 `\x85`、
 *     **不收** `\ufeff`。`FORGE_READONLY` 的分段与名单文件的行都靠 `strip()` ⇒ 用 `_stripPy()`
 *     （同一张 `_空白集`，见 `plan.mjs:181`）。名单文件用 `utf-8-sig` 开 ⇒ 行首 BOM 由**编解码层**
 *     吃掉，`_stripPy` 不认 BOM 是**故意**的，两者配合才对。
 *  4. **`for line in fh` 是 `splitlines()`**，不是 `split("\n")`：行尾 `\r` 要吃掉
 *     （名单存成 CRLF 时，`split("\n")` 会在每行尾巴留一个 `\r`，被 `strip()` 顺手收了看不出来，
 *     但**行内的 `\x0b\x0c\x1c\x1d\x1e\x1e\x1f` 也会断行**，那就不是「看不出来」了）⇒ `_读行()`。
 *  5. **`str.split("#", 1)[0]`** 是「切第一个 `#`」，JS `split('#')` 是切光 ⇒ 写 `split('#')[0]`
 *     会**一样**给对第一段，但 `indexOf` + `slice` 更贴近原文、也不建多余数组。
 *  6. **`os.path.dirname(d) == d` 是判「到顶了」**：`ntpath.split('C:\\')[0] === 'C:\\'`、
 *     `split('\\\\')` 的头也是它自己 ⇒ `while (true) { … if (上 === d) break }`，别写成
 *     `while (d)`（UNC 与相对路径那一档会转圈或提前停）。
 *  7. **`os.path.isabs` 与「盘符在前」不是一回事**：`'C:甲'` 是**相对**路径。
 *     本模块只拿它挑「报错里印绝对路径还是印末段名」（`readonly_reason()` 那句）。
 *     ★ **照抄这台机器 `ntpath.py` 的真身**（`…\versions\3.13.12\Lib\ntpath.py` ——
 *     `inspect.getsource` 会报 `OSError: could not get source code`，得直读文件）：
 *         s = s[:3].replace(altsep, sep)
 *         # Absolute: UNC, device, and paths with a drive and root.
 *         return s.startswith(colon_sep, 1) or s.startswith(double_sep)   # ':\' 与 '\\'
 *     ⇒ `'/甲'`、`'/'`、`'\a'`、`'\甲'` **都不是**绝对路径（单个反斜杠开头不算）；
 *     只有**双**反斜杠开头（UNC/设备名）才算；盘符后**必须跟根**。
 *     头一版按「剥 UNC 头、看盘符后有根」写，把 `'子\甲'`（相对名）判成了绝对 ⇒
 *     那句该印 `甲` 却印 `子\甲`。**语料里补了那一格**（m00519 反向测试：改坏当场红）。
 *  8. `ROOT` 是本模块的**可变**导出（`guard.py:23` 那个模块级变量，测试会临时改它）。
 *     JS 的 `export const` 绑不出去改不动 ⇒ 这里照先例用 `export let`。
 *  9. **`.只读` 标记的查询路径是「归一后但没折尾点」的绝对路径**（`_norm` 的那份），
 *     不是 `_disp` 折过的那份 —— Python 就是这么做的（`p = _norm(path)`，后面一路用它）。
 *     `is_file` 由内核代劳折尾点，所以两种写法在真盘上结果一样，**但别顺手改成 `_abspath(path)`**。
 * 10. 本模块**不读写任何 JSON**，手册里「`M.ydump` 要换成 `M.jdump` + `.json` 后缀」那条
 *     在这里**没有落点**（照实记一句，省得下一个人白找）。
 * 11. 本模块**没有随机值、没有模块级可变状态要还原**（除了 `ROOT`，那是给测试改的）
 *     ⇒ 差分台上不需要 `_动()` 之外的特殊处理；`只读名单.txt` 与 `.只读` 标记都是**语料自己造**的，
 *     绝不去碰工具根上那份真名单（`guard.ROOT` 每情形临时指到 `@工作@`，出门还原）。
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _abspath, _basename, _dirname, _join } from './plan.mjs'

// ---------------------------------------------------------------- 常量

const 这里 = dirname(fileURLToPath(import.meta.url))
/** = 工具根（`<根>/forgejs/lib/guard.mjs` 往上三层）。
 *  ★ **必须是 `let`**：`guard.py` 的 `ROOT` 是模块级变量，测试与差分台都会临时改它
 *    （`tests/test_forge.py::test_默认不认任何私有路径` 就改它来验「空默认」）。
 *  ★ **走 `fileURLToPath` 而不是 `URL.pathname`**：后者给的是百分号编码的 `/`-分隔串
 *    （中文目录会变成 `%E5%88%B6%E5%8D%A1`），`_abspath` 解不回来。 */
export let ROOT = resolve(这里, '..', '..')

/** 差分台／测试专用：改工具根（`null` ⇒ 还原成模块自己算出来的那一份）。
 *
 *  ★ 为什么要有这个函数：ESM 的导出绑定**对导入方只读**，`GU.ROOT = x` 会当场
 *    `TypeError: Cannot assign to read only property 'ROOT'`。照 `theme.mjs:125 _setThemesDir`
 *    的先例开一个 setter。Python 侧 `guard.ROOT = tmp` 与这里 `guard._setROOT(tmp)` 同效。 */
export function _setROOT(p) {
  ROOT = p === null || p === undefined ? resolve(这里, '..', '..') : String(p)
  return ROOT
}

/** 工具根下那份名单的文件名（`guard.py:26`）。 */
export const LIST_FILE = '只读名单.txt'

/** 临时名单走的环境变量名（`guard.py:27`）。 */
export const ENV = 'FORGE_READONLY'

/** 随手放的目录标记文件名（`guard.py:29`）。 */
export const MARKER = '.只读'

// ---------------------------------------------------------------- 工具（照 CPython 口径）

/** Python 的 `str.strip()` —— 比 `trim()` 多收 `\x1c`–`\x1f` 与 `\x85`（记号 3）。 */
const _空白集 = new Set([
  '\t', '\n', '\x0b', '\x0c', '\r', '\x1c', '\x1d', '\x1e', '\x1f', ' ',
  '\x85', '\xa0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
  '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f',
  '\u3000',
])

function _stripPy(s) {
  const a = Array.from(String(s))
  let i = 0
  let j = a.length
  while (i < j && _空白集.has(a[i])) i += 1
  while (j > i && _空白集.has(a[j - 1])) j -= 1
  return a.slice(i, j).join('')
}

/** 只剥双引号（`str.strip('"')`）—— 名单里带引号的写法要认。 */
const _strip引号 = (s) => _stripPy(s).replace(/^"+/, '').replace(/"+$/, '')

/** `os.path.normcase` —— Windows 口径：`/`→`\`，再整体小写。 */
const _normcase = (p) => String(p).replace(/\//g, '\\').toLowerCase()

/** `os.path.isfile` —— 只认「真文件」（目录、死链、没权限一律 False）。 */
function _isfile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** `ntpath.isabs` —— **照抄这台机器 `ntpath.py` 的那两行判定，别自己讲道理**（记号 7）。
 *
 *  真身（`...\versions\3.13.12\Lib\ntpath.py`，`inspect.getsource` 拿不到就直读文件）：
 *      s = s[:3].replace(altsep, sep)
 *      # Absolute: UNC, device, and paths with a drive and root.
 *      return s.startswith(colon_sep, 1) or s.startswith(double_sep)
 *  其中 `colon_sep = ':\\'`、`double_sep = '\\\\'`（**两个**反斜杠的字符串）。
 *  ⇒ 三个反直觉处，我都亲眼用矩阵验过：
 *    · `'/甲'`、`'/'`、`'\a'`、`'\甲'` **都不是**绝对路径（单反斜杠开头不算）；
 *    · 只有**双**反斜杠开头（`'\\\\srv\\sh'`、`'\\\\'`）才算，即 UNC/设备名；
 *    · 盘符后**必须跟根**：`'C:\甲'` 是、`'C:甲'` 不是。
 *  我头一版按「剥 UNC 头、再看盘符后有根」写，把 `'甲'`（普通相对名）判成了绝对 ⇒
 *  `readonly_reason()` 那句本该印 `os.path.basename(r)` 却印了整串。**语料里补了那一格。 */
function _isabs(p) {
  const s = String(p).slice(0, 3).replace(/\//g, '\\')
  return s.slice(1, 3) === ':\\' || s.startsWith('\\\\')
}

/** `os.path.dirname` 的「到顶了」判定（记号 6）：`C:\`、`\\` 的 dirname 都是它自己。 */
const _到顶 = (p) => _dirname(p) === p

/** `str.splitlines()` —— 换行族那几条都断行，且**尾换行不产生空行**（记号 4）。 */
const _读行 = (文) =>
  文 === '' ? [] : String(文).split(/\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\u2028\u2029]/)

/**
 * 读 UTF-8 文本，**带 BOM 就吃掉**（`utf-8-sig`）。
 *
 * Node 的 `readFileSync(p,'utf8')` 会把 BOM 解成 `\ufeff` 字面量，而 Python 的
 * `encoding="utf-8-sig"` 在**解码层**就把它剥了 —— 这就是记号 3 里那句「`_stripPy` 不认 BOM
 * 是故意的」的落点：名单文件第一行 `\ufeffC:\甲` 在 Python 那边读到的是 `C:\甲`。
 */
function _读文本utf8sig(p) {
  const fd = openSync(p, 'r')
  try {
    const 块 = []
    const buf = Buffer.alloc(65536)
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n <= 0) break
      块.push(buf.subarray(0, n))
    }
    const 原 = Buffer.concat(块)
    const 起 = 原.length >= 3 && 原[0] === 0xef && 原[1] === 0xbb && 原[2] === 0xbf ? 3 : 0
    return 原.subarray(起).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** `os.path.normcase(os.path.abspath(str(p)))`（`guard.py:32-33`）。 */
export function _norm(p) {
  return _normcase(_abspath(strPy(p)))
}

/** Python 的 `str()` —— `None` 是字面量 `"None"`、`True`/`False` 是大写（手册记号 10）。 */
function strPy(v) {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v)
}

// ---------------------------------------------------------------- 名单

/** 当前生效的只读禁区（绝对路径列表）。每次现读 —— 改完名单立刻生效。 */
export function readonly_paths() {
  const out = []
  for (const 段0 of String(process.env[ENV] ?? '').split(process.env.pathsep ?? ';')) {
    const 段 = _strip引号(_stripPy(段0))
    if (段 !== '') out.push(段)
  }
  const path = _join(ROOT, LIST_FILE)
  if (_isfile(path)) {
    for (const 行0 of _读行(_读文本utf8sig(path))) {
      const 行 = _strip引号(_stripPy(行0.split('#')[0]))
      if (行 !== '') out.push(行)
    }
  }
  return out
}

/** 要写这个路径的话，给个拒绝理由；能写返回 `null`。 */
export function readonly_reason(path) {
  const p = _norm(path)
  for (const r of readonly_paths()) {
    const rr = _norm(r)
    if (p === rr || p.startsWith(rr + '\\')) {
      return (
        '「' +
        (_isabs(r) ? r : _basename(r)) +
        '」在只读禁区名单上 —— 它是只读参考，本工具对它只许看、不许动。'
      )
    }
  }
  let d = p
  for (;;) {
    if (_isfile(_join(d, MARKER))) {
      return '「' + d + '」里有 `' + MARKER + '` 标记 —— 整个目录按只读处理。'
    }
    const 上 = _dirname(d)
    if (上 === d) break
    d = 上
  }
  return null
}
