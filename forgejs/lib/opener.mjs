/**
 * forge.opener 的 JS 版 —— 开场白：改它只有一条正路。
 * ==================================================================
 *
 * 开场白是权重最高的字段（开卡第一屏），但它的**真源不在 spec 里**：在
 * `hud/hud.conf.json` 的 `"开场白" → "正文"`；spec 里那条 `AI角色开场白` 只是派生物，
 * 每次 `hud --写回` 都会拿 conf 的正文覆盖它。改错地方＝改了白改。
 *
 * 更要命的是正文末尾那三个零宽空格（U+200B）：「建卡界面」那条正则
 * `/\\u200B{3}/` 就是靠它触发的 —— **少一个，导入 ElecKoi 后建卡界面静默消失**。
 * 而在 conf 里它写成一串 JSON 转义 `\\u200b\\u200b\\u200b`，手数、手写、手改
 * 都是踩雷的路（数错几个？写成真字符还是转义？）。
 *
 * 所以这个模块只做一件事：让改开场白的人（以及替他动手的 AI）**只说正文是什么**，
 * 标记由这里负责 —— 末尾不多不少，正好三个。
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 移植纪律（同 model.mjs / content.mjs 头上那几条）：**行为照抄，不顺手改**；能逐字节
 * 比的逐字节比。这里到处在拼人话诊断（`"%s"` / `"%d"`）与 `str.rstrip()` 这类边角，
 * 所以下面照抄了 content.mjs 那组「Python 语义小工具」（_str / 或 / 取 / _rstrip …）——
 * 少了它们，报错原文与落盘内容会在边角上悄悄跑偏，而跑偏了差分也抓不住。
 *
 * ★ 本模块有**三处已知的未覆盖边界**（不是 bug，是兄弟模块还没落地／两边语言天生不同）：
 *
 *   1. 内容档的写走 `CONTENT.commit()`：forgejs 的 `content.mjs` 那句 `M.jdump(raw, tmp)`
 *      是计划 §二①**备案过的唯一差异** —— JS 侧把 spec 写成 JSON（JSON 本身是合法 YAML，
 *      PyYAML 读得回来），Python 侧写 YAML。差分比的是**结构**，所以这一支能比。
 *   2. `改正文(..., 写回=true)` 与 `写回()` 的界面档支路要 `HUD.build()`：forgejs 的
 *      `hud.mjs` **还没搬** ⇒ 走这两条支路会抛（见 `_HUD()`）。Python 那边是真的会把卡
 *      写回 spec。**其余分支全部照抄可用。**
 *   3. `_读json()` 的异常类型两边天生不同（Python `json.JSONDecodeError` vs V8
 *      `SyntaxError`，措辞也不一样）—— 差分里别拿坏了 JSON 的 conf 去撞它。
 *
 * ★ 另有一处**不是边界、是必须自己写**的：路径拼接用下面的 `_join()` 照抄
 *   `os.path.join`（只接分隔符、不规范化），**别用 `node:path` 的 `join`** —— 路径里
 *   混着 `/` 时两边会拼出不同的字符串。理由见 `_join()` 上的注释。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as M from './model.mjs'
import * as CONTENT from './content.mjs'

export const 标记 = '\u200b'.repeat(3)


export class OpenerError extends Error {
  /** 开场白相关的问题（配置没这块、正文带尖括号…）。 */
  constructor(message) {
    super(message)
    this.name = 'OpenerError'
  }
}


// ------------------------------------------------------------------ Python 语义小工具
// 这一组与 content.mjs 头上那组同源，按本模块用到的再取一份（那边没导出的就自己写）。

/** `os.path.isfile`。 */
function _是文件(p) {
  try { return statSync(p).isFile() } catch { return false }
}

/** `os.path.isdir`。 */
function _是目录(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}

/**
 * `os.path.join` —— **只接分隔符，一个字都不规范化**。
 *
 * ★ 别用 `node:path` 的 `join`：路径里混进一个 `/`（玩家的 `--到 a/b`、语料里
 *   `@根@/甲界面` 都是这么来的）时，Python 那边 `os.path.join("…\\工程/甲界面", "source")`
 *   原样拼成 `…\\工程/甲界面\\source`（**那个 `/` 留着**），而 `path.join` 会把它
 *   统一成 `\\` —— 差分第 137 行就是这么逮到的。
 *   （`abspath` / `dirname` 两边一致，可以照用。）
 */
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

/** Python `str()`（标量走 pyStr，容器走 repr —— `str(['a'])` 就是 `['a']`）。 */
const _str = (v) => (v !== null && typeof v === 'object' ? M.pyRepr(v) : CONTENT.pyStr(v))

// Python 的 `str.isspace()` 那一套：比 JS 的 `trim()` **宽 `\x1c`–`\x1f`、`\x85`**，
// 又**不含 `\ufeff`**（JS 的 trim 会把 BOM 当空白吃掉）。差一个字符就是差一个字节。
const _PY空白 = '\t\n\v\f\r \x1c\x1d\x1e\x1f\x85\u00a0\u1680' +
  '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a' +
  '\u2028\u2029\u202f\u205f\u3000'
const _RSTRIP = new RegExp(`[${_PY空白}]+$`)
const _STRIP = new RegExp(`^[${_PY空白}]+|[${_PY空白}]+$`, 'g')

/** Python 的 `s.rstrip()`（无参：去尾部空白）。 */
const _rstrip = (s) => String(s).replace(_RSTRIP, '')

/** Python 的 `s.strip()`。 */
const _strip = (s) => String(s).replace(_STRIP, '')

/** Python 的 `s.rstrip(集)`：去掉尾部**属于集**的字符（按码点，不是码元）。 */
function _rstrip集(s, 集) {
  const A = Array.from(String(s))
  let i = A.length
  while (i > 0 && 集.includes(A[i - 1])) i -= 1
  return A.slice(0, i).join('')
}


// ------------------------------------------------------------------ 定位
export function 定位(target) {
  /** 从「工程目录 / 工程里的任意文件」找到工程根，并说清它有没有**界面层**。
   *
   * 返回 `[根, 模式]`：
   *
   *   · `"界面"` —— 有 `hud/hud.conf.json`。开场白的**真源在 conf**，spec 里那条是派生物。
   *   · `"内容"` —— 只有 `source/`（单张 `.card.json` 收进来就是这样）。这时 spec 里那条
   *     开场白**本身就是真源**，直接改它是对的，不存在「改了白改」。
   *
   * **为什么要有内容这一档**：以前只认界面层，于是「收一张别人给的卡 → 想换开场白」
   * 是条死路 —— `opener` 不认、`hud` 不肯凭空造界面层、规程又让人别手改。最后只能手抠
   * 那三个零宽标记，正好踩在最该消灭的那种错上。收进来先能改，才有后面的事。
   */
  const p = resolve(CONTENT.pyTruthy(target) ? CONTENT.pyStr(target) : '.')
  let cur = _是目录(p) ? p : dirname(p)
  let 内容 = ''
  for (let i = 0; i < 5; i += 1) {          // 工程 / source 两层足够，多留几格
    if (_是文件(_join(cur, 'hud', 'hud.conf.json'))) return [cur, '界面']
    if (!内容 && _spec(cur)) 内容 = cur
    const up = dirname(cur)
    if (up === cur) break
    cur = up
  }
  return 内容 ? [内容, '内容'] : [null, '']
}


export function 工程(target) {
  /** 只认**有界面层**的工程（真源在 conf）。没界面层时返回 null —— 用 `定位` 取内容档。 */
  const [根, 模式] = 定位(target)
  return 模式 === '界面' ? 根 : null
}


export function _开场白条目(spec_p) {
  /** spec 里那条固定开场白（`kind: opening`）。没有就返回 None。 */
  if (!spec_p) return null
  let lib
  try {
    lib = CONTENT.或(CONTENT.取(CONTENT.或(M.yload(spec_p), {}), 'library', null), {})
  } catch {
    return null
  }
  for (const e of CONTENT.或(CONTENT.取(lib, 'entries', null), [])) {
    if (CONTENT.是字典(e)
      && _str(CONTENT.或(CONTENT.取(e, 'kind', null), '')) === 'opening') return e
  }
  return null
}


export function _spec(proj) {
  const d = _join(proj, 'source')
  if (!_是目录(d)) return null
  for (const f of readdirSync(d).sort(CONTENT.比串)) {
    if (f.endsWith('.spec.yaml')) return _join(d, f)
  }
  return null
}


export function _读json(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}


export function _写json(path, obj) {
  /** 写回 conf：中文照旧可读，但**零宽标记转义着写**。
   *
   * 为什么单挑它：模板里的 conf 原本就是 `\\u200b\\u200b\\u200b` 这么写的 ——
   * 人打开文件能看见「这儿有个标记」。图省事写成真字符，那三个空格就彻底隐了形：
   * 谁在编辑器里存一次都可能把它吃掉，差异比对里也看不见。所以照原风格来。
   */
  let s = JSON.stringify(obj, null, 2)
  s = s.split('\u200b').join('\\u200b')     // 字面写成 \u200b 六个字符
  writeFileSync(path, s + '\n', { encoding: 'utf8' })
}


// ------------------------------------------------------------------ 正文的规矩
export function 尾标记数(正文) {
  const A = Array.from(_str(CONTENT.或(正文, '')))
  let n = 0
  for (let i = A.length - 1; i >= 0; i -= 1) {
    if (A[i] === '\u200b') n += 1
    else break
  }
  return n
}


export function 规范正文(新文) {
  /** 把「人要的正文」变成「conf 该存的样子」：末尾正好三个标记。
   *
   * 给的人不必知道标记存在，更不必数它几个 —— 全按这里的来。
   * 顺手拦尖括号：开场白是纯文本，尖括号会把标记变回可见字符，
   * 从 ElecKoi 的会话预览（侧栏、历史检索）里露出来。
   */
  let t = _str(CONTENT.或(新文, ''))
  if (t.endsWith('\n')) t = t.slice(0, -1)
  if (!_strip(_rstrip集(t, '\u200b'))) {
    throw new OpenerError('开场白正文是空的 —— 玩家开卡第一屏会什么都没有。')
  }
  if (t.includes('<') || t.includes('>')) {
    throw new OpenerError(
      '正文里有尖括号（< 或 >）。开场白是纯文本，尖括号会把末尾那三个'
      + '零宽标记变成可见字符，从 ElecKoi 的会话预览里露出来 —— 去掉它再改。')
  }
  return _rstrip集(t, '\u200b') + 标记
}


// ------------------------------------------------------------------ 读
export function 读(target) {
  /** 一个工程的开场白全貌：真源、正文、标记、尖括号、方案数、有没有写回。 */
  const [根, 模式] = 定位(target)
  if (!根) {
    throw new OpenerError(
      `没找到工程（从 ${_str(target)} 往上找 \`hud/hud.conf.json\`、或 \`source/*.spec.yaml\`，`
      + '两样都没找着）。\n'
      + '  单张卡还没收成工程？先： python forge.py import <卡.json> --到 .')
  }
  if (模式 === '内容') return _读内容(根)

  const proj = 根
  const conf_p = _join(proj, 'hud', 'hud.conf.json')
  const conf = _读json(conf_p)
  const op = CONTENT.或(CONTENT.取(conf, '开场白', null), {})
  const 正文 = _str(CONTENT.或(CONTENT.取(op, '正文', null), ''))

  let 方案 = []
  const spec_p = _spec(proj)
  let 写回正文 = null
  if (spec_p) {
    let lib
    try {
      lib = CONTENT.或(CONTENT.取(CONTENT.或(M.yload(spec_p), {}), 'library', null), {})
    } catch {
      lib = {}
    }
    for (const e of CONTENT.或(CONTENT.取(lib, 'entries', null), [])) {
      if (_str(CONTENT.取(e, 'id', null)) === _str(CONTENT.或(CONTENT.取(op, '条目', null), ''))) {
        方案 = CONTENT.或(CONTENT.取(e, 'opening_messages', null), [])
          .map((m) => _str(CONTENT.或(CONTENT.取(m, 'title', null), '')))
        写回正文 = _str(CONTENT.或(CONTENT.取(e, 'content', null), ''))
        break
      }
    }
  }

  const 一致 = 写回正文 === null ? null : (写回正文 === 正文)
  return {
    工程: proj, 模式: '界面', 配置文件: conf_p, spec: spec_p,
    有开场白: CONTENT.pyTruthy(op), 条目: _str(CONTENT.或(CONTENT.取(op, '条目', null), '')),
    正文: 正文, 字数: CONTENT.lenPy(_rstrip(_rstrip集(正文, '\u200b'))),
    标记数: 尾标记数(正文),
    尖括号: (正文.includes('<') || 正文.includes('>')),
    方案: 方案, 写回一致: 一致,
  }
}


export function _读内容(根) {
  /** 没有界面层的工程：spec 里那条开场白**就是真源**（没有 conf 会在上面盖）。 */
  const spec_p = _spec(根)
  const 条 = _开场白条目(spec_p)
  if (!条) {
    throw new OpenerError(
      `这个工程（${_str(根)}）里没有开场白条目 —— spec 里没有 \`kind: opening\` 的那一条。\n`
      + '  这张卡的开场交给了宿主，工具这边没什么可改的。\n'
      + '  确实要一条： python forge.py entry <spec> --新 "AI角色开场白"'
      + '（再把 kind 改成 opening）；或 python forge.py new 开一张带界面层的新卡。')
  }
  const 正文 = _str(CONTENT.或(CONTENT.取(条, 'content', null), ''))
  return {
    工程: 根, 模式: '内容', 配置文件: null, spec: spec_p,
    有开场白: true, 条目: _str(CONTENT.或(CONTENT.取(条, 'id', null), '')),
    正文: 正文, 字数: CONTENT.lenPy(_rstrip(_rstrip集(正文, '\u200b'))),
    标记数: 尾标记数(正文),
    尖括号: (正文.includes('<') || 正文.includes('>')),
    方案: CONTENT.或(CONTENT.取(条, 'opening_messages', null), [])
      .map((m) => _str(CONTENT.或(CONTENT.取(m, 'title', null), ''))),
    写回一致: true,
  }
}


export function 写内容(spec_p, 新文) {
  /** 内容档的写：换掉 spec 里那条开场白的正文，**方案正文一起换齐**。
   *
   * 方案（`opening_messages`）与条目正文是同一份东西的两个出口：界面档靠
   * `hud --写回` 让它们一致；内容档没别人替我们做，就自己一次换齐 ——
   * 不然会出现「主开场白改了、切方案还是老的」，而这种不一致只有在 ElecKoi 里点一下
   * 才看得见。方案自己的 `initial_variable_state` 与 id 一概不动。
   *
   * 走 `content.commit`：编不出卡就一个字不落盘。
   */
  const raw = CONTENT.load(spec_p)
  const lib = CONTENT.或(CONTENT.取(raw, 'library', null), {})
  for (const e of CONTENT.或(CONTENT.取(lib, 'entries', null), [])) {
    if (!(CONTENT.是字典(e)
      && _str(CONTENT.或(CONTENT.取(e, 'kind', null), '')) === 'opening')) continue
    e.content = 新文
    for (const m of CONTENT.或(CONTENT.取(e, 'opening_messages', null), [])) {
      if (CONTENT.是字典(m) && 'content' in m) m.content = 新文
    }
    CONTENT.commit(spec_p, raw)
    return spec_p
  }
  throw new OpenerError('spec 里没有 `kind: opening` 的开场白条目，没地方写。')
}


// ------------------------------------------------------------------ 写
const _正文摘要 = (文) => (d) =>
  `开场白已改：${d.字数} 字 → ${CONTENT.lenPy(_rstrip(_rstrip集(文, '\u200b')))} 字` +
  `（末尾 ${尾标记数(文)} 个零宽标记，已按规矩补齐）`


export function 改正文(target, 新文, 写回 = true, out = CONTENT._print) {
  /** 换掉开场白正文。标记自己补，旧版进回收站，改完顺手写回 spec。 */
  const d = 读(target)
  if (!d.有开场白) {
    throw new OpenerError(
      '这个工程的 hud.conf.json 里没有「开场白」这一块 ——\n'
      + '  开场白由谁提供是它说了算（没有这块，开场那一步就交给宿主）。\n'
      + '  确实想要：照别的工程的形状在 conf 里补一块，或直接改 hud/hud.conf.json。')
  }
  const 新 = 规范正文(新文)
  if (新 === d.正文) {
    out('开场白一个字没变 —— 不写盘。')
    return { 变了: false, 详情: d, 正文: 新 }
  }

  // 旧的存回收站：改是无声覆盖，被盖掉的那一版同样值得留
  if (d.spec) {
    CONTENT.put_trash(d.spec, '开场白', '改开场白正文',
      [{ 表: '开场白',
        数据: { 条目: d.条目, 正文: d.正文 } }])
  }

  if (d.模式 === '内容') {
    写内容(d.spec, 新)
    out(_正文摘要(新)(d))
    out('')
    out('这个工程没有界面层 —— 改的就是 spec 里那条，**它就是真源**（没有 conf 在上面盖，'
      + '不存在「改了白改」）。')
    return { 变了: true, 详情: d, 正文: 新, 写回: true }
  }

  const conf = _读json(d.配置文件)
  conf['开场白']['正文'] = 新
  _写json(d.配置文件, conf)
  out(_正文摘要(新)(d))

  if (写回) {
    const HUD = _HUD()
    out('')
    out('写回 spec（不然卡里那条还是老的）：')
    let problems
    try {
      [problems] = HUD.build(d.工程, { write_back: true, out })
    } catch (exc) {
      out('')
      out(`组装失败：${CONTENT._错文(exc)}`)
      out('  conf 已经改了（改动留着），把界面那边修好再写回：')
      out(`  python forge.py opener "${d.工程}" --写回`)
      return { 变了: true, 详情: d, 正文: 新, 写回: false, 问题: [CONTENT._错文(exc)] }
    }
    if (problems) {
      out('')
      out('组装有校验问题，**没有**写回 —— conf 已经改了，修完界面再跑一次：')
      out(`  python forge.py opener "${d.工程}" --写回`)
      return { 变了: true, 详情: d, 正文: 新, 写回: false, 问题: problems }
    }
    return { 变了: true, 详情: d, 正文: 新, 写回: true }
  }
  out('')
  out(`下一步： python forge.py opener "${d.工程}" --写回    把正文写进 spec`)
  return { 变了: true, 详情: d, 正文: 新, 写回: false }
}


export function 补齐(target, out = CONTENT._print) {
  /** 正文末尾的标记不对（不是正好 3 个）就补上 —— 专治手改 conf 时数错、漏掉。
   *
   * 「少了标记 = 建卡界面静默消失」是本工具最该消灭的那种错。所以它有个
   * 专治的入口：不改一个字，只把末尾整成 3 个。
   */
  const d = 读(target)
  if (!d.有开场白) {
    throw new OpenerError(
      '这个工程的 hud.conf.json 里没有「开场白」这一块，没什么可补的。')
  }
  if (d.标记数 === 3) {
    out('末尾正好 3 个零宽标记 —— 不用补。')
    return { 变了: false, 详情: d }
  }
  out(`末尾是 ${d.标记数} 个零宽标记，该是 3 个 —— 补上。`)
  return 改正文(d.工程, d.正文, true, out)
}


export function 写回(target, out = CONTENT._print) {
  /** 只写回（不改正文）：conf 里那份正文重新灌进 spec。 */
  const [根, 模式] = 定位(target)
  if (!根) {
    throw new OpenerError(
      `没找到工程（从 ${_str(target)} 往上找 \`hud/hud.conf.json\`、或 \`source/*.spec.yaml\`，`
      + '两样都没找着）。')
  }
  if (模式 === '内容') {
    out('这个工程没有界面层（没有 hud/hud.conf.json），没有要写回的东西 ——')
    out('开场白正文已经直接落在 spec 里了，改完就是最终状态。')
    return []
  }
  const proj = 根
  const d = 读(proj)
  if (!d.有开场白) {
    throw new OpenerError('这个工程的 hud.conf.json 里没有「开场白」这一块，没得写回。')
  }
  if (d.标记数 !== 3) {
    throw new OpenerError(
      `conf 里的开场白正文末尾有 ${d.标记数} 个零宽标记，该是 3 个 —— 不写回（少标记的卡，`
      + '导入 ElecKoi 后建卡界面不会出现）。\n'
      + `  先把标记补齐：python forge.py opener "${proj}" --补齐`)
  }
  const HUD = _HUD()
  const problems = HUD.build(proj, { write_back: true, out })
  return problems
}


/**
 * ★ 移植记号：Python 在 `改正文` 里那句 `from . import hud as HUD`（延迟导入）与
 * `写回` 里开头那句，都指向**还没搬的** `hud.mjs`。
 *
 * 这里的落点与 Python 一致 —— 只在**真的要用 HUD.build 那一行**才炸：
 * `写回()` 的内容档支路会先 return（Python 那边也是先 return），所以照样能走通。
 */
function _HUD() {
  throw new Error('forgejs 还没搬 hud.mjs —— 界面档的「写回 spec」这一支暂时走不了。')
}
