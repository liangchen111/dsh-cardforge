# -*- coding: utf-8 -*-
"""一次性脚本：造 `差分/语料/png.json`（png 模块的差分语料）。

语料是 JSON，装不下二进制 —— 于是定了两个标记（**两侧的 `_参` / `_预置文` 都认**）：

    {"@字节@": "<hex>"}        → 参数里的 bytes
    {"@读文件@": "<路径>"}      → 参数里的「某文件的字节」
    {"@十六进制@": "<hex>"}     → 预置文件的内容（二进制）

预置文件的内容还能直接写成 dict/list ⇒ 两侧都按 `json.dumps(v, ensure_ascii=False, indent=2)`
落盘（比一比.mjs 那边 `JSON.stringify(v, null, 2)`，形状逐字节对得上）。

用法：python 差分/_造png语料.py      （跑完即可删）
"""
import base64
import gzip
import json
import struct
import sys
import zlib
from pathlib import Path

根 = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))
from forge import png as P  # noqa: E402


def _六(b):
    return {"@十六进制@": bytes(b).hex()}


def _图(块们, w=2, h=2, 有idat=True):
    """手搓一张最小合法 PNG（IHDR + 块们 + IDAT + IEND），用来喂 verify / chunks。"""
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    rows = (b"\x00" + b"\x10\x20\x30" * w) * h
    出 = P.SIG + P._mk(b"IHDR", ihdr) + b"".join(块们)
    if 有idat:
        出 += P._mk(b"IDAT", zlib.compress(rows, 9))
    出 += P._mk(b"IEND", b"")
    return 出


好卡 = {
    "format": "eleckoi.character-card",
    "version": 1,
    "character": {
        "name": "银月",
        "description": "守夜的人。",
        "personality": "寡言。",
        "scenario": "城门口。",
        "first_mes": "你来了。",
        "mes_example": "",
        "creator_notes": "",
        "system_prompt": "",
        "post_history_instructions": "",
        "tags": [],
        "creator": "差分台",
        "character_version": "1",
        "alternate_greetings": [],
        "extensions": {},
    },
    "setting_library": {
        "format": "eleckoi.setting-library",
        "version": 1,
        "active_version_id": "v1",
        "versions": [{"id": "v1", "name": "第一版", "groups": [], "entries": []}],
    },
}

预设 = {"format": "eleckoi.agent-preset", "version": 1, "name": "创作预设 甲", "note": "差分用"}

无名卡 = {"format": "eleckoi.character-card", "version": 1, "character": {"description": "没有名字。"}}

卡原生 = json.dumps(好卡, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
卡gzipb64 = base64.b64encode(gzip.compress(卡原生, 9, mtime=0)).decode("ascii")

# ---------------------------------------------------------------- 手搓的坏图
封面 = _图([])                                                     # 干净小图，当 --图 用
坏格式 = _图([P._mk_text("eleckoi-card", base64.b64encode(
    gzip.compress(b'{"format":"nope","version":1}', 9, mtime=0)).decode("ascii"))])
带酒馆 = _图([P._mk_text("eleckoi-card", 卡gzipb64), P._mk_text("chara", base64.b64encode(b"{}").decode("ascii"))])
双卡 = _图([P._mk_text("eleckoi-card", 卡gzipb64), P._mk_text("eleckoi-card", 卡gzipb64)])
# 禁止表里另两个关键字（`chara` 由 带酒馆.png 盖到，这两个单独走一遍）
禁v3 = _图([P._mk_text("eleckoi-card", 卡gzipb64), P._mk_text("ccv3", base64.b64encode(b"{}").decode("ascii"))])
禁v2 = _图([P._mk_text("eleckoi-card", 卡gzipb64), P._mk_text("chara_card_v2", base64.b64encode(b"{}").decode("ascii"))])
无卡块 = _图([P._mk_text("chara", base64.b64encode(b"{}").decode("ascii"))])
无IDAT = _图([P._mk_text("eleckoi-card", 卡gzipb64)], 有idat=False)
边缘tEXt = _图([
    P._mk_text("", "empty-keyword"),
    P._mk_text("empty-value", ""),
    P._mk_text("good", "value"),
    P._mk_itxt("itxt-key", "中文值"),
])
不是PNG = b"hello world hello world hello world"
截断了 = P.SIG + b"\x00\x00\x00"
块超长 = P.SIG + struct.pack(">I", 99) + b"IDAT" + b"abc"
无IEND = P.SIG + P._mk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
无IHDR = P.SIG + P._mk_text("eleckoi-card", 卡gzipb64) + P._mk(b"IEND", b"")


def 预置(文件=None, 目录=None):
    出 = {}
    if 目录:
        出["目录"] = 目录
    if 文件:
        出["文件"] = 文件
    return 出


情形们 = []


def 加(名, 文件=None, 目录=None, 操作=None):
    情形们.append({"名": 名, "预置": 预置(文件, 目录), "操作": 操作})


# 1 卡片 · 默认封面 · 默认出口（走 default_out 的非 source 分支）
加("卡片·默认封面·默认出口",
  文件={"sample/银月.card.json": 好卡},
  操作=[{"调用": "write", "参数": ["@工作@/sample/银月.card.json"]}])

# 2 卡片 · 自带封面 · 出目录不存在要自动建
加("卡片·自带封面·自动建目录",
  文件={"卡.json": 好卡, "封面.png": _六(封面)},
  操作=[{"调用": "write", "参数": ["@工作@/卡.json", "@工作@/出/深/卡.png", "@工作@/封面.png"]}])

# 3 预设 · 不 gzip
加("预设·不压缩",
  文件={"预设.json": 预设},
  操作=[{"调用": "write", "参数": ["@工作@/预设.json", "@工作@/预设.png", None, "preset"]}])

# 4 预设 · 默认出口（.preset.json → .preset.card.png）
加("预设·默认出口",
  文件={"我的.preset.json": 预设},
  操作=[{"调用": "write", "参数": ["@工作@/我的.preset.json", None, None, "preset"]}])

# 5 卡片 · 不带名字 → 用文件名兜底（_name_of 的 `or` 两支）
加("卡片·无名用文件名兜底",
  文件={"无名.card.json": 无名卡},
  操作=[{"调用": "write", "参数": ["@工作@/无名.card.json", "@工作@/无名.png"]}])

# 6 卡片 · 带酒馆外壳（行 2 的 chara_note 也一并比）
加("卡片·带酒馆外壳",
  文件={"sample/银月.card.json": 好卡},
  操作=[{"调用": "write", "参数": ["@工作@/sample/银月.card.json", "@工作@/壳.png", None, "card", False, True]}])

# 7 quiet=True → 一行都不印
加("卡片·quiet",
  文件={"卡.json": 好卡},
  操作=[{"调用": "write", "参数": ["@工作@/卡.json", "@工作@/静.png", None, "card", True]}])

# 8 kind 不合法
加("write·kind 不合法",
  文件={"卡.json": 好卡},
  操作=[{"调用": "write", "参数": ["@工作@/卡.json", "@工作@/x.png", None, "nope"]}])

# 9 源文件不存在
加("write·源文件不存在",
  操作=[{"调用": "write", "参数": ["@工作@/没有这个.json"]}])

# 10 源文件不是 JSON
加("write·源文件不是 JSON",
  文件={"坏.json": "{ 这不是 json"},
  操作=[{"调用": "write", "参数": ["@工作@/坏.json"]}])

# 11 format 不对
加("write·format 不对",
  文件={"卡.json": 预设},
  操作=[{"调用": "write", "参数": ["@工作@/卡.json"]}])

# 12 自带的封面不是 PNG
加("write·封面不是 PNG",
  文件={"卡.json": 好卡, "封面.png": _六(不是PNG)},
  操作=[{"调用": "write", "参数": ["@工作@/卡.json", "@工作@/x.png", "@工作@/封面.png"]}])

# 13 自带的封面没有 IHDR → IndexError
加("write·封面没有 IHDR",
  文件={"预设.json": 预设, "无IHDR.png": _六(无IHDR)},
  操作=[{"调用": "write", "参数": ["@工作@/预设.json", "@工作@/x.png", "@工作@/无IHDR.png", "preset"]}])

# 14 默认出口的后缀表 + source/成品 分支
加("default_out·后缀表",
  目录=["成品", "source"],
  操作=[{"调用": "default_out", "参数": [p]} for p in [
      "@工作@/a.spec.yaml", "@工作@/b.spec.yml", "@工作@/c.card.json",
      "@工作@/d.yaml", "@工作@/e.yml", "@工作@/f.json",
      "@工作@/g.txt", "@工作@/noext", "@工作@/点开头", "@工作@/.spec.yaml",
      "@工作@/source/h.spec.yaml", "@工作@/source/成品/i.json", "@工作@/目录.名/甲.spec.yaml",
  ]])

# 15 source 目录在、但没有 成品 子目录 ⇒ 不搬
加("default_out·source 无成品", 目录=["source"],
  操作=[{"调用": "default_out", "参数": ["@工作@/source/甲.spec.yaml"]}])

# 16 小尺寸封面逐字节比
加("default_cover·小尺寸",
  操作=[{"调用": "default_cover", "参数": [s]} for s in [(4, 3), (1, 1), (3, 8), (2, 2)]] + [
      {"调用": "default_cover", "参数": [1, 5]}, {"调用": "default_cover", "参数": [7, 6]},
      # 两个 int 的边角：h==1 在 Python 是 ZeroDivisionError（y / (h - 1)），h==0 是一行都不画
      {"调用": "default_cover", "参数": [1, 1]}, {"调用": "default_cover", "参数": [5, 0]}])

# 17 chunks / read_text / _mk* / _sha12 / _swallow 直接调
加("原语·直接调",
  文件={"封面.png": _六(封面), "边缘tEXt.png": _六(边缘tEXt), "不是PNG.png": _六(不是PNG),
        "截断了.png": _六(截断了), "块超长.png": _六(块超长), "无IEND.png": _六(无IEND)},
  操作=[{"调用": "chunks", "参数": [{"@读文件@": "@工作@/封面.png"}]},
        {"调用": "read_text", "参数": [{"@读文件@": "@工作@/封面.png"}]},
        {"调用": "read_text", "参数": [{"@读文件@": "@工作@/边缘tEXt.png"}]},
        {"调用": "chunks", "参数": [{"@读文件@": "@工作@/不是PNG.png"}]},
        {"调用": "chunks", "参数": [{"@读文件@": "@工作@/截断了.png"}]},
        {"调用": "chunks", "参数": [{"@读文件@": "@工作@/块超长.png"}]},
        {"调用": "chunks", "参数": [{"@读文件@": "@工作@/无IEND.png"}]},
        {"调用": "chunks", "参数": [{"@字节@": ""}]},
        {"调用": "_mk", "参数": [{"@字节@": "49444154"}, {"@字节@": "616263"}]},
        {"调用": "_mk_text", "参数": ["ab", "cd"]},
        {"调用": "_mk_text", "参数": ["eleckoi-card", ""]},
        {"调用": "_mk_itxt", "参数": ["ab", "中文"]},
        {"调用": "_mk_itxt", "参数": ["", ""]},
        {"调用": "_sha12", "参数": [{"@字节@": "616263"}]},
        {"调用": "_sha12", "参数": [{"@字节@": ""}]},
        {"调用": "_swallow", "参数": ["a", 1]}])

# 18 verify · 全绿 + expect_native 对得上
加("verify·全绿",
  文件={"卡.json": 好卡},
  操作=[{"调用": "write", "参数": ["@工作@/卡.json", "@工作@/卡.png"]},
        {"调用": "verify", "参数": ["@工作@/卡.png"]},
        {"调用": "verify", "参数": ["@工作@/卡.png", {"@读文件@": "@工作@/卡.json"}]},
        {"调用": "verify", "参数": ["@工作@/卡.png", None, True]}])

# 19 verify · expect_native 对不上
加("verify·expect_native 对不上",
  文件={"卡.json": 好卡},
  操作=[{"调用": "write", "参数": ["@工作@/卡.json", "@工作@/卡.png"]},
        {"调用": "verify", "参数": ["@工作@/卡.png", {"@字节@": "00112233"}]}])

# 20 verify · 预设（不 gunzip 那一支）
加("verify·预设",
  文件={"预设.json": 预设},
  操作=[{"调用": "write", "参数": ["@工作@/预设.json", "@工作@/预设.png", None, "preset"]},
        {"调用": "verify", "参数": ["@工作@/预设.png"]},
        {"调用": "verify", "参数": ["@工作@/预设.png", None, False]}])

# 21 verify · 各种坏图
加("verify·坏图",
  文件={"坏格式.png": _六(坏格式), "带酒馆.png": _六(带酒馆), "双卡.png": _六(双卡),
        "无卡块.png": _六(无卡块), "无IDAT.png": _六(无IDAT), "不是PNG.png": _六(不是PNG),
        "截断了.png": _六(截断了), "块超长.png": _六(块超长), "无IEND.png": _六(无IEND),
        "禁v3.png": _六(禁v3), "禁v2.png": _六(禁v2)},
  操作=[{"调用": "verify", "参数": ["@工作@/坏格式.png"]},
        {"调用": "verify", "参数": ["@工作@/带酒馆.png"]},
        {"调用": "verify", "参数": ["@工作@/带酒馆.png", None, True]},
        {"调用": "verify", "参数": ["@工作@/禁v3.png"]},
        {"调用": "verify", "参数": ["@工作@/禁v2.png"]},
        {"调用": "verify", "参数": ["@工作@/双卡.png"]},
        {"调用": "verify", "参数": ["@工作@/无卡块.png"]},
        {"调用": "verify", "参数": ["@工作@/无IDAT.png"]},
        {"调用": "verify", "参数": ["@工作@/不是PNG.png"]},
        {"调用": "verify", "参数": ["@工作@/截断了.png"]},
        {"调用": "verify", "参数": ["@工作@/块超长.png"]},
        {"调用": "verify", "参数": ["@工作@/无IEND.png"]}])

# 22 _name_of 两支
加("_name_of",
  操作=[{"调用": "_name_of", "参数": [好卡, "card"]},
        {"调用": "_name_of", "参数": [{"format": "eleckoi.character-card"}, "card"]},
        {"调用": "_name_of", "参数": [{"name": "甲"}, "preset"]},
        {"调用": "_name_of", "参数": [无名卡, "card"]}])

# 23 _chara_wrapper · 成功支（走 export.to_tavern）
加("_chara_wrapper·成功",
  文件={"卡.json": 好卡},
  操作=[{"调用": "write", "参数": ["@工作@/卡.json", "@工作@/x.png"]},
        {"调用": "_chara_wrapper", "参数": ["@工作@/卡.json", {"@读文件@": "@工作@/卡.json"}, 好卡],
         "看JSON": True}])

# 24 _chara_wrapper · 降级支（源卡路径不存在 ⇒ to_tavern 抛，走 minimal 外壳）
加("_chara_wrapper·降级",
  操作=[{"调用": "_chara_wrapper", "参数": ["@工作@/没有这个.json", {"@字节@": "7b7d"}, 无名卡],
         "看JSON": True}])

# 25 main：空参数印用法并返回 2；带参数写一遍再自检
加("main·空参数",
  操作=[{"调用": "main", "参数": [[]]}])

加("main·正常一趟",
  文件={"卡.json": 好卡, "封面.png": _六(封面)},
  操作=[{"调用": "main", "参数": [["@工作@/卡.json", "-o", "@工作@/出.png", "--图", "@工作@/封面.png"]]},
        {"调用": "main", "参数": [["@工作@/卡.json"]]},
        {"调用": "main", "参数": [["@工作@/卡.json", "--out", "@工作@/二.png"]]}])

料 = {
    "说明": (
        "png 模块（成品图 · ElecKoi 原生卡块）的差分语料。"
        "工作目录一律建在 差分/ 底下（不是工具根、也不是系统 temp）。"
        "★ 已申报差异**三处**，两侧同名同义地折掉：（1）`读不了源卡 JSON：…` 里嵌的是"
        "解析器的原文（Python `JSONDecodeError: Expecting value: line 1 column 1 (char 0)` "
        "vs JS `SyntaxError: Unexpected token`），折成 `读不了源卡 JSON：<解析器说>`；"
        "（2）酒馆外壳降级时那句 note 里嵌的是语言自己的异常原文，折成"
        "`酒馆外壳降级生成（<降级原因>）`；"
        "（3）**gzip 的 deflate 体复现不了** —— CPython 用上游 zlib 1.3.1，Node v24.14.0 自带的"
        "是 fork（`process.versions.zlib == '1.3.1-e00f703'`），两边默认策略下产物就不同"
        "（strategy 1/2/3 相同、0/4 不同；memLevel 1..9 × strategy 0..4 全矩阵没一个组合能复现；"
        "388 B 卡 JSON 的最短分歧前缀＝42 字节）。⇒ 差分侧把「整张 PNG 的字节数 / sha256 / 文件 sha1」"
        "折成**逐块分解**：每块记「类型 + 数据字节 sha1」；`tEXt eleckoi-card` 那块改记"
        "「gzip 容器头 10 字节 + 容器尾 8 字节 + gunzip 后原生字节数/原生 sha256」（这四样两边逐字节同）。"
        "见差分台两侧的 `_PNG分解` / `_折回` / `_折树` / `_折出文`。"
        "★ bytes 一律折成 {\"@十六进制@\": …}（hex 原文，比对强度与逐字节比等同）。"
        "★ 语料里别放整数值的浮点（Python 写 21.0、JS 写 21）。"
        "★ 手搓的坏图由 差分/_造png语料.py 生成。"
    ),
    "情形": 情形们,
}

出 = 根 / "差分" / "语料" / "png.json"
出.write_text(json.dumps(料, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print("语料 %s  %d 情形" % (出, len(情形们)))
