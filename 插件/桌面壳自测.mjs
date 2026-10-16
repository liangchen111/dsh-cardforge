// 自测：桌面宿主壳 `插件/制卡工坊/index.js` 的 **JS 快路** —— 机器上没有 Python 也能做卡。
//
// 覆盖：① 有 `forgejs/forge.mjs` 时走进程内 JS 引擎（把 python 故意写成一个跑不起来的
//       名字，照样要出卡 —— 出了就证明根本没碰 Python）② 九条命令的 rc 与产物
//       ③ 跑完 `process.cwd()` / `process.stdout.write` / `console.log` 都还原
//
// 跑法：`node 插件\桌面壳自测.mjs`（从哪跑都行，路径按本文件位置算）。
// 手法沿用 `预设自测.mjs`：那两个官方包只有装进 DSH 才解析得到，先把两行 import 换成桩，
// 再把改好的源码临时落成 `.桌面壳自测.mjs`（要跟真身同目录）导进来，跑完删掉。
// 临时工作区**建在 `差分\` 下**（工具根会污染 scaffold 语料第 27 条快照）。
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const 插件目录 = dirname(fileURLToPath(import.meta.url))
const 壳目录 = join(插件目录, '制卡工坊')
const 工具根 = resolve(壳目录, '..', '..')
const 引擎 = join(工具根, 'forgejs', 'forge.mjs')

let 源码 = readFileSync(join(壳目录, 'index.js'), 'utf8')
源码 = 源码
  .replace(
    /^import z from .*$/m,
    `const z = { object: (x) => x, string: () => ({ default: () => '' }), number: () => ({ default: () => 0 }), boolean: () => ({ default: () => true }) }`,
  )
  .replace(/^import \{ defineTool \} from .*$/m, `const defineTool = (x) => x`)
源码 += '\nexport { 跑JS, 载引擎, JS引擎, 定实参, 定工作目录, 只读命令 }\n'
const 临时壳 = join(壳目录, '.桌面壳自测.mjs')
writeFileSync(临时壳, 源码, 'utf8')
let 模组
try {
  模组 = await import(pathToFileURL(临时壳).href)
} finally {
  unlinkSync(临时壳)
}

let 过 = 0
let 败 = 0
function 断言(条件, 说明) {
  if (条件) {
    过 += 1
    console.log(`  ✔ ${说明}`)
  } else {
    败 += 1
    console.log(`  ✘ ${说明}`)
  }
}

console.log('1) 引擎在位 · 导出对')
断言(existsSync(引擎), `找得到假引擎 ${引擎}`)
断言(typeof 模组.apply === 'function', 'apply 是函数')
断言(模组.跑JS !== undefined, '跑JS 已就位')

// 临时工作区优先建在仓库的 `差分\` 下（工具根会污染 scaffold 语料第 27 条快照）；
// 从 npm 包里解出来跑时没有 `差分\`，退回系统临时目录。
const 差分目录 = join(工具根, '差分')
const 工作区 = mkdtempSync(join(existsSync(差分目录) ? 差分目录 : tmpdir(), '_tmp_桌面壳-'))
const 原cwd = process.cwd()
const 原写 = process.stdout.write
const 原日志 = console.log

let 定义 = null
const ctx = { logger: { info() {}, warn() {} }, tools: { register(d) { 定义 = d } } }

// python 故意给一个跑不起来的名字：走到 Python 那条路必然失败 ⇒ 成功即证明走的是 JS。
模组.apply(ctx, {
  python: '这东西根本不存在的解释器',
  pythonPath: '',
  forge: '',
  cwd: 工作区,
  timeoutMs: 180000,
  installPreset: false,
  activatePreset: false,
})

console.log('2) 注册出来的工具')
断言(定义?.name === 'cardforge', `工具名 = ${定义?.name}`)
断言(typeof 定义?.execute === 'function', 'execute 是函数')

const 规格 = join(工作区, '探卡', 'source', '探卡.spec.yaml')
const 跑一条 = async (args) => 定义.execute({ args, cwd: 工作区 }, {})

console.log('3) 九条命令（无 Python 环境）')
const 结果表 = []
for (const 参数 of [
  ['--help'],
  ['guide'],
  ['new', '探卡'],
  ['entry', 规格, '--新', '第一件', '--正文', '试试看。'],
  ['var', 规格, '--新对象', '世界'],
  ['check', 规格],
  ['build', 规格],
  ['png', 规格],
  ['selftest'],
]) {
  const 结果 = await 跑一条(参数)
  结果表.push({ 参数: 参数[0], ...结果 })
  console.log(`  · ${参数[0].padEnd(8)} rc=${结果.exitCode} stdout=${结果.stdout.length}B stderr=${结果.stderr.length}B`)
}
断言(
  结果表.every((x) => x.exitCode === 0),
  `九条 rc 全 0（${结果表.map((x) => `${x.参数}:${x.exitCode}`).join(' ')}）`,
)
断言(
  结果表.every((x) => x.stderr === ''),
  '九条 stderr 全空',
)

console.log('4) 产物')
const 卡json = join(工作区, '探卡', '成品', '探卡.card.json')
const 卡png = join(工作区, '探卡', '成品', '探卡.card.png')
断言(existsSync(卡json), `出了 ${卡json}（${existsSync(卡json) ? statSync(卡json).size : 0} B）`)
断言(existsSync(卡png), `出了 ${卡png}（${existsSync(卡png) ? statSync(卡png).size : 0} B）`)

console.log('5) 还原')
断言(process.cwd() === 原cwd, `cwd 已还原（${process.cwd()}）`)
断言(process.stdout.write === 原写, 'process.stdout.write 已还原')
断言(console.log === 原日志, 'console.log 已还原')

rmSync(工作区, { recursive: true, force: true })

console.log(`\n结论：${败 === 0 ? '桌面壳 JS 快路全绿 ✔' : '有红 ✘'}　（过 ${过} · 败 ${败}）`)
process.exitCode = 败 === 0 ? 0 : 1
