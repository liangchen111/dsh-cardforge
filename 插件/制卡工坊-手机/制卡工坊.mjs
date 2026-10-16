/**
 * 制卡工坊 · 手机壳 —— 把 `forgejs\`（零依赖 ESM 引擎）挂成一个 DSH 工具。
 *
 * ## 这个壳和 `插件\制卡工坊\`（桌面壳）什么关系
 * 同一个引擎、两件壳。桌面壳 spawn `forge.py`（要 Python + PyYAML）；这个壳**不碰 Python**，
 * 直接把 `forgejs\forge.mjs` import 进宿主进程里跑 —— 手机上正是靠这一条成立的
 * （ElecKoi 的 proot Ubuntu 里没有 python3）。
 *
 * ## 为什么只能长这样（三条硬约束，来自 APK 里两个内置插件的实测）
 *   1. **零依赖**：手机端插件从 DSH_HOME 装载，**解析不了压在可执行文件里的包**
 *      （`agent-session-bridge.mjs` 头注原话），所以宿主包一个都不能 import。
 *      `defineTool` / `schemastery` 这类也不 import —— `ctx.tools.register()` 只校
 *      `name` / `output.render` / `output.schema` 三样，**普通对象就够**（见
 *      `dsh_asar/tools-lib-index.js` 的 `register(definition)`）。
 *   2. **只用 `node:` 内置模块与相对路径**。
 *   3. **插件目录自包含**：引擎、`assets/`、`samples/` 都躺在本地目录里（`同步手机壳.mjs` 推过来），
 *      因为 `forge.mjs` 用 `resolve(自己的目录,'..')` 当工具根，而 `lib/*.mjs` 用再上一层。
 *
 * ## 两条必须串行化的进程级状态
 * 「劫持 stdout」和「chdir」都是**进程全局**的 ⇒ 同一个进程里并发调两次会把输出搅在一起、
 * 把对方的 cwd 换掉。这里用一条 Promise 闸把每一次调用排成队（`串行()`）。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'cardforge'

/**
 * 只声明 `tools`；没有它插件保持不激活，而不是抛错。
 *
 * ★ 别写成 `{ required: [...], optional: [...] }` —— cordis 的 `Inject.resolve` 只认两种形状：
 * **字符串数组**，或**服务名→配置的对象**。写成 `{required, optional}` 会被当成两个必填服务，
 * 于是永远等不到、插件静默不激活。
 */
export const inject = ['tools']

const 插件目录 = dirname(fileURLToPath(import.meta.url))

/** 只读命令：不为它造工作目录（目录不存在就退到插件目录，照样能看规程）。 */
const 只读命令 = new Set(['--help', '-h', '--h', '--version', '--版本', 'guide', 'manual', 'check', 'lint'])

/** 把一项拆成多段（认单/双引号；引号只是分组，不保留）。 */
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
    if (ch === '"' || ch === "'") {
      引号 = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (当前) {
        出.push(当前)
        当前 = ''
      }
      continue
    }
    当前 += ch
  }
  if (当前) 出.push(当前)
  return 出
}

/**
 * 空 args 当问路；只有一项且「像一整条命令」的替它拆开。
 * 判据：里面有空白，且拆出来第一个词是 ASCII 单词或以 `-` 开头 —— 把「单个带空格的名字」挡在外面。
 */
function 定实参(args) {
  let 实参 = Array.isArray(args) && args.length > 0 ? args : ['--help']
  if (实参.length === 1 && /\s/.test(String(实参[0]))) {
    const 拆 = 拆命令(实参[0])
    if (拆.length > 1 && /^(-|[A-Za-z][\w-]*$)/.test(拆[0])) 实参 = 拆
  }
  return 实参
}

function 家目录() {
  return String(process.env.USERPROFILE ?? process.env.HOME ?? process.cwd())
}

/** 默认卡库（没有就自动建；只读命令不建）。 */
function 卡库目录() {
  return join(家目录(), 'Documents', 'ElecKoi卡库')
}

function 定工作目录(config, 参数cwd) {
  const 写死 = String(config?.cwd ?? '').trim()
  const 给 = String(参数cwd ?? '').trim()
  if (给) return resolve(给)
  if (写死) return resolve(写死)
  return 卡库目录()
}

// ── 引擎：进程里只 import 一次 ───────────────────────────────────────────────
let 引擎 = null
async function 载引擎() {
  if (!引擎) 引擎 = await import('./forgejs/forge.mjs')
  return 引擎
}

// ── 串行闸：stdout 劫持与 chdir 都是进程级状态 ────────────────────────────────
let 闸 = Promise.resolve()
function 串行(任务) {
  const 下一个 = 闸.then(任务, 任务)
  闸 = 下一个.then(
    () => {},
    () => {},
  )
  return 下一个
}

/**
 * 在工作目录里跑一条命令，把引擎打到 stdout/stderr 的字都收起来。
 *
 * ★ `console.log` 也得劫持 —— `plan.mjs` / `hud.mjs` 直接用了它，绕开 `process.stdout.write`。
 */
async function 跑引擎(实参, 工作目录, timeoutMs) {
  const FG = await 载引擎()
  const 原cwd = process.cwd()
  const 原出 = process.stdout.write
  const 原错 = process.stderr.write
  const 原log = console.log
  const 原err = console.error
  let 出文 = ''
  let 错文 = ''
  const 收 = (块) => {
    出文 += typeof 块 === 'string' ? 块 : String(块)
    return true
  }
  const 收错 = (块) => {
    错文 += typeof 块 === 'string' ? 块 : String(块)
    return true
  }
  const 开跑 = Date.now()
  try {
    process.chdir(工作目录)
    process.stdout.write = 收
    process.stderr.write = 收错
    console.log = (...段) => 收(段.map((x) => (typeof x === 'string' ? x : String(x))).join(' ') + '\n')
    console.error = (...段) => 收错(段.map((x) => (typeof x === 'string' ? x : String(x))).join(' ') + '\n')
    let 码 = 0
    try {
      码 = await FG.main(实参)
    } catch (错) {
      码 = -1
      错文 += `\n[制卡工坊] ${错?.stack ?? 错}\n`
    }
    if (!Number.isInteger(码)) 码 = 0
    const 耗时 = Date.now() - 开跑
    if (Number.isFinite(timeoutMs) && timeoutMs > 0 && 耗时 > timeoutMs) {
      错文 += `\n[制卡工坊] 这一次跑了 ${(耗时 / 1000).toFixed(1)} 秒，超过配置的 ${timeoutMs} 毫秒。\n`
    }
    return { exitCode: 码, stdout: 出文, stderr: 错文 }
  } finally {
    process.stdout.write = 原出
    process.stderr.write = 原错
    console.log = 原log
    console.error = 原err
    try {
      process.chdir(原cwd)
    } catch {
      /* 原目录没了就当没这回事 */
    }
  }
}

const 工具说明 = [
  '做 ElecKoi 角色卡的本机工具（forge）：建卡 / 改卡 / 体检 / 出成品都走它。',
  'args ＝ 传给 forge 的命令行参数；逐项给最好，把整条命令塞进一项也行（会替你拆开）。',
  '**这套引擎是纯 JavaScript 的，不需要 Python。**',
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
  '返回 exitCode / stdout / stderr；exitCode 非 0 就是这步没成，按 stderr 改。',
].join('\n')

/**
 * 注册 `cardforge` 工具。
 *
 * @param {{tools: {register: Function}}} ctx 插件上下文
 * @param {{cwd?: string, timeoutMs?: number}} config cordis.yml 里的 config
 */
export function apply(ctx, config = {}) {
  const 配置 = {
    cwd: String(config?.cwd ?? ''),
    timeoutMs: Number.isFinite(config?.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 180000,
  }

  ctx.tools.register({
    name: 'cardforge',
    description: 工具说明,
    parameters: {
      args: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: '传给 forge 的参数，逐项给出（例：["new","我的卡","--到","E:/卡库"]）。',
      },
      cwd: {
        type: 'string',
        description:
          '跑命令的工作目录（做卡时通常是你想让工程落地的父目录）。不给就用插件配置里的 cwd，插件配置也空就用 `<用户目录>/Documents/ElecKoi卡库`（会自动建）。',
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
            `$ forge ${(Array.isArray(调用参数.args) && 调用参数.args.length ? 调用参数.args : ['--help']).join(' ')}`,
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
      const 实参 = 定实参(调用参数?.args)
      const 工作目录 = 定工作目录(配置, 调用参数?.cwd)
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
      if (exec?.signal?.aborted) return { exitCode: -1, stdout: '', stderr: '[制卡工坊] 已被取消。\n' }
      return 串行(() => 跑引擎(实参, 跑在哪儿, 配置.timeoutMs))
    },
  })
}
