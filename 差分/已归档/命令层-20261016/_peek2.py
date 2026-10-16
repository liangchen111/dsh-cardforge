# -*- coding: utf-8 -*-
import json
import pathlib

g = json.loads(pathlib.Path(r"E:\workGZQ\制卡工具\差分\黄金\forge.json").read_text(encoding="utf-8"))
out = []
for 名, 情 in [(c["名"], c) for c in g["情形"]]:
    for i, s in enumerate(情["步"], 1):
        出 = s.get("出") or ""
        if "方案" in 出 or "开场白" in 出:
            out.append("%s #%d %s 回=%s" % (名, i, json.dumps(s["argv"], ensure_ascii=False), s["回"]))
            out.append("   出: %s" % 出[:260].replace("\n", "\\n"))
pathlib.Path(r"E:\workGZQ\制卡工具\差分\_peek2.txt").write_text("\n".join(out), encoding="utf-8", newline="\n")
print("ok", len(out))
