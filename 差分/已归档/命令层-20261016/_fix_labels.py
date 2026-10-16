# -*- coding: utf-8 -*-
"""把 forge.mjs 里「Python 赋值被写成 JS 标签语句」的 27 处 `标识符:` 改成 `标识符 =`。

行号来自 `差分\\_find_labels.mjs`（用 `node --check` 当判定器：把 `标识符:` 换成
`标识符:;` 后文件仍能解析 ⇒ 原样就是一条**标签语句**，它什么都不做）。
"""
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

目标 = r"E:\workGZQ\制卡工具\forgejs\forge.mjs"
行号 = [178, 180, 184, 316, 483, 486, 488, 528, 529, 531, 532, 545, 547,
        582, 595, 626, 752, 812, 814, 845, 850, 852, 886, 896, 898, 907, 1023]

文 = open(目标, encoding="utf-8").read()
行 = 文.split("\n")
改了 = []
for n in 行号:
    i = n - 1
    旧 = 行[i]
    新 = re.sub(r"^(\s*)([^\W\d]\w*)\s*:\s", r"\1\2 = ", 旧, count=1)
    assert 新 != 旧, "第 %d 行没换成：%r" % (n, 旧)
    assert not re.match(r"^\s*[^\W\d]\w*\s*:\s", 新), "第 %d 行换完还像标签：%r" % (n, 新)
    行[i] = 新
    改了.append((n, 旧.strip(), 新.strip()))

新文 = "\n".join(行)
assert len(新文) >= len(文), "长度不该缩水"
open(目标, "w", encoding="utf-8", newline="").write(新文)
print("改了 %d 行" % len(改了))
for n, a, b in 改了:
    print("  %5d  %s\n         -> %s" % (n, a[:78], b[:78]))
