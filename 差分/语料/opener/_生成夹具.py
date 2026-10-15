# -*- coding: utf-8 -*-
"""生成 opener 差分语料要用的夹具工程（`差分/语料/opener/工程/`）。

夹具只在「语料写错」时才需要重跑一次：
    python 差分/语料/opener/_生成夹具.py
跑完 `工程/` 会被整个重建（先删后写），所以别把别的东西放进去。

规矩：
- 甲界面 / 乙内容 用 `assets/骨架` 的**原始字节**复制（那份 spec 是单引号多行标量，
  正是真卡的样子；也是 yaml.mjs 已经在跑的输入形状）。
- 其余夹具的 spec 一律写成 **JSON 文本但扩展名仍是 .spec.yaml** —— `load_structured`
  按扩展名走 yload，但 yaml.mjs 能读 JSON（content 语料里 `写内容` 落盘的就是这条路），
  用 JSON 就不必赌 ydump 的排版。
"""
import json
import shutil
import sys
from collections import OrderedDict
from pathlib import Path

根 = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(根))
from forge import model as M  # noqa: E402

骨架规格 = 根 / "assets" / "骨架" / "source" / "骨架.spec.yaml"
骨架配置 = 根 / "assets" / "骨架" / "hud" / "hud.conf.json"
出口 = 根 / "差分" / "语料" / "opener" / "工程"

标记 = "\u200b" * 3

规格底 = M.yload(str(骨架规格))
配置底 = json.loads(骨架配置.read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)


def 深拷(x):
    return json.loads(json.dumps(x, ensure_ascii=False))


def 条目(eid, kind, title, content, 消息=None, 默认=None):
    e = 深拷(规格底["library"]["entries"][0])
    e["id"] = eid
    e["kind"] = kind
    e["title"] = title
    e["content"] = content
    e["group_id"] = ""
    e["enabled"] = True
    if kind == "opening":
        e["opening_messages"] = 深拷(消息) if 消息 else []
        e["default_opening_message_id"] = 默认 or ""
    else:
        e["opening_messages"] = []
        e["default_opening_message_id"] = ""
    return e


def 造规格(名, 条目表):
    s = 深拷(规格底)
    s["character"]["name"] = 名
    s["library"]["entries"] = 条目表
    s["library"]["groups"] = []
    return s


def 造配置(名, 正文, 条目id, 去开场白=False):
    c = 深拷(配置底)
    c["卡名"] = 名
    if 去开场白:
        c.pop("开场白", None)
    else:
        c["开场白"] = OrderedDict([("条目", 条目id), ("正文", 正文)])
    return c


def 落(名, 规格=None, 配置=None):
    目 = 出口 / 名
    if 规格 is not None:
        (目 / "source").mkdir(parents=True, exist_ok=True)
        M.jdump(规格, str(目 / "source" / (名 + ".spec.yaml")))
    if 配置 is not None:
        (目 / "hud").mkdir(parents=True, exist_ok=True)
        M.jdump(配置, str(目 / "hud" / "hud.conf.json"))
    if 规格 is None and 配置 is None:
        目.mkdir(parents=True, exist_ok=True)


def 落原名(名, 规格源=None, 配置源=None):
    """按原始字节复制（不重新序列化）。"""
    目 = 出口 / 名
    if 规格源 is not None:
        (目 / "source").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(规格源, 目 / "source" / (名 + ".spec.yaml"))
    if 配置源 is not None:
        (目 / "hud").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(配置源, 目 / "hud" / "hud.conf.json")


def main():
    if 出口.exists():
        shutil.rmtree(出口)
    出口.mkdir(parents=True)

    # ① 甲界面：原始字节的 spec ＋ 与它一致的 conf（写回一致 ⇒ True；标记数 3）
    落原名("甲界面", 规格源=骨架规格, 配置源=骨架配置)

    # ② 乙内容：同一份 spec，但没有 hud/ ⇒ 「内容」工程
    落原名("乙内容", 规格源=骨架规格)

    # ③ 丙无开场白：conf 里没有「开场白」这个键
    落(
        "丙无开场白",
        规格=造规格("丙无开场白", [
            条目("丙-opening", "opening", "开场白", "丙的正文。" + 标记),
            条目("丙-other", "normal", "别的条目", "别的正文。"),
        ]),
        配置=造配置("丙无开场白", "无所谓的正文。" + 标记, "丙-opening", 去开场白=True),
    )

    # ④ 丁无条目：conf 指着一个不存在的条目 id，spec 里也没有 kind:opening 的条目
    落(
        "丁无条目",
        规格=造规格("丁无条目", [条目("丁-normal", "normal", "普通条目", "普通正文。")]),
        配置=造配置("丁无条目", "丁的正文。" + 标记, "没有这一条"),
    )

    # ⑤ 戊坏标记：末尾只有 2 个标记（conf 与 spec 一致 ⇒ 写回一致 True）
    落(
        "戊坏标记",
        规格=造规格("戊坏标记", [条目("戊-opening", "opening", "开场白", "坏标记。" + "\u200b" * 2)]),
        配置=造配置("戊坏标记", "坏标记。" + "\u200b" * 2, "戊-opening"),
    )

    # ⑥ 己尖括号：正文里带 < >（读得出来，但改正文 / 规范正文 该拦）
    尖 = "带 <b> 角标 & 大于 > 的正文。" + 标记
    落(
        "己尖括号",
        规格=造规格("己尖括号", [条目("己-opening", "opening", "开场白", 尖)]),
        配置=造配置("己尖括号", 尖, "己-opening"),
    )

    # ⑦ 庚不匹配：conf 正文与 spec 正文不一样 ⇒ 写回一致 False
    落(
        "庚不匹配",
        规格=造规格("庚不匹配", [条目("庚-opening", "opening", "开场白", "规格这边的正文。" + 标记)]),
        配置=造配置("庚不匹配", "配置那边的正文。" + 标记, "庚-opening"),
    )

    # ⑧ 辛无工程：没有 hud 也没有 source，用来测「定位找不到工程」
    落("辛无工程")
    (出口 / "辛无工程" / "占位.txt").write_text("占位\n", encoding="utf-8")
    (出口 / "辛无工程" / "深一").mkdir()  # 故意的空目录：测递归拷贝能不能搬空目录

    # ⑨ 壬缺标记：内容工程（没有 hud），末尾只有 2 个标记 ⇒ 补齐 走完整条路
    落(
        "壬缺标记",
        规格=造规格("壬缺标记", [条目("壬-opening", "opening", "开场白", "只有两个标记。" + "\u200b" * 2)]),
    )

    # ⑩ 癸写json：空壳，只给 _写json / _读json 当落点
    落("癸写json")
    (出口 / "癸写json" / "占位.txt").write_text("占位\n", encoding="utf-8")

    # ⑪ 子无源：只有 hud，没有 source ⇒ spec 那边整支是 None
    落("子无源", 配置=造配置("子无源", "子无源的正文。" + 标记, "子-opening"))

    # ⑫ 丑多规格：source 下两个 .spec.yaml，测 _spec 取「排完序的第一个」
    (出口 / "丑多规格" / "source").mkdir(parents=True)
    for 名 in ("a", "b"):
        M.jdump(
            造规格("丑多规格", [条目("丑-opening", "opening", "开场白", "丑 %s 的正文。%s" % (名, 标记))]),
            str(出口 / "丑多规格" / "source" / ("%s.spec.yaml" % 名)),
        )

    # ⑬ 寅缺hud：只有 source（内容工程）但正文本来就带 3 个标记 ⇒ 补齐 早退
    落(
        "寅齐全",
        规格=造规格("寅齐全", [条目("寅-opening", "opening", "开场白", "本来就有三个标记。" + 标记)]),
    )

    件 = sorted(p.relative_to(出口).as_posix() for p in 出口.rglob("*") if p.is_file())
    print("夹具 %d 件：" % len(件))
    for p in 件:
        print("  " + p)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
