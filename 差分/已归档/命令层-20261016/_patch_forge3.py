# -*- coding: utf-8 -*-
"""把 `forge.mjs` 里所有打错误话的地方统一走 `_错话()`（Python `str(exc)` 的说法）。

背景：`forge.py` 的命令层到处是 `except Exception as exc: print("!! %s" % exc)`；
OSError 进 `%s` 时 CPython 给的是 `[Errno 2] No such file or directory: '相对路径'`，
Node 给的是 `ENOENT: no such file or directory, open '绝对路径'`。`main` 那一层已经翻过，
命令层自己 catch 的那二十来处也得翻 —— 用**当前命令的参数**（`_当前参`）把路径还原成
用户原样给的那一段。
"""
import pathlib
import sys

P = pathlib.Path(r"E:\workGZQ\制卡工具\forgejs\forge.mjs")
src = P.read_text(encoding="utf-8")
原文 = src

替 = [
    ("const m = String(exc && exc.message ? exc.message : '')",
     "const m = _错话(exc)", 1),
    ("_print(`!! ${exc.message}`)",
     "_print(`!! ${_错话(exc)}`)", 19),
    ("_print(`!! ${_basename(p)}: ${exc.message}`)",
     "_print(`!! ${_basename(p)}: ${_错话(exc)}`)", 1),
    ("rows.push([path, '读不出版', [`${exc.message}`]])",
     "rows.push([path, '读不出版', [`${_错话(exc)}`]])", 1),
    ("exc && exc.message !== undefined ? exc.message : exc",
     "_错话(exc)", 7),
    ("const 翻 = _python化(exc, rest)",
     "const 翻 = _python化(exc, _当前参)", 1),
]
for 旧, 新, 该 in 替:
    n = src.count(旧)
    if n != 该:
        sys.exit("count mismatch: %r 期望 %d 实得 %d" % (旧[:40], 该, n))
    src = src.replace(旧, 新)

锚 = "const _OS表 = {"
if src.count(锚) != 1:
    sys.exit("锚 1 不对")
src = src.replace(锚, "/** 当前这次 `main()` 的参数（错误话里拿它把绝对路径还原成用户原样那一段）。 */\nlet _当前参 = []\n\n\n" + 锚)

锚2 = "function _python化(exc, 候选) {"
if src.count(锚2) != 1:
    sys.exit("锚 2 不对")
src = src.replace(锚2, """/** Python `str(exc)` 那一句：OSError 型的 Node 错误翻成 CPython 说法，其余原样。 */
function _错话(exc) {
  const 翻 = _python化(exc, _当前参)
  if (翻) return 翻.话
  return exc && exc.message !== undefined ? String(exc.message) : String(exc)
}


""" + 锚2)

锚3 = "  const rest = 余.slice(1)"
if src.count(锚3) != 1:
    sys.exit("锚 3 不对")
src = src.replace(锚3, 锚3 + "\n  _当前参 = rest")

P.write_text(src, encoding="utf-8", newline="")
print("ok", len(原文), "->", len(src))
