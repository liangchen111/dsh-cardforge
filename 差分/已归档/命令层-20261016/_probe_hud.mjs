// 复现 `hud 探卡` 一步的 JS 侧。
import { mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 根 = resolve(这里, '..')
const CLI = await import('../forgejs/cli.mjs')
const SB = await import('../forgejs/lib/sandbox.mjs')

const 工作 = mkdtempSync(join(这里, '_tmp_probe_hud-'))
process.chdir(工作)
const 原沙箱 = SB.enabled()
SB.enable(false)

const 跑 = async (argv) => {
  let 出文 = ''
  const 原写 = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { 出文 += String(s); return true }
  let rc
  try { rc = await CLI.main(argv) } finally { process.stdout.write = 原写 }
  return [rc, 出文]
}

const [rc1] = await 跑(['new', '探卡', '--到', '.', '--id', 'fix'])
console.log('new rc=', rc1)
const [rc2, o2] = await 跑(['hud', '探卡'])
console.log('hud rc=', rc2)
writeFileSync(join(这里, '_probe_hud_js.txt'), `rc=${rc2}\n${o2}`, 'utf8')
SB.enable(原沙箱)
