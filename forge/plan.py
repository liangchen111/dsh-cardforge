# -*- coding: utf-8 -*-
"""规划书 —— 写卡之前先落一份能查的文件。

为什么要它：规程一直说「先问，别编」，但**问出来的东西没有一个落脚的地方** ——
访谈做完就散了，写卡时又要重新想一遍；接手别人的卡时更没地方放「它现在是什么样」。

规划书就是那个落脚点：一张卡开工前，先把七件事写成一份 Markdown；
`--查` 会告诉你哪一节还空着、哪个角色没写弱点、变量有没有说清「谁更新」。

三种用法：

    python forge.py plan                    # 打一张空规划书（或 -o 落到文件）
    python forge.py plan <卡.json|spec.yaml>  # 从现成的卡反推一份（接手别人的卡用）
    python forge.py plan --查 规划书.md       # 查一份写完的规划书，缺什么当场说
"""
import json
import os
import re
import sys

from . import sandbox as SB

# ---------------------------------------------------------------- 九个格子
# 每项：(节标题, 这一节要回答什么, 查的时候认哪几个关键词)
格子 = [
    ("一、一句话是什么",
     "这张卡想让人**体验**什么？一句话，不要形容词堆砌。",
     None),
    ("二、调子与体裁",
     "什么调子（都市 / 西幻 / 悬疑 / 日常……）、什么体裁（连载 / 单元 / 一次性）。",
     None),
    ("三、世界",
     "时代与地点、世界的规则、**这个世界里没有的东西**（口径卡）。",
     ["没有"]),
    ("四、玩家是谁",
     "玩家扮演谁、开局处境、他能做什么、他做不到什么。",
     None),
    ("五、角色名册",
     "每人写四样：他是谁 / 他想要什么 / **他的弱点** / **他说话的腔调**。",
     ["弱点", "腔调"]),
    ("六、故事与推进",
     "主线是什么、冲突从哪来、节奏怎么排、打算怎么收（或者不收）。",
     None),
    ("七、要记的状态",
     "要记什么（字段）、初值多少、**谁在什么时候更新** —— 三样不全就别加变量。",
     ["初值", "更新"]),
    ("八、玩法要哪几条",
     "从玩法机制库里挑（见 `guide --篇 玩法`），**默认只上 3–5 条**，写清每条靠什么实现。",
     None),
    ("九、界面与交付",
     "要不要界面 / 小手机；交给谁、在什么设备上导入（手机端只认 PNG）。",
     ["导入"]),
]

占位 = ("待定", "TODO", "todo", "？？", "（空）", "(空)", "？？？")

头 = """# 规划书 · {名}

> 开工前把它填满。`python forge.py plan --查 本文件.md` 会告诉你还缺什么。
> 填的是**想法**，不是字段名 —— 卡怎么写是下一步的事。

"""


def _占位残留(行):
    """这一行还是占位吗？"""
    s = 行.strip()
    if not s or s.startswith("#") or s.startswith(">") or s.startswith("|"):
        return True
    if s.startswith("-") or s.startswith("*"):
        s = s[1:].strip()
    if not s:
        return True
    if s in 占位:
        return True
    if re.fullmatch(r"<[^>]*>", s) or re.fullmatch(r"[_\-—*·。，、\s]+", s):
        return True
    return False


def 模板(名="我的卡"):
    out = [头.format(名=名)]
    for 标题, 要答, _ in 格子:
        out.append("## %s\n\n> %s\n\n- <在这里写>\n" % (标题, 要答))
    out.append("""## 附 · 交付前自查

- [ ] `python forge.py check <工程>` 0 错
- [ ] 解包往返一致（`unpack` → `build` → `diff` 报语义完全一致）
- [ ] 常驻条目**只降不涨**（它是每轮的固定税）
- [ ] 手机端导入：给 `png` 出的 `.card.png`（JSON 手机上导不进去）
""")
    return "\n".join(out)


# ---------------------------------------------------------------- 从现成的卡反推
def _lib(native):
    lib = native.get("setting_library")
    if isinstance(lib, str):
        lib = json.loads(lib)
    if not isinstance(lib, dict):
        raise ValueError("卡里读不出设定库")
    vs = lib.get("versions") or []
    if not vs:
        raise ValueError("设定库是空的")
    return vs[0]


def 反推(卡路径, 名=None):
    with open(卡路径, "r", encoding="utf-8") as fh:
        native = json.load(fh)
    if native.get("format") != "eleckoi.character-card":
        raise ValueError("这不是 ElecKoi 卡（format=%r）" % native.get("format"))
    lib = _lib(native)
    条目 = lib.get("entries") or []
    组 = lib.get("groups") or []
    壳 = native.get("character") or {}
    名 = 名 or 壳.get("name") or os.path.splitext(os.path.basename(卡路径))[0]
    var = native.get("variable_config")
    if isinstance(var, str):
        try:
            var = json.loads(var)
        except ValueError:
            var = {}
    var = var or {}
    变量数 = len(var.get("variables") or [])
    正则数 = len(native.get("regex_rules") or [])
    开场 = [e for e in 条目 if e.get("kind") == "opening"]
    常驻 = [e for e in 条目 if e.get("trigger_mode") == "always"]

    out = [头.format(名=名)]
    out.append("## 一、一句话是什么\n\n- （反推不出来 —— 看下面的条目，自己补一句）\n")
    out.append("## 二、调子与体裁\n\n- （自己补）\n")
    out.append("## 三、世界\n\n- 这个世界没有的东西（口径卡）：自己补一句\n- 设定库分组：%s\n- 世界观类条目：%s\n" % (
        "、".join(g.get("name", "?") for g in 组) or "（无分组）",
        "、".join(e.get("title", "?") for e in 条目
                if any(k in (e.get("title") or "") for k in ("世界", "设定", "地理", "势力"))) or "（无）"))
    out.append("## 四、玩家是谁\n\n- （自己补：开场白里能看出一点）\n")
    名册 = [e for e in 条目 if any(k in (e.get("title") or "") for k in ("角色", "NPC", "名册"))]
    out.append("## 五、角色名册\n\n%s\n" % (
        "\n".join("- %s —— **弱点**：<补>；**腔调**：<补>" % e.get("title") for e in 名册)
        or "- （没找到角色类条目：自己补）"))
    out.append("## 六、故事与推进\n\n- 条目里的故事类：%s\n" % (
        "、".join(e.get("title", "?") for e in 条目
                if any(k in (e.get("title") or "") for k in ("故事", "主线", "冲突", "节奏"))) or "（无）"))
    out.append("## 七、要记的状态\n\n%s\n" % (
        "- 变量 %d 条 —— 逐条确认「初值」与「谁更新」\n" % 变量数 if 变量数
        else "- **这条卡没有变量**。要用「会变的状态」才加（初值 / 谁更新 两样都得答得上来）。\n"))
    out.append("## 八、玩法要哪几条\n\n- （自己补；现成机制见 `python forge.py guide --篇 玩法`）\n")
    out.append("## 九、界面与交付\n\n- 卡内正则 %d 条%s\n- 交付：手机上导入要 `png` 出 `.card.png`；想让 AI 也拿到一份，再出 `preset`\n" % (
        正则数, "（可能含界面层，`hud` 管）" if 正则数 else ""))
    out.append("""## 附 · 现状清单（自动生成 · 别手改）

- 条目 **%d** 条 · 分组 **%d** 组 · 变量 **%d** · 正则 **%d**
- 常驻 **%d** 条（共 %d 字）—— 只降不涨
- 开场白 **%d** 条
""" % (len(条目), len(组), 变量数, 正则数, len(常驻),
       sum(len(e.get("content") or "") for e in 常驻), len(开场)))
    out.append("### 条目全表\n\n| 标题 | 分组 | 触发 | 策略 | 字数 |\n|---|---|---|---|---|\n")
    for e in 条目:
        out.append("| %s | %s | %s | %s | %d |\n" % (
            e.get("title", "?"),
            next((g.get("name", "") for g in 组 if g.get("id") == e.get("group_id")), "—") or "—",
            e.get("trigger_mode") or "—",
            e.get("agent_read_strategy") or "—",
            len(e.get("content") or "")))
    return "".join(out)


# ---------------------------------------------------------------- 查
def 查(文本):
    问题 = []
    缺节 = []
    for 标题, _, 必含 in 格子:
        m = re.search(r"^##\s*%s\s*$(.*?)(?=^##\s|\Z)" % re.escape(标题), 文本, re.S | re.M)
        if not m:
            缺节.append(标题)
            continue
        体 = m.group(1)
        实 = [ln for ln in 体.splitlines() if not _占位残留(ln)]
        if not 实:
            问题.append("「%s」还是空的 —— %s" % (标题, "填一句就够"))
            continue
        正文 = "\n".join(实)
        for 词 in (必含 or []):
            if 词 not in 正文:
                # 「没有 / 不要 / 不加 / 无」这类明确否定也算答了
                if re.search(r"(没有|不要|不加|不做|无[。，,\s]|不存在)", 正文):
                    continue
                问题.append("「%s」里看不到「%s」—— 这一项最容易漏，也最容易崩" % (标题, 词))
    if 缺节:
        问题.append("少了这几节：%s（照 `python forge.py plan` 打一份新的）" % "、".join(缺节))
    return 问题


# ---------------------------------------------------------------- CLI
def _读(路径):
    with open(路径, "r", encoding="utf-8") as fh:
        return fh.read()


def main(argv):
    argv = list(argv)
    查模式 = "--查" in argv or "--check" in argv
    if 查模式:
        argv = [a for a in argv if a not in ("--查", "--check")]
        if not argv:
            print("用法：python forge.py plan --查 <规划书.md>")
            return 2
        try:
            文本 = _读(argv[0])
        except OSError as exc:
            print("!! %s" % exc)
            return 1
        问题 = 查(文本)
        print("规划书体检 · %s" % argv[0])
        print("=" * 66)
        if 问题:
            for p in 问题:
                print("  ✗ %s" % p)
            print("-" * 66)
            print("%d 处待补 —— 补完再开工，比写到一半返工便宜得多。" % len(问题))
            return 1
        print("  ✔ 九节齐、该有的都有。可以开工写卡了。")
        return 0

    出 = None
    for i, a in enumerate(argv):
        if a in ("-o", "--out") and i + 1 < len(argv):
            出 = argv[i + 1]
            argv = argv[:i] + argv[i + 2:]
            break
    源 = argv[0] if argv else None
    try:
        if 源:
            文本 = 反推(源)
            说明 = "从 %s 反推" % os.path.basename(源)
        else:
            文本 = 模板()
            说明 = "空模板"
    except (OSError, ValueError, KeyError) as exc:
        print("!! %s" % exc)
        return 1

    if 出:
        _写文本(出, 文本)
        print("✔ 规划书（%s）→ %s" % (说明, 出))
        print("  填完用 `python forge.py plan --查 %s` 查一遍再开工。" % 出)
        return 0
    sys.stdout.write(文本)
    return 0


def _写文本(路径, 文本):
    路径 = os.path.abspath(路径)
    目录 = os.path.dirname(路径) or "."
    if not os.path.isdir(目录):
        os.makedirs(目录, exist_ok=True)
    临时 = 路径 + ".part"
    with open(临时, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(文本)
    SB.land(临时, 路径)
    SB.cleanup(临时)
