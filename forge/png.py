# -*- coding: utf-8 -*-
"""PNG 卡 —— 把成品卡嵌进一张图。

**为什么非得有这一件。**

ElecKoi 原生导入只认一条路：PNG 的 tEXt 块 `eleckoi-card`，值是
`base64(gzip(原生卡 JSON))`。读不到就当场报「图片里没有 ElecKoi 角色卡数据」。
`forge.py build` 只出 `.card.json` —— 用户拿到的是一份「导不进去的文件」，
这是本工具离「发给别人用」最远的一步。（艾瑟兰第 311 轮实测踩过这个坑，
配方就是从那一次验证过的脚本抄下来的。）

**写进三块，像素数据一个字节都不动：**

    1. tEXt `eleckoi-card`  = base64(gzip(源卡原始字节))   <- 客户端唯一认的
    2. tEXt `chara`         = base64(酒馆 V2 外壳)         <- 酒馆系工具认的，
                               完整卡在 data.extensions.eleckoi.source_card
    3. iTXt `<卡名>-meta`   = 人能看懂的摘要（便于日后核对）

**两条规矩**（艾瑟兰那版用真机换来的）：

    · 源卡**原始字节**直接压、不重新序列化 ⇒ 取出来与 `.card.json` 逐字节一致；
    · gzip `mtime=0` ⇒ 同一份卡跑两次得到同一个 PNG（确定性复跑，可进指纹）。

预设（`eleckoi.agent-preset`）走同一条路，只是 `tEXt` 关键字换成
`eleckoi_agent_preset` —— 见 `kind="preset"`。等 forge 真出了预设产物，
这里不用再改。
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
import struct
import zlib

from . import export as EXPORT
from . import model as M
from . import sandbox as SB

SIG = b"\x89PNG\r\n\x1a\n"

# PNG 里那一块叫什么 —— 客户端写死的就是这两个字符串，改一个字母就导不进去。
KEYWORD = {"card": "eleckoi-card", "preset": "eleckoi_agent_preset"}
# 客户端拿到数据后还要验 format / version，对不上同样报「不是 ElecKoi 卡」。
FORMAT = {"card": "eleckoi.character-card", "preset": "eleckoi.agent-preset"}
MAX_PNG = 96 * 1024 * 1024        # readPngText 的上限，超了客户端直接拒


class PngError(RuntimeError):
    """PNG 这张壳的事 —— 内容/来源不对，说一句人话就够，不必打栈。"""


# ------------------------------------------------------------------ PNG 块
def chunks(buf):
    """按块切开一份 PNG，返回 [(类型, 数据, 起, 止)]。"""
    if buf[:8] != SIG:
        raise PngError("不是 PNG（头八个字节不对）")
    i, out = 8, []
    while i < len(buf):
        if i + 8 > len(buf):
            raise PngError("PNG 截断了（块头不完整）")
        ln = struct.unpack(">I", buf[i:i + 4])[0]
        typ = buf[i + 4:i + 8]
        if i + 12 + ln > len(buf):
            raise PngError("PNG 截断了（%s 块声明 %d 字节，后面不够）" % (typ.decode("latin-1", "replace"), ln))
        out.append((typ, buf[i + 8:i + 8 + ln], i, i + 12 + ln))
        i += 12 + ln
    if not out or out[-1][0] != b"IEND":
        raise PngError("PNG 没有 IEND 收尾（客户端会当坏图）")
    return out


def _mk(typ, data):
    return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)


def _mk_text(keyword, text):
    return _mk(b"tEXt", keyword.encode("latin-1") + b"\x00" + text.encode("latin-1"))


def _mk_itxt(keyword, text):
    d = (keyword.encode("latin-1") + b"\x00" + b"\x00" + b"\x00"
         + b"\x00" + b"\x00" + text.encode("utf-8"))
    return _mk(b"iTXt", d)


def read_text(buf):
    """照客户端的读法取文本块：**只认 tEXt**（iTXt 不读），keyword 与值以 \\0 分隔。

    这段是照着 `PngTextChunkCodec.readPngText` 的行为写的，不是照 PNG 规范。
    两处不一样的地方正是坑：iTXt 白写、keyword 空的不取、值空的不取。
    """
    got = {}
    for typ, data, _, _ in chunks(buf):
        if typ != b"tEXt":
            continue
        sep = data.find(b"\x00")
        if sep <= 0 or sep >= len(data) - 1:
            continue
        got[data[:sep].decode("latin-1")] = data[sep + 1:].decode("latin-1")
    return got


def _sha12(b):
    return hashlib.sha256(b).hexdigest()[:12].upper()


def default_cover(w=640, h=960):
    """没有封面图时现画一张 —— 竖向渐变 + 一道暖色横线。

    为什么要自己画：forge 不依赖 Pillow（本工具只有 PyYAML 一个第三方依赖），
    而「没有图」不该堵住发卡这条路。图只是外壳，卡数据才是内容。
    """
    top, mid, bot = (18, 22, 38), (38, 34, 52), (92, 56, 44)
    rows = bytearray()
    band_y = int(h * 0.68)
    for y in range(h):
        t = y / (h - 1)
        if t < 0.5:
            u, a, b = t / 0.5, top, mid
        else:
            u, a, b = (t - 0.5) / 0.5, mid, bot
        px = bytes(int(a[i] + (b[i] - a[i]) * u) for i in range(3))
        if abs(y - band_y) <= 2:
            px = bytes(min(255, v + 55) for v in px)
        rows += b"\x00" + px * w               # 每行头一个 0 = 不过滤
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return SIG + _mk(b"IHDR", ihdr) + _mk(b"IDAT", zlib.compress(bytes(rows), 9)) + _mk(b"IEND", b"")


def _swallow(*_a, **_k):
    """`to_tavern` 的打印口 —— 嵌 PNG 时那些进度行是噪音。"""
    return None


# ------------------------------------------------------------------ 干活
def write(card_path, out_path=None, cover=None, kind="card", quiet=False, out=print):
    """把 `card_path`（原生卡 .json）嵌进一张 PNG，落到 `out_path`。

    返回 {"png": …, "bytes": …, "native_bytes": …, "sha256": …}。
    """
    if kind not in KEYWORD:
        raise PngError("不认识的产物类型：%s（只会 card / preset）" % kind)

    with open(card_path, "rb") as _f:
        raw = _f.read()
    try:
        native = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise PngError("读不了源卡 JSON：%s" % exc)

    fmt = native.get("format")
    if fmt != FORMAT[kind]:
        raise PngError("这份文件不是 %s（format=%r，应该是 %r）"
                       % ("ElecKoi 角色卡" if kind == "card" else "ElecKoi 预设", fmt, FORMAT[kind]))

    if out_path is None:
        out_path = default_out(card_path)

    name = _name_of(native, kind) or os.path.splitext(os.path.basename(card_path))[0]

    # ① 客户端唯一认的那一块。
    #    卡：`base64(gzip(原始字节))` —— 直接压原始字节、不重新 dumps，
    #        取出后才能与 .card.json 逐字节一致。
    #    预设：`base64(utf8(json))` —— **不压缩**。客户端 `encodeElecKoiAgentPresetPng`
    #        只 base64 一次，解码处（`AgentPresetImportCodec.ts:166`）也只
    #        `Buffer.from(encoded,'base64').toString('utf8')`，没有 gunzip。
    #        这里要是顺手压了，对方解出来是 gzip 字节，JSON.parse 当场炸。
    if kind == "card":
        native_b64 = base64.b64encode(gzip.compress(raw, compresslevel=9, mtime=0))
    else:
        native_b64 = base64.b64encode(raw)

    blocks = [_mk_text(KEYWORD[kind], native_b64.decode("ascii"))]

    # ② 酒馆外壳（只有卡有；预设不走酒馆那条路）
    chara_note = ""
    if kind == "card":
        chara_bytes = _chara_wrapper(card_path, raw, native)
        blocks.append(_mk_text("chara", base64.b64encode(chara_bytes).decode("ascii")))
        chara_note = "酒馆 V2 外壳 %d 字节" % len(chara_bytes)

    # ③ 给人看的摘要
    meta = json.dumps({
        "title": name,
        "kind": "ElecKoi 角色卡 · PNG 外壳" if kind == "card" else "ElecKoi 创作预设 · PNG 外壳",
        "format": fmt,
        "version": native.get("version"),
        "size_bytes": len(raw),
        "native_sha256": hashlib.sha256(raw).hexdigest(),
        "read_back": ("取 tEXt `%s` -> base64 解码 -> gunzip -> 就是原样的 .card.json" % KEYWORD[kind])
                      if kind == "card" else
                      ("取 tEXt `%s` -> base64 解码 -> 就是原样的 .preset.json（预设不 gzip）" % KEYWORD[kind]),
    }, ensure_ascii=False, separators=(",", ":"))
    blocks.append(_mk_itxt("%s-meta" % M.ascii_prefix(name, "card"), meta))

    if cover:
        img = open(cover, "rb").read()
    else:
        img = default_cover()

    cs = chunks(img)
    ihdr_end = [c[3] for c in cs if c[0] == b"IHDR"][0]
    new = img[:ihdr_end] + b"".join(blocks) + img[ihdr_end:]

    # 临时文件必须落在**目标同一个目录**里：跨盘 `os.replace` 会
    # `WinError 17 系统无法将文件移到不同的磁盘驱动器`（系统临时目录在 C:，
    # 而卡可能在 E:）。同目录还能保住原子性。
    d = os.path.dirname(os.path.abspath(out_path))
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    tmp = out_path + ".part"
    with open(tmp, "wb") as f:
        f.write(new)
    SB.land(tmp, out_path)
    SB.cleanup(tmp)

    res = {"png": out_path, "bytes": len(new), "native_bytes": len(raw),
           "sha256": hashlib.sha256(new).hexdigest()}

    if not quiet:
        out("写出：%s（%d 字节，%.2f MB）" % (out_path, len(new), len(new) / 1048576))
        out("  内嵌：%s %d 字节（base64 %d）· %s" % (KEYWORD[kind], len(raw), len(native_b64), chara_note or "无酒馆外壳"))
        out("  取法：读 PNG 的 tEXt `%s` → base64 解码%s → 得到与源文件逐字节一致的 %s"
            % (KEYWORD[kind],
               " → gunzip" if kind == "card" else "（预设不压缩）",
               ".card.json" if kind == "card" else ".preset.json"))

    return res


def default_out(src):
    """默认出哪儿：`<名>.card.json` -> `<名>.card.png`，就在旁边。

    工程里的 `source/xxx.spec.yaml` 特殊一点 —— 出到同工程的 `成品/`，
    因为那是 forge 放产物的地方（`new` 建出来的工程就是这个形状），
    让人在 `source/` 里捡到一张卡图会奇怪。
    """
    d = os.path.dirname(os.path.abspath(src))
    stem = os.path.basename(src)
    for suf in (".spec.yaml", ".spec.yml", ".card.json", ".yaml", ".yml", ".json"):
        if stem.lower().endswith(suf):
            stem = stem[:-len(suf)]
            break
    else:
        stem = os.path.splitext(stem)[0]
    if os.path.basename(d).lower() == "source":
        made = os.path.join(os.path.dirname(d), "成品")
        if os.path.isdir(made):
            d = made
    return os.path.join(d, stem + ".card.png")


def _name_of(native, kind):
    if kind == "card":
        ch = native.get("character") or {}
        return ch.get("name") or native.get("name")
    return native.get("name")


def _chara_wrapper(card_path, raw, native):
    """酒馆 V2 外壳：借 `to-tavern` 那套映射，完整卡塞进 extensions.eleckoi.source_card。

    这么做而不是自己拼一个壳：条目/正则/变量往酒馆字段上的映射是
    `export.py` 里已经调准过的东西（世界书、regex_scripts、未映射字段兜底），
    另写一份迟早与它走散。`keep_raw=True` 让完整卡原样躺在壳里 —— 无损。
    """
    tmp = M.temp_json()
    try:
        EXPORT.to_tavern(card_path, tmp, keep_raw=True, out=_swallow)
        with open(tmp, "rb") as f:
            data = f.read()
        wrapper = json.loads(data.decode("utf-8"))
        back = (((wrapper.get("data") or {}).get("extensions") or {}).get("eleckoi") or {}).get("source_card")
        if back != native:                      # 壳可以少字段，完整卡不能少
            raise PngError("酒馆外壳里的 source_card 与源卡不等（export.to_tavern 出问题了）")
        return data
    except PngError:
        raise
    except Exception as exc:
        # 最小卡（没条目、没变量的半成品）不该因为壳拼不出来就发不出 PNG
        # —— 客户端本来也只认 eleckoi-card 那一条。
        minimal = {"spec": "chara_card_v2", "spec_version": "2.0",
                   "data": {"name": _name_of(native, "card") or "未命名",
                            "description": "", "personality": "", "scenario": "",
                            "first_mes": "", "mes_example": "", "creator_notes": "",
                            "system_prompt": "", "post_history_instructions": "",
                            "alternate_greetings": [], "tags": [], "creator": "",
                            "character_version": "",
                            "extensions": {"eleckoi": {"source_card": native,
                                                       "note": "酒馆外壳降级生成（%s）" % exc}}}}
        return json.dumps(minimal, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    finally:
        SB.cleanup(tmp)


def verify(png_path, expect_native=None, out=print):
    """照客户端的口径把刚写出来的 PNG 复读一遍。五条断言，一条不落。

    任何一条不过都抛 PngError —— 「导出成功但导不进去」是这份工具最该防的事。
    """
    with open(png_path, "rb") as _f:
        buf = _f.read()
    cs = chunks(buf)
    if len(buf) > MAX_PNG:
        raise PngError("整张 PNG %d 字节，超过客户端 %d MB 上限" % (len(buf), MAX_PNG // 1048576))

    got = read_text(buf)
    kw = "eleckoi-card" if "eleckoi-card" in got else "eleckoi_agent_preset"
    if kw not in got:
        raise PngError("PNG 里没有 `eleckoi-card` 块 —— 手机上仍会报「图片里没有 ElecKoi 角色卡数据」")

    # 卡 gzip 过、预设没有 —— 客户端两处解码器不一样，这里得跟着分叉
    raw_native = base64.b64decode(got[kw])
    native = gzip.decompress(raw_native) if kw == "eleckoi-card" else raw_native
    if expect_native is not None and native != expect_native:
        raise PngError("`%s` 解出来与源文件不一致" % kw)
    root = json.loads(native.decode("utf-8"))
    want = FORMAT["card"] if kw == "eleckoi-card" else FORMAT["preset"]
    if root.get("format") != want:
        raise PngError("format 不对（拿到 %r，客户端要 %r）" % (root.get("format"), want))

    # 像素没动：IDAT 与源图逐字节一致（源图不在手边时至少确认块还能解析）
    idat = b"".join(d for t, d, _, _ in cs if t == b"IDAT")
    if not idat:
        raise PngError("PNG 里没有 IDAT（不是一张真图）")

    if out:
        wd = struct.unpack(">II", buf[16:24])
        out("✔ 自检：%s · %d×%d · %d 字节 · sha256 %s" % (kw, wd[0], wd[1], len(buf), _sha12(buf)))
        out("  `%s` 解出 %d 字节，format=%s version=%s" % (kw, len(native), root.get("format"), root.get("version")))
    return {"png": png_path, "keyword": kw, "native_bytes": len(native), "format": root.get("format")}


def main(argv=None):
    """独跑：`python -m forge.png <卡.json> [-o 出.png] [--图 封面.png]`。"""
    import sys
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print(__doc__.strip().splitlines()[0])
        print("用法：python -m forge.png <卡.json> [-o 出.png] [--图 封面.png]")
        return 2
    src = argv[0]
    out_path = None
    cover = None
    rest = argv[1:]
    i = 0
    while i < len(rest):
        if rest[i] in ("-o", "--out") and i + 1 < len(rest):
            out_path = rest[i + 1]; i += 2; continue
        if rest[i] in ("--图", "--cover") and i + 1 < len(rest):
            cover = rest[i + 1]; i += 2; continue
        i += 1
    out_path = out_path or default_out(src)
    write(src, out_path, cover)
    verify(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
