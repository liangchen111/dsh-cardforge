#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * forge.mjs —— ElecKoi 制卡工具 · 命令行入口（`forge.py` 的 JS 移植）
 *
 * ==================================================================
 * 移植记号（这一份是逐字照抄 `E:\workGZQ\制卡工具\forge.py`，行为与打印文本
 * 必须一致；差分台 `差分\比一比.mjs::算_forge` 逐字节比）。
 *
 * 1. 工具根：Python `HERE = os.path.dirname(os.path.abspath(__file__))`（forge.py:78）
 *    对等物是 `_根 = resolve(_这里, '..')` —— 本文件住在 `forgejs\`，比工具根低一层。
 * 2. `import json/os/sys/time/zipfile` ⇒ node:fs / node:path / node:process；
 *    `sys.stdout.reconfigure(encoding="utf-8")` 在 JS 侧直接 `process.stdout.setDefaultEncoding`，
 *    Windows 下 stdout 一律按 UTF-8 字节写（差分台两侧都比字节）。
 * 3. `print(x)` ⇒ `_print(x)`（`content.mjs` 导出，写一行 + '\n'）；`print()` ⇒ `_print('')`。
 * 4. 真值判断一律走 `pyTruthy()`；`len()` 走 `lenPy()`；`os.path.*` 走 `plan.mjs` 的自写
 *    `_join/_abspath/_normpath/_basename/_dirname/_splitext`（`path.join` 与 `os.path.join`
 *    不是一回事）。
 * 5. `sys.exit(main())` 的语义放在模块级 `_自跑()` 里：`import.meta.url` 与 `process.argv[1]`
 *    指向同一文件时才跑 —— 被 `cli.mjs` 动态 import 时**不**自动执行。
 * 6. `forge.py` 里函数内的 `from forge import …`（guard / dist / bundle / draft）
 *    在 JS 侧提成模块级静态 import（ESM 静态 import 无循环初始化问题）。
 * 7. Python 的 `%r` ⇒ `pyRepr()`；`"%s" % None` ⇒ `"None"`；`"{:,}"`/`"%.1f"` 绝不走
 *    `toLocaleString`/`toFixed`（半值取偶），照 `theme.mjs::_roundPy/_fmt1`。
 * 8. **`M.ydump(对象, 路径)` 一律改成 `M.jdump(对象, 路径)` —— 文件名一个字不改。**
 *    `model.mjs::ydump()` 在 JS 侧是**故意抛出**的（零依赖复刻不了 PyYAML 排版），
 *    而 `计划 §二①` 定的就是「新产出默认写 .spec.json」；先例见 `coach.mjs:20` /
 *    `hud.mjs:22` / `mods.mjs:31` / `pack.mjs:110` / `theme.mjs:491`。差分台对
 *    `.spec.` 文件走 `M.loadStructured` 做**结构相等**，不比字节。
 * 9. **`lenPy()` 只能用来量字符串。** 它先 `Array.from(String(s))` 再数码点 ——
 *    传数组进去量到的是 `"a,b".length`。Python 的 `len(列表)` 在 JS 侧写 `.length`。
 * 10. ★ **Python 的关键字实参不能写成 `名字: 值`（那是 JS 的标签语句！）。**
 *    `MODS.apply_modules(spec, names, {project: p, out: f})` 或 `CONTENT.add_group(spec, 名, 父: '')`
 *    这种写法**语法合法、`node --check` 也过，但整句什么都不干**（值被求了就丢）——
 *    本轮逮到 27 处。对位办法：照 `forgejs/lib/*.mjs` 的**位置实参**写全
 *    （中间那些缺省的也要补齐：`add_object(spec, 名, 父, 说明, 更新规则, out)`）。
 *    查法见 `差分\_find_labels.mjs`（拿 `node --check` 当判据：把 `标识符:` 改成
 *    `标识符:;` 再解一次，还过就是标签语句）。
 * 11. ★ **Node 的 fs 错误不是 CPython 的 OSError。** `forge.py` 把异常打进 `%s` 时给的是
 *    `[Errno 2] No such file or directory: '并不存在.json'`（路径就是**调用时那个字符串**），
 *    Node 给的是 `ENOENT: no such file or directory, open '<绝对路径>'` ⇒ 类名、errno 说法、
 *    路径三样都得翻，见 `_OS表` / `_python化()` / `_错话()`。命令层自己 `catch` 的那二十来处
 *    走 `_错话(exc)`（拿 `_当前参` 把绝对路径还原成用户原样那一段）。
 *    覆盖到 ENOENT / EACCES / EPERM / EEXIST / ENOTDIR / EISDIR 等；**`[WinError N] …`
 *    那一族不管**（`os.remove` / `os.rename` 走 Win32 API 时才会出现），先例见
 *    `draft.mjs:127-143` 硬抄的三条。路径还原是**启发式**：命令行里逐段与 `_abspath` 比对，
 *    对不上就退回 Node 的绝对路径（两者分隔符写法不同时会露馅）。
 * 12. `print("!! %s: %s" % (type(exc).__name__, exc))` 里的类名：JS 侧用
 *    `exc.constructor.name`；`forge.mjs` 自己造的类名（`ArgError` / `ContentError` …）
 *    与 Python 同名，但 **Node 的内建 `Error` 必须先过 `_python化()`** 才报得出
 *    `FileNotFoundError` 这种名字。
 * 13. `cmd_selftest` 的移植记号（`forge.py:950-2467`，42 项）：
 *    · 第 34 项「子命令用法」Python 起 33 个 `subprocess`；**JS 侧不起进程**（本机沙箱下
 *      piped stdio 会 EPERM）⇒ `process.chdir(探)` + 进程内调 `_打命令用法(c)` +
 *      换 `process.stdout.write` 收字，`finally` 还原 cwd。
 *    · 第 42 项「沙箱友好模式」Python 把 `os.replace`/`os.remove`/`shutil.rmtree` 换成
 *      `_炸弹`；**JS 侧不做猴子补丁**（ESM 具名导入没法从外面替），只留
 *      `SB.enable(true)` / `finally SB.enable(false)` —— JS 侧落盘本来就统一走
 *      `SB.land/rename/remove/rmtree`，那一层就是同一个闸。
 *    · 第 16 项要 zip 名单、第 22 项要造恶意 zip：用 `BUNDLE._写zip()` 与自己写的
 *      `_zip列名()`（读中央目录），**不为了这两处去给已经绿的 `dist.mjs` 加导出**。
 *    · `open(p, "w", encoding="utf-8")` 在 Windows 是**文本模式**，`\n` 会翻成 `os.linesep`
 *      ⇒ 写成 `s.split('\n').join('\r\n')` 再 `writeFileSync`；原文标了 `newline='\n'` 的
 *      才是直写。`'\\u200b'`（**字面反斜杠**）与 `'\u200b'`（**真零宽字符**）两处都在自检里，
 *      别抄混。
 *    · 第 45 项原文有一处笔误（打错误用的是 `r45` 而不是 `r改45`）—— **照抄**，不改。
 * ==================================================================
 */
import {
  copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync,
  unlinkSync, utimesSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as M from './lib/model.mjs'
import * as pack from './lib/pack.mjs'
import * as validate from './lib/validate.mjs'
import * as scaffold from './lib/scaffold.mjs'
import * as mods from './lib/mods.mjs'
import * as CONTENT from './lib/content.mjs'
import * as OPENER from './lib/opener.mjs'
import * as HUD from './lib/hud.mjs'
import * as THEME from './lib/theme.mjs'
import * as PNG from './lib/png.mjs'
import * as PRESET from './lib/preset.mjs'
import * as PLAN from './lib/plan.mjs'
import * as LINT from './lib/lint.mjs'
import * as manual from './lib/manual.mjs'
import * as DRAFT from './lib/draft.mjs'
import * as COACH from './lib/coach.mjs'
import * as bridge from './lib/bridge.mjs'
import * as exportMod from './lib/export.mjs'
import * as ZOD from './lib/zod.mjs'
import * as domain from './lib/domain.mjs'
import * as SB from './lib/sandbox.mjs'
import * as guard from './lib/guard.mjs'
import * as DIST from './lib/dist.mjs'
import * as BUNDLE from './lib/bundle.mjs'

const _这里 = resolve(fileURLToPath(import.meta.url), '..')
export const _根 = resolve(_这里, '..')
export const HERE = _根

const _print = CONTENT._print
const { pyTruthy, lenPy, pyRepr, 比串 } = CONTENT

// `plan.mjs` 的自写 `os.path.*` 四件（`path.join` 与 `os.path.join` 不是一回事：
// Python 的 join 保留原有分隔符写法，`path.join` 会重排）。
const _join = (...a) => PLAN._join(...a)
const _abspath = (p) => PLAN._abspath(p)
const _normpath = (p) => PLAN._normpath(p)
const _basename = (p) => PLAN._basename(p)
const _dirname = (p) => PLAN._dirname(p)
const _splitext = (p) => PLAN._splitext(p)

const _是文件 = (p) => { try { return statSync(p).isFile() } catch { return false } }
const _是目录 = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const _存在 = (p) => existsSync(p)
const _读文本 = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

/**
 * Python `"%-40s" % s` 的对等物：**左对齐、按码点计数、不够的补空格**。
 * （`padEnd` 数的是 UTF-16 码元，中文名会算多；`validate.mjs` 的 `lenPy` 是码点。）
 */
export function _pad(s, n) {
  const t = s === null || s === undefined ? 'None' : String(s)
  const d = n - lenPy(t)
  return d > 0 ? t + ' '.repeat(d) : t
}

/** 从 `coach.mjs` 的 `KeyError.message`（`pyRepr` 过的那层引号）里取回没带引号的原话。 */
function _键错原话(exc) {
  const m = _错话(exc)
  if ((m.startsWith("'") && m.endsWith("'")) || (m.startsWith('"') && m.endsWith('"'))) {
    return m.slice(1, -1)
  }
  return m
}

// ------------------------------------------------------------------ HELP
export const HELP = `forge.py —— ElecKoi 制卡工具 · 命令行入口

一条命令的用法：

    python forge.py new   <你的卡名>              开一张新卡（抄骨架 + 界面层）
                              --从 <卡.json / 工程包.zip / spec.yaml / 工程目录>
                                                连界面层一起接手一张现成的卡（内容层用它的）
    python forge.py unpack <卡.json>              卡 -> 可读 spec.yaml
    python forge.py build  <spec.yaml> [出.json]  spec -> 卡
    python forge.py check  <文件 或 目录>          校验（值域 + 一致性 + 护栏 + 界面守则）
    python forge.py entry  <spec> --新 "标题"       加一条条目（--列 / 看 / 改 / 复制 / 挪 / 删；都能一次给一串）
    python forge.py name   <工程 或 spec> --改 新卡名  改卡名（spec 与界面配置一起改）
    python forge.py opener <工程> --正文@开场白.txt  换开场白（末尾那三个零宽标记工具负责）
    python forge.py group  <spec> --新 <名>        加一个分组（--列 / --改名 / --删）
    python forge.py var    <spec> --新 玩家.声望    加一个变量（三处一次写全；--改名 / --换对象 / --删 可给一串）
    python forge.py regex  <spec> --新 <名> --模式 "…"   加一条正则（--列 / --删 / --启 / --停）
    python forge.py trash  <工程>                  回收站：删掉的东西都在这儿，能放回去
    python forge.py hud    <工程 或 spec>          组装卡内 HUD（出 预览.html）
    python forge.py analyze <卡文件> ...           拆解报告（酒馆 / ElecKoi 都认）
    python forge.py to-eleckoi <酒馆卡> <出.yaml>  酒馆卡 -> ElecKoi 规格
    python forge.py to-tavern <ElecKoi卡> <出.json> ElecKoi 卡 -> 酒馆 V2 卡
    python forge.py png    <卡.json 或 spec.yaml> [-o 出.png] [--图 封面.png]
                                                出「可以当图片导入」的卡（.card.png）
                                                不加 --图 就现画一张渐变封面
    python forge.py preset <卡.json 或 spec.yaml> [-o 出.preset.json] [--png [出.png]]
                                                把卡里的设定搬成一份 ElecKoi「创作预设」
                                                （--名 改预设名 · --项 只搬这几条 · --png 一并出图）
    python forge.py plan   [<卡.json 或 spec.yaml>] [-o 出.md]
                                                写卡之前先落一份规划书；给了卡就从卡反推
                                                （\`plan --查 规划书.md\` 查缺什么）
    python forge.py lint   [<卡 或 文稿 或 ->] [-o 报告.md]
                                                正文体检（防八股）：只查句式骨架，不查词
                                                （\`lint --标准\` 打判据表；\`-\` 读标准输入）
    python forge.py manual <spec 或 卡> [-o 出.html]  生成人读手册（同时出索引）
    python forge.py index  <spec 或 卡> [-o 出.md]    生成给 AI 的导航索引
    python forge.py coach  [--到 <目录>]            出「怎么做一张卡」：给 AI 的规程 + 给 ElecKoi 的向导卡
    python forge.py guide  [--节 <名>|--篇 <名>|--对话 <名>|--全文]  打印制卡规程（给 AI 按需取：不给参数＝目录）
    python forge.py make   <卡稿.yaml> [--到 <目录>]  照一份卡稿一次落成整张卡（--示例 / --模板 / --试 / --覆盖）
    python forge.py mods  [--工程 <工程>]          列出模块（带版本；给工程则标出接没接）
    python forge.py add    <模块> <spec.yaml>      给卡挂上一块现成的机制
    python forge.py drop   <模块> <spec.yaml>      撤掉一块机制（add 的反操作，按账本精确撤）
    python forge.py theme  [<主题名> <工程>]        列出 / 换皮肤（只覆盖颜色槽，不碰版式）
    python forge.py theme  --导出 <工程>            把这张卡的配色导成一份皮肤文件（可发人）
    python forge.py theme  --导入 <皮肤.json> <工程> 套上别人给的皮肤（--装 则收进主题库）
    python forge.py bundle <工程> [-o 出.zip]       把工程打成一个包（分发用）
    python forge.py import <包.zip 或 卡.json>       收包：落到本地成一张能接着改的工程
    python forge.py diff   <a.json> <b.json>      语义比对
    python forge.py domains                       打印真值域表
    python forge.py selftest                      自检：四十二项，含负向用例与往返比对

沙箱友好模式：任何命令后面加 \`--沙箱\`（或设 \`FORGE_SANDBOX=1\`），
forge 就只创建、只覆盖 —— 不删文件、不改名。给「在受限沙箱里跑」的场合用
（ElecKoi 里的 AI 跑命令就是这种环境：能读能写，但不许删、不许改名）。
代价是丢掉原子落盘，所以**能用普通模式就用普通模式**。

设计约定：**spec.yaml 是唯一真相，card.json 是派生物。只手改 spec。**
界面那一层住在本工程里（\`hud/\` 与 \`<卡>.spec.yaml\` 同处一个工程目录）。

长正文这么写：凡是要写一段话的参数（\`--正文\` / \`--标题\` / \`--说明\` / \`--模式\` / \`--替换\`…）
值都可以写成 \`@文件名\`，从那个文件读 —— 换行、引号、多长都不必跟 shell 的转义规则搏斗。
例：\`python forge.py entry <spec> --改 "核心 · 世界总纲" --正文@世界总纲.txt\`。
读一条现在写了什么：\`python forge.py entry <spec> --看 "id 或 标题"\`。
查一个命令怎么用：\`python forge.py <命令> --help\`（例：\`python forge.py entry --help\`）。
`

// ------------------------------------------------------------------ 命令
export function cmd_new(argv) {
  if (!argv.length) {
    _print('用法：python forge.py new <卡名> [--到 目录] [--id 前缀] [--模块 骰子,备份]')
    _print('      python forge.py new <卡名> --从 <卡.json / 工程包.zip / spec.yaml / 工程目录>')
    return 2
  }
  const name = argv[0]
  let dest = null; let prefix = null; let wanted = []; let 来源 = null
  let i = 1
  while (i < argv.length) {
    if (['--到', '--to', '-d'].includes(argv[i]) && i + 1 < argv.length) {
      dest = argv[i + 1]; i += 2
    } else if (['--id', '-i'].includes(argv[i]) && i + 1 < argv.length) {
      prefix = argv[i + 1]; i += 2
    } else if (['--从', '--from', '-f'].includes(argv[i]) && i + 1 < argv.length) {
      来源: argv[i + 1]; i += 2
    } else if (['--模块', '--带', '--mods'].includes(argv[i]) && i + 1 < argv.length) {
      wanted = argv[i + 1].replace(/，/g, ',').split(',')
        .map((x) => x.trim()).filter((x) => x)
      i += 2
    } else {
      _print(`认不得的参数：${argv[i]}`); return 2
    }
  }
  scaffold.new_card(name, dest, prefix, false, wanted, true, 来源)
  return 0
}

export function cmd_name(argv) {
  if (!argv.length || argv[0].startsWith('-')) {
    _print('用法：python forge.py name <工程 或 spec> --看              现在叫什么、几处一致')
    _print('      python forge.py name <工程 或 spec> --改 <新卡名>     改卡名（spec 与界面配置一起改）')
    _print('      （卡名散在两处：spec 的 character.name 是真源，hud/hud.conf.json 的「卡名」')
    _print('        给界面用。这条命令把两处一起改，免得改一处、另一处悄悄留着旧名。）')
    return 2
  }
  const target = argv[0]
  if (argv.includes('--看') || argv.includes('--show')) {
    _print_cardname(scaffold.看卡名(target))
    return 0
  }
  const 新 = _opt(argv, ['--改', '--set', '--to'])
  if (新 === null) {
    _print('没说要改成什么。用法：python forge.py name <工程> --改 <新卡名>')
    return 2
  }
  try {
    scaffold.改卡名(target, 新)
  } catch (exc) {
    if (exc instanceof scaffold.ValueError || exc instanceof scaffold.FileNotFoundError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
  return 0
}

export function _print_cardname(d) {
  _print('卡名 · 现状')
  _print('─'.repeat(56))
  for (const [k, v] of [['工程', d.工程], ['spec', d.spec || '（没有）'],
    ['目录名', d.目录名], ['spec 里的名字', d['spec 卡名'] || '（空）'],
    ['界面配置', d.配置文件 || '（没有界面层）'],
    ['配置里的卡名', d['conf 卡名'] || '（空）']]) {
    _print(`  ${_标签(k, 14)}${_pyStr(v)}`)
  }
  _print('')
  if (d.一致) {
    _print('  两处一致 ✔')
  } else {
    _print('  ⚠ 两处不一样 —— 导进 ElecKoi 显示的是 spec 里那个名字，会跟工程目录对不上。')
    _print(`    改成同一个： python forge.py name <工程> --改 "${d['conf 卡名']}"`)
  }
}

export function cmd_mods(argv) {
  const proj = _opt(argv, ['--工程', '--project', '-p'])
  mods.print_modules(proj)
  return 0
}

export function cmd_add(argv) {
  if (argv.length < 2) {
    _print('用法：python forge.py add <模块> <spec.yaml> [<模块2> ...]')
    _print('      先跑 `python forge.py mods` 看有哪些模块。')
    return 2
  }
  const spec = argv[argv.length - 1]
  if (!_存在(spec)) {
    _print(`找不到 spec：${spec}`)
    return 2
  }
  const names = argv.slice(0, -1)
  _print(`往 ${_basename(spec)} 里并模块：`)
  const done = mods.apply_modules(spec, names)
  if (!done) {
    _print('  没有并进任何模块。')
    return 1
  }
  _print('')
  _print(`下一步： python forge.py check "${spec}"`)
  _print(`       python forge.py hud   "${_dirname(_dirname(_abspath(spec)))}" --写回   （界面跟着一起更新）`)
  _print(`       撤法： python forge.py drop <模块> "${spec}"`)
  return 0
}

export function cmd_drop(argv) {
  if (argv.length < 2) {
    _print('用法：python forge.py drop <模块> <spec.yaml> [<模块2> ...]')
    _print('      撤掉 add 接上的东西：替换的还原、新增的删掉、正则按 id 删、'
      + '界面文件与登记一并摘掉。')
    _print('      只撤账本里记着的；手写进 spec 的东西一律不动。')
    return 2
  }
  const spec = argv[argv.length - 1]
  if (!_存在(spec)) {
    _print(`找不到 spec：${spec}`)
    return 2
  }
  const names = argv.slice(0, -1)
  _print(`从 ${_basename(spec)} 里撤模块：`)
  const dropped = mods.drop_modules(spec, names)
  if (!dropped) {
    _print('  没有撤掉任何模块。')
    return 1
  }
  _print('')
  _print(`下一步： python forge.py check "${spec}"`)
  const proj = _dirname(_dirname(_abspath(spec)))
  if (_是文件(_join(proj, 'hud', 'hud.conf.json'))) {
    _print(`       python forge.py hud   "${proj}" --写回   （界面也跟着摘掉）`)
  }
  return 0
}

export function cmd_import(argv) {
  if (!argv.length) {
    _print('用法：python forge.py import <工程包.zip 或 卡.json> [--到 目录] [--改名] [--不校验]')
    _print('      收包：把别人给的工程包（或单张卡）落到本地，成一张能接着改的工程。')
    return 2
  }
  let dest_root = _opt(argv, ['--到', '--to', '-d'])
  const src = argv.find((a) => !a.startsWith('-') && a !== dest_root) ?? null
  if (src === null) {
    _print('没给包。')
    return 2
  }

  dest_root = _abspath(dest_root !== null && dest_root !== undefined ? dest_root : process.cwd())
  // 只读禁区（内核名单，见 forge/guard.py）：往外写之前先看一眼
  const why = guard.readonly_reason(dest_root)
  if (why) {
    _print(`!! 落点在一个只读禁区里，不写：${dest_root}`)
    _print(`   ${why}`)
    return 1
  }

  try {
    DIST.import_pack(src, dest_root, argv.includes('--改名') || argv.includes('--rename'),
      !(argv.includes('--不校验') || argv.includes('--no-verify')))
  } catch (exc) {
    _print(`!! ${_错话(exc)}`)
    return 1
  }
  return 0
}


export function cmd_theme(argv) {
  // `--导出` / `--导入` / `--装`：让一套皮肤能离开这台电脑
  if (argv.includes('--导出') || argv.includes('--export')) {
    const out_p = _opt(argv, ['-o', '--out'])
    const nm = _opt(argv, ['--名', '--name'])
    const target = argv.find((a) => !a.startsWith('-')
      && a !== out_p && a !== nm) ?? null
    if (target === null) {
      _print('用法：python forge.py theme --导出 <工程 或 spec> [-o 出.json] [--名 皮肤名]')
      return 2
    }
    try {
      THEME.export_theme(target, out_p, nm)
    } catch (exc) {
      if (exc instanceof THEME.ThemeError) {
        _print(`!! ${_错话(exc)}`)
        return 1
      }
      throw exc
    }
    return 0
  }

  if (argv.includes('--导入') || argv.includes('--import')
    || argv.includes('--装') || argv.includes('--install')) {
    const want_install = (argv.includes('--装') || argv.includes('--install'))
    const rest = argv.filter((a) => !a.startsWith('-'))
    if (rest.length < 2) {
      _print('用法：python forge.py theme --导入 <皮肤.json> <工程 或 spec> [--装]')
      _print('      --装 = 导入 + 收进 assets/主题/，从此任何卡都能换。')
      return 2
    }
    const [json_path, target] = [rest[0], rest[1]]
    try {
      THEME.import_theme(json_path, target, want_install)
    } catch (exc) {
      if (exc instanceof THEME.ThemeError) {
        _print(`!! ${_错话(exc)}`)
        return 1
      }
      throw exc
    }
    return 0
  }

  // `--巡览`：把这张卡在每套皮肤下各渲一遍，拼成一页对照图（不改工程现在的皮肤）
  if (argv.includes('--巡览') || argv.includes('--showcase')) {
    const rest = argv.filter((a) => !['--巡览', '--showcase'].includes(a))
    const target = rest.find((a) => !a.startsWith('-')) ?? null
    if (target === null) {
      _print('用法：python forge.py theme --巡览 <工程 或 spec> [-o 出.html]')
      return 2
    }
    try {
      THEME.showcase(target, _opt(argv, ['-o', '--out']))
    } catch (exc) {
      if (exc instanceof THEME.ThemeError || exc instanceof HUD.HudError) {
        _print(`!! ${_错话(exc)}`)
        return 1
      }
      throw exc
    }
    return 0
  }

  // `--撤` 单独处理：它自己就是个开关，不能被「滤掉带横杠的参数」那一步吃掉
  if (argv.includes('--撤') || argv.includes('--clear')) {
    const rest = argv.filter((a) => !['--撤', '--clear'].includes(a))
    const target = rest.find((a) => !a.startsWith('-')) ?? null
    if (target === null) {
      _print('用法：python forge.py theme --撤 <工程 或 spec>')
      return 2
    }
    try {
      THEME.clear_theme(target)
    } catch (exc) {
      if (exc instanceof THEME.ThemeError) {
        _print(`!! ${_错话(exc)}`)
        return 1
      }
      throw exc
    }
    return 0
  }

  const args = argv.filter((a) => !a.startsWith('-'))
  if (!args.length) {
    THEME.print_themes(_opt(argv, ['--工程', '--project', '-p']))
    return 0
  }
  if (args.length < 2) {
    if (_存在(args[0])) {          // 只给一个词且那是个路径 = 看现在用什么
      try {
        _print(`现在这套：${THEME.current(args[0])}`)
      } catch (exc) {
        if (exc instanceof THEME.ThemeError) {
          _print(`!! ${_错话(exc)}`)
          return 1
        }
        throw exc
      }
      return 0
    }
    _print('用法：python forge.py theme <主题名> <工程 或 spec>')
    _print('      python forge.py theme                    看有哪些主题')
    _print('      python forge.py theme <工程>              看这张卡现在用哪套')
    _print('      python forge.py theme --撤 <工程>          回到核心默认')
    _print('      python forge.py theme --导出 <工程>        把这张卡的配色导成一份皮肤文件')
    _print('      python forge.py theme --导入 <皮肤.json> <工程>   套上别人给的皮肤')
    return 2
  }
  const [name, target] = [args[0], args[1]]
  try {
    THEME.apply_theme(name, target)
  } catch (exc) {
    if (exc instanceof THEME.ThemeError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
  return 0
}


export function cmd_unpack(argv) {
  if (!argv.length) {
    _print('用法：python forge.py unpack <卡.json> [-o 出.yaml]')
    return 2
  }
  const src = argv[0]
  const out = (argv.length > 2 && ['-o', '--out'].includes(argv[1])) ? argv[2] : null
  const path = pack.unpack(src, out)
  _print(`已解包 -> ${path}`)
  _print(`  下一步：改它，然后 python forge.py build "${path}"`)
  return 0
}


export function cmd_build(argv) {
  if (!argv.length) {
    _print('用法：python forge.py build <spec.yaml> [出.json]')
    return 2
  }
  const spec = argv[0]
  let out
  if (argv.length > 1) {
    out = argv[1]
  } else {
    const stem = _splitext(_basename(spec))[0]
    out = _join(_dirname(_abspath(spec)),
      '..', '成品', stem.replace(/\.spec/g, '') + '.card.json')
    out = _normpath(out)
  }
  mkdirSync(_dirname(_abspath(out)), { recursive: true })
  pack.build(spec, out)
  const card = M.jload(out)
  const s = validate.summarize(card)
  _print(`已打包 -> ${out}`)
  _print(`  条目 ${s.entries} · 分组 ${s.groups} · 变量 ${s.variables} · 正则 ${s.regex}`)
  return 0
}


export function cmd_check(argv) {
  if (!argv.length) {
    _print('用法：python forge.py check <spec.yaml 或 卡.json 或 目录> [更多...]')
    return 2
  }
  const targets = []
  for (const a of argv) {
    if (a.startsWith('-')) continue
    if (_是目录(a)) targets.push(..._collect(a))
    else if (_存在(a)) targets.push(a)
    else {
      _print(`找不到：${a}`)
      return 2
    }
  }
  if (!targets.length) {
    _print('没找到可校验的文件（.spec.yaml / .card.json）。')
    return 2
  }

  let total_err = 0
  const rows = []
  const seen_projects = new Set()
  for (const path of targets) {
    let card
    let label
    try {
      if (M.isYaml(path)) {
        card = pack.spec_to_card(path)
        label = _basename(path)
      } else {
        card = M.jload(path)
        label = _basename(path)
      }
    } catch (exc) {
      rows.push([path, '读不出版', [`${_错话(exc)}`]])
      total_err += 1
      continue
    }
    let issues = validate.validate_card(card, label)

    // 这份 spec/卡 若住在某个工程里，顺带把**工程层**与**界面层**也体检一遍
    const proj = _project_of_path(path)
    if (!seen_projects.has(proj)) {
      seen_projects.add(proj)
      issues = issues.concat(validate.validate_project(proj))
      if (_是文件(_join(proj, 'hud', 'hud.conf.json'))) {
        issues = issues.concat(validate.validate_hud(proj))
      }
    }

    const errs = issues.filter((i) => i.level === 'ERROR')
    total_err += errs.length
    rows.push([path, errs.length ? `${errs.length} 错` : 'ok',
      errs.map((i) => i.line())])
    if (targets.length === 1) {
      validate.print_report(card, label, issues)
    }
  }

  if (targets.length > 1) {
    _print('='.repeat(74))
    _print(`批量校验 · ${targets.length} 个文件`)
    _print('='.repeat(74))
    for (const [path, verdict, lines] of rows) {
      const mark = verdict === 'ok' ? '✔' : '✗'
      _print(`  ${mark} ${_pad(_basename(path), 40)} ${verdict}`)
      for (const ln of lines.slice(0, 3)) {
        _print(`      ${ln}`)
      }
    }
    _print('-'.repeat(74))
    _print(`${targets.length} 个文件 · ${total_err} 个错误`)
  }
  return total_err ? 1 : 0
}


export function _project_of_path(path) {
  // 从 spec/卡 的位置折出工程根（`<工程>/source/x.spec.yaml`、`<工程>/成品/x.card.json`）。
  let p = _dirname(_abspath(path))
  if (['source', '成品', '文档'].includes(_basename(p))) {
    p = _dirname(p)
  }
  return p
}


export function _collect(root) {
  // 把一个目录里所有的 spec / 卡收集起来（跳过产物目录与缓存）。
  const skip = new Set(['__pycache__', 'out', 'node_modules', '.git', '.forge'])
  const got = []
  const walk = (base) => {
    let names
    try {
      names = readdirSync(base, { withFileTypes: true })
    } catch {
      return
    }
    const dirs = names.filter((d) => d.isDirectory() && !skip.has(d.name)
      && !d.name.startsWith('.'))
    const files = names.filter((d) => d.isFile()).map((d) => d.name)
    files.sort(比串)
    for (const f of files) {
      if (f.endsWith('.spec.yaml') || f.endsWith('.card.json')) {
        got.push(_join(base, f))
      }
    }
    for (const d of dirs.sort((a, b) => 比串(a.name, b.name))) {
      walk(_join(base, d.name))
    }
  }
  walk(root)
  return got
}


export function cmd_hud(argv) {
  if (!argv.length) {
    _print('用法：python forge.py hud <工程目录 或 source/*.spec.yaml> [--写回]')
    _print('      组装卡内 HUD：拼页面 -> 出 预览.html；--写回 再把正则写回 spec。')
    return 2
  }
  let target = null
  for (const a of argv) {
    if (!a.startsWith('-')) {
      target = a
      break
    }
  }
  if (target === null) {
    _print('没给工程或 spec。')
    return 2
  }
  const write_back = (argv.includes('--写回') || argv.includes('--patch'))
  let problems
  try {
    ;[problems] = HUD.build(target, write_back)
  } catch (exc) {
    if (exc instanceof HUD.HudError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
  return pyTruthy(problems) ? 1 : 0
}


export function _print_opener(d) {
  if (!d.有开场白) {
    _print('这个工程没有开场白 —— hud.conf.json 里没有「开场白」这一块。')
    _print(`  conf：${d.配置文件}`)
    _print('  （没有它，开场那一步由宿主自己填。想要就照别的工程的形状补一块。）')
    return
  }
  const 内容档 = d.模式 === '内容'
  _print(`开场白 · ${_basename(d.工程)}`)
  _print('─'.repeat(62))
  if (内容档) {
    _print(_标签('真源') + 'spec 里那条（这个工程没有界面层，没有 conf 在上面盖）')
  }
  _print(_标签('配置文件') + (d.配置文件 || '（没有——内容档）'))
  _print(_标签('挂到条目') + (d.条目 || '（没写）'))
  _print(_标签('字数') + `${d.字数}（不含末尾标记）`)
  const n = d.标记数
  _print(_标签('零宽标记') + (n === 3 ? `末尾 ${n} 个 ✔`
    : `末尾 ${n} 个 ✗ 该是 3 个 —— 少了建卡界面不会出现，跑 --补齐`))
  _print(_标签('尖括号') + (d.尖括号 ? '有 ✗ 会从会话预览里露出来' : '无 ✔'))
  if (pyTruthy(d.方案)) {
    _print(_标签('方案') + `${d.方案.length} 个：${d.方案.join('、')}（写回后共用这一份正文）`)
  }
  if (d.写回一致 === null || d.写回一致 === undefined) {
    _print(_标签('写回状态') + `spec 里没有这条（${d.条目 || '?'}）—— 开场那一步交给宿主`)
  } else if (内容档) {
    _print(_标签('写回状态') + '不用写回 —— 改的就是 spec 里那条')
  } else {
    _print(_标签('写回状态') + (d.写回一致
      ? '与 spec 一致 ✔'
      : '与 spec 不一致 ✗ —— 跑 --写回 灌进去'))
  }
  _print('')
  _print('正文：')
  _print(d.正文.replace(/\u200b+$/, '') || '（空）')
  _print('')
  if (内容档) {
    _print('（这个工程没有界面层，本来不需要末尾那 3 个零宽标记 —— 工具仍然按规矩补着，'
      + '将来给这张卡接界面时就不用再回头补）')
  } else {
    _print(`（末尾那 ${n} 个看不见的零宽空格就是它 —— 建卡界面靠它触发）`)
  }
}


export function cmd_opener(argv) {
  const 用法 = (
    '用法：python forge.py opener <工程> --看              看开场白（正文 / 标记 / 写回没写回）\n'
    + '      python forge.py opener <工程> --正文@开场白.txt   换正文（末尾的零宽标记自动补齐，改完写回 spec）\n'
    + '      python forge.py opener <工程> --补齐             只补末尾的零宽标记（少了，建卡界面会静默消失）\n'
    + '      python forge.py opener <工程> --写回             只写回（不改正文）\n'
    + '  （工程有界面层时，开场白的真源是 hud/hud.conf.json，spec 里那条是派生物；\n'
    + '   只有 source/ 的工程（比如 import 进来的单张卡）没有界面层，spec 里那条就是真源，\n'
    + '   改它不会「改了白改」—— 两种都认。\n'
    + '    --正文 默认改完顺手写回；想先只改配置，加 --不写回）')
  if (!argv.length || argv[0].startsWith('-')) {
    _print(用法)
    return 2
  }
  const target = argv[0]
  const 带正文 = argv.some((a) => a.startsWith('--正文') || a.startsWith('--body'))
  try {
    if (argv.includes('--看') || argv.includes('--show')) {
      _print_opener(OPENER.读(target))
      return 0
    }
    if (argv.includes('--补齐')) {
      OPENER.补齐(target)
      return 0
    }
    if ((argv.includes('--写回') || argv.includes('--patch')) && !带正文) {
      OPENER.写回(target)
      return 0
    }
    if (!带正文) {
      _print(用法)
      return 2
    }
    OPENER.改正文(target, _opt(argv, ['--正文', '--body']),
      !argv.includes('--不写回'))
    return 0
  } catch (exc) {
    if (exc instanceof OPENER.OpenerError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
}


export function cmd_bundle(argv) {
  if (!argv.length) {
    _print('用法：python forge.py bundle <工程目录> [-o 出.zip] [--带卡]')
    _print('      打的是**工程分发包**（含界面层源码，给人接着改）。')
    _print('      它会把工程顺手收一遍：重组 HUD → 写回 spec → 重出成品卡 → 重出手册与索引；')
    _print('      --带卡 时再额外导出一张酒馆 V2 卡 .json。')
    _print('      只要成品卡、不要工程包：用 `python forge.py build <spec> <出.json>`。')
    return 2
  }
  let target = null
  for (const a of argv) {
    if (!a.startsWith('-')) {
      target = a
      break
    }
  }
  if (target === null) {
    _print('没给工程目录。')
    return 2
  }
  try {
    BUNDLE.run(target, _opt(argv, ['-o', '--out']), argv.includes('--带卡'))
  } catch (exc) {
    _print(`!! ${_错话(exc)}`)
    return 1
  }
  return 0
}


export function cmd_analyze(argv) {
  if (!argv.length) {
    _print('用法：python forge.py analyze <卡文件> ...')
    return 2
  }
  for (const p of argv) {
    try {
      bridge.analyze(p)
    } catch (exc) {
      _print(`!! ${_basename(p)}: ${_错话(exc)}`)
    }
    _print('')
  }
  return 0
}


export function cmd_to_eleckoi(argv) {
  if (argv.length < 2) {
    _print('用法：python forge.py to-eleckoi <酒馆卡> <出.yaml>')
    return 2
  }
  try {
    bridge.to_eleckoi(argv[0], argv[1])
  } catch (exc) {
    _print(`!! ${_错话(exc)}`)
    return 1
  }
  return 0
}


export function cmd_to_tavern(argv) {
  if (argv.length < 2) {
    _print('用法：python forge.py to-tavern <ElecKoi卡 或 spec.yaml> <出.json> [--带原卡]')
    return 2
  }
  let [src, out_path] = [argv[0], argv[1]]
  const keep_raw = argv.includes('--带原卡')
  let tmp = null
  try {
    if (M.isYaml(src)) {
      tmp = M.tempJson()
      pack.build(src, tmp)
      src = tmp
    }
    exportMod.to_tavern(src, out_path, keep_raw)
  } catch (exc) {
    _print(`!! ${_错话(exc)}`)
    return 1
  } finally {
    SB.cleanup(tmp)
  }
  return 0
}


export function cmd_png(argv) {
  if (!argv.length) {
    _print('用法：python forge.py png <卡.json 或 spec.yaml> [-o 出.png] [--图 封面.png] [--带酒馆块]')
    _print('')
    _print('  出一条**可以当图片导入**的卡：把成品卡嵌进 PNG 的 tEXt 块 `eleckoi-card`')
    _print('  （= base64(gzip(卡 JSON))）—— 手机与客户端「导入角色」选图片走的就是这条路，')
    _print('  只给 .card.json 对方是导不进去的。')
    _print('  再加一段 iTXt 摘要；像素一个字节不动，同一份卡跑两次得到同一个 PNG。')
    _print('  **默认不写酒馆的 `chara` 块** —— 官方「角色卡同步协议」明写导出不得携带')
    _print('  第三方兼容载荷，验收条款还专门查这个。真要一份酒馆也能吃的图，加 --带酒馆块。')
    _print('  --图 不给就现画一张渐变封面（本工具不依赖 Pillow）。')
    return 2
  }
  let src = argv[0]
  const out_path = _opt(argv, ['-o', '--out']) || PNG.default_out(src)
  const cover = _opt(argv, ['--图', '--cover'])
  const 带酒馆块 = argv.some((a) => ['--带酒馆块', '--tavern'].includes(a))
  if (带酒馆块) {
    argv = argv.filter((a) => !['--带酒馆块', '--tavern'].includes(a))
  }
  let tmp = null
  try {
    if (M.isYaml(src)) {
      tmp = M.tempJson()
      pack.build(src, tmp)
      src = tmp
    }
    const res = PNG.write(src, out_path, cover, 'card', false, 带酒馆块)
    PNG.verify(res.png, null, 带酒馆块)
  } catch (exc) {
    _print(`!! ${_错话(exc)}`)
    return 1
  } finally {
    SB.cleanup(tmp)
  }
  return 0
}


export function cmd_preset(argv) {
  if (!argv.length) {
    _print('用法：python forge.py preset <卡.json 或 spec.yaml> [-o 出.preset.json] [--png [出.png]]')
    _print('')
    _print('  把卡里那套设定搬成一份 ElecKoi **创作预设**（`eleckoi.agent-preset` v2）——')
    _print('  在客户端「预设管理器 → 导入预设」选它、分类选「创作预设」，AI 就带着这套')
    _print('  设定与规程干活。角色卡是「一次对话演一个人」，创作预设是「一次对话配一套做法」。')
    _print('  条目按客户端白名单逐条核（kind / position / agent_read_strategy …），')
    _print('  角色扮演机件（隐藏工具时间线、历史压缩）留在卡里不搬过来。')
    _print('  可选项：--名 <预设名> · --作者 <署名> · --说明 <文字或 .md 文件>')
    _print('          --工具组 a,b（默认 builtin:creator）· --版本名 <名>')
    _print('          --留引擎条目（默认丢掉那两类机件）· --png [出.png] 一并出图片版')
    return 2
  }
  let src = argv[0]
  const out_path = _opt(argv, ['-o', '--out']) || PRESET.default_out(src)
  const name = _opt(argv, ['--名', '--name'])
  const author = _opt(argv, ['--作者', '--author']) || ''
  let instructions = _opt(argv, ['--说明', '--instructions'])
  if (instructions && _是文件(instructions)) {
    instructions = _读文本(instructions).trim()
  }
  const version_name = _opt(argv, ['--版本名', '--version-name']) || ''
  const groups = _opt(argv, ['--工具组', '--groups'])
  const tool_groups = groups ? groups.split(',').map((g) => g.trim()).filter((g) => g) : null
  const drop_engine = !(argv.includes('--留引擎条目') || argv.includes('--keep-engine'))

  let tmp = null
  try {
    if (M.isYaml(src)) {
      tmp = M.tempJson()
      pack.build(src, tmp)
      src = tmp
    }
    const got = PRESET.build(src, out_path, name, author,
      instructions, tool_groups, version_name, drop_engine)
    PRESET.verify(got.json)
    if (argv.includes('--png')) {
      const idx = argv.indexOf('--png')
      let png_out = null
      if (idx + 1 < argv.length && !argv[idx + 1].startsWith('-')) {
        png_out = argv[idx + 1]
      }
      PRESET.build_png(got.json, png_out)
    }
  } catch (exc) {
    _print(`!! ${_错话(exc)}`)
    return 1
  } finally {
    SB.cleanup(tmp)
  }
  return 0
}


export function cmd_plan(argv) {
  // 规划书：打一份空的 / 从卡反推 / 查一份写完的。
  if (argv.length && ['--h', '--help', '-h'].includes(argv[0])) {
    _print('用法：python forge.py plan [-o 出.md]                  打一份空规划书')
    _print('      python forge.py plan <卡.json 或 spec.yaml>      从现成的卡反推一份')
    _print('      python forge.py plan --查 规划书.md              查一份写完的，缺什么当场说')
    return 0
  }
  return PLAN.main(argv)
}


export function cmd_lint(argv) {
  // 正文体检（防八股）：只查句式骨架，不查词。
  // 空参分支＝这条命令的用法文本（`_打命令用法` 借它回答 `lint --help`，
  // 自检第 34 项要求这段里必须出现 `forge.py lint`）。
  if (!argv.length || ['--h', '--help', '-h'].includes(argv[0])) {
    _print('用法：python forge.py lint <卡.json 或 spec.yaml 或 文本> [-o 报告.md]')
    _print('      python forge.py lint -      从标准输入读（写完一轮自查用）')
    _print('      python forge.py lint --标准 打判据表（每条判据的口径与来源）')
    _print('有硬判据不过 ⇒ 退出码 1；三条硬判据 = 提示冒号＋空行接列表 · 对立句式 ≤1 · 破折号 0')
    _print('长文本（>2000 汉字）自动降级成只报密度 —— 硬阈值是按「一轮输出」标定的。')
    return argv.length ? 0 : 2
  }
  try {
    return LINT.main(argv)
  } catch (exc) {
    if (exc instanceof LINT.LintError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
}


export function cmd_manual(argv) {
  if (!argv.length) {
    _print('用法：python forge.py manual <spec.yaml 或 卡.json> [-o 出.html] [--只手册]')
    return 2
  }
  const src = argv[0]
  const out = _opt(argv, ['-o', '--out'])
  try {
    manual.build_manual(src, out)
    if (!argv.includes('--只手册')) {
      manual.build_index(src)
    }
  } catch (exc) {
    _print(`!! ${_错话(exc)}`)
    return 1
  }
  return 0
}


export function cmd_index(argv) {
  if (!argv.length) {
    _print('用法：python forge.py index <spec.yaml 或 卡.json> [-o 出.md]')
    return 2
  }
  try {
    manual.build_index(argv[0], _opt(argv, ['-o', '--out']))
  } catch (exc) {
    _print(`!! ${_错话(exc)}`)
    return 1
  }
  return 0
}


export function cmd_make(argv) {
  // 照一份卡稿（YAML）一次落成整张卡 —— 给「想清楚了，一次写完」用的。
  const 用法 = (
    '用法：python forge.py make <卡稿.yaml> [--到 <目录>] [--试] [--覆盖] [--保留]\n'
    + '  稿子写的是「这张卡该长什么样」，不是「先做这步再做那步」：\n'
    + '    · 条目按标题认人 —— 卡里已有同名的改它，没有才新建（不必管骨架里现成有什么）\n'
    + '    · 分组 / 变量对象缺了自动补（报告里单列一份，名字打错看得见）\n'
    + '    · **全程在临时目录里做，全绿了才整棵拷到目标位置** ——\n'
    + '      稿子有毛病时，目标位置一个字都不会被写\n'
    + '  --试    只验证：做到能出成品、体检通过，但不往目标位置写\n'
    + '  --覆盖  那份工程已经在了就照稿子重落一遍（只认同一张卡：\n'
    + '          目标里有 source/<卡名>.spec.yaml 才让盖；别的东西一律不碰）\n'
    + '  --保留  把这一趟的临时工程留着（调试稿子用）\n'
    + '  不知道稿子长什么样：\n'
    + '    python forge.py make --模板   一份骨架（有哪些键、怎么缩进）\n'
    + '    python forge.py make --示例   一张真能开的卡（连「话该写多细」一起示范）')
  if (argv.includes('--模板') || argv.includes('--template')) {
    process.stdout.write(DRAFT.卡稿模板())
    return 0
  }
  if (argv.includes('--示例') || argv.includes('--sample') || argv.includes('--例子')) {
    process.stdout.write(DRAFT.卡稿示例())
    return 0
  }
  const 稿 = argv.find((a) => !a.startsWith('-')) ?? null
  if (稿 === null) {
    _print(用法)
    return 2
  }
  let r
  try {
    r = DRAFT.落卡(稿, _opt(argv, ['--到', '--to', '-d']),
      argv.includes('--试') || argv.includes('--dry'),
      argv.includes('--保留') || argv.includes('--keep'),
      argv.includes('--覆盖') || argv.includes('--force'))
  } catch (exc) {
    if (exc instanceof DRAFT.DraftError) {
      _print(`!! ${_错话(exc)}`)
      return 2
    }
    throw exc
  }
  DRAFT.打报告(r)
  return 0
}


export function cmd_coach(argv) {
  // 出两份「怎么做一张 ElecKoi 卡」：给电脑 AI 的规程，给 ElecKoi 的向导卡。
  const 到 = _opt(argv, ['--到', '-o', '--out'])
  COACH.出(到)
  return 0
}


export function cmd_guide(argv) {
  // 打印制卡规程：不给参数出目录，`--节 三` 取一节，`--篇 预算` 取一篇，
  // `--对话 访谈` 取「在对话里做卡」的一段，`--全文` 全出。
  //
  // **给 AI 取知识用的**。规程全文一万七千字，一次全塞进上下文既贵又冲淡重点 ——
  // 所以先出目录、再按需取一段。ElecKoi 里装了「制卡工坊」插件的 AI 就靠这个
  // 自己把知识取到手（`cardforge(args=["guide","--节","三"])`），不必等人把规程贴进对话。
  if (argv.includes('--全文')) {
    _print(COACH.规程正文())
    return 0
  }
  let 打了 = false
  for (const [长名, 短名, 取] of [['--节', '-s', COACH.取节], ['--篇', '-p', COACH.取篇],
    ['--对话', '-d', COACH.取对话]]) {
    const 名 = _opt(argv, [长名, 短名])
    if (名 === null) continue
    try {
      _print(取(名))
    } catch (exc) {            // 认不出就报清楚 + 附上目录，绝不静默给空
      if (exc instanceof COACH.KeyError) {
        // Python 是 `print("!! %s\n" % exc.args[0])`，而 `exc.args[0]` 是**没带引号的原话**；
        // coach.mjs 的 KeyError 把 pyRepr 后的字符串放在 message 里，这里照它取。
        _print(`!! ${_键错原话(exc)}\n`)
        _print(COACH.目录())
        return 2
      }
      throw exc
    }
    打了: true
  }
  if (!打了) {
    _print(COACH.目录())
  }
  return 0
}


// ------------------------------------------------------------------ 内容编辑
// 对齐 `forge.py:2512`（`_spec_of`）…… `forge.py:3020`（`cmd_trash`）。
// 这一整段与 Python 逐行对应，注释照抄，不改一处判断顺序 —— `--改 X --启用` 里
// `--启用` 是**不带值**的开关，所以「批量开关」那一段必须排在 `--改` 之后。

/** Python `sorted(os.listdir(d))`：按**码点**排（JS 默认 `sort()` 是 UTF-16 码元序）。 */
function _排序(列) {
  return [...列].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** `forge.py:_spec_of` —— 把「工程目录 或 spec 路径」都收成一个 spec 路径。找不到返回 null。 */
export function _spec_of(target) {
  const p = _abspath(target || '.')
  if (_是文件(p)) return p
  for (const sub of ['source', '']) {
    const d = sub ? _join(p, sub) : p
    if (!_是目录(d)) continue
    for (const f of _排序(readdirSync(d))) {
      if (f.endsWith('.spec.yaml')) return _join(d, f)
    }
  }
  return null
}


/** `forge.py:_need_spec` —— 拿到 spec 路径，或打用法/报错并返回 null。 */
export function _need_spec(argv, 用法) {
  if (!argv.length || argv[0].startsWith('-')) {
    _print(用法)
    return null
  }
  const p = _spec_of(argv[0])
  if (!p || !_是文件(p)) {
    _print(`找不到 spec：${argv[0]}`)
    return null
  }
  return p
}


/** `forge.py:_list` —— `"a，b、c"` ⇒ `['a','b','c']`（全角逗号与顿号都折成半角）。 */
export function _list(txt) {
  if (!pyTruthy(txt)) return []
  return String(txt).replace(/，/g, ',').replace(/、/g, ',').split(',')
    .map((x) => x.trim()).filter((x) => pyTruthy(x))
}


/** `forge.py:_多值` —— `--删 a b c`（吃到下一个旗标为止），`--删 "a,b"` 也认。 */
export function _多值(argv, names) {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (names.includes(a)) {
      let j = i + 1
      while (j < argv.length && !argv[j].startsWith('-')) {
        out.push(..._list(argv[j]))
        j += 1
      }
    }
    for (const n of names) {
      if (a.startsWith(`${n}@`)) out.push(..._list(_读文(a.slice(n.length))))
    }
  }
  return out
}


/** `forge.py:_next` —— 每条写盘命令的收尾。 */
export function _next(spec) {
  _print('')
  _print(`下一步： python forge.py check "${spec}"`)
}


/** `forge.py:_tail` —— 按**显示宽度**对齐地打一张小表（中英混排非得这么打）。 */
export function _tail(rows, cols, right = []) {
  const widths = cols.map((c) => M.dispWidth(c[0]))
  for (const r of rows) {
    r.forEach((v, i) => { widths[i] = Math.max(widths[i], M.dispWidth(v)) })
  }
  _print(`  ${cols.map((c, i) => M.pad(c[0], widths[i])).join('  ')}`)
  for (const r of rows) {
    _print(`  ${r.map((v, i) => M.pad(v, widths[i], right.includes(i) ? 'right' : 'left')).join('  ')}`)
  }
}


export function cmd_entry(argv) {
  const 用法 = '用法：python forge.py entry <spec> --新 "标题" [--分组 X]\n'
    + '                                      [--模板 常驻|必读|关键词|选读|开场]\n'
    + '                                      [--正文 "…"] [--关键词 判定,掷骰]\n'
    + '                                      [--位置 instructions] [--提示 "什么时候读我"]\n'
    + '      python forge.py entry <spec> --列 [--分组 X]\n'
    + '      python forge.py entry <spec> --看 <id 或 标题>      看一条的全貌（正文全文在内）\n'
    + '      python forge.py entry <spec> --改 <id 或 标题> [<id 或 标题> …] --正文 "…"\n'
    + '                                      [--标题 "…"] [--关键词 a,b]\n'
    + '                                      [--提示 "什么时候读我"] [--模板 常驻|必读|关键词|选读]\n'
    + '                                      [--策略 …] [--位置 …] [--角色 …] [--内容模式 …]\n'
    + '                                      [--启用 | --停用]   卡里留着但不生效 / 让它生效\n'
    + '  （--改 后面给一串就是**批量改**：这批条目同时改成同一组字段，一次落盘、\n'
    + '    一条回收记录。值域照旧当场拦 —— 只要有一条会被降级，整批一个字都不落盘。）\n'
    + '      python forge.py entry <spec> --复制 <id 或 标题> [<id 或 标题> …]\n'
    + '                                      [--标题 "…"] [--到 分组]\n'
    + '      python forge.py entry <spec> --挪 <id 或 标题> [<id 或 标题> …] [--到 分组]\n'
    + '      python forge.py entry <spec> --删 <id 或 标题> [<id 或 标题> …]\n'
    + '      python forge.py entry <spec> --启用|--停用 <id 或 标题> [<id 或 标题> …]\n'
    + '  （--复制 / --挪 / --删 / --启用 / --停用 后面可以跟一串，一次动多条：\n'
    + '    一次落盘、一条回收记录，`trash --还原 N` 一次全捞回来。\n'
    + '    有认不出的名字就**整批停下**，绝不半个批次落盘 —— 半条是最难收拾的。）\n'
    + '  （--复制 的副本顺着原件排、默认叫「原名（副本）」；--到 分组 能让副本直接落进那个组。\n'
    + '    复制是加一条、跟 --新 一样不写回收记录 —— 不要了就 --删 掉它。开场白条目不许复制。）\n'
    + '  （--改 只动内容与偏好；id / 顺序号 / 分组位置一概不动，卡里引用旧 id 的地方不会断）\n'
    + '  （凡要写一段话的地方，值都可以写成 @文件名 —— 正文太长、带换行或引号时这么写，\n'
    + '    例：--正文@正文.txt ，或 --正文 @正文.txt ）'
  const spec = _need_spec(argv, 用法)
  if (!spec) return 2
  try {
    if (argv.includes('--列') || argv.includes('--list')) {
      _print_entries(spec, _opt(argv, ['--分组', '--group']))
      return 0
    }
    if (argv.includes('--看') || argv.includes('--show') || argv.includes('--详情')) {
      const 谁 = _opt(argv, ['--看', '--show', '--详情'])
      if (!pyTruthy(谁)) {
        _print(用法)
        return 2
      }
      _print_entry_detail(CONTENT.entry_detail(spec, 谁))
      return 0
    }
    if (argv.includes('--新') || argv.includes('--add')) {
      CONTENT.add_entry(spec, _opt(argv, ['--新', '--add']),
        _opt(argv, ['--分组', '--group']) || '',
        _opt(argv, ['--模板', '--template']) || '常驻',
        _opt(argv, ['--正文', '--body']) || '',
        _list(_opt(argv, ['--关键词', '--kw'])),
        _opt(argv, ['--位置', '--position']),
        _opt(argv, ['--提示', '--hint']))
      _next(spec)
      return 0
    }
    if (argv.includes('--改') || argv.includes('--set')) {
      const 字段 = {}
      for (const [旗, 键] of [['--标题', 'title'], ['--正文', 'content'],
        ['--提示', 'agent_selection_hint'],
        ['--策略', 'agent_read_strategy'],
        ['--位置', 'position'], ['--角色', 'insert_role'],
        ['--内容模式', 'content_mode'], ['--图标', 'icon_id']]) {
        const v = _opt(argv, [旗])
        if (v !== null) 字段[键] = v
      }
      if (argv.includes('--关键词') || argv.includes('--kw')) {
        字段.keywords = _opt(argv, ['--关键词', '--kw']) || ''
      }
      // 启用状态：卡里 `enabled: false` 的条目留着但不生效。列表现已标出来，
      // 也得给一个开关 —— 否则看得见、动不了。
      if (argv.includes('--启用') || argv.includes('--enable')) {
        字段.enabled = true
      } else if (argv.includes('--停用') || argv.includes('--disable')) {
        字段.enabled = false
      }
      const 模板 = _opt(argv, ['--模板', '--template'])
      if (pyTruthy(模板)) {
        if (!(模板 in CONTENT.模板表)) {
          _print(`!! 没有名为「${模板}」的模板。能用的：${Object.keys(CONTENT.模板表).join('、')}`)
          return 2
        }
        // 模板表里带着 kind 这类身份字段 —— 改条目不动身份，滤掉
        for (const [k, v] of Object.entries(CONTENT.模板表[模板])) {
          if (CONTENT.可改字段.includes(k)) 字段[k] = v
        }
      }
      // `--改` 后面可以是一个名字，也可以是一串 —— 一串就是「这批条目同
      // 时改同一组字段」。单条走 set_entry（报错与回显都是老样子），
      // 多条走 set_entries_fields（一次落盘、一条回收记录）。
      const 谁们 = _多值(argv, ['--改', '--set'])
      if (!谁们.length) {
        _print('没说改哪条。用法：python forge.py entry <spec> --改 "标题" --正文 "…"')
        return 2
      }
      if (谁们.length === 1) {
        CONTENT.set_entry(spec, 谁们[0], 字段)
      } else {
        if (!Object.keys(字段).length) {
          _print('批量改要说清改什么：python forge.py entry <spec> --改 甲 乙 --正文 "…"')
          return 2
        }
        CONTENT.set_entries_fields(spec, 谁们, 字段)
      }
      _next(spec)
      return 0
    }
    if (argv.includes('--复制') || argv.includes('--dup')) {
      const 谁们 = _多值(argv, ['--复制', '--dup'])
      if (!谁们.length) {
        _print('没说复制哪条。用法：python forge.py entry <spec> --复制 "标题" ["标题" …] [--到 分组]')
        return 2
      }
      CONTENT.dup_entries(spec, 谁们, _opt(argv, ['--标题', '--title']),
        _opt(argv, ['--到', '--to', '--分组', '--group']) || '')
      _next(spec)
      return 0
    }
    if (argv.includes('--挪') || argv.includes('--move')) {
      CONTENT.move_entries(spec, _多值(argv, ['--挪', '--move']),
        _opt(argv, ['--到', '--to']) || '')
      _next(spec)
      return 0
    }
    if (argv.includes('--删') || argv.includes('--del')) {
      CONTENT.del_entries(spec, _多值(argv, ['--删', '--del']))
      _next(spec)
      return 0
    }
    // 批量开关。注意顺序：这一段必须排在 `--改` 后面 —— `--改 X --启用` 里的
    // `--启用` 是个**不带值**的开关，那是老写法，不算批量。
    if (argv.includes('--启用') || argv.includes('--enable')
      || argv.includes('--停用') || argv.includes('--disable')) {
      const 开 = _多值(argv, ['--启用', '--enable'])
      const 关 = _多值(argv, ['--停用', '--disable'])
      if (开.length && 关.length) {
        _print('!! --启用 跟 --停用 不能一起给。')
        return 2
      }
      const 谁 = 开.length ? 开 : 关
      if (!谁.length) {
        _print('!! --启用 / --停用 后面要跟条目（id 或 标题），可以跟一串。')
        return 2
      }
      CONTENT.set_entries_enabled(spec, 谁, pyTruthy(开))
      _next(spec)
      return 0
    }
  } catch (exc) {
    if (exc instanceof CONTENT.ContentError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
  _print(用法)
  return 2
}


export function _print_entries(spec, 分组 = null) {
  const rows = CONTENT.list_entries(spec).filter((r) => !pyTruthy(分组) || r['分组'] === 分组)
  rows.sort((a, b) => _比顺序([a['顺序'] === null, a['顺序']], [b['顺序'] === null, b['顺序']]))
  if (!rows.length) {
    _print(`（没有条目${pyTruthy(分组) ? `，分组「${分组}」里一个都没有` : ''}）`)
    return
  }
  _tail(rows.map((r) => [String(r.id), r['标题'], r['分组'] || '—', r['触发'], r['策略'],
    String(r['字数']), r['关键词'].join(',') || '—',
    r['启用'] !== undefined && r['启用'] !== null && r['启用'] ? '是' : '禁用']),
  [['id', 0], ['标题', 0], ['分组', 0], ['触发', 0], ['策略', 0],
    ['字数', 0], ['关键词', 0], ['启用', 0]],
  [5])
  const 禁 = rows.filter((r) => !(r['启用'] !== undefined && r['启用'] !== null ? r['启用'] : true))
  _print('')
  _print(`  共 ${rows.length} 条${禁.length ? `（其中 ${禁.length} 条已禁用 —— 卡里留着，但不生效）` : ''}。改一条：entry --改 <id 或 标题> --正文 "…" [--提示 "…"]`)
}


/** Python 元组比较：`bool` 排在前，然后 `int`；`None` 一律最先。 */
function _比顺序(a, b) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (x === null || x === undefined) return -1
    if (y === null || y === undefined) return 1
    if (typeof x === 'boolean' && typeof y !== 'boolean') return -1
    if (typeof y === 'boolean' && typeof x !== 'boolean') return 1
    return x < y ? -1 : 1
  }
  return 0
}


export function _标签(k, w = 12) {
  return k + ' '.repeat(Math.max(1, w - M.dispWidth(k)))
}


export function _print_entry_detail(d) {
  // 打一条条目的全貌。正文单独起一段、原样输出 —— 它是要被读走和改写的，
  // 夹进表格里就没法原样用了（多行、缩进全糊）。
  _print(`条目 · ${d['标题']}`)
  _print('─'.repeat(62))
  for (const [k, v] of [['id', d.id], ['分组', d['分组']], ['类型', d['类型']],
    ['启用', d['启用'] !== undefined ? d['启用'] : null],
    ['顺序', d['顺序']], ['触发方式', d['触发方式']],
    ['读取策略', d['读取策略']], ['动态模式', d['动态模式']],
    ['内容模式', d['内容模式']],
    ['关键词', d['关键词'].join('、') || '（无）'],
    ['关键词条件', d['关键词条件']],
    ['读取提示', d['读取提示'] || '（无）'],
    ['插入位置', d['插入位置'] || '（无）'],
    ['插入角色', d['插入角色'] || '（无）'],
    ['图标', d['图标'] || '（无）']]) {
    _print(_标签(k) + String(v === null || v === undefined ? 'None' : v))
  }
  if ('开场白方案' in d) {
    _print(_标签('开场白方案') + `${d['开场白方案'].length} 个，默认 ${d['默认方案'] || '—'}`)
    for (const m of d['开场白方案']) {
      _print(`${' '.repeat(12)}· ${m['标题']}  [${m.id}]  ${m['字数']} 字`)
    }
  }
  _print('')
  _print(`正文（${d['字数']} 字）：`)
  _print(String(d['正文']).trim() ? d['正文'] : '（空 —— 现在是条占位，别就这么出卡）')
  _print('')
  if ('开场白方案' in d) {
    _print('这条是开场白 —— 正文**别用 `--改`**（有界面层时它只是派生物，改了白改）：')
    _print('  python forge.py opener <工程 或 spec> --正文@新正文.txt')
    _print('  （末尾那三个零宽标记、方案正文同步、写回，都归 opener 管；`opener --看` 看全貌）')
  } else {
    _print(`改这条： python forge.py entry <spec> --改 "${d['标题']}" --正文@新正文.txt`)
  }
}


export function cmd_group(argv) {
  const 用法 = '用法：python forge.py group <spec> --列\n'
    + '      python forge.py group <spec> --新 <名> [--父 分组]\n'
    + '      python forge.py group <spec> --改名 <旧名> <新名>\n'
    + '      python forge.py group <spec> --删 <名>'
  const spec = _need_spec(argv, 用法)
  if (!spec) return 2
  try {
    if (argv.includes('--列') || argv.includes('--list')) {
      const rows = CONTENT.list_entries(spec)
      const 表 = CONTENT.list_groups(spec)
      if (!表.length) {
        _print('（这张卡没有分组）')
        return 0
      }
      _tail(表.map((g) => [String(g.id), g['名'], g['父'] || '—',
        String(rows.filter((r) => r['分组'] === g['名']).length)]),
      [['id', 0], ['名', 0], ['父', 0], ['条目数', 0]], [3])
      return 0
    }
    if (argv.includes('--新') || argv.includes('--add')) {
      CONTENT.add_group(spec, _opt(argv, ['--新', '--add']),
        _opt(argv, ['--父', '--parent']) || '')
      _next(spec)
      return 0
    }
    if (argv.includes('--改名') || argv.includes('--rename')) {
      const rest = argv.slice(1).filter((a) => !a.startsWith('-')
        && a !== _opt(argv, ['--改名', '--rename']))
      CONTENT.rename_group(spec, _opt(argv, ['--改名', '--rename']), rest[0])
      _next(spec)
      return 0
    }
    if (argv.includes('--删') || argv.includes('--del')) {
      CONTENT.del_group(spec, _opt(argv, ['--删', '--del']))
      _next(spec)
      return 0
    }
  } catch (exc) {
    if (exc instanceof CONTENT.ContentError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
  _print(用法)
  return 2
}


export function cmd_var(argv) {
  const 用法 = '用法：python forge.py var <spec> --列\n'
    + '      python forge.py var <spec> --新对象 <名> [--父 对象] [--说明 "…"]\n'
    + '      python forge.py var <spec> --新 <对象>.<变量> [--类型 number]\n'
    + '                                      [--初值 1] [--说明 "…"]\n'
    + '      python forge.py var <spec> --改名 <变量 id 或 对象.变量> --成 <新名>\n'
    + '      python forge.py var <spec> --改名对象 <对象> --成 <新名>\n'
    + '      python forge.py var <spec> --换对象 <变量 id 或 对象.变量> --到 <对象>\n'
    + '      python forge.py var <spec> --删 <变量 id 或 对象.变量> [<…> …]\n'
    + '      python forge.py var <spec> --删对象 <名>\n'
    + '      python forge.py var <spec> --对齐       把 Zod 对齐另两处\n'
    + '  （改名一次把**三处**一起挪：面板 / 初值那一格的键 / Zod 那个字段名 ——\n'
    + '    只改一处，另两处会悄悄悬空。id 不动，按 id 引用的地方不会断。\n'
    + '    正文里写着旧名字的地方**只报不改** —— 工具不知道那是变量名还是恰好同字的词。\n'
    + '  --换对象 是名字不动、换它挂在哪个对象下：挂靠关系 / 初值那格 / Zod 那个字段\n'
    + '    一起搬到新对象那棵子树下，顺带排到新对象末尾。id 同样不动。\n'
    + '  --删 后面给一串就是批量删：一次落盘、一条回收记录，`trash --还原 N` 一次全捞回来。）'
  const spec = _need_spec(argv, 用法)
  if (!spec) return 2
  try {
    if (argv.includes('--列') || argv.includes('--list')) {
      _print_vars(spec)
      return 0
    }
    if (argv.includes('--换对象') || argv.includes('--move-obj')) {
      const 到 = _opt(argv, ['--到', '--to'])
      if (!pyTruthy(到)) {
        _print('!! 少了目标对象，要写成：--换对象 <变量> --到 <对象>')
        return 2
      }
      CONTENT.move_variable(spec, _opt(argv, ['--换对象', '--move-obj']), 到)
      _next(spec)
      return 0
    }
    if (argv.includes('--改名对象') || argv.includes('--重命名对象')) {
      const 新 = _opt(argv, ['--成', '--名', '--to'])
      if (!pyTruthy(新)) {
        _print('!! 少了新名字，要写成：--改名对象 <对象> --成 <新名>')
        return 2
      }
      CONTENT.rename_object(spec, _opt(argv, ['--改名对象', '--重命名对象']), 新)
      _next(spec)
      return 0
    }
    if (argv.includes('--改名') || argv.includes('--rename')) {
      const 新 = _opt(argv, ['--成', '--名', '--to'])
      if (!pyTruthy(新)) {
        _print('!! 少了新名字，要写成：--改名 <变量> --成 <新名>')
        return 2
      }
      CONTENT.rename_variable(spec, _opt(argv, ['--改名', '--rename']), 新)
      _next(spec)
      return 0
    }
    if (argv.includes('--新对象')) {
      CONTENT.add_object(spec, _opt(argv, ['--新对象']),
        _opt(argv, ['--父', '--parent']) || '',
        _opt(argv, ['--说明', '--desc']) || '',
        _opt(argv, ['--更新规则']) || '')
      _next(spec)
      return 0
    }
    if (argv.includes('--新')) {
      const 全 = _opt(argv, ['--新'])
      if (!pyTruthy(全) || !全.includes('.')) {
        _print('!! 要写成「对象.变量」，例如：--新 玩家.声望')
        return 2
      }
      const 点 = 全.lastIndexOf('.')
      const 对象 = 全.slice(0, 点)
      const 标 = 全.slice(点 + 1)
      CONTENT.add_variable(spec, 对象, 标,
        _opt(argv, ['--类型', '--type']) || 'string',
        _opt(argv, ['--初值', '--value']),
        _opt(argv, ['--说明', '--desc']) || '',
        _opt(argv, ['--更新规则']) || '')
      _next(spec)
      return 0
    }
    if (argv.includes('--删对象')) {
      CONTENT.del_object(spec, _opt(argv, ['--删对象']))
      _next(spec)
      return 0
    }
    if (argv.includes('--删') || argv.includes('--del')) {
      // 跟 `entry --删` 一样：后面可以是一个，也可以是一串（一次落盘、
      // 一条回收记录）。每个变量三处，一串就是三处 × N，一起撤、一起还原。
      const 谁们 = _多值(argv, ['--删', '--del'])
      if (!谁们.length) {
        _print('没说删哪个变量。用法：python forge.py var <spec> --删 <对象.变量> [<对象.变量> …]')
        return 2
      }
      if (谁们.length === 1) {
        CONTENT.del_variable(spec, 谁们[0])
      } else {
        CONTENT.del_variables(spec, 谁们)
      }
      _next(spec)
      return 0
    }
    if (argv.includes('--对齐') || argv.includes('--align')) {
      CONTENT.align_schema(spec)
      _next(spec)
      return 0
    }
  } catch (exc) {
    if (exc instanceof CONTENT.ContentError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
  _print(用法)
  return 2
}


export function _print_vars(spec) {
  const raw = CONTENT.load(spec)
  const v = raw.variables || {}
  const objs = {}
  for (const o of (v.objects || [])) objs[o.id] = o.name || ''
  const rows = v.variables || []
  if (!rows.length) {
    _print('（这张卡没有变量）')
    return false
  }
  const 取值 = (o, k, d) => (o && typeof o === 'object' && k in o ? o[k] : d)
  _tail(rows.map((x) => [objs[取值(x, 'object_id', null)] !== undefined
    ? objs[取值(x, 'object_id', null)] : '?',
  String(x.title || ''),
  String(x.type || ''),
  _紧凑json(x.default_value),
  String(x.id || '')]),
  [['对象', 0], ['变量', 0], ['类型', 0], ['初值', 0], ['id', 0]])
  _print('')
  _print(`  共 ${rows.length} 个。把 Zod 对齐另两处：python forge.py var "${spec}" --对齐`)
  return true
}


/** Python `json.dumps(x, ensure_ascii=False)`（紧凑：`", "` 与 `": "` 分隔）。 */
function _紧凑json(x) {
  return _json紧凑(x, false)
}


export function cmd_regex(argv) {
  const 用法 = '用法：python forge.py regex <spec> --列\n'
    + '      python forge.py regex <spec> --新 <名> --模式 "/〔试〕/g" [--替换 "…"]\n'
    + '                                        [--目标 AiOutput] [--顺序 30]\n'
    + '      python forge.py regex <spec> --删 <名 或 id>\n'
    + '      python forge.py regex <spec> --启 <名> / --停 <名>'
  const spec = _need_spec(argv, 用法)
  if (!spec) return 2
  try {
    if (argv.includes('--列') || argv.includes('--list')) {
      const rows = CONTENT.list_regex(spec)
      if (!rows.length) {
        _print('（这张卡没有正则）')
        return 0
      }
      rows.sort((a, b) => _比顺序([a['顺序'] === null, a['顺序']], [b['顺序'] === null, b['顺序']]))
      _tail(rows.map((r) => [r['开'] ? '开' : '停', String(r['顺序']), r['名'],
        r['目标'].join(','), String(r['模式']).slice(0, 48)]),
      [['', 0], ['顺序', 0], ['名', 0], ['作用', 0], ['模式', 0]], [1])
      _print('')
      _print(`  共 ${rows.length} 条。ElecKoi 是按 order 从小到大依次跑的。`)
      return 0
    }
    if (argv.includes('--新') || argv.includes('--add')) {
      const 序 = _opt(argv, ['--顺序', '--order'])
      CONTENT.add_regex(spec, _opt(argv, ['--新', '--add']),
        _opt(argv, ['--模式', '--pattern']) || '',
        _opt(argv, ['--替换', '--repl']) || '',
        _list(_opt(argv, ['--目标', '--targets'])),
        (pyTruthy(序) ? Number.parseInt(序, 10) : null))
      _next(spec)
      return 0
    }
    if (argv.includes('--删') || argv.includes('--del')) {
      CONTENT.del_regex(spec, _opt(argv, ['--删', '--del']))
      _next(spec)
      return 0
    }
    if (argv.includes('--启') || argv.includes('--开')) {
      CONTENT.set_regex(spec, _opt(argv, ['--启', '--开']), true)
      _next(spec)
      return 0
    }
    if (argv.includes('--停') || argv.includes('--关')) {
      CONTENT.set_regex(spec, _opt(argv, ['--停', '--关']), false)
      _next(spec)
      return 0
    }
  } catch (exc) {
    if (exc instanceof CONTENT.ContentError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
  _print(用法)
  return 2
}


export function cmd_trash(argv) {
  const 用法 = '用法：python forge.py trash <工程 或 spec>            看回收站里有什么\n'
    + '      python forge.py trash <工程 或 spec> --还原 1      把第 1 条放回去（1 = 最近）\n'
    + '      python forge.py trash <工程 或 spec> --清空'
  const spec = _need_spec(argv, 用法)
  if (!spec) return 2
  try {
    if (argv.includes('--清空') || argv.includes('--clear')) {
      const n = CONTENT.clear_trash(spec)
      _print(`回收站清空了（${n} 条）。`)
      return 0
    }
    if (argv.includes('--还原') || argv.includes('--restore')) {
      const r = CONTENT.restore(spec, _opt(argv, ['--还原', '--restore']))
      _print(`已放回：${r['说明'] || ''}`)
      for (const x of r['放回']) _print(`  · ${x}`)
      for (const x of r['跳过']) _print(`  ⚠ 跳过 ${x}`)
      _next(spec)
      return 0
    }
    const rows = CONTENT.list_trash(spec)
    if (!rows.length) {
      _print(`回收站是空的（${CONTENT.trash_dir(spec)} 下没有东西）。`)
      return 0
    }
    rows.forEach((rec, i) => {
      _print(`  ${M.pad(String(i + 1), 3, 'right')}  ${rec['说明'] || ''}`)
      _print(`        ${String(rec['时间'] || '').slice(0, 19)} · ${rec['种类'] || ''} · ${(rec['项'] || []).length} 项`)
    })
    _print('')
    _print(`  放回去： python forge.py trash "${argv[0]}" --还原 1`)
    return 0
  } catch (exc) {
    if (exc instanceof CONTENT.ContentError) {
      _print(`!! ${_错话(exc)}`)
      return 1
    }
    throw exc
  }
}


// ------------------------------------------------------------------ 小工具
/** `forge.py:835` —— 命令行参数本身有毛病（不是卡的问题）。 */
export class ArgError extends Error {
  constructor(消息 = '') { super(消息); this.name = 'ArgError' }
}

/** Python `"%s" % v`：`None` 打成 `None`、`True`/`False` 打成 `True`/`False`。 */
function _pyStr(v) {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v)
}

/**
 * `forge.py:839` `_读文` —— 参数值写成 `@文件名` 且那个文件真在，就从文件读内容。
 *
 * 文件末尾那一个换行按编辑器习惯忽略；`open(..., encoding="utf-8")` 是文本模式读
 * （universal newlines），所以先 `\r\n`/`\r` 折成 `\n` 再判末尾。
 */
export function _读文(v) {
  if (typeof v !== 'string' || !v.startsWith('@')) return v
  const f = v.slice(1)
  if (!f) throw new ArgError('`@` 后面要跟文件名。例：--正文@正文.txt')
  if (!_是文件(f)) {
    throw new ArgError('参数里的 @' + f + ' 不是个文件（当前目录 ' + process.cwd() + '）。\n'
      + '  `@名字` 的意思是「从这个文件读内容」。写出绝对路径最稳；\n'
      + '  真的想传一个以 @ 开头的字符串？把整段写进文件再 @ 引。')
  }
  const 文 = _读文本(f)
  return 文.endsWith('\n') ? 文.slice(0, -1) : 文
}

/** `forge.py:864` `_opt` —— `--旗 值` 与 `--旗@值` 两种写法都认；认不出返 `null`。 */
export function _opt(argv, names) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (names.includes(a) && i + 1 < argv.length) return _读文(argv[i + 1])
    for (const n of names) {              // 也认连写：--正文@正文.txt
      if (String(a).startsWith(n + '@')) return _读文(String(a).slice(n.length))
    }
  }
  return null
}

/** `forge.py:874` */
export function cmd_diff(argv) {
  if (argv.length < 2) {
    _print('用法：python forge.py diff <a.json> <b.json>')
    return 2
  }
  return diff_cards(argv[0], argv[1])
}

/** `forge.py:881` */
export function cmd_domains(argv) {
  _print('ElecKoi 真值域表（来源：反编译 0.2.8 逐字节取证）')
  _print('')
  for (const [name, dom] of Object.entries(domain.DOMAINS)) {
    _print('  ' + name)
    _print('      合法值：' + dom.values.join(' / '))
    _print('      缺省  ：' + _pyStr(dom.default))
    if (pyTruthy(dom.legacy)) {
      _print('      旧值  ：' + Object.entries(dom.legacy)
        .map(([k, val]) => k + ' → ' + _pyStr(val)).join('、'))
    }
    _print('      ' + _pyStr(dom.note))
    _print('')
  }
  _print('平台不读的字段：')
  for (const [f, why] of Object.entries(domain.DEAD_FIELDS)) _print('  ' + f + ' —— ' + why)
  _print('')
  for (const line of domain.POSITION_NOTE) _print('  ' + line)
  return 0
}

// ------------------------------------------------------------------ diff
/** `forge.py:902` `diff_cards` */
export function diff_cards(a_path, b_path) {
  // 时间戳与「往返重建」无关，先抹掉再比，免得报告被它们淹没
  const a = _scrub(M.jload(a_path))
  const b = _scrub(M.jload(b_path))
  if (_canon(a) === _canon(b)) {
    _print('✔ 两张卡语义完全一致')
    return 0
  }

  _print('✗ 存在差异')
  for (const key of ['format', 'version', 'character', 'assets', 'regex_rules']) {
    if (_canon(a[key] === undefined ? null : a[key]) !== _canon(b[key] === undefined ? null : b[key])) {
      _print('  顶层字段不同：' + key)
    }
  }

  for (const [key, label] of [['setting_library', '设定库'], ['variable_config', '变量']]) {
    let va = pack.active_library(a)
    let vb = pack.active_library(b)
    if (key === 'variable_config') {
      va = pack.active_variables(a)
      vb = pack.active_variables(b)
    }
    if (_canon(va) === _canon(vb)) continue
    _print('  ' + label + ' 不同')
    if (key === 'setting_library') {
      const ta = new Map()
      for (const e of ((va && va.entries) || [])) ta.set(e.title === undefined ? null : e.title, e)
      const tb = new Map()
      for (const e of ((vb && vb.entries) || [])) tb.set(e.title === undefined ? null : e.title, e)
      for (const t of ta.keys()) {
        if (!tb.has(t)) _print('      仅 A 有：' + _pyStr(t))
        else if (_canon(ta.get(t)) !== _canon(tb.get(t))) _print('      内容不同：' + _pyStr(t))
      }
      for (const t of tb.keys()) {
        if (!ta.has(t)) _print('      仅 B 有：' + _pyStr(t))
      }
    }
  }
  return 1
}

/** `forge.py:935` `_canon` —— `json.dumps(obj, ensure_ascii=False, sort_keys=True)`。 */
export function _canon(obj) { return _json文(obj, true) }

/** `json.dumps` 的字面输出（键按**码点**排序，不是 UTF-16 序）。 */
function _json文(v, 排键) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN'
    if (v === Infinity) return 'Infinity'
    if (v === -Infinity) return '-Infinity'
    return String(v)
  }
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map((x) => _json文(x, 排键)).join(', ') + ']'
  if (typeof v === 'object') {
    let 键 = Object.keys(v)
    if (排键) 键 = 键.slice().sort(比串)
    return '{' + 键.map((k) => JSON.stringify(k) + ': ' + _json文(v[k], 排键)).join(', ') + '}'
  }
  return 'null'
}

/** Python 元组比较：`sorted` 对元组逐元素比，字符串按码点。 */
function _比元组(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    const c = 比串(String(x), String(y))
    if (c !== 0) return c
  }
  return a.length - b.length
}

// ------------------------------------------------------------------ selftest

/** Python 的 `str(exc)`：只有消息本体，不带 `Error: ` 前缀。 */
function _errMsg(exc) {
  if (exc === null || exc === undefined) return 'None'
  if (typeof exc === 'string') return exc
  if (exc.message !== undefined) return String(exc.message)
  return String(exc)
}

/** Python 的 `str.count(sub)`（非空子串，非重叠计数）。 */
function _数(s, sub) {
  if (sub === '') return lenPy(s) + 1
  return String(s).split(sub).length - 1
}

/** Python 的 `os.path.getsize(p)`。 */
function _大小(p) { return statSync(p).size }

/** `json.dumps(obj, ensure_ascii=False)`（默认分隔符 `", "` / `": "`、无缩进、无末尾换行）。
 *  `ass` 为真时模拟 CPython 的 `ensure_ascii=True`（非 ASCII 一律 `\uXXXX`）。 */
function _json紧凑(obj, ass) {
  if (obj === null || obj === undefined) return 'null'
  if (obj === true) return 'true'
  if (obj === false) return 'false'
  if (Array.isArray(obj)) return '[' + obj.map((x) => _json紧凑(x, ass)).join(', ') + ']'
  if (typeof obj === 'number') return _pyStr(obj)
  if (typeof obj === 'object') {
    return '{' + Object.keys(obj)
      .map((k) => _json键(k, ass) + ': ' + _json紧凑(obj[k], ass)).join(', ') + '}'
  }
  return _json串(String(obj), ass)
}

function _json键(k, ass) { return _json串(String(k), ass) }

function _json串(s, ass) {
  const 原 = JSON.stringify(s)
  if (!ass) return 原
  let out = ''
  for (let i = 0; i < 原.length; i++) {
    const c = 原.charCodeAt(i)
    out += c > 127 ? '\\u' + c.toString(16).padStart(4, '0') : 原[i]
  }
  return out
}

/** `sorted(os.listdir(p))`。 */
function _列目录(p) { return readdirSync(p).slice().sort(比串) }

/** `shutil.rmtree(p, ignore_errors=True)`。 */
function _删树(p) { try { rmSync(p, { recursive: true, force: true }) } catch { /* ignore_errors */ } }

/** `shutil.copy(src, dst)`（保留内容；mtime 由调用方按需 utimes）。 */
function _拷文件(src, dst) { copyFileSync(src, dst) }

/** `os.utime(p, (t, t))` —— Node 的 `utimesSync(path, atime, mtime)`。 */
function _触时间(p, t) { utimesSync(p, t, t) }

/** Python 的 `"%s" % True` → `'True'`（`String(true)` 会给出 `'true'`）。 */
function _T(v) { return v ? 'True' : 'False' }

/** `re.findall(pattern, text)` 的等价物：取**捕获组 1**的全部命中（按出现顺序）。 */
function _找全部(文, re, 组) {
  const out = []
  for (const m of String(文).matchAll(re)) out.push(m[组])
  return out
}

/** Python `lambda *a, **k: None` —— 自检里到处用来消输出。 */
const _P = () => {}

/** `zipfile.ZipFile(z).namelist()`：只读中央目录取名字。
 *  自检第 16 项专用 —— **不为此去给已经绿的 `dist.mjs` 加导出**（它的 `_读zip` 是私有的）。 */
function _zip列名(zip_path) {
  const buf = readFileSync(zip_path)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('File is not a zip file')
  const n = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad magic number for central directory')
    const 名长 = buf.readUInt16LE(p + 28)
    const 额外长 = buf.readUInt16LE(p + 30)
    const 注长 = buf.readUInt16LE(p + 32)
    out.push(buf.toString('utf8', p + 46, p + 46 + 名长))
    p += 46 + 名长 + 额外长 + 注长
  }
  return out
}

// ---……--- 自检 ------------------------------------------------------------------
// `forge.py:950-2467` 的 `cmd_selftest` 逐字节移植（四十二项；编号 21 / 39 / 40 已迁出）。
// 移植记号：`tempfile.mkdtemp` → `mkdtempSync`；`M.ydump` 在 JS 侧明确抛错 ⇒ 一律改走
// `M.jdump`（路径与后缀不变，差分按结构相等比）；`os.path.relpath` → `BUNDLE._relpath`；
// `%s % exc` → `_errMsg(exc)`（Python 的 `str(exc)` 不带 `Error: ` 前缀）。
export function cmd_selftest(argv) {
  // 自检：骨架 -> 卡 -> 解包 -> 再打包，比对语义是否一致；顺带跑校验。
  // 自检是**在普通文件系统上考工具自己** —— 有几项靠「删文件 / 改名」摆场景，
  // 沙箱模式下它们会假报错。所以这里把沙箱模式关掉（第 42 项自己会临时打开再关）。
  if (SB.enabled()) {
    _print('（沙箱友好模式已临时关掉 —— 自检要在能删能改名的文件系统上跑）')
    SB.enable(false)
  }
  let ok = true
  const tmp = mkdtempSync(_join(tmpdir(), 'forge_selftest_'))

  _print('='.repeat(74))
  _print('forge 自检（四十二项；编号 21 / 39 / 40 原为图形工作台，已迁出 → 弃用/工作台/）')
  _print('='.repeat(74))

  // 1. 开新卡
  let proj = null
  let spec = null
  try {
    proj = scaffold.new_card('自检卡', tmp, null, true)
    spec = _join(proj, 'source', '自检卡.spec.yaml')
    _print('  1 开新卡          ✔ ' + BUNDLE._relpath(spec, tmp))
  } catch (exc) {
    _print('  1 开新卡          ✗ ' + _errMsg(exc))
    return 1
  }

  // 2. 校验 spec
  const card1 = pack.spec_to_card(spec)
  const issues = validate.validate_card(card1, '骨架')
  const errs = issues.filter((i) => i.level === 'ERROR')
  if (errs.length) {
    ok = false
    _print('  2 骨架校验        ✗ 有 ' + errs.length + ' 个错误（骨架不该有错）')
    for (const i of errs) _print(i.line())
  } else {
    _print('  2 骨架校验        ✔ 0 错误，' + issues.filter((i) => i.level === 'WARN').length + ' 警告')
  }

  // 3. 打包
  const card_path = _join(proj, '成品', '自检卡.card.json')
  pack.build(spec, card_path)
  const card2 = M.jload(card_path)
  _print('  3 打包            ✔ ' + BUNDLE._relpath(card_path, tmp))

  // 4. 解包
  const round_spec = _join(tmp, 'round.spec.yaml')
  pack.unpack(card_path, round_spec)
  _print('  4 解包            ✔ ' + _basename(round_spec))

  // 5. 往返语义一致
  const card3 = pack.spec_to_card(round_spec)
  if (_canon_pair(card2, card3)) {
    _print('  5 往返一致        ✔ 卡 -> spec -> 卡，语义不变')
  } else {
    ok = false
    _print('  5 往返一致        ✗ 往返后语义变了')
  }

  // 6. 值域拦截（负向验：故意写一个会被静默降级的旧值）
  const bad = M.jload(card_path)
  pack.mutate_active_library(bad, (lib) => {
    lib.entries[1].agent_read_strategy = 'variable_condition'
  })
  const intercepted = validate.validate_card(bad, '负向样本').filter((i) => i.code === 'DOMAIN-LEGACY')
  if (intercepted.length) {
    _print('  6 值域拦截        ✔ 拦下了 variable_condition（会被静默降级）')
  } else {
    ok = false
    _print('  6 值域拦截        ✗ 没拦下 variable_condition')
  }

  // 7. 常驻缺位置（负向）
  const bad2 = M.jload(card_path)
  pack.mutate_active_library(bad2, (lib) => {
    lib.entries[1].position = ''
  })
  const caught = validate.validate_card(bad2, '负向样本').filter((i) => i.code === 'CONST-NO-POSITION')
  if (caught.length) {
    _print('  7 常驻位置护栏    ✔ 拦下了「常驻但 position 为空」')
  } else {
    ok = false
    _print('  7 常驻位置护栏    ✗ 没拦下常驻缺位置')
  }

  // 8. 关键词空（负向）
  const bad3 = M.jload(card_path)
  const _blank_keywords = (lib) => {
    lib.entries[3].agent_read_strategy = 'keyword'
    lib.entries[3].keywords = []
  }
  pack.mutate_active_library(bad3, _blank_keywords)
  const caught3 = validate.validate_card(bad3, '负向样本').filter((i) => i.code === 'KEYWORD-EMPTY')
  if (caught3.length) {
    _print('  8 关键词护栏      ✔ 拦下了「keyword 策略但没关键词」')
  } else {
    ok = false
    _print('  8 关键词护栏      ✗ 没拦下空关键词')
  }

  // 9. 模块并入（骰子替换一条 + 并 7 条正则；备份底稿克隆一条）
  let spec2 = null
  try {
    const proj2 = scaffold.new_card('模块卡', tmp, null, true, ['骰子', '备份'])
    spec2 = _join(proj2, 'source', '模块卡.spec.yaml')
    const raw2 = M.yload(spec2)
    const n_ent = raw2.library.entries.length
    const n_re = (raw2.regex_rules || []).length
    const errs2 = validate.validate_card(pack.spec_to_card(spec2), '模块卡').filter((i) => i.level === 'ERROR')
    if (n_ent >= 5 && n_re >= 7 && !errs2.length) {
      _print('  9 模块并入        ✔ 骰子+备份 -> 条目 ' + n_ent + ' 条 / 正则 ' + n_re + ' 条 / 0 错误')
    } else {
      ok = false
      _print('  9 模块并入        ✗ 条目 ' + n_ent + ' / 正则 ' + n_re + ' / 错误 ' + errs2.length)
    }
  } catch (exc) {
    ok = false
    spec2 = null
    _print('  9 模块并入        ✗ ' + _errMsg(exc))
  }

  // 10. 手册与索引
  try {
    const html_path = _join(tmp, '手册.html')
    manual.build_manual(spec2 || spec, html_path, () => {})
    const text = _读文本(html_path)
    const paired = _数(text, '<details>') === _数(text, '</details>') &&
      _数(text, '<section') === _数(text, '</section>')
    const idx_path = manual.build_index(spec2 || spec, _join(tmp, '索引.md'), () => {})
    if (paired && _大小(idx_path) > 200) {
      _print('  10 手册与索引      ✔ 手册 ' + Math.floor(lenPy(text) / 1024) + ' KB（' +
        _数(text, '<details>') + ' 个条目块）+ 索引 ' + _大小(idx_path) + ' 字节')
    } else {
      ok = false
      _print('  10 手册与索引      ✗ 标签不配对或索引为空')
    }
  } catch (exc) {
    ok = false
    _print('  10 手册与索引      ✗ ' + _errMsg(exc))
  }
  // 11. 酒馆 V2 卡 -> ElecKoi
  const st_path = _join(tmp, 'st.json')
  writeFileSync(st_path, _json紧凑({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: '自检酒馆卡',
      description: '这是一张自检用的酒馆卡。',
      first_mes: '你好。',
      alternate_greetings: ['另一个开场。'],
      tags: ['自检'],
      character_book: {
        entries: [
          {
            name: '条目一', keys: ['测试'], content: '关键词条目。',
            constant: false, enabled: true, insertion_order: 1,
          },
          {
            name: '条目二', keys: [], content: '常驻条目。',
            constant: true, enabled: true, insertion_order: 2,
          },
        ],
      },
    },
  }), 'utf8')
  try {
    const sp3 = _join(tmp, 'st.spec.yaml')
    bridge.to_eleckoi(st_path, sp3, () => {})
    const errs3 = validate.validate_card(pack.spec_to_card(sp3), '自检酒馆卡').filter((i) => i.level === 'ERROR')
    if (!errs3.length) {
      _print('  11 酒馆卡转换      ✔ 酒馆 V2 -> ElecKoi，0 错误')
    } else {
      ok = false
      _print('  11 酒馆卡转换      ✗ ' + errs3.length + ' 个错误')
    }
  } catch (exc) {
    ok = false
    _print('  11 酒馆卡转换      ✗ ' + _errMsg(exc))
  }

  // 12. ElecKoi -> 酒馆 -> ElecKoi（无损往返）
  try {
    const back = _join(tmp, 'back.json')
    exportMod.to_tavern(card_path, back, false, () => {})
    const sp4 = _join(tmp, 'back.spec.yaml')
    bridge.to_eleckoi(back, sp4, () => {})
    const card4 = pack.spec_to_card(sp4)
    if (_canon_pair(card2, card4)) {
      _print('  12 往返无损        ✔ ElecKoi -> 酒馆 -> ElecKoi，语义不变')
    } else {
      ok = false
      _print('  12 往返无损        ✗ 转一圈之后语义变了')
    }
  } catch (exc) {
    ok = false
    _print('  12 往返无损        ✗ ' + _errMsg(exc))
  }

  // 13. 界面层：组装真的产出了东西，且守规矩
  try {
    const prev = _join(proj, '预览.html')
    const raw3 = M.yload(spec)
    const n_re3 = (raw3.regex_rules || []).length
    const hud_errs = validate.validate_hud(proj).filter((i) => i.level === 'ERROR')
    if (_是文件(prev) && n_re3 >= 2 && !hud_errs.length) {
      _print('  13 界面组装        ✔ 预览.html ' + Math.floor(_大小(prev) / 1024) + ' KB · 写回 ' +
        n_re3 + ' 条正则 · 界面守则 0 错')
    } else {
      ok = false
      _print('  13 界面组装        ✗ 预览页=' + _T(_是文件(prev)) + ' 正则=' + n_re3 +
        ' 守则错=' + hud_errs.length)
    }
  } catch (exc) {
    ok = false
    _print('  13 界面组装        ✗ ' + _errMsg(exc))
  }

  // 14. 界面守则（负向）：模块 CSS 漏了 .hud 前缀，必须被拦下
  try {
    const proj2b = _join(tmp, '模块卡')
    const css = _join(proj2b, 'hud', '模块', '备份', '备份.css')
    const text = _读文本(css)
    writeFileSync(css, text + '\nbody { color: red; }\n.mine-x { color: blue; }\n', 'utf8')
    const caught14 = validate.validate_hud(proj2b).filter((i) => i.code === 'HUD-CSS-PREFIX')
    if (caught14.length) {
      _print('  14 界面守则        ✔ 拦下了模块 CSS 里 ' + caught14.length + ' 处漏前缀的选择器')
    } else {
      ok = false
      _print('  14 界面守则        ✗ 没拦下漏前缀的裸选择器')
    }
  } catch (exc) {
    ok = false
    _print('  14 界面守则        ✗ ' + _errMsg(exc))
  }

  // 15. 变量三处同步（负向）：initial_state 少一个对象，必须被拦下
  try {
    const raw5 = M.yload(spec)
    delete raw5.variables.initial_state['存档']
    const bad5 = _join(tmp, '同步.spec.yaml')
    M.jdump(raw5, bad5)
    const caught15 = validate.validate_card(pack.spec_to_card(bad5), '同步样本')
      .filter((i) => i.code.startsWith('VAR-SYNC'))
    if (caught15.length) {
      _print('  15 变量三处同步    ✔ 拦下了「initial_state 少一个对象」（' + caught15.length + ' 处）')
    } else {
      ok = false
      _print('  15 变量三处同步    ✗ 没拦下变量不同步')
    }
  } catch (exc) {
    ok = false
    _print('  15 变量三处同步    ✗ ' + _errMsg(exc))
  }

  // 16. 打包分发
  try {
    const z = BUNDLE.run(_join(tmp, '模块卡'), _join(tmp, '包.zip'), false, () => {})
    const names = _zip列名(z)
    const has = ['spec.yaml', 'hud.core.js', 'test_core.js', '.card.json']
      .every((s) => names.some((n) => n.endsWith(s)))
    if (has && names.length >= 8) {
      _print('  16 打包分发        ✔ ' + names.length + ' 个文件进包（含内容层 / 界面层 / 成品 / 测试）')
    } else {
      ok = false
      _print('  16 打包分发        ✗ 包里少了东西（' + names.length + ' 个文件）')
    }
  } catch (exc) {
    ok = false
    _print('  16 打包分发        ✗ ' + _errMsg(exc))
  }

  // 17. 撤模块：接上再撤，必须回到没接过的那一份（账本清空、界面目录删掉）
  let proj3 = null
  let spec3 = null
  let before17 = null
  try {
    proj3 = scaffold.new_card('撤模块卡', tmp, null, true)
    spec3 = _join(proj3, 'source', '撤模块卡.spec.yaml')
    before17 = _fresh_snapshot(spec3)
    mods.apply_modules(spec3, ['骰子', '备份'], proj3, () => {})
    const mid = _fresh_snapshot(spec3)
    // 撤之前先组装一次，让模块的脚本落进 hud/模块/
    HUD.build(proj3, true, () => {})
    mods.drop_modules(spec3, ['骰子', '备份'], proj3, () => {})
    const after = _fresh_snapshot(spec3)
    const led = mods.load_ledger(proj3)['模块'] || {}
    const hud_gone = !_是目录(_join(proj3, 'hud', '模块', '备份'))
    if (_canon(mid) !== _canon(before17) && _canon(after) === _canon(before17) &&
        !Object.keys(led).length && hud_gone) {
      _print('  17 撤模块          ✔ 接上（' + before17['条目'] + ' -> ' + mid['条目'] + ' 条）再撤，回到原样；账本清空')
    } else {
      ok = false
      _print('  17 撤模块          ✗ 接=' + _T(_canon(mid) !== _canon(before17)) + ' 撤=' +
        _T(_canon(after) === _canon(before17)) + ' 原样=' + pyRepr(before17) + ' 账本=' +
        Object.keys(led).length + ' 界面残留=' + _T(!hud_gone))
    }
  } catch (exc) {
    ok = false
    _print('  17 撤模块          ✗ ' + _errMsg(exc))
  }

  // 18. 换皮肤：只动颜色槽，核心样式一个字不动
  try {
    const theme_pick = '墨夜'
    // 比对的是「这个工程」的核心样式前后 —— 不是跟骨架比：
    // 建卡时会做一轮换名（骨架 -> 卡名），抄过来的 hud.css 本来就有一处不同。
    const core_path = _join(proj3, 'hud', 'hud.css')
    const before_core = _读文本(core_path)
    THEME.apply_theme(theme_pick, proj3, () => {})
    HUD.build(proj3, true, () => {})
    const core_after = _读文本(core_path)
    const css_path = _join(proj3, 'hud', '主题.css')
    const doc = _读文本(_join(proj3, 'hud', 'out', 'view_create.html'))
    const page = _读文本(_join(proj3, '预览.html'))
    const slot_ok = doc.includes('--hud-ink: #e6dccb')       // 主题真的注进去了
    const core_same = core_after === before_core             // 核心没被改
    const page_ok = page.includes('#0b0a08')                 // 预览页外壳也跟着换
    if (_是文件(css_path) && slot_ok && core_same && page_ok) {
      _print('  18 换皮肤          ✔ ' + theme_pick + '：槽进页面 · 核心样式未改 · 预览页跟着换')
    } else {
      ok = false
      _print('  18 换皮肤          ✗ 主题文件=' + _T(_是文件(css_path)) + ' 注入=' + _T(slot_ok) +
        ' 核心未改=' + _T(core_same) + ' 预览=' + _T(page_ok))
    }
  } catch (exc) {
    ok = false
    _print('  18 换皮肤          ✗ ' + _errMsg(exc))
  }

  // 19. 主题写错槽（负向）：核心不认识的槽必须当场停，不许静默不生效
  try {
    let caught19 = false
    try {
      THEME.render_css({ 名: '坏主题', 变量: { '--hud-不存在的槽': '#fff' } })
    } catch (e) {
      if (e instanceof THEME.ThemeError) caught19 = true
      else throw e
    }
    if (caught19) {
      _print('  19 主题护栏        ✔ 拦下了核心不认识的槽（那种错会静默不生效）')
    } else {
      ok = false
      _print('  19 主题护栏        ✗ 没拦下写错的槽')
    }
  } catch (exc) {
    ok = false
    _print('  19 主题护栏        ✗ ' + _errMsg(exc))
  }

  // 20. 可读性体检（负向）：浅灰字压浅底，必须被判成「看不清」
  try {
    const bad_theme = {
      名: '雾里看花',
      变量: {
        '--hud-ink': '#c9c5bd', '--hud-ink-2': '#d5d1c9',
        '--hud-dim': '#dedbd4', '--hud-paper-solid': 'rgba(250, 248, 242, 0.93)',
      },
    }
    const rep = THEME.contrast_report(bad_theme)
    const poor = Object.entries(rep).filter(([, v]) => !v['够'])
    const good = Object.values(THEME.contrast_report(THEME.find_theme('羊皮卷'))).every((v) => v['够'])
    if (poor.length === 3 && good) {
      _print('  20 可读性体检      ✔ 浅灰压浅底被判成看不清；自带五套全部达标')
    } else {
      ok = false
      _print('  20 可读性体检      ✗ 判出 ' + poor.length + ' 处不达标 / 自带主题达标=' + _T(good))
    }
  } catch (exc) {
    ok = false
    _print('  20 可读性体检      ✗ ' + _errMsg(exc))
  }
  // 22. 分发往返：打包 -> 收包 -> 语义一致；恶意包必须整包拒收
  try {
    const pack_zip = BUNDLE.run(proj, _join(tmp, '自检卡.工程包.zip'), false, () => {})
    const got = DIST.import_pack(pack_zip, _join(tmp, '收到的'), false, true, () => {})
    const man = DIST.read_manifest(pack_zip)
    const back_spec = _join(got, 'source', '自检卡.spec.yaml')
    const same = _是文件(back_spec) && _canon_pair(M.yload(spec), M.yload(back_spec))

    const evil = _join(tmp, '恶意包.zip')
    BUNDLE._写zip(evil, [
      { 名: '卡/../../forge_逃逸自检.txt', 数据: 'x' },
      { 名: '卡/source/x.spec.yaml', 数据: 'x' },
    ])
    let refused = false
    try {
      DIST.import_pack(evil, tmp, false, true, () => {})
    } catch (e) {
      if (e instanceof DIST.DistError) refused = true
      else throw e
    }
    const escaped = _存在(_join(tmp, '..', 'forge_逃逸自检.txt'))

    if (pyTruthy(man) && same && refused && !escaped) {
      _print('  22 分发往返        ✔ 包 ' + Object.keys(man['清单'] || {}).length + ' 条清单 · 收回来语义一致 · 恶意包被拒')
    } else {
      ok = false
      _print('  22 分发往返        ✗ 清单=' + _T(pyTruthy(man)) + ' 语义一致=' + _T(same) +
        ' 拒恶意=' + _T(refused) + ' 未逃逸=' + _T(!escaped))
    }
  } catch (exc) {
    ok = false
    _print('  22 分发往返        ✗ ' + _errMsg(exc))
  }

  // 23. 皮肤出入：卡上那份配色导得出去、回得来；坏槽必须当场停
  try {
    THEME.apply_theme('朱砂', proj, () => {})
    const exp = THEME.export_theme(proj, _join(tmp, '自检皮肤.json'), '自检皮肤', () => {})
    THEME.clear_theme(proj, () => {})
    const cleared = THEME.current(proj).startsWith('核心默认')
    THEME.import_theme(exp, proj, false, () => {})
    const css = _读文本(_join(proj, 'hud', '主题.css'))
    const back_ok = css.includes('--hud-accent') && THEME.current(proj) === '自检皮肤'

    const bad = _join(tmp, '坏皮肤.json')
    writeFileSync(bad, _json紧凑({ 名: '坏', 变量: { '--hud-没有这个槽': '#fff' } }, true), 'utf8')
    let stopped = false
    try {
      THEME.import_theme(bad, proj, false, () => {})
    } catch (e) {
      if (e instanceof THEME.ThemeError) stopped = true
      else throw e
    }

    if (back_ok && cleared && stopped) {
      _print('  23 皮肤出入        ✔ 导出/导入往返一致 · 撤得干净 · 坏槽被拦')
    } else {
      ok = false
      _print('  23 皮肤出入        ✗ 往返=' + _T(back_ok) + ' 撤回=' + _T(cleared) +
        ' 坏槽被拦=' + _T(stopped))
    }
  } catch (exc) {
    ok = false
    _print('  23 皮肤出入        ✗ ' + _errMsg(exc))
  }

  // 24. Zod 保形：解析 -> 生成 -> 再解析必须一致，手写的约束不许被抹掉；
  //     认不出的形状必须当场拒绝（负向）
  try {
    const code = ((M.yload(spec).variables || {}).schema_code) || ''
    const once = ZOD.emit(ZOD.parse(code))
    const 稳 = ZOD.roundtrip_ok(code) && once === ZOD.emit(ZOD.parse(once))
    const 保住 = once.includes('z.number().int().min(1).max(20)')   // 手写的约束
    let 拦住 = 0
    for (const bad of ['z.string()',                                 // 顶层不是 object
      'z.object({ a: z.string() }).passthrough()',                   // 后面带后缀
      'z.object({ a b })']) {                                        // 切错了（缺冒号）
      try {
        ZOD.parse(bad)
      } catch (e) {
        if (e instanceof ZOD.ZodError) 拦住 += 1
        else throw e
      }
    }
    if (稳 && 保住 && 拦住 === 3) {
      _print('  24 Zod 保形        ✔ 往返一致 · 手写的 .min().max() 保住 · 三种怪形状被拒')
    } else {
      ok = false
      _print('  24 Zod 保形        ✗ 稳定=' + _T(稳) + ' 约束保住=' + _T(保住) + ' 拒了 ' + 拦住 + '/3')
    }
  } catch (exc) {
    ok = false
    _print('  24 Zod 保形        ✗ ' + _errMsg(exc))
  }

  // 25. 内容增删：条目 / 分组 / 对象 / 变量 / 正则 加得上、删得进回收站、
  //     放回去能回到原样；错模板、错分组、重名都要被拦（负向）
  try {
    const _P = () => {}
    // 数「这一项自己新增了几条记录」而不是总数 —— 同一份 spec 上前面几项
    // （比如前面几项）也会留下记录，总数不该由这一项来断言。
    const 起始回收 = CONTENT.list_trash(spec).length
    const 前 = CONTENT.stats(spec)
    CONTENT.add_group(spec, '自检组', '', _P)
    const e = CONTENT.add_entry(spec, '自检 · 新条目', '自检组', '关键词', '占位', ['自检'], null, null, _P)
    CONTENT.add_object(spec, '自检对象', '', '', '', _P)
    const v = CONTENT.add_variable(spec, '自检对象', '计数', 'number', 7, '', '', _P)
    const r = CONTENT.add_regex(spec, '自检正则', '/〔自检〕/g', '<b>$1</b>', null, null, true, _P)
    const 加完 = CONTENT.stats(spec)
    const 加齐 = (加完['条目'] === 前['条目'] + 1 && 加完['分组'] === 前['分组'] + 1 &&
      加完['对象'] === 前['对象'] + 1 && 加完['变量'] === 前['变量'] + 1 &&
      加完['正则'] === 前['正则'] + 1)

    let 拦 = 0
    for (const fn of [() => CONTENT.add_entry(spec, '没关键词', '', '关键词', '', null, null, null, _P),
      () => CONTENT.add_entry(spec, '错组', '没这个组', '常驻', '', null, null, null, _P),
      () => CONTENT.add_entry(spec, '错模板', '', '乱写', '', null, null, null, _P),
      () => CONTENT.add_group(spec, '自检组', '', _P)]) {
      try {
        fn()
      } catch (e2) {
        if (e2 instanceof CONTENT.ContentError) 拦 += 1
        else throw e2
      }
    }

    CONTENT.del_entry(spec, e['id'], _P)
    CONTENT.del_variable(spec, v['id'], _P)
    CONTENT.del_regex(spec, r['id'], _P)
    CONTENT.del_object(spec, '自检对象', _P)
    CONTENT.del_group(spec, '自检组', _P)
    const 撤完 = CONTENT.stats(spec)
    const 回收站 = CONTENT.list_trash(spec).length - 起始回收

    for (const rec of CONTENT.list_trash(spec)) {        // 逐条放回去
      CONTENT.restore(spec, rec['_文件'], _P)
    }
    const 回来 = CONTENT.stats(spec)
    const 还原齐 = _canon(回来) === _canon(加完)
    const 条目回 = CONTENT.list_entries(spec).some((x) => x['id'] === e['id'])

    if (加齐 && _canon(撤完) === _canon(前) && 回收站 === 5 && 还原齐 && 条目回 && 拦 === 4) {
      _print('  25 内容增删        ✔ 五种都能加 · 撤完回到原样 · 五条记录放回去一字不差 · 四种错被拦')
    } else {
      ok = false
      _print('  25 内容增删        ✗ 加齐=' + _T(加齐) + ' 撤净=' + _T(_canon(撤完) === _canon(前)) +
        ' 回收站=' + 回收站 + ' 还原=' + _T(还原齐) + ' 错被拦=' + 拦 + '/4')
    }
  } catch (exc) {
    ok = false
    _print('  25 内容增删        ✗ ' + _errMsg(exc))
  }

  // 26. 变量三处同步：加一个变量三处一次写全、删一个三处一起撤；
  //     对象表与初值形状对不上时必须拒写，且 spec 一个字不动（负向）
  try {
    const _P = () => {}
    const vv = CONTENT.add_variable(spec, '玩家', '自检值', 'number', 5, '', '', _P)
    let raw = CONTENT.load(spec)
    let v = raw['variables']
    let z = ZOD.parse(v['schema_code'])
    const 齐 = (((v['initial_state']['玩家'] || {})['自检值']) === 5 &&
      (z.kids.get('玩家') instanceof ZOD.Obj) &&
      (z.kids.get('玩家').kids.get('自检值') !== undefined && z.kids.get('玩家').kids.get('自检值') !== null) &&
      v['variables'].some((x) => x['id'] === vv['id']))
    CONTENT.del_variable(spec, vv['id'], _P)
    raw = CONTENT.load(spec)
    v = raw['variables']
    z = ZOD.parse(v['schema_code'])
    const 净 = (!('自检值' in (v['initial_state']['玩家'] || {})) &&
      !z.kids.get('玩家').kids.has('自检值'))

    // 造一个「列表对象」：对象挂在别人下面、名字和它唯一的变量同名、初值那边是平的
    raw = CONTENT.load(spec)
    v = raw['variables']
    v['objects'].push(M.ordered({
      id: 'obj-check-bag', name: '自检夹',
      parent_id: 'obj-player', enabled: true,
      description: '', update_rule: '',
      dynamic_key: false, order: 99,
      tree_view_order: 99,
      created_at: M.nowIso(),
      updated_at: M.nowIso(),
    }, M.VAR_OBJECT_KEYS))
    v['variables'].push(M.ordered({
      id: 'variable-check-bag', title: '自检夹',
      object_id: 'obj-check-bag', enabled: true,
      type: 'array', default_value: '[]',
      description: '', update_rule: '',
      read_mode: 'on_demand', order: 99,
      tree_view_order: 99,
      created_at: M.nowIso(),
      updated_at: M.nowIso(),
    }, M.VAR_ITEM_KEYS))
    v['initial_state']['玩家']['自检夹'] = []
    M.jdump(raw, spec)
    const 前文 = _读文本(spec)
    let 拒 = false
    try {
      CONTENT.add_variable(spec, '自检夹', '重量', 'number', 1, '', '', _P)
    } catch (e2) {
      if (e2 instanceof CONTENT.ContentError) 拒 = true
      else throw e2
    }
    const 没动 = _读文本(spec) === 前文
    // 形状不一致时，删那一条仍要认得准（靠「存不存在」认位置）
    CONTENT.del_variable(spec, '自检夹', _P)
    raw = CONTENT.load(spec)
    const 删净 = (!('自检夹' in (raw['variables']['initial_state']['玩家'] || {})) &&
      !ZOD.parse(raw['variables']['schema_code']).kids.get('玩家').kids.has('自检夹'))

    if (齐 && 净 && 拒 && 没动 && 删净) {
      _print('  26 变量三处同步    ✔ 加一个三处齐 · 删一个三处净 · 形状对不上时拒写且一字不动')
    } else {
      ok = false
      _print('  26 变量三处同步    ✗ 加齐=' + _T(齐) + ' 删净=' + _T(净) + ' 拒写=' + _T(拒) +
        ' 没动=' + _T(没动) + ' 删准=' + _T(删净))
    }
  } catch (exc) {
    ok = false
    _print('  26 变量三处同步    ✗ ' + _errMsg(exc))
  }
  // 27. 工程层：模块目录↔conf、账本↔现状、界面有没有写回、派生物过没过期。
  //     这几类错的共同点是**都不报错**（界面上安静地少一块、撤模块撤不回原样、
  //     交出去的成品还是老内容），所以只能靠查 —— 每条都要能查出来（负向），
  //     同时**模板源那种「本来就没成品」的工程一条都不许报**（防误报）。
  try {
    const 工 = _join(tmp, '模块卡')                 // 接过模块、有成品的那种
    const _地 = () => validate.validate_project(工).map((i) => i.code)   // noqa: E731

    // (a) 干净的时候一条都不该有
    const 净 = !_地().length

    // (b) 模块目录在、conf 没登记 —— 组装时根本不拼它
    mkdirSync(_join(工, 'hud', '模块', '野模块'), { recursive: true })
    const 拦b = _地().includes('PROJ-MOD-UNLISTED')

    // (c) conf 登记了、账本没记 —— `forge drop` 撤不掉
    const conf_p = _join(工, 'hud', 'hud.conf.json')
    let conf = M.jload(conf_p)
    if (!conf['模块']) conf['模块'] = []
    conf['模块'].push('野模块')
    writeFileSync(conf_p, JSON.stringify(conf, null, 2), 'utf8')
    const 拦c = _地().includes('PROJ-MOD-NO-LEDGER')

    // (d) 账本记着替换过的条目，spec 里被删了 —— 撤的时候撤不动
    const led_p = _join(工, '模块账本.json')
    const led = M.jload(led_p)
    for (const rec of Object.values(led['模块'] || {})) {
      if (!rec['条目']) rec['条目'] = {}
      if (!rec['条目']['替换']) rec['条目']['替换'] = []
      rec['条目']['替换'].push({ id: '早就不在了', title: '幽灵条目', 原: {}, 并入后: 'x' })
      break
    }
    writeFileSync(led_p, JSON.stringify(led, null, 2), 'utf8')
    const 拦d = _地().includes('PROJ-LEDGER-GONE')

    // (e) 账本记的界面文件不见了
    let _界 = null
    for (const rec of Object.values(led['模块'] || {})) {
      for (const rel of (rec['界面'] || [])) {
        _界 = _join(工, String(rel).split('/').join('\\'))
        break
      }
      if (_界) break
    }
    if (_界 && _是文件(_界)) unlinkSync(_界)
    const 拦e = pyTruthy(_界) && _地().includes('PROJ-LEDGER-HUD')

    // (f) 界面没写回卡里：把 conf 那条正则换个名，spec 里就没有同名的了
    conf = M.jload(conf_p)
    conf['正则'][0]['name'] = '改了个名 · 没人写回'
    writeFileSync(conf_p, JSON.stringify(conf, null, 2), 'utf8')
    const 拦f = _地().includes('PROJ-HUD-UNWRITTEN')

    // (g) 成品比 spec 旧：把 spec 摸新
    const sp_p = _join(工, 'source', '模块卡.spec.yaml')
    _触时间(sp_p, Date.now() / 1000 + 60)
    const 拦g = _地().includes('PROJ-STALE-CARD')

    // (h) 两张 spec 并存 —— 谁也不知道该用哪份
    copyFileSync(sp_p, _join(工, 'source', '第二张.spec.yaml'))
    const 拦h = _地().includes('PROJ-MULTI-SPEC')

    // (i) 防误报：把成品拿走（变成「模板源」那样），界面没写回也不许报
    rmSync(_join(工, '成品'), { recursive: true, force: true })
    unlinkSync(_join(工, 'source', '第二张.spec.yaml'))
    const 不报 = !_地().includes('PROJ-HUD-UNWRITTEN')

    const 条 = [净, 拦b, 拦c, 拦d, 拦e, 拦f, 拦g, 拦h, 不报]
    if (条.every(pyTruthy)) {
      _print('  27 工程自洽       ✔ 七种「不报错的错」都查得出；' +
        '模板源（没成品）不误报')
    } else {
      ok = false
      _print('  27 工程自洽       ✗ 净=' + _T(净) + ' 目录↔conf=' + _T(拦b) + ' 账本无记录=' + _T(拦c) +
        ' 幽灵条目=' + _T(拦d) + ' 账本界面=' + _T(拦e) + ' 没写回=' + _T(拦f) +
        ' 成品过期=' + _T(拦g) + ' 两份spec=' + _T(拦h) + ' 不误报=' + _T(不报))
    }
  } catch (exc) {
    ok = false
    _print('  27 工程自洽       ✗ ' + _errMsg(exc))
  }

  // 28. 制卡向导：一份内容两个出口；出完自己必须是绿的
  //     验收：规程成篇、技能有 frontmatter、卡体检 0 错、条目齐、往返一致、
  //     并且它自己守着「常驻不超预算」这条规矩（教别人省，自己不能胖）。
  try {
    const 向导 = _join(tmp, '向导')
    const 静 = () => {}
    const r = COACH.出(向导, 静)
    const 规程字 = lenPy(_读文本(r['规程']))
    const 有头 = _读文本(r['技能']).startsWith('---\n')
    const 向导卡 = M.jload(r['卡'])
    const 概 = validate.summarize(向导卡)
    const 卡错 = validate.validate_card(向导卡, '向导卡').filter((i) => i.level === 'ERROR')
    pack.unpack(r['卡'], _join(向导, '回.yaml'))
    const 往返 = _canon(向导卡) === _canon(pack.spec_to_card(_join(向导, '回.yaml')))
    const 常驻 = _常驻字数(向导卡)
    const 条 = [规程字 > 5000, 有头, 概['entries'] >= 13, !卡错.length, 往返, 常驻 <= 700]
    if (条.every(pyTruthy)) {
      _print('  28 制卡向导       ✔ 规程 ' + 规程字 + ' 字 / 卡 ' + 概['entries'] + ' 条 0 错 / 往返一致 / 常驻 ' + 常驻 + ' 字')
    } else {
      ok = false
      _print('  28 制卡向导       ✗ 规程=' + 规程字 + '字 技能头=' + _T(有头) + ' 条目=' + 概['entries'] +
        ' 卡错=' + 卡错.length + ' 往返=' + _T(往返) + ' 常驻=' + 常驻 + '字')
    }
  } catch (exc) {
    ok = false
    _print('  28 制卡向导       ✗ ' + _errMsg(exc))
  }

  // 29. 规程与工具对得上 —— 规程会腐烂：工具加了命令、改了值域，规程还写着老样子。
  //     它是给 AI 的唯一依据；里面一句跑不通的命令，AI 就会照着撞一次墙。
  //     查四样：命令都在、模板名都在、类型名都在、该有的章节与要点都在。
  try {
    const 规程 = COACH.规程正文()
    const 命令 = Array.from(new Set(_找全部(规程, /forge\.py\s+([a-z][a-z_-]*)/g, 1))).sort(比串)
    const 野命令 = 命令.filter((c) => !(c in COMMANDS))
    const 模板 = new Set(_找全部(规程, /--模板\s+([^\s\\|]+)/g, 1).map((m) => m.trim()))
    const 野模板 = Array.from(模板).filter((t) => t && !(t in CONTENT.模板表)).sort(比串)
    const 类型 = Array.from(new Set(_找全部(规程, /--类型\s+([A-Za-z]+)/g, 1))).sort(比串)
    const 野类型 = 类型.filter((t) => !CONTENT.变量类型表.includes(t))
    const 缺节 = '一二三四五六七八九'.split('').map((x) => '## ' + x + '、').filter((h) => !规程.includes(h))
    const 缺要点 = [['零宽标记本身', 'u200B{3}'],
      ['--改 命令', '--改'],
      ['--看 命令', '--看'],
      ['@文件 写法', '--正文@'],
      ['开场白那一节', '## 三、开场白'],
      ['收卡那一节', '## 二、手上已经有一张卡'],
      ['opener 命令', 'forge.py opener'],
      ['--补齐', '--补齐'],
      ['开场白兜底断言', 'HUD-OPENER-MARK'],
      ['analyze 命令', 'forge.py analyze'],
      ['import 命令', 'forge.py import'],
      ['to-eleckoi 命令', 'forge.py to-eleckoi'],
      ['--从 接手（连界面层）', 'new <卡名> --从']]
      .filter(([, 串]) => !规程.includes(串)).map(([名]) => 名)
    // 负向：规程不许再出现「手改 conf 改开场白」的老教法。
    // 规程会腐烂成**自相矛盾**——§三 说「用 opener，别手改」，§八 还抄着老写法，
    // AI 抄的是 §八。正面查「有没有 opener」拦不住这个，得反面查「还在不在教手改」。
    const 老教法 = ['hud/hud.conf.json 的「开场白',
      'hud.conf.json 的「开场白.正文」',
      'conf 里的开场白正文（末尾'].filter((串) => 规程.includes(串))
    // 门牌（SKILL.md）是另一份会被读的东西：它必须指向**真**规程、里面的命令也得是真的。
    // 它以前是手抄的副本，与生成物脱节过 —— 现在由 coach 生成，这里顺手钉住。
    const 门牌 = COACH.技能正文
    const 野门牌 = Array.from(new Set(_找全部(门牌, /forge\.py\s+([a-z][a-z_-]*)/g, 1))).sort(比串)
      .filter((c) => !(c in COMMANDS))
    const 门牌缺 = ['AI制卡规程.md', 'forge.py', 'guide', 'cardforge'].filter((串) => !门牌.includes(串))
    const 前言缺 = ['name: eleckoi-card-maker', 'description:'].filter((串) => !COACH.技能前言.includes(串))
    const 缺 = (野命令.length ? ['命令不存在：' + 野命令.join('、')] : [])
      .concat(野模板.length ? ['模板不在表里：' + 野模板.join('、')] : [])
      .concat(野类型.length ? ['类型不在表里：' + 野类型.join('、')] : [])
      .concat(缺节.length ? ['缺章节：' + 缺节.join('、')] : [])
      .concat(缺要点.length ? ['缺要点：' + 缺要点.join('、')] : [])
      .concat(老教法.length ? ['规程自相矛盾（还在教手改 conf）：' + 老教法.join('、')] : [])
      .concat(野门牌.length ? ['门牌里的命令不存在：' + 野门牌.join('、')] : [])
      .concat(门牌缺.length ? ['门牌缺指向或命令：' + 门牌缺.join('、')] : [])
      .concat(前言缺.length ? ['技能前言缺：' + 前言缺.join('、')] : [])
    if (!缺.length) {
      _print('  29 规程与工具     ✔ ' + 命令.length + ' 条命令 / ' + 模板.size + ' 种模板 / ' + 类型.length +
        ' 种类型全对得上，九节齐、无手改残留；门牌指向正确')
    } else {
      ok = false
      _print('  29 规程与工具     ✗ ' + 缺.join('；'))
    }
  } catch (exc) {
    ok = false
    _print('  29 规程与工具     ✗ ' + _errMsg(exc))
  }

  // 30. 制卡读写回路 —— 「AI 顺畅改一张卡」的两个最短动作：
  //     先读它现在写了什么（--看），再把长正文写回去（--正文@文件）。
  //     缺了这两个，AI 就只能把整份 spec 整个吞进去找一段话，
  //     还得跟命令行转义打架（换行、引号在 shell 里是另一门手艺）。
  try {
    CONTENT.add_entry(spec, '自检 · 读写回路', '', '关键词', '第一版正文', ['回路'], null, null, _P)
    const d = CONTENT.entry_detail(spec, '自检 · 读写回路')
    const 读回 = d['正文'] === '第一版正文' && _canon(d['关键词']) === _canon(['回路']) && pyTruthy(d['id'])

    const 多行 = '第一行\n第二行\n\n第四行 \t 制表符 "引号" \\ 反斜杠 $ 符号'
    const f = _join(tmp, '正文.txt')
    writeFileSync(f, 多行 + '\n', 'utf8')      // 编辑器习惯：末尾多一个换行，不算内容
    CONTENT.set_entry(spec, '自检 · 读写回路', { content: _读文('@' + f) }, _P)
    const 写回 = CONTENT.entry_detail(spec, '自检 · 读写回路')['正文'] === 多行
    const 粘写 = _opt(['x', '--正文@' + f], ['--正文']) === 多行      // --正文@文件
    const 分写 = _opt(['x', '--正文', '@' + f], ['--正文']) === 多行  // --正文 @文件

    let 拦下 = false
    try {
      _opt(['x', '--正文@并没有这个文件.txt'], ['--正文'])
    } catch (e2) {
      if (e2 instanceof ArgError) 拦下 = true
      else throw e2
    }
    const 前30 = _读文本(spec)
    CONTENT.entry_detail(spec, '自检 · 读写回路')
    const 没动 = _读文本(spec) === 前30          // --看 是纯读

    const 条 = [读回, 写回, 粘写, 分写, 拦下, 没动]
    if (条.every(pyTruthy)) {
      _print('  30 制卡读写回路   ✔ 读一条（正文/关键词/多行原样）· ' +
        '长正文 @文件 两种写法 · 路径写错当场拦 · 读不改盘')
    } else {
      ok = false
      _print('  30 制卡读写回路   ✗ 读回=' + _T(读回) + ' 写回=' + _T(写回) + ' 粘写=' + _T(粘写) +
        ' 分写=' + _T(分写) + ' 拦下=' + _T(拦下) + ' 没动=' + _T(没动))
    }
  } catch (exc) {
    ok = false
    _print('  30 制卡读写回路   ✗ ' + _errMsg(exc))
  }
  // 31. 开场白：真源在 hud/hud.conf.json，spec 里那条只是派生物；末尾那三个
  //     零宽空格是「建卡界面」正则的开关 —— 少一个，导入 ElecKoi 后界面静默消失。
  //     这一项盯三件事：改一处不落下另一处、标记永远不多不少、
  //     坏输入（尖括号 / 空正文）一个字都不许落盘。
  try {
    const d0 = OPENER.读(proj)
    const 初 = pyTruthy(d0['有开场白']) && d0['标记数'] === 3 && d0['写回一致'] === true

    const 新文 = '深夜十一点四十分。\n\n你推开那扇门。\n\n（写下你的名字。）'
    const r = OPENER.改正文(proj, 新文, true, _P)
    const d1 = OPENER.读(proj)
    const 改好 = (d1['正文'] === 新文 + OPENER.标记 && d1['标记数'] === 3 &&
      d1['写回一致'] === true && r['写回'] === true)

    const 前31 = _读文本(d1['配置文件'])
    let 拦尖 = false
    let 拦空 = false
    try {
      OPENER.改正文(proj, '你推开「<长夜>」的门。', false, _P)
    } catch (e) {
      if (e instanceof OPENER.OpenerError) 拦尖 = true
      else throw e
    }
    try {
      OPENER.改正文(proj, '   ', false, _P)
    } catch (e) {
      if (e instanceof OPENER.OpenerError) 拦空 = true
      else throw e
    }
    const 没动31 = _读文本(d1['配置文件']) === 前31

    // 标记被弄丢（手改 conf 最容易出的那种事）：读得出、写回被拒、能补齐
    const conf_p31 = d1['配置文件']
    const s = _读文本(conf_p31)
    // Python 这边是**字面量**反斜杠 + u200b（conf 里存的是转义写法）；
    // `str.replace` 换全部 —— JS 的 `String.replace` 只换第一处，必须 split/join。
    writeFileSync(conf_p31, s.split('\\u200b\\u200b\\u200b').join('\\u200b'), 'utf8')
    const 看出 = OPENER.读(proj)['标记数'] === 1
    let 拒写回 = false
    try {
      OPENER.写回(proj, _P)
    } catch (e) {
      if (e instanceof OPENER.OpenerError) 拒写回 = true
      else throw e
    }
    OPENER.补齐(proj, _P)
    const d2 = OPENER.读(proj)
    const 补齐 = d2['标记数'] === 3 && d2['写回一致'] === true
    // 写回去的标记要是**转义写法**（跟模板一致）—— 写成真字符就没法用眼睛看见了
    const 转义写 = _读文本(conf_p31).includes('\\u200b\\u200b\\u200b')
    const 回收 = CONTENT.list_trash(spec).some((rec) => rec['种类'] === '开场白')

    const 条 = [初, 改好, 拦尖, 拦空, 没动31, 看出, 拒写回, 补齐, 转义写, 回收]
    if (条.every(pyTruthy)) {
      _print('  31 开场白         ✔ 改一处两处齐 · 标记永远正好 3 个（转义写法）· ' +
        '尖括号/空正文不落盘 · 丢了能补齐 · 旧版进回收站')
    } else {
      ok = false
      _print('  31 开场白         ✗ 初始=' + _T(初) + ' 改=' + _T(改好) + ' 尖=' + _T(拦尖) +
        ' 空=' + _T(拦空) + ' 没动=' + _T(没动31) + ' 看出丢=' + _T(看出) +
        ' 拒写回=' + _T(拒写回) + ' 补齐=' + _T(补齐) + ' 转义=' + _T(转义写) + ' 回收站=' + _T(回收))
    }
  } catch (exc) {
    ok = false
    _print('  31 开场白         ✗ ' + _errMsg(exc))
  }

  // 32. 接手别人的卡 + 不许静默丢改动。
  //     盲跑挖出来的两组「不报错的错」，共同点是都在「照规程做」的路上：
  //       · 只有内容层的工程（import 进来的单张卡）原本**改不了开场白** —— opener 只认界面层、
  //         hud 不肯凭空造界面层、规程又让人别手改，最后只能手抠那三个零宽标记；
  //         而且 `entry --改` 会**把标记一起抹掉还不报**（实测过）。
  //       · 同一条 spec 上并发跑两条写命令：两条各自读到同一份旧内容、各自打印「已改…成功」，
  //         后落盘的那份赢，前一条**静默消失**。AI 一次并发下两条命令就会撞上。
  try {
    const 收 = _join(tmp, '收卡')
    const 卡 = DIST.import_pack(card_path, 收, false, true, _P)
    const 卡spec = _join(卡, 'source', '自检卡.spec.yaml')
    const 没界面 = !_存在(_join(卡, 'hud', 'hud.conf.json'))

    const d = OPENER.读(卡)                        // 内容档：认得出，且说清真源在 spec
    const 认得出 = d['模式'] === '内容' && pyTruthy(d['有开场白']) && pyTruthy(d['条目'])

    const 新 = '凌晨两点十七分，长夜便利店。\n\n自动门「叮」地合上。'
    OPENER.改正文(卡, 新, true, _P)
    const d2 = OPENER.读(卡)
    const lib = ((M.yload(卡spec) || {}).library) || {}
    const 开场条 = (lib['entries'] || []).filter((e) => String(e['kind']) === 'opening')[0]
    const 内容档 = (d2['正文'] === 新 + OPENER.标记 && d2['标记数'] === 3 &&
      开场条['content'] === 新 + OPENER.标记)          // 落盘后读回逐字一致
    const 方案齐 = pyTruthy(开场条['opening_messages']) &&
      (开场条['opening_messages'] || []).every((m) => m['content'] === 开场条['content'])

    let 拦改 = false                                // 开场白正文不走 --改（会静默抹掉标记）
    try {
      CONTENT.set_entry(卡spec, 'AI角色开场白', { content: '硬改' }, _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦改 = true
      else throw e
    }

    const raw = CONTENT.load(卡spec)                // 读了一份之后，文件被别人改过
    // Python 是 `open(p, "a", encoding="utf-8")` —— 文本模式写会把 `\n` 翻成 os.linesep，
    // 在 Windows 上就是 `\r\n`。
    writeFileSync(卡spec, _读文本(卡spec) + '\r\n', 'utf8')
    const 撞前 = _读文本(卡spec)
    let 拦并发 = false
    try {
      CONTENT.commit(卡spec, raw, _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦并发 = true
      else throw e
    }
    const 一字不动 = _读文本(卡spec) === 撞前

    const raw2 = CONTENT.load(卡spec)               // 反例：正常一读一写不许被误拦
    if (!raw2['character']) raw2['character'] = {}
    raw2['character']['nickname'] = '守卫反例'
    let 放行 = false
    try {
      CONTENT.commit(卡spec, raw2, _P)
      放行 = String((((M.yload(卡spec) || {}).character) || {})['nickname'] ?? '').includes('守卫反例')
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 放行 = false
      else throw e
    }

    const 条 = [没界面, 认得出, 内容档, 方案齐, 拦改, 拦并发, 一字不动, 放行]
    if (条.every(pyTruthy)) {
      _print('  32 接手与守卫     ✔ 单卡收进来就能改开场白（内容档，标记自动齐、方案同步）· ' +
        'entry --改 不许碰开场白正文 · 文件被抢改过就拒写且一字不动 · 正常读写不误拦')
    } else {
      ok = false
      _print('  32 接手与守卫     ✗ 没界面=' + _T(没界面) + ' 认得=' + _T(认得出) + ' 内容档=' + _T(内容档) +
        ' 方案齐=' + _T(方案齐) + ' 拦改=' + _T(拦改) + ' 拦并发=' + _T(拦并发) +
        ' 一字不动=' + _T(一字不动) + ' 放行=' + _T(放行))
    }
  } catch (exc) {
    ok = false
    _print('  32 接手与守卫     ✗ ' + _errMsg(exc))
  }

  // 33. 接手一张现成的卡（`new --从`）：界面层照抄骨架，内容层用它的。
  //     「别人给了一张卡」以前是条死路 —— 单张卡收进来只有内容层，没有界面层，
  //     opener 不认、hud 不肯凭空造。这条命令就是那次缺的搬运。顺带守三个静默：
  //       · 非 ElecKoi 卡不许被 unpack「成功」成空工程（宽容解析会让它一路绿灯）；
  //       · 接手失败不许把半成品目录留在盘上（用户会当成建好了）；
  //       · 开场白不许被骨架那句顶掉（桥接曾把它只写进方案，条目正文空着）。
  try {
    const SAMP = _join(HERE, 'samples')
    const 演示卡 = _join(SAMP, '演示卡', '成品', '演示卡.card.json')
    const 酒馆卡 = _join(SAMP, '示例·酒馆V2卡.json')
    const 演示doc = M.yload(_join(SAMP, '演示卡', 'source', '演示卡.spec.yaml')) || {}
    const 源场 = 演示doc['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 骨场 = (M.yload(_join(HERE, 'assets', '骨架', 'source', '骨架.spec.yaml')) || {})
      ['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 净 = (t) => String(t || '').split('\u200b').join('').trim()

    const 搬 = scaffold.new_card('自检搬运', tmp, null, true, null, true, 演示卡)
    const 搬doc = M.yload(_join(搬, 'source', '自检搬运.spec.yaml')) || {}
    const 搬场 = 搬doc['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 有界面 = _是文件(_join(搬, 'hud', 'hud.conf.json'))
    const 条数对 = 搬doc['library']['entries'].length === 演示doc['library']['entries'].length
    const 开场对 = (净(搬场['content']) === 净(源场['content']) &&
      净(搬场['content']) !== 净(骨场['content']))
    const conf = M.jload(_join(搬, 'hud', 'hud.conf.json'))
    const 两处齐 = (conf['开场白']['正文'] === 搬场['content'] &&
      OPENER.尾标记数(搬场['content']) === 3)

    const 酒 = scaffold.new_card('自检酒馆', tmp, null, true, null, true, 酒馆卡)
    const 酒doc = M.yload(_join(酒, 'source', '自检酒馆.spec.yaml')) || {}
    const 酒场 = 酒doc['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 桥接对 = pyTruthy(净(酒场['content'])) && 净(酒场['content']) !== 净(骨场['content'])

    let 拦非卡 = false
    let 没留空 = false
    try {
      pack.unpack(酒馆卡, _join(tmp, '不许出.yaml'))
    } catch {
      拦非卡 = true
      没留空 = !_存在(_join(tmp, '不许出.yaml'))
    }

    let 没残骸 = false
    try {
      scaffold.new_card('自检残骸', tmp, null, true, null, true, _join(tmp, '并没有这张卡.json'))
    } catch {
      没残骸 = !_存在(_join(tmp, '自检残骸'))
    }

    const 坏 = M.yload(_join(SAMP, '演示卡', 'source', '演示卡.spec.yaml'))
    const 坏场 = 坏['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 坏p = _join(tmp, '坏开场.spec.yaml')
    坏场['content'] = ''
    M.jdump(坏, 坏p)
    const 抓到空 = new Set(validate.validate_card(pack.spec_to_card(坏p)).map((i) => i.code))
      .has('OPENING-BLANK')
    坏场['content'] = '与各方案都不一样的一段话'
    M.jdump(坏, 坏p)
    const 抓到漂 = new Set(validate.validate_card(pack.spec_to_card(坏p)).map((i) => i.code))
      .has('OPENING-DRIFT')

    const 条 = [有界面, 条数对, 开场对, 两处齐, 桥接对, 拦非卡, 没留空, 没残骸, 抓到空, 抓到漂]
    if (条.every(pyTruthy)) {
      _print('  33 接手搬运       ✔ 单卡 / 酒馆卡都能连界面层一起建 · 开场白取自来源' +
        '（不是骨架那句）· 非卡不许静默成空工程 · 失败不留残骸 · ' +
        '开场白空/漂移查得出')
    } else {
      ok = false
      _print('  33 接手搬运       ✗ 界面=' + _T(有界面) + ' 条数=' + _T(条数对) + ' 开场=' + _T(开场对) +
        ' 两处齐=' + _T(两处齐) + ' 桥接=' + _T(桥接对) + ' 拦非卡=' + _T(拦非卡) +
        ' 没空工程=' + _T(没留空) + ' 没残骸=' + _T(没残骸) + ' 抓到空=' + _T(抓到空) + ' 抓到漂=' + _T(抓到漂))
    }
  } catch (exc) {
    ok = false
    _print('  33 接手搬运       ✗ ' + _errMsg(exc))
  }
  // 34. 子命令 --help：问一句用法，必须给出**这条命令**的用法，而且一个字都不写盘
  //
  //  以前 `forge.py entry --help` 回的是总表，唯一线索是总表末行那句「去掉参数直接跑」——
  //  没人会去猜那句话，于是「查不到 entry 有哪些参数」成了盲跑里最费劲的一处。
  //
  //  ★ 移植记号：Python 这边起 33 个子进程跑 `forge.py <c> --help`。JS 侧不起子进程
  //  （本机沙箱下 piped stdio 会 EPERM），改成**进程内**调 `main([c, '--help'])`
  //  ＋ `process.chdir(探)`，语义完全一样（子进程那次跑的也正是 `main`）。
  try {
    const 探 = _join(tmp, '_问用法')
    mkdirSync(探, { recursive: true })
    const 前 = _列目录(探)
    const 自文档 = new Set(['domains', 'mods'])   // 这两条没有参数，跑一遍本身就是它的文档
    const 坏 = []
    const 写盘 = []
    const 原cwd = process.cwd()
    try {
      process.chdir(探)
      for (const c of Object.keys(COMMANDS).sort(比串)) {
        let 出文 = ''
        const 原写 = process.stdout.write.bind(process.stdout)
        process.stdout.write = (s) => { 出文 += String(s); return true }
        let rc = 0
        try {
          rc = main([c, '--help'])
        } finally {
          process.stdout.write = 原写
        }
        if (!(rc === 0) || !(自文档.has(c) || 出文.includes('forge.py ' + c))) 坏.push(c)
      }
    } finally {
      process.chdir(原cwd)
    }
    for (const f of _列目录(探)) if (!前.includes(f)) 写盘.push(f)
    if (!坏.length && !写盘.length) {
      _print('  34 子命令用法     ✔ ' + Object.keys(COMMANDS).length +
        ' 条命令的 --help 都给出自己的用法，且一条没写盘')
    } else {
      ok = false
      _print('  34 子命令用法     ✗ 没给出用法的=' + _pyStr(坏) + ' · 写盘的=' + _pyStr(写盘))
    }
  } catch (exc) {
    ok = false
    _print('  34 子命令用法     ✗ ' + _errMsg(exc))
  }

  // 35. 卡名与接管：`--从` 之后名字归新卡 · `name --改` 两处一起动 · 禁用条目看得见改得动
  try {
    const 样卡 = _join(HERE, 'samples', '示例·酒馆V2卡.json')
    const proj2 = scaffold.new_card('接管卡', tmp, null, true, null, true, 样卡)
    const spec2 = _join(proj2, 'source', '接管卡.spec.yaml')
    const conf2 = _join(proj2, 'hud', 'hud.conf.json')

    const _名 = () => String((((M.yload(spec2) || {}).character) || {})['name'] ?? '')
    const _界面名 = () => String(((M.jload(conf2) || {})['卡名']) ?? '')
    const _启 = (r) => ('启用' in r ? r['启用'] : true)

    const 名归新 = (_名() === '接管卡' && _界面名() === '接管卡')
    const 无漂 = !validate.validate_project(proj2).some((i) => i['code'] === 'PROJ-NAME-DRIFT')
    const 禁 = CONTENT.list_entries(spec2).filter((r) => !pyTruthy(_启(r)))
    const 看得见 = pyTruthy(禁)
    if (禁.length) {
      CONTENT.set_entry(spec2, 禁[0]['标题'], { enabled: true }, _P)
    }
    const 改得动 = !CONTENT.list_entries(spec2).some((r) => !pyTruthy(_启(r)))
    scaffold.改卡名(proj2, '改名卡', _P)
    const 两处齐 = (_名() === '改名卡' && _界面名() === '改名卡')
    CONTENT.restore(spec2, '1', _P)
    const 还原回 = (_名() === '接管卡' && _界面名() === '接管卡')
    const 条35 = [名归新, 无漂, 看得见, 改得动, 两处齐, 还原回]
    if (条35.every(pyTruthy)) {
      _print('  35 卡名与接管     ✔ --从 后名字归新卡 · 没有卡名漂移 · 禁用条目列得出也' +
        '改得动 · name 改两处齐 · 回收站连界面配置一起还原')
    } else {
      ok = false
      _print('  35 卡名与接管     ✗ 名归新=' + _T(名归新) + ' 无漂=' + _T(无漂) +
        ' 看得见=' + _T(看得见) + ' 改得动=' + _T(改得动) +
        ' 两处齐=' + _T(两处齐) + ' 还原=' + _T(还原回))
    }
  } catch (exc) {
    ok = false
    _print('  35 卡名与接管     ✗ ' + _errMsg(exc))
  }

  // 36. 变量改名：一次把三处一起挪（面板 / 初值那一格的键 / Zod 那个字段名），
  //     id 不动、顺序不动；撤销能把三处**逐字**还原回原样。
  try {
    const proj3 = scaffold.new_card('改名台', tmp, null, true)
    const spec3 = _join(proj3, 'source', '改名台.spec.yaml')
    CONTENT.add_object(spec3, '面板', '', '', '', _P)
    CONTENT.add_variable(spec3, '面板', '声望', 'number', 5, '', '', _P)

    const _片 = () => {
      const v = ((M.yload(spec3) || {}).variables) || {}
      return [v['initial_state'] || {}, String(v['schema_code'] || '')]
    }
    const 初 = _片()
    const 改前 = String(初[1])
    CONTENT.rename_variable(spec3, '面板.声望', '名望', _P)
    let [st, sc] = _片()
    const 面板格 = st['面板'] || {}
    const 三处 = (_canon(面板格) === _canon({ 名望: 5 }) && sc.includes('名望: z.number()') &&
      !sc.includes('声望') && !('声望' in 面板格))
    const id没换 = ((((CONTENT.load(spec3) || {}).variables) || {})['variables'] || [])
      .filter((x) => x['title'] === '名望' && String(x['id'] || '').startsWith('variable-'))
    const 顺序没乱 = sc === 改前.split('声望').join('名望')   // 只换了名字，别的字节一个没动

    CONTENT.rename_object(spec3, '面板', '状态板', _P)
    ;[st, sc] = _片()
    const 对象齐 = ('状态板' in st && !('面板' in st) && sc.includes('状态板: z.object'))

    let 禁止重名 = false
    try {
      CONTENT.add_variable(spec3, '状态板', '名望', 'string', null, '', '', _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 禁止重名 = true
      else throw e
    }

    CONTENT.restore(spec3, '1', _P)
    CONTENT.restore(spec3, '1', _P)
    ;[st, sc] = _片()
    const 撤得回 = (_canon(st['面板'] || {}) === _canon({ 声望: 5 }) && sc === 改前)

    const 条36 = [三处, pyTruthy(id没换), 顺序没乱, 对象齐, 禁止重名, 撤得回]
    if (条36.every(pyTruthy)) {
      _print('  36 变量改名       ✔ 三处一起挪（面板/初值/Zod）· id 不动 · 顺序没乱 · ' +
        '对象改名同办 · 同层重名拦下 · 撤销逐字还原')
    } else {
      ok = false
      _print('  36 变量改名       ✗ 三处=' + _T(三处) + ' id在=' + _T(pyTruthy(id没换)) +
        ' 顺序=' + _T(顺序没乱) + ' 对象=' + _T(对象齐) + ' 拦重名=' + _T(禁止重名) +
        ' 撤销=' + _T(撤得回))
    }
  } catch (exc) {
    ok = false
    _print('  36 变量改名       ✗ ' + _errMsg(exc))
  }

  // 37. 条目批量：一次落盘、一条回收记录 · 有认不出的名字就**整批停下**（半条最难收拾）
  //     · 删多条再还原，顺序 / 分组 / 启用状态都回得来。
  try {
    const proj3 = _join(tmp, '改名台')
    const spec4 = _join(proj3, 'source', '改名台.spec.yaml')
    CONTENT.add_group(spec4, '甲组', '', _P)
    for (const t of ['甲一', '甲二', '甲三']) {
      CONTENT.add_entry(spec4, t, '', '关键词', '正文 ' + t, ['试'], null, null, _P)
    }
    const 删前 = CONTENT.list_entries(spec4).map((r) => r['标题'])
    const _启 = (r) => ('启用' in r ? r['启用'] : true)

    CONTENT.move_entries(spec4, ['甲一', '甲二', '甲三'], '甲组', _P)
    const 挪齐 = CONTENT.list_entries(spec4).filter((r) => r['标题'].startsWith('甲'))
      .every((r) => r['分组'] === '甲组')
    CONTENT.set_entries_enabled(spec4, ['甲一', '甲二'], false, _P)
    const 停齐 = _canon(CONTENT.list_entries(spec4).filter((r) => !pyTruthy(_启(r)))
      .map((r) => r['标题'])) === _canon(['甲一', '甲二'])

    let 整批停 = false
    let 拦报错 = ''
    try {
      CONTENT.del_entries(spec4, ['甲一', '不存在的条目', '甲二'], _P)
    } catch (e) {
      if (!(e instanceof CONTENT.ContentError)) throw e
      整批停 = _errMsg(e).includes('不存在的条目')
      拦报错 = _errMsg(e)
    }
    const 没动它 = _canon(CONTENT.list_entries(spec4).map((r) => r['标题'])) === _canon(删前)

    CONTENT.del_entries(spec4, ['甲一', '甲二', '甲三'], _P)
    const 真删了 = !CONTENT.list_entries(spec4).some((r) => r['标题'].startsWith('甲'))
    CONTENT.restore(spec4, '1', _P)
    const 栏 = {}
    for (const r of CONTENT.list_entries(spec4)) 栏[r['标题']] = r
    const 回得来 = (_canon(CONTENT.list_entries(spec4).map((r) => r['标题'])) === _canon(删前) &&
      栏['甲一']['分组'] === '甲组' && 栏['甲二']['分组'] === '甲组' &&
      栏['甲一']['启用'] === false && 栏['甲二']['启用'] === false)

    const 条37 = [挪齐, 停齐, 整批停, 没动它, 真删了, 回得来]
    if (条37.every(pyTruthy)) {
      _print('  37 条目批量       ✔ 挪组/启停/删都一次落盘一条记录 · 认不出的名字整批停下' +
        '（一条没动）· 删掉再还原顺序/分组/启用状态全齐')
    } else {
      ok = false
      _print('  37 条目批量       ✗ 挪=' + _T(挪齐) + ' 停=' + _T(停齐) + ' 整批停=' + _T(整批停) +
        ' 没动=' + _T(没动它) + ' 删=' + _T(真删了) + ' 还原=' + _T(回得来) +
        (整批停 ? '' : '｜' + 拦报错))
    }
  } catch (exc) {
    ok = false
    _print('  37 条目批量       ✗ ' + _errMsg(exc))
  }

  // 38. 变量换对象：名字不动，挂靠 / 初值那格 / Zod 那个字段 / 排序**一起搬**，
  //     id 不动；撤销能把这几处**逐字**还原。同对象 / 没这个对象 / 新层重名都拦。
  try {
    const proj3 = _join(tmp, '改名台')
    const spec4 = _join(proj3, 'source', '改名台.spec.yaml')
    const spec5 = spec4
    CONTENT.add_object(spec5, '乙', '', '', '', _P)
    CONTENT.add_variable(spec5, '乙', '金锭', 'number', 3, '', '', _P)
    CONTENT.add_object(spec5, '甲', '', '', '', _P)

    const _变量 = (名) => ((((CONTENT.load(spec5) || {}).variables) || {})['variables'] || [])
      .filter((x) => x['title'] === 名)
    const _对象id = (名) => ((((CONTENT.load(spec5) || {}).variables) || {})['objects'] || [])
      .filter((o) => o['name'] === 名).map((o) => o['id'])
    const _片5 = () => {
      const v = ((M.yload(spec5) || {}).variables) || {}
      return [v['initial_state'] || {}, String(v['schema_code'] || '')]
    }

    const 改前5 = _片5()
    const id前 = String(_变量('声望')[0]['id'])

    let 拦同对象 = false
    let 拦没对象 = false
    try {
      CONTENT.move_variable(spec5, '面板.声望', '面板', _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦同对象 = true
      else throw e
    }
    try {
      CONTENT.move_variable(spec5, '面板.声望', '没有这个对象', _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦没对象 = true
      else throw e
    }
    const 没动38 = _canon(_片5()) === _canon(改前5)   // 两次拦截都不许落盘

    CONTENT.move_variable(spec5, '面板.声望', '甲', _P)
    let [st, sc] = _片5()
    const 挂齐 = (String(_变量('声望')[0]['object_id']) === String(_对象id('甲')[0]) &&
      String(_变量('声望')[0]['id']) === id前)
    const 状态齐 = (_canon(st['甲'] || {}) === _canon({ 声望: 5 }) &&
      !('声望' in (st['面板'] || {})))
    const 紧凑 = sc.split(' ').join('').split('\n').join('')
    const zod齐 = 紧凑.includes('甲:z.object({声望:z.number()})')
    const 顺序齐 = _变量('声望')[0]['order'] === 1   // 甲下本来没变量，排到末尾 = 1

    CONTENT.restore(spec5, '1', _P)
    const 撤得回5 = _canon(_片5()) === _canon(改前5)

    CONTENT.add_variable(spec5, '乙', '声望', 'number', 9, '', '', _P)
    let 拦重名 = false
    try {
      CONTENT.move_variable(spec5, '面板.声望', '乙', _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦重名 = true
      else throw e
    }

    const 条38 = [拦同对象, 拦没对象, 没动38, 挂齐, 状态齐, zod齐, 顺序齐, 撤得回5, 拦重名]
    if (条38.every(pyTruthy)) {
      _print('  38 变量换对象     ✔ 挂靠/初值那格/Zod 那个字段/排序一起搬 · id 不动 · ' +
        '同对象与缺对象当场拦（不落盘）· 新层重名拦下 · 撤销逐字还原')
    } else {
      ok = false
      _print('  38 变量换对象     ✗ 拦同=' + _T(拦同对象) + ' 拦无=' + _T(拦没对象) +
        ' 没动=' + _T(没动38) + ' 挂=' + _T(挂齐) + ' 态=' + _T(状态齐) + ' Zod=' + _T(zod齐) +
        ' 序=' + _T(顺序齐) + ' 撤=' + _T(撤得回5) + ' 重名=' + _T(拦重名))
    }
  } catch (exc) {
    ok = false
    _print('  38 变量换对象     ✗ ' + _errMsg(exc))
  }
  // 41. 条目复制：一次能复制一串（副本**顺在原件后面** · 默认「原名（副本）」· 内容原样 ·
  //     id 全新）· `--到 分组` 能让副本直接落进那个组、不给就跟着原件 ·
  //     认不出的名字整批停下 · 开场白条目不许复制（一张卡只有一条）。
  try {
    const proj3 = _join(tmp, '改名台')
    const spec6 = _join(proj3, 'source', '改名台.spec.yaml')
    CONTENT.add_group(spec6, '复组', '', _P)
    for (const t of ['复一', '复二']) {
      CONTENT.add_entry(spec6, t, '', '关键词', '正文 ' + t, ['试'], null, null, _P)
    }
    const 底 = CONTENT.list_entries(spec6).length

    CONTENT.dup_entries(spec6, ['复一', '复二'], null, '复组', _P)
    const 列 = CONTENT.list_entries(spec6)
    const 名 = 列.map((r) => r['标题'])
    const 栏 = {}
    for (const r of 列) 栏[r['标题']] = r
    const 复制齐 = (列.length === 底 + 2 &&
      '复一（副本）' in 栏 && '复二（副本）' in 栏 &&
      栏['复一（副本）']['分组'] === '复组' &&
      栏['复二（副本）']['分组'] === '复组' &&
      名.indexOf('复一（副本）') === 名.indexOf('复一') + 1 &&
      名.indexOf('复二（副本）') === 名.indexOf('复二') + 1 &&
      栏['复一（副本）']['字数'] === 栏['复一']['字数'] &&
      new Set(列.map((r) => r['id'])).size === 列.length)

    // 不给 --到：副本跟着原件待在同一个组（原件在未分组，副本也在未分组）
    CONTENT.dup_entries(spec6, ['复一'], '复一·另一版', null, _P)
    const 栏2 = {}
    for (const r of CONTENT.list_entries(spec6)) 栏2[r['标题']] = r
    const 跟原件 = (栏2['复一·另一版']['分组'] === 栏2['复一']['分组'] &&
      栏2['复一']['分组'] !== '复组')

    // 认不出的名字：整批停下，一条副本都不加
    const 停 = CONTENT.list_entries(spec6).length
    let 整批停41 = false
    try {
      CONTENT.dup_entries(spec6, ['复一', '根本没有这条'], null, null, _P)
    } catch (e) {
      if (!(e instanceof CONTENT.ContentError)) throw e
      整批停41 = _errMsg(e).includes('根本没有这条')
    }
    const 没多 = CONTENT.list_entries(spec6).length === 停

    // 开场白不许复制
    let 拦开场 = false
    try {
      CONTENT.dup_entries(spec6, ['AI角色开场白'], null, null, _P)
    } catch (e) {
      if (!(e instanceof CONTENT.ContentError)) throw e
      拦开场 = _errMsg(e).includes('开场白')
    }

    const 条41 = [复制齐, 跟原件, 整批停41, 没多, 拦开场]
    if (条41.every(pyTruthy)) {
      _print('  41 条目复制       ✔ 一次复制一串（副本顺在原件后面 · 内容原样 · id 全新）' +
        '· --到 分组 能让副本落进那个组 · 认不出的名字整批停下 · 开场白不许复制')
    } else {
      ok = false
      _print('  41 条目复制       ✗ 复制齐=' + _T(复制齐) + ' 跟原件=' + _T(跟原件) +
        ' 整批停=' + _T(整批停41) + ' 没多=' + _T(没多) + ' 拦开场=' + _T(拦开场))
    }
  } catch (exc) {
    ok = false
    _print('  41 条目复制       ✗ ' + _errMsg(exc))
  }

  // 42. 沙箱友好模式：把 os.replace / os.remove / shutil.rmtree 全换成炸弹
  //     （模拟受限令牌沙箱里的 WinError 5），再把「开新卡 → 加条目 → 出成品 → 验卡」
  //     整条走一遍。**全程一次都不许碰到那三个** —— 碰到，就说明还有地方在依赖「删 / 改名」，
  //     而那条路（ElecKoi 里的 AI 直接跑 forge.py）会在那一步挂掉。
  //
  //  ★ 移植记号：Python 这里是把 `os.replace` / `os.remove` / `shutil.rmtree` 三个模块属性
  //  换成炸弹函数；JS 侧 ESM 的具名导入没法在外部替换，而**所有文件落盘在 JS 侧本来就
  //  统一走 `SB.land` / `SB.rename` / `SB.remove` / `SB.rmtree`** —— 沙箱模块本身就是那一层，
  //  所以这里只留 `SB.enable(true)`（打开后上面四个一律拒绝）。语义等价，少一层猴子补丁。
  try {
    const 沙箱根 = _join(tmp, '沙箱试')
    mkdirSync(沙箱根, { recursive: true })
    let 过沙箱 = false
    let 正文回 = ''
    let 沙箱错 = []
    SB.enable(true)
    try {
      const proj2 = scaffold.new_card('沙箱卡', 沙箱根, null, true)
      const spec2 = _join(proj2, 'source', '沙箱卡.spec.yaml')
      CONTENT.add_entry(spec2, '沙箱条目', '', '关键词', '沙箱里写下的正文', ['沙箱'], null, null, _P)
      const card2 = _join(proj2, '成品', '沙箱卡.card.json')
      pack.build(spec2, card2)
      沙箱错 = validate.validate_card(M.jload(card2), '沙箱').filter((i) => i['level'] === 'ERROR')
      正文回 = CONTENT.entry_detail(spec2, '沙箱条目')['正文']
      过沙箱 = (正文回 === '沙箱里写下的正文' && !沙箱错.length)
    } finally {
      SB.enable(false)
    }
    if (过沙箱) {
      _print('  42 沙箱友好模式    ✔ 不许删 / 不许改名时：开新卡 + 加条目 + 出成品' +
        ' 全程用不到 os.replace / os.remove / rmtree')
    } else {
      ok = false
      _print('  42 沙箱友好模式    ✗ 正文回读=' + pyRepr(正文回) + ' 卡片错误=' + 沙箱错.length)
    }
  } catch (exc) {
    ok = false
    _print('  42 沙箱友好模式    ✗ ' + _errMsg(exc))
  }

  // 43. 规程取节：目录里列出的**每一节 / 每一篇 / 每一对话段**都要能真取到、且不是空的。
  //     这是给 ElecKoi 里的 AI 自己取知识用的（`guide`）—— 目录说有的、取不到，
  //     AI 只会以为规程就这么多，然后照着半份知识做卡。**静默地少给**是最坏的一种错。
  //     负向两侧：认不出的名字要拦；撞名的（两篇同前缀）要报「不止一个」而不是挑一个。
  try {
    const 取错43 = []
    const 取空43 = []
    for (const [标题] of COACH._规程段()) {
      try {
        if (lenPy(COACH.取节(标题)) <= lenPy(标题)) 取空43.push('节 ' + 标题)
      } catch (e) {
        if (!(e instanceof COACH.KeyError)) throw e
        取错43.push('节 ' + 标题)
      }
    }
    for (const 标题 of Object.keys(COACH.方法论)) {
      try {
        if (lenPy(COACH.取篇(标题)) <= lenPy(标题)) 取空43.push('篇 ' + 标题)
      } catch (e) {
        if (!(e instanceof COACH.KeyError)) throw e
        取错43.push('篇 ' + 标题)
      }
    }
    for (const 标题 of Object.keys(COACH.对话段)) {
      try {
        if (lenPy(COACH.取对话(标题)) <= lenPy(标题)) 取空43.push('段 ' + 标题)
      } catch (e) {
        if (!(e instanceof COACH.KeyError)) throw e
        取错43.push('段 ' + 标题)
      }
    }
    let 拦了43 = 0
    for (const 怪名 of ['第四十节', '这一节不存在']) {
      try {
        COACH.取节(怪名)
      } catch (e) {
        if (!(e instanceof COACH.KeyError)) throw e
        拦了43 += 1
      }
    }
    try {
      COACH.取篇('机制')            // 方法论里两篇同前缀：要报「不止一个」，不许挑
    } catch (e) {
      if (!(e instanceof COACH.KeyError)) throw e
      拦了43 += 1
    }
    const 目录43 = COACH.目录()
    const 有头43 = ['## 节', '## 篇', '## 对话段'].every((k) => 目录43.includes(k))
    if (!取错43.length && !取空43.length && 拦了43 === 3 && 有头43) {
      _print('  43 规程取节       ✔ 目录里每一节/每一篇/每一对话段都真取得到；' +
        '认不出的名字与撞名的都当场拦')
    } else {
      ok = false
      _print('  43 规程取节       ✗ 取不到=' + _pyStr(取错43) + ' 取空=' + _pyStr(取空43) +
        ' 该拦的只拦了' + 拦了43 + '/3 目录有头=' + _T(有头43))
    }
  } catch (exc) {
    ok = false
    _print('  43 规程取节       ✗ ' + _errMsg(exc))
  }

  // 44. 卡稿落卡：一份稿子 -> 一张卡。
  //     盯的是「一次落成」的三条命根子：
  //       · 改 / 建 / 删 都对（同名即改、无名即建、说删就删，清空只清没提到的）
  //       · 稿子有毛病时**目标位置一个字都不写** —— 这是这个命令存在的理由
  //       · 目标已有工程（不给 --覆盖）与别人的目录（给了也不给）都不许乱盖
  //     顺带钉住「落出来的卡真能过体检」与「开场白末尾那三个零宽标记跟着走完这一趟」——
  //     落得成但卡是坏的、或者建卡界面悄悄不见了，都等于没落。
  try {
    const 根44 = mkdtempSync(_join(tmpdir(), 'forge_st44_'))
    const 稿44 = _join(根44, '稿.yaml')
    M.jdump({
      卡名: '自检卡44',
      清空条目: true,
      分组: ['甲组'],
      条目: [
        { 标题: '核心 · 世界总纲', 正文: '改过的总纲' },              // 骨架有 -> 改
        {                                                        // 没有 -> 建
          标题: '甲组 · 一条', 模板: '关键词', 分组: '甲组',
          关键词: ['甲', '乙'], 提示: '问起甲乙时读这条', 正文: '……',
        },
      ],
      变量: [{ 对象: '玩家', 名: '自检数', 类型: 'number', 初值: 1 }],
      正则: [{ 名: '自检正则', 模式: '【(.*?)】', 替换: '「$1」' }],
      开场白: '自检开场白。',
    }, 稿44)
    const 库44 = _join(根44, '库')
    const r44 = DRAFT.落卡(稿44, 库44, false, false, false, _P)
    const 坑44 = []
    if (!(r44['条目改'] === 1 && r44['条目新'] === 1 && r44['条目删'] === 3)) {
      坑44.push('改/新/删 该是 1/1/3，实际 ' + r44['条目改'] + '/' + r44['条目新'] + '/' + r44['条目删'])
    }
    if (!(r44['变量'] === 1) || !(r44['正则'] === 1) || !pyTruthy(r44['开场白'])) {
      坑44.push('变量 ' + r44['变量'] + ' / 正则 ' + r44['正则'] + ' / 开场白 ' + _T(r44['开场白']))
    }
    if (pyTruthy(r44['错误'])) {
      坑44.push('落出来的卡有 ' + r44['错误'].length + ' 个错')
    }
    if (!_是文件(r44['成品'])) {
      坑44.push('成品没落出来')
    }
    if (OPENER.读(r44['工程'])['标记数'] !== 3) {
      坑44.push('开场白末尾的零宽标记不是 3 个')
    }

    // `make --模板` 给的那份骨架**自己必须跑得通** —— 空手想 YAML 的键名最容易卡壳，
    // 而「说了有模板、模板却是坏的」是最气人的一种。
    const 模44 = _join(根44, '模板.yaml')
    // Python 是 `open(模44, "w", encoding="utf-8")` —— 文本模式把每个 `\n` 翻成 os.linesep
    writeFileSync(模44, DRAFT.卡稿模板().split('\n').join('\r\n'), 'utf8')
    const r模44 = DRAFT.落卡(模44, _join(根44, '模板库'), false, false, false, _P)
    if (pyTruthy(r模44['错误'])) {
      坑44.push('模板自己跑出来的卡有 ' + r模44['错误'].length + ' 个错')
    }
    if (!_是文件(r模44['成品'])) {
      坑44.push('模板自己没跑出成品')
    }

    // 负向一：稿子有毛病 -> 目标位置一个字都不许写
    const 坏44 = _join(根44, '坏.yaml')
    M.jdump({ 卡名: '坏卡44', 条目: [{ 标题: '甲', 模板: '没这个档' }] }, 坏44)
    const 坏库44 = _join(根44, '坏库')
    try {
      DRAFT.落卡(坏44, 坏库44, false, false, false, _P)
      坑44.push('坏稿竟然没被拦下')
    } catch (e) {
      if (!(e instanceof DRAFT.DraftError)) throw e
      if (_存在(_join(坏库44, '坏卡44'))) {
        坑44.push('坏稿被拦下了，可目标位置还是被写了东西')
      }
    }
    // 负向二：目标已有一份工程，不给 --覆盖 就该停
    try {
      DRAFT.落卡(稿44, 库44, false, false, false, _P)
      坑44.push('目标已存在时竟然没拦')
    } catch (e) {
      if (!(e instanceof DRAFT.DraftError)) throw e
    }
    // 负向三：那一层住着别人的东西 -> 连 --覆盖 都不许盖
    const 别人44 = _join(根44, '别人的库', '自检卡44', 'source')
    mkdirSync(别人44, { recursive: true })
    writeFileSync(_join(别人44, '别人的.spec.yaml'), '', 'utf8')
    try {
      DRAFT.落卡(稿44, _join(根44, '别人的库'), false, false, true, _P)
      坑44.push('别人的目录竟然被盖了')
    } catch (e) {
      if (!(e instanceof DRAFT.DraftError)) throw e
    }
    if (!坑44.length) {
      _print('  44 卡稿落卡       ✔ 一份稿子一次落成一张卡（改 1 / 建 1 / 删 3）；' +
        '坏稿在动手前就被拦下、目标位置一个字没写；别人的目录不给盖')
    } else {
      ok = false
      _print('  44 卡稿落卡       ✗ ' + 坑44.join('；'))
    }
  } catch (exc) {
    ok = false
    _print('  44 卡稿落卡       ✗ ' + _errMsg(exc))
  }

  // 45. 示例卡稿 + 「改已有条目」那两条容易静默的路。
  //     三件事，全是「不报错但结果不对」的那一类：
  //       · `make --示例` 打出来的那份**必须自己就是一张绿卡** —— 它是给人照抄的，
  //         样板自己跑不通比没有样板更坏（照抄的每一条都撞墙）。
  //       · 稿子里给**已有条目**写「模板:」不许崩（模板表里带着 kind，set_entry 不收身份）。
  //       · 稿子里给**已有条目**写「分组:」要真的挪过去 —— 早先这里默默忽略，
  //         稿子写了「分组: 角色」，条目纹丝不动，一个字都不报。
  //     顺带：变量跟骨架里现成的重名，得是一句人话，不能是 traceback。
  try {
    const 根45 = mkdtempSync(_join(tmpdir(), 'forge_st45_'))
    const 库45 = _join(根45, '库')

    // 示例卡稿：原样落一遍，必须是绿卡
    const 示45 = _join(根45, '示例.yaml')
    // Python 这边点名 `newline="\n"` —— **不翻译**换行
    writeFileSync(示45, DRAFT.卡稿示例(), 'utf8')
    const r45 = DRAFT.落卡(示45, 库45, false, false, false, _P)
    const 坑45 = []
    if (pyTruthy(r45['错误']) || pyTruthy(r45['落点错误'])) {
      坑45.push('示例卡稿落出来的卡有错：' +
        ((r45['错误'] || []).concat(r45['落点错误'] || [])).join('；').slice(0, 120))
    }
    if (!_是文件(r45['成品'])) {
      坑45.push('示例卡稿没落出成品')
    }
    if (OPENER.读(r45['工程'])['标记数'] !== 3) {
      坑45.push('示例卡稿的开场白末尾零宽标记不是 3 个')
    }

    // 已有条目 + 模板 / 分组：换档到「关键词」并把骨架那条世界总纲挪进自建分组
    const 改45 = _join(根45, '改.yaml')
    M.jdump({
      卡名: '自检卡45',
      分组: ['新家'],
      条目: [
        {
          标题: '核心 · 世界总纲', 模板: '关键词', 分组: '新家',
          关键词: ['甲', '乙'], 提示: '问起甲乙时读这条', 正文: '换过档的总纲',
        },
        { 标题: '规则 · 判定', 模板: '常驻', 正文: '换成常驻的判定' },
      ],
    }, 改45)
    const r改45 = DRAFT.落卡(改45, 库45, false, false, false, _P)
    if (pyTruthy(r改45['错误'])) {
      坑45.push('改已有条目落出来的卡有错：' + r45['错误'].join('；').slice(0, 120))
    }
    const spec45 = DRAFT._找规格(r改45['工程'])
    const raw45 = CONTENT.load(spec45)
    const 栏45 = {}
    for (const e of CONTENT.entries_of(raw45, true)) 栏45[e['title']] = e
    const 组45 = {}
    for (const g of CONTENT.groups_of(raw45)) 组45[g['id']] = g['name']
    const 总纲 = 栏45['核心 · 世界总纲'] || {}
    const 判定 = 栏45['规则 · 判定'] || {}
    if (组45[总纲['group_id']] !== '新家') {
      坑45.push('「分组:」没把已有条目挪过去（它还在 ' + pyRepr(组45[总纲['group_id']]) + '）')
    }
    if (总纲['agent_read_strategy'] !== 'keyword') {
      坑45.push('给已有条目换档没生效（策略还是 ' + pyRepr(总纲['agent_read_strategy']) + '）')
    }
    if (总纲['content'] !== '换过档的总纲') {
      坑45.push('给已有条目改正文没生效')
    }
    if (判定['trigger_mode'] !== 'always' || !String(判定['position'] || '').trim()) {
      坑45.push('已有条目换档到常驻后没补插入位置（' + pyRepr(判定['trigger_mode']) + ' / ' +
        pyRepr(判定['position']) + '）')
    }

    // 变量与骨架里的重名：要给一句人话（DraftError），不是 traceback
    const 重45 = _join(根45, '重名.yaml')
    M.jdump({
      卡名: '自检卡45重名',
      变量: [{ 对象: '玩家', 名: '等级', 类型: 'number', 初值: 9 }],
    }, 重45)
    try {
      DRAFT.落卡(重45, 库45, false, false, false, _P)
      坑45.push('变量跟骨架重名竟然落了进去')
    } catch (e) {
      if (!(e instanceof DRAFT.DraftError)) {           // ContentError / 其它都不行
        坑45.push('变量重名抛的是 ' + (e && e.constructor ? e.constructor.name : typeof e) +
          '，不是能读的 DraftError')
      }
    }

    if (!坑45.length) {
      _print('  45 示例卡稿       ✔ 一份 3.8k 字的完整示例自己就是绿卡；给已有条目' +
        '换档 / 改正文 / 挪分组都真的落下去；变量重名给人话不抛栈')
    } else {
      ok = false
      _print('  45 示例卡稿       ✗ ' + 坑45.join('；'))
    }
  } catch (exc) {
    ok = false
    _print('  45 示例卡稿       ✗ ' + _errMsg(exc))
  }

  _print('-'.repeat(74))
  _print('结论：' + (ok ? '全绿 ✔' : '有失败 ✗'))
  _print('（临时工程在 ' + tmp + '，看完可删）')
  return ok ? 0 : 1
}
/** `forge.py:940` `_常驻字数` —— 一张卡里「每轮都要注入」的字数。 */
export function _常驻字数(卡) {
  const lib = pack.active_library(卡) || {}
  let 总 = 0
  for (const e of (lib.entries || [])) {
    if (String(e.trigger_mode || '') === 'always' && String(e.kind || 'normal') === 'normal') {
      总 += lenPy(String(e.content || ''))
    }
  }
  return 总
}

/** `forge.py:2470` `_fresh_snapshot` —— 撤模块的验收靠它。 */
export function _fresh_snapshot(spec_path) {
  const spec = M.yload(spec_path) || {}
  const lib = spec.library || {}
  const entries = (lib.entries || []).map((e) => [
    String(e.id || ''), String(e.title || ''),
    lenPy(String(e.content || '')), String(e.agent_read_strategy || ''),
  ])
  entries.sort(_比元组)
  const rules = (spec.regex_rules || []).map((r) => String(r.id || ''))
  rules.sort(比串)
  return { 条目: entries.length, 条目明细: entries, 正则: rules.length, 正则明细: rules }
}

/** `forge.py:2486` `_canon_pair` —— 比语义：忽略键顺序、忽略空白。 */
export function _canon_pair(a, b) { return _canon(_scrub(a)) === _canon(_scrub(b)) }

/**
 * `forge.py:2491` `_scrub` —— 去掉与语义无关的易变字段（时间戳）。
 *
 * 卡里 `setting_library` / `variable_config` 是嵌套的 JSON **字符串**，光在顶层 dict
 * 上删键不够 —— 得先把它当 JSON 解析开再往里删。
 */
export function _scrub(obj) {
  if (Array.isArray(obj)) return obj.map((v) => _scrub(v))
  if (obj !== null && typeof obj === 'object') {
    const 出 = {}
    for (const [k, v] of Object.entries(obj)) {
      if (['created_at', 'updated_at', 'updatedAt', 'config_updated_at'].includes(k)) continue
      出[k] = _scrub(v)
    }
    return 出
  }
  if (typeof obj === 'string' && (obj.slice(0, 1) === '{' || obj.slice(0, 1) === '[')) {
    try { return _scrub(JSON.parse(obj)) } catch { return obj }
  }
  return obj
}

// ------------------------------------------------------------------ 分发
// `forge.py:3024` 起：命令表 + `_打命令用法` + `main` + `if __name__ == "__main__"`。
export const COMMANDS = {
  new: cmd_new, name: cmd_name,
  unpack: cmd_unpack, build: cmd_build, check: cmd_check,
  hud: cmd_hud, bundle: cmd_bundle, import: cmd_import,
  analyze: cmd_analyze, 'to-eleckoi': cmd_to_eleckoi, 'to-tavern': cmd_to_tavern,
  png: cmd_png, preset: cmd_preset, plan: cmd_plan, lint: cmd_lint,
  manual: cmd_manual, index: cmd_index, coach: cmd_coach, guide: cmd_guide,
  make: cmd_make,
  mods: cmd_mods, add: cmd_add, drop: cmd_drop,
  entry: cmd_entry, group: cmd_group, var: cmd_var, regex: cmd_regex,
  opener: cmd_opener,
  trash: cmd_trash,
  theme: cmd_theme,
  diff: cmd_diff,
  domains: cmd_domains, selftest: cmd_selftest,
}


// 裸跑会真干活（写盘 / 跑整轮自检）的命令 —— 问用法时不能真把它们跑起来
export const _问用法别跑 = new Set(['coach', 'selftest'])


/** `forge.py:_打命令用法` —— `python forge.py <命令> --help` 的出口。 */
export function _打命令用法(cmd) {
  if (_问用法别跑.has(cmd)) {
    _print(`用法：python forge.py ${cmd}（直接跑即可，参数见下面总表里那一行）`)
    _print('')
    _print(HELP)
    return 0
  }
  try {
    COMMANDS[cmd]([])
  } catch (exc) {              // 空参就报参数的，把话原样带出来
    if (exc instanceof ArgError) _print(`!! ${_错话(exc)}`)
    else throw exc
  }
  return 0
}


/** Python 的 `os.environ.get("FORGE_TRACEBACK")`。 */
function _要栈() {
  return pyTruthy(process.env.FORGE_TRACEBACK)
}


/** 这个异常该「打一行」还是「照旧炸」—— 对齐 `forge.py:3099` 那两行判据。 */
function _自带一行(exc) {
  const 名 = String((exc && exc.constructor && exc.constructor.name) || '')
  const 是自带 = 名.endsWith('Error') && exc instanceof Error && ![
    'TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'URIError',
    'EvalError', 'AggregateError', 'Error',
  ].includes(名)
  const 是内置 = exc instanceof RangeError
    || (exc instanceof TypeError && /^(?:-\d+|NaN)$/.test(String((exc && exc.code) !== undefined ? exc.code : '')))
    || (exc instanceof Error && ['ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE',
      'ERR_OUT_OF_RANGE', 'ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'ENOTEMPTY',
      'EEXIST', 'EBUSY', 'EMFILE', 'ENOSPC', 'ENAMETOOLONG', 'EROFS', 'EXDEV', 'UNKNOWN']
      .includes(String((exc && exc.code) !== undefined ? exc.code : '')))
  return 是自带 || 是内置
}


/**
 * 把 Node 的 fs 错误翻成 CPython 的 `OSError` 说法（**移植记号**）。
 *
 * `forge.py` 里 `open(路径)` 失败时，`main` 打的是
 *   `!! FileNotFoundError: [Errno 2] No such file or directory: '并不存在.json'`
 * —— 文件名是**调用时给的那个字符串**（相对就相对）。Node 给的是
 *   `Error: ENOENT: no such file or directory, open '<绝对路径>'`
 * ⇒ 类名、errno 说法、路径三样都得翻。路径优先用**命令行原样那一段**
 * （拿 `_abspath` 两边比一遍，比中就用原字符串），对不上才退回 `err.path`。
 *
 * 只收 CPython 在 Windows 上真会用的那几个 errno；`[WinError N] …` 那一族
 * （`os.remove` / `os.rename` 走 Win32 API 时才会出现）**本层不管**，见 `draft.mjs`
 * 里硬抄的三条先例。
 */
/** 当前这次 `main()` 的参数（错误话里拿它把绝对路径还原成用户原样那一段）。 */
let _当前参 = []


const _OS表 = {
  ENOENT: { 名: 'FileNotFoundError', errno: 2, 文: 'No such file or directory' },
  EACCES: { 名: 'PermissionError', errno: 13, 文: 'Permission denied' },
  EPERM: { 名: 'PermissionError', errno: 13, 文: 'Permission denied' },
  EEXIST: { 名: 'FileExistsError', errno: 17, 文: 'File exists' },
  ENOTDIR: { 名: 'NotADirectoryError', errno: 20, 文: 'Not a directory' },
  EISDIR: { 名: 'IsADirectoryError', errno: 21, 文: 'Is a directory' },
  ENOTEMPTY: { 名: 'OSError', errno: 39, 文: 'Directory not empty' },
  EBUSY: { 名: 'OSError', errno: 16, 文: 'Device or resource busy' },
  EMFILE: { 名: 'OSError', errno: 24, 文: 'Too many open files' },
  ENOSPC: { 名: 'OSError', errno: 28, 文: 'No space left on device' },
  EROFS: { 名: 'OSError', errno: 30, 文: 'Read-only file system' },
  EXDEV: { 名: 'OSError', errno: 18, 文: 'Invalid cross-device link' },
  ENAMETOOLONG: { 名: 'OSError', errno: 36, 文: 'File name too long' },
}


/** Python `str(exc)` 那一句：OSError 型的 Node 错误翻成 CPython 说法，其余原样。 */
function _错话(exc) {
  const 翻 = _python化(exc, _当前参)
  if (翻) return 翻.话
  return exc && exc.message !== undefined ? String(exc.message) : String(exc)
}


function _python化(exc, 候选) {
  const 码 = _OS表[String((exc && exc.code) !== undefined ? exc.code : '')]
  if (!码) return null
  let 路 = (exc && exc.path !== undefined && exc.path !== null) ? String(exc.path) : null
  if (路 !== null) {
    for (const a of (候选 || [])) {
      if (typeof a !== 'string') continue
      if (_abspath(a) === _abspath(路)) {
        路 = a
        break
      }
    }
  }
  return { 名: 码.名, 话: `[Errno ${码.errno}] ${码.文}${路 === null ? '' : `: '${路}'`}` }
}


export function main(argv = null) {
  let 余 = (argv === null || argv === undefined ? process.argv.slice(2) : argv).slice()
  // `--沙箱`（或 FORGE_SANDBOX=1）：沙箱友好模式 —— 只创建、只覆盖，不删文件、不改名。
  // 给「ElecKoi 里的 AI 直接跑 forge.py」那条路用的，见 forge/sandbox.py 顶上那段。
  余 = SB.take_flag(余)
  if (SB.enabled()) {
    _print(`· ${SB.note()}`)
  }
  if (!余.length || ['-h', '--help', 'help'].includes(余[0])) {
    _print(HELP)
    return 0
  }
  const cmd = 余[0]
  const rest = 余.slice(1)
  _当前参 = rest
  if (!(cmd in COMMANDS)) {
    _print(`认不得的命令：${cmd}\n`)
    _print(HELP)
    return 2
  }
  // `forge.py new --help` 这种：以前会把 `--help` 当成卡名，在工具自己目录里建出一个
  // 叫「--help」的工程 —— 没人会想到「问一句用法」竟然会写盘。统一拦在这里，
  // 并把这一问**转给该命令自己**回答（见 `_打命令用法`）。
  if (rest.some((a) => a === '-h' || a === '--help')) {
    return _打命令用法(cmd)
  }
  try {
    return COMMANDS[cmd](rest)
  } catch (exc) {
    if (exc instanceof ArgError) {
      _print(`!! ${_错话(exc)}`)
      return 2
    }
    // **谁该打栈、谁该打一行。** 本工具自定义的错误类（ContentError / HudError /
    // OpenerError / DistError …）以及「内容或来源不对」型的 ValueError / RuntimeError /
    // OSError，说的都是「这事现在办不了」，一句人话就够 —— 栈只会把原因埋掉。
    // 反过来，KeyError / TypeError / AttributeError 那种是**代码自己的 bug**，照旧炸。
    // 调试时想看栈：设 FORGE_TRACEBACK=1。
    if (_要栈()) throw exc
    if (!_自带一行(exc)) throw exc
    const 翻 = _python化(exc, _当前参)
    const 名 = 翻 ? 翻.名 : String((exc && exc.constructor && exc.constructor.name) || 'Error')
    const 话 = 翻 ? 翻.话 : (exc && exc.message !== undefined ? exc.message : '')
    _print(`!! ${名}: ${话}`)
    _print('   （不是崩溃 —— 上面那句就是原因。想看调用栈：设 FORGE_TRACEBACK=1）')
    return 2
  }
}


// `if __name__ == "__main__": sys.exit(main())`
// 被 `cli.mjs` 动态 import 时 `process.argv[1]` 是本文件 ⇒ 会自跑；那一层要的是
// **不要**自跑，所以 cli.mjs 走的是 `--入口=cli` 那条路（见 cli.mjs 头注）。
export function _自跑() {
  const 我 = fileURLToPath(import.meta.url)
  const 主 = process.argv[1] ? resolve(process.argv[1]) : ''
  if (主 && _normpath(主) === _normpath(我)) {
    process.exitCode = main()
  }
}

_自跑()