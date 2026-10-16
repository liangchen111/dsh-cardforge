# -*- coding: utf-8 -*-
"""把「Node 的 position」映射到「CPython 的 line/column」的规则探针。

样本与 `差分/语料/plan.json` 的「坏.json」同源。CPython 侧真值由本脚本打印；
Node 侧由 `_probe_plan_jsonpos.mjs` 打印，两边对读。
"""
import json
import sys

样本: list[tuple[str, str]] = [
    ("坏.json（语料同源）", '{\n  "format": "eleckoi.character-card",\n  "version": 1,\n  "character": {\n}\n'),
    ("缺逗号·行中", '{\n  "a": 1\n  "b": 2\n}\n'),
    ("缺冒号", '{"a" 1}'),
    ("多余数据", '{}x'),
    ("数组缺逗号", '[1 2]'),
    ("空串", ''),
    ("全空白", '   '),
    ("单词", 'nope'),
    ("尾逗号", '{"a": 1,}'),
    ("未闭合串", '"abc'),
    ("末行无换行", '{\n  "a": 1\n  "b": 2\n}'),
    ("两行空", '{\n\n}\n'),
]

出 = []
for 名, 文 in 样本:
    try:
        json.loads(文)
        错 = None
    except Exception as exc:
        # CPython：`json.JSONDecodeError` 的 `.msg/.lineno/.colno/.pos`
        msg = getattr(exc, "msg", str(exc))
        lineno = getattr(exc, "lineno", None)
        colno = getattr(exc, "colno", None)
        pos = getattr(exc, "pos", None)
        错 = {"文": str(exc), "msg": msg, "lineno": lineno, "colno": colno, "pos": pos}
    出.append({"名": 名, "原文": 文, "错": 错})

sys.stdout.write(json.dumps(出, ensure_ascii=False, indent=2) + "\n")
