# -*- coding: utf-8 -*-
"""正文体检（防八股）—— 不判「这是不是 AI 写的」，只抓「读起来像模板」的句式。

判据来自 2026-10-15 的联网调研（调研材料留在开发笔记里，不随包发布）。
调研的结论有两半，两半都重要：

- 只留 **4 条经得起核验的判据**（3 硬 + 1 软）；
- **词级黑名单一律不收** —— 「淡淡」「缓缓」「一丝」这类在正常中文里天天见，
  一刀切会大量误伤，而且换个题材（西幻换都市）词表就失效。

所以这里查的是**句式骨架**，不是词。

用法：

    python forge.py lint <卡.json 或 spec.yaml 或 任意文本文件> [-o 报告.md]
    python forge.py lint --标准            只打判据表
    python forge.py lint -                从标准输入读（写完一轮自查用）

退出码：有硬判据不过 ⇒ 1（可以挂进流程）；全过 ⇒ 0。
"""

import io
import json
import os
import re
import sys

汉字 = r"\u4e00-\u9fff"

# ── 判据 ────────────────────────────────────────────────────────────────

提示冒号 = re.compile(r"^[%s]{1,6}[：:]$" % 汉字)
列表项 = re.compile(r"^\s*(?:[-*·]|\d+[.、)])\s*")
对立句 = re.compile(
    r"不是[^，。；！？\n]{1,20}[，,]\s*(?:而)?是"
    r"|不仅[^，。；！？\n]{1,20}[，,]\s*更是"
    r"|不只是[^，。；！？\n]{1,20}[，,]\s*(?:还|更)是"
    r"|不光是[^，。；！？\n]{1,20}[，,]\s*(?:而)?是"
    r"|并非[^，。；！？\n]{1,20}[，,]\s*(?:而)?是"
)
破折号 = re.compile(r"——|—|–")
段首序数 = re.compile(
    r"^(?:首先|其次|再次|然后|最后|第[一二三四五六七八九十]{1,3}|其[一二三四五六七八九十]{1,3})[，,、]?"
)
句断 = re.compile(r"[。！？!?…]+|\n+")

# 硬：过不去就挡住。软：只报数，不改。
标准 = [
    ("硬", "提示冒号 ＋ 空行接列表",
     "整行只有「几个字：」，下一段接列表 —— 这一子类可靠（R=3.8×／9.4×，人类两组近 0）", "0 处"),
    ("硬", "对立句式骨架",
     "不是X而是Y / 不仅…更是… —— 整篇限 1 次", "≤1 次"),
    ("硬", "破折号", "`——` / `—` / `–`，该轮正文一处都不留", "0 处"),
    ("软", "段首序数词", "首先 / 其次 / 第一 …（段首）", "≤0.19/千字"),
    ("软", "相邻句同构", "相邻两句开头相同（排比成瘾）", "只报数"),
]


def _行(文本):
    return 文本.splitlines()


def _段(文本):
    return [p for p in re.split(r"\n\s*\n", 文本) if p.strip()]


def _句(文本):
    return [s.strip() for s in 句断.split(文本) if s.strip()]


def 查提示冒号(文本):
    """整行「几个字：」且下一非空行是列表项 ⇒ 命中。"""
    行 = _行(文本)
    命中 = []
    for i, raw in enumerate(行):
        if not 提示冒号.match(raw.strip()):
            continue
        for j in range(i + 1, min(i + 4, len(行))):
            s = 行[j].strip()
            if not s:
                continue
            if 列表项.match(s):
                命中.append((i + 1, raw.strip()))
            break
    return 命中


def 查对立句(文本):
    return [(m.start(), m.group()) for m in 对立句.finditer(文本)]


def 查破折号(文本):
    return [(m.start(), m.group()) for m in 破折号.finditer(文本)]


def 查段首序数(文本):
    命中 = []
    for p in _段(文本):
        m = 段首序数.match(p.strip())
        if m:
            命中.append(m.group())
    return 命中


def 查相邻同构(文本):
    句 = _句(文本)
    命中 = []
    for a, b in zip(句, 句[1:]):
        if len(a) >= 4 and len(b) >= 4 and a[:2] == b[:2]:
            命中.append((a[:6], b[:6]))
    return 命中


def 查排比(文本):
    句 = _句(文本)
    命中 = []
    for i in range(len(句) - 2):
        a, b, c = 句[i], 句[i + 1], 句[i + 2]
        if min(len(a), len(b), len(c)) >= 4 and a[:2] == b[:2] == c[:2]:
            命中.append((i + 1, a[:6]))
    return 命中


# ── 取正文 ──────────────────────────────────────────────────────────────

def _从卡(doc):
    """把 ElecKoi 卡里所有「给人读的正文」抠出来。"""
    块 = []
    库 = doc.get("setting_library")
    if isinstance(库, str):
        try:
            库 = json.loads(库)
        except ValueError:
            库 = None
    if isinstance(库, dict):
        for v in 库.get("versions") or []:
            for e in v.get("entries") or []:
                块.append(e.get("content") or "")
                for m in e.get("opening_messages") or []:
                    块.append(m.get("content") or "")
    甲 = doc.get("character")
    if isinstance(甲, dict):
        for k in ("first_mes", "mes_example", "description", "personality"):
            v = 甲.get(k)
            if isinstance(v, str):
                块.append(v)
    return "\n\n".join(b for b in 块 if b and b.strip())


def _从稿(doc):
    块 = []
    库 = doc.get("library") or {}
    for e in (库.get("entries") if isinstance(库, dict) else None) or []:
        if isinstance(e, dict):
            块.append(e.get("content") or "")
    return "\n\n".join(b for b in 块 if b and b.strip())


def 读(path, out=print):
    """认得三种输入：卡 json / 卡稿 yaml / 任意文本。"""
    if path == "-":
        return sys.stdin.read(), "标准输入"
    with open(path, "rb") as f:
        raw = f.read()
    文本 = raw.decode("utf-8", "replace")
    低 = path.lower()
    if 低.endswith(".json"):
        try:
            doc = json.loads(文本)
        except ValueError as exc:
            raise LintError("这个 .json 读不出来：%s" % exc)
        if isinstance(doc, dict) and doc.get("format") == "eleckoi.character-card":
            return _从卡(doc), path
        return 文本, path
    if 低.endswith((".yaml", ".yml")):
        try:
            import yaml
        except ImportError:
            return 文本, path
        doc = yaml.safe_load(文本)
        if isinstance(doc, dict) and ("library" in doc or "character" in doc):
            正文 = _从稿(doc)
            return (正文 or 文本), path
    return 文本, path


# ── 报告 ────────────────────────────────────────────────────────────────

class LintError(RuntimeError):
    pass


def 体检(文本, out=print, 标题="正文体检", 单轮=None):
    """单轮=None 时自动判：≤2000 汉字当「一轮正文」，用硬判据；超过就只报密度。

    为什么要有这个分叉：那三条硬判据是**按一轮输出**标定的
    （破折号 0 处 / 对立句式 ≤1 次）。拿它去量一张五十七万字的整卡，
    数字会大到没有意义 —— 实测艾瑟兰实卡：破折号 4706 处、对立句式 590 次，
    那是长篇的常态，不是毛病。硬指标只对短文本生效，长文本一律降级成密度参考。
    """
    字 = len(re.findall(r"[%s]" % 汉字, 文本))
    千字 = 字 / 1000.0 if 字 else 0.0
    if 单轮 is None:
        单轮 = 字 <= 2000
    冒号 = 查提示冒号(文本)
    对立 = 查对立句(文本)
    破 = 查破折号(文本)
    序数 = 查段首序数(文本)
    同构 = 查相邻同构(文本)
    排比 = 查排比(文本)
    密度 = (len(序数) / 千字) if 千字 else 0.0

    不过 = []
    if 单轮:
        if 冒号:
            不过.append("提示冒号＋空行接列表 %d 处" % len(冒号))
        if len(对立) > 1:
            不过.append("对立句式 %d 次（限 1）" % len(对立))
        if 破:
            不过.append("破折号 %d 处" % len(破))

    out("=" * 66)
    out("%s · 共 %d 汉字 · %s" % (标题, 字, "按一轮正文判" if 单轮 else "长文本，只报密度"))
    out("=" * 66)

    def 行(名, ok, 详情):
        out("  %s %s  %s" % ("✔" if ok else "✗", 名, 详情))

    密度_k = lambda n: (n / 千字) if 千字 else 0.0

    行("提示冒号＋空行接列表", not 冒号,
       ("%d 处 · %.2f/千字" % (len(冒号), 密度_k(len(冒号)))) if 冒号 else "无")
    for n, s in 冒号[:5]:
        out("       第 %d 行：%s" % (n, s))
    行("对立句式", len(对立) <= 1 if 单轮 else True,
       "%d 次 · %.2f/千字（一轮限 1 次）" % (len(对立), 密度_k(len(对立))))
    for _, s in 对立[:3]:
        out("       %s" % s)
    行("破折号", (not 破) if 单轮 else True,
       ("%d 处 · %.2f/千字" % (len(破), 密度_k(len(破)))) if 破 else "无")
    行("段首序数词", 密度 <= 0.19, "%.3f/千字（限 0.19）· %d 处" % (密度, len(序数)))
    句数 = len(_句(文本)) or 1
    行("相邻句同构", True, "%d 处 · %.1f/百句" % (len(同构), 100.0 * len(同构) / 句数))
    行("三句排比", True, "%d 处" % len(排比))
    out("-" * 66)
    if 不过:
        out("  硬判据不过：%s" % " · ".join(不过))
        out("  改法：把那句拆成两句口语、或换个说法 —— 别加词，加词只会更像模板。")
    elif 单轮:
        out("  三条硬判据全过。")
    else:
        out("  长文本：硬阈值（破折号 0 处／对立句 ≤1 次）按一轮标定，整卡不适用，")
        out("  上面给的是密度参考 —— 要判一轮写得好不好，把那一轮单独丢进来查。")
    return 不过


def 打标准(out=print):
    out("=" * 66)
    out("正文体检 · 判据表（2026-10-15 调研定版）")
    out("=" * 66)
    for 档, 名, 说明, 限 in 标准:
        out("  [%s] %-14s %-10s %s" % (档, 名, 限, 说明))
    out("-" * 66)
    out("  为什么不查词：「淡淡」「缓缓」「一丝」这类在正常中文里天天见，")
    out("  一刀切会大量误伤，而且换个题材（西幻换都市）词表就失效。")
    out("  所以只查句式骨架。具体判据：`python forge.py lint --标准`。")


# ── CLI ─────────────────────────────────────────────────────────────────

def _opt(argv, names):
    for i, a in enumerate(argv):
        if a in names and i + 1 < len(argv):
            return argv[i + 1]
    return None


def main(argv, out=print):
    if not argv or argv[0] in ("--标准", "--rules"):
        打标准(out)
        return 0
    src = argv[0]
    正文, 名 = 读(src, out)
    不过 = 体检(正文, out, 标题="正文体检 · %s" % 名)
    dst = _opt(argv, ("-o", "--out"))
    if dst:
        行 = []
        体检(正文, out=行.append, 标题="正文体检 · %s" % 名)
        with io.open(dst, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(行) + "\n")
        out("  报告 → %s" % dst)
        return 1 if 不过 else 0
    return 1 if 不过 else 0
