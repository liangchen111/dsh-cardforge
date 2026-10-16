/**
 * forge.plan 的 JS 版 —— 规划书：写卡之前先落一份能查的文件。
 * ==================================================================
 *
 * 照抄 `forge/plan.py`（262 行）。零依赖：只有 `node:` 内建与本仓库同级 `.mjs`。
 *
 * 三种用法（与 Python 版同一套 CLI）：
 *
 *     node forgejs/forge.mjs plan                    # 打一张空规划书（或 -o 落到文件）
 *     node forgejs/forge.mjs plan <卡.json|spec.yaml>  # 从现成的卡反推一份
 *     node forgejs/forge.mjs plan --查 规划书.md       # 查一份写完的规划书
 *
 * 导出清单（与 plan.py 的模块级名字逐一对上；`_` 开头的私有名也照先例导出）：
 *   常量  格子 · 占位 · 头
 *   函数  _占位残留 · 模板 · _lib · 反推 · 查 · _读 · main · _写文本
 *   异常  FileNotFoundError · PermissionError · IsADirectoryError · ValueError ·
 *         AttributeError · KeyError（`main` 的 `except (OSError, ValueError, KeyError)` 要按类认）
 *   私有  _py类名 · _abspath · _normpath · _join · _splitdrive · _basename · _dirname ·
 *         _splitext（照 `opener.mjs` 先例导出，供差分台的路径口径对拍直接调用）
 *
 * 移植记号（踩过的坑，别再踩）
 * ------------------------------------------------------------------
 *   1. **`$` 的语义在 Python 与 JS 之间分叉**：`查` 正文那条正则是
 *      `re.search(r"^##\s*标题\s*$(.*?)(?=^##\s|\Z)", 文本, re.S | re.M)`。
 *      Python 的 `\Z` 是**绝对串尾**（后面**不许**跟换行），JS 的 `$` 在 `m` 下
 *      **允许**尾换行 ⇒ 照抄成 `(?![\s\S])`。实测（差分/_probe_plan_re.py）：
 *      `re.fullmatch(r"$", "abc\n", re.M)` 是 **False**、`"abc\n\n"` 也是 **False**，
 *      所以 `$` 不是「行尾或串尾」。正文那条里的 `$` 是**行尾**（`^##\s*标题\s*$`），
 *      在 JS 用 `m` 下的 `$` 是同义（多一个「串尾无换行」的落点，而后面还跟着 `\s*$`
 *      与 `(?![\s\S])` 两道，实测两种写法收出的体逐字节相同）。
 *   2. **`re.escape` 与 JS 的转义分工不同**：Python 会转义 `空格`、`-`、`、` 这些
 *      「本来就安全」的字符（`re.escape("一、一句话是什么")` 出的是原样），但**语义**是
 *      「这些字符只当字面量」——JS 里对应的写法是原样放进去。标题全是汉字与顿号，
 *      顿号是 `\p{P}` 不是元字符 ⇒ 直接内联，不写 `_escapeRe()`。**语料里备了一条
 *      「标题带正则元字符」的边界**（`算_plan` 的情形「正文标题带元字符」）盯着这一点。
 *   3. **`if x:` ≠ `if (x)`** —— `[]` / `{}` / `""` / `0` 在 JS 里是真值 ⇒
 *      凡「Python 真值判断」一律走 `CONTENT.pyTruthy()`／`CONTENT.或()`（content.mjs:122/133）。
 *      本模块有八处：`_占位残留` 的 `if not s`（`""` 两边都是假，但口径要统一）、
 *      `_lib` 的 `if not vs`、`反推` 的 `名 = 名 or 壳.get("name") or …`、
 *      `var = var or {}`、`if 变量数`、`_写文本` 的 `os.path.dirname(路径) or "."`。
 *      ★ **反向陷阱**：`占位` 里有 `"TODO"`、`"？？"` 这类**非空串**，用 `in`（`includes`）
 *      而不是真值判断 —— Python 的 `s in 占位` 是成员测试，写成 `if (占位[s])` 会恒真。
 *   4. **码点**：`len(s)` 与 `s[i]` 按码点，JS 的 `.length` 按 UTF-16 码元 ⇒
 *      `len(e.get("content") or "")` 一律走 `lenPy()`（validate.mjs 导出）。
 *      本模块有五处：正文的变量/正则/条目/分组计数与常驻字数。
 *   5. **`str.format` → 手写 `_填`**：`头.format(名=名)` 是唯一的 `str.format`。
 *      名字里出现 `{` / `}` 时 Python 的 `format` **不会**二次解释（替换值不重扫）
 *      ⇒ `_填` 用 `split("{}").join(值)`，不能写 `replace(值)` 之后再替换别的槽。
 *   6. **`os.path.abspath` ≠ `path.resolve`**（theme.mjs 记号 2 的同一条）：
 *      Python 折 `/`、Node 留着；带盘符的串 Python 只做 `normpath`。照抄一份 `_abspath`。
 *   7. **`os.path.basename` / `splitext` 认两种分隔符**：`basename("a/b\\c")` 是 `"c"`，
 *      `splitext("a.b/c")` 是 `("a.b/c", "")`（点在**目录**里不算扩展名）。
 *      Node 的 `basename` 在 Windows 上也认两种，但 `extname` 的「前导点」口径不同
 *      ⇒ 照 theme.mjs 记号 14 自写 `_splitext`（`.皮肤` 不算扩展名）。
 *   8. **`os.path.join` ≠ `path.join`**：Python 保留已有的 `/`、不规范化 ⇒ 自写 `_join`
 *      （照 draft.mjs:96-104 那版 `ntpath.join`：空段照加分隔符、绝对段丢掉前面全部）。
 *   9. **`strip()` 比 `trim()` 多收 `\x1c`–`\x1f`、`\x85`**，且不吃 `\ufeff`
 *      ⇒ `_stripPy()` 自带那五个字符的集合（照 lint.mjs 的 `_空白集` 收窄到 strip 用的这批）。
 *  10. **`re.fullmatch(r"[_\-—*·。，、\s]+", s)` 的 `\s` 是 Python 的 `\s`**（含 `\x1c`–`\x1f`、`\x85`）
 *      ⇒ 这条正则与 `_stripPy` 共用同一张字符集，写成 `[_\-—*·。，、]` ＋「全在空白集里」。
 *  11. **`open()` 失败的 OSError 文本要硬抄**：本机中文 Windows 实测
 *      `open("Z:\\no\\such\\file.json")` → `FileNotFoundError: [Errno 2] No such file or directory: 'Z:\\no\\such\\file.json'`
 *      （**是 Errno 2**，与 `os.listdir` 的 `[WinError 3]` 不是一套；盘符不存在也一样）；
 *      `open(不存在目录/out.md, "w")` 同错。Node 那边只有 `ENOENT: no such file or directory, open '…'`
 *      ⇒ 照 draft.mjs:127-146 的口径自写 `FileNotFoundError` / `PermissionError`，
 *      `_open读` / `_mkdirPy` 两处出口统一折。
 *  12. **`_写文本` 的落盘要走 `SB.land`**：`sandbox.mjs:68` 开＝读临时直接覆盖目标（源照删）、
 *      关＝`renameSync`（原子改名）。两条支路行为不同（开的时候失败会留下 `.part`）
 *      ⇒ 语料里两条都跑（`"开关": true/false`）。
 *  13. **`json.dumps` 写 `21.0`、`JSON.stringify` 写 `21`**：本模块的计数全是 int，
 *      不碰浮点 ⇒ 不需要 theme.mjs 那个 `_折浮()`。（照实记一句，别让下一个人白找。）
 *  14. **`re.S` 让 `.` 吃换行**：`查` 正文的 `(.*?)` 在 `s` 下会把节标题后的空行也收进体，
 *      而 `_占位残留` 是**逐行**判的 ⇒ 体首尾的换行不影响结果。JS 侧照写 `[^]` 或 `s` 都对，
 *      这里用 `s` 与 Python 的 `re.S` 对齐。
 *  15. **`except (OSError, ValueError, KeyError)`**：JS 没有异常分组 ⇒ `_是能兜住的()`
 *      只认「本模块与 model 抛的那几个类」（`FileNotFoundError` / `PermissionError` /
 *      `ValueError` / `KeyError`）。**故意不 catch 裸 `Error`** —— Node 的 `ENOENT`
 *      若漏过类型折换，就会一路冒到 CLI 顶上、而不是被 `!! %s` 静默吞掉。
 *  16. **`反推` 里 `e.get("title")` 缺键时 Python 给 `None`**，`"%s" % None` 是 `"None"`
 *      —— 但本模块两处 `join` 的表达式是 `e.get("title", "?")`（给了默认值）与
 *      `"- %s —— …" % e.get("title")`（**没给**，会写 `None`）。后者照抄成 `pyStr(undefined)`
 *      ＝ `"None"`，**别顺手补 `?? ""`**。语料里备了一条没有 `title` 的条目盯着它。
 *  17. **json 读失败的原文，两侧天生不同**（**已申报差异**，藏在差分台的 `_折解析器` 里）：
 *      Python `json.JSONDecodeError` 是 `ValueError` 的**子类** ⇒ `main` 的
 *      `except (OSError, ValueError, KeyError)` **兜得住**，走 `!! <解析器原文>` 打屏、返回 1。
 *      JS 的 `JSON.parse` 抛 `SyntaxError`（**不是** JS 的 `ValueError`）⇒ 必须自己折成
 *      `ValueError`（`_json读`），否则一路冒到差分台被记成 `错`。
 *      **措辞与定位两边是两套数**：`_json错文` 把 Node 的 `at position N (line L column C)`
 *      折成 CPython 的 `: line L column C (char N)` —— 12 个样本实测 `L`/`C` 直接搬 Node
 *      的（`差分\_probe_plan_jsonpos.py` / `.mjs` 就是这把尺），**别自己拿 position 去数**
 *      （Node 的 position 是「错的起点」、列是「错的终点」，两者对不上）。
 *      措辞靠 `startsWith` 对照表折：`Expected ',' or '}' after property value` →
 *      `Expecting ',' delimiter`，`Expected ':' after property name` → `Expecting ':' delimiter`，
 *      `Unexpected non-whitespace character after JSON` → `Extra data`，`Unexpected token` /
 *      `Unexpected end of JSON input` → `Expecting value`，`Unterminated string` →
 *      `Unterminated string starting at`。
 *      **两档折不平**（数都不同，属天生差异）：尾逗号（Py `Illegal trailing comma before
 *      end of object: line 1 column 8` vs Node `column 9`）与未闭合串（Py 指串**首**位置 0、
 *      Node 指串**尾**位置 4）⇒ 语料里不拿这两种形态当用例（照纪律⑨，不删用例、只不立用例）。
 *  18. **`os.path` 的四个边角属天生差异**（167 串 × 7 函数 ＋ 279 组 join 对拍只剩 4 条）：
 *      `abspath('...')` / `abspath('....')` / `abspath('//.')` / `abspath('//..')` ——
 *      `_getfullpathname` 对「整段全是点」的批处理语义，Node 侧没有对应 API。语料只放
 *      真实用得到的路径形态（`out.md`、`@工作@/规划书.md`、带盘符绝对路径、带空格与
 *      中文名的路径），不拿这四条当用例。
 *  19. **`os.listdir`/`json` 之外的 OSError 文本**（`[WinError 267] 目录名称无效。` /
 *      `[WinError 3] 系统找不到指定的路径。` / `[WinError 5] 拒绝访问。`）本模块**用不到**
 *      —— `plan` 只走 `open()`（记号 11 那套 `[Errno 2]`）与 `os.makedirs`。
 *
 * ★ 本模块的「已申报差异」共两条：记号 17（json 错文措辞／定位的两档）与记号 18
 *   （`GetFullPathNameW` 的整段点批处理）。`open()` 失败那一格（记号 11）两边也天生
 *   不同，但语料**不拿它当用例**（结构注 5：`_折读错()` 只在两侧出同一句中文时才算数）。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { CARD_FORMAT, pyRepr } from './model.mjs'
import { lenPy } from './validate.mjs'
import { pyTruthy, pyStr, 或 } from './content.mjs'
import * as SB from './sandbox.mjs'

// ---------------------------------------------------------------- 九个格子
/** 每项：`[节标题, 这一节要回答什么, 查的时候认哪几个关键词]`（第三项可为 `null`）。 */
export const 格子 = [
  [
    '一、一句话是什么',
    '这张卡想让人**体验**什么？一句话，不要形容词堆砌。',
    null,
  ],
  [
    '二、调子与体裁',
    '什么调子（都市 / 西幻 / 悬疑 / 日常……）、什么体裁（连载 / 单元 / 一次性）。',
    null,
  ],
  [
    '三、世界',
    '时代与地点、世界的规则、**这个世界里没有的东西**（口径卡）。',
    ['没有'],
  ],
  [
    '四、玩家是谁',
    '玩家扮演谁、开局处境、他能做什么、他做不到什么。',
    null,
  ],
  [
    '五、角色名册',
    '每人写四样：他是谁 / 他想要什么 / **他的弱点** / **他说话的腔调**。',
    ['弱点', '腔调'],
  ],
  [
    '六、故事与推进',
    '主线是什么、冲突从哪来、节奏怎么排、打算怎么收（或者不收）。',
    null,
  ],
  [
    '七、要记的状态',
    '要记什么（字段）、初值多少、**谁在什么时候更新** —— 三样不全就别加变量。',
    ['初值', '更新'],
  ],
  [
    '八、玩法要哪几条',
    '从玩法机制库里挑（见 `guide --篇 玩法`），**默认只上 3–5 条**，写清每条靠什么实现。',
    null,
  ],
  [
    '九、界面与交付',
    '要不要界面 / 小手机；交给谁、在什么设备上导入（手机端只认 PNG）。',
    ['导入'],
  ],
]

export const 占位 = ['待定', 'TODO', 'todo', '？？', '（空）', '(空)', '？？？']

export const 头 = `# 规划书 · {名}

> 开工前把它填满。\`python forge.py plan --查 本文件.md\` 会告诉你还缺什么。
> 填的是**想法**，不是字段名 —— 卡怎么写是下一步的事。

`

// ---------------------------------------------------------------- 工具

/** Python 的 `str.strip()` —— 比 `trim()` 多收 `\x1c`–`\x1f` 与 `\x85`（记号 9）。 */
const _空白集 = new Set([
  '\t', '\n', '\x0b', '\x0c', '\r', '\x1c', '\x1d', '\x1e', '\x1f', ' ',
  '\x85', '\xa0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
  '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f',
  '\u3000',
])

const _是空白 = (ch) => _空白集.has(ch)

function _stripPy(s) {
  const a = Array.from(String(s))
  let i = 0
  let j = a.length
  while (i < j && _是空白(a[i])) i += 1
  while (j > i && _是空白(a[j - 1])) j -= 1
  return a.slice(i, j).join('')
}

/** Python 的 `str.splitlines()`（换行族那几条；`\x1c`–\x1e` 也断行，本模块用不到）。 */
const _splitlines = (s) => String(s).split(/\r\n|[\n\r\u2028\u2029\x0b\x0c\x1c\x1d\x1e]/)

/** `str.format(名=值)` —— 只够 `头` 用（记号 5：替换值不重扫）。 */
const _填 = (模板, 名, 值) => 模板.split(`{${名}}`).join(值)

// ---------------------------------------------------------------- 路径（照 CPython 的 ntpath/posixpath 口径）

const _是绝对 = (p) => /^[\\/]/.test(p) || /^[A-Za-z]:/.test(p)

/**
 * `os.path.join` —— 照 `ntpath.join` 逐行抄（记号 8）。**关键实测**：绝对段会丢掉前面全部，
 * 但**盘符会保留下来**（`join('E:\\x','/a') === 'E:/a'`，不是 `'/a'`）。
 *   `('','') → ''` · `('a','') → 'a\\'` · `('','a') → 'a'` · `('C:\\','') → 'C:\\'` · `('C:','') → 'C:'`
 *   `('E:\\x','/a') → 'E:/a'` · `('a','/b') → '/b'`（头段没盘符才全丢）· `('a','b/','c') → 'a\\b/c'`
 *   `('E:\\x','\\\\srv\\share') → '\\\\srv\\share'`（UNC 段是绝对路径、照样丢前面的盘符）
 */
export function _join(...段) {
  if (段.length === 0) return ''
  // ★ 逐行照抄 CPython 3.13 `ntpath.py:99 join()` + `splitroot()`（盘／根／余三段论）。
  //   旧稿拿「本段的盘 + 本段余部」现拼、且把 `splitdrive` 的余部再按盘长切一次
  //   ⇒ `join('C:','b')` 给 `'C:\\b'`（应 `'C:b'`）、`join('a','')` 给 `''`（应 `'a\\'`）、
  //   `join('','D:\\b')` 给 `'D:'`（应 `'D:\\b'`）。**盘是要按大小写比、且相等时仍要取新段的。**
  const [d0, r0, p0] = _splitroot(段[0])
  let 盘 = d0
  let 根 = r0
  let 体 = p0
  for (let i = 1; i < 段.length; i += 1) {
    const [d, r, p] = _splitroot(段[i])
    if (r !== '') {
      if (d !== '' || 盘 === '') 盘 = d
      根 = r
      体 = p
      continue
    }
    if (d !== '' && d !== 盘) {
      if (d.toLowerCase() !== 盘.toLowerCase()) { 盘 = d; 根 = r; 体 = p; continue }
      盘 = d
    }
    // ★ CPython 原文：`if result_path and result_path[-1] not in seps: result_path += sep`
    //   空 `p` 照样往下加 ⇒ `join('a','')` == `'a\\'`（**实测**；`join('a','b/')` == `'a\\b/'`）
    if (体 !== '' && !/[\\/]$/.test(体)) 体 += '\\'
    体 += p
  }
  // ★ UNC 头与相对体之间要补分隔符：`'\\\\srv\\share'` 的末字符是 `e`（不在 `:\\/` 里）
  if (体 !== '' && 根 === '' && 盘 !== '' && !/[:\\/]$/.test(盘)) return 盘 + '\\' + 体
  return 盘 + 根 + 体
}

/**
 * `os.path.splitdrive` —— 返回 `[盘符或 UNC 头, 其余]`。
 *
 * ★ **盘符和 UNC 头在输出里都可能带尾分隔符**（实测）：
 *   `'C:'→['C:','']` · `'C:\\a'→['C:','\\a']` · `'C:/'→['C:','/']`
 *   `'\\\\server\\share\\a'→['\\\\server\\share','\\a']` · `'\\\\server\\share\\'→['\\\\server\\share','\\']`
 *   `'\\\\server'→['\\\\server','']` · `'\\\\'→['\\\\','']` · `'//'→['//','']`（**空共享名也算 UNC 头**）
 *   `'\\\\?\\C:\\a'→['\\\\?\\C:','\\a']`（设备路径同口径）
 * 本机 Python 是 3.13.12（`ntpath` 已冻结），这几条是**实测**、不是从源码推的。
 */
export function _splitdrive(p, unc_ok = true) {
  // ★ 照 CPython 3.13 `ntpath.splitdrive`（`ntpath.py:146`）：`drive, root = splitroot(p)` ⇒ `drive, root+tail`。
  //   UNC 头只认「两个分隔符后面**还跟非分隔符**」那种（`'//x'`/`'\\/x'`/`'/\\x'` 都不是 UNC ⇒ 盘为空）。
  const s = String(p)
  const d = _splitroot(s)
  if (d[0] === '') return ['', s]
  if (d[0].startsWith('\\\\') && !unc_ok) return ['', s]  // `abspath` 的老分支用得上（`'\\\\'` 当普通名字）
  return [d[0], d[1] + d[2]]
}

/**
 * `ntpath.splitroot` —— 返回 `[盘, 根, 余]`（照 CPython 3.13 `ntpath.py:174` 的纯 Python 那支逐行搬）。
 *
 * ★ 与 `_splitdrive` **不是一回事**：这里「根」单独一格、且**盘与根都从原串切**（大小写照留）：
 *   `'C:/a'` → `['C:', '/', 'a']`（`_splitdrive` 给 `['C:', '/a']`）。
 * ★ UNC 前缀按 CPython：`\\?\UNC\` 跳 8 个字符找共享名，普通 UNC 跳 2 个。
 */
export function _splitroot(p) {
  // ★ 逐行照抄 CPython 3.13 `ntpath.py:174`（本机 `nt._path_splitroot_ex` 的纯 Python 同形版）。
  //   ★ 三段都从**原串**切（分隔符照留：`'/'` 的根就是 `'/'`、`'//'` 的头就是 `'//'`，只有这里
  //     才认 `/`；`normpath` 自己会先把 `/` 折成 `\\`）。
  //   ★ 旧稿在 UNC 那支把 `s.slice(i,i+1)` 写死成 `'\\'` ⇒ `'/a'` 的根变成 `'\\'`、`dirname('/')` 跟着错。
  const s = String(p)
  const n = s.replace(/\//g, '\\')
  if (n.slice(0, 1) === '\\') {
    if (n.slice(1, 2) === '\\') {
      const 起 = n.slice(0, 8).toUpperCase() === '\\\\?\\UNC\\' ? 8 : 2
      const i = n.indexOf('\\', 起)
      if (i === -1) return [s, '', '']
      const j = n.indexOf('\\', i + 1)
      if (j === -1) return [s, '', '']
      return [s.slice(0, j), s.slice(j, j + 1), s.slice(j + 1)]
    }
    return ['', s.slice(0, 1), s.slice(1)]
  }
  if (n.slice(1, 2) === ':') {
    if (n.slice(2, 3) === '\\') return [s.slice(0, 2), s.slice(2, 3), s.slice(3)]
    return [s.slice(0, 2), '', s.slice(2)]
  }
  return ['', '', s]
}

/**
 * `os.path.normpath` —— 照 CPython `ntpath.normpath` 的逐行口径（记号 6）。
 *
 * ★ 三处实测踩过的坑：
 *   ① `'/'→'\\'`、`'//'→'\\\\'`、`'///'`→三个 —— 开头连写 n 个分隔符折成 **n−1** 个；
 *      `'\\\\'` 及其 UNC 家族（`'\\\\srv\\share\\…'`）**整段跳过折叠**。
 *   ② UNC 头（`'\\\\srv\\share'`）**整段原样保留**，一个尾分隔符都不补（`'\\\\srv'→'\\\\srv'`）。
 *   ③ 盘符只在「后一个字符折成反斜杠后恰好是反斜杠」时才算根：`'C:/a'→'C:\\a'`、`'C:'` 保持 `'C:'`。
 *   ④ 旧稿拿 `startsWith('\\\\')` 判根 ⇒ `'E:\\'` 掉成 `'E:'`、`abspath` 连带全错（已改走 `_splitroot`）。
 */
export function _normpath(p) {
  // ★ 逐行照抄 CPython 3.13 `ntpath.normpath`（`ntpath.py:446`）。关键分支实测：
  //   `''`→`'.'` · `'.'`→`'.'` · `'a/..'`→`'.'` · `'a/../..'`→`'..'` · `'C:.'`→`'C:'` · `'C:..'`→`'C:..'`
  //   `'//'`→`'\\'` · `'///'`→`'\\\\'`（开头 n 个分隔符折成 **n−1** 个）· `'//x'`→`'\\x'`
  //   `'\\\\srv'`→原样 · `'\\\\srv\\share'`→原样 · `'\\\\srv\\share\\'`→**'\\\\srv\\share\\'（尾分隔符保留）**
  //   非 UNC 且 `根` 非空时，根**总是**折成一个 `\\`（UNC 保持原样、盘符 `C:` 无根不补）。
  const 秒0 = String(p)
  if (秒0 === '') return '.'
  const [盘0, 根0, 尾0] = _splitroot(秒0.replace(/\//g, '\\'))
  // ★ UNC 头**整段都是分隔符**时（`'//'`、`'///'`、`'\\\\'`）不是真 UNC 头，而是「开头连写 n 个分隔符」
  //   ⇒ 折成**同样多**个反斜杠：实测 `normpath('/')`→`'\\'` · `'//'`→`'\\\\'` · `'\\\\'`→`'\\\\'`
  //   · `'///'`→`'\\\\\\'`（C 层 `_path_normpath` 认 `'//'` 为头后再补一个根杆）。
  const 全杆 = 盘0 !== '' && /^[\\/]+$/.test(盘0) && 根0 === ''
  if (全杆) return '\\'.repeat(盘0.length)
  const 盘 = 盘0
  const 根 = 根0
  const 尾 = 尾0
  // `''`→`'.'` 已在上头挡掉；这里 盘/根 全空且尾为空只在 `全杆` 折成空串时出现（`'\\'`→已挡）
  const 段 = []
  for (const 段i of 尾.split('\\')) {
    if (段i === '' || 段i === '.') continue
    if (段i === '..') {
      if (段.length && 段[段.length - 1] !== '..') 段.pop()
      // ★ CPython `ntpath.py:502`：`elif i == 0 and root` —— 判的是**根**，不是「有没有前缀」；
      //   盘符相对（`'C:..'`）时根为空 ⇒ 要收成 `'C:..'`（实测 `normpath('C:..')`→`'C:..'`）。
      else if (!根) 段.push('..')
      continue
    }
    段.push(段i)
  }
  // ★ CPython `ntpath.py:505`：`if root and not path_and_tail: prefix = drive + root` —— 尾为空时
  //   根**直接**进 prefix（`'/'`→`'\\'`、`'C:\\'`→`'C:\\'`、`'C:\\..'`→`'C:\\'`、UNC 头保持原样）；
  //   尾非空时才折成一个 `\\`。旧稿把前两支合成「只有有段才补分隔符」⇒ 根单留一个时掉成 `'.'`，
  //   连带 `abspath('/')` 掉成 `'E:'`、`abspath('C:')` 掉成 `'C:'`。
  const 前 = 根 === '' ? 盘 : 段.length ? 盘 + '\\' : 盘 + 根
  const 体 = 段.join('\\')
  // ★ 照 CPython `ntpath.py:509`：**只有「盘与根都空、且收完没段」才折 `'.'`**。
  //   有根时（`'/'`、`'\\'`、`'C:\\'`、`'C:\\..'`、`'\\\\?\\C:\\'`）一律给回 `盘+根` ——
  //   旧稿把空体折成 `'.'` ⇒ `normpath('/')` 给 `'.'`、`abspath('/')` 掉成 `'E:'`（Python 实测都给带杆的那份）。
  const 出 = 前 + 体
  return 前 === '' && 体 === '' ? '.' : 出
}

/**
 * `GetFullPathNameW` 的「收尾点／空格」那一档 —— **只有 `abspath` 走**（`normpath` 不走）：
 *   ① 连续 n 个点（n≥3）折成 2 个：「`a...`→`a..`」、「`a...b`→`a..b`」、「`.` 与 `'..'` 不动」
 *   ② 每个路径段**剥掉尾部所有点与空格**（首部不动：「`.a`→`.a`」、「`..a`→`..a`」）
 * 实测（`os.path.abspath`，cwd 在 E 盘）：`'a.'`→`…\\a` · `'a. '`→`…\\a` · `'x. /y'`→`…\\x. \\y`（**只剥段尾**
 * ⇒ `'x. '` 后跟分隔符时那一段的尾点尾空格**不剥**）· `'...'`→`…\\`（折成 `'..'` 后走上一级、再被 normpath 收到盘根）
 * · `'. .'`→`…\\`（先剥成 `'.'`）。
 */
export function _disp(p) {
  // ★ 先折 `/`→`\\`（`GetFullPathNameW` 就是先折再做点处理；旧稿不折 ⇒ `'a/..'` 按 `\\` 分段切成
  //   一整段 `'a/..'`，尾点规则把 `/..` 当尾巴抹掉，给出 `'a/'`）。
  const 原 = String(p).replace(/\//g, '\\')
  const 段 = 原.split('\\')
  const 出 = 段
    .map((段i, i) => {
      if (段i === '') return 段i
      let s = 段i
      const 末 = i === 段.length - 1
      // ★ 尾段先剥「尾空格」—— 剥完看整段是不是纯点（`'.. '→'..'`、`'. .'→'.'`）；
      //   中间段（后面还有非空段）按 Windows 实测**不剥尾空格**（`'x. /y'→`…`\x. \y`）。
      if (末) s = s.replace(/[ ]+$/, '')
      if (s === '' || /^\.+$/.test(s)) {
        // 整段纯点：**只有末段**才把 ≥3 个折成 `'..'`（`abspath('...')` → 当前目录）；
        //   中间段按 Windows 实测**原样保留**（`'...\\甲'` → `'…\\...\\甲'`，别折成上一级）。
        if (s.length >= 3) return 末 ? '..' : s
        return s
      }
      // 首字符是点的点在段首不算「尾点」（`'...a'`→`'...a'`、`'.a'`→`'.a'`），尾点从第一个非点字符之后开始剥。
      if (末) {
        const j = s.search(/[^.]/)
        const 前点 = s.slice(0, j)
        s = 前点 + s.slice(j).replace(/[. ]+$/, '')
        // ★ 剥完正好剩 `'..'`（`'..'` / `'....'` / `'...'` 这一档）：Windows 把它们当**当前目录**
        //   而不是上一级（实测 `abspath('..')`→`'E:\\workGZQ'` 而 `abspath('...')`→`'E:\\workGZQ\\制卡工具\\'`
        //   —— 上一级与当前目录**都带尾杆**、只有长短不同）。折成 `'.'` 交回 normpath 收段时
        //   `'.'` 段会被剔掉 ⇒ 得到「当前目录」，与实测同形。
        if (s === '..') return '.'
      } else if (/[^.]\.$/.test(s)) {
        // ★ 中间段：**只剥「恰好一个尾点」**（前一个字符不是点），**不剥尾空格**。
        //   Windows 实测：`'甲.\\卡'`→`'甲\\卡'` · `'甲 .\\卡'`→`'甲 \\卡'`（点剥、空格留）·
        //   而 `'甲..\\卡'` / `'甲 \\卡'` / `'甲. \\卡'` **一律不动**。
        s = s.slice(0, -1)
      }
      return s
    })
    .join('\\')
  // ★ 上面把「整段纯点」的 `'..'` 段原样留着了（中间段的 `'a\\..\\b'` 要靠它收段）；只有
  //   折完全串**恰好是 `'..'`** 时才是 Windows 的「折成当前目录」那一档（实测 `'...'`）。
  if (出 === '..') return '.'
  return 出
}

/**
 * `os.path.abspath` —— 相对时先接 cwd；带盘符／UNC 的串**只做 normpath**（记号 6）。
 *
 * 本机（中文 Windows，cwd `E:\workGZQ\制卡工具`）实测，逐条对上：
 *   `''`→`'E:\\workGZQ\\制卡工具'` · `'a\\..\\..\\b'`→`'E:\\workGZQ\\b'` · `'C:\\a\\..\\b'`→`'C:\\b'`
 *   `'\\\\server\\share\\a'`→原样 · `'\\a'`→`'E:\\a'`（根相对＝当前盘）· `'\\\\'`→`'\\\\'`
 *   `'a/b'`→`'E:\\workGZQ\\制卡工具\\a\\b'`（`/` 折成 `\\`、`.` 段收掉）
 *   ★ 收尾点归 `_disp`（os 走 `GetFullPathNameW`、`ntpath.normpath` 不走 ⇒ 两个入口结果不同）
 *
 * **已备案差异**：`'C:相对'`（盘符相对）Python 按**那个盘的当前目录**解析，Node 拿不到别的盘的 cwd
 * ⇒ 本实现折成 `'<盘>:\\' + 余部`（余部为空时 `'C:'` → `'C:\\'`）。两个解释器的 cwd 都在 E 盘、
 * 语料里不放 `'C:相对'` 这类串 ⇒ 差分台上碰不到。
 */
export function _abspath(p) {
  const s = String(p)
  const cwd = process.cwd()
  const cwd盘 = /^([A-Za-z]:)/.exec(cwd)
  // ★ 照 CPython 3.13 `ntpath.abspath`（`ntpath.py:531`，Windows 支）：先 `normpath`，再交给本机
  //   `nt._getfullpathname`。Node 没有那个 API ⇒ 用 `_disp` 近似它（收尾点／空格），其余走 `_normpath`。
  const [d, r] = _splitroot(s)
  // ★ 只有**盘符**（`^[A-Za-z]:$`）才折大写（`_getfullpathname` 的口径）；UNC／设备头（`\\\\srv\\share`、
  //   `\\\\?\\C:`）原样 —— 旧稿无条件 `.toUpperCase()` ⇒ `abspath('\\\\srv\\share')` 给回 `\\\\SRV\\SHARE`。
  const 盘上 = (x) => (/^[A-Za-z]:$/.test(x) ? x.toUpperCase() : x)
  if (d !== '' && r !== '') return _normpath(_disp(盘上(d) + r + s.slice(d.length + r.length)))
  if (d === '' && r !== '') {
    // 根相对、无盘符：`_getfullpathname` 接**当前盘的根**（实测 `'/'`→`'E:\'`、`'/a'`→`'E:\a'`）
    return _normpath(_disp((cwd盘 ? cwd盘[1].toUpperCase() : '') + r + s.slice(r.length)))
  }
  if (d !== '') {
    // CPython：`if drive and not root: drive += '\\'` —— 也**只对盘符**补，UNC／设备头（`'\\\\srv\\share'`）
    // 不补（实测 `abspath('\\\\srv\\share')`→原样、`abspath('\\\\srv\\share\\')`→原样带尾杆）。
    const 补 = /^[A-Za-z]:$/.test(d) ? '\\' : ''
    return _normpath(_disp(盘上(d) + 补 + s.slice(d.length)))
  }
  // 无盘无根：接 cwd。`'\\\\'`／UNC 头由 `_splitroot` 判成有根或有盘，不会走到这里。
  return _normpath(_disp(_join(cwd, s)))
}

/**
 * `os.path.basename` —— 照 `ntpath.basename` 的实测口径：
 *   ① 尾字符是分隔符 ⇒ **空串**（`'a/b/'`、`'a\\'`、`'/'`、`'C:\\'`、`'\\\\srv\\share\\'` 全是 `''`）
 *   ② 否则先剥盘符；剥完是空 ⇒ 空串；再取最后一个分隔符之后（`'C:\\a'→'a'`、`'/a'→'a'`）
 *
 * 其余实测：`'a/b\\c'→'c'` · `'a'→'a'` · `''→''` · `'C:'→''` · `'.'→'.'` · `'..'→'..'`
 * · `'\\\\srv\\share'→''` · `'\\\\srv\\share\\a'→'a'`。
 */
export function _split(p) {
  // ★ 逐行照抄 CPython 3.13 `ntpath.split`（`ntpath.py:225`）—— 先 `splitroot` 剥头，
  //   再从尾往前找最后一个分隔符，`head` 收掉尾部分隔符后与 `d+r` 拼回。`basename`/`dirname` 都是它的投影。
  const s = String(p)
  const d = _splitroot(s)
  const 尾 = d[2]
  let i = 尾.length
  while (i && 尾[i - 1] !== '\\' && 尾[i - 1] !== '/') i -= 1
  const 头 = 尾.slice(0, i).replace(/[\\/]+$/, '')
  return [d[0] + d[1] + 头, 尾.slice(i)]
}

export function _basename(p) {
  return _split(p)[1]
}

export function _dirname(p) {
  return _split(p)[0]
}

export function _splitext(p) {
  // ★ 逐行照抄 CPython 3.13 `genericpath._splitext`（`genericpath.py:52`；`ntpath.splitext`
  //   （`ntpath.py:245`）只是把它转发过来，sep='\\'、altsep='/'、extsep='.'）：
  //     sepIndex = p.rfind(sep); altsepIndex = p.rfind(altsep); dotIndex = p.rfind(extsep)
  //     if dotIndex > max(sepIndex, altsepIndex):
  //         filenameIndex = sepIndex + 1
  //         while filenameIndex < dotIndex:
  //             if p[filenameIndex] != extsep: return p[:dotIndex], p[dotIndex:]
  //             filenameIndex += 1
  //     return p, p[:0]          ← ★ 兜底是**整串都算 root**，不是 `[root,'']`
  //   ★ 两个坑：
  //     ① 旧的「取 basename 再看最后一个点」写法对 `.a`/`..a`/`...` 全错（点在首位 ⇒ 没有扩展名），
  //        Python 这里给的是 `('.a','')`、`('..a','')`、`('...','')`；
  //     ② 分隔符之后的**前导点**不算扩展名，全点名字只因「点后面还有非点字符」才切。
  //   实测：`'a.tar.gz'`→`('a.tar','.gz')` · `'a...'`→`('a..','.')` · `'C:.'`→`('C:','.')`
  //   · `'Z:..'`→`('Z:.','.')` · `'.皮肤'`→`('.皮肤','')` · `'a.b/c'`→`('a.b/c','')` · `''`→`('','')`。
  const s = String(p)
  const 后分隔 = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  const 点 = s.lastIndexOf('.')
  if (点 > 后分隔) {
    for (let i = 后分隔 + 1; i < 点; i += 1) {
      if (s[i] !== '.') return [s.slice(0, 点), s.slice(点)]
    }
  }
  return [s, '']
}

// ---------------------------------------------------------------- 文件（照抄 Python 的异常类型与文本）

export class FileNotFoundError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FileNotFoundError'
  }
}

export class PermissionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PermissionError'
  }
}

export class IsADirectoryError extends Error {
  constructor(message) {
    super(message)
    this.name = 'IsADirectoryError'
  }
}

export class ValueError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValueError'
  }
}

/**
 * `AttributeError` —— 本模块只有一处会真抛（`反推` 里 `variable_config` 是个列表）。
 *
 * Python 的原文是 `'list' object has no attribute 'get'`（类型名小写）⇒ `_py类名()` 折。
 */
export class AttributeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AttributeError'
  }
}

/** Python 里 `type(x).__name__` 的小写口径（只够本模块用到的几种）。 */
export function _py类名(x) {
  if (x === null || x === undefined) return 'NoneType'
  if (Array.isArray(x)) return 'list'
  if (typeof x === 'string') return 'str'
  if (typeof x === 'number') return Number.isInteger(x) ? 'int' : 'float'
  if (typeof x === 'boolean') return 'bool'
  if (typeof x === 'object') return 'dict'
  return typeof x
}

export class KeyError extends Error {
  constructor(key) {
    const 文 = typeof key === 'string' ? `'${key}'` : pyRepr(key)
    super(文)
    this.name = 'KeyError'
  }
}

/**
 * `open()` 失败的 OSError 文本 —— 本机中文 Windows 的原文照抄（记号 11）。
 *
 * 实测（Python 3.13.12 / 本机）：盘符不存在与父目录不存在**同一条**：
 *   `open("Z:\\no\\such\\file.json")` → `[Errno 2] No such file or directory: 'Z:\\no\\such\\file.json'`
 *   `open("Z:\\no\\such\\dir\\out.md", "w")` → 同上（路径是 repr 进来的）。
 */
function _open错(p) {
  const 文 = pyRepr(String(p))
  return new FileNotFoundError(`[Errno 2] No such file or directory: ${文}`)
}

/** `open(路径, "r", encoding="utf-8")` —— 只够读文本用。 */
function _open读(p) {
  const 路径 = String(p)
  try {
    return readFileSync(路径, 'utf8')
  } catch (exc) {
    const 码 = exc && exc.code
    if (码 === 'ENOENT') throw _open错(路径)
    if (码 === 'EISDIR') throw new PermissionError(`[Errno 13] Permission denied: ${pyRepr(路径)}`)
    if (码 === 'EACCES' || 码 === 'EPERM') throw new PermissionError(`[Errno 13] Permission denied: ${pyRepr(路径)}`)
    throw exc
  }
}

/** `os.path.isdir` —— 出错（含不存在）一律 False。 */
function _是目录(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** `os.makedirs(目录, exist_ok=True)`。 */
function _mkdirPy(目录) {
  try {
    mkdirSync(目录, { recursive: true })
  } catch (exc) {
    const 码 = exc && exc.code
    if (码 === 'ENOENT') throw _open错(目录)
    if (码 === 'EACCES' || 码 === 'EPERM') throw new PermissionError(`[Errno 13] Permission denied: ${pyRepr(目录)}`)
    if (码 === 'EEXIST') return
    throw exc
  }
}

/** `except (OSError, ValueError, KeyError)` —— 只认本模块与兄弟模块抛的那几类（记号 15）。 */
function _是能兜住的(exc) {
  return exc instanceof FileNotFoundError || exc instanceof PermissionError
    || exc instanceof IsADirectoryError || exc instanceof ValueError || exc instanceof KeyError
}

// ---------------------------------------------------------------- 占位判定

/**
 * `len(x)` 的按类型分流 —— **Python 的 `len()` 对 list/dict/str 都给「元素个数」**，
 * 而 `validate.mjs` 导出的 `lenPy()` 只数**码点**（`Array.from(String(x))`）：
 * 拿一个非空数组 `[{a:1},{a:2}]` 去调它，`String([...])` 先变成 `'[object Object],[object Object]'`、
 * 数出来 31 —— 实测就是这一步把「正则 2 条」印成「正则 31 条」、「变量 1 条」印成「变量 15 条」。
 * ⇒ 数组／有 length 的对象走 `.length`，其余（字符串）才走 `lenPy`（码点口径，记号 4）。
 */
function _长度(x) {
  if (Array.isArray(x)) return x.length
  if (x !== null && typeof x === 'object' && 'length' in x) return x.length
  return lenPy(x)
}

export function _占位残留(行) {
  let s = _stripPy(行)
  if (!pyTruthy(s) || s.startsWith('#') || s.startsWith('>') || s.startsWith('|')) return true
  if (s.startsWith('-') || s.startsWith('*')) s = _stripPy(s.slice(1))
  if (!pyTruthy(s)) return true
  if (占位.includes(s)) return true
  // `re.fullmatch(r"<[^>]*>", s)` —— `[^>]` 在 JS 里**吃换行**，Python 也吃（字符类是例外）⇒ 同义。
  if (/^<[^>]*>$/.test(s)) return true
  // `re.fullmatch(r"[_\-—*·。，、\s]+", s)` —— `\s` 用 Python 的那张表（记号 10）。
  const 字 = Array.from(s)
  if (字.length && 字.every((ch) => '_—-*·。，、'.includes(ch) || _是空白(ch))) return true
  return false
}

// ---------------------------------------------------------------- 模板

export function 模板(名 = '我的卡') {
  const out = [_填(头, '名', 名)]
  for (const [标题, 要答] of 格子) {
    out.push(`## ${标题}\n\n> ${要答}\n\n- <在这里写>\n`)
  }
  out.push(`## 附 · 交付前自查

- [ ] \`python forge.py check <工程>\` 0 错
- [ ] 解包往返一致（\`unpack\` → \`build\` → \`diff\` 报语义完全一致）
- [ ] 常驻条目**只降不涨**（它是每轮的固定税）
- [ ] 手机端导入：给 \`png\` 出的 \`.card.png\`（JSON 手机上导不进去）
`)
  return out.join('\n')
}

// ---------------------------------------------------------------- json 的错

/**
 * `json.loads()` 失败的原文 —— `ValueError`（`JSONDecodeError` 是它的子类，`plan.py` 的
 * `except (OSError, ValueError, KeyError)` 兜得住）⇒ 走 `!! <原文>` 打屏、返回 1。
 *
 * Node 的 `JSON.parse` 只给**一句话**、且它的定位与 CPython 不是一套：本机实测
 * `'{... "character": {\n}\n'` 两侧都指到第 6 行第 1 列、`char 75`，但
 * `'{"a": 1,}'` 这类「尾逗号/缺冒号」CPython 给 `line 1 column 8`、Node 给 `column 9`。
 * 所以只有**结构性缺分隔符**这一档能逐字节折平，其余是**申报差异**（见文件头记号 18）。
 */
function _json错文(文) {
  const s = String(文)
  const m = / at position (\d+)(?: \(line (\d+) column (\d+)\))?/.exec(s)
  const 位置 = m ? Number(m[1]) : 0
  // ★ Node 自己那条 `(line L column C)` 与 CPython 的 `lineno/colno` 逐样本一致
  //   （实测 12 个样本全对，见 `差分\_probe_plan_jsonpos.py` / `.mjs`）⇒ 直接把它
  //   搬过来，别自己拿 `position` 去数：Node 的 position 是「错的**起点**」、
  //   列是「错的**终点**」，两者本来就不等于 `position - 上一个换行`。
  const 行 = m && m[2] !== undefined ? Number(m[2]) : 1
  const 列 = m && m[3] !== undefined ? Number(m[3]) : 位置 + 1
  const 尾 = `: line ${行} column ${列} (char ${位置})`
  // 一律用 `startsWith` 对照 Node 的措辞（避开正则字面量与单引号打架）
  if (s.startsWith("Expected ',' or '}' after property value")) return `Expecting ',' delimiter${尾}`
  if (s.startsWith("Expected ',' or ']' after array element")) return `Expecting ',' delimiter${尾}`
  if (s.startsWith("Expected ':' after property name")) return `Expecting ':' delimiter${尾}`
  if (s.startsWith('Unexpected non-whitespace character after JSON')) return `Extra data${尾}`
  if (s.startsWith('Unexpected token')) return `Expecting value${尾}`
  if (s.startsWith('Unexpected end of JSON input')) return `Expecting value${尾}`
  if (s.startsWith('Unterminated string')) return `Unterminated string starting at${尾}`
  if (s.startsWith('Expected ')) return `Expecting value${尾}`
  // 对不上号的（Node 的措辞没见过）给最小信息，别谎报。
  return `Expecting value${尾}`
}

/** `json.loads(文)` —— 失败抛本模块的 `ValueError`（照 `_json错文` 的原文）。 */
function _json读(文) {
  try {
    return JSON.parse(String(文))
  } catch (exc) {
    throw new ValueError(_json错文(exc && exc.message !== undefined ? exc.message : exc))
  }
}

// ---------------------------------------------------------------- 从现成的卡反推

export function _lib(native) {
  let lib = native['setting_library']
  if (typeof lib === 'string') lib = _json读(lib)
  if (!(lib !== null && typeof lib === 'object' && !Array.isArray(lib))) {
    throw new ValueError('卡里读不出设定库')
  }
  const vs = 或(lib['versions'], [])
  if (!pyTruthy(vs)) throw new ValueError('设定库是空的')
  return vs[0]
}

/** `json.loads()` 里的 `except ValueError` —— 解析器原文天生不同，由差分归一。 */
const _试解析 = (文) => {
  try {
    return [_json读(文), null]
  } catch (exc) {
    return [null, exc]
  }
}

export function 反推(卡路径, 名 = null) {
  const native = _json读(_open读(卡路径))
  if (native['format'] !== CARD_FORMAT) {
    throw new ValueError(`这不是 ElecKoi 卡（format=${pyRepr(native['format'] ?? null)}）`)
  }
  const lib = _lib(native)
  const 条目 = 或(lib['entries'], [])
  const 组 = 或(lib['groups'], [])
  const 壳 = 或(native['character'], {})
  // `名 = 名 or 壳.get("name") or splitext(basename(卡路径))[0]`
  名 = 或(名, 壳['name'], _splitext(_basename(卡路径))[0])
  let var_ = native['variable_config']
  if (typeof var_ === 'string') {
    const [好, 错] = _试解析(var_)
    var_ = 错 ? {} : 好
  }
  // Python 这里 `var = var or {}` 之后直接 `var.get(...)`：列表（真值）会走到 `.get` 上抛
  // `AttributeError: 'list' object has no attribute 'get'`。照抄（记号 17）。
  if (Array.isArray(var_)) {
    throw new AttributeError(`'${_py类名(var_)}' object has no attribute 'get'`)
  }
  var_ = 或(var_, {})
  const 变量数 = _长度(或(var_['variables'], []))
  const 正则数 = _长度(或(native['regex_rules'], []))
  const 开场 = 条目.filter((e) => e['kind'] === 'opening')
  const 常驻 = 条目.filter((e) => e['trigger_mode'] === 'always')

  const out = [_填(头, '名', 名)]
  out.push('## 一、一句话是什么\n\n- （反推不出来 —— 看下面的条目，自己补一句）\n')
  out.push('## 二、调子与体裁\n\n- （自己补）\n')
  out.push('## 三、世界\n\n- 这个世界没有的东西（口径卡）：自己补一句\n'
    + `- 设定库分组：${组.map((g) => 或(g['name'], '')).join('、') || '（无分组）'}\n`
    + `- 世界观类条目：${条目.filter((e) => ['世界', '设定', '地理', '势力'].some((k) => (或(e['title'], '')).includes(k))).map((e) => 或(e['title'], '?')).join('、') || '（无）'}\n`)
  out.push('## 四、玩家是谁\n\n- （自己补：开场白里能看出一点）\n')
  const 名册 = 条目.filter((e) => ['角色', 'NPC', '名册'].some((k) => (或(e['title'], '')).includes(k)))
  out.push('## 五、角色名册\n\n'
    + `${名册.map((e) => `- ${pyStr(e['title'])} —— **弱点**：<补>；**腔调**：<补>`).join('\n') || '- （没找到角色类条目：自己补）'}\n`)
  out.push('## 六、故事与推进\n\n'
    + `- 条目里的故事类：${条目.filter((e) => ['故事', '主线', '冲突', '节奏'].some((k) => (或(e['title'], '')).includes(k))).map((e) => 或(e['title'], '?')).join('、') || '（无）'}\n`)
  out.push('## 七、要记的状态\n\n'
    + (变量数
      ? `- 变量 ${变量数} 条 —— 逐条确认「初值」与「谁更新」\n`
      : '- **这条卡没有变量**。要用「会变的状态」才加（初值 / 谁更新 两样都得答得上来）。\n')
    + '\n')
  out.push('## 八、玩法要哪几条\n\n- （自己补；现成机制见 `python forge.py guide --篇 玩法`）\n')
  out.push('## 九、界面与交付\n\n'
    + `- 卡内正则 ${正则数} 条${正则数 ? '（可能含界面层，`hud` 管）' : ''}\n`
    + '- 交付：手机上导入要 `png` 出 `.card.png`；想让 AI 也拿到一份，再出 `preset`\n')
  out.push('## 附 · 现状清单（自动生成 · 别手改）\n\n'
    + `- 条目 **${_长度(条目)}** 条 · 分组 **${_长度(组)}** 组 · 变量 **${变量数}** · 正则 **${正则数}**\n`
    + `- 常驻 **${_长度(常驻)}** 条（共 ${常驻.reduce((a, e) => a + lenPy(或(e['content'], '')), 0)} 字）—— 只降不涨\n`
    + `- 开场白 **${_长度(开场)}** 条\n`)
  out.push('### 条目全表\n\n| 标题 | 分组 | 触发 | 策略 | 字数 |\n|---|---|---|---|---|\n')
  for (const e of 条目) {
    // `next((g.get("name","") for g in 组 if g.get("id") == e.get("group_id")), "—") or "—"`
    let 组名 = '—'
    for (const g of 组) {
      if (g['id'] === e['group_id']) {
        组名 = 或(g['name'], '')
        break
      }
    }
    组名 = 或(组名, '—')
    out.push(`| ${或(e['title'], '?')} | ${组名} | ${或(e['trigger_mode'], '—')} | `
      + `${或(e['agent_read_strategy'], '—')} | ${lenPy(或(e['content'], ''))} |\n`)
  }
  return out.join('')
}

// ---------------------------------------------------------------- 查

/** 正文那条正则 —— `\Z` 折成 `(?![\s\S])`、`re.S|re.M` 折成 `gms`（记号 1、14）。 */
const _正文正则 = (标题) => new RegExp(`^##\\s*${标题}\\s*$([^]*?)(?=^##\\s|(?![\\s\\S]))`, 'gms')

export function 查(文本) {
  const 问题 = []
  const 缺节 = []
  for (const [标题, , 必含] of 格子) {
    const m = _正文正则(标题).exec(文本)
    if (!m) {
      缺节.push(标题)
      continue
    }
    const 体 = m[1]
    const 实 = _splitlines(体).filter((ln) => !_占位残留(ln))
    if (!pyTruthy(实)) {
      问题.push(`「${标题}」还是空的 —— 填一句就够`)
      continue
    }
    const 正文 = 实.join('\n')
    for (const 词 of (必含 || [])) {
      if (!正文.includes(词)) {
        // 「没有 / 不要 / 不加 / 无」这类明确否定也算答了
        if (/(没有|不要|不加|不做|无[。，,\s]|不存在)/.test(正文)) continue
        问题.push(`「${标题}」里看不到「${词}」—— 这一项最容易漏，也最容易崩`)
      }
    }
  }
  if (pyTruthy(缺节)) {
    问题.push(`少了这几节：${缺节.join('、')}（照 \`python forge.py plan\` 打一份新的）`)
  }
  return 问题
}

// ---------------------------------------------------------------- CLI

export function _读(路径) {
  return _open读(路径)
}

export function main(argv) {
  argv = [...argv]
  const 查模式 = argv.includes('--查') || argv.includes('--check')
  if (查模式) {
    argv = argv.filter((a) => a !== '--查' && a !== '--check')
    if (!pyTruthy(argv)) {
      console.log('用法：python forge.py plan --查 <规划书.md>')
      return 2
    }
    let 文本
    try {
      文本 = _读(argv[0])
    } catch (exc) {
      if (!_是能兜住的(exc)) throw exc
      console.log(`!! ${pyStr(exc && exc.message !== undefined ? exc.message : exc)}`)
      return 1
    }
    const 问题 = 查(文本)
    console.log(`规划书体检 · ${argv[0]}`)
    console.log('='.repeat(66))
    if (pyTruthy(问题)) {
      for (const p of 问题) console.log(`  ✗ ${p}`)
      console.log('-'.repeat(66))
      // ★ `len(问题)` 数的是**列表长度**，不是码点 —— 写 `lenPy(问题)` 会去数拼接串
      //   （实测把「9 处待补」写成「203」，因为 `String(数组)` 是逗号拼接、`Array.from` 数它）。
      console.log(`${问题.length} 处待补 —— 补完再开工，比写到一半返工便宜得多。`)
      return 1
    }
    console.log('  ✔ 九节齐、该有的都有。可以开工写卡了。')
    return 0
  }

  let 出 = null
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if ((a === '-o' || a === '--out') && i + 1 < argv.length) {
      出 = argv[i + 1]
      argv = argv.slice(0, i).concat(argv.slice(i + 2))
      break
    }
  }
  const 源 = pyTruthy(argv) ? argv[0] : null
  let 文本
  let 说明
  try {
    if (源) {
      文本 = 反推(源)
      说明 = `从 ${_basename(源)} 反推`
    } else {
      文本 = 模板()
      说明 = '空模板'
    }
  } catch (exc) {
    if (!_是能兜住的(exc)) throw exc
    console.log(`!! ${pyStr(exc && exc.message !== undefined ? exc.message : exc)}`)
    return 1
  }

  if (出) {
    _写文本(出, 文本)
    console.log(`✔ 规划书（${说明}）→ ${出}`)
    console.log(`  填完用 \`python forge.py plan --查 ${出}\` 查一遍再开工。`)
    return 0
  }
  process.stdout.write(文本)
  return 0
}

export function _写文本(路径, 文本) {
  路径 = _abspath(路径)
  const 目录 = _dirname(路径) || '.'
  if (!_是目录(目录)) _mkdirPy(目录)
  const 临时 = 路径 + '.part'
  writeFileSync(临时, String(文本), 'utf8')
  SB.land(临时, 路径)
  SB.cleanup(临时)
}
