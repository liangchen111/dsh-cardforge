# -*- coding: utf-8 -*-
"""跑一遍全部差分 —— 新会话接手时的一条命令。

用法：
    python 差分/跑.py            # 比一比（用现有黄金）
    python 差分/跑.py --刷        # 先用 Python 版刷黄金，再比（只在确认行为变更时用）
    python 差分/跑.py --刷 model  # 只刷某一份

为什么要有它：差分是两件事（Python 出黄金 + Node 逐字节比），
分开敲容易漏掉一半 —— 漏了就会把「没刷黄金」当成「JS 写错了」。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

根 = Path(__file__).resolve().parent.parent
PY = r"C:\Users\Administrator\.workbuddy\binaries\python\envs\cardforge\Scripts\python.exe"
NODE = r"D:\node.exe"


def 跑(参数, 标题):
    print("—" * 8 + " " + 标题)
    子 = subprocess.run(参数, cwd=str(根), capture_output=True)
    出 = (子.stdout or b"").decode("utf-8", "replace") + (子.stderr or b"").decode("utf-8", "replace")
    print(出.rstrip())
    return 子.returncode


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    刷 = "--刷" in argv
    目标 = [a for a in argv[1:] if not a.startswith("--")]
    码 = 0
    if 刷:
        码 |= 跑([PY, "差分/出黄金.py"] + 目标, "刷黄金（Python 版）")
    码 |= 跑([NODE, "差分/比一比.mjs"] + 目标, "逐字节比（JS 版）")
    print()
    print("总结论：" + ("全绿 ✔" if 码 == 0 else "有红 ✘"))
    return 码


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
