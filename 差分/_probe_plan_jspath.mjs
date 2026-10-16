import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as P from '../forgejs/lib/plan.mjs'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 甲 = JSON.parse(readFileSync(join(这里, '_probe_plan_tmp', 'python_path.json'), 'utf8'))

const 我的 = {
  basename: (s) => P._basename(s),
  dirname: (s) => P._dirname(s),
  splitext: (s) => P._splitext(s),
  splitdrive: (s) => P._splitdrive(s),
  join_cwd: (s) => P._join(process.cwd(), s),
  abspath: (s) => P._abspath(s),
  normpath: (s) => P._normpath(s)
}

let 坏 = 0
const 报 = []
for (const [s, rec] of Object.entries(甲.串)) {
  for (const [fn, 期] of Object.entries(rec)) {
    const 实 = 我的[fn](s)
    if (JSON.stringify(期) !== JSON.stringify(实)) {
      坏 += 1
      if (报.length < 60) 报.push(`  ${fn}(${JSON.stringify(s)})\n     Py: ${JSON.stringify(期)}\n     JS: ${JSON.stringify(实)}`)
    }
  }
}
for (const 组 of 甲.两段) {
  const 期 = 组[组.length - 1]
  const 实 = P._join(...组.slice(0, -1))
  if (JSON.stringify(期) !== JSON.stringify(实)) {
    坏 += 1
    if (报.length < 70) 报.push(`  _join(${组.slice(0, -1).map((x) => JSON.stringify(x)).join(', ')})\n     Py: ${JSON.stringify(期)}\n     JS: ${JSON.stringify(实)}`)
  }
}
console.log(`路径差异数： ${坏}  （串 ${Object.keys(甲.串).length} 条 × 7 函数 + join 组 ${甲.两段.length}）`)
console.log(报.join('\n'))
// 关键中间量
console.log('cwd             =', JSON.stringify(process.cwd()))
console.log('_disp(cwd)      =', JSON.stringify(P._disp(process.cwd())))
console.log('_normpath("E:\\\\x") =', JSON.stringify(P._normpath('E:\\x')))
console.log('_normpath("E:\\\\")  =', JSON.stringify(P._normpath('E:\\')))
console.log('_normpath("C:")     =', JSON.stringify(P._normpath('C:')))
console.log('_splitdrive("E:\\x")=', JSON.stringify(P._splitdrive('E:\\x')))
