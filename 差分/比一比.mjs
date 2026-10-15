/**
 * 比一比 —— 用 **JS 版** 对同一份语料算一遍，和 `差分/黄金/<名>.json` **逐字节比**。
 *
 * 规矩：任何一处不同，要么是 bug，要么是有意为之的格式变更；后者必须先在
 * `文档/重写-JS引擎-计划.md` 里写明、再刷黄金。**不许悄悄放行。**
 *
 * 用法：
 *   node 差分/比一比.mjs            # 比全部
 *   node 差分/比一比.mjs model      # 只比某一份
 */
import { mkdtempSync, readFileSync, unlinkSync, readdirSync, rmSync, mkdirSync, existsSync, writeFileSync, copyFileSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as M from '../forgejs/lib/model.mjs'
import * as D from '../forgejs/lib/domain.mjs'
import * as Z from '../forgejs/lib/zod.mjs'
import * as P from '../forgejs/lib/pack.mjs'
import * as V from '../forgejs/lib/validate.mjs'
import * as SB from '../forgejs/lib/sandbox.mjs'

// content 是这一批里最大的一个，先用**动态导入**：它还没落地时，别的模块照样能比。
let C = null
try {
  C = await import('../forgejs/lib/content.mjs')
} catch (e) {
  C = null
}

// scaffold 同理：它要 import 的兄弟模块比 content 还多（hud / mods / bridge / pack / dist /
// opener），用动态导入，它没落地也不牵连别的模块。
let SC = null
try {
  SC = await import('../forgejs/lib/scaffold.mjs')
} catch (e) {
  SC = null
}

// opener 同理：它 import 的兄弟最少，但同样不该因为自己没落地就牵连别人。
let O = null
try {
  O = await import('../forgejs/lib/opener.mjs')
} catch (e) {
  O = null
}

const 这里 = dirname(fileURLToPath(import.meta.url))
const 根 = resolve(这里, '..')
const 语料目录 = join(根, '差分', '语料')
const 黄金目录 = join(根, '差分', '黄金')

const 读 = (p) => readFileSync(p, 'utf8')

function 算_model(料) {
  const 出 = {}
  出.常量 = {
    CARD_FORMAT: M.CARD_FORMAT,
    LIB_FORMAT: M.LIB_FORMAT,
    VAR_FORMAT: M.VAR_FORMAT,
    STAT_ROOT: M.STAT_ROOT,
  }
  出.键序 = {
    CHARACTER_KEYS: [...M.CHARACTER_KEYS],
    ENTRY_KEYS: [...M.ENTRY_KEYS],
    ENTRY_MESSAGE_KEYS: [...M.ENTRY_MESSAGE_KEYS],
    GROUP_KEYS: [...M.GROUP_KEYS],
    VAR_OBJECT_KEYS: [...M.VAR_OBJECT_KEYS],
    VAR_ITEM_KEYS: [...M.VAR_ITEM_KEYS],
    REGEX_KEYS: [...M.REGEX_KEYS],
  }
  出.ordered = 料.ordered.map((项) => Object.entries(M.ordered(项.src, 项.keys)))
  出.dispWidth = 料.dispWidth.map((文) => M.dispWidth(文))
  出.pad = 料.pad.map((项) => M.pad(项.text, 项.width, 项.align))
  出.estTokens = 料.estTokens.map((文) => M.estTokens(文))
  出.asciiPrefix = 料.asciiPrefix.map((项) => M.asciiPrefix(项.name, 项.fallback))
  出.stripUploadPrefix = 料.stripUploadPrefix.map((名) => M.stripUploadPrefix(名))
  出.issueLine = 料.issueLine.map((项) =>
    new M.Issue(项.level, 项.code, 项.where, 项.message, 项.fix).line())
  出.RE_SLASH = ['/abc/g', '〔面板〕', '/^.+$/isu', 'abc', '/a']
    .map((样本) => M.RE_SLASH.test(样本))
  出.isYaml = ['a.yaml', 'a.YML', 'a.json', 'a', 'a.txt'].map((名) => M.isYaml(名))

  出.jdump = 料.jdump.map((项) => {
    const 路径 = M.tempJson()
    try {
      M.jdump(项.obj, 路径, 项.indent)
      return 读(路径)
    } finally {
      try { unlinkSync(路径) } catch { /* 删不掉就算了 */ }
    }
  })

  出.形状 = {
    uuid4hex: /^[0-9a-f]{32}$/.test(M.uuid4hex()),
    newId: /^card-[0-9a-f]{32}$/.test(M.newId('card')),
    nowIso: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}[+-]\d{2}:\d{2}$/.test(M.nowIso()),
  }
  return 出
}

const 算式 = { model: 算_model }

function 算_domain(料) {
  const 出 = {}
  出.条目 = 料.条目.map((项) => D.checkEntryDomains(项.entry, 项.where).map((i) => ({
    level: i.level, code: i.code, where: i.where, message: i.message, fix: i.fix,
  })))
  出.值域键序 = Object.keys(D.DOMAINS)
  出.表 = {}
  for (const [名, d] of Object.entries(D.DOMAINS)) {
    出.表[名] = {
      values: [...d.values],
      default: d.default,
      legacy: { ...(d.legacy ?? {}) },
      unknown_to: d.unknownTo ?? null,
      note: d.note ?? '',
    }
  }
  出.表格 = D.domainTableMarkdown()
  出.说明 = {
    POSITION_NOTE: [...D.POSITION_NOTE],
    DEAD_FIELDS: { ...D.DEAD_FIELDS },
    EMPTY_IS_DEFAULT: [...D.EMPTY_IS_DEFAULT],
  }
  return 出
}

算式.domain = 算_domain

function 算_zod(料) {
  const 试 = (fn) => {
    try {
      return { 值: fn() }
    } catch (错) {
      if (错 instanceof Z.ZodError) return { 错: 'ZodError', 消息: 错.message }
      throw 错
    }
  }
  const 出 = {}
  出.解析 = 料.解析.map((项) => 试(() => Z.dump(Z.parse(项.code))))
  出.生成 = 料.生成.map((项) => 试(() => Z.emit(Z.parse(项.code))))
  出.往返 = 料.往返.map((项) => 试(() => Z.roundtrip_ok(项.code)))
  出.顶层键 = 料.顶层键.map((项) => 试(() => Z.top_keys(项.code)))
  出.是对象 = 料.是对象.map((项) => 试(() => Z.is_object(项.code)))
  出.类型表达式 = 料.类型表达式.map((项) => Z.expr_for(项.type, 项.value))
  出.键写法 = 料.键写法.map((名) => Z.key_raw(名))
  return 出
}

算式.zod = 算_zod

function 算_pack(料) {
  const 出 = { 卡: [] }
  for (const 相对 of 料.卡) {
    const 卡 = join(根, 相对)
    const 工作 = mkdtempSync(join(tmpdir(), 'packjs-'))
    const 规格 = join(工作, 'x.spec.json')
    P.unpack(卡, 规格)
    const 结构 = JSON.parse(readFileSync(规格, 'utf8'))
    const 重建 = join(工作, 'x.card.json')
    P.build(规格, 重建)
    出.卡.push({ 输入: 相对, 规格: 结构, 卡字节: readFileSync(重建, 'utf8') })
  }
  // 认卡守卫：不是 ElecKoi 卡时必须当场拒绝（只比消息，两边的异常类型名不同）
  出.非卡 = []
  for (const 相对 of 料.非卡 ?? []) {
    const 卡 = join(根, 相对)
    const 工作 = mkdtempSync(join(tmpdir(), 'packjs-'))
    try {
      P.unpack(卡, join(工作, 'x.spec.json'))
      出.非卡.push({ 输入: 相对, 值: '没报错（不该）' })
    } catch (错) {
      出.非卡.push({ 输入: 相对, 消息: 错.message })
    }
  }
  return 出
}

算式.pack = 算_pack

/** 一条诊断的差分形状（`HUD-CONF` 的报错原文两边天生不同，归一 —— 见 差分/语料/validate.json）。 */
const 诊断形状 = (i) => ({
  level: i.level,
  code: i.code,
  where: i.where,
  message: i.code === 'HUD-CONF' ? '读不出来：<解析器原文>' : i.message,
  fix: i.fix,
})

function 算_validate(料) {
  const 出 = { 卡: [], 工程: [] }
  for (const 相对 of 料.卡) {
    const card = M.jload(join(根, 相对))
    const issues = V.validate_card(card)
    出.卡.push({
      输入: 相对,
      诊断: issues.map(诊断形状),
      摘要: V.summarize(card),
      报告: V.report_text(card, 相对, issues),
      错误数: issues.filter((i) => i.level === 'ERROR').length,
    })
  }
  for (const 相对 of 料.工程) {
    const p = join(根, 相对)
    出.工程.push({
      输入: 相对,
      界面: V.validate_hud(p).map(诊断形状),
      工程: V.validate_project(p).map(诊断形状),
    })
  }
  return 出
}

算式.validate = 算_validate

/** 与 Python 侧 `_净化` 同一套：非有限数换成带类型名的标记，谁也别想悄悄当成字符串。 */
function 净化(x) {
  if (Array.isArray(x)) return x.map(净化)
  if (x && typeof x === 'object' && !(x instanceof Date)) {
    const out = {}
    for (const [k, v] of Object.entries(x)) out[String(k)] = 净化(v)
    return out
  }
  if (typeof x === 'number' && !Number.isFinite(x)) {
    return { __python类型__: 'float', __repr__: String(x) }
  }
  return x
}

function 算_yaml(料) {
  const 出 = { 文件: [] }
  for (const 相对 of 料.文件) {
    出.文件.push({ 输入: 相对, 结构: 净化(M.yload(join(根, 相对))) })
  }
  return 出
}

算式.yaml = 算_yaml

// ------------------------------------------------------------------ content
const _UUID8 = /[0-9a-f]{8}/g
const _ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}[+-]\d{2}:\d{2}/g
// 打在**人话里**的随机 id（`id      skel-entry-6912e0a8` 这种）：紧跟在 `-` 后面、且后面不再接
// 十六进制字符的 8 位十六进制才算 —— 免得把 12 位的指纹（sha1 前 12 位）咬掉一截。
const _文本8 = /(?<=-)[0-9a-f]{8}(?![0-9a-f])/g

const 净文本 = (s) => String(s).replace(_ISO, '<时间>').replace(_文本8, '<hex8>')

/** 与 Python 侧 `_动` 同一套：随机 id / 时间戳 / 回收站记录的位置，全部归一。 */
function 动(x, 键 = null) {
  if (typeof x === 'string') {
    if (键 === 'created_at' || 键 === 'updated_at' || 键 === '时间') return x.replace(_ISO, '<时间>')
    if (键 === 'id' || 键 === '谁' || (typeof 键 === 'string' && 键.endsWith('_id'))) return x.replace(_UUID8, '<hex8>')
    if (键 === '_文件') return '<回收站文件名>'
    if (键 === '_路径') return '<回收站路径>'
    // 兜底：任何**值**里那种「`-` 后面跟 8 位十六进制」的随机 id 尾巴（键名五花八门，
    // `变量id` / 数据里当键用的 id 都见过）—— 与其逐个键名去猜，不如按形状收。
    return x.replace(_文本8, '<hex8>')
  }
  if (Array.isArray(x)) return x.map((v) => 动(v, 键))
  if (x && typeof x === 'object') {
    const o = {}
    for (const [k, v] of Object.entries(x)) o[String(k).replace(_文本8, '<hex8>')] = 动(v, k)
    return o
  }
  return x
}

/** 整棵树的快照：普通文件比 sha1；spec 比**结构**；回收站记录按位次编号比结构。 */
function 走树(根) {
  const 项 = []
  let 第几条 = 0
  const 走 = (base) => {
    let ents
    try {
      ents = readdirSync(base, { withFileTypes: true })
    } catch {
      return
    }
    const dirs = ents.filter((e) => e.isDirectory()).map((e) => e.name).filter((d) => d !== '__pycache__').sort()
    const files = ents.filter((e) => e.isFile()).map((e) => e.name).sort()
    for (const f of files) {
      const p = join(base, f)
      const rel = relative(根, p).split('\\').join('/')
      // 回收站记录的名字与内容里都带随机量（时间戳 + uuid），只能按**位次**比结构。
      // 注意**嵌套的**也算（语料把多个夹具工程并排放进一个拷出来的根里，
      // rel 就成了 `甲界面/.forge/回收站/…`）—— 与 `出黄金.py` 的 `_树` 一字不差地对齐。
      if (f.endsWith('.json') && (rel.startsWith('.forge/回收站/') || rel.includes('/.forge/回收站/'))) {
        第几条 += 1
        let 记录
        try {
          记录 = JSON.parse(readFileSync(p, 'utf8'))
        } catch (e) {
          记录 = { 读不出来: String(e.message) }
        }
        项.push({ 路径: `.forge/回收站/<第 ${第几条} 条>.json`, 记录: 动(记录) })
        continue
      }
      if (f.includes('.spec.')) {
        项.push({ 路径: rel, 结构: 动(M.loadStructured(p)) })
        continue
      }
      项.push({ 路径: rel, sha1: createHash('sha1').update(readFileSync(p)).digest('hex') })
    }
    for (const d of dirs) 走(join(base, d))
  }
  走(根)
  return 项
}

function 换路径(x, 对) {
  if (typeof x === 'string') {
    let s = x
    for (const [a, b] of 对) s = s.split(a).join(b)
    return s
  }
  if (Array.isArray(x)) return x.map((v) => 换路径(v, 对))
  if (x && typeof x === 'object') {
    const o = {}
    for (const [k, v] of Object.entries(x)) o[换路径(k, 对)] = 换路径(v, 对)
    return o
  }
  return x
}

/**
 * 递归拷一棵目录树。
 *
 * ★ 别用 `cpSync(src, dst, {recursive:true})` —— 实测在本机这个 Node（v24.14.0）上，
 *   递归版**会把整个进程打崩**（退出码 `-1073740791` = 0xC0000409 STATUS_STACK_BUFFER_OVERRUN，
 *   连一行输出都不给）。单文件 `cpSync` 是好的，坏的是 recursive 那条路。
 *   Python 侧对应 `shutil.copytree`（它连 mtime 一起搬，这里也照做，免得两边对不上）。
 */
function 拷目录(src, dst) {
  const st = statSync(src)
  mkdirSync(dst, { recursive: true })
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (e.isDirectory()) 拷目录(s, d)
    else if (e.isFile()) {
      copyFileSync(s, d)
      utimesSync(d, st.atime, st.mtime)
    }
  }
  utimesSync(dst, st.atime, st.mtime)
}

function 算_content(料) {
  const 源 = join(根, 料.工程)
  const 工作 = mkdtempSync(join(tmpdir(), 'content-'))
  const 工程 = join(工作, '工程')
  拷目录(源, 工程)
  const 规格 = join(工程, 料.规格)

  const 出 = { 步: [] }
  for (const 步 of 料.操作) {
    const 参数 = (步.参数 ?? []).map((a) => (typeof a === 'string' ? a.replace('@根@', 工程) : a))
    const rec = { 调用: 步.调用, 参数 }
    let 出文 = ''
    const 原写 = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { 出文 += String(s); return true }
    try {
      const 回 = C[步.调用](规格, ...参数)
      rec.回 = 动(回 ?? null)
      rec.错 = null
    } catch (e) {
      rec.回 = null
      rec.错 = 净文本(`${e.constructor.name}: ${e.message}`)
    } finally {
      process.stdout.write = 原写
    }
    rec.出 = 净文本(出文)
    出.步.push(rec)
  }
  出.树 = 走树(工程)
  rmSync(工作, { recursive: true, force: true })

  const 对 = [[工程, '<工程>'], [工作, '<临时>'],
    [工程.split('\\').join('\\\\'), '<工程>'], [工作.split('\\').join('\\\\'), '<临时>']]
  return 换路径(出, 对)
}

算式.content = 算_content

// ------------------------------------------------------------------ scaffold
//
// 架构跟算_content 一样（喂进去 → 逐步记 stdout／返回值／异常消息 → 最后比整棵树），
// 两处不同：
//   ① 工作目录**建在工具根底下**，不能用系统 temp —— `scaffold._rel` 是 os.path.relpath
//      包了层 `except: return target`，Windows 上跨盘符 relpath 会抛、被吞掉后原样返回绝对
//      路径；Node 的 `path.relative` 不抛、会算出一串 `../../`。同盘才比得到同一条分支。
//   ② Python 侧那几支「一进门就要 opener」的调用（灌内容／_规整开场／看卡名／改卡名）在
//      JS 里是明确抛错，语料里刻意不碰它们，免得比成「真错」。
function 算_scaffold(料) {
  if (!SC) throw new Error('forgejs/lib/scaffold.mjs 没导入成功，先把它落地再跑 scaffold')
  const 工作 = mkdtempSync(join(根, '_tmp_scaffold-'))
  const 出 = {
    常量: {
      SRC_NAME: SC.SRC_NAME,
      SRC_SLUG: SC.SRC_SLUG,
      SKELETON: SC.SKELETON,
      TEXT_EXT: [...SC.TEXT_EXT].sort(),
      SKIP_DIRS: [...SC.SKIP_DIRS].sort(),
      SKIP_FILES: [...SC.SKIP_FILES].sort(),
    },
    开工说明: SC.PROJECT_README,
    步: [],
  }
  const 原沙箱 = SB.enabled()
  // ★ 沙箱开关是**进程级**状态，而算_sandbox（按字母序排在 scaffold 前面）跑完会把它留在
  //   「开」上 —— 它自己的黄金里 `enabled: true` 就是照实记的，两边都不还原。
  //   本函数必须与调用顺序无关：单独 `比一比.mjs scaffold` 与整套 `跑.py` 得出一模一样的结果。
  //   少了这一行，整套跑（沙箱还开着）会跟「关」着生成的黄金差一处（实测：改名 1 个 → 0 个）。
  SB.enable(false)
  try {
    mkdirSync(join(工作, '工作区'))
    mkdirSync(join(工作, '空卡'))
    mkdirSync(join(工作, '空目录'))
    mkdirSync(join(工作, '非空卡'))
    writeFileSync(join(工作, '非空卡', '里面.txt'), '占位\n', 'utf8')
    writeFileSync(join(工作, '非目录'), '我是个文件\n', 'utf8')
    mkdirSync(join(工作, '双spec', 'source'), { recursive: true })
    for (const 名 of ['a', 'b']) {
      copyFileSync(join(根, 'assets', '骨架', 'source', '骨架.spec.yaml'),
        join(工作, '双spec', 'source', `${名}.spec.yaml`))
    }

    for (const 步 of 料.操作) {
      if (步.开关) SB.enable(步.开关[0])
      const 参数 = (步.参数 ?? []).map((a) => (typeof a === 'string'
        ? a.split('@根@').join(根).split('@工作@').join(工作)
        : a))
      const rec = { 调用: 步.调用, 参数 }
      let 出文 = ''
      const 原写 = process.stdout.write.bind(process.stdout)
      process.stdout.write = (s) => { 出文 += String(s); return true }
      try {
        const 回 = SC[步.调用](...参数)
        rec.回 = 动(回 ?? null)
        rec.错 = null
      } catch (e) {
        rec.回 = null
        rec.错 = 净文本(`${e.constructor.name}: ${e.message}`)
      } finally {
        process.stdout.write = 原写
      }
      rec.出 = 净文本(出文)
      出.步.push(rec)
    }
    出.树 = 走树(工作)
  } finally {
    // 沙箱开关是模块级状态，语料里翻过就必须翻回来，不然会漏到后面的用例上
    SB.enable(原沙箱)
    rmSync(工作, { recursive: true, force: true })
  }

  const 对 = [[工作, '<工作>'], [工作.split('\\').join('\\\\'), '<工作>']]
  return 换路径(出, 对)
}

算式.scaffold = 算_scaffold

function 算_sandbox(料) {
  const 工作 = mkdtempSync(join(tmpdir(), 'sandbox-'))
  const 跑一遍 = (标签, 开关) => {
    SB.enable(开关)
    const 词根 = join(工作, 标签)
    mkdirSync(词根, { recursive: true })
    const 路 = (k) => (k.startsWith('@根@/') ? join(词根, k.slice(4)) : k)
    // 写 / 读 / 问在不在 —— 这几处的路径**一律相对词根**（夹具不该落到工作目录里）
    const 路相对 = (k) => (k.startsWith('@根@/') ? join(词根, k.slice(4)) : join(词根, k))
    const 步 = []
    for (const s of 料.步骤) {
      const 做 = s.做
      if (做 === '写') {
        const p = 路相对(s.路径)
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, s.内容, 'utf8')
        步.push({ 做, 路径: s.路径 })
      } else if (做 === '目录') {
        mkdirSync(路相对(s.路径), { recursive: true })
        步.push({ 做, 路径: s.路径 })
      } else if (做 === '在') {
        步.push({ 做, 路径: s.路径, 回: existsSync(路相对(s.路径)) })
      } else if (做 === '读') {
        const p = 路相对(s.路径)
        步.push({ 做, 路径: s.路径, 回: existsSync(p) ? readFileSync(p, 'utf8') : null })
      } else {
        const 参数 = (s.参数 ?? []).map((a) => (typeof a === 'string' ? 路(a) : a))
        // ★ `?? null`：Python 的 None 在 JS 里两侧都有（`null` 与 `undefined`）；
        //   `JSON.stringify` 会把 `undefined` 的键**整个丢掉**，与黄金的 `null` 就对不上了。
        步.push({ 做, 调用: s.调用, 回: SB[s.调用](...参数) ?? null })
      }
    }
    return 步
  }
  const 出 = { 关: 跑一遍('关', false), 开: 跑一遍('开', true) }
  const 开关 = []
  for (const s of 料.开关) 开关.push({ 调用: s.调用, 回: SB[s.调用](...(s.参数 ?? [])) })
  出.开关 = 开关
  出.enabled = SB.enabled()
  rmSync(工作, { recursive: true, force: true })
  return 出
}

算式.sandbox = 算_sandbox

// ------------------------------------------------------------------ opener
//
// 跟算_content 同一个架构（拷夹具 → 逐步记 stdout／返回值／异常消息 → 最后比整棵树）。
// 只有两点不同：
//   ① opener 的入口**有时是工程目录、有时是 spec 文件**，没有 content 那种固定的
//      「规格」首位参数 ⇒ 参数全写在语料里，`@根@` 照样替换成临时工程根。
//   ② 界面档的「写回 spec」支路要 hud.mjs 的 HUD.build（forgejs 还没搬）⇒ 语料刻意避开
//      那条支路（界面档的改正文只传 写回=false；写回() 只碰内容档／无开场白／标记数≠3／
//      找不到工程这四种**先 return 或先抛**的分支）。理由见 opener.mjs 头部的「移植记号」。
function 算_opener(料) {
  if (!O) throw new Error('forgejs/lib/opener.mjs 没导入成功，先把它落地再跑 opener')
  const 源 = join(根, 料.工程)
  // ★ 工作目录**建在工具根底下**，不用系统 temp：Windows 的 temp 路径可能是 8.3 短名
  //   （`C:\Users\ADMINI~1\...`），而 Python 的 `os.path.abspath` 走 `GetFullPathNameW`、
  //   Node 的 `path.resolve` 只做字符串规范化 —— 同一个目录两边会算出两个写法，
  //   归一用的 `<工程>` 替换就对不上。同盘同长名才比得到同一条分支（算_scaffold 同此法）。
  const 工作 = mkdtempSync(join(根, '_tmp_opener-'))
  const 工程 = join(工作, '工程')
  拷目录(源, 工程)

  const 出 = { 步: [] }
  for (const 步 of 料.操作) {
    // 与 Python 侧 `_换路径(a, [("@根@", str(工程))])` 逐字对应：dict / list 里的字符串也换。
    const 参数 = (步.参数 ?? []).map((a) => 换路径(a, [['@根@', 工程]]))
    const rec = { 调用: 步.调用, 参数 }
    let 出文 = ''
    const 原写 = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { 出文 += String(s); return true }
    try {
      const 回 = O[步.调用](...参数)
      rec.回 = 动(回 ?? null)
      rec.错 = null
    } catch (e) {
      rec.回 = null
      rec.错 = 净文本(`${e.constructor.name}: ${e.message}`)
    } finally {
      process.stdout.write = 原写
    }
    rec.出 = 净文本(出文)
    出.步.push(rec)
  }
  出.树 = 走树(工程)
  rmSync(工作, { recursive: true, force: true })

  const 对 = [[工程, '<工程>'], [工作, '<临时>'],
    [工程.split('\\').join('\\\\'), '<工程>'], [工作.split('\\').join('\\\\'), '<临时>']]
  return 换路径(出, 对)
}

算式.opener = 算_opener

/** 找第一处不同，返回人话。 */
function 第一处不同(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) {
      const 行号 = a.slice(0, i).split('\n').length
      const 左 = a.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, '⏎')
      const 右 = b.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, '⏎')
      return `  第 ${行号} 行 · 偏移 ${i}\n    黄金: …${左}…\n    JS  : …${右}…`
    }
  }
  if (a.length !== b.length) {
    const i = n
    return `  长度不同（黄金 ${a.length} / JS ${b.length}）· 从偏移 ${i} 起：\n` +
      `    黄金: …${a.slice(i).slice(0, 60)}…\n    JS  : …${b.slice(i).slice(0, 60)}…`
  }
  return ''
}

const 要跑的 = process.argv.slice(2)
const 名单 = 要跑的.length ? 要跑的 : Object.keys(算式).sort()
let 过 = 0
let 败 = 0
for (const 名 of 名单) {
  const 料 = JSON.parse(读(join(语料目录, `${名}.json`)))
  const js文本 = JSON.stringify(算式[名](料), null, 2)
  let 黄金文本
  try {
    黄金文本 = 读(join(黄金目录, `${名}.json`))
  } catch {
    console.log(`✘ ${名}：没有黄金文件，先跑 python 差分/出黄金.py ${名}`)
    败 += 1
    continue
  }
  if (js文本 === 黄金文本) {
    console.log(`✔ ${名}：逐字节一致（${Buffer.byteLength(js文本)} 字节）`)
    过 += 1
  } else {
    败 += 1
    console.log(`✘ ${名}：不一致`)
    console.log(第一处不同(黄金文本, js文本))
  }
}
console.log(`\n${败 === 0 ? '全绿 ✔' : '有红 ✘'}　${过} 绿 / ${败} 红`)
if (败 > 0) process.exitCode = 1
