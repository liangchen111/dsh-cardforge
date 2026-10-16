/**
 * 把本地打好的 `dsh-cardforge-<版本>.tgz` 装进某个 dsh profile（DSH 或 ElecKoi）。
 *
 * 为什么不走 npm：源站传播要时间（刚发的版本 `npm view` 还是旧的），
 * 而且 profile 里那份依赖写的是 `^0.28.1` —— `0.x` 的 `^` 永远升不到 `0.30`。
 * 这里直接用本地 tarball，装出来的目录形状和 npm 一模一样。
 *
 * 做的事（全部可回滚）：
 *   1. `<profile>/package.json` 先备份一份 `<名>.bak-cardforge-<时间戳>`
 *   2. 依赖表里 `dsh-cardforge` 指向 `file:./node_modules/dsh-cardforge`
 *   3. `dsh.profile.bundles` 里补上 `"dsh-cardforge"`（少了这条，客户端那一半不会被装载）
 *   4. tarball 解到 `<profile>/node_modules/dsh-cardforge/`（先删旧的）
 *
 * 用法：
 *   node 插件\_装进壳.mjs --到 dsh          # 干跑，只说将要做什么
 *   node 插件\_装进壳.mjs --到 dsh --写      # 真装
 *   node 插件\_装进壳.mjs --到 eleckoi --写
 *   node 插件\_装进壳.mjs --到 dsh --卸 --写 # 撤掉（删依赖+条目+目录，保留备份）
 */
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 工具根 = resolve(这里, '..')
const 写 = process.argv.includes('--写')
const 卸 = process.argv.includes('--卸')

function 取值(名, 默认) {
  const i = process.argv.indexOf(名)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 默认
}

const 到 = 取值('--到', 'dsh')
const 档 =
  到 === 'eleckoi'
    ? join(String(process.env.APPDATA ?? ''), 'eleckoi-desktop', 'dsh-runtime', 'home', 'profiles', 'desktop')
    : join(String(process.env.USERPROFILE ?? ''), '.dsh', 'profiles', 'desktop')

const 包档 = join(档, 'package.json')
const 装处 = join(档, 'node_modules', 'dsh-cardforge')

console.log('目标    ：' + 到 + ' → ' + 档)
if (!existsSync(包档)) {
  console.error('找不到 profile 的 package.json：' + 包档)
  process.exit(1)
}

function 找包() {
  const 件 = readdirSync(工具根)
    .filter((n) => /^dsh-cardforge-\d+\.\d+\.\d+.*\.tgz$/.test(n))
    .sort()
  return 件.length ? join(工具根, 件[件.length - 1]) : null
}

const 原文 = readFileSync(包档, 'utf8')
const 文档 = JSON.parse(原文)
文档.dsh ??= {}
文档.dsh.profile ??= {}
文档.dsh.profile.bundles ??= []
文档.dependencies ??= {}

const 旧写法 = Object.prototype.hasOwnProperty.call(文档.dependencies, 'dsh-cardforge')
  ? 文档.dependencies['dsh-cardforge']
  : '（没有）'
const 有条目 = 文档.dsh.profile.bundles.includes('dsh-cardforge')

if (卸) {
  if (!写) {
    console.log('[干跑] 会删依赖 dsh-cardforge（现在是 ' + 旧写法 + '）／删 bundles 条目／删目录 ' + 装处)
    process.exit(0)
  }
  delete 文档.dependencies['dsh-cardforge']
  文档.dsh.profile.bundles = 文档.dsh.profile.bundles.filter((x) => x !== 'dsh-cardforge')
  const 备份 = 包档 + '.bak-uninstall-' + 时间戳()
  writeFileSync(备份, 原文)
  writeFileSync(包档, JSON.stringify(文档, null, 2) + '\n')
  if (existsSync(装处)) rmSync(装处, { recursive: true, force: true })
  console.log('已卸载。备份：' + 备份)
  process.exit(0)
}

const tgz = 找包()
if (!tgz) {
  console.error('工具根里没有 dsh-cardforge-*.tgz —— 先跑 npm pack')
  process.exit(1)
}

console.log('tarball ：' + tgz)
console.log('依赖    ：' + 旧写法 + ' → file:./node_modules/dsh-cardforge')
console.log('bundles ：有 dsh-cardforge = ' + 有条目 + ' → true')
console.log('装到    ：' + 装处)

if (!写) {
  console.log('\n[干跑] 加 --写 真装。')
  process.exit(0)
}

const 备份 = 包档 + '.bak-cardforge-' + 时间戳()
writeFileSync(备份, 原文)
console.log('\n已备份 ' + 备份)

if (existsSync(装处)) rmSync(装处, { recursive: true, force: true })
mkdirSync(装处, { recursive: true })
execFileSync('tar', ['-xzf', tgz, '-C', 装处, '--strip-components=1'], { stdio: 'inherit' })

文档.dependencies['dsh-cardforge'] = 'file:./node_modules/dsh-cardforge'
if (!有条目) 文档.dsh.profile.bundles.push('dsh-cardforge')
writeFileSync(包档, JSON.stringify(文档, null, 2) + '\n')

const 装好 = JSON.parse(readFileSync(join(装处, 'package.json'), 'utf8'))
console.log('已解包并写 package.json。装好的版本：' + 装好.name + '@' + 装好.version)
console.log('带客户端那一半：' + (装好.dsh?.client ? '是' : '没有！'))
console.log('\n回滚：把 ' + 备份 + ' 拷回 package.json，删掉 ' + 装处 + '，重启。')

function 时间戳() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
