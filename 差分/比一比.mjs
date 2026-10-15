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

// draft 同理：它是把七个兄弟**全用上**的那一个（content / domain / model / opener /
// pack / scaffold / validate；mods 只在预检里惰性导入），落卡主路径还要 scaffold 里再要
// hud。它没落地时，别的模块照样能比。名字用 DR：D 已经是静态导入的 domain。
let DR = null
try {
  DR = await import('../forgejs/lib/draft.mjs')
} catch (e) {
  DR = null
}

// mods 同理：它只 import model / sandbox 两个兄弟，但同样不该因为自己没落地就牵连别人。
// 名字用 MO：M 已经是静态导入的 model。
let MO = null
try {
  MO = await import('../forgejs/lib/mods.mjs')
} catch (e) {
  MO = null
}

// hud 同理：它只 import model 一个兄弟（`from . import model as M`）。名字用 H：
// 剩下的单字母里只有它没被占（C / SC / O / DR / MO / M / D / Z / P / V / SB 都在用了）。
let H = null
try {
  H = await import('../forgejs/lib/hud.mjs')
} catch (e) {
  H = null
}

// bridge 同理：它只 import model 一个兄弟（`from . import model as M`）。名字用 BR：
// 剩下的单字母里 B 最顺手，但 scaffold 那边已经用了 BRIDGE，取 BR 免得后面撞。
let BR = null
try {
  BR = await import('../forgejs/lib/bridge.mjs')
} catch (e) {
  BR = null
}

// manual 同理：它 import model / pack / validate / domain / content 五个兄弟。名字用 MN：
// 与 `出黄金.py` 里的 `from forge import manual as MN` 同名，省得两边看串。
let MN = null
try {
  MN = await import('../forgejs/lib/manual.mjs')
} catch (e) {
  MN = null
}

// theme 同理：它 import model / sandbox 两个兄弟，另有一条**延迟导入** hud
// （`from . import hud as HUD` 写在函数体里）。名字用 TH：单字母 T 还没被占，
// 但 TH 与 `theme` 对得上、也不跟将来别的台子撞。
let TH = null
try {
  TH = await import('../forgejs/lib/theme.mjs')
} catch (e) {
  TH = null
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
    // ★ `*_at` 一律当时间（与出黄金.py 的 `_动` 同名分支逐字对应）：库里还有
    //   `config_updated_at` / `config_created_at` 这类不叫 created_at/updated_at 的时间戳，
    //   按名字枚举会漏 ⇒ 两侧各拿一次 `nowIso()`，差分必红。
    if (键 === 'created_at' || 键 === 'updated_at' || 键 === '时间' || (typeof 键 === 'string' && 键.endsWith('_at'))) return x.replace(_ISO, '<时间>')
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
  // Python 侧 `_换路径` 只递归 str / dict / list —— `bytes` 原样交回。
  // JS 的 Buffer 也是对象，不挡住会被拆成 `{0:.., 1:..}`。
  if (Buffer.isBuffer(x)) return x
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
  return 换路径(收_uuid(出), 对)
}

算式.opener = 算_opener

// -------------------------------------------------------------------- draft
//
// 又是同一个架构（预置夹具 → 逐步记 stdout／返回值／异常消息 → 最后比整棵工作树），
// 三处不一样：
//   ① 语料分「预置」与「操作」两段：预置建目录／写文件，操作才调 draft 的函数。
//   ② 落卡的稿子是**文件**，路径由语料给 ⇒ 预置里把稿写出来，操作只传路径。
//   ③ ★ 落卡**成功**那条主路径进不了语料：draft.落卡 第一步是
//      scaffold.new_card(..., build_hud=True)（Python 原件的默认值），JS 侧 scaffold.mjs
//      的 `_要(HUD,'hud')` 会明确抛错（hud.mjs 还没搬）。语料只覆盖 scaffold 之前的
//      早期分支；等 hud.mjs 落地，把「好稿 + --试／--覆盖／清空条目」补进操作即可。
//      理由与清单写在 差分/语料/draft.json 的「说明」里。
function 算_draft(料) {
  if (!DR) throw new Error('forgejs/lib/draft.mjs 没导入成功，先把它落地再跑 draft')
  // ★ 工作目录**建在工具根底下**（同 算_scaffold / 算_opener）：Windows 的 temp 可能是
  //   8.3 短名（`C:\Users\ADMINI~1\...`），Python 的 `os.path.abspath` 走
  //   `GetFullPathNameW`、Node 的 `path.resolve` 只做字符串规范化 —— 同一个目录两边会算出
  //   两个写法，归一用的 `<工作>` 替换当场失配。
  const 工作 = mkdtempSync(join(根, '_tmp_draft-'))
  // ★ 把**当前目录切进工作目录**（跑完切回来）：稿文件里的 `到` / `落点` / `to` 三个键，
  //   以及「一个 到 都不给」时 `os.path.abspath(None) or os.getcwd()` 那条支路，都拿相对
  //   路径 / 当前目录去解析。若让 cwd 停在工程根，`目标 = <cwd>/卡名` 不存在就会**走进主
  //   路径** —— Python 有 hud，真会当场在工程根里落出一张卡（实测污染过一次），而 JS 侧
  //   主路径被 hud.mjs 挡着。切进工作目录后 `目标` 落在我自己预置的夹具上，两侧都停在
  //   早期报错分支里，一个字节都不写。
  const 原目录 = process.cwd()
  process.chdir(工作)
  const 出 = { 步: [] }
  try {
    for (const 件 of 料.预置) {
      if (件.目录 !== undefined) {
        mkdirSync(join(工作, 件.目录), { recursive: true })
        continue
      }
      const p = join(工作, 件.文件)
      mkdirSync(dirname(p), { recursive: true })
      // 写文件一律落到字节上：两侧都不做换行翻译（Python 那边是 write_text(newline="\n")）。
      // `对象` 的形状与分隔符也要逐字节对齐：Python `json.dumps(ensure_ascii=False, indent=2)`
      // 与 JS `JSON.stringify(x, null, 2)` 对同一份数据给出同一串（末尾各加一个 \n）。
      let 文
      if (件.对象 !== undefined) {
        文 = JSON.stringify(换路径(件.对象, [['@工作@', 工作], ['@根@', 根]]), null, 2) + '\n'
      } else {
        文 = 换路径(件.文本, [['@工作@', 工作], ['@根@', 根]])
      }
      writeFileSync(p, 文, 'utf8')
    }
    for (const 步 of 料.操作) {
      // 与 Python 侧 `_换路径(参数, [("@工作@", str(工作)), ("@根@", str(根))])` 逐字对应：
      // dict / list 里的字符串也换（稿的 `到` 就藏在参数里的嵌套对象里）。
      const 参数 = 换路径(步.参数 ?? [], [['@工作@', 工作], ['@根@', 根]])
      const rec = { 调用: 步.调用, 参数 }
      let 出文 = ''
      const 原写 = process.stdout.write.bind(process.stdout)
      process.stdout.write = (s) => { 出文 += String(s); return true }
      try {
        // 有的名字是**常量**不是函数（Python 侧 `_条目特殊` 是 tuple、`_别名` 是 dict）
        // ⇒ 语料给一步 `"常量": true`，两侧都只取值、不调用。
        const 回 = 步.常量 ? DR[步.调用] : DR[步.调用](...参数)
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
    // 先切回来再删：Windows 上删不掉自己的 cwd。
    process.chdir(原目录)
    rmSync(工作, { recursive: true, force: true })
  }

  const 对 = [[工作, '<工作>'], [工作.split('\\').join('\\\\'), '<工作>']]
  return 换路径(出, 对)
}

算式.draft = 算_draft

// -------------------------------------------------------------------- mods
//
// 又是同一个架构（夹具硬编码 → 逐步记 stdout／返回值／异常消息 → 最后比整棵工作树），
// 与 算_scaffold / 算_draft 三处不一样：
//   ① 夹具（工程甲…工程己／库无／零条目／坏账本／数账本／落版本）全在下面硬编码，
//      **两侧建法必须一字不差** —— 语料只给「换」（改文件）与「调用」两类步子。
//   ② 账本里的「接于」是时间戳，而 `动()` 的 ISO 归一在**值**上只认 created_at /
//      updated_at / 时间 ⇒ 拍树之前要把每份 模块账本.json 里 ISO 形状的文本换成
//      `<时间>`（两侧同做；Python 侧 `_ISO.sub`，这边同一个正则），否则整棵树必红。
//   ③ 落盘形状：Python 侧 `json.dump(..., ensure_ascii=False, indent=2)`
//      **不补尾换行**（`forge/mods.py:269` / `:309`），所以 `mods.mjs` 的 `_写Json`
//      也不补 —— 夹具（`账本()`／`写文本()`）反过来两侧都补一个 `\n`，逐字节对齐。
function 算_mods(料) {
  if (!MO) throw new Error('forgejs/lib/mods.mjs 没导入成功，先把它落地再跑 mods')
  // ★ 工作目录**建在工具根底下**（同 算_scaffold / 算_opener / 算_draft）：Windows 的 temp 可能是
  //   8.3 短名（`C:\Users\ADMINI~1\...`），Python 的 `os.path.abspath` 走
  //   `GetFullPathNameW`、Node 的 `path.resolve` 只做字符串规范化 —— 同一个目录两边会算出
  //   两个写法，归一用的 `<工作>` 替换当场失配。
  const 工作 = mkdtempSync(join(根, '_tmp_mods-'))
  // ★ 把时钟钉死（与 Python 侧 `MMODEL.now_iso = lambda: 冻结` 对齐）。
  //   `_fingerprint()` 是 `sha1(条目)`，条目里带 `created_at` / `updated_at`
  //   （`_clone_from` 现取 `M.nowIso()`）⇒ 不钉死两侧指纹必然不同，黄金自己两次跑都不同。
  //   钉死用**本地** 2026-01-01T00:00:00（`new Date(...)` 各参数是本地时间），这样
  //   `nowIso()` 拼出来的就是 `2026-01-01T00:00:00.000000+08:00`。
  const 冻结毫秒 = new Date(2026, 0, 1, 0, 0, 0, 0).getTime()
  class 冻结Date extends Date {
    constructor(...a) { super(...(a.length ? a : [冻结毫秒])) }
    static now() { return 冻结毫秒 }
  }
  const 原Date = globalThis.Date
  globalThis.Date = 冻结Date

  const 写文本 = (p, 文) => {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, 文, 'utf8')
  }
  // 与 Python 侧 `改文本` 同形：文本模式读（折 CRLF）→ 逐对替换 → 按 \n 写。
  // Python 的 `str.replace` 是**全替换**，JS 的 `String.replace` 只换第一个 ⇒ 用 split/join。
  const 改文本 = (p, 对) => {
    let 文 = readFileSync(p, 'utf8').replace(/\r\n|\r/g, '\n')
    for (const [旧, 新] of 对) 文 = 文.split(旧).join(新)
    写文本(p, 文)
  }
  const 账本 = (表) => JSON.stringify({ _说明: MO.LEDGER_NOTE, 格式: 1, 模块: 表 }, null, 2) + '\n'
  // 与 Python 侧 `账本值` 同形：把「接于」改名成「时间」再走 `动()`。
  // `动()` 的 ISO 归一在**值**上只认 created_at / updated_at / 时间，账本那个键不在口径里 ——
  // 改名之后 `时间` 那一支才会换成 `<时间>`（落盘的那份文件另外有收尾一遍正则替换，见下）。
  const 账本值 = (x) => {
    if (Array.isArray(x)) return x.map(账本值)
    if (x && typeof x === 'object') {
      const o = {}
      for (const [k, v] of Object.entries(x)) o[k === '接于' ? '时间' : k] = 账本值(v)
      return o
    }
    return x
  }

  const 出 = {
    常量: {
      ROOT: MO.ROOT,
      MODS_DIR: MO.MODS_DIR,
      LEDGER_NAME: MO.LEDGER_NAME,
      LEDGER_NOTE: MO.LEDGER_NOTE,
      RESERVED: [...MO.RESERVED],
      DIRECTIVE: [...MO.DIRECTIVE],
    },
    操作: [],
  }
  try {
    const 骨架 = join(根, 'assets', '骨架')
    const 拷 = (名) => { const 目的 = join(工作, 名); 拷目录(骨架, 目的); return 目的 }

    const 工程甲 = 拷('工程甲')

    const 工程乙 = 拷('工程乙')
    unlinkSync(join(工程乙, 'hud', 'hud.conf.json')) // 没 hud 层的工程

    // 前缀不是 skel：走 infer_prefix 的 -grp- / -entry- 两支
    const 工程丙 = 拷('工程丙')
    改文本(join(工程丙, 'source', '骨架.spec.yaml'), [['grp-skel-', 'moonlight-grp-'], ['skel-', 'moonlight-']])

    // 前缀 card ＋ 目标条目已存在（_clone_from 的撞名分支）
    const 工程丁 = 拷('工程丁')
    改文本(join(工程丁, 'source', '骨架.spec.yaml'),
      [['skel-rule-check', 'card-entry-rule-check'], ['skel-world-core', 'card-mod-backup']])

    // 参照条目被改名 ⇒ 找不到参照条目
    const 工程戊 = 拷('工程戊')
    改文本(join(工程戊, 'source', '骨架.spec.yaml'), [['skel-rule-check', 'skel-sentinel']])

    // 账本说接过『代笔』，但 spec 里没有 ⇒ 撤时不还原、也不删
    const 接于 = '2020-01-01T00:00:00.000000+08:00'
    const 工程己 = 拷('工程己')
    写文本(join(工程己, '模块账本.json'),
      账本({ 代笔: { id: 'ai', 版本: '1.0.0', 接于, 条目: { 替换: [], 新增: [] }, 正则: [], 界面: [] } }))

    const 坏账本 = 拷('坏账本')
    写文本(join(坏账本, '模块账本.json'), '{这不是 JSON')

    const 数账本 = 拷('数账本')
    写文本(join(数账本, '模块账本.json'), '[]')

    // 账本里 v0.9.0 ⇒ print_modules 走「落后 ● ▲」那支
    const 落版本 = 拷('落版本')
    写文本(join(落版本, '模块账本.json'),
      账本({ 骰子: { id: 'dice', 版本: '0.9.0', 接于, 条目: { 替换: [], 新增: [] }, 正则: [], 界面: [] } }))

    写文本(join(工作, '库无', 'source', '空.spec.yaml'), 'library: {}\n')
    写文本(join(工作, '零条目', 'source', '零.spec.yaml'), 'library:\n  entries: []\n')

    for (const 步 of 料.操作) {
      if (步.换 !== undefined) {
        const p = 换路径(步.换.路径, [['@工作@', 工作], ['@根@', 根]])
        改文本(p, [[步.换.旧, 步.换.新]])
        出.操作.push({ 做: '换', 参数: [p], 回: null, 错: null, 出: '' })
        continue
      }
      // 与 Python 侧 `_换路径(参数, [("@工作@", str(工作)), ("@根@", str(根))])` 逐字对应。
      const 参数 = 换路径(步.参数 ?? [], [['@工作@', 工作], ['@根@', 根]])
      const rec = { 调用: 步.调用, 参数 }
      let 出文 = ''
      const 原写 = process.stdout.write.bind(process.stdout)
      process.stdout.write = (s) => { 出文 += String(s); return true }
      try {
        const 回 = MO[步.调用](...参数)
        rec.回 = 动(账本值(回 ?? null))
        rec.错 = null
      } catch (e) {
        rec.回 = null
        rec.错 = 净文本(`${e.constructor.name}: ${e.message}`)
      } finally {
        process.stdout.write = 原写
      }
      rec.出 = 净文本(出文)
      出.操作.push(rec)
    }

    // 账本里的「接于」不在 `动()` 的口径里 ⇒ 两侧都把 ISO 形状的文本换成 <时间>。
    // 顺序不影响结果（每个文件各换各的），排序只为两边步调一致、好读。
    const 账本们 = []
    const 收 = (base) => {
      let ents
      try { ents = readdirSync(base, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        const p = join(base, e.name)
        if (e.isDirectory()) 收(p)
        else if (e.name === '模块账本.json') 账本们.push(p)
      }
    }
    收(工作)
    for (const p of 账本们.sort()) 写文本(p, readFileSync(p, 'utf8').replace(_ISO, '<时间>'))

    出.树 = 走树(工作)
  } finally {
    globalThis.Date = 原Date
    rmSync(工作, { recursive: true, force: true })
  }

  const 对 = [[工作, '<工作>'], [工作.split('\\').join('\\\\'), '<工作>']]
  return 换路径(出, 对)
}

算式.mods = 算_mods

/**
 * 把语料里的参数折成真参数，逐项递归替换占位符。
 *
 * ★ 先 `JSON.stringify` 再 `JSON.parse`：语料里 dict / list 里的字符串（比如
 * `{"out": "@工作@/out.txt"}`）不能漏换；而 `@工作@` 后面常紧跟着中文（`@工作@/坏开场白`），
 * `\\b` 词边界在这种拼接上根本不可靠 —— 直接走一遍字符串化最稳，且与 `出黄金.py` 的
 * `出参数()`（那边是 json.dumps + json.loads）一字不差地对齐。
 */
function 出参数(x, 工作, 根) {
  if (typeof x === 'string') {
    return x.split('@根@').join(根).split('@工作@').join(工作)
      .split('@@重复x4100@@').join('x'.repeat(4100))
  }
  if (Array.isArray(x)) return x.map((v) => 出参数(v, 工作, 根))
  if (x && typeof x === 'object') {
    const 新 = {}
    for (const [k, v] of Object.entries(x)) 新[出参数(k, 工作, 根)] = 出参数(v, 工作, 根)
    return 新
  }
  return x
}

/** 返回值的额外归一（`动` 之前压一层）—— 与 出黄金.py 的 `动回()` 逐条对齐。 */
function 动回(x) {
  if (x instanceof RegExp) {
    return { 来源: x.source, i: x.flags.includes('i'), m: x.flags.includes('m'), s: x.flags.includes('s') }
  }
  if (Array.isArray(x)) return x.map(动回)
  return x
}

/** 异常消息归一 —— 与 出黄金.py 的 `错文本()` 逐条对齐（见那边的注释）。 */
function 错文本(调用, e) {
  if (调用 === 'configure' && e instanceof SyntaxError) return 'JSONDecodeError: 读不出来：<解析器原文>'
  return 净文本(`${e.constructor.name}: ${e.message}`)
}

// `patch_spec()` 给**新增**的正则规则生成 `regex-<uuid4>`。已有的 `_UUID8`（8 位十六进制）
// / `_文本8`（`-` 后 8 位、后面不再接十六进制）都收不住一个完整的 uuid4 —— 剩下
// `-7a74-49d8-986e-` 这几段每次跑都不一样，黄金当场变成「只有这一次对」的假黄金。
// 所以按**形状**再收一道（与 出黄金.py 的 `收_uuid()` 逐条对齐）。
const _UUID4状 = /^regex-.*-[0-9a-f]{4}-[0-9a-f]{4}-/

function 收_uuid(x) {
  if (typeof x === 'string') return _UUID4状.test(x) ? 'regex-<uuid4>' : x
  if (Array.isArray(x)) return x.map(收_uuid)
  if (x && typeof x === 'object') {
    const o = {}
    for (const k of Object.keys(x)) o[k] = 收_uuid(x[k])
    return o
  }
  return x
}

function 算_hud(料) {
  if (!H) throw new Error('forgejs/lib/hud.mjs 没导入成功，先把它落地再跑 hud')
  const 工作 = mkdtempSync(join(根, '_tmp_hud-'))
  const 出 = { 步: [] }

  // 先把夹具写盘（`预置.目录` 要在 `预置.文件` 之前建，路径里的父目录也自己建）。
  const 预置 = 料.预置 ?? {}
  for (const 名 of 预置.目录 ?? []) mkdirSync(join(工作, 名), { recursive: true })
  for (const [名, 文] of Object.entries(预置.文件 ?? {})) {
    const p = join(工作, 名)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, 文, 'utf8')
  }

  try {
    for (const 步 of 料.操作) {
      const 参数 = (步.参数 ?? []).map((a) => 出参数(a, 工作, 根))
      const rec = { 调用: 步.调用, 参数: 动(参数) }
      // ★ 出口**不复位**：hud.mjs 的 `_出口`（= Python 的模块级 `_P`）被 `build()` /
      //   `render_views()` 换掉之后两边都不还原 —— Python 的 `render_views` 默认把 `_P`
      //   换成空 lambda，JS 的默认 `out_fn` 是空函数，**后续步骤同样一个字都不出**，
      //   这才是照抄。复位成「打印」反而会让那几步的 `出` 红掉。
      //   收输出靠换 `process.stdout.write` —— `_print` 与那个空 lambda 之外的所有出口
      //   都是**调用时**才取 `process.stdout`，换得掉。
      let 出文 = ''
      const 原写 = process.stdout.write.bind(process.stdout)
      process.stdout.write = (s) => { 出文 += String(s); return true }
      try {
        const 回 = H[步.调用](...参数)
        rec.回 = 动(动回(回 ?? null))
        rec.错 = null
      } catch (e) {
        rec.回 = null
        rec.错 = 错文本(步.调用, e)
      } finally {
        process.stdout.write = 原写
      }
      rec.出 = 净文本(出文)
      出.步.push(rec)
    }
    出.树 = 走树(工作)
  } finally {
    rmSync(工作, { recursive: true, force: true })
  }

  const 对 = [[工作, '<工作>'], [工作.split('\\').join('\\\\'), '<工作>']]
  return 换路径(收_uuid(出), 对)
}

算式.hud = 算_hud

// -------------------------------------------------------------------- bridge
//
// 同一个架构（预置写夹具 → 逐步记 stdout／返回值／异常消息 → 最后比整棵工作树），
// 与 `算_opener` 两处不一样：
//   ① 夹具不是现成的工程目录，而是语料里「预置」当场写出来的 —— 里面有几份二进制
//      （PNG / zip），用 base64 驮在 JSON 里。
//   ② 参数里 `{"__字节__": "..."}` 还原成 Buffer（`decode_card_text` 收的就是 bytes，
//      PNG 那条路更是把「关键词 -> bytes」的字典整个交回来）；记进差分结构之前
//      反向包回 `{"__字节__": "..."}`，否则 Buffer 会被 `动()` 递归成
//      `{"0": .., "1": ..}` 那种键值对，跟黄金对不上。
function 算_bridge(料) {
  if (!BR) throw new Error('forgejs/lib/bridge.mjs 没导入成功，先把它落地再跑 bridge')
  // ★ 工作目录建在**差分根底下**，不用系统 temp：Windows 的 temp 路径可能是 8.3 短名
  //   （`C:\Users\ADMINI~1\...`），而 Python 的 `os.path.abspath` 走 `GetFullPathNameW`、
  //   Node 的 `path.resolve` 只做字符串规范化 —— 同一个目录两边会算出两个写法。
  const 工作 = mkdtempSync(join(这里, '_tmp_bridge-'))

  const 还原 = (x) => {
    if (Array.isArray(x)) return x.map(还原)
    if (x && typeof x === 'object') {
      const ks = Object.keys(x)
      if (ks.length === 1 && ks[0] === '__字节__') return Buffer.from(x.__字节__, 'base64')
      const o = {}
      for (const [k, v] of Object.entries(x)) o[k] = 还原(v)
      return o
    }
    return x
  }
  const 字节化 = (x) => {
    if (Buffer.isBuffer(x) || x instanceof Uint8Array) return { __字节__: Buffer.from(x).toString('base64') }
    if (Array.isArray(x)) return x.map(字节化)
    if (x && typeof x === 'object') {
      const o = {}
      for (const [k, v] of Object.entries(x)) o[k] = 字节化(v)
      return o
    }
    return x
  }

  for (const 件 of 料.预置 ?? []) {
    const p = join(工作, 件.路径)
    if (件.调用 === '写文本') writeFileSync(p, 件.文本, 'utf8')
    else writeFileSync(p, Buffer.from(件.字节, 'base64'))
  }

  const 出 = { 步: [] }
  for (const 步 of 料.操作) {
    // 与 Python 侧 `_换路径(还原(a), [("@工作@", str(工作))])` 逐字对应。
    // ★ 记进差分的参数要**另外**包一层 `字节化` —— 参数本身必须是 Buffer 交进去
    //   （`decode_card_text` 收的就是 bytes），但 Buffer 直接进 JSON 结构会被 `动()`
    //   拆成键值对。早先两处都写了 `字节化(还原(a))`，两者相消 ⇒ 函数拿到的是
    //   `{"__字节__": …}` 字典，Python 那边当场 `AttributeError: 'dict' object has no
    //   attribute 'strip'`，整条「bytes 入参」的路根本走不到。
    const 参数 = (步.参数 ?? []).map((a) => 换路径(还原(a), [['@工作@', 工作]]))
    const rec = { 调用: 步.调用, 参数: 字节化(参数) }
    let 出文 = ''
    const 原写 = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { 出文 += String(s); return true }
    try {
      const 回 = BR[步.调用](...参数)
      rec.回 = 动(字节化(回 ?? null))
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
  rmSync(工作, { recursive: true, force: true })

  const 对 = [[工作, '<工作>'], [工作.split('\\').join('\\\\'), '<工作>']]
  return 换路径(出, 对)
}

算式.bridge = 算_bridge

// ======================================================================================
//                              manual
// ======================================================================================
//
// 与 出黄金.py 的 `算_manual()` 逐字对应。两处与别的模块不一样，见那边的 docstring：
//   · 返回值里的**大字符串**（手册 HTML、索引 md）不整个记进差分 —— 折成 `_长文本`
//     （字节 / 行数 / sha1 前 16 / 首行 / 尾行）。落盘后的文件仍然进 `树`、逐字节比 sha1。
//   · 返回值里凡是**已经存在的文件路径**，一律顺带记一份 `产物` 形态。

/** Python 的 `s[:n]` —— 按码点切。 */
const 切码点 = (s, n) => Array.from(String(s)).slice(0, n).join('')

/**
 * `str(pathlib.Path(v))` —— Python 的 `Path` 在 Windows 上会**把 `/` 规范成 `\`**。
 *
 * ★ 差分里到处是「`@工作@/文档/x.html`」这种混着写的路径（`os.path.join` 只接分隔符、
 *   一个字都不规范化，所以前一截是 `\`、后一截是 `/`）。Python 侧 `_指纹()` 里
 *   `p = Path(v)` 一构造就把它们统一了，JS 这边若原样拼就少一道 ⇒ 必须在**这里**补上。
 */
function _Path文(s) {
  return String(s).split('/').join('\\')
}

/**
 * 一个文件在差分里的「形态」—— 与 出黄金.py 的 `_指纹()` 逐字对应。
 *
 * ★ `行数` 是 `len(文本.split("\n"))`（**空文件也算 1 行**），不是 `count("\n")+1`：
 *   两者只在「末尾有没有换行」上不同，而 golden 里 `</html>\n` 的 `尾行` 正是空串 ⇒ 必须照抄。
 */
function 产物指纹(p, 工作) {
  const b = readFileSync(p)
  const 文本 = b.toString('utf8')          // Python 是 decode("utf-8", errors="replace")
  const 行 = 文本.split('\n')
  const 原 = _Path文(p)
  const 工作反斜杠 = String(工作).split('\\').join('\\\\')
  return {
    路径: 原.split(String(工作)).join('<工作>').split(工作反斜杠).join('<工作>'),
    字节: b.length,
    行数: 行.length,
    sha1: createHash('sha1').update(b).digest('hex').slice(0, 16),
    首行: 切码点(动(行[0]), 200),
    尾行: 切码点(动(行[行.length - 1]), 200),
  }
}

/**
 * 返回值折成能比的结构 —— 与 出黄金.py 的 `折回()` 逐字对应。
 *
 * ★ 判断顺序**不能换**：先看「长字符串」（按码点 > 400），再看「是不是已存在的文件」。
 *   一条 400 字以上的路径在 Windows 上本来就 ISFILE 不到，但先把长度那条放前面才与
 *   Python 完全一致。
 */
function 折回(v, 工作) {
  if (typeof v === 'string') {
    if (Array.from(v).length > 400) {
      const b = Buffer.from(v, 'utf8')
      const 行 = v.split('\n')
      return {
        _长文本: {
          字节: b.length,
          行数: 行.length,
          sha1: createHash('sha1').update(b).digest('hex').slice(0, 16),
          首行: 切码点(动(行[0]), 200),
          尾行: 切码点(动(行[行.length - 1]), 200),
        },
      }
    }
    // `os.path.isfile(v)`：拿任意字符串去 stat，任何异常都算「不是文件」。
    let 存在 = false
    try {
      存在 = statSync(v).isFile()
    } catch {
      存在 = false
    }
    if (存在) return { _回: 动(v), 产物: 产物指纹(v, 工作) }
    return 动(v)
  }
  if (Array.isArray(v)) return v.map((x) => 折回(x, 工作))
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, x] of Object.entries(v)) o[k] = 折回(x, 工作)
    return o
  }
  return 动(v)
}

// ★ 两侧 JSON 解析器的报错措辞**天生不同**，而 manual 的 `load_card()` 会把
//   `json.JSONDecodeError` 原样抛到差分里（hud 那边是统一收成「<解析器原文>」，
//   这里没有那样做 —— 消息是证据，不该抹掉）。所以本模块**自己**把 Node 的说法翻成
//   Python 的说法。这张表只覆盖语料真正踩到的几种（语料每一种都有一条），
//   翻不出来的原样交回，宁可红也不要静默编一个。
const _JSON说法 = {
  "Expected property name or '}'": 'Expecting property name enclosed in double quotes',
  'Expected double-quoted property name': 'Expecting property name enclosed in double quotes',
  "Expected ':' after property name": "Expecting ':' delimiter",
  "Expected ',' or ']' after array element": "Expecting ',' delimiter",
  "Expected ',' or '}' after property value": "Expecting ',' delimiter",
}

/** Node 的 JSON.parse 报错 → CPython `json` 的报错原文。 */
function _json错文(e) {
  // Node 带位置的那一类：`Expected property name or '}' in JSON at position 2 (line 1 column 3)`
  const m = /^(.*?) in JSON at position (\d+) \(line (\d+) column (\d+)\)$/.exec(e.message)
  if (m) {
    const 前 = (m[1] in _JSON说法) ? _JSON说法[m[1]] : m[1]
    return `${前}: line ${m[3]} column ${m[4]} (char ${m[2]})`
  }
  // Node 不报位置的那一类：空输入。
  if (e.message === 'Unexpected end of JSON input') return 'Expecting value: line 1 column 1 (char 0)'
  return e.message
}

/**
 * 异常消息归一 —— 与 出黄金.py 的 `错文本()` 同名，但 manual 比它多两条翻译。
 *
 *   · `load_card()` 读的是 `M.jload()` ⇒ 坏 JSON 在 Python 侧是 `json.JSONDecodeError`，
 *     在 JS 侧是 `SyntaxError`（措辞还完全不同）⇒ 走 `_json错文` 翻译。
 *   · 文件不存在：Python 是 `FileNotFoundError: [Errno 2] No such file or directory: '<路径>'`，
 *     Node 是 `ENOENT: no such file or directory, open '<路径>'`，且 **Node 会把路径里的
 *     `/` 规范化成 `\`**（`e.path` 靠不住）⇒ 路径必须拿**传进去的那个原字符串**。
 */
function 错文本_manual(调用, e, 参数) {
  if (调用 === 'load_card' && e instanceof SyntaxError) {
    return 'JSONDecodeError: ' + _json错文(e)
  }
  if (调用 === 'load_card' && e && e.code === 'ENOENT') {
    return `FileNotFoundError: [Errno 2] No such file or directory: '${String(参数[0])}'`
  }
  return 净文本(`${e.constructor.name}: ${e.message}`)
}

function 算_manual(料) {
  if (!MN) throw new Error('forgejs/lib/manual.mjs 没导入成功，先把它落地再跑 manual')
  // ★ 工作目录建在**差分根底下**，不用系统 temp —— 同 算_hud / 算_bridge：Windows 的
  //   temp 可能是 8.3 短名（`C:\Users\ADMINI~1\…`），Python `abspath` 与 Node `resolve`
  //   会算出两种写法，而手册/索引的默认落点正是从 `abspath(输入路径)` 推出来的。
  const 工作 = mkdtempSync(join(这里, '_tmp_manual-'))
  const 出 = { 步: [] }
  try {
    const 预置 = 料.预置 ?? {}
    for (const 名 of 预置.目录 ?? []) mkdirSync(join(工作, 名), { recursive: true })
    for (const [名, 文] of Object.entries(预置.文件 ?? {})) {
      const p = join(工作, 名)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, 文, 'utf8')          // Python 是 write_text(newline="\n") ⇒ 原样写
    }

    for (const 步 of 料.操作) {
      // 语料里「参数」可以写单个值，也可以写数组；没有这个键就是无参。
      // `参数2` 是追加的第二个位置参数（`_cell(s, limit)` 这种两个位置的）。
      const 原参 = ('参数' in 步) ? 步.参数 : []
      const 参数 = (Array.isArray(原参) ? 原参 : [原参]).map((a) => 出参数(a, 工作, 根))
      if ('参数2' in 步) 参数.push(出参数(步.参数2, 工作, 根))

      const rec = { 调用: 步.调用, 参数: 动(参数) }
      let 出文 = ''
      const 原写 = process.stdout.write.bind(process.stdout)
      process.stdout.write = (s) => { 出文 += String(s); return true }
      try {
        const 回 = MN[步.调用](...参数)
        rec.回 = 折回(动回(回 ?? null), 工作)
        rec.错 = null
      } catch (e) {
        rec.回 = null
        rec.错 = 错文本_manual(步.调用, e, 参数)
      } finally {
        process.stdout.write = 原写
      }
      rec.出 = 净文本(出文)
      if (步.收出) rec.记出 = true
      出.步.push(rec)
    }
    出.树 = 走树(工作)
  } finally {
    rmSync(工作, { recursive: true, force: true })
  }

  const 对 = [[工作, '<工作>'], [工作.split('\\').join('\\\\'), '<工作>']]
  return 换路径(收_uuid(出), 对)
}

算式.manual = 算_manual

// -------------------------------------------------------------------- theme

const _读不出来 = /（读不出来：[^）]*）/

/** 把「值为整数的 float」折成 int（-0 也折成 0）—— 申报差异 1，理由见 `出黄金.py:_折浮`。 */
function 折浮(x) {
  if (typeof x === 'number' && Number.isFinite(x) && Number.isInteger(x)) return Object.is(x, -0) ? 0 : x
  if (Array.isArray(x)) return x.map(折浮)
  if (x && typeof x === 'object') {
    const o = {}
    for (const k of Object.keys(x)) o[k] = 折浮(x[k])
    return o
  }
  return x
}

/** 把 `（读不出来：…）` 里的正文换成 `<解析器说>` —— 申报差异 2，理由见 `出黄金.py:_折读不出来`。 */
function 折读不出来(x) {
  if (typeof x === 'string') {
    return x
      .replace(/（读不出来：[^）]*）/g, '（读不出来：<解析器说>）')
      // `import_theme()` 把解析器原话插在另一句话里（`是 json？）：…`），形状不同、同样只差措辞。
      .replace(/（不是 json？）：[\s\S]*$/, '（不是 json？）：<解析器说>')
  }
  if (Array.isArray(x)) return x.map(折读不出来)
  if (x && typeof x === 'object') {
    const o = {}
    for (const k of Object.keys(x)) o[k] = 折读不出来(x[k])
    return o
  }
  return x
}

/** 把「解析器读不出 json」的整条异常文本折成 `解析器: <解析器说>` —— 申报差异 3，理由见 `出黄金.py:_折解析器`。 */
function 折解析器(x) {
  if (typeof x === 'string' && /^(JSONDecodeError|SyntaxError): [\s\S]*$/.test(x)) return '解析器: <解析器说>'
  return x
}

function 算_theme(料) {
  if (!TH) throw new Error('forgejs/lib/theme.mjs 没导入成功，先把它落地再跑 theme')
  // `THEMES_DIR` 是模块级变量（`_join(ROOT, 'assets', '主题')`）。theme.mjs 把它写成
  // `export let` 并**在函数体里实时读那个绑定**，所以这里换它就是换这台子的主题库 ——
  // 跑完还原，真仓库的 `assets/主题/` 一个字节都不动（`import_theme(install=True)`
  // 否则会往里落外来主题，那是脏树）。跟 Python 侧直接赋值 `T.THEMES_DIR` 同效。
  const 原主题库 = TH.THEMES_DIR
  const 原沙箱 = SB.enabled()
  // ★ 沙箱开关是**进程级**状态，而算_sandbox（字母序排在 theme 前面）跑完会把它留在「开」上
  //   —— 它自己的黄金里 `enabled: true` 就是照实记的，两边都不还原（同 算_scaffold 的注释）。
  //   本函数的黄金必须与调用顺序无关，所以进门一律先关掉，出门再按原样还原。
  //   少了这一行：单跑 `比一比.mjs theme` 绿、整套 `跑.py` 红（实测差在第 1049 行 · 偏移 26584：
  //   乙工程清皮肤第 2 次 `回`，黄金 false「本来就是核心默认，没动。」而 JS true）。
  SB.enable(false)
  const 情形们 = []
  try {
    for (const 情形 of 料.情形) {
      const 工作 = mkdtempSync(join(根, '_tmp_theme-'))
      let 出 = null
      try {
        const 预置 = 情形.预置 ?? {}
        for (const 名 of 预置.目录 ?? []) mkdirSync(join(工作, 名), { recursive: true })
        for (const [名, 文] of Object.entries(预置.文件 ?? {})) {
          const p = join(工作, 名)
          mkdirSync(dirname(p), { recursive: true })
          writeFileSync(p, 文, 'utf8')
        }
        TH._setThemesDir(join(工作, 情形.主题库))

        出 = { 名: 情形.名 ?? null, 步: [] }
        for (const 步 of 情形.操作) {
          const 参数 = (步.参数 ?? []).map((a) => 出参数(a, 工作, 根))
          const rec = { 调用: 步.调用, 参数: 动(参数) }
          // 可选的 `"沙箱"`：那一分钟里把 `sandbox.enable()` 设成它，跑完还原。
          // `clear_theme()` 是 theme 里唯一碰沙箱的地方（`SB.shell`）。
          if ('沙箱' in 步) SB.enable(Boolean(步.沙箱))
          let 出文 = ''
          const 原写 = process.stdout.write.bind(process.stdout)
          process.stdout.write = (s) => { 出文 += String(s); return true }
          try {
            const 回 = TH[步.调用](...参数)
            rec.回 = 动(动回(回 ?? null))
            rec.错 = null
          } catch (e) {
            rec.回 = null
            rec.错 = 折解析器(错文本(步.调用, e))
          } finally {
            process.stdout.write = 原写
            if ('沙箱' in 步) SB.enable(false) // 回到本函数的基调（进门关掉那个），不是原沙箱
          }
          rec.出 = 净文本(出文)
          出.步.push(rec)
        }
        出.树 = 走树(工作)
      } finally {
        rmSync(工作, { recursive: true, force: true })
        TH._setThemesDir(原主题库)
      }
      const 对 = [[工作, '<工作>'], [工作.split('\\').join('\\\\'), '<工作>']]
      情形们.push(换路径(折读不出来(折浮(收_uuid(出))), 对))
    }
  } finally {
    TH._setThemesDir(原主题库)
    SB.enable(原沙箱)
  }
  return { 情形: 情形们, 沙箱还原: SB.enabled() === 原沙箱 }
}

算式.theme = 算_theme

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
