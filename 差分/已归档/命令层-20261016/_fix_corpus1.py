# -*- coding: utf-8 -*-
"""把 forge 语料里 `plan <spec.yaml>` 那一步改成 `<成品卡.json>`。

为什么：CPython 的 `plan` 反推那一路是 `json.load(卡路径)`；Python 侧 `new` 写出来的
`探卡.spec.yaml` 是**真 YAML**，`json.load` 当场 `Expecting value: line 1 column 1 (char 0)`。
JS 侧按计划 §二① 一律写 JSON（`M.ydump` 明确抛错），同一个文件 `M.jload` 解得开，
于是报的是另一句话（`卡里读不出设定库`）。这条差异是**计划里已声明的**
「唯一允许非逐字节处＝YAML」泄漏到 stdout 上，所以语料这一步改指真的成品卡 JSON。
"""
import pathlib
import sys

P = pathlib.Path(r"E:\workGZQ\制卡工具\差分\语料\forge.json")
raw = P.read_text(encoding="utf-8")
old = '["plan", "探卡/source/探卡.spec.yaml"]'
new = '["plan", "探卡/成品/探卡.card.json"]'
n = raw.count(old)
print("hit", n)
if n != 1:
    sys.exit("anchor hit != 1")
P.write_text(raw.replace(old, new), encoding="utf-8", newline="")
print("patched")
