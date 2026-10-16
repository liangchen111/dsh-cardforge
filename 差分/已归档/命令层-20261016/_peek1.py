# -*- coding: utf-8 -*-
import json
import pathlib

g = json.loads(pathlib.Path(r"E:\workGZQ\制卡工具\差分\黄金\forge.json").read_text(encoding="utf-8"))
steps = g["情形"][1]["步"]
out = []
for i, s in enumerate(steps, 1):
    if i <= 5 or 9 <= i <= 14:
        out.append("%d %s 回=%s" % (i, json.dumps(s["argv"], ensure_ascii=False), s["回"]))
        out.append("   出: %s" % repr(s["出"])[:500])
pathlib.Path(r"E:\workGZQ\制卡工具\差分\_peek1.txt").write_text("\n".join(out), encoding="utf-8", newline="\n")
print("ok")
