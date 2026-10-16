// 临时探针：复现自检第 37 / 41 项的 `.map is not a function`
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as scaffold from '../forgejs/lib/scaffold.mjs'
import * as CONTENT from '../forgejs/lib/content.mjs'

const _P = () => {}
const 工作 = mkdtempSync(join(tmpdir(), 'probe37_'))
try {
  const proj = scaffold.new_card('探针卡', 工作, null, true)
  const spec = join(proj, 'source', '探针卡.spec.yaml')
  CONTENT.add_group(spec, '甲组', '', _P)
  for (const t of ['甲一', '甲二', '甲三']) {
    CONTENT.add_entry(spec, t, '', '关键词', '正文 ' + t, '试', null, null, _P)
  }
  const 列 = CONTENT.list_entries(spec)
  console.log('list_entries 类型：', Object.prototype.toString.call(列), Array.isArray(列))
  console.log('第一行：', JSON.stringify(列[0]))
  const m = 列.map((r) => r['标题'])
  console.log('map ok：', m)
  CONTENT.move_entries(spec, ['甲一', '甲二', '甲三'], '甲组', _P)
  console.log('move ok')
  CONTENT.set_entries_enabled(spec, ['甲一', '甲二'], false, _P)
  console.log('enable ok')
  CONTENT.del_entries(spec, ['甲一', '甲二', '甲三'], _P)
  console.log('del ok')
  CONTENT.restore(spec, '1', _P)
  console.log('restore ok')
} catch (e) {
  console.log('炸了：', e.message)
  console.log(e.stack)
} finally {
  try { rmSync(工作, { recursive: true, force: true }) } catch {}
}
