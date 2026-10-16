/**
 * 安装入口（JS 侧）—— 对位 `E:\workGZQ\制卡工具\forge\cli.py`（37 行）与
 * `forge\__main__.py`（8 行）。
 *
 * Python 那边干的事：找到仓库根，用 `runpy.run_path(forge.py, run_name="__main__")`
 * 把根目录那个 `forge.py` 当脚本跑一遍（它会走到文件底部的
 * `if __name__ == "__main__": sys.exit(main())`）。三条路同时活着：
 * `python forge.py …`、`python -m forge …`、装过之后的 `forge …`。
 *
 * JS 侧没有 `runpy`，对等的写法是**动态 `import('./forge.mjs')` 再调它的 `main(argv)`**。
 * `forge.mjs` 自己是幂等的：只有 `import.meta.url` 与 `process.argv[1]` 指向同一文件时
 * 才自跑（见那边的 `_自跑()`），被本文件 import 时不会抢先执行。
 *
 * 移植记号（差异点，逐条记）：
 * 1. `sys.argv = [<根>/forge.py, *argv]` ⇒ 不必要：`forge.mjs` 的 `main(argv)` 直接吃数组，
 *    与 `forge.py` 的 `main(argv=None)`（吃 `sys.argv[1:]`）语义一致。argv 为 null/undefined
 *    时传 null，让 `forge.mjs` 自己取 `process.argv.slice(2)`。
 * 2. `raise SystemExit(msg)` ⇒ JS 侧抛**同名标记类** `SystemExit`（带同样的文案）。
 *    JS 的运行时没有 SystemExit，自造一个只为「文案与类型对得上」，不承诺 Python 的退出码语义。
 * 3. Python 的 `main()` 末尾 `return 0` 其实到不了 —— `runpy` 会把 `forge.py` 里那个
 *    `sys.exit(main())` 的 SystemExit 透出来，所以真实退出码来自 `forge.py` 的 `main()`。
 *    JS 侧直接 `return await FG.main(argv)`，把这个语义如实落下来。
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _normpath } from './lib/plan.mjs'

/** 对位 Python 的 `SystemExit`（只为文案与类型对得上）。 */
export class SystemExit extends Error {
  constructor(message) {
    super(message)
    this.name = 'SystemExit'
  }
}

const _这里 = dirname(fileURLToPath(import.meta.url))

/**
 * `<根>/forge/cli.py` → `<根>`；找不到 `forge.py` 就报清楚。
 *
 * 本文件住在 `<根>/forgejs/`，所以「上一层」正好也是工具根，与 Python 的
 * `dirname(dirname(__file__))` 同解 —— **别多加一层**。
 */
export function 仓库根() {
  const root = resolve(_这里, '..')
  if (existsSync(join(root, 'forge.py'))) return root
  throw new SystemExit(
    '找不到 forge.py（应当在 ' + root + ' 下）。\n' +
    '本工具是「一个文件夹」的整体：assets/、samples/、向导/ 与 forge.py 要在一起。\n' +
    '请用可编辑安装 `pip install -e .`，或直接用 `python forge.py <命令>`。')
}

/** 对位 Python 的 `main(argv=None)`：动态 import 后把 argv 原样转交给内核。 */
export async function main(argv = null) {
  const root = 仓库根()
  const FG = await import('./forge.mjs')
  const 余 = (argv === null || argv === undefined) ? null : Array.from(argv, String)
  // Python 会在这一步改写 sys.argv；JS 侧 `forge.mjs` 的 main 吃数组，故只传数组。
  void root
  return FG.main(余)
}

/** 直接 `node forgejs/cli.mjs …` 时自跑；被人 import 时不自跑。 */
export async function _自跑() {
  const 我 = fileURLToPath(import.meta.url)
  const 主 = process.argv[1] ? resolve(process.argv[1]) : ''
  if (_normpath(主) === _normpath(我)) {
    process.exitCode = await main(null)
  }
}

await _自跑()
