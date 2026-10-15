// 自测：把「装插件时自动装创作预设」那段从 index.js 里摘出来跑一遍。
//
// 跑法：`node 预设自测.mjs`（在插件目录里跑，或者从别处跑都行 —— 路径按本文件的位置算）。
// 不联网、不碰真客户端：`eleckoiAgentPresetsApi` 用假的，只验我们对它的用法对不对。
//
// 手法＝把 index.js 里两行官方 import 换成桩（那两个包只有装进 DSH 才解析得到），
// 再把改好的源码临时落成 `.预设自测.mjs` 导进来（路径解析要跟真身同目录），跑完删掉。
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const 插件目录 = dirname(fileURLToPath(import.meta.url))
const 真身 = join(插件目录, 'index.js')
let 源码 = readFileSync(真身, 'utf8')
源码 = 源码
  .replace(/^import z from .*$/m, `const z = { object: (x) => x, string: () => ({ default: () => '' }), number: () => ({ default: () => 0 }), boolean: () => ({ default: () => true }) }`)
  .replace(/^import \{ defineTool \} from .*$/m, `const defineTool = (x) => x`)
源码 += '\nexport { 装预设, 读预设, 取预设服务 }\n'
const 临时 = join(插件目录, '.预设自测.mjs')
writeFileSync(临时, 源码, 'utf8')
let mod
try {
  mod = await import(pathToFileURL(临时).href)
} finally {
  unlinkSync(临时)
}
const { 装预设, 读预设 } = mod

let 过 = 0
let 败 = 0
function 断言(条件, 说明) {
  if (条件) { 过 += 1; console.log(`  ✔ ${说明}`) } else { 败 += 1; console.log(`  ✘ ${说明}`) }
}

const 造ctx = (服务) => ({ logger: { info() {}, warn() {} }, eleckoiAgentPresetsApi: 服务 })
const 造服务 = (目录, 记录) => ({
  async catalog() { 记录.catalog += 1; return 目录 },
  async import(源, 文档, 用途) { 记录.import.push({ 源, 文档, 用途 }); return { preset: { id: '制卡助手·新' } } },
  async setActive(编号) { 记录.setActive.push(编号); return 目录 },
})
const 新记录 = () => ({ catalog: 0, import: [], setActive: [] })
const 配置 = (改 = {}) => ({ installPreset: true, activatePreset: true, ...改 })

console.log('1) 预设文件本身')
const 稿 = 读预设()
断言(!!稿, `读得到预设（${稿?.路径}）`)
const 文档 = JSON.parse(稿.文本)
断言(文档.format === 'eleckoi.agent-preset', `format = ${文档.format}`)
断言(文档.version === 2, `version = ${文档.version}`)
断言(文档.preset?.purpose === 'creator', `purpose = ${文档.preset?.purpose}`)

console.log('2) 还没有 → 导入，且当前是官方默认 → 切过去')
{
  const 记录 = 新记录()
  const 服务 = 造服务({ presets: [{ id: 'agent-preset-creator', name: '默认创作预设', purpose: 'creator' }], activePresetIds: { creator: 'agent-preset-creator', roleplay: 'agent-preset-standard' } }, 记录)
  await 装预设(造ctx(服务), 配置())
  断言(记录.import.length === 1, 'import 调了 1 次')
  断言(记录.import[0]?.源 === 'eleckoi', '来源 = eleckoi')
  断言(记录.import[0]?.用途 === 'creator', '分类 = creator')
  断言(记录.import[0]?.文档?.mimeType === 'application/json', 'document.mimeType = application/json')
  const 解回 = JSON.parse(Buffer.from(记录.import[0]?.文档?.base64 ?? '', 'base64').toString('utf8'))
  断言(解回.format === 'eleckoi.agent-preset' && 解回.preset?.purpose === 'creator', 'base64 解回是同一份预设')
  断言(记录.setActive.length === 1 && 记录.setActive[0] === '制卡助手·新', 'setActive 切到了新预设')
}

console.log('3) 已经有了 → 一个字不写')
{
  const 记录 = 新记录()
  const 服务 = 造服务({ presets: [{ id: '制卡助手#9', name: '制卡助手', purpose: 'creator' }], activePresetIds: { creator: '制卡助手#9' } }, 记录)
  await 装预设(造ctx(服务), 配置())
  断言(记录.import.length === 0, 'import 没被调')
  断言(记录.setActive.length === 0, '当前已是它 ⇒ 也不 setActive')
}

console.log('4) 已经有了，但当前是用户自己挑的别的创作预设 → 不抢')
{
  const 记录 = 新记录()
  const 服务 = 造服务({ presets: [{ id: '制卡助手#9', name: '制卡助手', purpose: 'creator' }], activePresetIds: { creator: '用户的预设' } }, 记录)
  await 装预设(造ctx(服务), 配置())
  断言(记录.import.length === 0 && 记录.setActive.length === 0, '一个写操作都没有')
}

console.log('5) installPreset=false → 完全不碰预设')
{
  const 记录 = 新记录()
  const 服务 = 造服务({ presets: [], activePresetIds: {} }, 记录)
  await 装预设(造ctx(服务), 配置({ installPreset: false }))
  断言(记录.catalog === 0, '连 catalog 都没读')
}

console.log('6) 宿主没这个服务（纯 DSH）→ 不抛')
{
  let 抛 = false
  try {
    await 装预设({ logger: { info() {}, warn() {} } }, 配置())
  } catch { 抛 = true }
  断言(!抛, '安静地放弃，不抛错')
}

console.log(`\n${败 === 0 ? '全过 ✔' : '有失败 ✘'}　${过} 过 / ${败} 败`)
if (败 > 0) process.exitCode = 1
