// 探：`unpack 并不存在.json` 与 `diff 二号/... ...` 在 JS 侧抛出的原始错误长什么样。
import { mkdtempSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 工作 = mkdtempSync(join(这里, '_tmp_probe_err-'))
process.chdir(工作)
const CLI = await import('../forgejs/cli.mjs')
const SB = await import('../forgejs/lib/sandbox.mjs')
SB.enable(false)

for (const argv of [['unpack', '并不存在.json'], ['diff', '二号/成品/二号.card.json', '二号/成品/再打.card.json']]) {
  try {
    await CLI.main(argv)
  } catch (e) {
    console.log(JSON.stringify(argv))
    console.log('  name=', e.name, 'code=', e.code, 'errno=', e.errno, 'syscall=', e.syscall)
    console.log('  path=', JSON.stringify(e.path))
    console.log('  message=', JSON.stringify(e.message))
    console.log('  ctor=', e.constructor.name)
  }
}
void resolve
