/**
 * 用 `node --check` 当判定器，找出「Python 赋值被写成 JS 标签语句」的行。
 *
 * 原理：把某行的 `标识符:` 换成 `标识符:;`。
 *   - 原样是**标签语句**（bug）⇒ 换完仍是合法 JS（带标签的空语句）⇒ --check 通过。
 *   - 原样是**对象字面量的键** ⇒ 换完 `键:; 值` 语法错 ⇒ --check 失败。
 * 所以「替换后仍能过 --check」的那些行，就是标签语句。
 *
 * 注意：这一招对「值后面还挂着逗号」的行会误判成对象（因为逗号在语句位非法），
 * 所以还要人工把这份名单过一遍。
 */
import { copyFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const 目标 = process.argv[2]
const 临时 = 目标 + '.lblprobe.mjs'
const 行 = readFileSync(目标, 'utf8').split('\n')
const 候选 = []
const pat = /^(\s*)([^\W\d]\w*)\s*:\s(\S)/
for (let i = 0; i < 行.length; i++) {
  const m = pat.exec(行[i])
  if (!m) continue
  if (['case', 'default'].includes(m[2])) continue
  候选.push(i)
}

const 是标签 = []
for (const i of 候选) {
  const 备份 = 行[i]
  行[i] = 备份.replace(/^(\s*)([^\W\d]\w*)\s*:/, '$1$2:;')
  writeFileSync(临时, 行.join('\n'), 'utf8')
  let 过 = true
  try {
    execFileSync(process.execPath, ['--check', 临时], { stdio: 'ignore' })
  } catch {
    过 = false
  }
  行[i] = 备份
  if (过) 是标签.push(i + 1)
}
try { unlinkSync(临时) } catch { /* 没建起来就算了 */ }
console.log('候选 ' + 候选.length + ' 行')
console.log('判定为标签语句（bug）的行号：' + (是标签.length ? 是标签.join(', ') : '（无）'))
for (const n of 是标签) console.log('  ' + n + ': ' + 行[n - 1].trim())
