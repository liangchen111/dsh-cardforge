/**
 * forge.manual 的 JS 版 —— 从卡生成两份「看的文档」。
 * ==================================================================
 *
 *     manual  ->  <卡名>.手册.html   给人看：结构、条目全文、变量、正则、体检
 *                  <卡名>.索引.md     给 AI 看：清单与「想改什么动哪里」
 *
 * 为什么要有这两份：
 *     · 卡 JSON 里，条目正文塞在嵌套 JSON 字符串中，人和 AI 都读不动；
 *       spec.yaml 虽然可读，但 3000 行起就没人愿意翻。
 *     · 手册是「交付物」：拿给别人看这张卡有什么，不用他装任何东西。
 *     · 索引是「施工图」：下次要改一张卡时，先看它，再动手。
 *
 * 两份都从同一份 spec 生成，所以永远不会与卡脱节。
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 移植纪律（同 model.mjs / content.mjs / opener.mjs 头上那几条）：**行为照抄，不顺手改**；
 * 能逐字节比的逐字节比。本模块的特殊之处在于它**整篇都在拼字符串**（HTML 与 Markdown），
 * 一个字符跑偏就是几百 KB 的产物跑偏，所以下面重点记下与 `forge/manual.py` 的**已知边界**
 * 与**照抄下来的 Python 语义**：
 *
 *   1. **`%s` 不是 JS 的模板串**（本模块最容易踩、也最隐蔽的一条）。
 *      `manual.py` 通篇是 `"...%s..." % v`，而 Python 的 `%s` 走的是内建 `str(v)`：
 *      `None` 产出字符串 `"None"`。JS 的模板串则把 `null` / `undefined` 变成**空串**。
 *      这不是理论差别 —— 索引表里「位置」「关键词」两列正是 `_cell(...) or "—"` 与
 *      `%s` 混用，条目字段缺一个，Python 出 `None`、模板串出空白，两边产物就不同了。
 *      ⇒ 本模块自备 `_fmt()`（printf 子集：`%s` / `%d`，外加 `%%`），所有 `%s` / `%d`
 *      一律走它，**别图省事改成模板串**。`_fmt` 的 `%s` 叫 `_strPy`，语义就是 Python
 *      的 `str()`（`None` → `'None'`、容器 → `repr()`、`True`/`False` 大写）。
 *
 *   2. **`"{:,}".format(n)` 的千分位不能拿 `toLocaleString()` 顶。**
 *      `_sec_overview` 的两处总数（设定库总字数 / ≈ token）用的是 `"{:,}"`。
 *      `Number.prototype.toLocaleString()` 的分组在个别 ICU 版本下是 NBSP 而不是逗号，
 *      而 Python 的 `"{:,}"` **恒是半角逗号、恒三位一组**。⇒ 手写 `_千分()`。
 *      另：宽度不足四位时 `"{:,}".format(123)` 就是 `"123"`，**不加分隔符**。
 *
 *   3. **`if x:` 一律走 `CONTENT.pyTruthy()`。** 本模块里有十来处 Python 真值判断
 *      （`if loose:` / `if hint:` / `if v["keywords"]:` / `if not rules:`…），
 *      JS 里 `[]`、`{}` 都是真值，直接用 `if (x)` 会让「空分组」「空关键词数组」
 *      走进不该走的分支（例如给一条没有关键词的条目渲染出「关键词 」空标签）。
 *
 *   4. **`_cell()` 的截断按码点，不按 UTF-16 码元。** `manual.py:544` 是
 *      `if limit and len(t) > limit: t = t[:limit-1] + "…"` —— `len` 数码点、切片也按
 *      码点。JS 的 `.length` / `.slice()` 数字元，标题里带一个 emoji 就会多截一位。
 *      ⇒ 走 `CONTENT.lenPy()` 与 `Array.from()` 切片。
 *
 *   5. **`os.path.join` / `dirname` / `basename` / `splitext` 自己写**，理由同 opener.mjs：
 *      `node:path` 的 `join` 会规范化（把混进来的 `/` 统一成 `\`），而 `os.path.join`
 *      只接分隔符、一个字都不动。`_基名` / `_目录名` / `_splitext` 都**两个分隔符都认**
 *      （Windows 上 `/` 也是分隔符），同源实现见 hud.mjs:130 / hud.mjs:141 /
 *      bridge.mjs:340（那边是导出的，这里按本模块用到的取一份、不导出）。
 *
 *   6. **`ydump` 在 JS 侧是明确抛错的**（见 model.mjs:148）⇒ 本模块**一个字都不写 YAML**，
 *      它本来也只产出 `.手册.html` 与 `.索引.md`；落盘统一走 `_write()`（UTF-8、`\n`）。
 *
 *   7. **`sorted(..., key=lambda i: order.get(i.level, 3))` 是稳定排序。**
 *      `_sec_health` 与 `_render_index` 的「体检」段都按 level 排。JS 的 `Array.sort`
 *      自 ES2019 起也是稳定的，直接 `sort` 即可；但**必须比同一份「越界给 3」的键**
 *      （`order.get(level, 3)` 与 `{"ERROR":0,...}[level]` 两种写法在 `_sec_health`
 *      与 `_render_index` 里**不一样**：前者缺键兜 3、后者缺键直接 KeyError）。
 *      照抄：`_sec_health` 兜底、`_render_index` 抛。
 *
 *   8. **`_sec_domains()` 里 Python 是函数内 `from . import domain as D`**，
 *      JS 的顶层 `import` 与它等价（domain.mjs 只 import model.mjs），照抄成顶层 import。
 *
 *   9. **`out=print` 用回调收口。** Python 的 `out(文本)` 是逐行 `print`；JS 侧签名照抄成
 *      `out = _print`（content.mjs:225 那支，写 stdout + `\n`）。差分靠传自己的收集器
 *      去抓这三行，跟 Python 用 `redirect_stdout` 抓 `print` 对齐。
 *
 *  10. **零依赖**：只 import `node:` 内建与本仓库同级 `.mjs`（model / pack / validate /
 *      domain / content），没有 npm、没有 package.json。
 *
 *  11. **「数码点」这条比第 4 条更宽 —— 差分台真的抓到过两处漏网**（2026-10-16）：
 *      · `_render_index` 条目表那个「字数」列（`manual.py:512` 的 `len(str(content))`）
 *        起初写成 `.length`，正文里那个 😀 让 127 变成 128 ⇒ **索引 sha1 就对不上**；
 *      · `M.estTokens()`（model.mjs:220）里 `cjk + (len(text)-cjk)/3.6` 的分母同样数码点，
 *        起初写成 `s.length - cjk` ⇒ 手册里「≈token」列 8 变 10。
 *      ⇒ 凡 `len(...)` 的地方一律 `CONTENT.lenPy()` / `Array.from(s).length`，没有例外。
 *      另外 `_tokens()` 的输出列在这两个模块里都出现过，改一处别忘另一处。
 *
 *  12. **harness 侧另有一条与本模块无关、但会让「产物指纹」假红的坑**：出黄金.py 的
 *      `_指纹()` 里 `p = Path(v)`，而 `pathlib.Path` 在 Windows 上会把路径里的 `/`
 *      **规范化成 `\`**（`os.path.join` 不会）。`_default_dir` 出来的「反斜杠 + 调用方给的
 *      正斜杠」混写路径正好落在这条上 ⇒ 比一比.mjs 里补了 `_Path文()` 才对齐（差分台的事，
 *      不是本模块的行为）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './model.mjs'
import * as P from './pack.mjs'
import * as V from './validate.mjs'
import * as D from './domain.mjs'
import * as CONTENT from './content.mjs'

// ------------------------------------------------------------------ Python 语义小工具
// 这一组与 content.mjs / opener.mjs 头上那组同源，按本模块用到的再取一份。

/** Python 的 `str(v)`（容器走 `repr()` —— `str(['a'])` 就是 `['a']`）。 */
function _strPy(v) {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'object') return M.pyRepr(v)
  return CONTENT.pyStr(v)
}

/**
 * Python 的 `"%s" % v` —— 与 `_strPy` 同一件事。
 * ★ 别拿它顶 JS 的 `String(v)`：`String(null)` 是 `"null"`、`String(undefined)` 是
 *   `"undefined"`，而 Python 两头都是 `"None"`。
 */
const _sPy = (v) => _strPy(v)

/** `os.path.join` —— 只接分隔符，一个字都不规范化（别用 `node:path` 的 `join`）。 */
function _join(...段s) {
  let 串 = ''
  for (const 段 of 段s) {
    const b = String(段)
    if (b === '') continue                       // Python 3.12+ 忽略空段
    if (串 === '' || b.startsWith('/') || b.startsWith('\\')) 串 = b
    else if (串.endsWith('/') || 串.endsWith('\\')) 串 += b
    else 串 += '\\' + b
  }
  return 串
}

/**
 * `os.path.basename` —— **Windows 上 `/` 和 `\` 都是分隔符**，别用 `node:path` 的
 * `basename`（它只认平台那一个）。同源实现见 hud.mjs:130。
 */
function _基名(p) {
  let s = String(p)
  while (s.length > 1 && (s.endsWith('/') || s.endsWith('\\'))) s = s.slice(0, -1)
  let i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i >= 0) s = s.slice(i + 1)
  // Windows 的盘符根（`E:` / `E:\`）：basename 给空串
  if (/^[A-Za-z]:$/.test(s)) return ''
  return s
}

/** `os.path.dirname` —— 同 `_基名`，两个分隔符都认。同源实现见 hud.mjs:141。 */
function _目录名(p) {
  const s = String(p)
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i < 0) return ''
  let d = s.slice(0, i)
  if (/^[A-Za-z]:$/.test(d)) d += '\\'
  return d
}

/** `os.path.splitext`（前导点不算扩展名）。同源实现见 bridge.mjs:340。 */
function _splitext(p) {
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

/**
 * `html.escape(str(s if s is not None else ""))` —— 默认 `quote=True`。
 *
 * ★ 五个字符的替身逐个对齐 CPython 的 `html.escape`：`&`→`&amp;` · `<`→`&lt;` ·
 *   `>`→`&gt;` · `"`→`&quot;` · `'`→`&#x27;`（**`'` 是十六进制小写 27**，不是 `&#39;`）。
 *   手册正文里到处是中文单引号「」与裸 `'`，替错一个整份 HTML 就逐字节不同。
 * ★ 注意这里**先** `str()` **再**转义（不是反过来），且 `None` 先变成空串 —— 因为
 *   Python 那一行写的是 `s if s is not None else ""`。
 */
function _esc(s) {
  const t = (s === null || s === undefined) ? '' : _strPy(s)
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

/** 正文里的换行在 HTML 里靠 pre-wrap 保留，这里只做转义。 */
function _nl(s) {
  return _esc(s)
}

/** Python 的 `"{:,}".format(n)` —— 半角逗号、三位一组，别用 `toLocaleString()`。 */
function _千分(n) {
  const s = String(n)
  const neg = s.startsWith('-')
  const body = neg ? s.slice(1) : s
  let out = ''
  for (let i = 0; i < body.length; i += 1) {
    if (i > 0 && (body.length - i) % 3 === 0) out += ','
    out += body[i]
  }
  return neg ? '-' + out : out
}

/**
 * Python 的 printf 子集（本模块只用得到 `%s` / `%d` 与 `%%`）。
 *
 * ★ 为什么非写不可：见文件头「移植记号 1」。`%s` 走 `_strPy`（`None` → `'None'`）、
 *   `%d` 按整数截断（Python 的 `%d` 对 3.9 给 `3`）。
 */
function _fmt(tpl, ...args) {
  let i = 0
  return String(tpl).replace(/%([sd%])/g, (m, c) => {
    if (c === '%') return '%'
    if (i >= args.length) return m
    const a = args[i]
    i += 1
    if (c === 'd') return String(Math.trunc(Number(a)))
    return _strPy(a)
  })
}

/** token 估算：`M.est_tokens(str(text or ""))`。 */
function _tokens(text) {
  return M.estTokens(_szPyOrEmpty(text))
}

/** `str(text or "")` —— 空真值的输入产出空串（`_tokens` 与 `_sec_*` 都用它）。 */
function _szPyOrEmpty(text) {
  return CONTENT.pyTruthy(text) ? _strPy(text) : ''
}

const _print = (s = '') => { process.stdout.write(String(s) + '\n') }

// ------------------------------------------------------------------ 取数

/**
 * 读 spec.yaml 或 card.json，返回 `[card, 是否来自 spec]`。
 * （Python 是 tuple，JS 侧照规矩落成 Array。）
 */
export function load_card(path) {
  if (M.isYaml(path)) {
    return [P.spec_to_card(path), true]
  }
  return [M.jload(path), false]
}

/** 把手册/索引需要的一切收进一个上下文 dict。 */
export function gather(path) {
  const [card, from_spec] = load_card(path)
  const lib = P.active_library(card)
  const var_ = P.active_variables(card)
  const entries = 或(取(lib, 'entries', null), [])
  const groups = 或(取(lib, 'groups', null), [])
  const objects = 或(取(var_, 'objects', null), [])
  const variables = 或(取(var_, 'variables', null), [])
  const regex_rules = 或(取(card, 'regex_rules', null), [])
  const char = 或(取(card, 'character', null), {})
  const name = _strPy(或(取(char, 'name', null), '')).trim() ||
    _splitext(_基名(path))[0].replace('.spec', '')

  const gname = {}
  for (const g of groups) gname[取(g, 'id', null)] = _strPy(或(取(g, 'name', null), ''))
  const oname = {}
  for (const o of objects) oname[取(o, 'id', null)] = _strPy(或(取(o, 'name', null), ''))

  const const_ = entries.filter((e) => 取(e, 'trigger_mode', 'always') === 'always' &&
    取(e, 'kind', null) !== 'opening')
  // ★ `len()` 按**码点**：JS 的 `.length` 把星平面字符（emoji）算 2 —— 正文里有一个就直接跑偏。
  const total_chars = entries.reduce((n, e) => n + CONTENT.lenPy(_strPy(或(取(e, 'content', null), ''))), 0)
  const const_chars = const_.reduce((n, e) => n + CONTENT.lenPy(_strPy(或(取(e, 'content', null), ''))), 0)

  return {
    card,
    from_spec,
    name,
    character: char,
    entries,
    groups,
    objects,
    variables,
    regex_rules,
    gname,
    oname,
    const: const_,
    const_chars,
    total_chars,
    issues: V.validate_card(card, name),
  }
}

/** `x.get(k, d)`（Python 的 dict.get：键在就给值，哪怕值是 None）。 */
function 取(o, k, d) {
  return o !== null && typeof o === 'object' && k in o ? o[k] : d
}

/** `a or b`（Python 真值）。 */
function 或(a, b) {
  return CONTENT.pyTruthy(a) ? a : b
}

/**
 * Python 的 `for x in v` —— **字符串也是可迭代的，而且逐「码点」迭代**。
 *
 * ★ 这条不是洁癖：`manual.py` 里 `"、".join(str(t) for t in (r.get("targets") or []))`
 *   与 `for k in e["keywords"][:8]` 都直接迭代字段值，而 spec 里 `targets: content`
 *   是个**裸标量**（字符串），Python 就老老实实逐字符拼出 `c、o、n、t、e、n、t`。
 *   JS 的 `.map()` 只长在数组上 ⇒ 直接 `TypeError: ....map is not a function`。
 *   ⇒ 凡「Python 迭代一个字段值」的地方一律先过它。
 *
 * 字典按 Python 的语义迭代**键**（与 `for k in d` 一致）。
 */
function _列(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return Array.from(v)
  if (v !== null && typeof v === 'object') return Object.keys(v)
  if (v === null || v === undefined) return []
  throw new TypeError(`'${typeof v}' object is not iterable`)
}

// ------------------------------------------------------------------ 通用小件

/** 触发方式的小标签。 */
export function _trig_tag(e) {
  if (!CONTENT.pyTruthy(取(e, 'enabled', true))) {
    return '<span class="tag off">已禁用</span>'
  }
  if (取(e, 'kind', null) === 'opening') {
    return '<span class="tag always">开场白</span>'
  }
  const t = 取(e, 'trigger_mode', 'always')
  if (t === 'always') {
    return '<span class="tag always">常驻</span>'
  }
  const s = 取(e, 'agent_read_strategy', 'normal')
  if (s === 'keyword') {
    return '<span class="tag kw">关键词</span>'
  }
  if (s === 'required') {
    return '<span class="tag kw">必读</span>'
  }
  return '<span class="tag agent">按需</span>'
}

/** 中转导出：差分语料要直接撞 `_esc` / `_cell` / `_write` 这些内部件。 */
export { _esc, _nl, _tokens, _fmt, _千分, _join, _基名, _目录名, _splitext }

// ------------------------------------------------------------------ CSS

export const CSS = `
:root{
  --ink:#2f2a22; --ink2:#6b6152; --ink3:#9a8f7c;
  --line:rgba(120,94,52,.26); --line2:rgba(120,94,52,.14);
  --bg:#faf6ee; --card:#fffdf8; --accent:#8d2a22; --gold:#ad8527;
  --err:#a01a10; --warn:#8a6410; --info:#5b6b7a;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.layout{display:flex;align-items:flex-start;max-width:1400px;margin:0 auto;gap:28px;padding:28px}
nav{position:sticky;top:28px;flex:0 0 196px;padding:16px;border:1px solid var(--line);
  border-radius:8px;background:var(--card);font-size:13.5px}
nav h4{margin:0 0 10px;font-size:12px;letter-spacing:.18em;color:var(--ink3);font-weight:700}
nav a{display:block;padding:4px 0;color:var(--ink2)}
nav a:hover{color:var(--accent)}
main{flex:1;min-width:0}
header{border-bottom:2px solid var(--line);padding-bottom:18px;margin-bottom:26px}
h1{margin:0 0 6px;font-size:27px;letter-spacing:.03em}
h1 .sub{font-size:14px;color:var(--ink3);font-weight:400;letter-spacing:0;margin-left:10px}
section{margin:0 0 40px;scroll-margin-top:20px}
h2{font-size:18px;margin:0 0 14px;padding-bottom:7px;border-bottom:1px solid var(--line);letter-spacing:.05em}
h2 .n{color:var(--gold);font-weight:700;margin-right:8px}
h3{font-size:14.5px;margin:22px 0 9px;color:var(--ink2);letter-spacing:.06em}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 0}
.stat{flex:0 0 auto;padding:9px 15px;border:1px solid var(--line);border-radius:7px;background:var(--card)}
.stat b{display:block;font-size:21px;line-height:1.25;color:var(--accent)}
.stat span{font-size:11.5px;color:var(--ink3);letter-spacing:.1em}
table{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--card);
  border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:7px 11px;border-bottom:1px solid var(--line2);vertical-align:top}
th{background:rgba(120,94,52,.07);font-weight:700;font-size:12.5px;letter-spacing:.06em;color:var(--ink2);white-space:nowrap}
tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tag{display:inline-block;padding:0 7px;border-radius:4px;font-size:11.5px;line-height:18px;white-space:nowrap}
.tag.always{background:rgba(173,133,39,.16);color:#7a5c10}
.tag.agent{background:rgba(90,110,130,.15);color:#4c5c6b}
.tag.kw{background:rgba(141,42,34,.12);color:var(--accent)}
.tag.off{background:rgba(0,0,0,.07);color:var(--ink3)}
details{border:1px solid var(--line);border-radius:8px;background:var(--card);margin:0 0 9px;overflow:hidden}
details>summary{cursor:pointer;padding:9px 13px;font-size:13.5px;list-style:none;display:flex;gap:10px;align-items:baseline}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"▸";color:var(--gold);flex:0 0 auto}
details[open]>summary::before{content:"▾"}
details>summary .t{font-weight:700;flex:0 0 auto}
details>summary .g{color:var(--ink3);font-size:12px;margin-left:auto;white-space:nowrap}
.body{padding:2px 15px 15px;border-top:1px dashed var(--line2)}
.body pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;
  font:13px/1.8 inherit;color:var(--ink);background:transparent;padding:0}
.hint{margin:9px 0 0;padding:6px 10px;border-left:2px solid var(--gold);
  background:rgba(173,133,39,.07);font-size:12.5px;color:var(--ink2)}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.meta code{font-size:11.5px;color:var(--ink2);background:rgba(120,94,52,.08);
  padding:1px 6px;border-radius:4px;font-family:ui-monospace,Consolas,monospace}
.issue{padding:7px 12px;border-left:3px solid;border-radius:0 6px 6px 0;margin:0 0 7px;
  font-size:13px;background:var(--card);border-top:1px solid var(--line2);
  border-right:1px solid var(--line2);border-bottom:1px solid var(--line2)}
.issue.ERROR{border-left-color:var(--err)}
.issue.WARN{border-left-color:var(--warn)}
.issue.INFO{border-left-color:var(--info)}
.issue .lv{font-weight:700;font-size:11.5px;letter-spacing:.08em;margin-right:8px}
.issue.ERROR .lv{color:var(--err)} .issue.WARN .lv{color:var(--warn)} .issue.INFO .lv{color:var(--info)}
.issue .fx{color:var(--ink2);font-size:12.5px}
.issue .cd{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--ink3)}
.empty{color:var(--ink3);font-size:13px;padding:8px 0}
footer{margin:40px 0 0;padding-top:14px;border-top:1px solid var(--line);
  font-size:12px;color:var(--ink3)}
@media(max-width:900px){.layout{flex-direction:column}nav{position:static;width:100%;flex:auto}}
`

// ------------------------------------------------------------------ HTML 手册

/**
 * 默认把手册/索引放在哪儿。
 *
 * spec 住在 `<工程>/source/` 下就是一张工程，往后一律落在 `<工程>/文档/`
 * （那是这类派生物该待的地方）；否则就摆在输入文件旁边。
 */
export function _default_dir(path) {
  const here = _目录名(resolve(path))
  if (_基名(here) === 'source') {
    const docs = _join(_目录名(here), '文档')
    mkdirSync(docs, { recursive: true })
    return docs
  }
  return here
}

/** 生成 `<卡名>.手册.html`。 */
export function build_manual(path, out_path = null, out = _print) {
  const ctx = gather(path)
  out_path = out_path || _join(_default_dir(path), _fmt('%s.手册.html', ctx.name))
  _write(_render_html(ctx), out_path)

  const s = V.summarize(ctx.card)
  const errs = ctx.issues.filter((i) => i.level === 'ERROR').length
  out(_fmt('已生成手册 -> %s', out_path))
  out(_fmt('  条目 %d · 分组 %d · 变量 %d · 对象 %d · 正则 %d',
    s.entries, s.groups, s.variables, s.objects, s.regex))
  out(_fmt('  体检：%d 错 · %d 警告',
    errs, ctx.issues.filter((i) => i.level === 'WARN').length))
  return out_path
}

/** 整份手册 HTML。 */
export function _render_html(c) {
  const name = c.name
  const s = V.summarize(c.card)
  return (
    '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    _fmt('<title>%s · 卡片手册</title>\n<style>%s</style>\n</head>\n<body>\n', _esc(name), CSS) +
    _fmt('<div class="layout">%s<main>%s%s%s%s%s%s%s</main></div>\n</body>\n</html>\n',
      _nav(c), _head(c, s), _sec_overview(c, s),
      _sec_entries(c), _sec_vars(c), _sec_regex(c), _sec_domains(), _sec_health(c))
  )
}

/** 左侧目录。 */
export function _nav(c) {
  const items = [['overview', '总览'], ['entries', '条目清单'],
    ['vars', '变量'], ['regex', '正则'], ['domains', '平台真值域'],
    ['health', '体检']]
  const links = items.map(([i, t]) => _fmt('<a href="#%s">%s</a>', i, t)).join('')
  return _fmt('<nav><h4>目录</h4>%s<h4 style="margin-top:14px">构成</h4>' +
    '<a href="#entries">条目 %d</a><a href="#vars">变量 %d</a>' +
    '<a href="#regex">正则 %d</a></nav>',
  links, c.entries.length, c.variables.length, c.regex_rules.length)
}

/** 页头（年龄/性别/身高有哪样拼哪样）。 */
export function _head(c, s) {
  const char = c.character
  const prof = [['年龄', 'profile_age'], ['性别', 'profile_sex'],
    ['身高', 'profile_height']]
    .filter(([, v]) => _strPy(或(char ? char[v] : null, '')).trim())
    .map(([k, v]) => _fmt('%s %s', k, char[v]))
    .join(' · ')
  const sub = CONTENT.pyTruthy(prof) ? _fmt('<span class="sub">%s</span>', _esc(prof)) : ''
  const src = c.from_spec ? '由规格文件编译' : '直接读卡'
  return _fmt('<header><h1>%s%s</h1>' +
    '<div style="color:var(--ink3);font-size:13px">ElecKoi 角色卡手册 · %s</div>' +
    '</header>', _esc(c.name), sub, src)
}

/** 第 1 节：总览。 */
export function _sec_overview(c, s) {
  const stats = [
    [s.entries, '条目'], [s.groups, '分组'],
    [s.const, '常驻条目'], [s.variables, '变量'],
    [s.regex, '正则'],
    [_千分(c.total_chars), '设定库总字数'],
    [_千分(_tokens('x'.repeat(c.total_chars))), '≈ token'],
  ]
  const boxes = stats.map(([a, b]) => _fmt('<div class="stat"><b>%s</b><span>%s</span></div>', a, b)).join('')
  let warn = ''
  if (c.const_chars > V.CONST_CHARS_LIMIT) {
    warn = _fmt('<div class="issue WARN" style="margin-top:18px">' +
      '<span class="lv">注意</span>常驻条目合计 %d 字，超过护栏 %d 字。' +
      '常驻每轮都进提示，字数就是成本 —— 这是最值得先动的一处。' +
      '</div>', c.const_chars, V.CONST_CHARS_LIMIT)
  }
  return _fmt('<section id="overview"><h2><span class="n">1</span>总览</h2>' +
    '<div class="stats">%s</div>%s</section>', boxes, warn)
}

/** 第 2 节：条目清单（分组树 + 全部条目表 + 逐条详情）。 */
export function _sec_entries(c) {
  const entries = c.entries, gname = c.gname
  // 分组树
  const rows = []
  const by_group = {}
  for (const e of entries) {
    const k = 或(取(e, 'group_id', null), '')
    if (!(k in by_group)) by_group[k] = []
    by_group[k].push(e)
  }
  for (const g of c.groups) {
    const gid = 取(g, 'id', null)
    const kids = by_group[gid] || []
    rows.push(_fmt('<tr><td><b>%s</b></td><td class="num">%d</td><td>%s</td></tr>',
      _esc(取(g, 'name', null)), kids.length,
      _esc(kids.slice(0, 4).map((k) => Array.from(_strPy(取(k, 'title', null))).slice(0, 16).join('')).join('、') +
        (kids.length > 4 ? '…' : ''))))
  }
  const loose = by_group[''] || []
  if (CONTENT.pyTruthy(loose)) {
    rows.push(_fmt('<tr><td><b>（未分组）</b></td><td class="num">%d</td>' +
      '<td>%s</td></tr>',
    loose.length, _esc(loose.slice(0, 4).map((k) => Array.from(_strPy(取(k, 'title', null))).slice(0, 16).join('')).join('、'))))
  }
  const group_table = '<h3>分组</h3><table><tr><th>分组</th><th>条目数</th><th>包含</th></tr>' +
    rows.join('') + '</table>'

  // 清单表
  const trs = []
  entries.forEach((e, i) => {
    const title = _strPy(或(取(e, 'title', null), '(无标题)'))
    const n = CONTENT.lenPy(_strPy(或(取(e, 'content', null), '')))
    const kw = 或(取(e, 'keywords', null), []).length
    trs.push(_fmt('<tr><td class="num">%d</td><td>%s</td><td>%s</td><td>%s</td>' +
      '<td class="num">%s</td><td class="num">%d</td>' +
      '<td class="num">%d</td><td class="num">%d</td></tr>',
    i + 1, _esc(title), _trig_tag(e),
    _esc(或(gname[取(e, 'group_id', null)], '') || '—'),
    _esc(取(e, 'agent_read_strategy', '')), kw,
    n, _tokens(取(e, 'content', null))))
  })
  const list_table =
    '<h3>全部条目</h3><table>' +
    '<tr><th>#</th><th>标题</th><th>触发</th><th>分组</th><th>策略</th>' +
    '<th>键</th><th>字数</th><th>≈token</th></tr>' +
    trs.join('') + '</table>'

  // 详情
  const details = []
  entries.forEach((e, i) => {
    const title = _strPy(或(取(e, 'title', null), '(无标题)'))
    const hint = _strPy(或(取(e, 'agent_selection_hint', null), ''))
    const metas = []
    if (取(e, 'trigger_mode', 'always') === 'always') {
      metas.push(_fmt('位置 %s', 或(取(e, 'position', null), '（空！会被过滤）')))
    }
    metas.push(_fmt('角色 %s', 取(e, 'insert_role', 'user')))
    if (CONTENT.pyTruthy(取(e, 'keywords', null))) {
      metas.push('关键词 ' + _列(e.keywords).slice(0, 8).map((k) => _strPy(k)).join('、'))
    }
    if (取(e, 'order', null) !== null && 取(e, 'order', null) !== undefined) {
      metas.push(_fmt('order %s', e.order))
    }
    const mh = metas.map((m) => _fmt('<code>%s</code>', _esc(m))).join('')
    const hh = CONTENT.pyTruthy(hint) ? _fmt('<div class="hint">什么时候读我：%s</div>', _esc(hint)) : ''
    details.push(_fmt('<details><summary><span class="t">%d. %s</span>%s' +
      '<span class="g">%d 字</span></summary>' +
      '<div class="body"><div class="meta">%s</div>%s<pre>%s</pre></div></details>',
    i + 1, _esc(title), _trig_tag(e),
    CONTENT.lenPy(_strPy(或(取(e, 'content', null), ''))), mh, hh,
    _nl(或(取(e, 'content', null), ''))))
  })

  return _fmt('<section id="entries"><h2><span class="n">2</span>条目清单</h2>' +
    '%s%s<h3>正文（点标题展开）</h3>%s</section>',
  group_table, list_table, details.join(''))
}

/** 第 3 节：变量。 */
export function _sec_vars(c) {
  const objs = c.objects, vars_ = c.variables
  if (!CONTENT.pyTruthy(vars_) && !CONTENT.pyTruthy(objs)) {
    return '<section id="vars"><h2><span class="n">3</span>变量</h2>' +
      '<div class="empty">这张卡没有变量。变量用来让卡记住状态' +
      '（数值、开关、背包……），不变量化的卡也可以很完整。</div></section>'
  }
  const blocks = []
  const by_obj = {}
  for (const v of vars_) {
    const k = 或(取(v, 'object_id', null), '')
    if (!(k in by_obj)) by_obj[k] = []
    by_obj[k].push(v)
  }
  for (const o of objs) {
    const oid = 取(o, 'id', null)
    const kids = by_obj[oid] || []
    const desc = _strPy(或(取(o, 'description', null), ''))
    const rowsh = kids.map((v) => _fmt('<tr><td>%s</td><td><code>%s</code></td><td><code>%s</code></td>' +
      '<td>%s</td><td>%s</td></tr>',
    _esc(取(v, 'title', null)), _esc(取(v, 'type', null)), _esc(取(v, 'default_value', null)),
    _esc(取(v, 'read_mode', null)), _esc(取(v, 'description', null)))).join('')
    const tbl = CONTENT.pyTruthy(kids)
      ? '<table><tr><th>变量</th><th>类型</th><th>默认</th><th>读取</th><th>说明</th></tr>' +
        rowsh + '</table>'
      : '<div class="empty">（无变量）</div>'
    blocks.push(_fmt('<h3>%s <span style="color:var(--ink3);font-weight:400">%d 项</span>' +
      '</h3>%s%s',
    _esc(取(o, 'name', null)), kids.length,
    CONTENT.pyTruthy(desc) ? _fmt('<div class="empty" style="padding:0 0 6px">%s</div>', _esc(desc)) : '', tbl))
  }
  const orphan = by_obj[''] || []
  if (CONTENT.pyTruthy(orphan)) {
    blocks.push('<h3>（未挂到对象）</h3>' +
      orphan.map((v) => _fmt('<div class="empty">%s（%s）</div>',
        _esc(取(v, 'title', null)), _esc(取(v, 'type', null)))).join(''))
  }
  return _fmt('<section id="vars"><h2><span class="n">3</span>变量（%d 个对象 / %d 项）</h2>' +
    '%s</section>', objs.length, vars_.length, blocks.join(''))
}

/** 第 4 节：正则。 */
export function _sec_regex(c) {
  const rules = c.regex_rules
  if (!CONTENT.pyTruthy(rules)) {
    return '<section id="regex"><h2><span class="n">4</span>正则</h2>' +
      '<div class="empty">这张卡没有正则。正则用来把正文里的记号' +
      '（如 〔骰·…〕）渲成视觉块，或做文本替换。</div></section>'
  }
  const trs = []
  rules.forEach((r, i) => {
    const pat = _strPy(或(取(r, 'pattern', null), ''))
    const rep = _strPy(或(取(r, 'replacement', null), ''))
    trs.push(_fmt('<tr><td class="num">%d</td><td>%s</td><td class="num">%s</td>' +
      '<td>%s</td><td class="num">%d</td><td class="num">%d</td>' +
      '<td>%s</td></tr>',
    i + 1, _esc(取(r, 'name', null)), _esc(取(r, 'order', null)),
    _esc(_列(或(取(r, 'targets', null), [])).map((t) => _strPy(t)).join('、')),
    CONTENT.lenPy(pat), CONTENT.lenPy(rep),
    _esc(取(r, 'enabled', true) ? '开' : '关')))
  })
  return _fmt('<section id="regex"><h2><span class="n">4</span>正则（%d 条）</h2>' +
    '<div class="empty" style="padding-bottom:8px">替换是「order 小的先认走」——' +
    '更具体的排前面，兜底的排最后。</div>' +
    '<table><tr><th>#</th><th>名称</th><th>order</th><th>作用对象</th>' +
    '<th>模式字数</th><th>替换字数</th><th>状态</th></tr>%s</table></section>',
  rules.length, trs.join(''))
}

/** 第 5 节：平台真值域（从 domain.mjs 现读，保证与校验器同一份表）。 */
export function _sec_domains() {
  const trs = []
  for (const [nm, dom] of Object.entries(D.DOMAINS)) {
    const legacy = Object.entries(dom.legacy || {}).map(([k, v]) => _fmt('%s→%s', k, v)).join('、') || '—'
    trs.push(_fmt('<tr><td><code>%s</code></td><td>%s</td><td><code>%s</code></td>' +
      '<td>%s</td></tr>',
    _esc(nm), dom.values.map((v) => _fmt('<code>%s</code>', _esc(v))).join(' / '),
    _esc(dom.default), _esc(legacy)))
  }
  const dead = Object.entries(D.DEAD_FIELDS)
    .map(([f, w]) => _fmt('<tr><td><code>%s</code></td><td>平台根本不读它 —— %s</td></tr>',
      _esc(f), _esc(w))).join('')
  return _fmt('<section id="domains"><h2><span class="n">5</span>平台真值域</h2>' +
    '<div class="empty" style="padding-bottom:8px">' +
    '这几个字段的值只有下面这些是认的。写别的不会报错 —— ' +
    '平台会把它们<b>静默降级</b>成缺省值，症状是「填了没反应」。' +
    '本工具在打包前会拦住。</div>' +
    '<table><tr><th>字段</th><th>合法值</th><th>缺省</th><th>旧值会被改成</th></tr>' +
    '%s</table>' +
    '<h3>平台不读的字段</h3><table>%s</table></section>',
  trs.join(''), dead)
}

/** 第 6 节：体检。 */
export function _sec_health(c) {
  const issues = c.issues
  if (!CONTENT.pyTruthy(issues)) {
    return '<section id="health"><h2><span class="n">6</span>体检</h2>' +
      '<div class="issue INFO"><span class="lv">通过</span>' +
      '没有发现问题。</div></section>'
  }
  const order = { ERROR: 0, WARN: 1, INFO: 2 }
  const items = [...issues].sort((a, b) =>
    ((a.level in order) ? order[a.level] : 3) - ((b.level in order) ? order[b.level] : 3))
  const blocks = []
  for (const i of items) {
    const fx = CONTENT.pyTruthy(i.fix) ? _fmt('<div class="fx">→ %s</div>', _esc(i.fix)) : ''
    blocks.push(_fmt('<div class="issue %s"><span class="lv">%s</span>' +
      '<span class="cd">%s</span> %s%s</div>',
    i.level, i.level, _esc(i.where), _esc(i.message), fx))
  }
  const n = {}
  for (const k of ['ERROR', 'WARN', 'INFO']) n[k] = issues.filter((i) => i.level === k).length
  return _fmt('<section id="health"><h2><span class="n">6</span>体检</h2>' +
    '<div class="empty" style="padding-bottom:10px">%d 错 · %d 警告 · %d 提示</div>' +
    '%s</section>', n.ERROR, n.WARN, n.INFO, blocks.join(''))
}

// ------------------------------------------------------------------ Markdown 索引

/** 生成 `<卡名>.索引.md`。 */
export function build_index(path, out_path = null, out = _print) {
  const ctx = gather(path)
  out_path = out_path || _join(_default_dir(path), _fmt('%s.索引.md', ctx.name))
  _write(_render_index(ctx), out_path)
  out(_fmt('已生成索引 -> %s', out_path))
  return out_path
}

/** 整份索引 Markdown（**结尾没有换行** —— Python 那边是 `"\\n".join(L)`）。 */
export function _render_index(c) {
  const s = V.summarize(c.card)
  const L = []
  const A = (x) => L.push(x)
  A(_fmt('# %s · 索引', c.name))
  A('')
  A('> 本文件由 `forge index` 从 spec 自动生成，**不要手改**。' +
    '给人看的手册见同名 `.手册.html`。')
  A('')
  A('| 项 | 数 |')
  A('|---|---|')
  A(_fmt('| 条目 | %d |', s.entries))
  A(_fmt('| 分组 | %d |', s.groups))
  A(_fmt('| 常驻条目 | %d（%d 字）|', s.const, c.const_chars))
  A(_fmt('| 变量 | %d（%d 个对象）|', s.variables, s.objects))
  A(_fmt('| 正则 | %d |', s.regex))
  A(_fmt('| 设定库总字数 | %d ≈ %d token |', c.total_chars, _tokens('x'.repeat(c.total_chars))))
  A('')

  A('## 分组')
  A('')
  A('| 组 | 条目数 |')
  A('|---|---|')
  const by_group = {}
  for (const e of c.entries) {
    const k = 或(取(e, 'group_id', null), '')
    if (!(k in by_group)) by_group[k] = []
    by_group[k].push(e)
  }
  for (const g of c.groups) {
    A(_fmt('| %s `%s` | %d |', 取(g, 'name', null), 取(g, 'id', null),
      (by_group[取(g, 'id', null)] || []).length))
  }
  if (CONTENT.pyTruthy(by_group[''])) {
    A(_fmt('| （未分组） | %d |', by_group[''].length))
  }
  A('')

  A('## 条目')
  A('')
  A('| # | 标题 | 触发 | 策略 | 位置 | 关键词 | 字数 | id |')
  A('|---|---|---|---|---|---|---|---|')
  c.entries.forEach((e, i) => {
    let trig
    if (!CONTENT.pyTruthy(取(e, 'enabled', true))) {
      trig = '禁用'
    } else if (取(e, 'kind', null) === 'opening') {
      trig = '开场白'
    } else if (取(e, 'trigger_mode', 'always') === 'always') {
      trig = '常驻'
    } else {
      trig = '按需'
    }
    const kw = _列(或(取(e, 'keywords', null), [])).slice(0, 5).map((k) => _strPy(k)).join('、')
    A(_fmt('| %d | %s | %s | %s | %s | %s | %d | `%s` |',
      i + 1, _cell(取(e, 'title', null)), trig, 取(e, 'agent_read_strategy', ''),
      _cell(取(e, 'position', null)) || '—', _cell(kw) || '—',
      CONTENT.lenPy(_strPy(或(取(e, 'content', null), ''))), 取(e, 'id', '')))
  })
  A('')

  if (CONTENT.pyTruthy(c.variables)) {
    A('## 变量')
    A('')
    A('| 对象 | 变量 | 类型 | 默认 | 读取 | 说明 |')
    A('|---|---|---|---|---|---|')
    for (const v of c.variables) {
      A(_fmt('| %s | %s | `%s` | `%s` | %s | %s |',
        c.oname[取(v, 'object_id', null)] !== undefined ? c.oname[取(v, 'object_id', null)] : '—',
        _cell(取(v, 'title', null)),
        取(v, 'type', null), _cell(取(v, 'default_value', null), 24),
        取(v, 'read_mode', null), _cell(取(v, 'description', null), 40)))
    }
    A('')
  }

  if (CONTENT.pyTruthy(c.regex_rules)) {
    A('## 正则')
    A('')
    A('| # | 名称 | order | 对象 | 状态 |')
    A('|---|---|---|---|---|')
    c.regex_rules.forEach((r, i) => {
      A(_fmt('| %d | %s | %s | %s | %s |',
        i + 1, _cell(取(r, 'name', null)), 取(r, 'order', null),
        _列(或(取(r, 'targets', null), [])).map((t) => _strPy(t)).join('、'),
        取(r, 'enabled', true) ? '开' : '关'))
    })
    A('')
  }

  A('## 想改什么，动哪里')
  A('')
  A('| 想做的事 | 动这里 |')
  A('|---|---|')
  A('| 改某一句话 | 在 `spec.yaml` 里搜条目标题，改它的 `content` |')
  A('| 让某条常驻每轮都进提示 | 该条 `trigger_mode: always`，且 `position` 必须非空 |')
  A('| 让某条按关键词触发 | `trigger_mode: agent_tool` + `agent_read_strategy: keyword` + 填 `keywords` |')
  A('| 让某条由 AI 自己决定读不读 | `agent_read_strategy: normal` + 写实 `agent_selection_hint` |')
  A('| 加一条新条目 | 复制现有条目整块，改 `id` 与 `title`（`id` 必须唯一）|')
  A('| 加一个分组 | `library.groups` 里加一项，条目的 `group_id` 指过去 |')
  A('| 加一个变量 | `variables.objects` 加对象、`variables.variables` 加变量，' +
    '`initial_state` 与 `schema_code` 也要各加一处 |')
  A('| 改完不知道对不对 | `python forge.py check <spec>` |')
  A('')

  A('## 体检')
  A('')
  if (!CONTENT.pyTruthy(c.issues)) {
    A('- ✔ 没有发现问题。')
  } else {
    const order = { ERROR: 0, WARN: 1, INFO: 2 }
    // ★ Python 这儿是 `{"ERROR":0,...}[x.level]` —— **缺键直接 KeyError**，不走兜底。
    //   照抄：未知 level 抛（别静默排到后面去，那会把一条新等级的诊断吞掉）。
    const key = (x) => {
      if (!(x.level in order)) throw new Error(`KeyError: '${x.level}'`)
      return order[x.level]
    }
    for (const i of [...c.issues].sort((a, b) => key(a) - key(b))) {
      A(_fmt('- [%s] `%s` %s：%s%s', i.level, i.code, i.where, i.message,
        CONTENT.pyTruthy(i.fix) ? '　→ ' + i.fix : ''))
    }
  }
  A('')
  return L.join('\n')
}

/**
 * Markdown 表格里的一个格子。
 *
 * ★ `limit` 走 Python 的 `if limit and len(t) > limit` —— `limit=0` / `None` 都不截；
 *   `len` 与 `t[:limit-1]` **按码点**，见文件头「移植记号 4」。
 */
export function _cell(s, limit = null) {
  const t = ((s === null || s === undefined) ? '' : _strPy(s))
    .replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
  if (CONTENT.pyTruthy(limit) && CONTENT.lenPy(t) > limit) {
    return Array.from(t).slice(0, limit - 1).join('') + '…'
  }
  return t
}

/** 落盘：UTF-8、`\n`，父目录不在就建（`os.makedirs(exist_ok=True)`）。 */
export function _write(text, path) {
  const d = _目录名(resolve(path))
  if (CONTENT.pyTruthy(d)) mkdirSync(d, { recursive: true })
  writeFileSync(path, text, { encoding: 'utf8' })
  return path
}
