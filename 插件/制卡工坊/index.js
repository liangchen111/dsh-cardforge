/**
 * 制卡工坊 · 宿主插件（Host plugin）
 * ====================================
 *
 * 干一件事：**给 ElecKoi 里的 AI 一个叫 `cardforge` 的工具**，用它跑本机的
 * `forge.py`（做卡的全套命令）。
 *
 * 为什么非得是「宿主插件」而不是让 AI 用自带的命令行工具？
 *   ElecKoi 的 `dsh-tool-pwsh` 跑在**受限令牌沙箱**里：能读、能写，但
 *   **不许删、不许改名**（实测 `WinError 5`）。而 forge.py 每一次落盘都靠改名
 *   （`content.commit()` 的 `os.replace`、`new` 的 `os.rename`、回收站是「移动」）。
 *   宿主机进程是普通权限的 node，`child_process.spawn` 出来的子进程**不受那层沙箱管**
 *   —— 于是原子落盘、改名、删除全都回来了。
 *
 * 形状照官方 `@deepseek-ai/dsh-tool-present` 抄（那是官方最小的「注册一个工具」范例）：
 *   `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`
 * 注册即生效 —— 官方文档原话：「注册一个工具就足以让它可见，注册表会自动把其
 * schema 送入系统提示词组装」。
 *
 * 只依赖 `@deepseek-ai/dsh-tools`（宿主插件可用的服务）。**不声明任何 dependencies**
 * —— 官方约定：随 dsh 一起发的包从 dsh 安装处解析。
 *
 * 第二件顺手做的事：**装插件时把「制卡助手」创作预设装进 ElecKoi**（`装预设`）。
 * 用户在预设管理器里手动导一次也成，但那样得先找到 PNG 再点「导入 → 创作预设」，
 * 装插件还要多三步 —— 能自动就自动。做法＝ElecKoi 开的 `eleckoiAgentPresetsApi`
 * （`catalog` / `import` / `setActive`），只在「还没有这个预设」时才写、只在
 * 「当前还是官方默认创作预设」时才切，任何失败都只记日志、不影响 `cardforge` 工具。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 稳定标识（Loader 用它认插件）。 */
export const name = 'cardforge'

/**
 * 出厂默认值 —— **不含任何本机路径**。
 *
 * - 解释器：**留空＝自己找**（见 `找解释器`）。装 DSH/ElecKoi 的地方不一定有
 *   `PATH` 里的 `python`，写死一个名字就会 `spawn python ENOENT` —— 实测踩过。
 * - 依赖目录：留空＝不动 `PYTHONPATH`（记成 `pythonPath` 的人是拿 venv 的
 *   site-packages 喂基础解释器用的，用不上就别填）。
 * - `forge.py`：**自动认** —— 这个插件住在仓库的 `插件/制卡工坊/` 下，
 *   往上两级就是仓库根，`forge.py` 就在那儿。
 */
const 插件目录 = dirname(fileURLToPath(import.meta.url))
const 默认解释器 = ''
const 默认依赖目录 = ''
const 默认工具 = resolve(插件目录, '..', '..', 'forge.py')

/**
 * 没给工作目录时卡做在哪儿 —— **`<你的用户目录>/Documents/ElecKoi卡库`**。
 *
 * 为什么不写死一个盘：别人的机器上不一定有那个盘。放 `Documents` 下是 Windows 上
 * 「用户自己的文档」的通用位置，跨机器都成立；调用方给了 `cwd` 参数就听调用方的。
 */
const 卡库目录 = join(String(process.env.USERPROFILE ?? process.env.HOME ?? process.cwd()), 'Documents', 'ElecKoi卡库')

/** 定工作目录：调用方参数 > 插件配置 > 卡库默认。 */
function 定工作目录(配置, 参数cwd) {
  return String(参数cwd ?? '').trim() || String(配置?.cwd ?? '').trim() || 卡库目录
}

/**
 * 只读命令：看一眼、读一段、体检一下，**不往盘上写任何东西**。
 *
 * 为它们建目录是多余的动作，更要紧的是：`Documents` 被 OneDrive 重定向、盘设成只读
 * 之类的情况下，`mkdirSync` 会抛 —— 那时候连「看一眼规程」都做不了才叫冤。
 */
const 只读命令 = new Set(['--help', '-h', '--h', '--version', '--版本', 'guide', 'manual', 'check', 'lint'])

/**
 * 把「一整条命令」拆成参数数组。
 *
 * 为什么要有这个兜底：**没人会记命令行语法**。用户会直接说一句「make E:/卡库/我的卡.yaml」，
 * 模型也可能顺手把整条命令塞进 `args` 的一个元素里。与其让调用失败，不如替他拆开。
 * 规矩：空白分隔，但引号里的不拆（单双引号都认，剥掉外壳）。
 */
function 拆命令(项) {
  const 出 = []
  let 当前 = ''
  let 引号 = null
  for (const ch of String(项)) {
    if (引号) {
      if (ch === 引号) 引号 = null
      else 当前 += ch
      continue
    }
    if (ch === '"' || ch === "'") { 引号 = ch; continue }
    if (/\s/.test(ch)) {
      if (当前) { 出.push(当前); 当前 = '' }
      continue
    }
    当前 += ch
  }
  if (当前) 出.push(当前)
  return 出
}

/**
 * 定 `args`：空的当问路；只有一项且「像一整条命令」的，替它拆开。
 *
 * 「像一整条命令」的判据：里面有空白，且拆出来的第一个词是 ASCII 单词（`make` / `new` /
 * `entry` …）或以 `-` 开头。这一条把「单个带空格的名字」挡在外面，不会误拆。
 */
function 定实参(args) {
  let 实参 = Array.isArray(args) && args.length > 0 ? args : ['--help']
  if (实参.length === 1 && /\s/.test(String(实参[0]))) {
    const 拆 = 拆命令(实参[0])
    if (拆.length > 1 && /^(-|[A-Za-z][\w-]*$)/.test(拆[0])) 实参 = 拆
  }
  return 实参
}

/**
 * 可配置项（写进 `cordis.patch.yml`，改它不用动代码）。
 *
 * `python` + `pythonPath` 的组合是**故意的**：`pythonPath` 指到隔离 venv 的
 * site-packages，让基础解释器也能 `import yaml`。这个组合在本机、在沙箱里、
 * 在宿主里都验过能跑（venv 自己的 `python.exe` 是个重定向器，受限令牌下起不来）。
 */
export const Config = z.object({
  /**
   * 跑 forge.py 的解释器。**留空＝自动找**（推荐）：先看 `FORGE_PYTHON` 环境变量，
   * 再找你机器上装的 Python（用户目录 `Programs\Python`、`C:\Python3*`、DSH 自带那份、
   * 最后才是 `PATH` 里的 `python3` / `python` / `py -3`），**优先挑能 `import yaml` 的**。
   * 只有自动找挑错了（比如机器上有好几个 Python）才需要写死一个完整路径。
   */
  python: z.string().default(默认解释器),
  /** 追加到 PYTHONPATH 的依赖目录（装着 PyYAML）。 */
  pythonPath: z.string().default(默认依赖目录),
  /** forge.py 的位置。 */
  forge: z.string().default(默认工具),
  /** 默认工作目录；**留空＝用 `<你的用户目录>\Documents\ElecKoi卡库`**（没有就自动建）。 */
  cwd: z.string().default(''),
  /** 单次命令的墙钟上限（毫秒）。 */
  timeoutMs: z.number().default(180000),
  /**
   * 装插件时顺手把「制卡助手」创作预设装进 ElecKoi；已经有了就跳过。
   * 不喜欢被自动写预设就设成 `false`（工具照常可用，只是待你自己导一次预设）。
   */
  installPreset: z.boolean().default(true),
  /**
   * 装完之后，**只在当前创作预设还是官方那个默认预设时**，把「制卡助手」设为当前。
   * 你自己挑过的创作预设一律不动。
   */
  activatePreset: z.boolean().default(true),
})

/**
 * 只声明 `tools`；没有它插件保持不激活，而不是抛错。
 *
 * ★ 别写成 `{ required: [...], optional: [...] }` —— 这份 cordis（`@deepseek-ai/cordis`
 * `lib/index.js:1491 Inject.resolve`）只认两种形状：**字符串数组**，或**服务名→配置的对象**。
 * 写成 `{required, optional}` 会被当成「有两个必填服务，一个叫 required、一个叫 optional」，
 * 于是永远等不到、插件静默不激活。可选服务一律用 `ctx.get(名字, false)` 取（见 `取预设服务`）。
 *
 * `eleckoiAgentPresetsApi` 就是这种可选服务：它在 ElecKoi 里才有，纯 DSH 里没有 ——
 * 取不到就跳过装预设，工具本身照常可用。
 */
export const inject = ['tools']

/**
 * 工具说明 —— **这段每轮都会进系统提示词**，所以它自己也得守「预算」那条规矩：
 * 只说「怎么调用」和「先去取规程」，**内容怎么写一律不在这里展开**。
 *
 * 2026-10-15 从 30 行瘦到 15 行（约 1,450 → 620 字）：删掉的全是规程里已经写得更准的
 * 东西（`guide --节/--篇/--对话` 的逐个举例、`make` 的四步流水账、`--正文@文件`、
 * 逐条改的示例）—— 模型真要用时 `["guide"]` 一取就有，没必要每轮背一遍。
 */
const 工具说明 = [
  '做 ElecKoi 角色卡的本机工具（forge）：建卡 / 改卡 / 体检 / 出成品都走它。',
  'args ＝ 传给 forge.py 的命令行参数；逐项给最好，把整条命令塞进一项也行（会替你拆开）。',
  '',
  '**先取规程，再动笔** —— 怎么问玩家、怎么写内容、哪条踩红线，全在里面：',
  '  ["guide"]  先拿目录；再按目录取具体的：["guide","--节","一"] · ["guide","--篇","预算"] · ["guide","--对话","红线"]',
  '',
  '**内容谈定了就一次落成**（最省，优先走这条）：',
  '  ["make","--示例"]  →  存成 .yaml、把设定换成你的  →  ["make","E:/卡库/我的卡.yaml"]',
  '  稿子有毛病会一次报全，而且**一个字都不往目标位置写**；改完稿子想重落，args 里加 "--覆盖"。',
  '',
  '要一条条来也行：先 ["--help"] 看全部命令（new / entry / check / build / png / preset …）。',
  '在哪儿做卡：不给 cwd 就落 `我的文档/ElecKoi卡库`。一张卡＝卡库下一个子目录，同时做几张就各建各的；要做在别处就给 cwd。',
  '',
  '不要加 `--沙箱` —— 本工具由宿主进程直接执行，不受命令行沙箱限制，加了反而丢掉原子落盘。',
  '返回 exitCode / stdout / stderr；exitCode 非 0 就是这步没成，按 stderr 改。',
  '这台机器上找不到 Python 时，返回里会写清找过哪些地方。',
].join('\n')

/**
 * 起一个子进程把命令跑完，收齐 stdout/stderr 与退出码。
 *
 * 三条纪律：
 *   1. **绝不让它挂住** —— 有墙钟上限，到点杀；
 *   2. **听 `exec.signal`** —— 上层取消就杀（官方要求每个工具主体都观测它）；
 *   3. **中文不许乱码** —— 子进程强制 UTF-8 出，这边按 UTF-8 解。
 *
 * @param {{python: string, pythonPath: string, timeoutMs: number}} 配置
 * @param {string} 工作目录
 * @param {string[]} 参数（第一个是 forge.py 的路径）
 * @param {AbortSignal | undefined} 信号
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
function 跑(配置, 工作目录, 参数, 信号) {
  return new Promise((完成) => {
    const 环境 = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    if (配置.pythonPath) 环境.PYTHONPATH = 配置.pythonPath

    let 子进程
    try {
      子进程 = spawn(配置.python, [...(配置.前置 ?? []), ...参数], { cwd: 工作目录, windowsHide: true, env: 环境 })
    } catch (错误) {
      完成({ exitCode: -1, stdout: '', stderr: `进程没起来：${错误?.message ?? 错误}` })
      return
    }

    const 标准输出 = []
    const 标准错误 = []
    let 已定 = false
    let 计时器 = null

    const 收尾 = (结果) => {
      if (已定) return
      已定 = true
      if (计时器 !== null) clearTimeout(计时器)
      try {
        信号?.removeEventListener?.('abort', 取消)
      } catch {
        /* 信号不支持监听就当没有 */
      }
      完成(结果)
    }
    const 取消 = () => {
      try {
        子进程.kill()
      } catch {
        /* 已经死了 */
      }
    }

    计时器 = setTimeout(() => {
      标准错误.push(Buffer.from(`\n[制卡工坊] 超过 ${配置.timeoutMs} 毫秒还没结束，已中止。\n`, 'utf8'))
      取消()
    }, 配置.timeoutMs)

    if (信号) {
      if (信号.aborted) 取消()
      else {
        try {
          信号.addEventListener('abort', 取消, { once: true })
        } catch {
          /* 同上 */
        }
      }
    }

    子进程.stdout?.on('data', (块) => 标准输出.push(块))
    子进程.stderr?.on('data', (块) => 标准错误.push(块))
    子进程.on('error', (错误) => 收尾({ exitCode: -1, stdout: '', stderr: `进程没起来：${错误?.message ?? 错误}` }))
    子进程.on('close', (码) =>
      收尾({
        exitCode: Number.isInteger(码) ? 码 : -1,
        stdout: Buffer.concat(标准输出).toString('utf8'),
        stderr: Buffer.concat(标准错误).toString('utf8'),
      })
    )
  })
}

/**
 * 找解释器 —— 「装在哪台机器上都能跑」的关键。
 *
 * ★ 踩过的坑（2026-10-15，作者机器）：出厂默认写成 `python` 时，ElecKoi 宿主进程
 * 的 `PATH` 里根本没有 `python`，工具一调就 `spawn python ENOENT`。而**装了 Python
 * 不等于它在 PATH 上**：Windows 商店版那个 `python.exe` 只是个转发器，真解释器在
 * `%LOCALAPPDATA%\Programs\Python\Python3xx\`，DSH 自己还会带一份。
 * 于是这里不猜名字，**挨个试，谁能 `import yaml` 就用谁**（forge 要 PyYAML）。
 *
 * 顺序：配置指定的 → `FORGE_PYTHON` → 用户目录装的正经 Python（版本高的先试）
 *       → `C:\Python3xx` → DSH 自带那份 → `PATH` 上的 `python3` / `python` / `py -3`。
 * 结果缓存一次（同一进程里不再重复试），失败不抛错、交给调用方给一句人话。
 */

/** 试一个候选能不能跑起来；能跑返回 true。 */
function 试跑(候选, 代码, 超时毫秒 = 8000) {
  return new Promise((完成) => {
    let 子进程
    try {
      子进程 = spawn(候选.命令, [...(候选.前置 ?? []), '-c', 代码], { windowsHide: true })
    } catch {
      完成(false)
      return
    }
    let 已定 = false
    const 收 = (果) => {
      if (已定) return
      已定 = true
      clearTimeout(计时器)
      完成(果)
    }
    const 计时器 = setTimeout(() => {
      try {
        子进程.kill()
      } catch {
        /* 已经死了 */
      }
      收(false)
    }, 超时毫秒)
    子进程.on('error', () => 收(false))
    子进程.on('exit', (码) => 收(码 === 0))
  })
}

/** 按「最可能是对的那个」排序的候选名单。 */
function 候选解释器() {
  const 名单 = []
  const 加 = (命令, 说明, 前置 = []) => {
    if (!命令 || 名单.some((候选) => 候选.命令 === 命令 && 候选.前置.join(' ') === 前置.join(' '))) return
    名单.push({ 命令, 前置, 说明 })
  }

  const 环境变量 = String(process.env.FORGE_PYTHON ?? '').trim()
  if (环境变量) 加(环境变量, '环境变量 FORGE_PYTHON')

  const 家 = String(process.env.USERPROFILE ?? process.env.HOME ?? '').trim()
  const 用户级 = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Python') : ''
  if (用户级 && existsSync(用户级)) {
    let 目录们 = []
    try {
      目录们 = readdirSync(用户级).filter((名) => /^Python3\d+$/i.test(名)).sort().reverse()
    } catch {
      /* 读不了就当没有 */
    }
    for (const 目录 of 目录们) 加(join(用户级, 目录, 'python.exe'), `用户装的正经 Python（${目录}）`)
  }

  for (const 盘 of ['C:\\', 'D:\\']) {
    let 目录们 = []
    try {
      目录们 = readdirSync(盘).filter((名) => /^Python3\d+$/i.test(名)).sort().reverse()
    } catch {
      /* 盘不在就没有 */
    }
    for (const 目录 of 目录们) 加(join(盘, 目录, 'python.exe'), `装在 ${盘} 根的 ${目录}`)
  }

  if (家) {
    const 运行时根 = join(家, '.dsh', 'dsh-runtimes')
    let 运行时们 = []
    try {
      运行时们 = readdirSync(运行时根)
    } catch {
      /* 没装 DSH 就没有 */
    }
    for (const 运行时 of 运行时们) {
      const 命 = join(运行时根, 运行时, 'dependencies', 'python', 'python.exe')
      if (existsSync(命)) 加(命, `DSH 自带的那份（${运行时}）`)
    }
  }

  加('python3', 'PATH 上的 python3')
  加('python', 'PATH 上的 python')
  加('py', 'Windows 自带的 py 启动器（py -3）', ['-3'])
  return 名单
}

let 解释器缓存 = null

/**
 * 挑一个能用的解释器。挑不到返回 `null`。
 *
 * @param {{python: string}} 配置
 * @returns {Promise<{命令: string, 前置: string[], 说明: string, 有yaml: boolean} | null>}
 */
async function 找解释器(配置) {
  if (解释器缓存) return 解释器缓存
  const 指定 = String(配置.python ?? '').trim()

  if (指定) {
    if (await 试跑({ 命令: 指定 }, 'import yaml')) {
      解释器缓存 = { 命令: 指定, 前置: [], 说明: '配置里指定的', 有yaml: true }
      return 解释器缓存
    }
    if (await 试跑({ 命令: 指定 }, 'pass')) {
      解释器缓存 = { 命令: 指定, 前置: [], 说明: '配置里指定的（没装 PyYAML）', 有yaml: false }
      return 解释器缓存
    }
    // 配置写错了不该把路堵死：记一笔，继续自动找。
    console.warn(`[制卡工坊] 配置里的 python 起不来：${指定} —— 改为自动找。`)
  }

  const 名单 = 候选解释器()
  for (const 候选 of 名单) {
    if (await 试跑(候选, 'import yaml')) {
      解释器缓存 = { ...候选, 有yaml: true }
      return 解释器缓存
    }
  }
  for (const 候选 of 名单) {
    if (await 试跑(候选, 'pass')) {
      解释器缓存 = { ...候选, 有yaml: false }
      return 解释器缓存
    }
  }
  return null
}

/** 装进 ElecKoi 的那份创作预设叫什么。 */
const 预设名 = '制卡助手'

/** 官方那个开箱默认的创作预设编号 —— 只有当前用的是它，才允许我们换掉。 */
const 官方默认创作预设编号 = 'agent-preset-creator'

/** 睡一会儿（等 ElecKoi 那边的预设服务上线）。 */
const 睡 = (毫秒) => new Promise((完成) => setTimeout(完成, 毫秒))

/**
 * 取 ElecKoi 的预设接口。
 *
 * 拿不到就返回 `undefined`（纯 DSH 里没有这个服务）—— 本插件照常提供工具，只是不装预设。
 * 两路都试：`ctx.<服务名>` 与 `ctx.get(名字, 不报错)`，因为不同版本 cordis 的可选依赖行为不一样。
 */
function 取预设服务(ctx) {
  for (const 取法 of [() => ctx.eleckoiAgentPresetsApi, () => (typeof ctx.get === 'function' ? ctx.get('eleckoiAgentPresetsApi', false) : undefined)]) {
    try {
      const 服务 = 取法()
      if (服务 && typeof 服务.catalog === 'function') return 服务
    } catch {
      /* 这一路拿不到，试下一路 */
    }
  }
  return undefined
}

/** 读仓库里那份预设（`forge.py preset` 的产物）。先找插件目录里的副本，再找仓库里的正本。 */
function 读预设() {
  const 候选 = [
    resolve(插件目录, '制卡助手.preset.json'),
    resolve(插件目录, '..', '..', '向导', '制卡助手', '成品', '制卡助手.preset.json'),
  ]
  for (const 路径 of 候选) {
    try {
      return { 路径, 文本: readFileSync(路径, 'utf8') }
    } catch {
      /* 看下一个 */
    }
  }
  return undefined
}

/**
 * 把「制卡助手」创作预设装进 ElecKoi —— 用户装完插件就不必再手动导一次预设。
 *
 * 三条纪律：
 *   1. **幂等** —— 已经有同名的创作预设就一个字不写（升级插件不重复堆预设）；
 *   2. **不抢** —— 只有当前创作预设还是官方默认那个才顺手切过去；用户自己挑过的不动；
 *   3. **不挡路** —— 任何失败都只记一条日志，绝不影响 `cardforge` 工具本身。
 */
async function 装预设(ctx, config) {
  if (!config.installPreset) return

  let 服务
  for (let 次 = 0; 次 < 8 && !服务; 次 += 1) {
    if (次 > 0) await 睡(750)
    服务 = 取预设服务(ctx)
  }
  if (!服务) return

  const 目录 = await 服务.catalog()
  const 已有 = (目录?.presets ?? []).find((项) => 项.purpose === 'creator' && 项.name === 预设名)

  let 编号 = 已有?.id
  if (!编号) {
    const 稿 = 读预设()
    if (!稿) {
      ctx.logger?.warn?.(`[制卡工坊] 找不到预设文件（找过插件目录与仓库的 向导/制卡助手/成品/），跳过自动安装。`)
      return
    }
    const 结果 = await 服务.import(
      'eleckoi',
      { displayName: '制卡助手.preset.json', mimeType: 'application/json', base64: Buffer.from(稿.文本, 'utf8').toString('base64') },
      'creator',
    )
    编号 = 结果?.preset?.id
    ctx.logger?.info?.(`[制卡工坊] 已装创作预设「${预设名}」（${稿.路径}）。`)
  }

  if (编号 && config.activatePreset && 目录?.activePresetIds?.creator === 官方默认创作预设编号) {
    await 服务.setActive(编号)
    ctx.logger?.info?.(`[制卡工坊] 已把「${预设名}」设为当前创作预设。`)
  }
}

/**
 * 注册 `cardforge` 工具。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @param {{python: string, pythonPath: string, forge: string, cwd: string, timeoutMs: number, installPreset: boolean, activatePreset: boolean}} config 校验过的配置
 */
export function apply(ctx, config) {
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new Error('制卡工坊：timeoutMs 必须是正数')
  }
  // 空字符串＝「用出厂默认」（配置里留空比删掉那一行更省事）。
  if (String(config.forge ?? '').trim() === '') config.forge = 默认工具
  // python 留空**不替换**：空串本身就是「自动找」的意思，交给 `找解释器` 每次现挑。

  // 顺手把创作预设装上；失败只记日志，绝不挡工具本身（见 `装预设` 的三条纪律）。
  void 装预设(ctx, config).catch((错) => {
    ctx.logger?.warn?.(`[制卡工坊] 自动安装创作预设失败（不影响 cardforge 工具）：${错?.message ?? 错}`)
  })

  ctx.tools.register(
    defineTool({
      name: 'cardforge',
      description: 工具说明,
      parameters: {
        args: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description: '传给 forge.py 的参数，逐项给出（例：["new","我的卡","--到","E:/卡库"]）。',
        },
        cwd: {
          type: 'string',
          description: '跑命令的工作目录（做卡时通常是你想让工程落地的父目录）。不给就用插件配置里的 cwd，插件配置也空就用 `<用户目录>/Documents/ElecKoi卡库`（会自动建）。',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            exitCode: { type: 'integer', required: true },
            stdout: { type: 'string', required: true },
            stderr: { type: 'string', required: true },
          },
        },
        render: (调用参数, 值) => [
          {
            type: 'text',
            text: [
              `$ forge.py ${(Array.isArray(调用参数.args) && 调用参数.args.length ? 调用参数.args : ['--help']).join(' ')}`,
              值.stdout.replace(/\s+$/, ''),
              值.stderr.replace(/\s+$/, '') === '' ? '' : `[stderr]\n${值.stderr.replace(/\s+$/, '')}`,
              `[exit ${值.exitCode}]`,
            ]
              .filter((行) => 行 !== '')
              .join('\n'),
          },
        ],
      },
      async execute(调用参数, exec) {
        // 空 args 不给报错，直接当问路；「一整条命令」也替它拆开 —— 都是给「人不记语法」准备的。
        const 实参 = 定实参(调用参数.args)
        const 工作目录 = 定工作目录(config, 调用参数.cwd)
        // 只读命令：不为它造目录；默认目录压根不存在时，退到插件目录去跑（照样能看规程）。
        let 跑在哪儿 = 工作目录
        if (只读命令.has(String(实参[0] ?? ''))) {
          if (!existsSync(工作目录)) 跑在哪儿 = 插件目录
        } else {
          try {
            mkdirSync(工作目录, { recursive: true })
          } catch (错) {
            throw new Error(`工作目录建不出来：${工作目录}（${错?.message ?? 错}）—— 在 cwd 参数里换一个能写的目录。`)
          }
        }
        const 解释器 = await 找解释器(config)
        if (!解释器) {
          throw new Error(
            [
              '这台机器上没找到能用的 Python（forge 要 Python ≥3.9 + PyYAML）。',
              '装一个 Python 之后重启 ElecKoi 就好；不想装就改插件配置里的 `python`，写清解释器的完整路径。',
              '找过这些地方：' + 候选解释器().map((候选) => 候选.说明).join('、'),
            ].join('\n'),
          )
        }
        const 结果 = await 跑(
          { ...config, python: 解释器.命令, 前置: 解释器.前置 },
          跑在哪儿,
          [config.forge, ...实参],
          exec?.signal,
        )
        if (!解释器.有yaml && 结果.stderr.includes('yaml') === false) {
          结果.stderr = `[制卡工坊] 注意：用的是「${解释器.说明}」，它没装 PyYAML —— 涉及 YAML 稿的命令会报 ModuleNotFoundError: No module named 'yaml'（装法：pip install PyYAML）。\n${结果.stderr}`
        }
        return 结果
      },
    })
  )
}
