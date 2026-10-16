// 定位自检第 12 项（ElecKoi -> 酒馆 -> ElecKoi）在 forgejs 侧的差异点。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as M from '../forgejs/lib/model.mjs'
import * as pack from '../forgejs/lib/pack.mjs'
import * as scaffold from '../forgejs/lib/scaffold.mjs'
import * as exportMod from '../forgejs/lib/export.mjs'
import * as bridge from '../forgejs/lib/bridge.mjs'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 工作 = mkdtempSync(join(这里, '_tmp_probe12-'))
const 无 = () => {}

function scrub(o) {
  if (Array.isArray(o)) return o.map(scrub)
  if (o && typeof o === 'object') {
    const r = {}
    for (const k of Object.keys(o)) {
      if (['created_at', 'updated_at', 'updatedAt', 'config_updated_at'].includes(k)) continue
      r[k] = scrub(o[k])
    }
    return r
  }
  if (typeof o === 'string' && (o[0] === '{' || o[0] === '[')) {
    try { return scrub(JSON.parse(o)) } catch { return o }
  }
  return o
}

function 走(a, b, 路, 出) {
  if (出.length >= 25) return
  if (a === b) return
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b
  if (ta !== tb) { 出.push(`${路} 类型 ${ta} vs ${tb}`); return }
  if (ta === 'object' || ta === 'array') {
    const ka = ta === 'array' ? a.map((_, i) => i) : Object.keys(a)
    const kb = ta === 'array' ? b.map((_, i) => i) : Object.keys(b)
    for (const k of ka) if (!kb.includes(k)) 出.push(`${路}.${k} 只在左边（值 ${JSON.stringify(a[k]).slice(0, 60)}）`)
    for (const k of kb) if (!ka.includes(k)) 出.push(`${路}.${k} 只在右边（值 ${JSON.stringify(b[k]).slice(0, 60)}）`)
    for (const k of ka) if (kb.includes(k)) 走(a[k], b[k], `${路}.${k}`, 出)
    return
  }
  出.push(`${路} 左=${JSON.stringify(a).slice(0, 80)} 右=${JSON.stringify(b).slice(0, 80)}`)
}

try {
  scaffold.new_card('自检卡', 工作, null, true)
  const spec = join(工作, '自检卡', 'source', '自检卡.spec.yaml')
  const card_path = join(工作, '自检卡.card.json')
  pack.build(spec, card_path)
  const card2 = M.jload(card_path)
  const back = join(工作, 'back.json')
  exportMod.to_tavern(card_path, back, false, 无)
  const sp4 = join(工作, 'back.spec.yaml')
  bridge.to_eleckoi(back, sp4, 无)
  const card4 = pack.spec_to_card(sp4)
  {
    const bj = M.jload(back)
    const bk = (bj.data && bj.data.character_book) || bj.character_book || {}
    const es = bk.entries || []
    console.log('酒馆书条目：')
    es.forEach((e, i) => console.log(`   ${i}  name=${JSON.stringify(e.name)} constant=${e.constant} insertion_order=${e.insertion_order}`))
    console.log('desc 前 200：', JSON.stringify(String((bj.data || {}).description || '').slice(0, 200)))
    const sp4j = M.yload(sp4)
    console.log('回读 spec 条目：')
    for (const e of ((sp4j.library || {}).entries || [])) {
      console.log(`   title=${JSON.stringify(e.title)} order=${e.order} position=${JSON.stringify(e.position)}`)
    }
  }
  const a = scrub(card2), b = scrub(card4)
  const 名 = (x) => (x.setting_library.versions[0].entries || []).map((e) => `${e.order}:${e.title}@${e.group_id}`)
  console.log('左顺序：'); for (const s of 名(a)) console.log('   ' + s)
  console.log('右顺序：'); for (const s of 名(b)) console.log('   ' + s)
  const 出 = []
  走(a, b, '', 出)
  console.log('差异处数：', 出.length)
  for (const x of 出) console.log('  ' + x)
  const A = JSON.stringify(a), B = JSON.stringify(b)
  console.log('串长：', A.length, B.length)
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (A[i] !== B[i]) {
      console.log('第一处不同 idx=' + i)
      console.log('  左：' + A.slice(Math.max(0, i - 120), i + 120))
      console.log('  右：' + B.slice(Math.max(0, i - 120), i + 120))
      break
    }
  }
} finally {
  rmSync(工作, { recursive: true, force: true })
}
