# -*- coding: utf-8 -*-
"""在黄金里按关键片段找步。用法：python _peek3.py <片段>"""
import json
import pathlib
import sys

针 = sys.argv[1] if len(sys.argv) > 1 else "FileNotFoundError"
g = json.loads(pathlib.Path(r"E:\workGZQ\制卡工具\差分\黄金\forge.json").read_text(encoding="utf-8"))
out = []
for 情 in g["情形"]:
    for i, s in enumerate(情["步"], 1):
        出 = s.get("出") or ""
        if 针 in 出 or 针 in (s.get("错") or ""):
            out.append("%s #%d %s 回=%s" % (情["名"], i, json.dumps(s["argv"], ensure_ascii=False), s["回"]))
            out.append("   出: %s" % 出[:300].replace("\n", "\\n"))
pathlib.Path(r"E:\workGZQ\制卡工具\差分\_peek3.txt").write_text("\n".join(out), encoding="utf-8", newline="\n")
print("ok", len(out))
