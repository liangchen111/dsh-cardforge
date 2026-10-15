# -*- coding: utf-8 -*-
"""开场白 —— 改它只有一条正路。

开场白是权重最高的字段（开卡第一屏），但它的**真源不在 spec 里**：在
`hud/hud.conf.json` 的 `"开场白" → "正文"`；spec 里那条 `AI角色开场白` 只是派生物，
每次 `hud --写回` 都会拿 conf 的正文覆盖它。改错地方＝改了白改。

更要命的是正文末尾那三个零宽空格（U+200B）：「建卡界面」那条正则
`/\\u200B{3}/` 就是靠它触发的 —— **少一个，导入 ElecKoi 后建卡界面静默消失**。
而在 conf 里它写成一串 JSON 转义 `\\u200b\\u200b\\u200b`，手数、手写、手改
都是踩雷的路（数错几个？写成真字符还是转义？）。

所以这个模块只做一件事：让改开场白的人（以及替他动手的 AI）**只说正文是什么**，
标记由这里负责 —— 末尾不多不少，正好三个。
"""
from __future__ import annotations

import json
import os

标记 = "\u200b" * 3


class OpenerError(Exception):
    """开场白相关的问题（配置没这块、正文带尖括号…）。"""


# ------------------------------------------------------------------ 定位
def 定位(target):
    """从「工程目录 / 工程里的任意文件」找到工程根，并说清它有没有**界面层**。

    返回 `(根, 模式)`：

      · `"界面"` —— 有 `hud/hud.conf.json`。开场白的**真源在 conf**，spec 里那条是派生物。
      · `"内容"` —— 只有 `source/`（单张 `.card.json` 收进来就是这样）。这时 spec 里那条
        开场白**本身就是真源**，直接改它是对的，不存在「改了白改」。

    **为什么要有内容这一档**：以前只认界面层，于是「收一张别人给的卡 → 想换开场白」
    是条死路 —— `opener` 不认、`hud` 不肯凭空造界面层、规程又让人别手改。最后只能手抠
    那三个零宽标记，正好踩在最该消灭的那种错上。收进来先能改，才有后面的事。
    """
    p = os.path.abspath(target or ".")
    cur = p if os.path.isdir(p) else os.path.dirname(p)
    内容 = ""
    for _ in range(5):                      # 工程 / source 两层足够，多留几格
        if os.path.isfile(os.path.join(cur, "hud", "hud.conf.json")):
            return cur, "界面"
        if not 内容 and _spec(cur):
            内容 = cur
        up = os.path.dirname(cur)
        if up == cur:
            break
        cur = up
    return (内容, "内容") if 内容 else (None, "")


def 工程(target):
    """只认**有界面层**的工程（真源在 conf）。没界面层时返回 None —— 用 `定位` 取内容档。"""
    根, 模式 = 定位(target)
    return 根 if 模式 == "界面" else None


def _开场白条目(spec_p):
    """spec 里那条固定开场白（`kind: opening`）。没有就返回 None。"""
    if not spec_p:
        return None
    try:
        from . import model as M
        lib = (M.yload(spec_p) or {}).get("library") or {}
    except Exception:
        return None
    for e in (lib.get("entries") or []):
        if isinstance(e, dict) and str(e.get("kind") or "") == "opening":
            return e
    return None


def _spec(proj):
    d = os.path.join(proj, "source")
    if not os.path.isdir(d):
        return None
    for f in sorted(os.listdir(d)):
        if f.endswith(".spec.yaml"):
            return os.path.join(d, f)
    return None


def _读json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _写json(path, obj):
    """写回 conf：中文照旧可读，但**零宽标记转义着写**。

    为什么单挑它：模板里的 conf 原本就是 `\\u200b\\u200b\\u200b` 这么写的 ——
    人打开文件能看见「这儿有个标记」。图省事写成真字符，那三个空格就彻底隐了形：
    谁在编辑器里存一次都可能把它吃掉，差异比对里也看不见。所以照原风格来。
    """
    s = json.dumps(obj, ensure_ascii=False, indent=2)
    s = s.replace("\u200b", "\\u200b")          # 字面写成 \u200b 六个字符
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(s + "\n")


# ------------------------------------------------------------------ 正文的规矩
def 尾标记数(正文):
    n = 0
    for ch in reversed(str(正文 or "")):
        if ch == "\u200b":
            n += 1
        else:
            break
    return n


def 规范正文(新文):
    """把「人要的正文」变成「conf 该存的样子」：末尾正好三个标记。

    给的人不必知道标记存在，更不必数它几个 —— 全按这里的来。
    顺手拦尖括号：开场白是纯文本，尖括号会把标记变回可见字符，
    从 ElecKoi 的会话预览（侧栏、历史检索）里露出来。
    """
    t = str(新文 or "")
    if t.endswith("\n"):
        t = t[:-1]
    if not t.rstrip("\u200b").strip():
        raise OpenerError("开场白正文是空的 —— 玩家开卡第一屏会什么都没有。")
    if "<" in t or ">" in t:
        raise OpenerError(
            "正文里有尖括号（< 或 >）。开场白是纯文本，尖括号会把末尾那三个"
            "零宽标记变成可见字符，从 ElecKoi 的会话预览里露出来 —— 去掉它再改。")
    return t.rstrip("\u200b") + 标记


# ------------------------------------------------------------------ 读
def 读(target):
    """一个工程的开场白全貌：真源、正文、标记、尖括号、方案数、有没有写回。"""
    根, 模式 = 定位(target)
    if not 根:
        raise OpenerError(
            "没找到工程（从 %s 往上找 `hud/hud.conf.json`、或 `source/*.spec.yaml`，"
            "两样都没找着）。\n"
            "  单张卡还没收成工程？先： python forge.py import <卡.json> --到 ." % target)
    if 模式 == "内容":
        return _读内容(根)

    proj = 根
    conf_p = os.path.join(proj, "hud", "hud.conf.json")
    conf = _读json(conf_p)
    op = conf.get("开场白") or {}
    正文 = str(op.get("正文") or "")

    方案 = []
    spec_p = _spec(proj)
    写回正文 = None
    if spec_p:
        try:
            from . import model as M
            lib = (M.yload(spec_p) or {}).get("library") or {}
        except Exception:
            lib = {}
        for e in (lib.get("entries") or []):
            if str(e.get("id")) == str(op.get("条目") or ""):
                方案 = [str(m.get("title") or "") for m in (e.get("opening_messages") or [])]
                写回正文 = str(e.get("content") or "")
                break

    一致 = None if 写回正文 is None else (写回正文 == 正文)
    return {
        "工程": proj, "模式": "界面", "配置文件": conf_p, "spec": spec_p,
        "有开场白": bool(op), "条目": str(op.get("条目") or ""),
        "正文": 正文, "字数": len(正文.rstrip("\u200b").rstrip()),
        "标记数": 尾标记数(正文),
        "尖括号": ("<" in 正文 or ">" in 正文),
        "方案": 方案, "写回一致": 一致,
    }


def _读内容(根):
    """没有界面层的工程：spec 里那条开场白**就是真源**（没有 conf 会在上面盖）。"""
    spec_p = _spec(根)
    条 = _开场白条目(spec_p)
    if not 条:
        raise OpenerError(
            "这个工程（%s）里没有开场白条目 —— spec 里没有 `kind: opening` 的那一条。\n"
            "  这张卡的开场交给了宿主，工具这边没什么可改的。\n"
            "  确实要一条： python forge.py entry <spec> --新 \"AI角色开场白\""
            "（再把 kind 改成 opening）；或 python forge.py new 开一张带界面层的新卡。" % 根)
    正文 = str(条.get("content") or "")
    return {
        "工程": 根, "模式": "内容", "配置文件": None, "spec": spec_p,
        "有开场白": True, "条目": str(条.get("id") or ""),
        "正文": 正文, "字数": len(正文.rstrip("\u200b").rstrip()),
        "标记数": 尾标记数(正文),
        "尖括号": ("<" in 正文 or ">" in 正文),
        "方案": [str(m.get("title") or "") for m in (条.get("opening_messages") or [])],
        "写回一致": True,
    }


def 写内容(spec_p, 新文):
    """内容档的写：换掉 spec 里那条开场白的正文，**方案正文一起换齐**。

    方案（`opening_messages`）与条目正文是同一份东西的两个出口：界面档靠
    `hud --写回` 让它们一致；内容档没别人替我们做，就自己一次换齐 ——
    不然会出现「主开场白改了、切方案还是老的」，而这种不一致只有在 ElecKoi 里点一下
    才看得见。方案自己的 `initial_variable_state` 与 id 一概不动。

    走 `content.commit`：编不出卡就一个字不落盘。
    """
    from . import content as CONTENT
    raw = CONTENT.load(spec_p)
    lib = raw.get("library") or {}
    for e in (lib.get("entries") or []):
        if not (isinstance(e, dict) and str(e.get("kind") or "") == "opening"):
            continue
        e["content"] = 新文
        for m in (e.get("opening_messages") or []):
            if isinstance(m, dict) and "content" in m:
                m["content"] = 新文
        CONTENT.commit(spec_p, raw)
        return spec_p
    raise OpenerError("spec 里没有 `kind: opening` 的开场白条目，没地方写。")


# ------------------------------------------------------------------ 写
def 改正文(target, 新文, 写回=True, out=print):
    """换掉开场白正文。标记自己补，旧版进回收站，改完顺手写回 spec。"""
    d = 读(target)
    if not d["有开场白"]:
        raise OpenerError(
            "这个工程的 hud.conf.json 里没有「开场白」这一块 ——\n"
            "  开场白由谁提供是它说了算（没有这块，开场那一步就交给宿主）。\n"
            "  确实想要：照别的工程的形状在 conf 里补一块，或直接改 hud/hud.conf.json。")
    新 = 规范正文(新文)
    if 新 == d["正文"]:
        out("开场白一个字没变 —— 不写盘。")
        return {"变了": False, "详情": d, "正文": 新}

    # 旧的存回收站：改是无声覆盖，被盖掉的那一版同样值得留
    if d["spec"]:
        from . import content as CONTENT
        CONTENT.put_trash(d["spec"], "开场白", "改开场白正文",
                          [{"表": "开场白",
                            "数据": {"条目": d["条目"], "正文": d["正文"]}}])

    if d["模式"] == "内容":
        写内容(d["spec"], 新)
        out("开场白已改：%d 字 → %d 字（末尾 %d 个零宽标记，已按规矩补齐）"
            % (d["字数"], len(新.rstrip("\u200b").rstrip()), 尾标记数(新)))
        out("")
        out("这个工程没有界面层 —— 改的就是 spec 里那条，**它就是真源**（没有 conf 在上面盖，"
            "不存在「改了白改」）。")
        return {"变了": True, "详情": d, "正文": 新, "写回": True}

    conf = _读json(d["配置文件"])
    conf["开场白"]["正文"] = 新
    _写json(d["配置文件"], conf)
    out("开场白已改：%d 字 → %d 字（末尾 %d 个零宽标记，已按规矩补齐）"
        % (d["字数"], len(新.rstrip("\u200b").rstrip()), 尾标记数(新)))

    if 写回:
        from . import hud as HUD
        out("")
        out("写回 spec（不然卡里那条还是老的）：")
        try:
            problems, _ = HUD.build(d["工程"], write_back=True, out=out)
        except Exception as exc:
            out("")
            out("组装失败：%s" % exc)
            out("  conf 已经改了（改动留着），把界面那边修好再写回：")
            out("  python forge.py opener \"%s\" --写回" % d["工程"])
            return {"变了": True, "详情": d, "正文": 新, "写回": False, "问题": [str(exc)]}
        if problems:
            out("")
            out("组装有校验问题，**没有**写回 —— conf 已经改了，修完界面再跑一次：")
            out("  python forge.py opener \"%s\" --写回" % d["工程"])
            return {"变了": True, "详情": d, "正文": 新, "写回": False, "问题": problems}
        return {"变了": True, "详情": d, "正文": 新, "写回": True}
    out("")
    out("下一步： python forge.py opener \"%s\" --写回    把正文写进 spec" % d["工程"])
    return {"变了": True, "详情": d, "正文": 新, "写回": False}


def 补齐(target, out=print):
    """正文末尾的标记不对（不是正好 3 个）就补上 —— 专治手改 conf 时数错、漏掉。

    「少了标记 = 建卡界面静默消失」是本工具最该消灭的那种错。所以它有个
    专治的入口：不改一个字，只把末尾整成 3 个。
    """
    d = 读(target)
    if not d["有开场白"]:
        raise OpenerError(
            "这个工程的 hud.conf.json 里没有「开场白」这一块，没什么可补的。")
    if d["标记数"] == 3:
        out("末尾正好 3 个零宽标记 —— 不用补。")
        return {"变了": False, "详情": d}
    out("末尾是 %d 个零宽标记，该是 3 个 —— 补上。" % d["标记数"])
    return 改正文(d["工程"], d["正文"], out=out)


def 写回(target, out=print):
    """只写回（不改正文）：conf 里那份正文重新灌进 spec。"""
    from . import hud as HUD
    根, 模式 = 定位(target)
    if not 根:
        raise OpenerError(
            "没找到工程（从 %s 往上找 `hud/hud.conf.json`、或 `source/*.spec.yaml`，"
            "两样都没找着）。" % target)
    if 模式 == "内容":
        out("这个工程没有界面层（没有 hud/hud.conf.json），没有要写回的东西 ——")
        out("开场白正文已经直接落在 spec 里了，改完就是最终状态。")
        return []
    proj = 根
    d = 读(proj)
    if not d["有开场白"]:
        raise OpenerError("这个工程的 hud.conf.json 里没有「开场白」这一块，没得写回。")
    if d["标记数"] != 3:
        raise OpenerError(
            "conf 里的开场白正文末尾有 %d 个零宽标记，该是 3 个 —— 不写回（少标记的卡，"
            "导入 ElecKoi 后建卡界面不会出现）。\n"
            "  先把标记补齐：python forge.py opener \"%s\" --补齐" % (d["标记数"], proj))
    problems, _ = HUD.build(proj, write_back=True, out=out)
    return problems
