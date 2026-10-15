/**
 * 比一比 —— 用 **JS 版** 对同一份语料算一遍，和 `差分/黄金/<名>.json` **逐字节比**。
 *
 * 规矩：任何一处不同，要么是 bug，要么是有意为之的格式变更；后者必须先在
 * `文档/重写-JS引擎-计划.md` 里写明、再刷黄金。**不许悄悄放行。**
 *
 * 用法：
 *   node 差分/比一比.mjs            # 比全部
 *   node 差分/比一比.mjs model      # 只比某一份
 */
import { readFileSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as M from '../forgejs/lib/model.mjs'
import * as D from '../forgejs/lib/domain.mjs'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 根 = resolve(这里, '..')
const 语料目录 = join(根, '差分', '语料')
const 黄金目录 = join(根, '差分', '黄金')

const 读 = (p) => readFileSync(p, 'utf8')

function 算_model(料) {
  const 出 = {}
  出.常量 = {
    CARD_FORMAT: M.CARD_FORMAT,
    LIB_FORMAT: M.LIB_FORMAT,
    VAR_FORMAT: M.VAR_FORMAT,
    STAT_ROOT: M.STAT_ROOT,
  }
  出.键序 = {
    CHARACTER_KEYS: [...M.CHARACTER_KEYS],
    ENTRY_KEYS: [...M.ENTRY_KEYS],
    ENTRY_MESSAGE_KEYS: [...M.ENTRY_MESSAGE_KEYS],
    GROUP_KEYS: [...M.GROUP_KEYS],
    VAR_OBJECT_KEYS: [...M.VAR_OBJECT_KEYS],
    VAR_ITEM_KEYS: [...M.VAR_ITEM_KEYS],
    REGEX_KEYS: [...M.REGEX_KEYS],
  }
  出.ordered = 料.ordered.map((项) => Object.entries(M.ordered(项.src, 项.keys)))
  出.dispWidth = 料.dispWidth.map((文) => M.dispWidth(文))
  出.pad = 料.pad.map((项) => M.pad(项.text, 项.width, 项.align))
  出.estTokens = 料.estTokens.map((文) => M.estTokens(文))
  出.asciiPrefix = 料.asciiPrefix.map((项) => M.asciiPrefix(项.name, 项.fallback))
  出.stripUploadPrefix = 料.stripUploadPrefix.map((名) => M.stripUploadPrefix(名))
  出.issueLine = 料.issueLine.map((项) =>
    new M.Issue(项.level, 项.code, 项.where, 项.message, 项.fix).line())
  出.RE_SLASH = ['/abc/g', '〔面板〕', '/^.+$/isu', 'abc', '/a']
    .map((样本) => M.RE_SLASH.test(样本))
  出.isYaml = ['a.yaml', 'a.YML', 'a.json', 'a', 'a.txt'].map((名) => M.isYaml(名))

  出.jdump = 料.jdump.map((项) => {
    const 路径 = M.tempJson()
    try {
      M.jdump(项.obj, 路径, 项.indent)
      return 读(路径)
    } finally {
      try { unlinkSync(路径) } catch { /* 删不掉就算了 */ }
    }
  })

  出.形状 = {
    uuid4hex: /^[0-9a-f]{32}$/.test(M.uuid4hex()),
    newId: /^card-[0-9a-f]{32}$/.test(M.newId('card')),
    nowIso: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}[+-]\d{2}:\d{2}$/.test(M.nowIso()),
  }
  return 出
}

const 算式 = { model: 算_model }

function 算_domain(料) {
  const 出 = {}
  出.条目 = 料.条目.map((项) => D.checkEntryDomains(项.entry, 项.where).map((i) => ({
    level: i.level, code: i.code, where: i.where, message: i.message, fix: i.fix,
  })))
  出.值域键序 = Object.keys(D.DOMAINS)
  出.表 = {}
  for (const [名, d] of Object.entries(D.DOMAINS)) {
    出.表[名] = {
      values: [...d.values],
      default: d.default,
      legacy: { ...(d.legacy ?? {}) },
      unknown_to: d.unknownTo ?? null,
      note: d.note ?? '',
    }
  }
  出.表格 = D.domainTableMarkdown()
  出.说明 = {
    POSITION_NOTE: [...D.POSITION_NOTE],
    DEAD_FIELDS: { ...D.DEAD_FIELDS },
    EMPTY_IS_DEFAULT: [...D.EMPTY_IS_DEFAULT],
  }
  return 出
}

算式.domain = 算_domain

/** 找第一处不同，返回人话。 */
function 第一处不同(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) {
      const 行号 = a.slice(0, i).split('\n').length
      const 左 = a.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, '⏎')
      const 右 = b.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, '⏎')
      return `  第 ${行号} 行 · 偏移 ${i}\n    黄金: …${左}…\n    JS  : …${右}…`
    }
  }
  if (a.length !== b.length) {
    const i = n
    return `  长度不同（黄金 ${a.length} / JS ${b.length}）· 从偏移 ${i} 起：\n` +
      `    黄金: …${a.slice(i).slice(0, 60)}…\n    JS  : …${b.slice(i).slice(0, 60)}…`
  }
  return ''
}

const 要跑的 = process.argv.slice(2)
const 名单 = 要跑的.length ? 要跑的 : Object.keys(算式).sort()
let 过 = 0
let 败 = 0
for (const 名 of 名单) {
  const 料 = JSON.parse(读(join(语料目录, `${名}.json`)))
  const js文本 = JSON.stringify(算式[名](料), null, 2)
  let 黄金文本
  try {
    黄金文本 = 读(join(黄金目录, `${名}.json`))
  } catch {
    console.log(`✘ ${名}：没有黄金文件，先跑 python 差分/出黄金.py ${名}`)
    败 += 1
    continue
  }
  if (js文本 === 黄金文本) {
    console.log(`✔ ${名}：逐字节一致（${Buffer.byteLength(js文本)} 字节）`)
    过 += 1
  } else {
    败 += 1
    console.log(`✘ ${名}：不一致`)
    console.log(第一处不同(黄金文本, js文本))
  }
}
console.log(`\n${败 === 0 ? '全绿 ✔' : '有红 ✘'}　${过} 绿 / ${败} 红`)
if (败 > 0) process.exitCode = 1
