// 把引擎从工具根同步进「手机壳」，并重写它的 manifest.json。
//
// 为什么要有这个脚本：手机壳是**自包含**的（手机上没有 Python、也拿不到这个仓库），
// 所以 `forgejs\` / `assets\` / `samples\` 都得原样躺在插件目录里。但**真源只有一个** ——
// 引擎永远在工具根的 `forgejs\` 里改，改完跑一遍这个脚本推过去，不手抄。
//
// 跑法：`node 插件\同步手机壳.mjs`（在哪跑都行，路径按本文件自己的位置算）
//
// 两条纪律：
//   1. **别用 `fs.cpSync(源, 目标, {recursive:true})`** —— 本机 Node v24.14.0 上它会
//      把进程直接打崩（退出码 -1073740791 / 0xC0000409，一行输出都不给）。
//      自己 readdirSync + copyFileSync，连 mtime 一起搬（utimesSync）。
//   2. `manifest.json` 的 `files` 是**本插件全部文件的白名单**（APK 里两个内置插件都是
//      「除 manifest.json 之外一个不落」）⇒ 由这个脚本按实际落盘结果重写，别手改。
import { readdirSync, mkdirSync, copyFileSync, statSync, utimesSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 工具根 = resolve(这里, '..')
const 壳 = join(这里, '制卡工坊-手机')

/** 要同步进壳的顶层目录（都在工具根下）。 */
const 要同步 = ['forgejs', 'assets', 'samples']

/**
 * 不搬的文件（相对工具根的 POSIX 路径）。
 * `forgejs/cli.mjs` 是「在仓库里用 node 跑 Python 版」的那层薄壳：它要求旁边有 `forge.py`，
 * 手机上没有 Python、也没有 `forge.py` ⇒ 搬过去只会误导人（壳自己是另一套入口）。
 */
const 不搬 = new Set(['forgejs/cli.mjs'])

/** 递归拷贝，返回落盘的文件列表（相对壳的 POSIX 路径）。 */
function 拷(源, 目标, 清单) {
  const 信息 = statSync(源)
  if (信息.isDirectory()) {
    mkdirSync(目标, { recursive: true })
    for (const 名 of readdirSync(源).sort()) 拷(join(源, 名), join(目标, 名), 清单)
    return
  }
  const 相对工具根 = relative(工具根, 源).split(sep).join('/')
  if (不搬.has(相对工具根)) return
  mkdirSync(dirname(目标), { recursive: true })
  copyFileSync(源, 目标)
  try {
    utimesSync(目标, 信息.atime, 信息.mtime)
  } catch {
    /* 时间戳搬不动不算错 */
  }
  清单.push(relative(壳, 目标).split(sep).join('/'))
}

mkdirSync(壳, { recursive: true })

let 文件 = 0
for (const 名 of 要同步) {
  const 源 = join(工具根, 名)
  if (!existsSync(源)) {
    console.log(`跳过（工具根下没有）：${名}`)
    continue
  }
  const 目标 = join(壳, 名)
  rmSync(目标, { recursive: true, force: true })
  const 清单 = []
  拷(源, 目标, 清单)
  文件 += 清单.length
  console.log(`${名} → ${清单.length} 个文件`)
}

// 壳自己的那几个文件（除 manifest.json 之外）也要进白名单。
const 白 = []
for (const 名 of readdirSync(壳).sort()) {
  if (名 === 'manifest.json') continue
  const 目标 = join(壳, 名)
  if (statSync(目标).isDirectory()) 拷(目标, 目标, 白)
  else 白.push(名)
}

const 清单文件 = join(壳, 'manifest.json')
const 旧 = existsSync(清单文件) ? JSON.parse(readFileSync(清单文件, 'utf8')) : null
const manifest = {
  schemaVersion: 1,
  id: 'eleckoi-cardforge',
  version: 旧?.version ?? '1.0.0',
  cordisConfig: 'cordis.yml',
  files: [...new Set(白)].sort(),
}
writeFileSync(清单文件, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`引擎文件 ${文件} 个 · manifest.files ${manifest.files.length} 条 → ${壳}`)
