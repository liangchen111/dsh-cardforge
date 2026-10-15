/**
 * forge.validate 的 JS 版 —— 校验器：值域 + 一致性 + 交付前护栏。
 * ==================================================================
 *
 * 移植纪律（同 model.mjs 头上那三条）：**行为照抄，不顺手改**；能逐字节比的逐字节比。
 * 这里到处在拼人话诊断（`"%r" % v`、`title[:24]`、`sorted(...)`），所以下面养了一组
 * 「Python 语义小工具」（pyStr / pyRepr / 或 / 切 / 比串 / 计数）—— 少了它们，报告文本
 * 会在边角上悄悄跑偏，而报告文本是要给人看的，跑偏了差分也抓不住。
 *
 * ★ 本模块有一处**已知的未覆盖边界**（不是 bug）：`_check_opener` 与 `validate_project`
 *   里凡是要读 `source/*.spec.yaml` 的分支（HUD-OPENER-MARK / -DRIFT / -GONE、
 *   PROJ-NAME-DRIFT / LEDGER-* / HUD-UNWRITTEN / HUD-PATTERN / STALE-CARD）都走
 *   `M.yload()`；JS 侧的 YAML 子集读取器还没落地（现在是抛错），Python 侧那边会真读出来 ⇒
 *   两条路此刻注定不同。**代码照抄一份放这儿**，等 YAML 读取器落地就自动点亮。
 *   差分语料只喂「不碰 yload 的那些分支」，见 `差分/语料/validate.json`。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import * as D from './domain.mjs'
import * as M from './model.mjs'
import * as P from './pack.mjs'

// ------------------------------------------------------------------ 阈值
// 常驻条目每轮都进提示，字数就是钱。这两个数的来历见「模板世界书 · 条目怎么落地」。
export const CONST_CHARS_LIMIT = 3000 // 常驻合计上限，超了给 WARN
export const ENTRY_CHARS_LIMIT = 2600 // 单条上限，超了给 INFO

// ------------------------------------------------------------------ Python 语义小工具
// 下面这几个不是「顺手加的抽象」，是逐字节比出来的：Python 的 or / str / 切片 / 排序
// 与 JS 的 || / String / slice / sort 在边角上都不一样，而诊断文案天天踩着这些边角。

/** Python 的真值：null / False / 0 / "" / [] / {} / NaN 都算假。 */
export function pyTruthy(v) {
  if (v === null || v === undefined || v === false) return false
  if (v === true) return true
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return Boolean(v)
}

/** Python 的 `a or b`。 */
export const 或 = (a, b) => (pyTruthy(a) ? a : b)

/** Python 的 `str(v)`（只用于标量与 id，够用）。 */
export function pyStr(v) {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v)
}

/** Python 的 `s[:n]` —— 按**码点**切，不是按 UTF-16 码元（标题里可能有 emoji）。 */
export const 切 = (s, n) => Array.from(String(s)).slice(0, n).join('')

/** Python 的 `d.get(k, 默认)` —— 键在、值是 null 时给 null，不是给默认。 */
export const 取 = (o, k, d) => (o && typeof o === 'object' && k in o ? o[k] : d)

/** Python 的字符串排序按码点；JS 的 `<` 按 UTF-16 码元，星平面字符会排错。 */
export function 比串(a, b) {
  const A = Array.from(String(a), (c) => c.codePointAt(0))
  const B = Array.from(String(b), (c) => c.codePointAt(0))
  const n = Math.min(A.length, B.length)
  for (let i = 0; i < n; i += 1) if (A[i] !== B[i]) return A[i] - B[i]
  return A.length - B.length
}

/** 混合类型的一列也能排（数字按数值、其余按字符串）——糊住 Python 的 TypeError 场景。 */
export function 比混合(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return 比串(pyStr(a), pyStr(b))
}

/** 计数（保持首次出现顺序，等价于 Python 的 Counter）。 */
function 计数(列) {
  const m = new Map()
  for (const x of 列) m.set(x, (m.get(x) ?? 0) + 1)
  return m
}

/** dict(Counter(...)) 的 JSON 键：Python 的 json 把 None/True/数字键都写成字符串。 */
export function json键(v) {
  if (v === null || v === undefined) return 'null'
  if (v === true) return 'true'
  if (v === false) return 'false'
  return String(v)
}

/**
 * dict(Counter(...))：键按首次出现顺序，值不变。
 *
 * ★ 这里有个两面的坑：JSON 里 `None` 要写成 `"null"`（Python 的 json 就这么干），
 *   而报告里的人话要写成 `None=`（Python 的 `"%s" % None`）。同一个键两种写法 ⇒
 *   把「原始键长什么样」藏在**不可枚举**属性里（JSON.stringify 看不见它），
 *   交给 `_fmt()` 取用。
 */
function 计数成对象(列) {
  const out = {}
  const 原键 = new Map()
  for (const [k, n] of 计数(列)) {
    const jk = json键(k)
    out[jk] = n
    原键.set(jk, pyStr(k))
  }
  Object.defineProperty(out, '原键', { value: 原键, enumerable: false })
  return out
}

// ------------------------------------------------------------------ 主入口
/** 对一张已解析的卡做全量校验，返回 Issue 列表。 */
export function validate_card(card, source_label = '卡片') {
  const issues = []

  // ---- 0. 顶层
  const fmt = 取(card, 'format', '')
  if (fmt && fmt !== M.CARD_FORMAT) {
    issues.push(M.err('TOP-FORMAT', '卡', `format 是 ${M.pyRepr(fmt)}，不是 ${M.pyRepr(M.CARD_FORMAT)}`,
      '确认这是 ElecKoi 卡。'))
  }

  const character = 或(取(card, 'character', {}), {})
  if (!pyStr(取(character, 'name', '')).trim()) {
    issues.push(M.warn('TOP-NAME', '卡', 'character.name 是空的',
      '给卡一个名字，否则列表里认不出来。'))
  }

  const lib = P.active_library(card)
  const var_ = P.active_variables(card)
  const entries = 或(取(lib, 'entries', []), [])
  const groups = 或(取(lib, 'groups', []), [])
  const regex_rules = 或(取(card, 'regex_rules', []), [])

  const gids = new Set(groups.map((g) => 取(g, 'id', null)))
  const oids = new Set((或(取(var_, 'objects', []), [])).map((o) => 取(o, 'id', null)))

  // ---- 1. 值域段 + 2. 一致性段（逐条）
  const eids = entries.map((e) => 取(e, 'id', null))
  const dup_ids = [...计数(eids)].filter(([, n]) => n > 1).map(([i]) => i)
  if (dup_ids.length) {
    issues.push(M.err('ID-DUP', '设定库',
      `重复的条目 id：${dup_ids.map(pyStr).sort(比串).join('、')}`,
      '每个条目 id 必须唯一。'))
  }

  // 同组内 order 撞车才可能影响先后（跨组撞车是常态，不算问题）
  const per_group = new Map()
  for (const e of entries) {
    if (取(e, 'order', null) !== null) {
      // Python 的键是一个元组 (group_id or "", order)；用 JSON 编码保住「1 与 '1' 不同」
      const gid0 = 或(取(e, 'group_id', null), '')
      const k = JSON.stringify([gid0, 取(e, 'order', null)])
      if (!per_group.has(k)) per_group.set(k, { gid: gid0, od: 取(e, 'order', null), titles: [] })
      per_group.get(k).titles.push(切(或(取(e, 'title', null), ''), 16))
    }
  }
  const clash = [...per_group.values()].filter((x) => x.titles.length > 1)
  clash.sort((a, b) => 比串(pyStr(a.gid), pyStr(b.gid)) || 比混合(a.od, b.od))
  for (const { od, titles } of clash.slice(0, 5)) {
    issues.push(M.info('ORDER-CLASH', '设定库',
      `同组内 order=${od} 撞车：${titles.join('、')}`,
      '平台文档没写 order 必须唯一；但同组内撞车时先后可能不确定，建议错开。'))
  }
  if (clash.length > 5) {
    issues.push(M.info('ORDER-CLASH', '设定库',
      `另有 ${clash.length - 5} 处同组 order 撞车`, '同上。'))
  }

  let opening_entries = 0
  let const_chars = 0
  const const_list = []
  const oversized = []

  for (const e of entries) {
    const title = pyStr(或(取(e, 'title', null), '(无标题)')).trim()
    const where = `条目「${或(切(title, 24), '(无标题)')}」`

    if (!pyStr(或(取(e, 'title', null), '')).trim()) {
      issues.push(M.warn('ENTRY-TITLE', where, '条目没有标题',
        '给一个标题；AI 的目录里只看得见标题。'))
    }

    // 1. 值域
    issues.push(...D.checkEntryDomains(e, where))

    // 2. 分组归属
    const gid = 取(e, 'group_id', null)
    if (gid && !gids.has(gid)) {
      issues.push(M.err('GROUP-MISSING', where, `分组 ${M.pyRepr(gid)} 不存在`,
        '改成分组表里已有的 id，或补一个分组。'))
    }

    const kind = 取(e, 'kind', 'normal')
    const trigger = 取(e, 'trigger_mode', 'always')

    // 开场白条目
    if (kind === 'opening') {
      opening_entries += 1
      const msgs = 或(取(e, 'opening_messages', null), [])
      const ids = new Set(msgs.map((m) => 取(m, 'id', null)))
      const dflt = 取(e, 'default_opening_message_id', null)
      if (!msgs.length) {
        issues.push(M.err('OPENING-EMPTY', where, '是开场白条目，但一个开场方案都没有',
          '至少给一个方案；开卡第一屏靠它。'))
      }
      if (dflt && !ids.has(dflt)) {
        issues.push(M.err('OPENING-DEFAULT', where, `默认开场白指向不存在的方案 ${M.pyRepr(dflt)}`,
          '改成一个真实存在的方案 id。'))
      }
      continue
    }

    // 常驻必须有插入位置，否则被直接过滤（不是「约束变弱」，是压根不加载）
    if (trigger === 'always' && !pyStr(或(取(e, 'position', null), '')).trim()) {
      issues.push(M.err('CONST-NO-POSITION', where,
        '是常驻条目（trigger_mode=always），但 position 是空的',
        '常驻条目位置空着会被平台直接过滤掉，一个字都进不去。给一个插入位置（如 instructions）。'))
      const_chars += pyStr(或(取(e, 'content', null), '')).length
      const_list.push([title, pyStr(或(取(e, 'content', null), '')).length])
    } else if (trigger === 'always') {
      const_chars += pyStr(或(取(e, 'content', null), '')).length
      const_list.push([title, pyStr(或(取(e, 'content', null), '')).length])
    }

    // 单条过长（先记账，循环后聚合报告，免得几十条一起把报告淹了）
    const n_chars = pyStr(或(取(e, 'content', null), '')).length
    if (n_chars > ENTRY_CHARS_LIMIT && kind !== 'opening') oversized.push([title, n_chars])

    // 关键词策略却没有关键词 —— 永远读不到
    if (取(e, 'agent_read_strategy', null) === 'keyword' && !(或(取(e, 'keywords', null), [])).length) {
      issues.push(M.err('KEYWORD-EMPTY', where,
        '读取策略是 keyword（命中后本轮必读），但关键词是空的',
        '补关键词，或把策略改成 normal（由 AI 选读）。'))
    }

    // 已是常驻，还要必读是多余的
    if (trigger === 'always' && 取(e, 'agent_read_strategy', null) === 'required') {
      issues.push(M.info('REQUIRED-REDUNDANT', where,
        '既 trigger_mode=always 又 agent_read_strategy=required',
        '常驻每轮都进提示，required 是多余的，改成 normal。'))
    }

    // 按需条目没写「什么时候读我」
    if (trigger === 'agent_tool' && !pyStr(或(取(e, 'agent_selection_hint', null), '')).trim()) {
      issues.push(M.warn('HINT-MISSING', where,
        '由 AI 读取，但没写 agent_selection_hint（什么时候读我）',
        '目录里只给四项：路径、标题、策略、读取提示。这行写实，AI 才知道什么时候该读。'))
    }

    // 空条目
    if (kind === 'normal' && !pyStr(或(取(e, 'content', null), '')).trim()) {
      issues.push(M.info('ENTRY-BLANK', where, '正文是空的', '空条目占目录位置，删掉或填上。'))
    }
  }

  if (opening_entries === 0) {
    issues.push(M.err('OPENING-NONE', '设定库', '没有开场白条目',
      '卡需要一条 kind=opening 的固定开场白。'))
  } else if (opening_entries > 1) {
    issues.push(M.warn('OPENING-MULTI', '设定库', `有 ${opening_entries} 条开场白条目`,
      '开场白是固定条目，通常只留一条。'))
  }

  // 开场白那一格的**内容**：空着正是它最坏的地方 —— 平台照样开卡，只是第一屏什么都没有，
  // 而人判断一张卡好不好，看的恰恰是「能不能开、开出来什么」。
  for (const e of entries) {
    if (pyStr(取(e, 'kind', '')) !== 'opening') continue
    const where = `条目「${或(切(pyStr(或(取(e, 'title', null), '开场白')).trim(), 24), '开场白')}」`
    const 正文 = _净文(取(e, 'content', null))
    let 方案 = (或(取(e, 'opening_messages', null), [])).filter((m) => m && typeof m === 'object' && !Array.isArray(m))
      .map((m) => _净文(取(m, 'content', null)))
    方案 = 方案.filter((x) => x)
    if (!正文) {
      issues.push(M.warn('OPENING-BLANK', where,
        `开场白条目的正文是空的（${方案.length ? '正文只在方案里' : '方案也是空的'}）`,
        '有些实现读的是条目正文 —— 空着开卡第一屏就什么都没有。' +
        '`python forge.py opener <工程> --正文@开场白.txt` 写一份。'))
    } else if (方案.length && !方案.includes(正文)) {
      issues.push(M.info('OPENING-DRIFT', where,
        '开场白条目正文与它所带各套方案的正文都不一样',
        '卡里到底用哪一份说不清 —— 跑 `python forge.py opener <工程> --看` 对一遍。'))
    }
  }

  if (const_chars > CONST_CHARS_LIMIT) {
    const top = [...const_list].sort((a, b) => b[1] - a[1]).slice(0, 3)
    const biggest = top.map(([t, n]) => `${切(t, 14)}(${n}字)`).join('、')
    issues.push(M.warn('SIZE-CONST', '设定库',
      `常驻正文合计 ${const_chars} 字，超过护栏 ${CONST_CHARS_LIMIT} 字`,
      '常驻每轮都进提示，字数就是成本（经验值：常驻压到 1,900 字以内）。' +
      `最大的是：${biggest}。把长示例、对照表挪进按需条目，是省字数最多的一次改动。`))
  }

  if (oversized.length) {
    const top = [...oversized].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const shown = top.map(([t, n]) => `${切(t, 12)}(${n}字)`).join('、')
    const more = oversized.length > 5 ? `，另有 ${oversized.length - 5} 条` : ''
    issues.push(M.info('SIZE-ENTRY', '设定库',
      `有 ${oversized.length} 条正文超过单条护栏 ${ENTRY_CHARS_LIMIT} 字：${shown}${more}`,
      '越长越该拆：拆开之后各自有自己的标题和「什么时候读我」，AI 才可能按需取到对的那一条。'))
  }

  // ---- 3. 变量段
  issues.push(..._validate_variables(var_, entries, oids))

  // ---- 4. 正则段
  issues.push(..._validate_regex(regex_rules))

  return issues
}

// ------------------------------------------------------------------ 变量
function _validate_variables(var_, entries, oids) {
  const issues = []
  const objects = 或(取(var_, 'objects', []), [])
  const variables = 或(取(var_, 'variables', []), [])
  const state = 或(取(var_, 'initial_state', {}), {})

  for (const o of objects) {
    const pid = 取(o, 'parent_id', null)
    if (pid && !oids.has(pid)) {
      issues.push(M.err('VAROBJ-PARENT', `变量对象「${取(o, 'name', null)}」`,
        `父对象 ${M.pyRepr(pid)} 不存在`, '改成存在的父对象 id。'))
    }
  }

  for (const item of variables) {
    const oid = 取(item, 'object_id', null)
    if (oid && !oids.has(oid)) {
      issues.push(M.err('VAR-ORPHAN', `变量「${取(item, 'title', null)}」`,
        `挂在不存在的对象 ${M.pyRepr(oid)} 上`, '改成存在的对象 id。'))
    }
  }

  // 变量条件的路径存在性（agent_read_condition 平台不读，这里只作意图体检）
  for (const e of entries) {
    const cond = pyStr(或(取(e, 'agent_read_condition', null), '')).trim()
    if (!cond) continue
    const where = `条目「${切(或(取(e, 'title', null), '(无标题)'), 24)}」`
    for (const token of cond.match(/[\u4e00-\u9fffA-Za-z_][\u4e00-\u9fffA-Za-z0-9_.]*/gu) ?? []) {
      if (!token.includes('.')) continue
      let probe = token.startsWith(M.STAT_ROOT) ? token.slice(M.STAT_ROOT.length) : token
      probe = probe.replace(/^\.+/, '')
      if (probe && !_path_exists(state, probe)) {
        issues.push(M.info('COND-PATH', where,
          `变量条件引用了初始状态里没有的路径：${token}`,
          '该字段平台不读；但若以后要改成真机制，这个路径也得对。'))
      }
    }
  }
  issues.push(..._variable_sync(objects, state, 取(var_, 'schema_code', null)))
  return issues
}

/**
 * 变量「三处同步」—— 这几处不同步，界面不会报错，只会安静地少一块。
 *
 *     ① objects      面板是按这张表画的；表里没有，界面上就不出现那一格
 *     ② initial_state 宿主初始化时取的是它；没有，界面读不到
 *     ③ schema_code  Zod 校验；不认，写入**被静默丢掉**（最难查的一种）
 *
 * 这是「档案备份」模块踩出来的那口坑（存档 › 角色 那四处要同时在），
 * 这里把它变成机器检查：任何一处分叉都报出来。
 */
function _variable_sync(objects, state, schema_code) {
  const issues = []
  if (!(state && typeof state === 'object' && !Array.isArray(state))) return issues
  const obj_names = new Set(objects
    .filter((o) => !pyTruthy(取(o, 'parent_id', null))
      && !pyStr(或(取(o, 'id', null), '')).startsWith('fixed-'))
    .map((o) => pyStr(取(o, 'name', null))))
  const state_keys = new Set(Object.keys(state).map((k) => String(k)))

  for (const k of [...state_keys].filter((k) => !obj_names.has(k)).sort(比串)) {
    issues.push(M.warn('VAR-SYNC-STATE', '变量',
      `initial_state 里有「${k}」，但 objects 里没有同名对象`,
      '面板按 objects 画 —— 对象表里缺了它，这一格在界面上不会出现。'))
  }
  for (const k of [...obj_names].filter((k) => !state_keys.has(k)).sort(比串)) {
    issues.push(M.warn('VAR-SYNC-OBJ', '变量',
      `objects 里有对象「${k}」，但 initial_state 里没有初值`,
      '宿主初始化时没有它，界面读不到 —— 在 initial_state 里补一个同名键。'))
  }

  const schema = pyStr(或(schema_code, ''))
  if (schema) {
    for (const k of [...state_keys].sort(比串)) {
      if (!schema.includes(k)) {
        issues.push(M.warn('VAR-SYNC-SCHEMA', '变量',
          `schema_code（Zod）里没有「${k}」`,
          '往它写入会被 schema 静默丢掉 —— 这是最难查的一种。'))
      }
    }
  }
  return issues
}

function _path_exists(state, path) {
  let cur = state
  for (const seg of String(path).split('.')) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && seg in cur) cur = cur[seg]
    else return false
  }
  return true
}

// ------------------------------------------------------------------ 正则
function _validate_regex(rules) {
  const issues = []
  for (const r of rules) {
    const name = pyStr(或(取(r, 'name', null), '(无名)'))
    const where = `正则「${name}」`
    const pat = pyStr(或(取(r, 'pattern', null), '')).trim()
    if (!pat) {
      issues.push(M.warn('RE-EMPTY', where, 'pattern 是空的', '删掉或补上。'))
      continue
    }
    if (pat.startsWith('/') && !M.RE_SLASH.test(pat)) {
      issues.push(M.err('RE-SLASH', where,
        '看起来是 /.../flags 形式但收尾不完整',
        '写成 /模式/flags，或直接写字面量（如 〔面板〕）。'))
    }
  }

  const orders = rules.filter((r) => 取(r, 'order', null) !== null).map((r) => 取(r, 'order', null))
  const dup = [...计数(orders)].filter(([, n]) => n > 1).map(([o]) => o)
  if (dup.length) {
    issues.push(M.warn('RE-ORDER', '正则',
      `重复的 order：${dup.sort(比混合).map(pyStr).join('、')}`,
      '替换是「谁先认走就是谁的」——order 撞车时先后随机。' +
      '更专一的规则排前面，兜底的排最后。'))
  }
  return issues
}

// ------------------------------------------------------------------ 界面层（HUD）
//
// 界面这一段代码是整段注进宿主页面的：它跟宿主共用一个 DOM、一个 window。
// 所以「守规矩」不是风格问题，是**边界问题** —— 越界一处，宿主的界面就跟着变形，
// 或者整页被截断。下面这些规矩全是从坑里捡回来的，逐条变成机器检查。

export const HUD_SCAN_TAILS = ['.js', '.css', '.html']

// 逐字扫描的禁物：(找什么, 为什么, 只查模块?) —— 这三条谁都不许犯
export const HUD_FORBIDDEN = [
  ['```', '三个反引号 —— 宿主把整页当富文本，会在这儿截断', false],
  ['<!--', 'HTML 注释开头 —— 会被宿主当成标记处理', false],
  ['</script', '「</script」字面量 —— 会提前闭合这一页的 script 标签', false],
  // 核心自带那颗常驻悬浮球（.hud-ball / .hud-ballpanel），它本来就该脱离消息流；
  // 模块是「借来的机制」，不许再放一个 —— 这条**只查模块**。
  ['position:fixed', '内联 position:fixed —— 会脱离宿主的消息流', true],
]

function _hit(text, needle) {
  if (needle === 'position:fixed') return /position\s*:\s*fixed/i.test(text)
  return text.includes(needle)
}

/** 体检工程里的界面层：模块文件守不守规矩、CSS 有没有漏加前缀。 */
export function validate_hud(project) {
  const issues = []
  const hud_dir = join(project, 'hud')
  const conf_path = join(hud_dir, 'hud.conf.json')
  if (!_isFile(conf_path)) return issues

  let conf
  try {
    conf = JSON.parse(readFileSync(conf_path, 'utf8'))
  } catch (exc) {
    return [M.err('HUD-CONF', 'hud.conf.json', `读不出来：${exc.message}`, '修好它再构建。')]
  }

  // conf 的「模块」列着的目录必须存在 —— 那种状态比不接更坏：卡看着是接了的，
  // 界面上却安静地少一块，谁也不会发现。
  for (const m of 或(取(conf, '模块', null), [])) {
    const d = join(hud_dir, '模块', String(m))
    if (!_isDir(d)) {
      issues.push(M.err('HUD-MOD-MISSING', 'hud.conf.json',
        `「模块」里写着「${m}」，但 ${d} 不存在`,
        `删掉那一项，或把模块目录补回来（\`forge add ${m} …\`）。`))
    }
  }

  // 逐文件扫规矩（预览.html 是拼出来的产物，它的 </script> 是外壳自带的，不算）
  const targets = []
  _遍历(hud_dir, (base, _dirs, files) => {
    for (const f of [...files].sort(比串)) {
      if (HUD_SCAN_TAILS.some((t) => f.endsWith(t))) targets.push(join(base, f))
    }
  })

  for (const p of targets) {
    const rel = relative(project, p).replace(/\\/g, '/')
    const is_module = rel.startsWith('hud/模块/') || rel.startsWith('hud/模块\\')
    let text
    try {
      text = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    for (const [needle, why, only_module] of HUD_FORBIDDEN) {
      if (only_module && !is_module) continue
      if (_hit(text, needle)) {
        issues.push(M.err('HUD-FORBID', rel, `出现了 ${why}`,
          '换一种写法；这条是跟宿主共用一个页面才有的约束。'))
      }
    }
    if (!rel.endsWith('.css')) continue
    // CSS：每个选择器都要以 .hud 打头 —— 前缀就是它和宿主页面之间的边界
    const bare = _bare_selectors(text)
    if (bare.length) {
      const shown = bare.slice(0, 4).join('、') + (bare.length > 4 ? '…' : '')
      issues.push(M.err('HUD-CSS-PREFIX', rel,
        `有 ${bare.length} 处选择器没带 .hud 前缀：${shown}`,
        '漏一个裸选择器（比如 body / .message），宿主的界面就会跟着变形。'))
    }
  }
  issues.push(..._check_opener(project, conf))
  return issues
}

function _zw_count(text) {
  const s = pyStr(或(text, ''))
  return s.split('\u200b').length - 1 + (s.split('\u200B').length - 1)
}

/** 去零宽标记再 strip —— 比正文时不该被那三个看不见的字符搅局。 */
function _净文(text) {
  return pyStr(或(text, '')).replace(/\u200b/g, '').replace(/\u200B/g, '').trim()
}

/** 从 `/\u200B{3}/` 这类触发模式里取出「需要几个零宽空格」。取不到就 0。 */
function _marker_need(pattern) {
  const p = pyStr(或(pattern, ''))
  let n = 0
  for (const m of p.matchAll(/\\u200[bB]\s*\{\s*(\d+)\s*\}/g)) n = Math.max(n, parseInt(m[1], 10))
  if (!n && /\\u200[bB]/.test(p)) n = 1
  return n
}

/**
 * 开场白那一格：**源头在 hud.conf.json**，spec 里那条是派生物。
 *
 * 两种「不报错、也就没人发现」的坏法：
 *
 *   · spec 里开场白正文少了建卡器标记（三个零宽空格 U+200B）→
 *     导入 ElecKoi 后**建卡界面根本不出现**，check 一个字不报；
 *   · spec 里那条与 conf 里的对不上 → 你改的是派生物，下次 `forge hud --写回`
 *     会把它一字不留地冲掉（改了白改）。
 *
 * 只在「有成品」的工程上查：骨架是**模板源**，`new` 拷一份出来才会写回开场白与
 * 正则 —— 拿它当错报就是误报（`PROJ-HUD-UNWRITTEN` 已经踩过这个坑一次）。
 */
function _check_opener(project, conf) {
  const issues = []
  const op = 或(取(conf, '开场白', null), {})
  if (!(op && typeof op === 'object' && !Array.isArray(op)) || !取(op, '条目', null)) return issues
  const cdir = join(project, '成品')
  if (!(_isDir(cdir) && _list(cdir).some((f) => f.endsWith('.card.json')))) return issues

  let marker = ''
  for (const r of 或(取(conf, '正则', null), [])) {
    if (r && typeof r === 'object' && !Array.isArray(r) && pyStr(或(取(r, 'view', null), '')) === 'view_create.html') {
      marker = pyStr(或(取(r, 'pattern', null), ''))
    }
  }
  const 需要 = _marker_need(marker)

  const sdir = join(project, 'source')
  let specs = []
  if (_isDir(sdir)) {
    specs = _list(sdir).sort(比串).filter((f) => f.endsWith('.spec.yaml')).map((f) => join(sdir, f))
  }
  if (specs.length !== 1) return issues // 两份 spec 有 PROJ-MULTI-SPEC 管，这里不凑热闹
  let doc
  try {
    doc = 或(M.yload(specs[0]), {})
  } catch {
    return issues
  }
  const rel = `source/${basename(specs[0])}`

  let target = null
  for (const e of 或(取(或(取(doc, 'library', null), {}), 'entries', null), [])) {
    if (pyStr(或(取(或(e, {}), 'id', null), '')) === pyStr(或(取(op, '条目', null), ''))) { target = e; break }
  }
  if (target === null) {
    issues.push(M.info('HUD-OPENER-GONE', rel,
      `spec 里没有开场白条目「${取(op, '条目', null)}」`,
      '这条是 `forge hud --写回` 写进去的 —— 现在开场的正文由宿主自己填。'))
    return issues
  }

  const body = pyStr(或(取(target, 'content', null), ''))
  const conf_body = pyStr(或(取(op, '正文', null), ''))
  if (需要 && _zw_count(body) < 需要) {
    issues.push(M.err('HUD-OPENER-MARK', rel,
      `开场白正文里少了建卡器标记（${需要} 个零宽空格 U+200B）`,
      '**导入 ElecKoi 后建卡界面不会出现，而且不报错。** 这个标记肉眼看不见 —— ' +
      '别手改这条正文：改 `hud/hud.conf.json` 的「开场白.正文」，' +
      '再跑 `python forge.py hud <工程> --写回`。'))
  }
  if (conf_body && body.trim() !== conf_body.trim()) {
    issues.push(M.warn('HUD-OPENER-DRIFT', rel,
      'spec 里的开场白与 hud/hud.conf.json 里的对不上',
      '**开场白的源头是 hud.conf.json**，spec 里这条是派生物 —— 你改的是派生物，' +
      '下次 `forge hud --写回` 会把它冲掉（改了白改）。要改就改 conf，再写回。'))
  }
  return issues
}

/**
 * 挑出没带 .hud 前缀的选择器。
 *
 * @media / @keyframes 这类外层包着的规则先不深挖 —— 宁可漏报，也不误报
 * （误报会让人不再看报告，那比不报还糟）。
 */
function _bare_selectors(css_text) {
  const text = css_text.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const rule of text.split('}')) {
    if (!rule.includes('{')) continue
    const head = rule.split('{')[0]
    for (const one of head.split(',')) {
      let sel = one.trim()
      if (!sel || sel.startsWith('@')) continue
      sel = sel.split('{').slice(-1)[0].trim()
      if (sel && !sel.startsWith('.hud')) out.push(切(sel, 28))
    }
  }
  return out
}

// ------------------------------------------------------------------ 工程层
// 上面查的是「这张卡自己通不通」；这一段查的是「这个工程里各层对不对得上」。
//
// 这几类错的共同点是 —— **都不报错**：
//   · 模块目录在，conf 没登记  → 组装时根本不拼它，界面上安静地少一块
//   · 接了模块账本没记         → `forge drop` 撤不掉，你以为撤了其实没撤
//   · spec 改过没重出成品       → 交出去、导入 ElecKoi 的还是老内容
// 人往往要等到下一局才发现。所以宁可在这儿多说一句。
//
// 规矩同前：**宁可少报，也不误报**。凡是有第二种合理解释的，一律降成提示。

function _load_json_soft(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function _mtime(path) {
  try {
    return statSync(path).mtimeMs / 1000
  } catch {
    return 0.0
  }
}

const _newest = (paths) => (paths.length ? Math.max(...paths.map(_mtime)) : 0.0)

/** Python `json.dumps(obj, ensure_ascii=False, sort_keys=True)` 的等价文本。 */
function _py_json(obj, sort_keys) {
  if (obj === null || obj === undefined) return 'null'
  if (obj === true) return 'true'
  if (obj === false) return 'false'
  if (typeof obj === 'number') return Number.isInteger(obj) ? String(obj) : String(obj)
  if (typeof obj === 'string') return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map((v) => _py_json(v, sort_keys)).join(', ')}]`
  let keys = Object.keys(obj)
  if (sort_keys) keys = keys.sort(比串)
  return `{${keys.map((k) => `${JSON.stringify(k)}: ${_py_json(obj[k], sort_keys)}`).join(', ')}}`
}

/** 跟 mods._fingerprint 同一套算法（只比内容，不比键序与空白）。 */
function _fingerprint(obj) {
  return createHash('sha1').update(_py_json(obj, true), 'utf8').digest('hex').slice(0, 12)
}

/** 体检工程这一层：各层之间对不对得上、派生物是不是过期了。 */
export function validate_project(project) {
  const issues = []
  if (!project || !_isDir(project)) return issues

  const src = join(project, 'source')
  const hud_dir = join(project, 'hud')
  const conf_path = join(hud_dir, 'hud.conf.json')
  const conf = _load_json_soft(conf_path)

  // ---- 1. source/ 下的 spec：一张工程只该有一份 ----
  let specs = []
  if (_isDir(src)) {
    specs = _list(src).sort(比串).filter((f) => f.endsWith('.spec.yaml')).map((f) => join(src, f))
  }
  if (specs.length > 1) {
    issues.push(M.err('PROJ-MULTI-SPEC', 'source/',
      `有 ${specs.length} 份 spec：${specs.map((p) => basename(p)).join('、')}`,
      '一张卡只该有一份 —— 组装界面、出成品都靠「唯一那份」定位，' +
      '两份就谁也不知道该用哪份了。多张卡请各自独立成一个目录。'))
  }

  let spec_doc = null
  if (specs.length === 1) {
    try {
      spec_doc = 或(M.yload(specs[0]), {})
    } catch {
      spec_doc = null // spec 读不出来，交给卡那一层去报
    }
  }
  const entries = 或(取(或(取(spec_doc ?? {}, 'library', null), {}), 'entries', null), [])
  const rules = 或(取(spec_doc ?? {}, 'regex_rules', null), [])
  const rule_ids = new Set(rules.map((r) => pyStr(或(取(r, 'id', null), ''))))
  const rule_by_name = new Map(rules.map((r) => [pyStr(或(取(r, 'name', null), '')), r]))
  const entry_ids = new Set(entries.map((e) => pyStr(或(取(e, 'id', null), ''))))

  // ---- 1.5 卡名三处得同名 ----
  // 工程目录名 / 界面配置的「卡名」/ spec 的 character.name，三处说的应该是同一个名字。
  // 盲跑实测：`new <新名> --从 <外来卡>` 之后，spec 里顶着**外来卡**的名字，另两处是新名，
  // 而 `check` 一声不响 —— 用户导进 ElecKoi 看到的卡名跟工程目录对不上，无从查起。
  if (specs.length === 1 && conf && spec_doc) {
    const conf_name = pyStr(或(取(conf, '卡名', null), '')).trim()
    const spec_name = pyStr(或(取(或(取(spec_doc, 'character', null), {}), 'name', null), '')).trim()
    if (conf_name && spec_name && conf_name !== spec_name) {
      issues.push(M.warn('PROJ-NAME-DRIFT', `source/${basename(specs[0])}`,
        `界面配置叫「${conf_name}」，spec 里却叫「${spec_name}」`,
        '导进 ElecKoi 显示的是 spec 里那个名字，会跟工程目录对不上。' +
        `改成同一个：python forge.py name <工程> --改 "${conf_name}"`))
    }
  }

  // ---- 2. 模块目录 ↔ conf 登记 ----
  // 组装**只按 conf 那一行拼**（hud.py 就是遍历「模块」），所以目录在这儿而名字
  // 不在 conf 里，等于这个模块白接了：脚本与样式一个字都不进页面。
  const mod_root = join(hud_dir, '模块')
  let on_disk = []
  if (_isDir(mod_root)) {
    on_disk = _list(mod_root).filter((d) => _isDir(join(mod_root, d))).sort(比串)
  }
  const registered = (或(取(或(conf, {}), '模块', null), [])).map((x) => String(x))
  for (const name of on_disk) {
    if (!registered.includes(name)) {
      issues.push(M.err('PROJ-MOD-UNLISTED', `hud/模块/${name}`,
        '目录在这儿，却不在 hud.conf.json 的「模块」里',
        '组装时只按「模块」那一行拼 —— 这个模块的脚本与样式不会进页面，' +
        `界面上安静地少一块。补上 conf，或重新接一次（\`forge add ${name} …\`）。`))
    }
  }

  // ---- 3. 账本 ↔ conf ↔ 现状 ----
  const ledger = _load_json_soft(join(project, '模块账本.json')) ?? {}
  const recorded = 或(取(ledger, '模块', null), {})
  for (const name of registered) {
    if (!(name in recorded)) {
      issues.push(M.warn('PROJ-MOD-NO-LEDGER', 'hud.conf.json',
        `「${name}」登记在 conf 里，账本里却没有它`,
        '账本是 `forge drop` 唯一的依据 —— 没记就撤不掉（工具分不清那是' +
        '谁的，宁可不撤）。要么重新接一次，要么自己动手摘。'))
    }
  }

  for (const [name, rec0] of Object.entries(recorded)) {
    const rec = 或(rec0, {})
    const 条目 = 或(取(rec, '条目', null), {})
    for (let item0 of 或(取(条目, '替换', null), [])) {
      const item = 或(item0, {})
      const eid = pyStr(或(取(item, 'id', null), ''))
      const title = pyStr(或(取(item, 'title', null), 或(eid, '?')))
      if (!entry_ids.has(eid)) {
        issues.push(M.warn('PROJ-LEDGER-GONE', '模块账本.json',
          `「${name}」记着它替换过条目「${title}」，但 spec 里已经没有这条`,
          '撤这个模块时会撤不动那一处。要么把条目找回来，要么自己改 spec。'))
        continue
      }
      const cur = entries.find((e) => pyStr(或(取(e, 'id', null), '')) === eid) ?? {}
      if (取(item, '并入后', null) && _fingerprint(cur) !== item['并入后']) {
        issues.push(M.info('PROJ-LEDGER-DRIFT', '模块账本.json',
          `「${name}」接上「${title}」之后你又改过它`,
          '撤模块时会**连你那处改动一起还原**（账本里存的是接之前那一份）。' +
          '不想这样，就先把它从账本里摘掉。'))
      }
    }
    for (let item0 of 或(取(条目, '新增', null), [])) {
      const item = 或(item0, {})
      const eid = pyStr(或(取(item, 'id', null), ''))
      const title = pyStr(或(取(item, 'title', null), 或(eid, '?')))
      if (!entry_ids.has(eid)) {
        issues.push(M.info('PROJ-LEDGER-GONE', '模块账本.json',
          `「${name}」记着它新加了条目「${title}」，spec 里已经没有这条`,
          '撤的时候会跳过它，不影响别的。'))
      } else {
        const cur = entries.find((e) => pyStr(或(取(e, 'id', null), '')) === eid) ?? {}
        if (取(item, '指纹', null) && _fingerprint(cur) !== item['指纹']) {
          issues.push(M.info('PROJ-LEDGER-DRIFT', '模块账本.json',
            `「${name}」加的条目「${title}」你改过`,
            '撤这个模块时它**照删**（账本记着它归模块）—— 舍不得就先把' +
            '它从账本里摘掉。'))
        }
      }
    }
    const gone_rules = (或(取(rec, '正则', null), [])).map((x) => String(x)).filter((x) => !rule_ids.has(x))
    if (gone_rules.length) {
      issues.push(M.info('PROJ-LEDGER-REGEX', '模块账本.json',
        `「${name}」记着 ${gone_rules.length} 条正则，spec 里现在没有`,
        '撤的时候会少撤这几条，别的照撤。'))
    }
    for (const rel of 或(取(rec, '界面', null), [])) {
      const p = join(project, String(rel).replace(/\//g, sep))
      if (!_exists(p)) {
        issues.push(M.warn('PROJ-LEDGER-HUD', '模块账本.json',
          `「${name}」记着界面文件 ${rel}，它不在了`,
          '撤模块时会删不干净，或者 conf 与目录从此对不上 —— ' +
          '手工补回来，或把这一条从账本里摘掉。'))
      }
    }
  }

  // ---- 4. 界面有没有写回卡里 ----
  // conf 里那几条正则就是「卡里出现界面」的唯一入口。spec 里没有同名那条，
  // 导入 ElecKoi 之后什么都不会发生 —— 而且不报错。
  //
  // 只在**已经出过成品**的工程上查：那种工程是真要交出去用的。
  // 骨架这类「模板源」本来就没有成品、也没有那几条正则（`new` 拷一份出来才会写回），
  // 拿它当错报就是误报。
  const card_dir = join(project, '成品')
  const card_files = _isDir(card_dir) ? _list(card_dir).filter((f) => f.endsWith('.card.json')) : []
  if (conf !== null && spec_doc !== null && card_files.length) {
    for (const r0 of 或(取(conf, '正则', null), [])) {
      const r = 或(r0, {})
      const nm = pyStr(或(取(r, 'name', null), ''))
      if (!nm) continue
      if (!rule_by_name.has(nm)) {
        issues.push(M.warn('PROJ-HUD-UNWRITTEN', `source/${basename(specs[0])}`,
          `hud.conf.json 里那条「${nm}」不在 spec 的正则里`,
          '卡里就靠这条正则把界面注进去 —— 少它，导入 ElecKoi 之后' +
          '界面根本不会出现。跑一次 `forge hud <工程> --写回`。'))
      } else {
        const want = pyStr(或(取(r, 'pattern', null), ''))
        const have = pyStr(或(取(rule_by_name.get(nm), 'pattern', null), ''))
        if (want && have && want !== have) {
          issues.push(M.info('PROJ-HUD-PATTERN', `source/${basename(specs[0])}`,
            `正则「${nm}」的模式与 conf 里那份不一样`,
            '下次 `forge hud --写回` 会按 conf 覆盖它 —— 若有意改在这里，' +
            '请把 conf 也改了。'))
        }
      }
    }
  }

  // ---- 5. 派生物是不是过期了 ----
  // 交付给 ElecKoi 的是**成品**，不是 spec。改完 spec 忘了重出，导进去的还是老内容。
  if (specs.length === 1 && card_files.length) {
    const spec_t = _mtime(specs[0])
    const old = [...card_files].sort(比串).filter((f) => _mtime(join(card_dir, f)) < spec_t)
    if (old.length) {
      issues.push(M.warn('PROJ-STALE-CARD', '成品/',
        `${old.join('、')} 比 spec 旧`,
        '**交付给 ElecKoi 的是成品，不是 spec** —— 现在导进去的还是改之前' +
        '那一版。跑一次 `forge build` 重新生成。'))
    }
  }
  const hud_files = []
  _遍历(hud_dir, (base, _dirs, files) => {
    for (const f of files) hud_files.push(join(base, f))
  })
  const preview = join(project, '预览.html')
  if (_isFile(preview) && hud_files.length && _mtime(preview) < _newest(hud_files)) {
    issues.push(M.info('PROJ-STALE-PREVIEW', '预览.html',
      '预览页比 hud/ 下的文件旧',
      '预览不是最新的 —— 跑一次 `forge hud <工程>` 重出（不影响卡本身）。'))
  }
  return issues
}

// ------------------------------------------------------------------ 汇总
/** 给出一张卡的结构摘要（不判断对错，只数数）。 */
export function summarize(card) {
  const lib = P.active_library(card)
  const var_ = P.active_variables(card)
  const entries = 或(取(lib, 'entries', null), [])
  const 常驻 = entries.filter((e) => 取(e, 'trigger_mode', 'always') === 'always' && 取(e, 'kind', null) !== 'opening')
  const const_chars = 常驻.reduce((n, e) => n + pyStr(或(取(e, 'content', null), '')).length, 0)
  return {
    name: 取(或(取(card, 'character', null), {}), 'name', ''),
    entries: entries.length,
    groups: (或(取(lib, 'groups', null), [])).length,
    variables: (或(取(var_, 'variables', null), [])).length,
    objects: (或(取(var_, 'objects', null), [])).length,
    regex: (或(取(card, 'regex_rules', null), [])).length,
    const: 常驻.length,
    const_chars,
    trigger: 计数成对象(entries.map((e) => 取(e, 'trigger_mode', null))),
    strategy: 计数成对象(entries.map((e) => 取(e, 'agent_read_strategy', null))),
    role: 计数成对象(entries.map((e) => 取(e, 'insert_role', null))),
  }
}

export function _fmt(counter) {
  if (!counter || !Object.keys(counter).length) return '（无）'
  const 原键 = counter['原键']
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${原键 instanceof Map ? 原键.get(k) : k}=${v}`)
    .join(' · ')
}

/**
 * 把校验结果打给人看。返回 ERROR 的条数。
 *
 * `report_text()` 是同一个东西的「只取文本」口 —— 差分测试要靠它逐字节比
 * （Python 那边用 redirect_stdout 抓 print）。
 */
export function report_text(card, source, issues) {
  const s = summarize(card)
  const L = []
  L.push('='.repeat(74))
  L.push(`对象    : ${source}`)
  L.push(`卡片    : ${或(s.name, '(无名)')}`)
  L.push(`条目 ${s.entries} · 分组 ${s.groups} · 变量 ${s.variables} · 对象 ${s.objects} · 正则 ${s.regex}`)
  L.push(`常驻    : ${s.const} 条 / ${s.const_chars} 字（护栏 ${CONST_CHARS_LIMIT} 字）`)
  L.push(`触发方式: ${_fmt(s.trigger)}`)
  L.push(`读取策略: ${_fmt(s.strategy)}`)
  L.push(`插入角色: ${_fmt(s.role)}`)

  const errs = issues.filter((i) => i.level === 'ERROR')
  const warns = issues.filter((i) => i.level === 'WARN')
  const infos = issues.filter((i) => i.level === 'INFO')

  L.push('-'.repeat(74))
  if (!issues.length) L.push('  ✔ 没有发现问题')
  for (const i of [...errs, ...warns, ...infos]) L.push(i.line())
  L.push('-'.repeat(74))
  L.push(`结论：${errs.length} 个错误 · ${warns.length} 个警告 · ${infos.length} 条提示`)
  if (errs.length) {
    // 错误全在工程层的话，「导进客户端填了不生效」那句话就不对路了 —— 换一句说准的
    const 工程 = errs.filter((i) => i.code.startsWith('PROJ-'))
    if (工程.length === errs.length) {
      L.push('  → 卡本身没毛病，是**这个工程**里两处对不上（上面那几条 PROJ-）——' +
        '不改的话，界面上会安静地少一块，或者交出去的还是老内容。')
    } else {
      L.push('  → 有错误，这张卡导进客户端会有一部分「填了没生效」。先改错误。')
    }
  } else if (warns.length) {
    const 工程 = warns.filter((i) => i.code.startsWith('PROJ-'))
    if (工程.length === warns.length) {
      L.push('  → 卡本身没问题；工程层有几处对不上（PROJ-），建议看一眼。')
    } else {
      L.push('  → 没有错误，警告建议看一眼。')
    }
  } else {
    L.push('  → 可以交付。')
  }
  return `${L.join('\n')}\n`
}

export function print_report(card, source, issues) {
  process.stdout.write(report_text(card, source, issues))
  return issues.filter((i) => i.level === 'ERROR').length
}

// ------------------------------------------------------------------ 内部：文件系统
const _exists = (p) => existsSync(p)
const _isFile = (p) => _stat(p)?.isFile() ?? false
const _isDir = (p) => _stat(p)?.isDirectory() ?? false

function _stat(p) {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

function _list(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * os.walk 的自顶向下版：每个目录回调 (base, dirs, files)，dirs 已按 Python 那两处
 * 的过滤规则剪过枝（`__pycache__` / `out`），且**剪枝后才下潜**。
 */
function _遍历(root, 回调, 跳过 = ['__pycache__', 'out']) {
  let ents
  try {
    ents = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  const dirs = ents.filter((e) => e.isDirectory()).map((e) => e.name).filter((d) => !跳过.includes(d))
  const files = ents.filter((e) => e.isFile()).map((e) => e.name)
  回调(root, dirs, files)
  for (const d of dirs) _遍历(join(root, d), 回调, 跳过)
}
