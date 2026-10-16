/**
 * forge.mods 的 JS 版 —— 模块：给卡挂上一块现成的机制。
 * ======================================================================
 *
 * 模块是什么：一张卡按需接的能力（骰子框、档案备份、点数池……）。骨架本身不带模块，
 * 不接就不拼 —— 文件里不会多一个字。
 *
 * 一个模块占一个目录 `assets/模块/<名>/`：
 *
 *     模块.json    清单：名 / 版本 / id / 一句话 / 需要 / 条目 / 正则 / 脚本 / 样式
 *     条目.yaml    往 spec 并的条目（可选）
 *     正则.json    往 spec 并的正则（可选）
 *     <名>.js      往 hud/模块/ 落的脚本（可选，需要工程有 hud/）
 *     <名>.css     往 hud/模块/ 落的样式（可选）
 *
 * **两类东西，两个去处**（这是模块系统的分界）：
 *
 *     条目 / 正则  →  source/<卡>.spec.yaml   —— 并一次就归这张卡，此后改就改 spec
 *     脚本 / 样式  →  <工程>/hud/模块/<名>/    —— 每次组装界面时重新拼，撤掉就删目录
 *
 * **账本（可撤）**：每接一个模块，都往工程里的 `模块账本.json` 记一笔 ——
 * 并了哪几条、替换的那条原来长什么样（整份存着）、撤的时候要删哪些正则与界面文件。
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 移植纪律（同 model.mjs / content.mjs / sandbox.mjs / scaffold.mjs 头上那几条）：
 * **行为照抄，不顺手改**。本模块与 Python 原版（`forge/mods.py`，682 行）的已知差异：
 *
 *   1. ★ `M.ydump()` 在 forgejs 里**是明确抛错**的（计划 §二①备案过的唯一差异：
 *      JS 侧不写 YAML、改写 JSON）。原版两处落盘（`apply_modules` 末尾、`drop_modules`
 *      末尾）一律改成 `M.jdump(spec, spec_path)` —— **与 Python 的 YAML 输出同构，
 *      差分比结构**（差分台 `_树()` 对 `.spec.` 文件走 `M.loadStructured` 做结构相等，
 *      不比字节；JSON 本身是 YAML 的流式子集，写完还能被 `M.yload` 原样读回）。
 *   2. 本模块**没有「依赖还没搬」的支路**：`mods.py` 只 `from . import model` 与
 *      `from . import sandbox`，两个都早已落地，所以这里全是静态 import。
 *   3. `os.path` → `node:path`；Python 的 `__file__` 在 `forge/` 下、JS 这份在
 *      `forgejs/lib/` 下，两者上两级都是工具根（同 scaffold.mjs 的注释）。
 *   4. Python 文本模式读是 **universal newlines**（`\r\n` / `\r` 都折成 `\n`）
 *      —— JS 的 `readFileSync(p,'utf8')` 不折，所以 `_读文本()` 显式折一次；
 *      写一律 `\n`（Python 那侧 `newline="\n"`）。本仓库真资产实测全是 LF。
 *   5. `copy.deepcopy` → `structuredClone`；`hashlib.sha1` → `node:crypto`。
 *   6. `_指纹()` 复刻的是 Python `json.dumps(obj, ensure_ascii=False, sort_keys=True)`
 *      —— 分隔符是 `", "` / `": "`（带空格），与 `JSON.stringify` 的紧凑写法不同，
 *      不照抄的话两侧 sha1 必不相等（见 `_pyJson`）。
 *   7. `OrderedDict` → 普通对象：JS 字符串键保留插入顺序，语义与 OrderedDict 一致
 *      （兄弟模块同此，见 model.mjs `ordered()`）。
 *   8. `raise ValueError(...)` → `new ValueError(...)`（本文件里那个同名子类）：
 *      差分台按 `type(exc).__name__` 记异常消息，叫 `Error` 就当场红了。
 *   9. Python 的真值判断（`if rows:` / `r.get("targets") or [...]`）与 JS `||`
 *      在**空表**上相反（`[]` 在 JS 里为真）⇒ 一律走 `_真()`。
 */
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as M from './model.mjs'
import * as SB from './sandbox.mjs'

const 这里 = dirname(fileURLToPath(import.meta.url))

/**
 * Python `os.path.join` 的等价物 —— **不做任何规范化**。
 *
 * ★ 这是被差分逮住的一处真差异（`mods` 差分第一次跑就红在 `ledger_path()` 的返回值上）：
 *   Node 的 `path.join` 会把已经存在的 `/` 折成 `\`、还会吃掉多余分隔符与 `.`，
 *   而 `ntpath.join` 只是拿第一段当底、后一段前面补一个 `os.sep`：
 *     os.path.join("D:/a", "b")  ==  "D:/a\\b"   ← 前段的斜杠原样留着
 *     path.join("D:/a", "b")     ==  "D:\\a\\b"  ← 被规范化，记进账本/差分当场对不上
 *   规则照 `ntpath.join`：后一段若带盘符或前导分隔符就整个换掉累加值。
 */
function _join(...片段) {
  let 结果 = null
  for (const 片段项 of 片段) {
    const s = String(片段项)
    if (s === '') continue
    if (结果 === null) { 结果 = s; continue }
    if (/^[A-Za-z]:/.test(s) || s[0] === '\\' || s[0] === '/') { 结果 = s; continue }
    if (结果 !== '' && !/[\\/]$/.test(结果)) 结果 += '\\'
    结果 += s
  }
  return 结果 === null ? '' : 结果
}

/** 工具根（`制卡工具/`）。Python 那边是 `os.path.dirname(os.path.dirname(__file__))`。 */
export const ROOT = resolve(这里, '..', '..')
export const MODS_DIR = _join(ROOT, 'assets', '模块')

export const LEDGER_NAME = '模块账本.json'
export const LEDGER_NOTE = '这张卡接过哪些模块、每个模块并进来了什么 —— 由 `forge add` / `forge drop` ' +
  '维护。**别手改**：撤模块全靠它，改坏了就撤不干净。'

// 模块不许碰的字段：目录顺序归卡自己
export const RESERVED = ['id', 'order', 'view_order', 'group_view_order', 'tree_view_order',
  'created_at', 'updated_at']
export const DIRECTIVE = ['替换', '底稿']

/**
 * 本文件里所有 `raise ValueError(...)` 用的类型。
 * 差分台记的是 `type(exc).__name__`，所以名字必须与 Python 一致（别写成 Error）。
 */
export class ValueError extends Error {
  constructor(消息) {
    super(消息)
    this.name = 'ValueError'
  }
}

// ------------------------------------------------------------------ 语义小工具
//
// 这几只都是「照抄 Python 的语义」，不是顺手加糖：Python 的 dict.get / 真值 / int() /
// str() / json.dumps 与 JS 的同名做法在边界上都不一样，差分逮得住。

const _有键 = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const _是表 = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const _是文件 = (p) => existsSync(p) && statSync(p).isFile()
const _是目录 = (p) => existsSync(p) && statSync(p).isDirectory()

/** Python `dict.get(k, 默认)`：**只有键不在**才用默认（值为 null 时返回 null）。 */
const _取 = (o, k, 默认) => (_有键(o, k) ? o[k] : 默认)

/** Python `bool(v)`：空表 / 空串 / 0 / None / False 为假，`[]` 在 JS 里是真、这里按假。 */
function _真(v) {
  if (v === null || v === undefined || v === false) return false
  if (typeof v === 'number') return v !== 0        // NaN 在 Python 里是真
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (_是表(v)) return Object.keys(v).length > 0
  return true
}

/** Python `str(v)` 里我们真会撞上的那几档（None / True / False / 数 / 串）。 */
function _字(v) {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v)
}

/** Python `int(v)`：整数、布尔、纯数字串才行，别的**抛 ValueError**（调用方照原样接）。 */
function _整数(v) {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v
    throw new ValueError(`invalid literal for int() with base 10: '${v}'`)
  }
  if (typeof v === 'string') {
    const s = v.trim()
    if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10)
    throw new ValueError(`invalid literal for int() with base 10: '${v}'`)
  }
  throw new TypeError(`int() argument must be a string or a number, not '${typeof v}'`)
}

/** `max(int(r.get("order") or 0) for r in 表)` —— 单条读不出来就跳过那一条（同 Python 的 try/except）。 */
function _最大序(表) {
  let m = 0
  for (const r of 表) {
    try {
      m = Math.max(m, _整数(_取(r, 'order', 0) || 0))
    } catch (e) {
      if (!(e instanceof ValueError) && !(e instanceof TypeError)) throw e
    }
  }
  return m
}

/**
 * 复刻 Python `json.dumps(obj, ensure_ascii=False, sort_keys=True)` 的**字面输出**。
 * 只给 `_指纹()` 用（sha1 比的是字面量，差一个空格就两边都不同）。
 * 已知边界：JS 分不出 `1` 与 `1.0`（JSON.parse 里 `1.0` 就是 `1`），这种值两侧会差。
 */
function _pyJson(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN'
    if (v === Infinity) return 'Infinity'
    if (v === -Infinity) return '-Infinity'
    return String(v)
  }
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(_pyJson).join(', ') + ']'
  if (_是表(v)) {
    const 键 = Object.keys(v).sort()
    return '{' + 键.map((k) => JSON.stringify(k) + ': ' + _pyJson(v[k])).join(', ') + '}'
  }
  return 'null'
}

/** Python 的 `print`（默认 out）：写到 stdout 且补一个 `\n`。 */
const _打印 = (s) => { process.stdout.write(_字(s) + '\n') }

/** Python 文本模式读（universal newlines）：`\r\n` 与孤 `\r` 都折成 `\n`。 */
const _读文本 = (p) => readFileSync(p, 'utf8').replace(/\r\n|\r/g, '\n')

/**
 * Python `json.dump(obj, f, ensure_ascii=False, indent=2)` ＋ `f.write("\n")`。
 *
 * `forge/mods.py:269-271`（hud.conf.json）与 `:309-311`（模块账本.json）都是
 * `with open(..., newline="\n")` ＋ `json.dump(...)` ＋ **再补一个换行** —— 少这一个字节，
 * `_树` 的 sha1 当场对不上（实测：就差在这里）。
 */
const _写Json = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8')

// ------------------------------------------------------------------ 清点
export function list_modules() {
  const out = []
  if (!_是目录(MODS_DIR)) return out
  for (const name of readdirSync(MODS_DIR).sort()) {
    const d = _join(MODS_DIR, name)
    const meta_path = _join(d, '模块.json')
    if (!_是文件(meta_path)) continue
    let meta
    try {
      meta = JSON.parse(_读文本(meta_path))
    } catch (exc) {
      // Python 那边是 `except Exception as exc`，消息取 str(exc)（JS 的 String(exc) 带类型名）
      meta = { 名: name, 一句话: `（清单读不出来：${exc && exc.message ? exc.message : exc}）` }
    }
    meta._dir = d
    meta._名 = meta.名 || name
    out.push(meta)
  }
  return out
}

export function find_module(name) {
  const key = String(name).trim()
  for (const m of list_modules()) {
    if (m._名 === key || m.id === key) return m
  }
  return null
}

// ------------------------------------------------------------------ 并入
export function project_of(spec_path) {
  const up = dirname(resolve(spec_path))
  return basename(up) === 'source' ? dirname(up) : up
}

/**
 * 把若干模块并进 spec（就地改写）。返回成功并进去的模块名列表。
 *
 * project：工程根。不传就从 spec_path 推（`<工程>/source/<卡>.spec.yaml`）。
 * 有 hud/ 的工程会顺便把模块的脚本/样式落进 `hud/模块/<名>/` 并登记进 conf。
 * **每接一个都往 `模块账本.json` 记一笔**，这样 `drop` 才撤得回来。
 */
export function apply_modules(spec_path, names, project = null, out = _打印) {
  const spec = M.yload(spec_path) || {}
  const 有条目 = (spec.library || {}).entries
  if (!_真(有条目)) {
    throw new ValueError(`这个 spec 里没有 library.entries，不像本工具的骨架规格：${spec_path}`)
  }
  if (project === null || project === undefined) project = project_of(spec_path)
  const ledger = load_ledger(project)
  if (ledger.模块 === undefined) ledger.模块 = {}
  const recorded = ledger.模块
  const done = []
  for (const raw of names) {
    const name = String(raw).trim()
    if (!name) continue
    const mod = find_module(name)
    if (!mod) {
      out(`  ✗ 没有这个模块：${name}（跑 \`forge mods\` 看有哪些）`)
      continue
    }
    const key = mod._名
    if (_有键(recorded, key)) {
      const have = _字(_取(recorded[key], '版本', null) || '?')
      out(`  · ${key} —— 已经接过（${have}），跳过。`)
      out(`        要换版本就先撤再接：forge drop ${key} <spec>，再 forge add ${key} <spec>`)
      continue
    }
    const rec = _apply_one(spec, mod, project, out)
    recorded[key] = rec
    done.push(key)
  }
  if (done.length) {
    // ★ 与 Python 的唯一差异：那边是 M.ydump（YAML），这里写 JSON —— 与 Python 的
    //   YAML 输出同构，差分只比结构（见文件头「移植记号」第 1 条）。
    M.jdump(spec, spec_path)
    save_ledger(project, ledger)
  }
  return done
}

function _apply_one(spec, mod, project, out) {
  const lib = spec.library
  if (lib.entries === undefined) lib.entries = []
  const entries = lib.entries
  if (lib.groups === undefined) lib.groups = []
  const groups = lib.groups
  const prefix = infer_prefix(spec)
  const mod_id = String(mod.id || mod._名)
  out(`  · ${mod._名} —— ${_字(_取(mod, '一句话', ''))}`)

  const rec = {
    id: mod_id,
    版本: String(mod.版本 || ''),
    接于: M.nowIso(),
    条目: { 替换: [], 新增: [] },
    正则: [],
    界面: [],
  }

  // ---- 条目
  const ent_file = mod.条目
  if (ent_file) {
    const rows = _read_yaml(_join(mod._dir, ent_file))
    let added = 0
    let replaced = 0
    let i = 0
    for (const row of rows || []) {
      i += 1
      if (!_是表(row)) continue
      const mode = _有键(row, '替换') ? '替换' : (_有键(row, '底稿') ? '底稿' : null)
      if (!mode) {
        out(`      ! 第 ${i} 条既没写「替换」也没写「底稿」，跳过`)
        continue
      }
      const ref = row[mode]
      const target = _match_entry(ref, entries)
      if (target === null) {
        out(`      ! 找不到参照条目 ${M.pyRepr(ref)}，跳过这一条`)
        continue
      }
      if (mode === '替换') {
        const before = M.ordered(structuredClone(target), M.ENTRY_KEYS)
        _merge_into(target, row, prefix, groups)
        rec.条目.替换.push({
          id: _取(target, 'id', ''),
          title: _取(target, 'title', ''),
          原: before,
          并入后: _fingerprint(target),
        })
        replaced += 1
      } else {
        const 新 = _clone_from(target, row, prefix, groups, mod_id, i, entries)
        if (新 === null) {
          out(`      = 条目已存在，跳过：${_字(_取(row, 'title', null))}`)
          continue
        }
        entries.push(新)
        rec.条目.新增.push({
          id: _取(新, 'id', ''),
          title: _取(新, 'title', ''),
          指纹: _fingerprint(新),
        })
        added += 1
      }
    }
    if (replaced) out(`      ✓ 替换了 ${replaced} 条（原样已记进账本，撤得回来）`)
    if (added) out(`      ✓ 新增了 ${added} 条（已记进账本）`)
  }

  // ---- 正则
  const re_file = mod.正则
  if (re_file) {
    const rows = _read_json(_join(mod._dir, re_file)) || []
    if (rows.length) {
      const ids = _add_regex(spec, rows, prefix, mod_id)
      rec.正则 = ids
      out(`      ✓ 并入 ${ids.length} 条正则（已记进账本）`)
    }
  }

  // ---- 脚本 / 样式（B 轨素材）：落进工程的 hud/模块/<名>/
  const placed = _install_hud(mod, project, spec, prefix, out)
  rec.界面 = placed
  for (const p of placed) out(`      ✓ ${p}`)
  return rec
}

/**
 * 把模块的脚本/样式落进 `<工程>/hud/模块/<名>/`，并登记进 hud.conf.json 的「模块」。
 *
 * 只并 spec 的模块（如骰子）**不进** conf 那个列表 —— 那个列表管的是「往这一页里
 * 拼哪几段代码」，没有代码可拼的模块写进去，组装时就去找一个不存在的目录。
 */
function _install_hud(mod, project, spec, prefix, out) {
  const name = mod._名
  if (!project) return []
  const hud_dir = _join(project, 'hud')
  const conf_path = _join(hud_dir, 'hud.conf.json')
  if (!_是文件(conf_path)) {
    if (mod.脚本 || mod.样式) {
      out('      · 这个工程没有 hud/（没有界面层），脚本与样式没地方放 —— 只并了 spec')
    }
    return []
  }

  const conf = JSON.parse(_读文本(conf_path))
  // 名字**以 conf 为准**（它才是这张卡界面层的事实来源），conf 里没写才退到 spec/推断
  const card_name = String(conf.卡名 || (spec.character || {}).name || '')
  prefix = String(conf.id_prefix || '').trim() || prefix
  const subs = [['骨架', card_name], ['SKEL', prefix.toUpperCase()], ['skel', prefix]]

  const placed = []
  for (const [key, tail] of [['脚本', '.js'], ['样式', '.css']]) {
    const src = mod[key]
    if (!src) continue
    const p = _join(mod._dir, String(src))
    if (!_是文件(p)) {
      throw new ValueError(`模块「${name}」说给了${key}「${src}」，文件不在：${p}`)
    }
    let text = _读文本(p)
    for (const [a, b] of subs) {
      if (b) text = text.split(a).join(b)
    }
    const dst_dir = _join(hud_dir, '模块', name)
    mkdirSync(dst_dir, { recursive: true })
    writeFileSync(_join(dst_dir, name + tail), text, 'utf8')
    placed.push(`hud/模块/${name}/${name}${tail}`)
  }

  if (!placed.length) return []

  const names = (conf.模块 || []).map((x) => String(x))
  if (!names.includes(name)) names.push(name)
  conf.模块 = names
  _写Json(conf_path, conf)
  out('      ✓ 已登记进 hud.conf.json 的「模块」')
  return placed
}

// ------------------------------------------------------------------ 账本
export function ledger_path(project) {
  return _join(project, LEDGER_NAME)
}

/** 读工程账本；没有就返回一份空的（不落盘）。 */
export function load_ledger(project) {
  const empty = { _说明: LEDGER_NOTE, 格式: 1, 模块: {} }
  if (!project) return empty
  const p = ledger_path(project)
  if (!_是文件(p)) return empty
  let data
  try {
    data = JSON.parse(_读文本(p))
  } catch (e) {
    return empty
  }
  if (!_是表(data)) return empty
  if (data.模块 === undefined) data.模块 = {}
  return data
}

export function save_ledger(project, ledger) {
  if (!project) return
  mkdirSync(project, { recursive: true })
  const out = {}
  out._说明 = LEDGER_NOTE
  out.格式 = 1
  out.模块 = {}
  for (const [k, v] of Object.entries(ledger.模块 || {})) out.模块[k] = v
  _写Json(ledger_path(project), out)
}

/** 一条条目的指纹：只比内容，不比键序与空白。用来判断「撤之前你动过没有」。 */
function _fingerprint(obj) {
  return createHash('sha1').update(_pyJson(obj), 'utf8').digest('hex').slice(0, 12)
}

function _by_id(entries, eid) {
  eid = String(eid || '')
  if (!eid) return null
  for (const e of entries) {
    if (String(e.id || '') === eid) return e
  }
  return null
}

// ------------------------------------------------------------------ 撤模块
/**
 * 把接过模块撤回来（add 的反操作）。按账本精确撤：
 *
 *     替换的条目 -> 还原成接之前那一份（原样在账本里存着）
 *     新增的条目 -> 删掉
 *     并进来的正则 -> 按 id 删掉
 *     落下的脚本/样式 -> 删目录 + 从 conf「模块」里摘掉
 *
 * 只撤账本里记着的。**手写进 spec 的东西一律不动**。
 */
export function drop_modules(spec_path, names, project = null, out = _打印) {
  const spec = M.yload(spec_path) || {}
  if (project === null || project === undefined) project = project_of(spec_path)
  const ledger = load_ledger(project)
  if (ledger.模块 === undefined) ledger.模块 = {}
  const recorded = ledger.模块
  const lib = spec.library || {}
  const entries = lib.entries
  if (entries === undefined || entries === null) {
    throw new ValueError(`这个 spec 里没有 library.entries，不像本工具的骨架规格：${spec_path}`)
  }
  const rules = spec.regex_rules || []

  const dropped = []
  for (const raw of names) {
    const name = String(raw).trim()
    if (!name) continue
    const key = _resolve_ledger_key(name, recorded)
    if (!key) {
      out(`  ✗ 账本里没有「${name}」。`)
      out('        这张卡没接过它；要么它是手写进 spec 的 —— 那种本工具不敢替你删，'
        + '要删自己改 spec。')
      continue
    }
    const rec = recorded[key] || {}
    out(`  · 撤 ${key}（版本 ${_字(_取(rec, '版本', null) || '?')} · 接于 ${_字(_取(rec, '接于', null) || '?')}）`)

    // ---- 1. 替换的：还原
    for (const item of ((rec.条目 || {}).替换 || [])) {
      const cur = _by_id(entries, item.id)
      const title = String(item.title || item.id || '?')
      if (cur === null) {
        out(`      ! 「${title}」已经不在了（你删过？），跳过`)
        continue
      }
      if (item.并入后 && _fingerprint(cur) !== item.并入后) {
        out(`      ⚠ 「${title}」接模块之后你又改过 —— 还原会把那处改动一起盖掉`)
      }
      entries[entries.indexOf(cur)] = M.ordered(structuredClone(item.原 || {}), M.ENTRY_KEYS)
      out(`      ✓ 还原「${title}」`)
    }

    // ---- 2. 新增的：删
    for (const item of ((rec.条目 || {}).新增 || [])) {
      const cur = _by_id(entries, item.id)
      if (cur === null) continue
      const title = String(item.title || item.id || '?')
      if (item.指纹 && _fingerprint(cur) !== item.指纹) {
        out(`      ⚠ 「${title}」是模块加的，但你改过 —— 还是照删（账本记着它归模块）`)
      }
      entries.splice(entries.indexOf(cur), 1)
      out(`      ✓ 删掉「${title}」`)
    }

    // ---- 3. 正则
    const ids = new Set((rec.正则 || []).map((x) => String(x)))
    if (ids.size) {
      const keep = rules.filter((r) => !ids.has(String(r.id)))
      const gone = rules.length - keep.length
      rules.length = 0
      for (const r of keep) rules.push(r)
      if (gone) out(`      ✓ 撤掉 ${gone} 条正则`)
    }

    // ---- 4. 界面
    _drop_hud(key, project, out)

    delete recorded[key]
    dropped.push(key)
  }

  if (dropped.length) {
    spec.regex_rules = rules
    M.jdump(spec, spec_path)
    save_ledger(project, ledger)
  }
  return dropped
}

/** 账本里的键是模块「名」；也容许用目录名或 id 来撤。 */
function _resolve_ledger_key(name, recorded) {
  if (_有键(recorded, name)) return name
  const mod = find_module(name)
  if (mod) {
    for (const k of [mod._名, basename(mod._dir)]) {
      if (_有键(recorded, k)) return k
    }
    for (const [k, rec] of Object.entries(recorded)) {
      if (String((rec || {}).id || '') === String(mod.id || '')) return k
    }
  }
  return null
}

function _drop_hud(name, project, out) {
  if (!project) return
  const conf_path = _join(project, 'hud', 'hud.conf.json')
  const folder = _join(project, 'hud', '模块', name)
  let removed = false
  if (_是目录(folder)) {
    // 沙箱里删不掉目录 —— 那也不影响结果：组装只按 conf 的「模块」列表拼，
    // 留下的目录是死的（conf 里已经没它了）。返回 false 让上层如实说一句。
    removed = SB.rmtree(folder)
  }
  if (_是文件(conf_path)) {
    let conf
    try {
      conf = JSON.parse(_读文本(conf_path))
    } catch (e) {
      conf = null
    }
    if (_是表(conf)) {
      const names = (conf.模块 || []).map((x) => String(x))
      if (names.includes(name)) {
        conf.模块 = names.filter((x) => x !== name)
        _写Json(conf_path, conf)
        out('      ✓ 从 hud.conf.json 的「模块」里摘掉')
      }
    }
  }
  if (removed) out(`      ✓ 删掉 hud/模块/${name}/`)
}

// ------------------------------------------------------------------ 小工具
/** 替换：把模块写了的字段盖上去，其余沿用被替那一条。 */
function _merge_into(target, row, prefix, groups) {
  for (const [k, v] of Object.entries(row)) {
    if (DIRECTIVE.includes(k) || RESERVED.includes(k)) continue
    target[k] = _resolve(k, v, prefix, groups)
  }
}

/** 底稿：照参照条目的形状克隆一条新的，模块字段盖上去，排到末尾。 */
function _clone_from(target, row, prefix, groups, mod_id, idx, entries) {
  const raw_id = String(row.id || `mod-${mod_id}-${idx}`).trim()
  const new_id = raw_id.startsWith(prefix + '-') ? raw_id : `${prefix}-${raw_id}`
  if (_match_entry(new_id, entries) !== null) return null   // 已经加过了（幂等）
  const 新 = {}
  for (const k of M.ENTRY_KEYS) {
    if (_有键(target, k) && !RESERVED.includes(k)) 新[k] = target[k]
  }
  for (const k of M.ENTRY_KEYS) {
    if (_有键(target, k) && RESERVED.includes(k) && k !== 'id') 新[k] = target[k]
  }
  新.id = new_id
  for (const [k, v] of Object.entries(row)) {
    if (DIRECTIVE.includes(k) || RESERVED.includes(k)) continue
    新[k] = _resolve(k, v, prefix, groups)
  }
  // 目录顺序：排到末尾
  const max_order = _最大序(entries)
  新.order = max_order + 1
  新.view_order = 0
  新.group_view_order = 0
  新.tree_view_order = max_order + 1
  新.created_at = M.nowIso()
  新.updated_at = 新.created_at
  return M.ordered(新, M.ENTRY_KEYS)
}

/** 把模块的正则并进去，返回并进去的那几条 id（账本要记）。 */
function _add_regex(spec, rows, prefix, mod_id) {
  if (spec.regex_rules === undefined) spec.regex_rules = []
  const rules = spec.regex_rules
  // 整体挪到现有正则之后，保持模块内部的相对先后
  const base = _最大序(rules) + 10
  const 序表 = rows.map((r) => _整数(_取(r, 'order', 0) || 0))
  const min_mod = 序表.length ? Math.min(...序表) : 0
  const used = new Set(rules.map((r) => r.id))
  const added = []
  let i = 0
  for (const r of rows) {
    i += 1
    const rid = `regex-${prefix}-${mod_id}-${i}`
    if (used.has(rid)) continue
    const rule = {}
    rule.id = rid
    rule.name = _取(r, 'name', '')
    rule.pattern = _取(r, 'pattern', '')
    rule.replacement = _取(r, 'replacement', '')
    rule.targets = _真(_取(r, 'targets', null)) ? r.targets : ['AiOutput']
    rule.enabled = _真(_取(r, 'enabled', true))
    rule.display_only = _真(_取(r, 'display_only', true))
    rule.prompt_only = _真(_取(r, 'prompt_only', false))
    rule.run_on_edit = _真(_取(r, 'run_on_edit', true))
    rule.order = base + (_整数(_取(r, 'order', 0) || 0) - min_mod)
    rules.push(M.ordered(rule, M.REGEX_KEYS))
    added.push(rid)
  }
  rules.sort((a, b) => _整数(_取(a, 'order', 0) || 0) - _整数(_取(b, 'order', 0) || 0))
  return added
}

// ------------------------------------------------------------------ 匹配与取数
/** 从 spec 里猜 id 前缀（骨架是 <前缀>-entry-xxx / <前缀>-grp-xxx）。 */
export function infer_prefix(spec) {
  const lib = spec.library || {}
  for (const g of (lib.groups || [])) {
    const gid = String(g.id || '')
    if (gid.includes('-grp-') && !gid.startsWith('grp-')) return gid.split('-grp-')[0]
  }
  for (const e of (lib.entries || [])) {
    const eid = String(e.id || '')
    for (const mark of ['-entry-', '-mod-']) {
      if (eid.includes(mark)) {
        const head = eid.split(mark)[0]
        if (head && head !== 'entry') return head
      }
    }
  }
  return M.asciiPrefix((spec.character || {}).name || '') || 'card'
}

function _match_entry(ref, entries) {
  ref = String(ref || '').trim()
  if (!ref) return null
  for (const e of entries) {
    if (String(e.id || '') === ref) return e
  }
  for (const e of entries) {
    if (String(e.id || '').endsWith('-' + ref)) return e
  }
  return null
}

/** 把模块写的分组（如 grp-world）对到这张卡真实的分组 id 上。对不上就留空。 */
function _match_group(ref, groups) {
  ref = String(ref || '').trim()
  if (!ref) return ''
  for (const g of groups) {
    if (String(g.id || '') === ref) return ref
  }
  for (const g of groups) {
    if (String(g.id || '').endsWith('-' + ref)) return String(g.id)
  }
  return ''
}

function _resolve(key, value, prefix, groups) {
  if (key === 'group_id') return _match_group(value, groups)
  return value
}

function _read_yaml(path) {
  if (!_是文件(path)) return []
  return M.yload(path) || []
}

function _read_json(path) {
  if (!_是文件(path)) return []
  return JSON.parse(_读文本(path))
}

// ------------------------------------------------------------------ 打印
/** 这个模块相对某张卡的状态：[标记, 说明]。recorded 是该卡的账本。 */
export function module_state(mod, recorded) {
  const repo = String(mod.版本 || '')
  const key = mod._名
  if (!_有键(recorded, key)) return ['未接', '']
  const have = String((recorded[key] || {}).版本 || '')
  if (!repo || !have || repo === have) return ['已接', (have || repo) ? 'v' + (have || repo) : '']
  return ['落后', `卡上 v${have} → 仓库 v${repo}`]
}

export function print_modules(project = null, out = _打印) {
  const mods = list_modules()
  if (!mods.length) {
    out(`没有找到任何模块（${MODS_DIR}）`)
    return
  }
  const recorded = project ? (load_ledger(project).模块 || {}) : {}
  if (project) {
    out(`可用模块（${mods.length} 个）· 这张卡：${basename(project)}`)
  } else {
    out(`可用模块（${mods.length} 个）—— 接法：python forge.py add <名> <你的 spec.yaml>`)
  }
  out('')
  let stale = 0
  for (const m of mods) {
    const bits = []
    if (m.条目) bits.push('条目')
    if (m.正则) bits.push('正则')
    const hud_bits = []
    if (m.脚本) hud_bits.push('脚本')
    if (m.样式) hud_bits.push('样式')

    const ver = _字(m.版本 || '—')
    let head = `  ${M.pad(m._名, 8)} v${M.pad(ver, 8)} ${_字(_取(m, '一句话', ''))}`
    if (project) {
      const [state, note] = module_state(m, recorded)
      const mark = { 已接: '●', 落后: '▲', 未接: '○' }[state]
      head = `  ${mark} ${M.pad(m._名, 8)} v${M.pad(ver, 8)} ${_字(_取(m, '一句话', ''))}`
      if (note) head += `  [${note}]`
      if (state === '落后') stale += 1
    }
    out(head)

    const meta = []
    if (m.id) meta.push(`id=${m.id}`)
    if (bits.length) meta.push('并进内容：' + bits.join('+'))
    if (hud_bits.length) meta.push('并进界面：' + hud_bits.join('+') + '（落 hud/模块/）')
    if (!bits.length && !hud_bits.length) meta.push('（这个模块什么都没给？）')
    if (meta.length) out(`         ${meta.join(' · ')}`)
    if (project && _有键(recorded, m._名)) {
      const rec = recorded[m._名] || {}
      const n_rep = ((rec.条目 || {}).替换 || []).length
      const n_new = ((rec.条目 || {}).新增 || []).length
      let 行 = `         已并：替换 ${n_rep} 条 · 新增 ${n_new} 条 · 正则 ${(rec.正则 || []).length} 条`
      if (_真(rec.界面)) 行 += ` · 界面文件 ${rec.界面.length} 个`
      out(行)
      out(`         撤法：python forge.py drop ${m._名} <spec>`)
    }
    const need = m.需要 || []
    for (const n of (Array.isArray(need) ? need : [need])) {
      let s = String(n)
      if (s.length > 96) s = s.slice(0, 95) + '…'
      out(`         需要：${s}`)
    }
    out('')
  }
  if (project) {
    out('标记：● 已接 · ○ 未接 · ▲ 仓库里的模块比你卡上那份新')
    if (stale) {
      out(`有 ${stale} 个模块更新了：先 forge drop 再 forge add 才会吃到新版`
        + '（卡上的条目归卡，工具不会偷偷替你覆盖）。')
    }
  }
}
