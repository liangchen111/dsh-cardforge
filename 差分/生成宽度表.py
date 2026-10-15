# -*- coding: utf-8 -*-
"""从 Python 的 unicodedata 生成 JS 版「东亚宽度」区间表。

用法：python 差分/生成宽度表.py
产出：forgejs/lib/east_asian_width.mjs

为什么要有这个：Python 那边 `model.disp_width()` 用 `unicodedata.east_asian_width()`，
JS 没有等价的 stdlib。与其手抄一张表，不如**从 Python 本体生成**，再用差分测试证明
两边对同一批文本给出的宽度完全一致。
"""
from __future__ import annotations

import sys
import unicodedata
from pathlib import Path

根 = Path(__file__).resolve().parent.parent
出 = 根 / "forgejs" / "lib" / "east_asian_width.mjs"

# 只收 W（宽）与 F（全角）：这两类算 2 列，其余算 1 列 —— 与 model.disp_width 一致。
宽 = []
起 = None
上 = None
for cp in range(0x110000):
    ch = chr(cp)
    try:
        是宽 = unicodedata.east_asian_width(ch) in ("W", "F")
    except ValueError:
        是宽 = False
    if 是宽:
        if 起 is None:
            起 = cp
        上 = cp
    else:
        if 起 is not None:
            宽.append((起, 上))
            起 = None
if 起 is not None:
    宽.append((起, 上))

行 = []
行.append("// 本文件由 `python 差分/生成宽度表.py` 生成 —— 别手改。")
行.append("// 数据源：Python `unicodedata.east_asian_width(ch) in ('W','F')`，")
行.append("// 与 `forge/model.py` 的 `disp_width()` 用的是同一条判据。")
行.append("//")
行.append("// Unicode 版本：%s" % unicodedata.unidata_version)
行.append("")
行.append("const 宽区间 = [")
for a, b in 宽:
    行.append("  [0x%X, 0x%X]," % (a, b))
行.append("]")
行.append("")
行.append("""/**
 * 一个字符占几列：宽/全角算 2，其余算 1。
 * @param {string} ch 单个字符
 * @returns {number}
 */
export function 字符宽度(ch) {
  const cp = ch.codePointAt(0)
  // 区间表按码点升序，用二分找。
  let  lo = 0
  let  hi = 宽区间.length - 1
  while (lo <= hi) {
    const 中 = (lo + hi) >> 1
    const [a, b] = 宽区间[中]
    if (cp < a) hi = 中 - 1
    else if (cp > b) lo = 中 + 1
    else return 2
  }
  return 1
}

/**
 * 一段文本的显示宽度。\u200b 之类零宽字符按 1 列计（与 Python 那边一致：只判 W/F）。
 * @param {unknown} text
 * @returns {number}
 */
export function 显示宽度(text) {
  let n = 0
  for (const ch of String(text)) n += 字符宽度(ch)
  return n
}
""")

出.parent.mkdir(parents=True, exist_ok=True)
出.write_text("\n".join(行) + "\n", encoding="utf-8", newline="\n")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
print("写好 %s（%d 个宽区间 · Unicode %s）" % (出, len(宽), unicodedata.unidata_version))
