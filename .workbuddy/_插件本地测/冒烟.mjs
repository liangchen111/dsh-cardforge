/**
 * 插件本地冒烟：把 `插件/制卡工坊/index.js` 原样载入（只把两行官方 import 换成桩件），
 * 然后**真的**用它的 execute 去跑本机 forge.py，看：
 *   建工程 → 改名成功 → 体检 → 出成品  能不能一条龙走完。
 *
 * 这一跑只验「插件本体 + 宿主起进程」这件我们能验的事；
 * 「装进 ElecKoi 后模型看不看得见这个工具」只能在真机上验。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const 根 = 'E:/workGZQ/制卡工具'
const 插件入口 = path.join(根, '插件/制卡工坊/index.js')
const 这里 = path.join(根, '.workbuddy/_插件本地测')
const 卡库 = path.join(这里, '卡库')

/** 把两行官方 import 换成本地桩件，其余一字不动。 */
const 源码 = fs
  .readFileSync(插件入口, 'utf8')
  .replace(/from '@deepseek-ai\/dsh-tools'/, "from './_tools.mjs'")
  .replace(/from '@deepseek-ai\/schemastery'/, "from './_z.mjs'")
const 替身 = path.join(这里, 'plugin.local.mjs')
fs.writeFileSync(替身, 源码, 'utf8')

const 模块 = await import(pathToFileURL(替身).href + '?t=' + Date.now())

// ---------- 1. 拿定义 ----------
const 注册表 = []
const ctx = { tools: { register: (定义) => 注册表.push(定义) } }
const 配置 = 模块.Config({})
模块.apply(ctx, 配置)
const 工具 = 注册表[0]

const 结果 = []
const 断言 = (名, 通过, 备注 = '') => {
  结果.push({ 名, 通过, 备注 })
  console.log(`${通过 ? '  ✓' : '  ✗'} ${名}${备注 ? '   ' + 备注 : ''}`)
}

console.log('=== 一、定义本身 ===')
断言('导出了 name', 模块.name === 'cardforge', `name=${模块.name}`)
断言('注册了一个工具', 注册表.length === 1)
断言('工具名是 cardforge', 工具?.name === 'cardforge')
断言('inject 里要了 tools', Array.isArray(模块.inject) && 模块.inject.includes('tools'))
断言('描述不是空的', typeof 工具?.description === 'string' && 工具.description.length > 40, `${工具?.description?.length} 字`)
断言('parameters 有 args 与 cwd', !!工具?.parameters?.properties?.args && !!工具?.parameters?.properties?.cwd)
断言('parameters 里 args 是必填数组', 工具?.parameters?.properties?.args?.type === 'array' && (工具?.parameters?.required ?? []).includes('args'), JSON.stringify(工具?.parameters?.required))
断言('output.schema 三个字段齐', ['exitCode', 'stdout', 'stderr'].every((k) => !!工具?.output?.schema?.properties?.[k]))
断言('配置默认值到位（forge 指向真文件）', fs.existsSync(配置.forge), 配置.forge)
断言('配置默认 python 存在', fs.existsSync(配置.python))
断言('配置默认 pythonPath 存在', fs.existsSync(配置.pythonPath))

// ---------- 2. 驱动它真跑 ----------
fs.rmSync(卡库, { recursive: true, force: true })
fs.mkdirSync(卡库, { recursive: true })

const 信号 = new AbortController().signal
const 跑一把 = (依据, 调用参数) => 工具.execute({ cwd: 卡库, ...调用参数 }, { signal: 信号 })

console.log('\n=== 二、真跑 forge.py ===')
const 帮助 = await 跑一把('help', { args: ['--help'] })
断言('--help 退出码 0', 帮助.exitCode === 0, `exit=${帮助.exitCode}`)
断言('--help 有输出且中文不乱码', /forge|制卡/.test(帮助.stdout) && !帮助.stdout.includes('\ufffd'), `stdout ${帮助.stdout.length} 字节`)

// ---- 取规程（guide）：这是「AI 在 ElecKoi 里自己把知识取到手」的那条路 ----
console.log('\n=== 二·甲、取规程 ===')
const 目录 = await 跑一把('guide', { args: ['guide'] })
断言('guide 退出码 0', 目录.exitCode === 0, `exit=${目录.exitCode}`)
断言('★ 目录三类都有（节 / 篇 / 对话段）', ['## 节', '## 篇', '## 对话段'].every((k) => 目录.stdout.includes(k)))
断言('目录标出了哪几篇是必读', /\[必读\]/.test(目录.stdout))

const 一节 = await 跑一把('guide-节', { args: ['guide', '--节', '一'] })
断言('取一节退出码 0', 一节.exitCode === 0, `exit=${一节.exitCode}`)
断言('★ 取到的是开工流程（成篇内容，不是空壳）', /开工流程/.test(一节.stdout) && 一节.stdout.length > 800, `${一节.stdout.length} 字节`)

const 一段 = await 跑一把('guide-对话', { args: ['guide', '--对话', '访谈'] })
断言('取对话段退出码 0', 一段.exitCode === 0)
断言('★ 取到访谈节奏（在 ElecKoi 里怎么问玩家）', /一层一层问/.test(一段.stdout) && /调子/.test(一段.stdout))

const 怪节 = await 跑一把('guide-坏', { args: ['guide', '--节', '第四十节'] })
断言('★ 认不出的节当场非 0，不静默给空', 怪节.exitCode === 2, `exit=${怪节.exitCode}`)

console.log('\n=== 二·乙、真跑 forge.py ===')
const 新建 = await 跑一把('new', { args: ['new', '插件冒烟卡', '--到', '.'] })
断言('new 退出码 0', 新建.exitCode === 0, `exit=${新建.exitCode}  out=${新建.stdout.trim().slice(0, 160)}`)
const 工程 = path.join(卡库, '插件冒烟卡')
const 规格 = path.join(工程, 'source', '插件冒烟卡.spec.yaml')
断言('工程目录建出来了', fs.existsSync(工程))
断言('★ 改名成功（spec 就是新卡名，不是骨架名）', fs.existsSync(规格), path.relative(卡库, 规格))
断言('骨架名没留下残迹', !fs.existsSync(path.join(工程, 'source', '骨架.spec.yaml')))

const 列分组 = await 跑一把('group', { args: ['group', 规格, '--列'] })
断言('group --列 退出码 0', 列分组.exitCode === 0, `exit=${列分组.exitCode}  out=${列分组.stdout.trim().slice(0, 160)}`)
断言('骨架自带的分组读得到', /世界/.test(列分组.stdout))

const 加条目 = await 跑一把('entry', {
  args: ['entry', 规格, '--新', '世界总纲', '--分组', '世界', '--模板', '选读', '--正文', '插件里写下的第一段正文。'],
})
断言('entry 退出码 0', 加条目.exitCode === 0, `exit=${加条目.exitCode}  out=${加条目.stdout.trim().slice(0, 200)}`)
断言('★ entry 的中文回执没乱码', /世界总纲/.test(加条目.stdout) && !加条目.stdout.includes('\ufffd'))
断言('entry 退出时给了下一步提示', /check/.test(加条目.stdout))

const 体检 = await 跑一把('check', { args: ['check', 规格] })
断言('check 退出码 0', 体检.exitCode === 0, `exit=${体检.exitCode}`)

const 成品 = path.join(工程, '成品', '插件冒烟卡.card.json')
const 出成品 = await 跑一把('build', { args: ['build', 规格, 成品] })
断言('build 退出码 0', 出成品.exitCode === 0, `exit=${出成品.exitCode}  out=${出成品.stdout.trim().slice(0, 200)}`)
断言('★ 成品真的落盘了', fs.existsSync(成品), fs.existsSync(成品) ? `${fs.statSync(成品).size} 字节` : '没有')

const 成品体检 = await 跑一把('check-card', { args: ['check', 成品] })
断言('成品体检退出码 0', 成品体检.exitCode === 0, `exit=${成品体检.exitCode}`)

// ---- 一次落成（make）：内容谈定之后的省事路，**一趟命令出成品** ----
console.log('\n=== 二·丙、一次落成 ===')
const 骨架 = await 跑一把('make-模板', { args: ['make', '--模板'] })
断言('make --模板 退出码 0', 骨架.exitCode === 0, `exit=${骨架.exitCode}`)
断言('★ 骨架是份能跑的稿子（有卡名与条目）', /^卡名:/m.test(骨架.stdout) && /条目:/.test(骨架.stdout))

const 示例 = await 跑一把('make-示例', { args: ['make', '--示例'] })
断言('make --示例 退出码 0', 示例.exitCode === 0, `exit=${示例.exitCode}`)
断言(
  '★ 示例是张完整的卡稿（卡名 / 条目 / 变量 / 正则 / 开场白齐全）',
  /^卡名:/m.test(示例.stdout) &&
    /^条目:/m.test(示例.stdout) &&
    /^变量:/m.test(示例.stdout) &&
    /^正则:/m.test(示例.stdout) &&
    /^开场白:/m.test(示例.stdout)
)
// 这条盯的是老毛病：`--示例` 曾经和 `--模板` 打的是同一份骨架（说了有示例、给的却是空壳）
断言('★ --示例 和 --模板 不是同一份', 示例.stdout !== 骨架.stdout, `两者都 ${示例.stdout.length} 字`)

const 稿 = path.join(卡库, '稿.yaml')
fs.writeFileSync(
  稿,
  '卡名: 插件卡稿试\n清空条目: true\n条目:\n  - 标题: 核心 · 世界总纲\n    正文: 插件里一次落成的那段。\n变量:\n  - 对象: 玩家\n    名: 感度\n    类型: number\n    初值: 2\n开场白: |\n  插件里写下的开场白。\n',
  'utf8'
)
const 落 = await 跑一把('make', { args: ['make', 稿] })
断言('make 退出码 0', 落.exitCode === 0, `exit=${落.exitCode}  out=${落.stdout.trim().slice(0, 160)}`)
断言('★ 报告里说清了改/建/删', /条目\s+改 \d+ · 新建 \d+ · 删 \d+/.test(落.stdout))
断言('★ 卡真落出来了', fs.existsSync(path.join(卡库, '插件卡稿试', 'source', '插件卡稿试.spec.yaml')))
断言('★ 成品也一次出了', fs.existsSync(path.join(卡库, '插件卡稿试', '成品', '插件卡稿试.card.json')))

const 坏稿 = path.join(卡库, '坏稿.yaml')
fs.writeFileSync(坏稿, '卡名: 坏卡\n条目:\n  - 标题: 甲\n    模板: 没这个档\n', 'utf8')
const 落坏 = await 跑一把('make-坏', { args: ['make', 坏稿] })
断言('★ 坏稿被拦下（非 0）', 落坏.exitCode !== 0, `exit=${落坏.exitCode}`)
断言('★ 坏稿时目标位置一个字没写', !fs.existsSync(path.join(卡库, '坏卡')))

// ---------- 3. 边界 ----------
console.log('\n=== 三、边界 ===')
let 空参报错 = ''
try {
  await 工具.execute({ args: [] }, { signal: 信号 })
} catch (错误) {
  空参报错 = String(错误?.message ?? 错误)
}
断言('空 args 被拦下', /args 不能是空的/.test(空参报错), 空参报错.slice(0, 80))

let 没目录报错 = ''
try {
  await 工具.execute({ args: ['--help'] }, { signal: 信号 })
} catch (错误) {
  没目录报错 = String(错误?.message ?? 错误)
}
断言('不给 cwd 且配置为空时被拦下', /没给工作目录/.test(没目录报错), 没目录报错.slice(0, 90))

const 假命令 = await 跑一把('unknown', { args: ['这不是命令'] })
断言('错命令返回非 0 而不是抛异常', 假命令.exitCode !== 0, `exit=${假命令.exitCode}`)

const 渲染 = 工具.output.render({ args: ['--help'] }, 帮助)
断言('render 出的是带 text 的块', Array.isArray(渲染) && 渲染[0]?.type === 'text' && typeof 渲染[0].text === 'string')

// 收工：把这一趟的桩件工程清掉（只删自己刚建的那个目录，别碰别人）
fs.rmSync(卡库, { recursive: true, force: true })

// ---------- 汇总 ----------
const 过 = 结果.filter((r) => r.通过).length
const 总 = 结果.length
console.log(`\n===== ${过}/${总} 通过${过 === 总 ? ' · 全绿' : ' · 有红'} =====`)
if (过 !== 总) {
  console.log('红的：')
  for (const r of 结果.filter((x) => !x.通过)) console.log('  - ' + r.名 + '   ' + r.备注)
}
process.exit(过 === 总 ? 0 : 1)
