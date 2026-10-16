# -*- coding: utf-8 -*-
"""扫「Python 赋值被写成 JS 标签语句」的移植事故：`x: expr` 在语句位。

判据：行首 `标识符:`、行尾不是逗号（对象字面量的键通常带逗号），
且该行不是 `case X:` / `default:` 分支。
命中后打印上一行非空非注释行，人工看它是不是 `{` / `,` / `(` 收尾（对象字面量）。
"""
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

根 = r"E:\workGZQ\制卡工具"
文件 = [
    r"forgejs\forge.mjs",
    r"差分\_st_pre.js", r"差分\_st_partA.js", r"差分\_st_partB.js",
    r"差分\_st_partC.js", r"差分\_st_partD.js", r"差分\_st_partE.js",
    r"差分\_st_partF.js", r"差分\_st_partG.js",
]
pat = re.compile(r"^\s*([^\W\d]\w*)\s*:\s+\S")

n = 0
for rel in 文件:
    p = 根 + "\\" + rel
    try:
        lines = open(p, encoding="utf-8").read().split("\n")
    except FileNotFoundError:
        print("（没有 %s）" % rel)
        continue
    for i, 行 in enumerate(lines):
        m = pat.match(行)
        if not m:
            continue
        if m.group(1) in ("case", "default"):
            continue
        s = 行.rstrip()
        if s.endswith(","):
            continue
        前 = ""
        for j in range(i - 1, -1, -1):
            t = lines[j].strip()
            if t and not t.startswith("//"):
                前 = t
                break
        n += 1
        print("%s:%d | 前=%s | %s" % (rel, i + 1, 前[-46:], s.strip()[:100]))
print("—— 共 %d 处待人工确认" % n)
