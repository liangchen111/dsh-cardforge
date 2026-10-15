/**
 * forge.export 的 JS 版 —— ElecKoi 卡 -> 酒馆（SillyTavern）V2 卡。
 * ==================================================================
 *
 * 为什么要有反向这一条：只有单向（酒馆 -> ElecKoi）时，一旦你在 ElecKoi 里把卡
 * 改好了，就再也回不去酒馆 —— 人会被锁死在一边。有来有回，两边才是同一个东西的
 * 两种外壳。
 *
 * 映射规约（重要，决定了「换过去还能不能用」）：
 *
 *     常驻 + insert_role=system  ->  并进 data.description
 *         酒馆里没有「常驻条目」这种一等公民，真正每轮都进提示的只有 description /
 *         system_prompt 这几格。把常驻系统块并进去，它们在酒馆里才是真的每轮生效。
 *     常驻 + 其他 role           ->  character_book 条目，constant=true
 *     非常驻 + 有关键词          ->  character_book 条目，keys=关键词，constant=false
 *     非常驻 + 无关键词          ->  character_book 条目，keys=[]（⚠ 酒馆不会自动触发它）
 *         酒馆表达不了「AI 自己决定读哪份」，这一条是真实的能力缺口，报告里会点数。
 *     开场白                     ->  first_mes + alternate_greetings
 *     变量 / 分组 / 未映射字段   ->  extensions.eleckoi（原样存着，回迁时取回）
 *
 * 回迁：forge to-eleckoi 认得出 data.extensions.eleckoi，会把它里面的字段并回去，
 * 所以「ElecKoi -> 酒馆 -> ElecKoi」不会把变量和分组丢掉。
 *
 * ⚠️ 转换只做能确定的映射。做不到的一律如实说明，不猜、不假装。
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 移植纪律（同 model.mjs / content.mjs / opener.mjs 头上那几条）：**行为照抄，不顺手改**。
 * 能逐字节比的逐字节比 —— 这个模块的产物是**整份 JSON**（`M.jdump` 两边逐字节对齐），
 * 报告是**一整片人话**（`"%s"` / `"%d"` / `%r`），所以下面照抄了 content.mjs 那组
 * 「Python 语义小工具」，一个都不许省。
 *
 * ★ 本模块**必须自己写、不许走 JS 原生语义**的地方（都是差分能当场逮到的边角）：
 *
 *   1. **`dict.get(k, d)` ≠ `??`**。Python 的 `d.get(k, d)` **键在、值是 None 时给 None**，
 *      只有键不在才给默认值；JS 的 `??` 把 null 也当缺键。所以全程走 `_取()`，并且照原样
 *      区分 `.get(k)`（＝`_取(o, k, null)`）与 `.get(k, d)`。
 *   2. **`or` 是 Python 真值**（`[]` / `{}` / `""` / `0` 全假；JS 的空数组空对象是真值）
 *      ⇒ 一律 `CONTENT.或()`。`bool(x)` ⇒ `CONTENT.pyTruthy(x)`。
 *   3. **`str(x)` 不是 `String(x)`**：`str(None)` 是 `"None"`；容器走 `repr`
 *      （`str(['a'])` 是 `['a']`）⇒ 用下面的 `_str()`（＝opener.mjs:109 那个同源写法）。
 *   4. **`s.strip()` 不是 `String.trim()`**：Python 多去 `\x1c`–`\x1f` / `\x85`，
 *      **不去 `\ufeff`**；JS 的 trim 会把 BOM 当空白吃掉 ⇒ 用 `_strip()`（同 opener.mjs:117）。
 *   5. **`len(s)` / 切片按码点**，`s.length` 按 UTF-16 码元 ⇒ `CONTENT.lenPy()`。报告的
 *      「%d 字」与 `"x" * chars` 都踩这条。
 *   6. **`int(v)`**: 布尔→0/1、浮点**向零截断**、字符串认首尾空白（Python 还认 `1_0`），
 *      坏字符串抛的是 **ValueError**（不是 TypeError）⇒ 自己写 `_intPy()`。
 *   7. **`%r`** 走 `M.pyRepr()`（单引号优先、串里两种引号都有才换双引号）。
 *   8. **`x in (0, None)`**：Python 里 `False == 0` ⇒ **`False` 也算命中**，而 JS 的
 *      `false === 0` 是假 ⇒ 自己写 `_in0None()`。
 *   9. **查表用 `.get(k, d)`**：`ST_ROLE.get(role, 1)` 不能被 `ST_ROLE[role]` 顶 ——
 *      后者会把原型链上的 `toString` / `constructor` 当命中值（Python 的 dict 不会）
 *      ⇒ 一律走 `_map取()`（`hasOwnProperty`）。
 *   10. **`OrderedDict` 直接写成对象字面量**：JS 对象对字符串键保留插入顺序，与
 *       OrderedDict 同序。**但整型样式的键会被 V8 提前**——本模块没有一个这样的键
 *       （全是 `id` / `keys` / `seq` 这类），所以安全；将来加数字键要自己复核。
 *   11. **`dict.get` 挂在非 dict 上会抛 `AttributeError: 'list' object has no attribute 'get'`**，
 *       而 JS 只会静默给 `undefined`。`_取()` 照 CPython 的措辞抛出来（JSON 读进来的值
 *       只有 NoneType/bool/int/float/str/list/dict 七种，类型名表小到可以照抄）。
 *       `for x in v` 同理走 `_迭代()`（字符串按**码点**拆、dict 给键）。
 *   12. **Python 的 tuple 一律写成 JS 数组**（差分台 `动回` 就是照 `isinstance(回, tuple)`
 *       认的，纪律 8）⇒ `_openings()` 返回 `[first_mes, alts]`，**不是** `{first_mes, alts}`；
 *       调用处用 `const [first_mes, alts] = _openings(entries)` 解构。
 *
 * ★ 别顺手「统一」的两处 —— 看着像 bug，其实是黄金源的行为，差分逐字节咬得住：
 *
 *   · `_creator_notes` 的「原卡名：」用的是**没 strip 的原文**（黄金里是 `原卡名：  银月`），
 *     而同一张卡的 `name` 是 strip 过的（`银月`）。两者**不同源**，别为了「一致」改成同值。
 *   · `char = card.get("character", {}) or {}`：`.get` 先给 `{}`、`or` 再兜一次 null
 *     ⇒ 写成一个 `??` 就少一层；语料里 `"character": null` 那一档会当场红。
 *
 * ★ 语料**没覆盖到、也不打算覆盖**的分支（写在这里免得后来人以为漏了）：
 *
 *   · `for k, v in char.items()` / `list(x)` 之类**把字符串、数字当容器用**的写法：
 *     Python 各有各的错（`'int' object is not iterable`），JS 侧 `_迭代()` 会抛
 *     TypeError，措辞与 CPython 不完全一致。差分语料只喂**形状正确**的卡（这是转换器，
 *     不是校验器；坏形状的卡该由 `validate` 拦）。
 *   · `ST_ROLE.get([1], 1)` 这种**不可哈希的键**：Python 抛
 *     `TypeError: unhashable type: 'list'`，JS 的 `_map取()` 会把它串成 `"1"` 查一次表、
 *     查不到给默认值。同样是「类型错用」，不照抄。
 *   · `os.path.basename()` 收 `Path` 对象：JS 侧只收字符串（调用方从命令层下来时本来就
 *     是字符串）。
 *   · `_eleckoi_payload` 里 `if raw and canonical:` 的 **canonical 为假**那半边：
 *     它只有在 `format` 不以 `eleckoi.` 开头时才为假，而 `to_tavern` 在那之前已经抛
 *     `ValueError` ⇒ **从公开入口不可达**；只有直接调 `_eleckoi_payload(卡, 人, 组, 行)`
 *     才碰得到，差分台按「公开入口」喂语料，所以不造这个用例。
 */
import * as M from './model.mjs'
import * as P from './pack.mjs'
import * as CONTENT from './content.mjs'


// ------------------------------------------------------------------ Python 语义小工具
//
// 这组不是「顺手加的抽象」，是照 content.mjs:116-209 那一组再取一份（同 opener.mjs:108-131
// 的做法）：`.get` / `or` / `str` / `strip` / `len` / `int` 的边角差一点，报错原文与落盘
// 内容就悄悄跑偏，而跑偏了差分也抓不住。

/** Python 的真值：null / false / 0 / "" / [] / {} / NaN 都算假。 */
const { pyTruthy, 或, pyStr, lenPy } = CONTENT

/** Python 的 `str()`（标量走 pyStr，容器走 repr —— `str(['a'])` 就是 `['a']`）。 */
const _str = (v) => (v !== null && typeof v === 'object' ? M.pyRepr(v) : pyStr(v))

// Python 的 `str.isspace()` 那一套：比 JS 的 `trim()` **宽 `\x1c`–`\x1f`、`\x85`**，
// 又**不含 `\ufeff`**（JS 的 trim 会把 BOM 当空白吃掉）。差一个字符就是差一个字节。
const _PY空白 = '\t\n\v\f\r \x1c\x1d\x1e\x1f\x85\u00a0\u1680' +
  '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a' +
  '\u2028\u2029\u202f\u205f\u3000'
const _STRIP = new RegExp(`^[${_PY空白}]+|[${_PY空白}]+$`, 'g')

/** Python 的 `s.strip()`。 */
const _strip = (s) => String(s).replace(_STRIP, '')

/** CPython 的 `type(v).__name__`（JSON 只读得出这七种）。 */
function _pyType(v) {
  if (v === null || v === undefined) return 'NoneType'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float'
  if (typeof v === 'string') return 'str'
  if (Array.isArray(v)) return 'list'
  return 'dict'
}

/** Python 的 `raise ValueError(...)` —— **名字必须与 Python 一致**（差分记 type(exc).__name__）。 */
export class ValueError extends Error {
  constructor(消息) {
    super(消息)
    this.name = 'ValueError'
  }
}

/** Python 的 `AttributeError` —— 只为「把非 dict 当 dict 用」这一支对齐措辞。 */
export class AttributeError extends Error {
  constructor(消息) {
    super(消息)
    this.name = 'AttributeError'
  }
}

/**
 * Python 的 `d.get(k, 默认)` —— 键在、值是 null 时给 null，不是给默认。
 * 挂在非 dict 上照 CPython 抛 `AttributeError: 'list' object has no attribute 'get'`。
 */
function _取(o, k, d) {
  if (o === null || o === undefined || typeof o !== 'object' || Array.isArray(o)) {
    throw new AttributeError(`'${_pyType(o)}' object has no attribute 'get'`)
  }
  return k in o ? o[k] : d
}

/** Python 的 `len(v)`：字符串/容器按个数（字符串按码点）。 */
function _len(v) {
  if (Array.isArray(v)) return v.length
  if (typeof v === 'string') return lenPy(v)
  if (v !== null && v !== undefined && typeof v === 'object') return Object.keys(v).length
  throw new TypeError(`object of type '${_pyType(v)}' has no len()`)
}

/** Python 的 `for x in v`：字符串按码点拆、dict 给键、list 原样。 */
function _迭代(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return Array.from(v)
  if (v !== null && v !== undefined && typeof v === 'object') return Object.keys(v)
  throw new TypeError(`'${_pyType(v)}' object is not iterable`)
}

/**
 * Python 的 `int(v)`：布尔→0/1，浮点**向零截断**，字符串认首尾空白与下划线分隔，
 * 坏字符串抛 **ValueError**（与 mods.mjs:141 同源实现）。
 */
function _intPy(v) {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      const 词 = Number.isNaN(v) ? 'NaN' : (v > 0 ? 'infinity' : '-infinity')
      throw new ValueError(`cannot convert float ${词} to integer`)
    }
    return Math.trunc(v)
  }
  if (typeof v === 'string') {
    const s = _strip(v)
    if (!/^[+-]?\d(?:_?\d)*$/.test(s)) {
      throw new ValueError(`invalid literal for int() with base 10: ${M.pyRepr(v)}`)
    }
    return Number.parseInt(s.replace(/_/g, ''), 10)
  }
  throw new TypeError(
    `int() argument must be a string, a bytes-like object or a real number, not '${_pyType(v)}'`)
}

/** Python 的 `v in (0, None)` —— `False == 0` ⇒ **False 也算命中**（JS 的 `===` 不算）。 */
const _in0None = (v) => v === null || v === undefined || v === false || v === 0

/** Python 的 `d.get(k, 默认)`（查表用；照 `hasOwnProperty` 走，别踩原型链）。 */
function _map取(o, k, d) {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : d
}

/** Python 的 `sorted(set(列))`。 */
const _sorted集 = (列) => [...new Set(列)].sort((a, b) => a - b)

/** Python 的 `os.path.basename`（Windows 上 `/` 与 `\` 都是分隔符，同 manual.mjs:130）。 */
function _基名(p) {
  let s = String(p)
  while (s.length > 1 && (s.endsWith('/') || s.endsWith('\\'))) s = s.slice(0, -1)
  let i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i >= 0) s = s.slice(i + 1)
  if (/^[A-Za-z]:$/.test(s)) return ''
  return s
}

/** Python 的 `os.path.splitext`（前导点不算扩展名，同 manual.mjs:151）。 */
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


// ElecKoi insert_role -> 酒馆 extensions.role
export const ST_ROLE = { system: 0, user: 1, assistant: 2 }
// 展示顺序用的 position（0=角色定义前，1=角色定义后）
export const ST_POS_NUM = { before_char: 0, after_char: 1, before_an: 2, after_an: 3, at_depth: 4 }
// ElecKoi keyword_condition -> 酒馆 selectiveLogic
export const ST_SELECTIVE = { none: 0, any: 0, all: 3, not_any: 2 }
// ElecKoi regex targets -> 酒馆 placement（1=用户输入，2=AI 输出）
export const ST_PLACEMENT = { UserInput: 1, AiOutput: 2 }


// ------------------------------------------------------------------ 主流程
export function to_tavern(card_path, out_path, keep_raw = false, out = CONTENT._print) {
  const card = M.jload(card_path)
  if (!_str(_取(card, 'format', '')).startsWith('eleckoi.')) {
    throw new ValueError('这不是 ElecKoi 卡（format=' + M.pyRepr(_取(card, 'format', '')) +
      '）。反向导出只认 ElecKoi 卡；若想拆解酒馆卡，请用 forge analyze。')
  }

  const char = 或(_取(card, 'character', {}), {})
  const lib = P.active_library(card)
  const var_ = P.active_variables(card)
  const entries = 或(_取(lib, 'entries', []), [])
  const groups = 或(_取(lib, 'groups', []), [])
  // 照抄 Python 的 dict 推导（**它在本模块里是死代码，但真运行时照样会去取 `g.get`** ——
  // groups 里混进非 dict 时 Python 在这儿就抛 AttributeError，别悄悄跳过它）。
  const gname = {}
  for (const g of _迭代(groups)) gname[_取(g, 'id', null)] = _取(g, 'name', '')

  const name = 或(_strip(_str(或(_取(char, 'name', null), ''))),
    _splitext(_基名(card_path))[0])

  // ---- 开场白
  const [first_mes, alts] = _openings(entries)

  // ---- 条目分流
  const desc_parts = []
  const book_entries = []
  const untriggered = []
  const meta_rows = []          // 回迁用的「原条目身份证」
  let book_id = 0
  for (const e of _迭代(entries)) {
    if (_取(e, 'kind', null) === 'opening') continue
    if (!pyTruthy(_取(e, 'enabled', true))) continue
    const content = _str(或(_取(e, 'content', null), ''))
    if (!_strip(content)) continue
    const title = _strip(_str(或(_取(e, 'title', null), '(无标题)')))
    const trigger = _取(e, 'trigger_mode', 'always')
    const role = _取(e, 'insert_role', 'user')
    const keys = []
    for (const k of _迭代(或(_取(e, 'keywords', null), []))) {
      if (_strip(_str(k))) keys.push(_str(k))
    }
    const const_ = (trigger === 'always')

    if (const_ && role === 'system') {
      desc_parts.push(`## ${title}\n\n${content}`)
      meta_rows.push(_meta_row(e, title, 'desc', null, meta_rows.length))
      continue
    }

    book_id += 1
    const pos = role === 'system' ? 'before_char' : 'after_char'
    const st_entry = {
      id: book_id,
      keys: const_ ? [] : keys,
      secondary_keys: _迭代(或(_取(e, 'condition_keywords', null), [])).map((k) => _str(k)),
      comment: title,
      content,
      constant: pyTruthy(const_),
      selective: !const_ && pyTruthy(keys),
      insertion_order: _intPy(或(_取(e, 'order', null), book_id)),
      enabled: true,
      position: pos,
      use_regex: pyTruthy(_取(e, 'keyword_use_regex', null)),
      extensions: _st_entry_ext(e, role, pos),
    }
    book_entries.push(st_entry)
    meta_rows.push(_meta_row(e, title, 'book', book_id, meta_rows.length))
    if (!const_ && !pyTruthy(keys)) untriggered.push(title)
  }

  // ---- 组装
  const data = {}
  data['name'] = name
  data['description'] = 或(desc_parts.join('\n\n'), _str(或(_取(char, 'opening', null), '')))
  data['personality'] = ''
  data['scenario'] = ''
  data['first_mes'] = first_mes
  data['mes_example'] = _pick_example(entries)
  data['creator_notes'] = _creator_notes(char, groups, entries)
  data['system_prompt'] = ''
  data['post_history_instructions'] = ''
  data['alternate_greetings'] = alts
  data['character_book'] = _book(name, book_entries)
  data['tags'] = _str(或(_取(char, 'group', null), '')).split('、')
    .map((t) => _strip(t)).filter((t) => t)
  data['creator'] = ''
  data['character_version'] = ''
  data['extensions'] = {
    eleckoi: _eleckoi_payload(card, char, groups, meta_rows, keep_raw ? card : null),
    regex_scripts: _regex_scripts(或(_取(card, 'regex_rules', null), [])),
  }

  const tavern = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
  }
  // chara_card_v3 会在顶层再抄一份 data（酒馆两种都认，V2 更通用）
  M.jdump(tavern, out_path)

  // ---- 报告
  let chars = 0
  for (const e of _迭代(entries)) chars += lenPy(_str(或(_取(e, 'content', null), '')))
  out('已导出 -> ' + _str(out_path))
  out('  名字      : ' + _str(name))
  out(`  开场白    : 默认 1 套 + 备选 ${_len(alts)} 套`)
  out(`  description 收进常驻系统块 ${_len(desc_parts)} 条（`
    + `${desc_parts.reduce((a, p) => a + lenPy(p), 0)} 字）`)
  out(`  世界书条目: ${book_entries.length} 条（常驻 `
    + `${book_entries.filter((b) => b.constant).length} / 关键词 `
    + `${book_entries.filter((b) => !b.constant).length}）`)
  out(`  正则脚本  : ${_len(或(_取(card, 'regex_rules', null), []))} 条`)
  out(`  变量      : ${_len(或(_取(var_, 'objects', null), []))} 个对象 / `
    + `${_len(或(_取(var_, 'variables', null), []))} 个变量`
    + '（存进 extensions，酒馆没有变量系统）')
  out(`  设定库正文合计 ${chars} 字 ≈ ${M.estTokens('x'.repeat(chars))} token`)
  out('')

  if (pyTruthy(untriggered)) {
    out(`⚠️ 有 ${_len(untriggered)} 条「按需但没写关键词」的条目，酒馆不会自动触发它们：`)
    for (const t of untriggered.slice(0, 8)) out('     · ' + _str(t))
    if (_len(untriggered) > 8) {
      out(`     …… 另有 ${_len(untriggered) - 8} 条`)
    }
    out('   → 二选一：在酒馆里给这些条目补关键词；或把它们改成常驻'
      + '（constant=true，代价是每轮都占上下文）。')
    out('   根因：ElecKoi 有「由 AI 自己选读」这一档（agent_tool + normal），'
      + '酒馆没有对应能力 —— 这是真实的能力缺口，不是转换漏了。')
    out('')
  }

  out('注意：')
  out('  1. 变量、分组、character 的 profile_* 等未映射字段都存进了 '
    + 'data.extensions.eleckoi，')
  out('     用 forge to-eleckoi 转回来时会取回（往返不丢东西）。')
  out('  2. 酒馆没有 `setting_library` 这种「嵌套 JSON 字符串」结构，'
    + '转回去时由本工具重新组装。')
  out('  3. 想把卡发到酒馆，通常还要一张 PNG 头像：把这份 JSON 导入酒馆后另存即可。')
  return out_path
}


// ------------------------------------------------------------------ 各段
/**
 * 从开场白条目里取出默认开场与备选。
 *
 * ★ Python 返回的是 **tuple** `(first_mes, alts)` ⇒ 这里照 house rule（差分台
 *   `动回(list(回) if isinstance(回, tuple) else 回)` 那一套，纪律 8）返回**数组**，
 *   不返回 `{first_mes, alts}` —— 两边直接调它时结构才比得动。
 */
export function _openings(entries) {
  let first = ''
  const alts = []
  for (const e of _迭代(entries)) {
    if (_取(e, 'kind', null) !== 'opening') continue
    const msgs = 或(_取(e, 'opening_messages', null), [])
    if (!pyTruthy(msgs)) continue
    const dflt = 或(_取(e, 'default_opening_message_id', null), '')
    let chosen = null
    for (const m of _迭代(msgs)) {
      if (_取(m, 'id', null) === dflt) {
        chosen = m
        break
      }
    }
    chosen = 或(chosen, msgs[0])
    first = _strip(_str(或(_取(chosen, 'content', null), '')))
    for (const m of _迭代(msgs)) {
      if (m === chosen) continue
      const c = _strip(_str(或(_取(m, 'content', null), '')))
      if (c) alts.push(c)
    }
    break
  }
  return [first, alts]
}


/** 挑一条「对话示例」当 mes_example。 */
export function _pick_example(entries) {
  for (const e of _迭代(entries)) {
    if (_取(e, 'kind', null) === 'opening') continue
    const title = _str(或(_取(e, 'title', null), ''))
    if (title.includes('示例') && title.includes('对话')) {
      return _strip(_str(或(_取(e, 'content', null), '')))
    }
  }
  return ''
}


export function _creator_notes(char, groups, entries) {
  const lines = ['由 ElecKoi 制卡工具导出。', '']
  if (pyTruthy(groups)) {
    lines.push('分组：' + _迭代(groups).map((g) => _str(或(_取(g, 'name', null), ''))).join('、'))
  }
  const nm = _str(或(_取(char, 'name', null), ''))
  const prof = []
  for (const [key, label] of [['profile_age', '年龄'], ['profile_sex', '性别'],
    ['profile_height', '身高'], ['profile_birthday', '生日'], ['profile_like', '喜好']]) {
    const v = _strip(_str(或(_取(char, key, null), '')))
    if (v) prof.push(`${label}：${v}`)
  }
  if (pyTruthy(prof)) lines.push('角色档案：' + prof.join('；'))
  if (pyTruthy(nm)) {
    lines.push('')
    lines.push('原卡名：' + nm)
  }
  return _strip(lines.join('\n'))
}


export function _book(name, entries) {
  return {
    name: `${name} · 设定库`,
    description: '由 ElecKoi 制卡工具导出。常驻条目 = constant=true。',
    scan_depth: 4,
    token_budget: 2048,
    recursive_scanning: false,
    extensions: {},
    entries,
  }
}


/** 酒馆条目那条又长又死的 extensions（版本不同字段会多会少，写全更稳）。 */
export function _st_entry_ext(e, role, pos) {
  const whole = _取(e, 'keyword_whole_word', null)
  return {
    position: _map取(ST_POS_NUM, pos, 1),
    exclude_recursion: pyTruthy(_in0None(_取(e, 'keyword_recursion_depth', null))),
    display_index: 0,
    probability: 100,
    useProbability: true,
    depth: _intPy(或(_取(e, 'keyword_scan_depth', null), 4)),
    selectiveLogic: _map取(ST_SELECTIVE, _str(或(_取(e, 'keyword_condition', null), 'none')), 0),
    group: _str(或(_取(e, 'group_id', null), '')),
    group_override: false,
    group_weight: 100,
    prevent_recursion: true,
    delay_until_recursion: false,
    scan_depth: null,
    match_whole_words: pyTruthy(whole) ? pyTruthy(whole) : null,
    use_group_scoring: false,
    case_sensitive: pyTruthy(_取(e, 'keyword_ignore_case', true)) ? null : true,
    automation_id: '',
    role: _map取(ST_ROLE, role, 1),
    vectorized: false,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    eleckoi: {
      id: _取(e, 'id', ''),
      agent_read_strategy: _取(e, 'agent_read_strategy', 'normal'),
      agent_selection_hint: _取(e, 'agent_selection_hint', ''),
      insert_role: role,
      order: _取(e, 'order', null),
    },
  }
}


/** 一条原条目的「身份证」：回迁时凭标题找回 id / 分组 / 顺序 / 全部字段。 */
export function _meta_row(e, title, kind, tavern_id = null, seq = null) {
  return {
    seq,                                  // 原条目在设定库里的位次，回迁时照它排
    eleckoi_id: _取(e, 'id', ''),
    title,
    icon_id: _取(e, 'icon_id', ''),
    group_id: _str(或(_取(e, 'group_id', null), '')),
    order: _取(e, 'order', null),
    view_order: _取(e, 'view_order', 0),
    group_view_order: _取(e, 'group_view_order', 0),
    tree_view_order: _取(e, 'tree_view_order', 0),
    bin: kind,                            // desc = 并进了 description；book = 世界书条目
    tavern_id,
    trigger_mode: _取(e, 'trigger_mode', 'always'),
    agent_read_strategy: _取(e, 'agent_read_strategy', 'normal'),
    agent_selection_hint: _取(e, 'agent_selection_hint', ''),
    insert_role: _取(e, 'insert_role', 'user'),
    position: _取(e, 'position', ''),
    enabled: pyTruthy(_取(e, 'enabled', true)),
    keywords: _迭代(或(_取(e, 'keywords', null), [])).slice(),
    condition_keywords: _迭代(或(_取(e, 'condition_keywords', null), [])).slice(),
    keyword_condition: _取(e, 'keyword_condition', 'none'),
    keyword_use_regex: pyTruthy(_取(e, 'keyword_use_regex', false)),
    keyword_ignore_case: pyTruthy(_取(e, 'keyword_ignore_case', true)),
    keyword_whole_word: pyTruthy(_取(e, 'keyword_whole_word', false)),
    keyword_recursion_depth: _取(e, 'keyword_recursion_depth', 0),
    keyword_scan_depth: _取(e, 'keyword_scan_depth', 1),
    dynamic_mode: _取(e, 'dynamic_mode', 'standard'),
    kind: _取(e, 'kind', 'normal'),
  }
}


/** 开场白条目的存档：它在世界书里没有对应条目，不存就丢了。 */
export function _opening_arch(entries) {
  for (const e of _迭代(entries)) {
    if (_取(e, 'kind', null) !== 'opening') continue
    return {
      id: _取(e, 'id', ''),
      title: _取(e, 'title', ''),
      icon_id: _取(e, 'icon_id', ''),
      group_id: _str(或(_取(e, 'group_id', null), '')),
      order: _取(e, 'order', null),
      view_order: _取(e, 'view_order', 0),
      group_view_order: _取(e, 'group_view_order', 0),
      tree_view_order: _取(e, 'tree_view_order', 0),
      content: _取(e, 'content', ''),
      default_opening_message_id: _取(e, 'default_opening_message_id', ''),
      agent_read_strategy: _取(e, 'agent_read_strategy', 'normal'),
      trigger_mode: _取(e, 'trigger_mode', 'always'),
      insert_role: _取(e, 'insert_role', 'assistant'),
      opening_messages: _迭代(或(_取(e, 'opening_messages', null), []))
        .map((m) => M.ordered(m, M.ENTRY_MESSAGE_KEYS)),
    }
  }
  return null
}


/** 回迁所需的一切：变量、分组、未映射字段、条目身份证。 */
export function _eleckoi_payload(card, char, groups, meta_rows, raw = null) {
  const canonical = _str(_取(card, 'format', '')).startsWith('eleckoi.')
  const act = 或(P.active_library(card), {})
  const character = {}
  for (const [k, v] of Object.entries(char)) {
    if (k !== 'name' && k !== 'group') character[k] = v
  }
  const payload = {
    format: M.CARD_FORMAT,
    version: _取(card, 'version', 1),
    character,
    groups,
    variable_config: P.raw_variable_config(card),
    regex_rules: 或(_取(card, 'regex_rules', null), []),
    library_meta: {
      active_version_id: _取(act, 'id', ''),
      version_name: _取(act, 'name', ''),
      prompt_positions: 或(_取(act, 'prompt_positions', null), []),
      expanded_group_ids: 或(_取(act, 'expanded_group_ids', null), []),
      list_all_expanded: _取(act, 'list_all_expanded', true),
    },
    entry_map: meta_rows,
    opening: _opening_arch(或(_取(或(P.active_library(card), {}), 'entries', null), [])),
    note: '本字段由 ElecKoi 制卡工具写入，用于无损回迁；酒馆不读它。',
  }
  if (pyTruthy(raw) && canonical) payload['source_card'] = raw
  return payload
}


export function _regex_scripts(rules) {
  const out = []
  for (const r of _迭代(rules)) {
    const targets = 或(_取(r, 'targets', null), [])
    const placement = _sorted集(_迭代(targets).map((t) => _map取(ST_PLACEMENT, _str(t), 2)))
    out.push({
      id: _str(或(_取(r, 'id', null), '')),
      scriptName: _str(或(_取(r, 'name', null), '')),
      findRegex: _str(或(_取(r, 'pattern', null), '')),
      replaceString: _str(或(_取(r, 'replacement', null), '')),
      trimStrings: [],
      placement: pyTruthy(placement) ? placement : [2],
      disabled: !pyTruthy(_取(r, 'enabled', true)),
      markdownOnly: pyTruthy(_取(r, 'display_only', false)),
      promptOnly: pyTruthy(_取(r, 'prompt_only', false)),
      runOnEdit: pyTruthy(_取(r, 'run_on_edit', false)),
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
      extensions: { order: _取(r, 'order', 0), eleckoi_targets: targets },
    })
  }
  return out
}
