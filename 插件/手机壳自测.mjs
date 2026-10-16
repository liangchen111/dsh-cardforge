// 手机壳自测：不起真客户端，用一个假 ctx 把工具注册进来，然后真跑几条命令。
//
// 跑法：`node 插件\手机壳自测.mjs`
//
// 验的是四件事：
//   ① 插件能在**没有宿主包**的情况下 import（零依赖 ESM）——假 ctx 就能驱动；
//   ② `ctx.tools.register()` 收的是**普通对象**（不 import `defineTool`）；
//   ③ 引擎真在宿主进程里跑（不 spawn python），stdout 被收进 `stdout` 字段；
//   ④ 每次跑完 `process.cwd()` 与 `process.stdout.write` 都还原（不然会把宿主搅坏）。
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 临时 = resolve(这里, '_自测工作区')

let 定义 = null
const 假ctx = {
  tools: {
    register(d) {
      定义 = d
      return () => {}
    },
  },
  logger: { info() {}, warn() {}, error() {} },
}

const 原cwd = process.cwd()
const 原写 = process.stdout.write

const 壳 = await import('./制卡工坊-手机/制卡工坊.mjs')
console.log(`插件导出：name=${壳.name} · inject=${JSON.stringify(壳.inject)} · apply=${typeof 壳.apply}`)
壳.apply(假ctx, { cwd: 临时 })
if (!定义) throw new Error('apply() 没注册工具')
console.log(`注册的工具：${定义.name} · 参数键=${Object.keys(定义.parameters).join(',')} · output.render=${typeof 定义.output.render}`)

rmSync(临时, { recursive: true, force: true })
const 规格 = join(临时, '探卡', 'source', '探卡.spec.yaml')

const 命令 = [
  ['--help'],
  ['guide'],
  ['new', '探卡'],
  ['entry', 规格, '--新', '第一件', '--正文', '试试看。'],
  ['var', 规格, '--新对象', '世界'],
  ['check', 规格],
  ['build', 规格],
  ['png', 规格],
  ['selftest'],
]

let 全过 = true
for (const 实参 of 命令) {
  const 果 = await 定义.execute({ args: 实参, cwd: 临时 }, {})
  const 沙 = 果.stdout.replace(/\s+/g, ' ').slice(0, 80)
  console.log(`exit=${String(果.exitCode).padStart(2)} · stderr=${String(果.stderr.length).padStart(5)}B · ${JSON.stringify(实参.join(' '))}`)
  console.log(`        ${沙}`)
  if (果.exitCode !== 0) 全过 = false
}

// ④ 还原检查
if (process.cwd() !== 原cwd) {
  console.log(`✗ cwd 没还原：${process.cwd()}`)
  全过 = false
} else console.log('✔ cwd 已还原')
if (process.stdout.write !== 原写) {
  console.log('✗ process.stdout.write 没还原')
  全过 = false
} else console.log('✔ process.stdout.write 已还原')
if (!existsSync(join(临时, '探卡', '成品', '探卡.card.png'))) {
  console.log('✗ 没看到成品 PNG')
  全过 = false
} else console.log(`✔ 成品目录：${readdirSync(join(临时, '探卡', '成品')).join(' ')}`)

console.log(全过 ? '\n结论：手机壳自测全绿 ✔' : '\n结论：有红 ✗')
process.exitCode = 全过 ? 0 : 1
rmSync(临时, { recursive: true, force: true })
