# -*- coding: utf-8 -*-
"""把 `差分/语料/bundle/` 三个工程夹具铺全（幂等：先删后建）。

甲全界面 —— 照 `assets/骨架` 的真骨架铺，另加 SKIP_DIRS / SKIP_TAILS 的五类目录、
           两类后缀、几种「不该进包」的东西，专为 bundle 的清点分支。
乙内容层 —— 只有内容层（没有 hud/），走 `（这个工程没有 hud/，只打内容层）` 那一支。
丙空占位 —— source/ 里没有 spec，走 `HUD.find_spec` 返回空的那一支。
"""
import shutil
import sys
from pathlib import Path

根 = Path(r"E:\workGZQ\制卡工具")
语料 = 根 / "差分" / "语料" / "bundle"
骨架 = 根 / "assets" / "骨架"


def 写(p: Path, 文: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(文, encoding="utf-8", newline="\n")


def 空(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"")


def 铺甲() -> None:
    甲 = 语料 / "甲全界面"
    if 甲.exists():
        shutil.rmtree(甲)
    甲.mkdir(parents=True)
    # 真骨架：hud/（含 hud.conf.json）+ 测试/test_core.js + source/骨架.spec.yaml
    for 族 in ("hud", "测试"):
        shutil.copytree(骨架 / 族, 甲 / 族)
    (甲 / "source").mkdir()
    shutil.copyfile(骨架 / "source" / "骨架.spec.yaml", 甲 / "source" / "骨架.spec.yaml")

    # ---- SKIP_DIRS：五类目录各放一个文件，一律不该进包
    写(甲 / "__pycache__" / "x.pyc", "PYC")
    写(甲 / "out" / "y.txt", "OUT")
    写(甲 / ".git" / "config", "GIT")
    写(甲 / ".forge" / "回收站" / "z.json", "{}")
    写(甲 / "node_modules" / "z.js", "NM")
    # ---- 不是 SKIP_DIRS 的普通目录，要进包
    写(甲 / "sub" / "b.txt", "SUB")
    写(甲 / "sub" / "dir" / "深.txt", "DEEP")
    # ---- SKIP_TAILS：两类后缀（含子目录里的）
    写(甲 / "sub" / "a.pyc", "PYC2")
    写(甲 / "skip.pyo", "PYO")
    # ---- 其它「该进包」的杂项
    写(甲 / "读我.md", "读我")
    # ---- ★ 全夹具里**只许有一个** `包信息.json`：就是工程根上那一份（测「旧清单不进包」）。
    #      再往任何子目录塞一份，`DIST.build_manifest` 写进包信封的那个根级 `包信息.json`
    #      就会在 zip 里撞名 ⇒ Python 打 `UserWarning: Duplicate name: …`（行号 1661 两边不同），
    #      而 ZIP 里真会多出两条同名条目。所以 `source/` 下不放。
    写(甲 / "包信息.json", "旧清单")
    写(甲 / "别的.json", '{"a":1}')


def 铺乙() -> None:
    乙 = 语料 / "乙内容层"
    if 乙.exists():
        shutil.rmtree(乙)
    写(乙 / "source" / "乙内容层.spec.yaml", (
        "format: eleckoi.character-card\n"
        "version: 1\n"
        "character:\n"
        "  name: 乙内容层\n"
        "  description: 一个只有内容层的最小工程。\n"
        "library:\n"
        "  entries:\n"
        "    - id: e1\n"
        "      title: 一条\n"
        "      content: 正文一行。\n"
    ))
    写(乙 / "占位.txt", "占位\n")


def 铺丙() -> None:
    丙 = 语料 / "丙空占位"
    if 丙.exists():
        shutil.rmtree(丙)
    写(丙 / "占位.txt", "占位\n")
    空(丙 / "source" / ".keep")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    语料.mkdir(parents=True, exist_ok=True)
    铺甲()
    铺乙()
    铺丙()
    for d in sorted(语料.iterdir()):
        n = sum(1 for p in d.rglob("*") if p.is_file())
        print("夹具 %-8s %d 个文件" % (d.name, n))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
