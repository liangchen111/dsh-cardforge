/**
 * 照一份「卡稿」一次落成整张卡。
 *
 * 依据 Python 原件 `forge/draft.py`（815 行）逐字节等价重写 —— **行为照抄，不顺手改**。
 * 要改先改 Python 版再同步过来。
 *
 * 为什么有它
 * ──────────
 * `new` → `group` → `entry`×N → `var` → `regex` → `opener` → `build` → `check`
 * 是七八次进程启动。人用不累，**AI 在对话里用就贵得离谱**：每次调用都是一整轮
 * （上下文从头重发一遍）。内容想清楚之后，真正要的是「一次落成」。
 *
 * 稿子写的是**这张卡该长什么样**，不是「先做这步、再做那步」：
 *
 *   · 条目按**标题**认人 —— 卡里已有同名的就改它，没有才新建。
 *     所以不必先搞清楚骨架里现成有什么。
 *   · 分组 / 变量对象缺了就自动补，只在报告里说一句（名字打错也看得见）。
 *   · **全程在临时目录里做，全绿了才整棵拷到目标位置。**
 *     稿子有毛病时，目标位置**一个字都不会被写** —— 这是这个命令最要紧的一条。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 移植记号（与 Python 原件的**唯一**差异，都是备案过的）
 *
 * 1. 本模块**没有**任何 `M.ydump` 调用 —— 原文里也就没有（全篇只读、只写 JSON）。
 *    凡与 Python 的 YAML 输出同构的地方，走的都是 `M.jdump`（差分比结构）。
 * 2. `mods`：Python 在 `预检()` 里 `from . import mods as MODS`（惰性导入）。
 *    JS 侧照 `scaffold.mjs` 的规矩在模块顶部 `await import('./mods.mjs')`，
 *    拿不到就由 `_要()` **明确抛错** —— mods.mjs 一落地，这条支路自动点亮。
 * 3. `scaffold.new_card(..., build_hud=True)` 内部要 `hud.mjs`（`HUD.build`）：
 *    Python 侧 `draft.落卡` 走的就是默认值 True。hud.mjs 未搬之前，
 *    JS 侧的 `落卡` 主路径会在 scaffold 里明确抛错（不在本模块里另写替代实现）。
 */

import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

import * as CONTENT from './content.mjs'
import * as domain from './domain.mjs'
import * as M from './model.mjs'
import * as OPENER from './opener.mjs'
import * as pack from './pack.mjs'
import * as scaffold from './scaffold.mjs'
import * as validate from './validate.mjs'

// ---------------------------------------------------------------- 惰性支路
/** 照 `scaffold.mjs` 的写法：拿不到就 null，用的时候由 `_要()` 明确抛错。 */
const _懒 = async (名) => {
  try { return await import(`./${名}.mjs`) } catch { return null }
}
const MODS = await _懒('mods')

/** `out=print` 的 JS 侧代身（同 content.mjs:`_print`）。 */
const _print = CONTENT._print

function _要(mod, 名) {
  if (!mod) {
    throw new Error(`forgejs 还没搬 ${名}.mjs —— 这条支路暂时走不通（Python 原件里这儿的 import 照原文留着）。`)
  }
  return mod
}

// ---------------------------------------------------------------- 异常
export class DraftError extends Error {
  /** 卡稿本身的问题 —— 这类错**一个字都不该落盘**。 */
  constructor(message) {
    super(message)
    this.name = 'DraftError'
  }
}

/** `FileNotFoundError`（逐字节比对时按 `type(exc).__name__` 比，名字要与 Python 一致）。 */
export class FileNotFoundError extends Error {
  constructor(message) { super(message); this.name = 'FileNotFoundError' }
}
/** `NotADirectoryError`。 */
export class NotADirectoryError extends Error {
  constructor(message) { super(message); this.name = 'NotADirectoryError' }
}
/** `PermissionError`。 */
export class PermissionError extends Error {
  constructor(message) { super(message); this.name = 'PermissionError' }
}

export function _静(..._a) {
  /** 给底下的 add_xxx / set_xxx 用的空输出 —— 这一步的细节由本模块汇总后再报。 */
}

// ---------------------------------------------------------------- 小工具
const _文 = (v) => String(v ?? '')

/**
 * Python 的 `os.path.join` —— 只是「没以分隔符结尾就补一个 `\`」，**不做规范化**。
 * Node 的 `path.join` 会把正斜杠一起收掉，逐字节比就栽在这一条上（同 scaffold.mjs:125）。
 */
const _pyJoin = (...段) => 段.reduce((a, b) => {
  b = _文(b)
  if (a === '') return b
  if (b === '') return a
  if (/^[\\/]/.test(b) || /^[A-Za-z]:/.test(b)) return b // 绝对路径（或带盘符）直接接管
  return /[\\/]$/.test(a) ? a + b : `${a}\\${b}`
}, '')

/** `str(exc)` —— Python 的异常文本就是它的 message。 */
const _错文 = (exc) => (exc && typeof exc === 'object' && 'message' in exc
  ? String(exc.message) : CONTENT.pyStr(exc))

const _是文件 = (p) => { try { return statSync(p).isFile() } catch { return false } }
const _是目录 = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const _是字典 = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** `type(x).__name__` —— 只够本模块报错用。 */
function _型名(v) {
  if (v === null || v === undefined) return 'NoneType'
  if (Array.isArray(v)) return 'list'
  if (typeof v === 'string') return 'str'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float'
  return 'dict'
}

/**
 * `os.listdir(p)` —— 出错时按 Python 的异常类型与文本抛。
 *
 * ★ Windows 上 Python 的 OSError 文本长这样：`[WinError 267] 目录名称无效。: '<路径>'`
 *    —— 冒号前面那截是 **FormatMessageW 按系统语言给的**，Node 的 fs 错误里根本没有
 *    （`err.winerror` 不存在，只有 code/errno：ENOENT=-4058、ENOTDIR=-4052），
 *    所以只能把本机（中文 Windows）的原文照抄下来，跟 scaffold.mjs:212-219 一个口径。
 *    三条实测（本机 E:\workGZQ\制卡工具 上跑 Python 3 得的原文）：
 *      os.listdir(文件)                  → NotADirectoryError: [WinError 267] 目录名称无效。: '…'
 *      os.listdir(不存在的路径，父目录在不在都一样) → FileNotFoundError: [WinError 3] 系统找不到指定的路径。: '…'
 *      os.listdir('C:\\System Volume Information') → PermissionError: [WinError 5] 拒绝访问。: '…'
 *    路径是 **repr** 进来的（OSError 的格式化用 %r）：反斜杠翻倍、单引号包住。
 */
function _列目录(p) {
  try { return readdirSync(p) } catch (exc) {
    const 码 = exc && exc.code
    const 文 = M.pyRepr(String(p))
    if (码 === 'ENOENT') throw new FileNotFoundError(`[WinError 3] 系统找不到指定的路径。: ${文}`)
    if (码 === 'ENOTDIR') throw new NotADirectoryError(`[WinError 267] 目录名称无效。: ${文}`)
    if (码 === 'EACCES' || 码 === 'EPERM') throw new PermissionError(`[WinError 5] 拒绝访问。: ${文}`)
    throw exc
  }
}

/** Python 的字符串比较（按**码点**，不是按 UTF-16 码元）。 */
function _比串(a, b) {
  const x = Array.from(String(a), (c) => c.codePointAt(0))
  const y = Array.from(String(b), (c) => c.codePointAt(0))
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) if (x[i] !== y[i]) return x[i] - y[i]
  return x.length - y.length
}

/** Python 的 `a or b or c …`。 */
const _或 = (...xs) => {
  for (const x of xs) if (CONTENT.pyTruthy(x)) return x
  return xs.length ? xs[xs.length - 1] : null
}

// 「照着填」的起点：空手想 YAML 的键名最容易卡壳。
// **它自己必须是一份能跑的稿子** —— 自检第 44 项会把它原样落一遍，出不来绿卡就算失败。
// 所以这里没注释掉的部分是「打开就能跑」，注释掉的是「按需打开的可选件」。
export const _模板 = `# ElecKoi 卡稿 —— 只有「卡名」是必填，其余不要就删掉。
# 填完照这份稿子做卡：python forge.py make 这份文件.yaml
#
# 条目按**标题**认人：卡里已有同名的就改它，没有才新建 ——
# 所以不必先搞清楚骨架里现成有什么。想删掉骨架自带的条目，写「删: true」。

卡名: 我的卡
# 到: E:/卡库                 # 落点；不给就用当前目录，也可以用 --到
# 模块: [骰子]                # 想接现成机制就写（有哪些：python forge.py mods）
# 清空条目: true              # 把骨架自带、而这份稿子里没提到的条目清掉
# 分组: [角色, 世界]          # 可以声明；条目里用到而没声明的也会自动建出来

条目:
  - 标题: 核心 · 世界总纲      # 与骨架同名 -> 改它（不是删了重建）
    正文: |
      这里是……

  - 标题: 角色 · 某某          # 骨架里没有 -> 新建
    模板: 必读                # 常驻 / 必读 / 关键词 / 选读
    分组: 角色
    提示: 玩家和他说话、或问起他时读这条
    正文: |
      ……

  - 标题: 世界 · 某某
    模板: 关键词
    分组: 世界
    关键词: [甲, 乙, 丙]
    提示: 玩家问起甲、乙、丙时读这条
    正文: |
      ……

# 变量（写到的对象缺了会自动建出来）
# 变量:
#   - 对象: 玩家
#     名: 信任
#     类型: number            # string / number / boolean / array / object
#     初值: 0
#     说明: 玩家对这个人的信任

# 正则
# 正则:
#   - 名: 方括号转引号
#     模式: "【(.*?)】"
#     替换: "「$1」"

# 开场白（末尾那三个零宽标记归工具管，别自己写）
# 开场白: |
#   夜色落下来的时候……
`

export function 卡稿模板() {
  /** 一份能直接跑的卡稿骨架 —— `make --模板` 打的就是它。 */
  return _模板
}

// 「照着抄」的整份稿子 —— `make --示例` 打的就是它，`forge.py coach` 还会把它
// 落成 `向导/示例卡稿.yaml`（一份内容两个出口，跟规程那边一个规矩）。
//
// 它跟 _模板 的分工：
//   · `--模板` 回答「有哪些键、怎么缩进」—— 空格占位，得自己填。
//   · `--示例` 回答「**话该写到什么程度**」—— 一张真能开局的卡，形状与内容都能照抄。
//     AI 最容易失手的地方不是键名，是「写多细算够」「哪句话放常驻、哪句放关键词」，
//     一份好样板比十条规则管用。
//
// **它自己必须是一份能跑的稿子** —— 自检第 45 项会原样落一遍，出不来绿卡就算失败。
// 所以它只用了 draft 真支持的键；多加一个没实现的键，自检立刻红。
//
// ★ 原件是 Python 的 `r"""…"""`（**原始字符串**）⇒ 里面那两个正则的 `\n` 是**字面
//   反斜杠加 n**，不是换行。JS 模板串里必须写成 `\\n`，写成一个 `\n` 就当场变成一个真换行。
export const _示例 = `# ════════════════════════════════════════════════════════════════════
#  一份「照着抄」的卡稿 —— 长夜便利店
# ────────────────────────────────────────────────────────────────────
#  它不是骨架，是一张真能开局的卡：**形状**（写哪些键、怎么缩进）与
#  **内容**（话该写多细、哪句话该放哪一层）都照它来。
#
#  做出来：    python forge.py make 示例卡稿.yaml --到 E:/卡库
#  只验不动盘：在上面那条后面加 --试
#
#  自己开新卡时：**把这份稿子整个留下来当底子**，把设定换成你的 ——
#  别对着空文件一格一格想键名。（只想看键名：python forge.py make --模板）
# ════════════════════════════════════════════════════════════════════

卡名: 长夜便利店

# 模块：想接现成机制就写（有哪些：python forge.py mods）。这张卡不用，所以留着注释。
# 模块: [骰子]

# 清空条目：把骨架自带、这份稿子里又没提到的条目清掉。
# 本卡把骨架那四条都处理了（三条改写、一条删掉），所以开它不会误伤自己写的东西。
# 不写这一行，骨架的占位条目会全留在卡里，跟着一起进提示。
清空条目: true

# 条目里用到的分组会自动建出来；这里声明一遍，是为了「光看稿子就知道卡长什么样」。
分组: [角色, 世界, 规则]

# ── 变量 ────────────────────────────────────────────────────────────
# 只有「会变、而且要跨轮记住」的东西才配进变量。动手前三个问题要答全：
# 哪些字段、初值多少、什么条件下更新 —— 答不全就先别加。
对象:
  - 名: 阿岩
    说明: 店长本人的状态。她累不累、信不信玩家，都记在这儿；写进正文就改不动了。
    更新规则: 只按正文里真实发生过的事改；没发生过的不许凭空增减。

变量:
  - 对象: 玩家
    名: 信任
    类型: number            # string / number / boolean / array / object
    初值: 0
    说明: 阿岩对玩家的信任，0 到 100。升靠「说到做到」，降靠「答应的事没做」。
  - 对象: 阿岩
    名: 倦意
    类型: number
    初值: 1
    说明: 0 到 5。这一班阿岩累到什么程度 —— 决定她话多话少、还耐不耐烦。

# ── 条目 ────────────────────────────────────────────────────────────
# 条目按**标题**认人：卡里已有同名的就改它，没有才新建。
# 下面每段前面的 ①②③ 是「这一步在干什么」的批注，你自己写稿时不用抄。
条目:

  # ① 常驻：每轮都进提示，字数就是成本。这张卡只留一条常驻。
  - 标题: 核心 · 世界总纲
    正文: |
      【长夜便利店】

      你演夜班店长阿岩。玩家是凌晨推门进来的客人 —— 他不知道这家店为什么整夜不熄灯，你也不打算解释。
      整张卡的调子：安静、克制、留白。冷的比热的多，说的比想的多。

      三条不许违背：
      一、查库。下面的条目都不在提示里，是按需去读的；需要时自己取，别凭印象编。
      二、变量。面板上的数字只在事情真的发生时变，不许替玩家发明。
      三、口吻。先确认这一条还在，再动笔。句子短，形容词少，不替玩家做决定。

  # ② 骨架里有这一条（同名），所以这里是**改它**、不是删了重建 —— id 不动，
  #    卡里引用它的地方不会断。分组没变，写出来只是让稿子自洽（写错了会当场挪过去）。
  - 标题: 规则 · 判定
    模板: 关键词
    分组: 规则
    关键词: [判定, 掷骰, 检定]
    提示: 需要判断一件事成不成、要不要掷骰时读我。
    正文: |
      【判定】

      能靠常识定的事**不要**掷骰 —— 凌晨两点的便利店里，开门、找零、泡面，都是「成」。
      只有结果真的两说、而且两种结果都好看的时候才掷：先说清掷什么、什么算成，
      再掷 1d100，低于目标值算成。掷完必须在正文里落一个**能读出来的结果**，
      不许只说一句「你成功了」。
      判定只决定「世界怎么回应」，不用来决定「她喜不喜欢你」。

  # ③ 同样是改骨架原有的条目。这条是「选读」：每轮只把标题和「什么时候读我」
  #    放进目录，AI 觉得用得上才真去读 —— 比常驻省得多。
  - 标题: 名册 · 常用名字
    模板: 选读
    提示: 要临时给配角取名、或确认某个名字属于谁时读我。
    正文: |
      【凌晨的名字】

      阿岩记得的熟客（收银小票上的叫法）：
        连帽衫 —— 每晚两点半，一罐黑咖啡，从不说话
        抱图纸的男人 —— 三点，两瓶水，会在窗边坐到天亮
        戴耳机的高中生 —— 三点半，一个饭团，只买最便宜的
        出租车司机 —— 四点，一杯热豆浆，走前把零钱投进捐款盒

      临时路人用这些：老周、小于、阿灿、祁姐、老魏、毛毛、陈师傅、林小雨。

  # ④ 骨架里没有这一条 —— 新建。新条目**一定要给分组**：不给就全落在「未分组」，
  #    做出来的设定库是一盘散的。
  - 标题: 角色 · 阿岩
    模板: 必读
    分组: 角色
    提示: 玩家和她说话、或问起她时读这条 —— 她是这张卡的对手戏。
    正文: |
      【阿岩 · 夜班店长】

      身份与经历：二十七岁，在这家店值了四年夜班。因为白天要照顾中风后卧床的父亲，
      所以从没申请换班 —— 长夜对她不是浪漫，是一份能同时挣钱和看护的活计。
      因为见过太多凌晨的人，所以她对客人的狼狈不发表意见；因为她自己也在硬撑，
      所以她认得别人的硬撑。

      腔调：短句，少形容词，不反问。常用「嗯」「行」「随你」收尾。
        例：「热的在左边，冷的在右边。你要哪个都行，别站中间。」
        例：「我不问。你要说就说。」
        例（倦意 4 以上）：「……嗯。多少钱。」

      关系：对玩家是「一个还会再来的客人」。她不打听；但玩家连着三晚都来，
      她会开始记得他要买什么、要不要加热。

      底线：不碰客人的私事，不打烊，不打开柜台下面那个纸箱 —— 哪怕店里只剩一个人。

  - 标题: 世界 · 长夜便利店
    模板: 关键词
    分组: 世界
    关键词: [便利店, 夜班, 冷柜, 关东煮]
    提示: 玩家问起这家店、夜班规矩、货架上的东西时读这条。
    正文: |
      【长夜便利店】

      位置：地铁末班出口往东两百米，夹在一家关了门的打印店和一片工地之间。
      门头灯管坏了一根，夜里看过去是「长 夜 便利店」。

      每天凌晨一点到五点，这条街上只有它还亮着：暖气开着，关东煮的汤在锅里滚，
      收银台后面贴着一张纸 ——「本店不设监控」。

      墙上贴着三条规矩：
      一、凌晨两点后不卖酒 —— 但可以赊。
      二、关东煮过了三点全部下架，锅底倒掉。
      三、柜台下面那个纸箱不许碰，也不许问。

      这里没有超自然的东西。奇怪的从来不是店，是为什么总有人在这个点推门进来。

  # ⑤ 用不上的就删 —— 骨架里那条是演示「怎么把条目挂到变量开关上」的样板件，
  #    本卡用不上。删掉的条目进回收站，改主意了能捞回来。
  - 标题: 可选 · 时局压力
    删: true

# 正则只管显示格式，不承担内容。这条把 AI 偶尔多打出来的空行收掉。
正则:
  - 名: 折掉多余空行
    模式: '\\n{3,}'
    替换: '\\n\\n'

# 开场白：末尾那三个零宽标记归工具管（它决定开卡时出不出建卡界面），千万别自己写。
开场白: |
  凌晨一点四十分，长夜便利店的自动门在你身后合上。

  暖气、关东煮的汤味、冰柜低沉的嗡声 —— 这条街上还剩的活气全在这儿。
  收银台后面的女人没抬头，只把扫码枪往手边挪了挪。

  「热的在左边，冷的在右边。」她说，「你要哪个都行，别站中间。」
`

export function 卡稿示例() {
  /** 一份完整的、能直接落成绿卡的卡稿 —— `make --示例` 与 `向导/示例卡稿.yaml` 都用它。 */
  return _示例
}

// 卡稿里条目的「特殊键」：不是 spec 字段，是「这条怎么处理」
export const _条目特殊 = ['标题', '模板', '分组', '删']

// 中文友好名 -> spec 字段名。**从 content 的中文表反推**，不另手写一份 ——
// 两份表迟早漂移（改了一处忘了另一处，而且不报错）。只补几个规程里的口语叫法。
export const _别名 = {}
for (const [k, v] of Object.entries(CONTENT._字段中文)) _别名[v] = k
_别名['提示'] = 'agent_selection_hint'
_别名['图标id'] = 'icon_id'

export function _字段名(k) {
  /** 认中文友好名，也认 spec 原名；都不是就返回 None（预检会报）。 */
  k = _strPy(k).trim()
  if (CONTENT.可改字段.includes(k)) return k
  return Object.prototype.hasOwnProperty.call(_别名, k) ? _别名[k] : null
}

export function _取(稿, ...名) {
  for (const n of 名) {
    if (稿 !== null && 稿 !== undefined && typeof 稿 === 'object' && n in 稿) return 稿[n]
  }
  return null
}

export function _列表(x) {
  if (x === null || x === undefined) return []
  return Array.isArray(x) ? [...x] : [x]
}

export function _字(x) {
  if (x === null || x === undefined) return ''
  // Python 的 `str()` 对容器就是 `repr()`（递归、带引号），标量才走普通文本。
  if (typeof x === 'object') return M.pyRepr(x)
  return CONTENT.pyStr(x)
}

/**
 * Python 内建 `str(x)` —— 与 `_字()` 的唯一差别：`None` 不是空串，而是 `'None'`。
 *
 * ★ 为什么单独留一个：draft.py 里有几处写的是 `str(x)` 而不是 `_字(x)`
 *   （:340 `_字段名` · :379 / :550 `模块` · :562 `要的分组` · :736 报告的「问题」列表）。
 *   那些地方遇到 `None` 会真的产出一个叫「None」的名字（进错误消息、进 `join`），
 *   用 `_字()` 就会把它悄悄吃掉、少报一条错 —— 所以必须走这个函数。
 *   不导出：Python 原件里没有这个名字，导出面要跟它一一对应。
 */
function _strPy(x) {
  if (x === null || x === undefined) return 'None'
  if (typeof x === 'object') return M.pyRepr(x)
  return CONTENT.pyStr(x)
}

// ---------------------------------------------------------------- 预检
export function 预检(稿, 到 = null) {
  /**
   * 动手之前先把稿子扫一遍 —— **能一次报全的就一次报全**。
   *
   * 逐条做的时候才发现错，人（或 AI）就得改一处、重跑一次、再发现下一处。
   * 静态能查的（名字写没写、模板认不认、类型在不在、值域会不会被降级）
   * 在这里全查掉；剩下那些必须建出工程才看得出来的（形状对不上之类）才留到后面。
   *
   * `到` 在原件里也**没被用到** —— 参数照原文留着。
   */
  const 错 = []

  const 卡名 = _字(_取(稿, '卡名', 'name')).trim()
  if (!卡名) {
    错.push('没写「卡名」。')
  } else if (/[\\/:*?"<>|]/.test(卡名)) {
    错.push(`卡名不能带 \\ / : * ? " < > | 这些字符：${卡名}`)
  }

  const 模块 = _列表(_取(稿, '模块', 'mods')).map((x) => _strPy(x).trim()).filter((x) => x)
  if (模块.length) {
    const _MODS = _要(MODS, 'mods') // Python 在函数里 `from . import mods`；JS 见文件头「移植记号 2」
    const 有 = new Set(_MODS.list_modules().map((m) => _或(CONTENT.取(m, '名', null), CONTENT.取(m, 'name', null))))
    for (const m of 模块) {
      if (!有.has(m)) {
        错.push(`没有这个模块：${m}（有 ${[...有].filter((x) => CONTENT.pyTruthy(x)).sort(_比串).join(' / ')}）。看现成的：python forge.py mods`)
      }
    }
  }

  const 条列 = _列表(_取(稿, '条目', 'entries'))
  for (let i = 0; i < 条列.length; i += 1) {
    const 条 = 条列[i]
    let 哪 = `条目 ${i + 1}`
    if (!_是字典(条)) {
      错.push(`${哪}：不是一组键值对。`)
      continue
    }
    const 标题 = _字(_或(条['标题'], 条['title'])).trim()
    if (!标题) {
      错.push(`${哪}：没写「标题」—— 标题就是认人的钥匙（同名即改、无名即建）。`)
      哪 = `${哪}（无名）`
    } else {
      哪 = `条目「${标题}」`
    }

    if (CONTENT.pyTruthy(条['删'])) {
      const 未知 = Object.keys(条).filter((k) => !_条目特殊.includes(k) && k !== 'title')
      if (未知.length) {
        错.push(`${哪}：说了「删」，就别再给其它字段了：${未知.join('、')}`)
      }
      continue
    }

    const 模板 = _字(条['模板']).trim()
    const 认模板 = Object.prototype.hasOwnProperty.call(CONTENT.模板表, 模板)
    if (模板 && !认模板) {
      错.push(`${哪}：模板认不得 ${模板}（有 ${Object.keys(CONTENT.模板表).join(' / ')}）`)
    }
    if (模板 === '开场') {
      错.push(`${哪}：用了「开场」模板 —— 开场白不走条目，写在稿子顶层`
        + '「开场白:」那一格里（那里会顺手补末尾那三个零宽标记）。')
    }

    // 值域字段：把这条先拼成一个「将要长成的样子」，交给护城河那一份实现去查 ——
    // **不在这里另写一遍值域表**（两份表迟早漂移，而这正是护城河）。
    const 形状 = {}
    if (认模板) Object.assign(形状, CONTENT.模板表[模板])
    const 未知 = []
    for (const [k, v] of Object.entries(条)) {
      if (_条目特殊.includes(k) || k === 'title') continue
      const 名 = _字段名(k)
      if (名 === null) {
        未知.push(String(k))
        continue
      }
      形状[名] = v
    }
    if (未知.length) {
      错.push(`${哪}：认不得这些字段 ${未知.join('、')}\n      能写：${[...new Set(Object.keys(_别名))].sort(_比串).join('、')}，或 spec 原名：${CONTENT.可改字段.join('、')}`)
      continue
    }
    if (模板 === '关键词' && !_列表(_或(条['关键词'], 条['keywords'])).length) {
      错.push(`${哪}：用的是关键词模板，却没给「关键词」—— 这条永远不触发。`)
    }
    if (!('content' in 形状)) 形状['content'] = _字(_或(条['正文'], 条['content']))
    const 降 = domain.checkEntryDomains(M.ordered(形状, M.ENTRY_KEYS), 哪)
      .filter((iss) => iss.level === 'ERROR')
      .map((iss) => iss.message)
    for (const d of 降) {
      错.push(`${哪}：会被平台静默吃掉：${d.trim()}`)
    }
  }

  const 变量列 = _列表(_取(稿, '变量', 'variables'))
  for (let i = 0; i < 变量列.length; i += 1) {
    const v = 变量列[i]
    let 哪 = `变量 ${i + 1}`
    if (!_是字典(v)) {
      错.push(`${哪}：不是一组键值对。`)
      continue
    }
    const 名 = _字(_或(v['名'], v['标题'], v['title'])).trim()
    const 对象 = _字(_或(v['对象'], v['object'])).trim()
    if (!名) {
      错.push(`${哪}：没写「名」。`)
    } else if (!对象) {
      错.push(`变量「${名}」没写「对象」—— 变量得挂在某个对象底下（对象缺了会自动建）。`)
    }
    const t = _字(_或(v['类型'], v['type'], 'string')).trim().toLowerCase()
    if (!CONTENT.变量类型表.includes(t)) {
      错.push(`变量「${名 || 哪}」的类型认不得：${t}（有 ${CONTENT.变量类型表.join(' / ')}）`)
    }
  }

  const 正则列 = _列表(_取(稿, '正则', 'regex'))
  for (let i = 0; i < 正则列.length; i += 1) {
    const r = 正则列[i]
    const 哪 = `正则 ${i + 1}`
    if (!_是字典(r)) {
      错.push(`${哪}：不是一组键值对。`)
      continue
    }
    if (!_字(_或(r['名'], r['name'])).trim()) {
      错.push(`${哪}：没写「名」。`)
    }
    if (!_字(_或(r['模式'], r['pattern'])).trim()) {
      错.push(`${哪}：没写「模式」。`)
    }
  }

  return 错
}

// ---------------------------------------------------------------- 落卡
export function _拷树(src, dst, out = _print) {
  /**
   * 把一棵树**只创建、只覆盖**地拷过去（不删、不改名 —— 沙箱里也能跑）。
   *
   * copytree 要求目标不存在，而「目标目录已经在了、但是空的」是常见处境
   * （比如上一趟只建了目录就失败了）。为了迁就它就先去 rmdir，反而在沙箱里
   * 撞墙（rmdir 属于删除）。逐文件写过去最省事，也最不容易出错。
   *
   * `out` 在原件里也**没被用到** —— 参数照原文留着。
   */
  let n = 0
  mkdirSync(dst, { recursive: true })
  const 走 = (根, to) => {
    mkdirSync(to, { recursive: true })
    let 条目
    try { 条目 = readdirSync(根, { withFileTypes: true }) } catch { return } // os.walk 默认把读不了的目录咽下去
    for (const e of 条目) {
      const s = _pyJoin(根, e.name)
      const t = _pyJoin(to, e.name)
      if (e.isDirectory()) {
        走(s, t)
      } else {
        const st = statSync(s)
        copyFileSync(s, t)
        utimesSync(t, st.atime, st.mtime) // copy2 连 mtime 一起搬
        n += 1
      }
    }
  }
  走(src, dst)
  return n
}

export function _找规格(proj) {
  const 源 = _pyJoin(proj, 'source')
  for (const f of _列目录(源).slice().sort(_比串)) {
    if (f.endsWith('.spec.yaml')) return _pyJoin(源, f)
  }
  throw new DraftError(`新工程里找不到 spec：${源}`)
}

export function _组名(spec, gid) {
  /** 分组 id -> 名字。找不到（或本来就是空 id）就是空串，也就是「未分组」。 */
  if (!_字(_或(gid, '')).trim()) return ''
  for (const g of CONTENT.groups_of(CONTENT.load(spec), false)) {
    if (_字(_或(CONTENT.取(g, 'id', null), '')) === _字(gid)) return _字(_或(CONTENT.取(g, 'name', null), ''))
  }
  return ''
}

export function _体检(spec, 成品) {
  /** 一份 spec（或成品卡）在这份工程里通不通 —— 返回 (错误数, 警告数, issues, card)。 */
  const card = pack.spec_to_card(spec)
  const issues = validate.validate_card(card, basename(spec))
  return [card, issues]
}

export function 落卡(稿路径, 到 = null, 试 = false, 保留 = false, 覆盖 = false, out = _print) {
  /** 照一份卡稿落成一张卡 —— 全绿了才落，目标位置要么一个字不动、要么是一整张卡。 */
  if (!_是文件(稿路径)) {
    throw new DraftError(`找不到卡稿：${稿路径}`)
  }
  let 稿
  try {
    稿 = M.isYaml(稿路径) ? M.yload(稿路径) : M.jload(稿路径)
  } catch (exc) {
    throw new DraftError(`卡稿读不出来（${basename(稿路径)}）：${_错文(exc)}`)
  }
  if (!_是字典(稿)) {
    throw new DraftError(`卡稿得是一份键值对，读到的是 ${_型名(稿)}。`)
  }

  const 错 = 预检(稿, 到)
  if (错.length) {
    throw new DraftError(`卡稿有 ${错.length} 处要先改（**一个字都没往任何地方写**）：\n`
      + 错.map((x) => `  · ${x}`).join('\n'))
  }

  const 卡名 = _字(_取(稿, '卡名', 'name')).trim()
  const dest = resolve(_或(到, _取(稿, '到', 'to', '落点'), process.cwd()))
  const 目标 = _pyJoin(dest, 卡名)
  if (existsSync(目标) && _列目录(目标).length) {
    // 重落：稿子改了以后要再来一遍。**同名卡才让覆盖** ——
    // 判据是那份 spec 在不在，不是目录名像不像（目录名可以改，spec 名跟着卡名走）。
    const 同名卡 = _是文件(_pyJoin(目标, 'source', `${卡名}.spec.yaml`))
    if (!同名卡) {
      throw new DraftError(
        `那里已经有东西了，而且看着不是「${卡名}」这张卡的工程：\n  ${目标}\n`
        + '  **不覆盖别人的东西** —— 换个落点：--到 <目录>')
    }
    if (!覆盖) {
      throw new DraftError(
        `「${卡名}」这张卡的工程已经在那里了：\n  ${目标}\n`
        + '  · 想照稿子重落一遍（把它恢复成稿子里写的样子）：加 `--覆盖`\n'
        + '  · 想留着现在那份：换个落点 --到 <目录>')
    }
    覆盖 = true
  }

  const 模块 = _列表(_取(稿, '模块', 'mods')).map((x) => _strPy(x).trim()).filter((x) => x)
  const 临时 = mkdtempSync(_pyJoin(tmpdir(), 'forge-draft-'))
  const 报告 = {
    卡名, 工程: 目标, 临时, 条目改: 0, 条目新: 0,
    条目删: 0, 分组: [], 自动分组: [], 挪组: [], 对象: 0, 变量: 0,
    正则: 0, 开场白: false, 成品: '', 文件: 0, 试: Boolean(试),
    覆盖: Boolean(覆盖),
  }
  try {
    const proj = scaffold.new_card(卡名, 临时, null, true, 模块)
    const spec = _找规格(proj)

    // 1. 分组：稿子里声明的 + 条目里用到的。**缺了就补**，但把「你没声明、
    //    它自己冒出来」的那几个单独列一份 —— 多半是名字打错了，看得见才改得掉。
    const 要的分组 = _列表(_取(稿, '分组', 'groups')).map((x) => _strPy(x).trim()).filter((x) => x)
    for (const 条 of _列表(_取(稿, '条目', 'entries'))) {
      if (_是字典(条) && !CONTENT.pyTruthy(条['删'])) {
        const g = _字(条['分组']).trim()
        if (g && !要的分组.includes(g)) {
          要的分组.push(g)
          if (!报告.自动分组.includes(g)) 报告.自动分组.push(g)
        }
      }
    }
    const 现存组 = new Set(CONTENT.groups_of(CONTENT.load(spec), false).map((g) => CONTENT.取(g, 'name', null)))
    for (const g of 要的分组) {
      if (现存组.has(g)) continue
      try {
        CONTENT.add_group(spec, g, '', _静)
        报告.分组.push(g)
      } catch (exc) {
        if (!(exc instanceof CONTENT.ContentError)) throw exc
      }
    }

    // 2. 变量对象（缺了就建）
    for (let o of _列表(_取(稿, '对象', 'objects'))) {
      if (typeof o === 'string') o = { 名: o }
      if (!_是字典(o)) continue
      const 名 = _字(_或(CONTENT.取(o, '名', null), CONTENT.取(o, 'name', null))).trim()
      if (!名) continue
      try {
        CONTENT.add_object(spec, 名, _字(_或(CONTENT.取(o, '父', null), CONTENT.取(o, 'parent', null))),
          _字(_或(CONTENT.取(o, '说明', null), CONTENT.取(o, 'description', null))),
          _字(CONTENT.取(o, '更新规则', null)), _静)
        报告.对象 += 1
      } catch (exc) {
        if (!(exc instanceof CONTENT.ContentError)) throw exc
      }
    }

    // 3. 变量（对象缺了就顺手建出来 —— 稿子不必先声明一遍）
    for (const v of _列表(_取(稿, '变量', 'variables'))) {
      if (!_是字典(v)) continue
      const 对象 = _字(_或(CONTENT.取(v, '对象', null), CONTENT.取(v, 'object', null))).trim()
      const 名 = _字(_或(CONTENT.取(v, '名', null), CONTENT.取(v, '标题', null), CONTENT.取(v, 'title', null))).trim()
      try {
        CONTENT.add_object(spec, 对象, '', '', '', _静)
        报告.对象 += 1
      } catch (exc) {
        if (!(exc instanceof CONTENT.ContentError)) throw exc
      }
      try {
        CONTENT.add_variable(spec, 对象, 名,
          _字(_或(CONTENT.取(v, '类型', null), CONTENT.取(v, 'type', null), 'string')).trim().toLowerCase(),
          CONTENT.取(v, '初值', CONTENT.取(v, 'value', CONTENT.取(v, 'default', null))),
          _字(_或(CONTENT.取(v, '说明', null), CONTENT.取(v, 'description', null))),
          _字(CONTENT.取(v, '更新规则', null)), _静)
      } catch (exc) {
        if (!(exc instanceof CONTENT.ContentError)) throw exc
        // 最常撞的一头：稿子里的变量名跟骨架里现成的重了（比如给「玩家.等级」再写一遍）。
        // 一次落成**只加新变量**，不知道该怎么把旧值覆盖掉才对，
        // 所以这里当场停下并说清楚 —— 不能让它底下抛个 traceback 上来，
        // 更不能默默跳过（跳过了，用户以为初值写进去了，运行时是旧值，还不报错）。
        throw new DraftError(
          `变量「${对象}.${名}」写不进去：${_错文(exc)}\n`
          + '  一次落成只负责**新增**变量；跟骨架里现成的变量重名、或初值那一层的'
          + '形状对不上号，都会卡在这里。\n'
          + '  换个名字（推荐）——改骨架自带的变量请落成之后用 `python forge.py var` 那条路。')
      }
      报告.变量 += 1
    }

    // 4. 条目：**同名即改、无名即建**（upsert）
    const 提到 = new Set()
    for (const 条 of _列表(_取(稿, '条目', 'entries'))) {
      if (!_是字典(条)) continue
      const 标题 = _字(_或(条['标题'], 条['title'])).trim()
      提到.add(标题)

      if (CONTENT.pyTruthy(条['删'])) {
        try {
          CONTENT.del_entry(spec, 标题, _静)
          报告.条目删 += 1
        } catch (exc) {
          if (!(exc instanceof CONTENT.ContentError)) throw exc
        } // 本来就没有 —— 稿子说「删除」是意图，不是断言
        continue
      }

      const 模板 = _字(条['模板']).trim()
      const 余下 = {}
      const 等等 = {}
      for (const [k, val] of Object.entries(条)) {
        if (k === '标题' || k === '模板' || k === '分组' || k === '删' || k === 'title') continue
        const 名 = _字段名(k)
        if (名 === null) continue
        等等[名] = val
      }

      let e = null
      let 有 = false
      try {
        e = CONTENT.find_entry(spec, 标题)[1]
        有 = true
      } catch (exc) {
        if (!(exc instanceof CONTENT.ContentError)) throw exc
        e = null
        有 = false
      }

      if (!有) {
        // 新建：先把 add_entry 认的那几样一次给全（省一次落盘与一条回收记录）
        const 头 = { ...等等 }
        const 正文 = 'content' in 头 ? 头['content'] : ''
        delete 头['content']
        const 关键词 = 'keywords' in 头 ? 头['keywords'] : null
        delete 头['keywords']
        const 位置 = 'position' in 头 ? 头['position'] : null
        delete 头['position']
        const 提示 = 'agent_selection_hint' in 头 ? 头['agent_selection_hint'] : null
        delete 头['agent_selection_hint']
        CONTENT.add_entry(spec, 标题, _字(条['分组']).trim(), 模板 || '常驻', 正文,
          关键词 !== null ? _列表(关键词) : null, 位置, 提示, _静)
        报告.条目新 += 1
        if (Object.keys(头).length) {
          CONTENT.set_entry(spec, 标题, { ...头 }, _静)
        }
        Object.assign(余下, 头)
      } else {
        const 字段 = {}
        if (模板) {
          // 换档 = 那一组字段一起换。但 `模板表` 里还带着 `kind`（身份字段），
          // 而 set_entry 明确不收身份 —— 照原样递过去会当场抛「这些字段不给改：kind」。
          // 所以先拿**同一份** `可改字段` 过滤一遍（这份表就是「什么能改」的唯一真相）。
          for (const [k, v] of Object.entries(CONTENT.模板表[模板])) {
            if (CONTENT.可改字段.includes(k)) 字段[k] = v
          }
        }
        Object.assign(字段, 等等)
        if (Object.keys(字段).length) {
          CONTENT.set_entry(spec, 标题, { ...字段 }, _静)
        }
        报告.条目改 += 1
        // 「分组」不在 set_entry 的字段表里（改分组是另一条路 `move_entries`）。
        // 早先这里**默默忽略**它：稿子明明写了「分组: 角色」，条目却纹丝不动，
        // 而且一个字都不报 —— 分组是设定库的骨架，错得看不见最要命。所以这里真的挪。
        const 分 = _字(条['分组']).trim()
        if (分) {
          const e2 = CONTENT.find_entry(spec, 标题)[1]
          if (_组名(spec, CONTENT.取(e2, 'group_id', null)) !== 分) {
            CONTENT.move_entries(spec, [CONTENT.取(e2, 'id', null)], 分, _静)
            报告.挪组.push(`${标题} → ${分}`)
          }
        }
      }
    }

    // 5. 清空：把「稿子里没提到」的设定条目删掉。
    //
    //    注意顺序 —— **先建后清**。反过来的话，稿子里「改写已有条目」那几条会先被
    //    清掉、再当成新条目建回来，报告上就成了「改 0 · 新建 4 · 删 4」，
    //    看着像丢了一条；万一半路失败，先清后建还会真的丢掉内容。
    //    清空**不碰开场白**那条 —— 它不是一个设定条目，是卡的门面。
    if (CONTENT.pyTruthy(_取(稿, '清空条目', '清空', 'clear'))) {
      const 剩 = CONTENT.entries_of(CONTENT.load(spec), true).filter((e) =>
        _字(_或(CONTENT.取(e, 'kind', null), '')) !== 'opening'
        && !提到.has(_字(_或(CONTENT.取(e, 'title', null), ''))))
      if (剩.length) {
        CONTENT.del_entries(spec, 剩.map((e) => CONTENT.取(e, 'id', null)), _静)
        报告.条目删 += 剩.length
      }
    }

    // 5. 正则
    for (const r of _列表(_取(稿, '正则', 'regex'))) {
      if (!_是字典(r)) continue
      const 目标列 = _列表(_或(CONTENT.取(r, '目标', null), CONTENT.取(r, 'targets', null)))
      CONTENT.add_regex(spec, _字(_或(CONTENT.取(r, '名', null), CONTENT.取(r, 'name', null))).trim(),
        _字(_或(CONTENT.取(r, '模式', null), CONTENT.取(r, 'pattern', null))).trim(),
        _字(_或(CONTENT.取(r, '替换', null), CONTENT.取(r, 'replacement', null))),
        目标列.length ? 目标列 : null, null, true, _静)
      报告.正则 += 1
    }

    // 6. 开场白（走 opener —— 末尾那三个零宽标记归它管）
    const 开场白 = _取(稿, '开场白', 'opening')
    if (开场白 !== null && 开场白 !== undefined && _字(开场白).trim()) {
      const r = OPENER.改正文(proj, _字(开场白), true, _静)
      报告.开场白 = true
      if (CONTENT.pyTruthy(CONTENT.取(r, '变了', null)) && !CONTENT.pyTruthy(CONTENT.取(r, '写回', null))) {
        throw new DraftError(
          '开场白改了，但**写回 spec** 那一步没成（这是界面层的问题，不是稿子的问题）：\n'
          + `  ${_列表(_或(CONTENT.取(r, '问题', null), ['组装没通过'])).map((x) => _strPy(x)).join('；')}\n`
          + '  工程照常落出来，界面那边修好再补一次即可：\n'
          + '    python forge.py opener <工程> --写回')
      }
    }

    // 7. 出成品
    const 成品 = _pyJoin(proj, '成品', `${卡名}.card.json`)
    mkdirSync(dirname(成品), { recursive: true })
    pack.build(spec, 成品)
    报告.成品 = 成品

    // 8. 体检（在**临时工程**上；拷过去之后还会再验一次，专抓路径依赖）
    const [card, issues] = _体检(spec, 成品)
    报告.错误 = issues.filter((i) => i.level === 'ERROR').map((i) => i.line().trim())
    报告.警告 = issues.filter((i) => i.level === 'WARN').map((i) => i.line().trim())
    if (报告.错误.length) {
      throw new DraftError(
        `这份稿子做出来的卡有 ${报告.错误.length} 个错误（**目标位置${试 ? '本来就没动' : '一个字都没写'}**）：\n`
        + `${报告.错误.slice(0, 12).map((x) => `  · ${x}`).join('\n')}\n`
        + '  改稿子重来。想知道细节：看上面这一趟的临时工程，或者先把稿子落成工程再 `check`。')
    }

    if (!试) {
      报告.文件 = _拷树(proj, 目标, out)
      // 拷过去之后再验一次：这一遍查的是**目标位置**那一份，
      // 顺带把「工程里写死了临时路径」这类问题照出来（只报，不拦）。
      const 目标成品 = _pyJoin(目标, '成品', `${卡名}.card.json`)
      const [_卡2, iss2] = _体检(_找规格(目标), 目标成品)
      报告.落点错误 = iss2.filter((i) => i.level === 'ERROR').map((i) => i.line().trim())
      报告.成品 = 目标成品
    }

    const s = validate.summarize(M.jload(成品))
    报告.统计 = s
    return 报告
  } finally {
    if (保留) {
      out(`  （--保留）临时工程留在 ${临时}`)
    } else {
      rmSync(临时, { recursive: true, force: true })
    }
  }
}

export function 打报告(报告, out = _print) {
  /**
   * 把 落卡() 的结果打成一张人（和 AI）都读得懂的表。
   *
   * **只有这一份输出**：底下那些 add_* / set_* / HUD / opener 的碎碎念全被静音了。
   * 「一次落成」的价值一半在于只跑一次、另一半在于只读到一句结论 ——
   * 底下打一屏「out/replacement_card.txt 34752 字符」之类，对读它的人（和 AI）纯是负担。
   */
  out('照卡稿落成一张卡')
  out('─'.repeat(56))
  out(`  ${M.pad('工程', 10)}${报告['工程']}${报告['试'] ? '（--试：没写）' : ''}`)
  if (报告['覆盖']) {
    out(`  ${M.pad('覆盖', 10)}照稿子重落了一遍（原来那份被盖掉了）`)
  }
  out(`  ${M.pad('条目', 10)}改 ${报告['条目改']} · 新建 ${报告['条目新']} · 删 ${报告['条目删']}`)
  if (报告['分组'].length) {
    out(`  ${M.pad('分组', 10)}${报告['分组'].join('、')}`)
  }
  if (报告['挪组'] && 报告['挪组'].length) {
    out(`  ${M.pad('挪组', 10)}${报告['挪组'].join('、')}`)
  }
  if (报告['自动分组'].length) {
    out(`  ${M.pad('自动补组', 10)}${报告['自动分组'].join('、')}`
      + '（稿子里没声明，是条目里用到的 —— 名字打错了就改）')
  }
  out(`  ${M.pad('变量', 10)}对象新建 ${报告['对象']} · 变量 ${报告['变量']} · 正则 ${报告['正则']}`)
  if (报告['开场白']) {
    out(`  ${M.pad('开场白', 10)}换过（末尾那三个零宽标记已补齐）`)
  }
  if (报告['统计']) {
    const s = 报告['统计']
    out(`  ${M.pad('成品', 10)}${报告['成品']}${报告['试'] ? '（--试：这是临时目录里那份，没拷出来）' : ''}`)
    out(`  ${M.pad('', 10)}条目 ${s['entries']} · 分组 ${s['groups']} · 变量 ${s['variables']} · 正则 ${s['regex']}`)
  }
  if (!报告['试']) {
    out(`  ${M.pad('拷过去', 10)}${报告['文件']} 个文件`)
  }
  for (const w of 报告['警告'] || []) {
    out(`  ${w}`) // Issue.line() 自带标记，缩进跟上面几行对齐即可
  }
  for (const e of 报告['落点错误'] || []) {
    out(`  ${e}`) // 拷过去之后才冒出来的错（多半是路径依赖）—— 如实报
  }
  if (报告['错误'] && 报告['错误'].length) {
    out(`  体检   ${报告['错误'].length} 错`)
  } else {
    out(`  体检   ok（0 错 ${(报告['警告'] || []).length} 警告）`)
  }
}
