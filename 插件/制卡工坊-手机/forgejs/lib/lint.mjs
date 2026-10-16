/**
 * forge.lint 的 JS 版 —— 正文体检（防八股）：不判「这是不是 AI 写的」，只抓「读起来像模板」的句式。
 * ==================================================================
 *
 * 判据来自 2026-10-15 的联网调研；只留 4 条经得起核验的判据（3 硬 + 1 软），
 * **词级黑名单一律不收** —— 这里查的是**句式骨架**，不是词。
 *
 * 用法（与 Python 版同名同参，见 `forge/lint.py`）：
 *
 *     读(path, out) · 体检(文本, out, 标题, 单轮) · 打标准(out) · main(argv, out)
 *
 * 退出码：有硬判据不过 ⇒ 1；全过 ⇒ 0。
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 移植纪律（同 model.mjs / validate.mjs / content.mjs 头上那几条）：**行为照抄，不顺手改**；
 * 能逐字节比的逐字节比。**本模块是本项目唯一带「非标准库依赖」的那个** ——
 * Python 那边 `import yaml`，JS 这边换成自写的子集读取器 `yaml.mjs`（`解析YAML`）。
 *
 * ★ 记号 1 · **`\s` 与 `str.strip()` 不是一套字符集**。Python 的 `\s`／`str.isspace()` 收
 *   `\x1c`–`\x1f` 与 `\x85`、**不收** `\ufeff`；JS 的 `\s`／`trim()` 恰好相反。本模块到处
 *   `\s`、`.strip()`，所以自建了 `_空白类`（正则里顶掉 `\s`）与 `_stripPy()`。
 *   同理 `str.splitlines()` 的行界集合与 JS 不同（`\v\f\x1c\x1d\x1e\x85\u2028\u2029`）、
 *   且**结尾的换行不产生空行** ⇒ `_行()` 自写。
 *
 * ★ 记号 2 · **码点**。`len()` / `s[:n]` / 正则量词 / `re.Match.start()` 在 Python 里全按
 *   码点，JS 的 `s.length` / `slice` / `{1,6}` / `match.index` 按 UTF-16 码元 ⇒
 *   凡量词都带 `u` 旗标（让它按码点数），`lenPy()` / `切()` 从 validate.mjs / content.mjs 取，
 *   `m.start()` 一律折成 `lenPy(文本.slice(0, m.index))`。星平面字符（emoji）会当场分叉。
 *
 * ★ 记号 3 · **`"%.Nf"` 是定点、半值取偶**，`toFixed` 是「.5 向上」⇒ 自写 `_定点()`
 *   （`0.125` 的 `%.2f` Python 给 `0.12`、`toFixed(2)` 给 `0.13`）。`"%-14s"` 按**码点**
 *   补空格 ⇒ `_ljust()`。
 *
 * ★ 记号 4 · **Python 真值判断一律走 `CONTENT.pyTruthy()`**（`content.mjs:122`）——
 *   `if x:` 里 `[]` / `{}` / `""` / `0` 全是假，JS 的 `if (x)` 里 `[]` / `{}` 是真。
 *   `or` 走 `或()`。
 *
 * ★ 记号 5 · **`-`（标准输入）**：Python 是 `sys.stdin.read()`，JS 用 `readFileSync(0)`。
 *
 * ★ 记号 6 · Python 那句 `try: import yaml / except ImportError: return 文本, path` 在 JS 侧
 *   **不可达**（`yaml.mjs` 是静态导入）—— 代码位置照抄留注释，一行行为差异都没有
 *   （Python 装了 PyYAML，那条支路本来也走不到）。
 *
 * ★ 记号 7 · **两处「解析器／操作系统的原话」天生不同**（已申报差异，折法写在
 *   `差分/语料/lint.json` 的「说明」里）：
 *     · `这个 .json 读不出来：%s` 里的 `%s` 是解析器原文（Python `Expecting value: line 1 column 1 (char 0)`，
 *       Node `Unexpected token … in JSON at position 0`）；
 *     · `open()` 失败时的 OSError 文本（Python `[Errno 2] No such file or directory`，
 *       Node `ENOENT: no such file or directory`）—— lint.py 自己没有格式化的地方，
 *       原样往上抛，由 CLI 层去硬抄 Windows 文本（见接手说明纪律 10）。
 *
 * ★ 记号 8 · 本模块**不产生任何随机量**（没有 uuid / 时间戳）⇒ 差分台那边不需要 `_动()` 归一，
 *   只需要 `_换路径()` 把临时工作目录折成 `<工作>`。
 *
 * ★ 记号 9 · **差分台笔记**：`main -o` 写出来的报告正文里嵌着源文件的**绝对路径**，
 *   而临时工作目录每次 `mkdtemp` 都不一样 ⇒ 那份 `.md` 的 `sha1` 折不掉、逐字节比不出来。
 *   语料两侧各把树里的 `报告*.md` 从 `sha1` 换成**正文**，再让外层 `_换路径`把工作目录折成
 *   `<工作>`（Python `_树lint`／JS `树lint`，只在本模块的 `算_lint` 里）。
 *
 * ★ 本模块**没覆盖到的三条边界**（原因逐条写在 `差分/语料/lint.json` 的「说明」里）：
 *   `读("-")`（进程内换不掉 fd 0）· `读(目录)`（Python `PermissionError` vs Node `EISDIR`，
 *   是真异常不是申报差异）· `提示冒号` 正则对「以换行结尾的样本」的 `$` 语义（模块里
 *   一律作用在 `raw.strip()` 上，串尾换行到不了那条正则）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { lenPy } from './validate.mjs'
import { pyTruthy, 或, 切 } from './content.mjs'
import { 解析YAML } from './yaml.mjs'

export const 汉字 = '\\u4e00-\\u9fff'

// ── 判据 ────────────────────────────────────────────────────────────────

// Python 的 `\s`／`str.isspace()` 集合（与 JS 的 `\s` 差三处，见记号 1）。
const _空白集 = new Set(Array.from(
  '\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004'
  + '\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000',
))
/** 正则里的 Python `\s`（等价字符类）。 */
const _空白类 = '[\\t\\n\\x0b\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
/** 把 Python 模式文本里的 `\s` 换成等价字符类（其余原样 —— 模式文本本身与 Python 一字不差）。 */
const _换空白 = (源) => 源.split('\\s').join(_空白类)

/** Python 的 `str.strip()` —— 收 `\x1c`–`\x1f` 与 `\x85`、**不吃** `\ufeff`。 */
function _stripPy(s) {
  const a = Array.from(String(s))
  let i = 0
  let j = a.length
  while (i < j && _空白集.has(a[i])) i += 1
  while (j > i && _空白集.has(a[j - 1])) j -= 1
  return a.slice(i, j).join('')
}

/** Python 的 `print` —— 差分台靠换掉 `process.stdout.write` 收 stdout（同 manual.mjs 的 `_print`）。 */
const _print = (s = '') => { process.stdout.write(String(s) + '\n') }

export const 提示冒号 = new RegExp(`^[${汉字}]{1,6}[：:]$`, 'u')
export const 列表项 = new RegExp(_换空白('^\\s*(?:[-*·]|\\d+[.、)])\\s*'), 'u')
export const 对立句 = new RegExp(_换空白(
  '不是[^，。；！？\\n]{1,20}[，,]\\s*(?:而)?是'
  + '|不仅[^，。；！？\\n]{1,20}[，,]\\s*更是'
  + '|不只是[^，。；！？\\n]{1,20}[，,]\\s*(?:还|更)是'
  + '|不光是[^，。；！？\\n]{1,20}[，,]\\s*(?:而)?是'
  + '|并非[^，。；！？\\n]{1,20}[，,]\\s*(?:而)?是',
), 'gu')
export const 破折号 = /——|—|–/gu
export const 段首序数 = new RegExp(
  '^(?:首先|其次|再次|然后|最后|第[一二三四五六七八九十]{1,3}|其[一二三四五六七八九十]{1,3})[，,、]?',
  'u',
)
export const 句断 = /[。！？!?…]+|\n+/gu

/** 整行「几个字：」且下一非空行是列表项 —— 命中判据的说明表（顺序即输出顺序）。 */
export const 标准 = [
  ['硬', '提示冒号 ＋ 空行接列表',
    '整行只有「几个字：」，下一段接列表 —— 这一子类可靠（R=3.8×／9.4×，人类两组近 0）', '0 处'],
  ['硬', '对立句式骨架',
    '不是X而是Y / 不仅…更是… —— 整篇限 1 次', '≤1 次'],
  ['硬', '破折号', '`——` / `—` / `–`，该轮正文一处都不留', '0 处'],
  ['软', '段首序数词', '首先 / 其次 / 第一 …（段首）', '≤0.19/千字'],
  ['软', '相邻句同构', '相邻两句开头相同（排比成瘾）', '只报数'],
]

// ── Python 语义小工具（本模块只用得到这几个） ────────────────────────────

/** Python 的 `d.get(k)`（键在、值是 None 时给 None，不是给默认）。 */
const _取 = (o, k) => (o && typeof o === 'object' && k in o ? o[k] : null)

/** Python 的 `str.splitlines()` —— 行界集合与「结尾换行不产生空行」都跟 JS 不同。 */
export function _行(文本) {
  const s = String(文本)
  if (s === '') return []
  const 段 = s.split(/\r\n|[\n\v\f\r\x1c\x1d\x1e\x85\u2028\u2029]/)
  if (段.length > 1 && 段[段.length - 1] === '') 段.pop()
  return 段
}

const _段断 = new RegExp('\\n' + _空白类 + '*\\n', 'gu')

/** Python 的 `[p for p in re.split(r"\n\s*\n", 文本) if p.strip()]`。 */
export function _段(文本) {
  return String(文本).split(_段断).filter((p) => pyTruthy(_stripPy(p)))
}

/** Python 的 `[s.strip() for s in 句断.split(文本) if s.strip()]`。 */
export function _句(文本) {
  return String(文本).split(句断).map((s) => _stripPy(s)).filter((s) => pyTruthy(s))
}

/** Python 的 `"%.Nf"` —— 定点、**半值取偶**（`toFixed` 是「.5 向上」，不能用）。 */
function _定点(v, n) {
  const x = Number(v)
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  const 负 = x < 0 || Object.is(x, -0)
  const s = Math.abs(x).toFixed(25)
  const 点 = s.indexOf('.')
  const 整 = 点 < 0 ? s : s.slice(0, 点)
  const 小 = (点 < 0 ? '' : s.slice(点 + 1)).padEnd(n + 1, '0')
  const 留 = 小.slice(0, n)
  const 余 = 小.slice(n)
  const 首 = 余.charCodeAt(0) - 48
  let 进 = false
  if (首 > 5) 进 = true
  else if (首 === 5) {
    if (/[1-9]/.test(余.slice(1))) 进 = true
    else 进 = ((留.length ? 留 : 整).slice(-1).charCodeAt(0) - 48) % 2 === 1
  }
  let 数 = 整 + 留
  if (进) {
    const a = Array.from(数)
    let i = a.length - 1
    while (i >= 0 && a[i] === '9') { a[i] = '0'; i -= 1 }
    if (i < 0) 数 = '1' + a.join('')
    else { a[i] = String(Number(a[i]) + 1); 数 = a.join('') }
  }
  if (n === 0) return (负 ? '-' : '') + 数
  return (负 ? '-' : '') + 数.slice(0, 数.length - n) + '.' + 数.slice(数.length - n)
}

const _f1 = (v) => _定点(v, 1)
const _f2 = (v) => _定点(v, 2)
const _f3 = (v) => _定点(v, 3)

/** Python 的 `"%-Ns"` —— 按**码点**补空格，超长不截断。 */
const _ljust = (s, n) => {
  const t = String(s)
  const 缺 = n - lenPy(t)
  return 缺 > 0 ? t + ' '.repeat(缺) : t
}

/** `"%s" % exc` —— 是 `str(exc)`（异常的文字），不是 `repr(exc)`。 */
const _exc文字 = (exc) => (exc instanceof Error ? String(exc.message) : String(exc))

const 汉字单 = new RegExp(`[${汉字}]`, 'g')

// ── 判据实现 ────────────────────────────────────────────────────────────

/** 整行「几个字：」且下一非空行是列表项 ⇒ 命中。 */
export function 查提示冒号(文本) {
  const 行 = _行(文本)
  const 命中 = []
  for (let i = 0; i < 行.length; i += 1) {
    const raw = 行[i]
    if (!提示冒号.test(_stripPy(raw))) continue
    for (let j = i + 1; j < Math.min(i + 4, 行.length); j += 1) {
      const s = _stripPy(行[j])
      if (!pyTruthy(s)) continue
      if (列表项.test(s)) 命中.push([i + 1, _stripPy(raw)])
      break
    }
  }
  return 命中
}

export function 查对立句(文本) {
  const s = String(文本)
  const 命中 = []
  for (const m of s.matchAll(对立句)) 命中.push([lenPy(s.slice(0, m.index)), m[0]])
  return 命中
}

export function 查破折号(文本) {
  const s = String(文本)
  const 命中 = []
  for (const m of s.matchAll(破折号)) 命中.push([lenPy(s.slice(0, m.index)), m[0]])
  return 命中
}

export function 查段首序数(文本) {
  const 命中 = []
  for (const p of _段(文本)) {
    const m = 段首序数.exec(_stripPy(p))
    if (m) 命中.push(m[0])
  }
  return 命中
}

export function 查相邻同构(文本) {
  const 句 = _句(文本)
  const 命中 = []
  for (let i = 0; i + 1 < 句.length; i += 1) {
    const a = 句[i]
    const b = 句[i + 1]
    if (lenPy(a) >= 4 && lenPy(b) >= 4 && 切(a, 2) === 切(b, 2)) 命中.push([切(a, 6), 切(b, 6)])
  }
  return 命中
}

export function 查排比(文本) {
  const 句 = _句(文本)
  const 命中 = []
  for (let i = 0; i + 2 < 句.length; i += 1) {
    const a = 句[i]
    const b = 句[i + 1]
    const c = 句[i + 2]
    if (Math.min(lenPy(a), lenPy(b), lenPy(c)) >= 4 && 切(a, 2) === 切(b, 2) && 切(b, 2) === 切(c, 2)) {
      命中.push([i + 1, 切(a, 6)])
    }
  }
  return 命中
}

// ── 取正文 ──────────────────────────────────────────────────────────────

const _是字典 = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** Python 的 `[b for b in 块 if b and b.strip()]` 收尾（`"\\n\\n".join`）。 */
const _拼块 = (块) => 块.filter((b) => pyTruthy(b) && pyTruthy(_stripPy(b))).join('\n\n')

/** 把 ElecKoi 卡里所有「给人读的正文」抠出来。 */
export function _从卡(doc) {
  const 块 = []
  let 库 = _取(doc, 'setting_library')
  if (typeof 库 === 'string') {
    try {
      库 = JSON.parse(库)
    } catch {
      库 = null
    }
  }
  if (_是字典(库)) {
    for (const v of 或(_取(库, 'versions'), [])) {
      for (const e of 或(_取(v, 'entries'), [])) {
        块.push(或(_取(e, 'content'), ''))
        for (const m of 或(_取(e, 'opening_messages'), [])) {
          块.push(或(_取(m, 'content'), ''))
        }
      }
    }
  }
  const 甲 = _取(doc, 'character')
  if (_是字典(甲)) {
    for (const k of ['first_mes', 'mes_example', 'description', 'personality']) {
      const v = _取(甲, k)
      if (typeof v === 'string') 块.push(v)
    }
  }
  return _拼块(块)
}

export function _从稿(doc) {
  const 块 = []
  const 库 = 或(_取(doc, 'library'), {})
  const 表 = _是字典(库) ? _取(库, 'entries') : null
  for (const e of 或(表, [])) {
    if (_是字典(e)) 块.push(或(_取(e, 'content'), ''))
  }
  return _拼块(块)
}

/** 认得三种输入：卡 json / 卡稿 yaml / 任意文本。 */
export function 读(path, out = _print) {
  if (path === '-') return [读标准输入(), '标准输入']
  const raw = readFileSync(path)
  // Python：`raw.decode("utf-8", "replace")` —— Node 的 `toString('utf8')` 同样是「坏字节换 U+FFFD」。
  const 文本 = raw.toString('utf8')
  const 低 = String(path).toLowerCase()
  if (低.endsWith('.json')) {
    let doc
    try {
      doc = JSON.parse(文本)
    } catch (exc) {
      throw new LintError(`这个 .json 读不出来：${_exc文字(exc)}`)
    }
    if (_是字典(doc) && doc.format === 'eleckoi.character-card') return [_从卡(doc), path]
    return [文本, path]
  }
  if (低.endsWith('.yaml') || 低.endsWith('.yml')) {
    // Python 这里是 `try: import yaml / except ImportError: return 文本, path` —— JS 是静态导入，
    // 那条支路不可达（记号 6），行为一致。
    const doc = 解析YAML(文本)
    if (_是字典(doc) && ('library' in doc || 'character' in doc)) {
      const 正文 = _从稿(doc)
      return [或(正文, 文本), path]
    }
  }
  return [文本, path]
}

/** `-` 支路：Python 是 `sys.stdin.read()`。 */
function 读标准输入() {
  return readFileSync(0, 'utf8')
}

// ── 报告 ────────────────────────────────────────────────────────────────

export class LintError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LintError'
  }
}

/**
 * 单轮=null 时自动判：≤2000 汉字当「一轮正文」，用硬判据；超过就只报密度。
 *
 * 为什么要有这个分叉：那三条硬判据是**按一轮输出**标定的（破折号 0 处 / 对立句式 ≤1 次）。
 * 拿它去量一张五十七万字的整卡，数字会大到没有意义 —— 实测艾瑟兰实卡：破折号 4706 处、
 * 对立句式 590 次，那是长篇的常态，不是毛病。硬指标只对短文本生效，长文本一律降级成密度参考。
 */
export function 体检(文本, out = _print, 标题 = '正文体检', 单轮 = null) {
  const 字 = (String(文本).match(汉字单) || []).length
  const 千字 = 字 ? 字 / 1000.0 : 0.0
  const 是单轮 = (单轮 === null || 单轮 === undefined) ? 字 <= 2000 : 单轮
  const 冒号 = 查提示冒号(文本)
  const 对立 = 查对立句(文本)
  const 破 = 查破折号(文本)
  const 序数 = 查段首序数(文本)
  const 同构 = 查相邻同构(文本)
  const 排比 = 查排比(文本)
  const 密度 = 千字 ? 序数.length / 千字 : 0.0

  const 不过 = []
  if (pyTruthy(是单轮)) {
    if (pyTruthy(冒号)) 不过.push(`提示冒号＋空行接列表 ${冒号.length} 处`)
    if (对立.length > 1) 不过.push(`对立句式 ${对立.length} 次（限 1）`)
    if (pyTruthy(破)) 不过.push(`破折号 ${破.length} 处`)
  }

  out('='.repeat(66))
  out(`${标题} · 共 ${字} 汉字 · ${pyTruthy(是单轮) ? '按一轮正文判' : '长文本，只报密度'}`)
  out('='.repeat(66))

  const 行 = (名, ok, 详情) => out(`  ${ok ? '✔' : '✗'} ${名}  ${详情}`)
  const 密度_k = (n) => (千字 ? n / 千字 : 0.0)

  行('提示冒号＋空行接列表', !pyTruthy(冒号),
    pyTruthy(冒号) ? `${冒号.length} 处 · ${_f2(密度_k(冒号.length))}/千字` : '无')
  for (const [n, s] of 冒号.slice(0, 5)) out(`       第 ${n} 行：${s}`)
  行('对立句式', pyTruthy(是单轮) ? 对立.length <= 1 : true,
    `${对立.length} 次 · ${_f2(密度_k(对立.length))}/千字（一轮限 1 次）`)
  for (const 对 of 对立.slice(0, 3)) out(`       ${对[1]}`)
  行('破折号', pyTruthy(是单轮) ? !pyTruthy(破) : true,
    pyTruthy(破) ? `${破.length} 处 · ${_f2(密度_k(破.length))}/千字` : '无')
  行('段首序数词', 密度 <= 0.19, `${_f3(密度)}/千字（限 0.19）· ${序数.length} 处`)
  const 句数 = _句(文本).length || 1
  行('相邻句同构', true, `${同构.length} 处 · ${_f1(100.0 * 同构.length / 句数)}/百句`)
  行('三句排比', true, `${排比.length} 处`)
  out('-'.repeat(66))
  if (pyTruthy(不过)) {
    out(`  硬判据不过：${不过.join(' · ')}`)
    out('  改法：把那句拆成两句口语、或换个说法 —— 别加词，加词只会更像模板。')
  } else if (pyTruthy(是单轮)) {
    out('  三条硬判据全过。')
  } else {
    out('  长文本：硬阈值（破折号 0 处／对立句 ≤1 次）按一轮标定，整卡不适用，')
    out('  上面给的是密度参考 —— 要判一轮写得好不好，把那一轮单独丢进来查。')
  }
  return 不过
}

export function 打标准(out = _print) {
  out('='.repeat(66))
  out('正文体检 · 判据表（2026-10-15 调研定版）')
  out('='.repeat(66))
  for (const [档, 名, 说明, 限] of 标准) {
    out(`  [${档}] ${_ljust(名, 14)} ${_ljust(限, 10)} ${说明}`)
  }
  out('-'.repeat(66))
  out('  为什么不查词：「淡淡」「缓缓」「一丝」这类在正常中文里天天见，')
  out('  一刀切会大量误伤，而且换个题材（西幻换都市）词表就失效。')
  out('  所以只查句式骨架。具体判据：`python forge.py lint --标准`。')
}

// ── CLI ─────────────────────────────────────────────────────────────────

export function _opt(argv, names) {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (names.includes(a) && i + 1 < argv.length) return argv[i + 1]
  }
  return null
}

export function main(argv, out = _print) {
  if (!argv || argv.length === 0 || argv[0] === '--标准' || argv[0] === '--rules') {
    打标准(out)
    return 0
  }
  const src = argv[0]
  const [正文, 名] = 读(src, out)
  const 不过 = 体检(正文, out, `正文体检 · ${名}`)
  const dst = _opt(argv, ['-o', '--out'])
  if (pyTruthy(dst)) {
    const 行 = []
    体检(正文, (s) => 行.push(s), `正文体检 · ${名}`)
    // Python：`io.open(dst, "w", encoding="utf-8", newline="\n")` ⇒ 原样写 `\n`，不做换行翻译。
    writeFileSync(dst, 行.join('\n') + '\n', 'utf8')
    out(`  报告 → ${dst}`)
    return pyTruthy(不过) ? 1 : 0
  }
  return pyTruthy(不过) ? 1 : 0
}
