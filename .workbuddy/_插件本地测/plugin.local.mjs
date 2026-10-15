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
 */
import { spawn } from 'node:child_process'
import z from './_z.mjs'
import { defineTool } from './_tools.mjs'

/** 稳定标识（Loader 用它认插件）。 */
export const name = 'cardforge'

/** 本机默认路径。都能在 `cordis.patch.yml` 的 config 里改。 */
const 默认解释器 = 'C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe'
const 默认依赖目录 = 'C:/Users/Administrator/.workbuddy/binaries/python/envs/cardforge/Lib/site-packages'
const 默认工具 = 'E:/workGZQ/制卡工具/forge.py'

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
})

/** 需要 `tools` 服务；没有它插件保持不激活，而不是抛错。 */
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

/**
 * 注册 `cardforge` 工具。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @param {{python: string, pythonPath: string, forge: string, cwd: string, timeoutMs: number}} config 校验过的配置
 */
export function apply(ctx, config) {
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new Error('制卡工坊：timeoutMs 必须是正数')
  }

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
