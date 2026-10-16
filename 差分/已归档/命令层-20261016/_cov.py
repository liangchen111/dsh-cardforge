# -*- coding: utf-8 -*-
"""列语料里每条命令出现的次数（覆盖报告用）。"""
import collections
import json
import pathlib

P = pathlib.Path(r"E:\workGZQ\制卡工具\差分\语料\forge.json")
d = json.loads(P.read_text(encoding="utf-8"))
计 = collections.Counter()
空参 = 0
for 情 in d["情形"]:
    for 步 in 情["步"]:
        a = 步.get("argv")
        if not a:
            空参 += 1
            计["（空参 · 总表）"] += 1
        else:
            计[a[0]] += 1
print("情形 %d · 步 %d" % (len(d["情形"]), sum(len(c["步"]) for c in d["情形"])))
for k, v in sorted(计.items()):
    print("  %-18s %d" % (k, v))
print("命令数", len([k for k in 计 if k != "（空参 · 总表）"]))
