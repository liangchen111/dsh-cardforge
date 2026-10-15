/**
 * forge.scaffold 的 JS 版 —— 开一张新卡：把骨架整个抄一份，换掉名字。
 * ======================================================================
 *
 * 生成的工程同时带两样东西：
 *
 *     内容层 ——  source/<卡名>.spec.yaml          改内容只改这里
 *     界面层 ——  hud/（HUD 核心 / 样式 / 视图 / conf）   改外观只改这里
 *
 * **换名只做三处替换**，跟原骨架那套一致：
 *
 *     骨架  → 卡名
 *     SKEL  → 前缀大写（拼成 JS 里的 <前缀大写>_HUD）
 *     skel  → 前缀小写（条目 id、样式 id、正则 id、conf 里的 id_prefix）
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 移植纪律（同 model.mjs / content.mjs / sandbox.mjs 头上那几条）：**行为照抄，不顺手改**。
 *
 * ★ 三处**已备案的未覆盖边界**（不是 bug，是兄弟模块还没落地）：
 *
 *   1. `opener.mjs` / `hud.mjs` / `mods.mjs` / `bridge.mjs` / `dist.mjs` **还没搬**。
 *      这几个模块一律走**延迟导入**（顶层 `await import()`，失败留 null），用到时由
 *      `_要()` 抛一句写明白的错。这样：**它们一落地，对应支路自动点亮**，不必回头改这里。
 *      Python 那边 `from . import hud as HUD` 是函数内导入，位置与这里一一对应。
 *   2. `M.ydump()` 在 forgejs 里**是抛错**（计划 §二①：新产出默认写 .spec.json）。
 *      所以 `灌内容()` 末尾那句 `M.ydump(新, spec_path)` 照原样留着、暂时走不通 ——
 *      同 content.mjs `commit()` 的处理（那边换成了 jdump，因为临时文件是自己命名的；
 *      这里的目标文件必须继续叫 `<卡名>.spec.yaml` 给后面的 `hud` / `build` 认，不能改名）。
 *   3. `_从包()`（工程包 / zip）整条**明确抛错**：forgejs 既没有 dist.mjs，也没有零依赖的
 *      zip 解包。
 *
 * ★ 本模块自己的一条硬要求：**绝不用 `cpSync(src, dst, {recursive:true})`**。
 *   实测本机 Node v24.14.0 上它会把进程打崩（退出码 0xC0000409 STATUS_STACK_BUFFER_OVERRUN，
 *   一行输出都不给）。整棵树的拷贝一律手写 `readdirSync + copyFileSync + utimesSync`
 *   （同 `差分/比一比.mjs` 的 `拷目录`，连 mtime 一起搬，对齐 Python 的 `shutil.copy2`）。
 */
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync,
  statSync, utimesSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as M from './model.mjs'
import * as P from './pack.mjs'
import * as C from './content.mjs'
import * as SB from './sandbox.mjs'

const 这里 = dirname(fileURLToPath(import.meta.url))

/**
 * 工具根（`制卡工具/`）。Python 那边是 `os.path.dirname(os.path.dirname(__file__))`
 * （scaffold.py 在 `forge/` 下，上两级就是根）；JS 这份在 `forgejs/lib/` 下，同样上两级。
 */
export const ROOT = resolve(这里, '..', '..')
export const SKELETON = join(ROOT, 'assets', '骨架')

export const SRC_NAME = '骨架'
export const SRC_SLUG = 'skel'

// 骨架自己跑出来的产物，不带进新工程（新卡要自己跑一遍）
export const SKIP_DIRS = new Set(['__pycache__', 'out'])
export const SKIP_FILES = new Set(['预览.html'])

export const TEXT_EXT = new Set(['.py', '.js', '.css', '.json', '.yaml', '.yml', '.html', '.md', '.txt'])

// ------------------------------------------------------------------ 还没搬的兄弟模块
//
// 一律延迟导入：现在缺 → 留 null；哪天搬好了 → 自动点亮。**不要**改成静态 import，
// 静态 import 一个不存在的文件会让整个模块加载失败，连别的支路一起拖死。
const _懒 = async (名) => { try { return await import(`./${名}.mjs`) } catch { return null } }
const OPENER = await _懒('opener')
const HUD = await _懒('hud')
const MODS = await _懒('mods')
const BRIDGE = await _懒('bridge')
const DIST = await _懒('dist')

function _要(mod, 名) {
  if (!mod) {
    throw new Error(`forgejs 还没搬 ${名}.mjs —— 这条支路暂时走不通（Python 原件里这儿的 import 照原文留着）。`)
  }
  return mod
}

// ------------------------------------------------------------------ 与 Python 同名的异常
//
// 差分是按 `type(exc).__name__ + ": " + str(exc)` 比的 ⇒ **类名必须一字不差**。
class FileNotFoundError extends Error {
  constructor(消息) { super(消息); this.name = 'FileNotFoundError' }
}
class ValueError extends Error {
  constructor(消息) { super(消息); this.name = 'ValueError' }
}
class FileExistsError extends Error {
  constructor(消息) { super(消息); this.name = 'FileExistsError' }
}
class NotADirectoryError extends Error {
  constructor(消息) { super(消息); this.name = 'NotADirectoryError' }
}
class RuntimeError extends Error {
  constructor(消息) { super(消息); this.name = 'RuntimeError' }
}
export { FileNotFoundError, ValueError, FileExistsError, NotADirectoryError, RuntimeError }

// ------------------------------------------------------------------ 小工具
const _print = (s = '') => { process.stdout.write(String(s) + '\n') }
const _无 = () => {}
/**
 * Python `repr(路径)` 的够用近似：反斜杠翻倍、单引号包住。
 * 只为拼 `OSError` 那几条消息（Python 格式化的时候用 `%r` 塞文件名）—— 别的引号/控制字符
 * 不出现在本模块造得出的路径里，不给自己找麻烦。
 */
const _repr路径 = (p) => `'${String(p).split('\\').join('\\\\')}'`

const _文 = (v) => String(v ?? '')

/**
 * Python `os.path.join` 的替身 —— **关键差别：不做规范化**。
 *
 * Node 的 `path.join('E:\\a/assets/骨架', 'source')` 会把整串收成 `E:\a\assets\骨架\source`；
 * Python 只是「没以分隔符结尾就补一个 `\`」，正斜杠原样留着 ⇒
 * `E:\a/assets/骨架\source`。`_找文件` 要按 Python 的 `os.walk` 原样吐路径，差一个斜杠就
 * 逐字节比不过（实测栽在这一条上）。
 */
const _pyJoin = (...段) => 段.reduce((a, b) => {
  b = _文(b)
  if (a === '') return b
  if (b === '') return a
  if (/^[\\/]/.test(b) || /^[A-Za-z]:/.test(b)) return b // 绝对路径（或带盘符）直接接管
  return /[\\/]$/.test(a) ? a + b : `${a}\\${b}`
}, '')
const _错文 = (e) => _文((e && typeof e === 'object' && 'message' in e) ? e.message : e)
const _是目录 = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const _是文件 = (p) => { try { return statSync(p).isFile() } catch { return false } }
const _是字典 = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Python 的 `for x in (v or [])` —— 照 Python 的可迭代语义来，别照 JS 的。
 *
 * `v` 是**字符串**时 Python 会逐字符迭代（每个字符都不是 dict ⇒ 字典表出来是空表），
 * JS 的字符串没有 `.filter`／`.map`，直接写 `(v || []).filter(...)` 会炸出
 * `TypeError: (开场.opening_messages || []).filter is not a function` —— 语料里专门有一例
 * `opening_messages: "不是数组"` 就是抓这个。
 */
const _列表 = (v) => {
  if (v == null || v === false || v === 0 || v === '') return [] // Python 的 `v or []`
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return [...v]
  const 类 = typeof v === 'number' ? 'int' : typeof v === 'boolean' ? 'bool' : typeof v
  throw new TypeError(`'${类}' object is not iterable`)
}

const _字典表 = (v) => _列表(v).filter(_是字典)

/** Python 的 `str.strip()`：两头削空白（含 \u3000 之类的全角空白）。 */
const _削 = (s) => _文(s).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')

/**
 * 读一个文本文件 —— 照 Python `open(p, encoding="utf-8")` 的两条语义：
 *   ① 严格 UTF-8：解不出来就抛（Python 是 UnicodeDecodeError，这里 TypeError，调用点一律 catch）；
 *   ② universal newlines：`\r\n` 与孤立的 `\r` 都折成 `\n`。
 * ② 是必须的 —— 骨架里若有 CRLF 文件，Python 读进来是 LF，写回时 `newline="\n"` 落成 LF；
 * 照抄这一条，两边落盘才一致。
 */
const _解码 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
function _读文本(p) {
  return _解码.decode(readFileSync(p)).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

// ------------------------------------------------------------------ 开工说明（模板）
//
// 这一段**必须逐字节等于** `forge/scaffold.py` 里的 `PROJECT_README`（新工程里那份
// `怎么开工.md` 的 sha1 是要进差分的）。下面这一行由脚本从 Python 原件直接导出，
// 别手改 —— 手改就会悄悄跑偏。占位符是 `{name}` / `{forge}` / `{manual}`。
export const PROJECT_README = "# {name} · 怎么开工\n\n一条命令生成的制卡工程。它分两层，改的地方不一样：\n\n| 改什么 | 动哪里 |\n|---|---|\n| 卡的内容（世界观、条目、变量、正则） | `source/{name}.spec.yaml` |\n| 卡的界面（建卡器 / 面板 / 悬浮球长什么样） | `hud/` 下的文件 |\n| 卡的颜色（皮肤） | `hud/主题.css` —— 由 `forge theme` 写，别手改 |\n| 卡里接哪些现成机制 | 用 `forge add` / `forge drop`，别手改 |\n\n**别手改卡文件**（`成品/{name}.card.json`）—— 它是派生物，改了下一次构建就没了。\n**也别手改 `模块账本.json`** —— 撤模块全靠它。\n\n## 常用命令\n\n```\npython {forge} check  source/{name}.spec.yaml     先跑这个，看有没有坑\npython {forge} hud    .                           组装界面（出 预览.html）\npython {forge} hud    . --写回                     组装并把正则写回 spec\npython {forge} build  source/{name}.spec.yaml 成品/{name}.card.json\npython {forge} check  成品/{name}.card.json\npython {forge} manual source/{name}.spec.yaml     出人读手册\npython {forge} mods   --工程 .                    看有哪些机制、接没接、要不要更新\npython {forge} theme                              看有哪些皮肤\npython {forge} theme  墨夜 .                       换皮肤（换完记得再 hud 一次）\npython {forge} bundle .                           打成一个包，发给别人\n```\n\n（`{forge}` 是制卡工具的 `forge.py`，不在本工程里 —— 用它的绝对路径，或者把它加进 PATH。）\n\n## 顺序别乱\n\n1. 先改 `source/{name}.spec.yaml` 里〈核心 · 世界总纲〉那一条 —— 它每轮都进提示，\n   是最该先想清楚的一条。\n2. 把开场白写进 `hud/hud.conf.json` 的「开场白」正文（改完跑一次 `hud --写回`）。\n3. 演示条目（名册 · 常用名字 / 规则 · 判定）用完就删或改成自己的。\n4. 每改一轮跑一次 `check`；动了 `hud/` 就跑 `hud --写回` 再 `build`。\n\n## 界面那一层是什么\n\n`hud/hud.core.js` 是**通用骨架**：它把变量树原样画成面板，并提供一间建卡器\n（把「玩家」那份档案填成表单，封缄即写回变量）与一颗常驻悬浮球。\n它不含任何世界观内容 —— 你加变量，面板上就多一行，不用改代码。\n\n想动界面就改 `hud/hud.css`（换颜色别改它，跑 `forge theme`）；改 `hud.core.js`\n等于改机制，改之前先跑 `node 测试/test_core.js` 确认现在是绿的。\n\n## 想加现成的机制\n\n```\npython {forge} mods --工程 .                        # 看有哪些、接没接\npython {forge} add 骰子 source/{name}.spec.yaml      # 接上骰子（改判定那一条）\npython {forge} drop 骰子 source/{name}.spec.yaml     # 后悔了就撤，接之前的样子还在账本里\n```\n\n接过模块之后，记得再跑一次 `hud --写回` 让界面带上它（脚本/样式落在 `hud/模块/` 下）。\n**撤模块是精确的**：替换的那条还原成原样、新增的那条删掉、正则按 id 删、\n界面文件与登记一并摘掉。你自己在 spec 里手写的东西，工具一律不动。\n\n## 三条纪律\n\n- **一条条目只干一件事。** 越长越该拆：拆开之后各自有自己的标题和「什么时候读我」。\n- **常驻只放每轮必须看见的东西。** 其余一律走按需（不占每轮上下文）。\n- **资料类走按需，规则类走关键词。** 关键词挑短词。\n\n## 卡由什么构成\n\n角色壳 + 设定库 +（可选）变量 +（可选）正则 +（可选）图片。\n详见 `{manual}`。\n"

/** 照 Python `str.format` 的单趟语义替换三个占位符（值是卡名/两个相对路径）。 */
function _填模板(模板, name, forge, manual) {
  const 表 = { name, forge, manual }
  return 模板.replace(/\{(name|forge|manual)\}/g, (_, k) => 表[k])
}


export function new_card(name, dest = null, id_prefix = null, quiet = false, modules = null,
  build_hud = true, source = null) {
  /**
   * 在 dest/<name>/ 下生成一张新卡的工程目录。返回工程根路径。
   *
   * modules：顺手接上的模块名（见 assets/模块/），如 ["骰子", "备份"]。
   * build_hud：生成后立刻组装一次界面（出 预览.html），确认新生的是通的最小验证。
   * source：接手一张现成的卡 —— 界面层照抄骨架，内容层用它的（见 `灌内容`）。
   */
  if (!_是目录(SKELETON)) {
    throw new FileNotFoundError(`找不到骨架：${SKELETON}`)
  }

  name = _削(name)
  if (!name) {
    throw new ValueError('卡名不能为空')
  }
  if (/[\\/:*?"<>|]/.test(name)) {
    throw new ValueError(`卡名不能带 \\ / : * ? " < > | 这些字符：${name}`)
  }

  dest = resolve(_文(dest) || process.cwd())
  const prefix = id_prefix ? _文(id_prefix) : M.asciiPrefix(name)
  const proj = join(dest, name)
  if (existsSync(proj)) {
    // Python：`os.path.exists(proj) and os.listdir(proj)` —— 若 proj 其实是个**文件**，
    // `os.listdir` 会抛 NotADirectoryError（连判空都轮不上），这里照样。
    if (!_是目录(proj)) {
      // Python 的 `os.listdir(文件)` 在 Windows 上抛的是带 winerror 的那条：
      //   NotADirectoryError: [WinError 267] 目录名称无效。: '<path>'
      // 267 是 ERROR_DIRECTORY；冒号前面那截是**系统语言的 strerror**（本机中文 Windows
      // 就是「目录名称无效。」，英文系统会是 "The directory name is invalid."）。Node 的
      // readdirSync 抛的是 `ENOTDIR: not a directory, scandir '…'`，两边对不上 ⇒ 照抄本机原文。
      // ★ 路径是**repr 进来的**（OSError 的格式化用 %r）：反斜杠翻倍、单引号包住。
      //   少了这一步，`'<工作>\\非目录'` 就会写成 `'<工作>\非目录'`。
      throw new NotADirectoryError(`[WinError 267] 目录名称无效。: ${_repr路径(proj)}`)
    }
    if (readdirSync(proj).length) {
      throw new FileExistsError(`目录已存在而且不是空的：${proj}`)
    }
  }

  // ---- 1. 抄骨架（整棵树；产物不带过去）
  //
  //  **换名只做三处替换**，先定下规则再抄 —— 沙箱模式下文件名要在**抄的那一刻**就换好：
  //  那儿改不了名，先抄一个旧名再换就等于留下一个删不掉的多余文件。
  const subs = [[SRC_NAME, name], [SRC_SLUG.toUpperCase(), prefix.toUpperCase()], [SRC_SLUG, prefix]]

  const _换名 = (base) => {
    let 出 = base
    for (const [a, b] of subs) 出 = 出.split(a).join(b)
    return 出
  }

  /** 手写的 `shutil.copytree`：**别用 cpSync recursive**（本机 Node 会崩，见文件头）。 */
  const _拷一个 = (src, dst) => {
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
    try {
      const st = statSync(src)
      utimesSync(dst, st.atime, st.mtime)
    } catch { /* 时间戳搬不过去不影响内容 */ }
  }

  let copied = 0
  const _抄 = (dir) => {
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    const dirs = ents.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name)).map((e) => e.name)
    const files = ents.filter((e) => e.isFile()).map((e) => e.name)
    for (const f of files) {
      if (SKIP_FILES.has(f)) continue
      const src = join(dir, f)
      let rel = relative(SKELETON, src)
      if (SB.enabled()) rel = join(dirname(rel), _换名(f))
      _拷一个(src, join(proj, rel))
      copied += 1
    }
    for (const d of dirs) _抄(join(dir, d))
  }
  _抄(SKELETON)
  mkdirSync(join(proj, '成品'), { recursive: true })

  // ---- 2. 换名字：先改内容，再改文件名
  //
  //  **为什么排在接模块之前**：模块的 JS/CSS 里写的是 skel / SKEL_HUD ——
  //  换名之后再接，模块那一份就由 forge.mods 按这张卡的真名落盘，
  //  两边走的是同一条替换规则，不必为某张卡改模块一个字。
  let touched = 0
  let renamed = 0
  const _换 = (dir) => {
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    const dirs = ents.filter((e) => e.isDirectory()).map((e) => e.name)
    const files = ents.filter((e) => e.isFile()).map((e) => e.name)
    for (const f of files) {
      const p = join(dir, f)
      if (!TEXT_EXT.has(extname(f).toLowerCase())) continue
      let text
      try {
        text = _读文本(p)
      } catch {
        continue
      }
      let 新 = text
      for (const [a, b] of subs) 新 = 新.split(a).join(b)
      if (新 !== text) {
        writeFileSync(p, 新, 'utf8')
        touched += 1
      }
      const base = _换名(f)
      if (base !== f) {
        // 沙箱模式下这一步上面已经做完了（文件名抄的时候就换好），走不到这儿
        SB.rename(p, join(dir, base))
        renamed += 1
      }
    }
    for (const d of dirs) _换(join(dir, d))
  }
  _换(proj)

  const spec_path = join(proj, 'source', `${name}.spec.yaml`)
  let spec = M.yload(spec_path)
  if (!((spec.library || {}).entries)) {
    throw new RuntimeError('骨架坏了：生成出来的 spec 没有条目')
  }

  const 说 = quiet ? _无 : _print

  // ---- 2.5 接手现成的卡：界面层照抄骨架，内容层换成它的（--从）
  //
  //  为什么排在这儿：骨架那套名字已经换好（界面层与 spec 都姓新卡名），这时把内容层
  //  整体换掉，接下来第一次 `hud --写回` 就会拿新 conf 的正则与开场白去对齐这份内容 ——
  //  顺序反了就会先写回旧内容、再被灌掉。
  let 来源说明 = ''
  if (source) {
    const 工作区 = join(proj, '.forge', '_取')
    mkdirSync(工作区, { recursive: true })
    try {
      const [外来, 说明] = 取内容层(source, 工作区, 说)
      来源说明 = 说明
      const [条数, 开场状态, 禁用] = 灌内容(spec_path, 外来, proj, 说, build_hud)
      if (!quiet) {
        _print()
        _print(`接手现成的卡：${来源说明}`)
        _print(`  灌进 ${条数} 条条目 · 开场白 ${开场状态}`)
        if (禁用 && 禁用.length) {
          _print(`  · 其中 ${禁用.length} 条来源里是「已禁用」，按原样留着（卡里留着，但不生效）：` +
            `${禁用.slice(0, 5).join('、') + (禁用.length > 5 ? '…' : '')}`)
          _print(`      要让它生效：python forge.py entry <spec> --改 "${禁用[0]}" --启用`)
        }
      }
    } catch (e) {
      // 接手失败就**把这个刚建出来的目录撤掉**：它此刻是「骨架内容 + 一半东西」，
      // 留着比不留更容易骗人（用户会以为建好了）。proj 是这一趟刚建的，撤它安全。
      // 沙箱里撤不掉 —— 那也得说一声，不能让人以为这儿是干净的。
      if (!SB.rmtree(proj) && _是目录(proj)) {
        _print(`  ！沙箱模式撤不掉刚建的目录，它留在原地了：${proj}（可手删）`)
      }
      throw e
    } finally {
      SB.rmtree(工作区)
    }
  }

  // ---- 3. 先把界面层的正则写进去（conf 那两条占 order 10 / 20）
  //
  //  **必须在接模块之前**：模块的正则是照着「现有正则的 order 往后排」放的，
  //  conf 那两条先落了位，模块就不会跟它们撞车（撞了平台那边先后会变得随机）。
  if (build_hud) {
    _要(HUD, 'hud')
    HUD.build(proj, true, 说)
  }

  // ---- 4. 接模块（条目/正则进 spec，脚本/样式进 hud/模块/）
  const names = _列表(modules).map((m) => _削(m)).filter((s) => s)
  let mod_error = null
  if (names.length) {
    _要(MODS, 'mods')
    if (!quiet) {
      _print()
      _print('顺手并模块：')
    }
    try {
      MODS.apply_modules(spec_path, names, { project: proj, out: quiet ? _无 : _print })
    } catch (exc) {                                  // 模块接不上不该毁掉整张卡
      mod_error = exc
      if (!quiet) {
        _print(`  !! 模块这一趟没接上：${_错文(exc)}`)
      }
    }
  }

  // ---- 5. 再组装一次：把模块的脚本/样式拼进页面
  let hud_problems = []
  if (build_hud) {
    _要(HUD, 'hud')
    const 结果 = HUD.build(proj, true, 说)
    hud_problems = 结果[0]
    spec = M.yload(spec_path)
  }

  const manual = join(ROOT, '文档', '使用说明.md')
  const forge = join(ROOT, 'forge.py')
  writeFileSync(join(proj, '怎么开工.md'),
    _填模板(PROJECT_README, name, _rel(forge, proj), _rel(manual, proj)), 'utf8')

  if (!quiet) {
    _print(`已开新卡 -> ${proj}`)
    _print(`  抄过来 ${copied} 个文件 · 改写 ${touched} 个 · 改名 ${renamed} 个`)
    _print(`  卡名 ${name} · id 前缀 ${prefix} · HUD 全局名 ${prefix.toUpperCase()}_HUD`)
    _print(`  条目 ${spec.library.entries.length} 条（含开场白）· 变量 ${((spec.variables || {}).variables || []).length} 个`)
    if (来源说明) {
      _print(`  内容层 ${来源说明}`)
      _print('  （条目 id 保持原样 —— 卡里按 id 互相引用，改名就断链）')
    }
    if (mod_error) {
      _print(`  ⚠ 模块没接上：${_错文(mod_error)}`)
    }
    if (hud_problems.length) {
      _print(`  ⚠ 界面组装有 ${hud_problems.length} 个问题：`)
      for (const p of hud_problems) {
        _print(`      · ${p}`)
      }
    }
    _print()
    _print('下一步：')
    _print(`  1. 打开 ${proj}\\预览.html 看看默认长什么样`)
    _print(`  2. ${来源说明 ? '接着改' : '改'} source\\${name}.spec.yaml`)
    _print(`  3. python ${_rel(forge, proj)} check "${spec_path}"`)
  }
  return proj
}


// ---------------------------------------------------------------- --从（接手现成的卡）
//
//  「别人给了一张卡」以前是条死路：单张 `.card.json` 收进来只有内容层（`hud/` 本来就不在
//  卡里），于是没有界面层 → `opener` 不认、`hud` 不肯凭空造、规程又让人别手改。唯一出路
//  「开新卡把条目搬过去」**根本没有搬运命令** —— 十一条条目加十个变量加九条正则，人肉重建。
//  这条命令就是那条缺失的搬运：**用骨架拿界面层，用卡拿内容层**，两边各取所长。

export function 取内容层(src, 工作区, out = _print) {
  /**
   * 把「卡 / 工程包 / spec / 工程目录」统一取成一份内容层 spec。返回 (spec, 来源说明)。
   *
   * 四种来源走四条路，出来的都是同一个形状 —— 灌内容那一步不必知道东西从哪来。
   */
  src = resolve(_文(src))
  if (!existsSync(src)) {
    throw new FileNotFoundError(`找不到来源：${src}`)
  }
  if (_是目录(src)) {
    return _从目录(src, 工作区, out)
  }
  const ext = extname(src).toLowerCase()
  if (ext === '.zip') {
    return _从包(src, 工作区, out)
  }
  if (ext === '.yaml' || ext === '.yml') {
    return [M.yload(src), `spec：${basename(src)}`]
  }
  return _从卡(src, 工作区, out)
}


export function _从卡(src, 工作区, out = _print) {
  /** 单张卡：先按 ElecKoi 卡解，不成就按酒馆 V2 卡转。 */
  const 临时 = join(工作区, '_取内容.spec.yaml')
  let 说明
  try {
    P.unpack(src, 临时)
    说明 = `ElecKoi 卡：${basename(src)}`
  } catch (一) {
    try {
      _要(BRIDGE, 'bridge')
      BRIDGE.to_eleckoi(src, 临时, _无)
      说明 = `酒馆卡（转成草稿）：${basename(src)}`
    } catch (二) {
      throw new RuntimeError(`这张卡既不是 ElecKoi 卡也不是酒馆 V2 卡：${_错文(二)}`)
    }
  }
  return [M.yload(临时), 说明]
}


export function _从包(src, 工作区, out = _print) {
  /**
   * 工程包：解开，优先取里面的 spec（最浅的那个），退一步取成品卡。
   *
   * ★ 移植记号：Python 这边是 `from . import dist` ＋ `zipfile` 两件。forgejs 既没有
   *   `dist.mjs`，也没有零依赖的 zip 解包 ⇒ 这条来源整个搬不了，**明确抛错**，
   *   等零依赖解包落地了再照原文补。
   */
  throw new RuntimeError(
    `forgejs 还没搬「工程包」这条来源（dist.mjs 与 zip 解包都缺，Python 原件用的是 zipfile）：${src}`)
}


export function _从目录(src, 工作区, out = _print) {
  let 卡 = _找文件(src, '.spec.yaml')
  if (卡.length) {
    return [M.yload(卡[0]), `工程目录：${basename(resolve(src))}`]
  }
  卡 = _找文件(src, '.card.json')
  if (!卡.length) 卡 = _找文件(src, '.json')
  if (卡.length) {
    return _从卡(卡[0], 工作区, out)
  }
  throw new RuntimeError(`这个目录里既没有 spec 也没有卡文件：${src}`)
}


export function _找文件(root, 尾) {
  /** 在 root 下找以 `尾` 结尾的文件，**最浅的排前面**（工程外层的才是正主）。 */
  const 出 = []
  const 走 = (d) => {
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.isDirectory()) 走(_pyJoin(d, e.name))
      else if (e.isFile() && e.name.toLowerCase().endsWith(尾)) 出.push(_pyJoin(d, e.name))
    }
  }
  走(root)
  // Python：`sort(key=lambda p: (len(p.split(os.sep)), p))` —— 先按层数，再按整串。
  出.sort((a, b) => (a.split(sep).length - b.split(sep).length) || (a < b ? -1 : a > b ? 1 : 0))
  return 出
}


export function 灌内容(spec_path, 外来, proj, out = _print, 有界面 = true) {
  /**
   * 把一份外来 spec 灌进新工程的 spec，并让开场白两边对齐。
   *
   * 返回 `(条目数, 开场白状态, 已禁用的条目标题列表)`。
   *
   * **不动外来条目的 id**：卡里的变量、正则、条目互相按 id 引用，改名就是断链。
   * 新工程的 id 前缀只作用于骨架抄来的东西（界面层那套）。
   *
   * **卡名不回借**：character 层其余字段照收，只有 `name` 钉回新工程的名字 ——
   * 名字的真相只能有一个（工程目录 / 界面配置 / spec 三处必须同名）。
   */
  _要(OPENER, 'opener')
  外来 = 外来 || {}
  const 骨架 = M.yload(spec_path)
  const 新 = {}
  for (const k of ['format', 'version']) {
    新[k] = 骨架[k] || 外来[k] || null
  }
  //  **卡名归新卡。** 外来 character 层其余字段（简介、年龄、性别…）照收 —— 那一层是
  //  「借它的内容」；但名字借过来就是错的：工程目录与界面配置都叫新名，只有 spec 顶着
  //  旧名，`check` 也不报，等于埋了个静默矛盾（盲跑实测：`new 盲跑测试卡 --从 酒馆卡`
  //  之后 spec 里仍写着「示例酒馆卡」）。名字的真相只能有一个。
  const 外来壳 = { ...((外来.character) || {}) }
  外来壳.name = (((骨架.character) || {}).name) || 外来壳.name || ''
  新.character = 外来壳
  新.assets = 外来.assets || []
  新.library = 外来.library || {}
  新.variables = 外来.variables || {}
  新.regex_rules = 外来.regex_rules || []
  for (const [k, v] of Object.entries(外来)) {           // unpack 留下的「原样保留」字段
    if (!(k in 新)) 新[k] = v
  }

  const lib = 新.library
  const 条 = _字典表(lib.entries)
  if (!条.length) {
    throw new RuntimeError('这份来源里没有条目（卡是空的），灌不进去。')
  }
  lib.entries = 条
  let 开场 = null
  for (const e of 条) {
    if (_文(e.kind) === 'opening') { 开场 = e; break }
  }

  const conf_p = join(proj, 'hud', 'hud.conf.json')
  const conf = OPENER._读json(conf_p)
  if (!('开场白' in conf)) conf['开场白'] = {}
  const 块 = conf['开场白']
  let 状态
  if (开场 !== null) {
    const 正文 = _规整开场(_开场正文(开场), out)
    if (正文) {
      开场.content = 正文
      const 方案 = _字典表(开场.opening_messages)
      块['条目'] = _文(开场.id || 块['条目'] || 'fixed-opening-assistant')
      块['正文'] = 正文
      状态 = `取自外来卡 · ${Array.from(正文.replace(/\u200b+$/, '')).length} 字`
      // 各方案正文**原样留着**：酒馆卡常带好几套开场（默认 + 备选），一次写回
      // 会把它们压成同一份（骨架的建卡器只有一格正文）。那是损失，所以要出声 ——
      // 不接界面层建的工程不受这个影响。
      if (有界面 && 方案.length > 1) {
        out(`  ⚠ 外来卡有 ${方案.length} 套开场方案 —— 骨架的建卡器只装得下一份正文，` +
          '这次接界面已把各方案统一成默认那套（备选那几套的内容没了）。')
        out('     想保住多套开场：别接界面层，用 `forge.py import <卡> --到 .` '
          + '收成内容档，各方案各自留着。')
      }
    } else {
      状态 = '⚠ 外来卡的开场白是空的 —— conf 保持骨架那条，记得改'
    }
  } else {
    const 骨架开场 = _骨架开场条目()
    if (骨架开场) {
      条.unshift(骨架开场)
      状态 = '外来卡没有开场白 —— 用骨架那条占位，记得改'
    } else {
      状态 = '外来卡没有开场白，骨架那条也没找到'
    }
  }
  OPENER._写json(conf_p, conf)
  // ★ 移植记号：forgejs 的 `M.ydump` 是抛错（见文件头第 2 条）——这条路要等 YAML 写出器。
  M.ydump(新, spec_path)
  // 来源里带过来的「已禁用」条目：**原样留着**（卡里不生效），但得说出来 ——
  // 不然从列表上看它就是一条普通条目，「看着像生效、其实没生效」是最坑的那类。
  const 禁用 = 条.filter((e) => !(e.enabled === undefined ? true : e.enabled))
    .map((e) => _文(e.title || '（无标题）'))
  return [条.length, 状态, 禁用]
}


export function _规整开场(文, out = _print) {
  /** 开场白正文归位：末尾不多不少三个零宽标记。同 `opener.规范正文`，但**不因尖括号停工** ——
   * 这是搬运，不该因为来源里有个 `<` 就拒绝建卡；照实警告，让 `opener` 事后收拾。 */
  _要(OPENER, 'opener')
  const 净 = _文(文).replace(/\n+$/, '').replace(/\u200b+$/, '')
  if (!_削(净)) {
    return ''
  }
  if (净.includes('<') || 净.includes('>')) {
    out('  ⚠ 外来卡的开场白里有尖括号 —— 建卡界面可能不出现；跑一次 opener 改正文即可。')
  }
  return 净 + OPENER.标记
}


export function _开场正文(开场) {
  /**
   * 开场白条目里那份正文：优先 `content`，它空着就退到**默认方案**。
   *
   * 两处会不一致（条目正文与世界书/卡里的方案正文），得按顺序问一遍 ——
   * 只认 `content` 的话，一份「正文只写进方案」的来源会被当成「没有开场白」，
   * 然后拿骨架那句占位，开场白**静默换人**。
   */
  if (!_是字典(开场)) {
    return ''
  }
  const 文 = _文(开场.content).replace(/^\s+|\s+$/g, '')
  if (文) {
    return _文(开场.content)
  }
  const 方案 = _字典表(开场.opening_messages)
  const 默认 = _文(开场.default_opening_message_id)
  if (默认) {
    for (const m of 方案) {
      if (_文(m.id) === 默认 && _削(m.content)) {
        return _文(m.content)
      }
    }
  }
  for (const m of 方案) {
    if (_削(m.content)) {
      return _文(m.content)
    }
  }
  return ''
}


export function _骨架开场条目() {
  /** 骨架里那条开场白（`kind: opening`），深拷贝一份 —— 外来卡没开场白时补个位。 */
  const p = join(SKELETON, 'source', `${SRC_NAME}.spec.yaml`)
  if (!_是文件(p)) {
    return null
  }
  let lib
  try {
    lib = ((M.yload(p)) || {}).library || {}
  } catch {
    return null
  }
  for (const e of (lib.entries || [])) {
    if (_是字典(e) && _文(e.kind) === 'opening') {
      return structuredClone(e)              // Python 那边是 copy.deepcopy
    }
  }
  return null
}


export function _唯一spec(根) {
  /** 工程里唯一那份 spec。没有或不止一份都返回 None（后者由 validate 去报）。 */
  const d = _pyJoin(_文(根), 'source')
  if (!_是目录(d)) {
    return null
  }
  const hits = readdirSync(d).filter((f) => f.endsWith('.spec.yaml')).sort()
  return hits.length === 1 ? _pyJoin(d, hits[0]) : null
}


export function 看卡名(target) {
  /** 卡名现在是什么、几处对不对得上。返回 dict（给命令打印用）。 */
  _要(OPENER, 'opener')
  const [根, 模式] = OPENER.定位(target)
  // ★ 键的插入顺序就是 Python 那个 OrderedDict 的顺序 —— 差分会比出来。
  const d = {}
  d['工程'] = 根
  d['模式'] = 模式
  d['目录名'] = basename(_文(根))
  d['spec'] = null
  d['spec 卡名'] = ''
  d['配置文件'] = null
  d['conf 卡名'] = ''
  const spec = _唯一spec(根)
  d['spec'] = spec
  if (spec) {
    try {
      const doc = M.yload(spec) || {}
      d['spec 卡名'] = _文(((doc.character) || {}).name)
    } catch { /* 读不出来就当空 */ }
  }
  const conf_p = join(_文(根), 'hud', 'hud.conf.json')
  if (_是文件(conf_p)) {
    d['配置文件'] = conf_p
    try {
      const conf = OPENER._读json(conf_p) || {}
      d['conf 卡名'] = _文(conf['卡名'])
    } catch { /* 同上 */ }
  }
  d['一致'] = (!d['conf 卡名']) || (d['spec 卡名'] === d['conf 卡名'])
  return d
}


export function 改卡名(target, 新名, out = _print) {
  /**
   * 把卡名改成 新名：spec 的 `character.name` 与界面配置的「卡名」一起改。
   *
   * 为什么要有这条命令：卡名散在两处（spec 是真相，conf 是界面层要用的），
   * 没有命令时只能手改 spec —— 手改完 conf 还是旧名，`check` 也不报，
   * 导进 ElecKoi 看到的卡名跟工程目录对不上，无从查起（盲跑实测）。
   *
   * **工程目录名不动**：改目录会把用户此刻的路径、以及别人手里的链接一并打乱。
   * 目录要不要跟着改，打印出来提醒，由用户自己决定。
   */
  _要(OPENER, 'opener')
  const 名 = _削(新名)
  if (!名) {
    throw new ValueError('新卡名不能空。')
  }
  if (/[\\/:*?"<>|]/.test(名)) {
    throw new ValueError(`卡名不能带 \\ / : * ? " < > | 这些字符：${名}`)
  }

  const [根] = OPENER.定位(target)
  const spec = _唯一spec(根)
  if (!spec) {
    throw new FileNotFoundError(
      `这个工程里找不到唯一一份 spec（source/*.spec.yaml）：${根 || target}`)
  }

  const raw = C.load(spec)
  const 旧 = _文(((raw.character) || {}).name)
  const 改了 = []
  if (旧 !== 名) {
    C.put_trash(spec, '卡名', `把卡名从「${旧 || '（空）'}」改成「${名}」`,
      [{ 表: '卡名', 数据: { name: 旧 } }])
    if (!raw.character) raw.character = {}
    raw.character.name = 名
    C.commit(spec, raw, out)
    改了.push('spec')
  }

  const conf_p = join(根, 'hud', 'hud.conf.json')
  if (_是文件(conf_p)) {
    const conf = OPENER._读json(conf_p) || {}
    if (_文(conf['卡名']) !== 名) {
      conf['卡名'] = 名
      OPENER._写json(conf_p, conf)
      改了.push('界面配置')
    }
  }

  out(`卡名：${旧 || '（空）'} → ${名}`)
  if (改了.length) {
    out(`  改了：${改了.join('、')}`)
  } else {
    out('  （两处本来就是这个名字，没动）')
  }
  if (basename(根) !== 名) {
    out(`  ⚠ 工程目录还叫「${basename(根)}」—— 目录名不在改名范围内（免得打乱你现在的路径）；`)
    out('    想让目录名跟着改，自己在文件管理器里把那个文件夹重命名即可。')
  }
  return { 旧, 新: 名, 改了 }
}


export function _rel(target, base) {
  /**
   * Python 原件是 `os.path.relpath(target, base).replace("\\", "/")`，外面包一层
   * `except Exception: return target`。**那层 except 在 Windows 上不是摆设**：
   * ntpath.relpath 碰到两边盘符不同会抛 `ValueError: path is on mount 'C:', start on
   * mount 'E:'`，于是原样返回 target（绝对路径）。Node 的 `path.relative` 不抛，会算成
   * 一串 `../../…` —— 照抄就得自己把跨盘这一条拦下来，否则「制品里的路径」两边对不上。
   */
  const 盘 = (p) => {
    const m = /^([A-Za-z]):/.exec(resolve(p))
    return m ? m[1].toLowerCase() : null
  }
  try {
    const 甲 = 盘(target)
    if (甲 === null || 甲 !== 盘(base)) return target      // 跨盘（或认不出盘符）：原样返回
    // ★ Python 的 relpath 相等时给 `'.'`，Node 的 relative 给空串 —— 差这一个字符就逐字节红。
    return relative(base, target).split('\\').join('/') || '.'
  } catch {
    return target
  }
}
