# -*- coding: utf-8 -*-
"""数覆盖 —— 差分「绿了」不等于「搬完了」。

用法：
    python 差分/数覆盖.py validate        # 数 validate 的黄金覆盖了哪些诊断 code
    python 差分/数覆盖.py                # 数全部黄金

为什么要有它：一块模块差分全绿，只证明**语料走到过的那几条路**行为一致。
本模块里 `_check_opener`、`validate_project` 有一大段要读 `source/*.spec.yaml`，
JS 侧 YAML 子集读取器还没落地 ⇒ 那几条路此刻注定不同，语料里就绕开了它们。
绕开之后差分照样全绿 —— 这份脚本把「绕开了哪些」摆到台面上，免得好消息被当成全功。
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

根 = Path(__file__).resolve().parent.parent
黄金目录 = 根 / "差分" / "黄金"
CODE = re.compile(r'(?:[A-Za-z_][A-Za-z0-9_]*\.)?(?:err|warn|info)\(\s*"([A-Z0-9-]+)"')


def 收(gold) -> Counter:
    """从黄金 JSON 里递归收所有 `"code": "XXX"`。"""
    c: Counter = Counter()

    def 走(x):
        if isinstance(x, dict):
            if isinstance(x.get("code"), str):
                c[x["code"]] += 1
            for v in x.values():
               走(v)
        elif isinstance(x, list):
            for v in x:
                走(v)

    走(gold)
    return c


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    名单 = argv[1:] or sorted(p.stem for p in 黄金目录.glob("*.json"))
    总缺 = 0
    for 名 in 名单:
        金 = json.loads((黄金目录 / ("%s.json" % 名)).read_text(encoding="utf-8"))
        实 = 收(金)
        源 = 根 / "forge" / ("%s.py" % 名)
        if not 源.exists():
            print("%-10s 黄金里 %d 种 code（没有 forge/%s.py 可对照）" % (名, len(实), 名))
            continue
        全 = sorted(set(CODE.findall(源.read_text(encoding="utf-8"))))
        if not 全:
            print("%-10s 本模块没有 code 型诊断（黄金里 %d 种，多半来自别的模块）" % (名, len(实)))
            continue
        缺 = [x for x in 全 if x not in 实]
        总缺 += len(缺)
        print("%-10s 源码 %d 种 · 黄金覆盖 %d 种 · 未覆盖 %d 种" % (名, len(全), len(全) - len(缺), len(缺)))
        if 缺:
            print("           未覆盖：%s" % "、".join(缺))
    print()
    print("总结论：" + ("全覆盖 ✔" if 总缺 == 0 else "有 %d 种 code 没被语料走到 ⚠" % 总缺))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
