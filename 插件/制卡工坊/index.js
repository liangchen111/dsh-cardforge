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
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 稳定标识（Loader 用它认插件）。 */
export const name = 'cardforge'

/**
 * 出厂默认值 —— **不含任何本机路径**。
 *
 * - 解释器：用 `PATH` 里那个 `python`（你机器上装着 PyYAML 的那个）。
 * - 依赖目录：留空＝不动 `PYTHONPATH`（记成 `pythonPath` 的人是拿 venv 的
 *   site-packages 喂基础解释器用的，用不上就别填）。
 * - `forge.py`：**自动认** —— 这个插件住在仓库的 `插件/制卡工坊/` 下，
 *   往上两级就是仓库根，`forge.py` 就在那儿。
 */
const 插件目录 = dirname(fileURLToPath(import.meta.url))
const 默认解释器 = 'python'
const 默认依赖目录 = ''
const 默认工具 = resolve(插件目录, '..', '..', 'forge.py')

/**
 * 可配置项（写进 `cordis.patch.yml`，改它不用动代码）。
 *
 * `python` + `pythonPath` 的组合是**故意的**：`pythonPath` 指到隔离 venv 的
 * site-packages，让基础解释器也能 `import yaml`。这个组合在本机、在沙箱里、
 * 在宿主里都验过能跑（venv 自己的 `python.exe` 是个重定向器，受限令牌下起不来）。
 */
export const Config = z.object({
  /** 跑 forge.py 的解释器。 */
  python: z.string().default(默认解释器),
  /** 追加到 PYTHONPATH 的依赖目录（装着 PyYAML）。 */
  pythonPath: z.string().default(默认依赖目录),
  /** forge.py 的位置。 */
  forge: z.string().default(默认工具),
  /** 不给 cwd 参数时用的默认工作目录；空字符串＝必须由调用方给。 */
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

const 工具说明 = [
  '做 ElecKoi 角色卡的本机工具（forge）。建卡 / 改卡 / 体检 / 出成品都走它。',
  'args 是传给 forge.py 的命令行参数数组，逐项给；元素里不要再加引号，也不要把多个词并进一个元素。',
  '',
  '**动笔之前先取规程** —— 怎么问玩家、怎么写内容、哪条会踩红线，全在里面：',
  '  ["guide"]                     先拿目录（有哪些节、哪些篇、哪几篇是必读的）',
  '  ["guide","--节","一"]          取一节："一"开工流程 / "三"开场白 / "六"验收标准 …',
  '  ["guide","--篇","预算"]        取一篇方法论："预算" / "写法" / "角色" / "世界" …',
  '  ["guide","--对话","访谈"]      取对话段："总则" / "访谈" / "交付" / "红线"',
  '',
  '**内容谈定了就一次落成**（最省：一趟命令出成品）：',
  '  0) ["make","--示例"]                 打出一张**真能开的完整卡稿**（长夜便利店）——',
  '                                        照它改，比对着空文件想快得多，**优先走这条**；',
  '                                        只想看键名才用 ["make","--模板"] 那份骨架',
  '  1) 把示例存成文件（如 E:/卡库/我的卡.yaml），把设定换成你的',
  '  2) ["make","E:/卡库/我的卡.yaml"]     建工程 / 写条目 / 加变量正则 / 换开场白 /',
  '                                        出成品 / 体检，一趟全做完',
  '  稿里的条目按标题认人（已有同名的改它、没有才新建）；分组与变量对象缺了自动补。',
  '  稿子有毛病会一次报全，而且**一个字都不往目标位置写** —— 改稿子再来。',
  '  改完稿子想重落：args 里加 "--覆盖"。',
  '',
  '也可以一条条来（来回十几轮，能一次落成就别这样）：',
  '  1) ["new","我的卡","--到","E:/卡库"]                                建工程',
  '  2) ["entry","<spec.yaml>","--新","世界总纲","--分组","世界","--正文","……"]   加一条设定',
  '  3) ["check","E:/卡库/我的卡"]                                       体检（看警告要用单文件模式）',
  '  4) ["build","<spec.yaml>","E:/卡库/我的卡/成品/我的卡.card.json"]     出成品 —— 交给 ElecKoi 的就是这个文件',
  '先跑一次 ["--help"] 有全部命令。长正文先写成文件再用 ["entry",…,"--正文@正文.txt"]，别往引号里塞。',
  '注意：本工具由宿主进程直接执行，**不受命令行沙箱限制**，所以**不要加 `--沙箱`** —— 那是给受限沙箱里的命令用的，加了反而会丢掉原子落盘。',
  '返回 exitCode / stdout / stderr；exitCode 非 0 就是这步没成，按 stderr 改。',
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
      子进程 = spawn(配置.python, 参数, { cwd: 工作目录, windowsHide: true, env: 环境 })
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
  if (String(config.python ?? '').trim() === '') config.python = 默认解释器

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
          description: '跑命令的工作目录（做卡时通常是你想让工程落地的父目录）。不给就用插件配置里的 cwd。',
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
              `$ forge.py ${调用参数.args.join(' ')}`,
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
        if (调用参数.args.length === 0) {
          throw new Error('args 不能是空的：至少给一个子命令，比如 ["--help"]。')
        }
        const 工作目录 = String(调用参数.cwd ?? '').trim() || String(config.cwd ?? '').trim()
        if (工作目录 === '') {
          throw new Error('没给工作目录：请在 cwd 参数里写清把卡做在哪个目录（例如 "E:/卡库"），或在本插件配置里设 cwd。')
        }
        return 跑(config, 工作目录, [config.forge, ...调用参数.args], exec?.signal)
      },
    })
  )
}
