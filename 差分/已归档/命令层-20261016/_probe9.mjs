// 临时探针：模块卡落盘后 hud/ 到底在不在
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as scaffold from '../forgejs/lib/scaffold.mjs'

const 根 = mkdtempSync(join(tmpdir(), 'probe9_'))
try {
  const proj = scaffold.new_card('模块卡', 根, null, true, ['骰子', '备份'])
  console.log('工程 =', proj)
  console.log('hud 存在 =', existsSync(join(proj, 'hud')))
  console.log('hud/模块 存在 =', existsSync(join(proj, 'hud', '模块')))
  console.log('hud 下 =', existsSync(join(proj, 'hud')) ? readdirSync(join(proj, 'hud')).join(' , ') : '(无)')
  console.log('工程下 =', readdirSync(proj).join(' , '))
} catch (e) {
  console.log('炸了：', e.message)
  console.log(e.stack)
} finally {
  try { rmSync(根, { recursive: true, force: true }) } catch {}
}
