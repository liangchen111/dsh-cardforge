# -*- coding: utf-8 -*-
"""forge.dist —— 工程包的分发：出去（清单）与回来（导入）。

`bundle` 把工程打成一个 zip；这里补上另一半。

分发的两个麻烦，都在「包离开这台电脑之后」：

  1. **包到底完不完整**。zip 传了一手，少一个文件、坏一个字节，谁也看不出来，
     一直到别人的卡上界面空了一块才发现。所以包里带一份**清单**
     （`包信息.json`：每个文件的字节数与 sha256）。收包时可以逐条核。
  2. **包里的路径能不能信**。zip 里的条目名是**别人给的字符串** ——
     里头写着 `../../../Windows/System32/...` 或者 `C:\\...` 是完全合法的 zip。
     照着写出去，就是「解压一个包，往系统目录塞文件」。所以导入时逐条查，
     绝对路径、盘符、`..` 一律硬拒（宁可拒掉一个正常包，也不放过一个恶意的）。

另一件事：外来卡常常是**单张 `.card.json`**（不是工程包）。那种情况走 unpack，
落成一个只有内容层的工程 —— 界面层本来就不在卡里，得说清楚，别让人以为丢了东西。
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import zipfile

from . import model as M
from . import pack
from . import sandbox as SB

# 包信息文件名（放在包里最上面那一层目录下）
MANIFEST = "包信息.json"
MANIFEST_FORMAT = "forge.工程包"
MANIFEST_VERSION = 1

# 打包时不带走的（与 bundle.SKIP_DIRS 一致；这里再写一份是为了导入方向也独立成立）
SKIP_DIRS = {"__pycache__", "out", ".git", ".workbuddy", "node_modules"}
SKIP_TAILS = (".pyc", ".pyo")


class DistError(Exception):
    """分发层的硬错：包结构不对、路径不可信、目标已存在。停，不含糊过去。"""


# ------------------------------------------------------------------ 清单
def _digest(path, limit=None):
    """文件的 sha256（前 16 位就够用：这是查损坏，不是防篡改）。"""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()[:16]


def _card_name_of(project):
    from . import hud as HUD
    spec = HUD.find_spec(project)
    if not spec:
        return ""
    data = M.yload(spec) or {}
    return str((data.get("character") or {}).get("name") or "")


def _modules_of(project):
    """这张卡「有界面文件」的模块（= hud/模块/ 下那些目录、conf 里登记的那些）。

    注意：像「骰子」那种只有条目与正则、没有脚本样式的模块**不在这里** ——
    它的内容已经并进 spec，收包人从条目里看得见，不属于「包里的文件」。
    """
    path = os.path.join(project, "hud", "hud.conf.json")
    if not os.path.isfile(path):
        return [], ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            conf = json.load(f)
    except Exception:
        return [], ""
    mods = [str(x) for x in (conf.get("模块") or [])]
    return mods, str(conf.get("主题") or "")


def build_manifest(project, name, files=None, with_card=False):
    """算一份包信息。files 是相对工程根的文件路径列表；不给就现扫一遍。"""
    project = os.path.abspath(project)
    if files is None:
        files = []
        for base, dirs, fs in os.walk(project):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
            for f in sorted(fs):
                if f.endswith(SKIP_TAILS):
                    continue
                files.append(os.path.join(base, f))

    listing = {}
    for p in files:
        rel = os.path.relpath(p, project).replace(os.sep, "/")
        if rel == MANIFEST:
            continue
        try:
            listing[rel] = {"大小": os.path.getsize(p), "校验": _digest(p)}
        except OSError:
            continue

    mods, skin = _modules_of(project)
    return {
        "格式": MANIFEST_FORMAT,
        "版本": MANIFEST_VERSION,
        "工具": "forge %s" % _forge_version(),
        "卡名": _card_name_of(project) or name,
        "生成时间": M.now_iso(),
        "含酒馆卡": bool(with_card),
        "界面模块": mods,
        "皮肤": skin,
        "文件数": len(listing),
        "清单": listing,
    }


def _forge_version():
    try:
        from . import __version__
        return __version__
    except Exception:
        return "?"


def read_manifest(src):
    """从 zip 或工程目录里读包信息。没有就返回 None（老包不算错）。"""
    if os.path.isdir(src):
        p = os.path.join(src, MANIFEST)
        if not os.path.isfile(p):
            return None
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    try:
        with zipfile.ZipFile(src) as z:
            for n in z.namelist():
                if os.path.basename(n) == MANIFEST:
                    with z.open(n) as f:
                        return json.loads(f.read().decode("utf-8"))
    except Exception:
        return None
    return None


# ------------------------------------------------------------------ 导入
def _safe_member(name):
    """zip 条目名能不能信。返回 True/False —— 这是**安全边界**，不是风格检查。

    三类都拒：绝对路径（`/x`、`C:/x`）、向上的跳（`..`）、以及任何一段里带冒号的
    （Windows 的盘符与 NTFS 数据流 `a.txt:b` 都靠冒号，正常文件名里不该有）。
    """
    n = str(name or "").replace("\\", "/")
    if not n or n.startswith("/") or n.startswith("~"):
        return False
    parts = [p for p in n.split("/") if p not in ("", ".")]
    for p in parts:
        if p == ".." or ":" in p:
            return False
    return True


def _top_of(names):
    """包里最上面那一层目录名（工程包都是「<卡名>/…」）。"""
    for n in names:
        n2 = n.replace("\\", "/")
        if "/" in n2:
            head = n2.split("/")[0]
            if head:
                return head
    return ""


def import_pack(src, dest_root, rename=False, verify=True, out=print):
    """把一个工程包（或单张卡）落到本地。返回工程目录的绝对路径。"""
    src = os.path.abspath(str(src or ""))
    if not os.path.isfile(src):
        raise DistError("找不到包：%s" % (src or "(空)"))
    dest_root = os.path.abspath(dest_root or ".")

    if src.lower().endswith(".zip"):
        return _import_zip(src, dest_root, rename=rename, verify=verify, out=out)
    return _import_card(src, dest_root, rename=rename, out=out)


def _import_zip(src, dest_root, rename, verify, out):
    try:
        with zipfile.ZipFile(src) as z:
            names = z.namelist()
            bad = [n for n in names if not _safe_member(n)]
            if bad:
                raise DistError(
                    "这个包里有 %d 个路径不可信的条目，整包拒收：\n    %s\n"
                    "  包里的条目名是别人给的字符串 —— 照着写出去就是往系统目录塞文件。"
                    % (len(bad), "\n    ".join(bad[:4])))

            top = _top_of(names)
            manifest = None
            for n in names:
                if os.path.basename(n) == MANIFEST:
                    try:
                        manifest = json.loads(z.read(n).decode("utf-8"))
                    except Exception:
                        manifest = None
                    break

            name = ""
            if manifest:
                name = str(manifest.get("卡名") or "")
            name = _clean_name(name) or _clean_name(top) or \
                os.path.splitext(os.path.basename(src))[0].replace(".工程包", "")
            if not name:
                raise DistError("这个包里看不出卡名（既没有 %s，顶层也没有目录）。" % MANIFEST)

            dest = os.path.join(dest_root, name)
            dest = _settle(dest, rename)
            os.makedirs(dest, exist_ok=True)

            out("收包 %s" % os.path.basename(src))
            if manifest:
                out("  %s · 由 %s 生成 · %s"
                    % (manifest.get("卡名", name), manifest.get("工具", "?"),
                       manifest.get("生成时间", "?")))
            out("")

            # 解压：剥掉顶层那一层目录（如果有）
            count = 0
            for n in sorted(names):
                if n.endswith("/"):
                    continue
                if os.path.basename(n) == MANIFEST and os.path.dirname(n.replace("\\", "/")) in ("", top):
                    continue                      # 包信息本身不落进工程（它是包的信封，不是内容）
                rel = n.replace("\\", "/")
                if top and rel.startswith(top + "/"):
                    rel = rel[len(top) + 1:]
                if not rel:
                    continue
                target = os.path.join(dest, rel.replace("/", os.sep))
                if not os.path.abspath(target).startswith(dest + os.sep) and \
                        os.path.abspath(target) != dest:
                    raise DistError("条目越界：%s" % n)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with z.open(n) as fsrc, open(target, "wb") as fdst:
                    shutil.copyfileobj(fsrc, fdst)
                count += 1
    except zipfile.BadZipFile as exc:
        raise DistError("这不是一个完好的 zip：%s" % exc)

    out("  解开 %d 个文件 -> %s" % (count, dest))

    if verify and manifest:
        _check_manifest(dest, manifest, out)

    _report_project(dest, out)
    return dest


def _import_card(src, dest_root, rename, out):
    name = _clean_name(os.path.splitext(os.path.basename(src))[0])
    if name.endswith(".card"):
        name = name[:-len(".card")]
    name = _clean_name(name) or "外来卡"
    dest = _settle(os.path.join(dest_root, name), rename)
    src_dir = os.path.join(dest, "source")
    os.makedirs(src_dir, exist_ok=True)
    spec = os.path.join(src_dir, name + ".spec.yaml")

    out("收卡 %s" % os.path.basename(src))
    out("")
    try:
        pack.unpack(src, spec)
        out("  按 ElecKoi 卡解包 -> %s" % os.path.relpath(spec, dest))
    except Exception as first:
        try:
            from . import bridge
            bridge.to_eleckoi(src, spec, out=out)
            out("  ElecKoi 解包没成（%s），按酒馆 V2 卡转过来了。" % first)
        except Exception as second:
            # 收卡失败 → 把这个刚建出来的目录撤掉（沙箱里撤不掉，那就留着，别谎称干净）
            SB.rmtree(dest)
            raise DistError("这张卡既不是 ElecKoi 卡也不是酒馆 V2 卡：%s" % second)
    out("  注意：卡里只有内容层（source/），界面层（hud/）本来就不在卡里 —— 没丢东西。")
    out("  想要卡内界面：`forge.py new <卡名> --从 \"%s\"` 开一张带界面的新卡，内容用它的。"
        % os.path.basename(src))
    _report_project(dest, out)
    return dest


def _check_manifest(dest, manifest, out):
    """逐条核清单。不对的**如实说出来**，但不禁掉 —— 这是完整性提示，不是城门。"""
    listing = manifest.get("清单") or {}
    bad_size, bad_hash, missing = [], [], []
    for rel, info in listing.items():
        p = os.path.join(dest, rel.replace("/", os.sep))
        if not os.path.isfile(p):
            missing.append(rel)
            continue
        if info.get("大小") is not None and os.path.getsize(p) != info["大小"]:
            bad_size.append(rel)
            continue
        if info.get("校验") and _digest(p) != info["校验"]:
            bad_hash.append(rel)
    if not (bad_size or bad_hash or missing):
        out("  清单核过：%d 个文件与包信息一致。" % len(listing))
        return
    out("")
    out("  ⚠ 清单对不上（包在路上坏了，或者包被动过）：")
    if missing:
        out("      少文件 %d 个：%s" % (len(missing), "、".join(missing[:3])))
    if bad_size:
        out("      字节数不符 %d 个：%s" % (len(bad_size), "、".join(bad_size[:3])))
    if bad_hash:
        out("      内容不符 %d 个：%s" % (len(bad_hash), "、".join(bad_hash[:3])))
    out("      文件已经解出来了，能看能改；但别直接拿来出卡 —— 先跟发卡的人对一下。")


def _report_project(dest, out):
    from . import hud as HUD
    spec = HUD.find_spec(dest)
    if not spec:
        out("")
        out("  （这个目录里没有 source/*.spec.yaml —— 包结构可能不对。）")
        return
    try:
        card = pack.spec_to_card(spec)
        from . import validate
        s = validate.summarize(card)
        issues = validate.validate_card(card, os.path.basename(dest))
        errs = [i for i in issues if i.level == "ERROR"]
        warns = [i for i in issues if i.level == "WARN"]
        out("")
        out("  %s：条目 %d · 分组 %d · 变量 %d · 正则 %d"
            % (s["name"] or "(无名)", s["entries"], s["groups"],
               s["variables"], s["regex"]))
        out("  体检：%d 错 · %d 警告 · %d 提示"
            % (len(errs), len(warns), len([i for i in issues if i.level == "INFO"])))
    except Exception as exc:
        out("  （体检没跑成：%s）" % exc)
    out("")
    out("下一步： python forge.py check \"%s\"" % dest)
    out("        python forge.py ui --根 \"%s\"" % os.path.dirname(dest))


# ------------------------------------------------------------------ 小工具
def _clean_name(s):
    """把卡名收拾成能当目录名的样子（去掉包名后缀与非法字符）。"""
    s = str(s or "").strip()
    for tail in (".工程包", ".spec", ".card"):
        if s.endswith(tail):
            s = s[:-len(tail)]
    for ch in '\\/:*?"<>|':
        s = s.replace(ch, "_")
    return s.strip().strip(".")


def _settle(dest, rename):
    """目标已经在了怎么办。rename=True 就自动错开一个；否则停 —— 不覆盖别人的东西。"""
    if not os.path.exists(dest):
        return dest
    if not rename:
        raise DistError(
            "目标已经存在：%s\n"
            "  换个地方（--到 目录），或者加 --改名 让它自动叫「…-2」。" % dest)
    i = 2
    while os.path.exists("%s-%d" % (dest, i)):
        i += 1
    return "%s-%d" % (dest, i)
