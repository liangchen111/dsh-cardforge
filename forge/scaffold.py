# -*- coding: utf-8 -*-
"""forge.scaffold —— 开一张新卡：把骨架整个抄一份，换掉名字。

生成的工程同时带两样东西：

    内容层 ——  source/<卡名>.spec.yaml          改内容只改这里
    界面层 ——  hud/（HUD 核心 / 样式 / 视图 / conf）   改外观只改这里

**换名只做三处替换**，跟原骨架那套一致：

    骨架  → 卡名
    SKEL  → 前缀大写（拼成 JS 里的 <前缀大写>_HUD）
    skel  → 前缀小写（条目 id、样式 id、正则 id、conf 里的 id_prefix）

模块里的 JS/CSS 写的也是 `skel` / `SKEL_HUD`，所以它们不必为某张卡改一个字 ——
名字是在建卡这一趟跟着一起换掉的。**顺序不能反：先接模块，再换名。**
"""
from __future__ import annotations

import os
import shutil
import zipfile
from collections import OrderedDict

from . import model as M
from . import sandbox as SB

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKELETON = os.path.join(ROOT, "assets", "骨架")

SRC_NAME = "骨架"
SRC_SLUG = "skel"

# 骨架自己跑出来的产物，不带进新工程（新卡要自己跑一遍）
SKIP_DIRS = {"__pycache__", "out"}
SKIP_FILES = {"预览.html"}

TEXT_EXT = {".py", ".js", ".css", ".json", ".yaml", ".yml", ".html", ".md", ".txt"}

PROJECT_README = """# {name} · 怎么开工

一条命令生成的制卡工程。它分两层，改的地方不一样：

| 改什么 | 动哪里 |
|---|---|
| 卡的内容（世界观、条目、变量、正则） | `source/{name}.spec.yaml` |
| 卡的界面（建卡器 / 面板 / 悬浮球长什么样） | `hud/` 下的文件 |
| 卡的颜色（皮肤） | `hud/主题.css` —— 由 `forge theme` 写，别手改 |
| 卡里接哪些现成机制 | 用 `forge add` / `forge drop`，别手改 |

**别手改卡文件**（`成品/{name}.card.json`）—— 它是派生物，改了下一次构建就没了。
**也别手改 `模块账本.json`** —— 撤模块全靠它。

## 常用命令

```
python {forge} check  source/{name}.spec.yaml     先跑这个，看有没有坑
python {forge} hud    .                           组装界面（出 预览.html）
python {forge} hud    . --写回                     组装并把正则写回 spec
python {forge} build  source/{name}.spec.yaml 成品/{name}.card.json
python {forge} check  成品/{name}.card.json
python {forge} manual source/{name}.spec.yaml     出人读手册
python {forge} mods   --工程 .                    看有哪些机制、接没接、要不要更新
python {forge} theme                              看有哪些皮肤
python {forge} theme  墨夜 .                       换皮肤（换完记得再 hud 一次）
python {forge} bundle .                           打成一个包，发给别人
```

（`{forge}` 是制卡工具的 `forge.py`，不在本工程里 —— 用它的绝对路径，或者把它加进 PATH。）

## 顺序别乱

1. 先改 `source/{name}.spec.yaml` 里〈核心 · 世界总纲〉那一条 —— 它每轮都进提示，
   是最该先想清楚的一条。
2. 把开场白写进 `hud/hud.conf.json` 的「开场白」正文（改完跑一次 `hud --写回`）。
3. 演示条目（名册 · 常用名字 / 规则 · 判定）用完就删或改成自己的。
4. 每改一轮跑一次 `check`；动了 `hud/` 就跑 `hud --写回` 再 `build`。

## 界面那一层是什么

`hud/hud.core.js` 是**通用骨架**：它把变量树原样画成面板，并提供一间建卡器
（把「玩家」那份档案填成表单，封缄即写回变量）与一颗常驻悬浮球。
它不含任何世界观内容 —— 你加变量，面板上就多一行，不用改代码。

想动界面就改 `hud/hud.css`（换颜色别改它，跑 `forge theme`）；改 `hud.core.js`
等于改机制，改之前先跑 `node 测试/test_core.js` 确认现在是绿的。

## 想加现成的机制

```
python {forge} mods --工程 .                        # 看有哪些、接没接
python {forge} add 骰子 source/{name}.spec.yaml      # 接上骰子（改判定那一条）
python {forge} drop 骰子 source/{name}.spec.yaml     # 后悔了就撤，接之前的样子还在账本里
```

接过模块之后，记得再跑一次 `hud --写回` 让界面带上它（脚本/样式落在 `hud/模块/` 下）。
**撤模块是精确的**：替换的那条还原成原样、新增的那条删掉、正则按 id 删、
界面文件与登记一并摘掉。你自己在 spec 里手写的东西，工具一律不动。

## 三条纪律

- **一条条目只干一件事。** 越长越该拆：拆开之后各自有自己的标题和「什么时候读我」。
- **常驻只放每轮必须看见的东西。** 其余一律走按需（不占每轮上下文）。
- **资料类走按需，规则类走关键词。** 关键词挑短词。

## 卡由什么构成

角色壳 + 设定库 +（可选）变量 +（可选）正则 +（可选）图片。
详见 `{manual}`。
"""


def new_card(name, dest=None, id_prefix=None, quiet=False, modules=None,
             build_hud=True, source=None):
    """在 dest/<name>/ 下生成一张新卡的工程目录。返回工程根路径。

    modules：顺手接上的模块名（见 assets/模块/），如 ["骰子", "备份"]。
    build_hud：生成后立刻组装一次界面（出 预览.html），确认新生的是通的最小验证。
    source：接手一张现成的卡 —— 界面层照抄骨架，内容层用它的（见 `灌内容`）。
    """
    if not os.path.isdir(SKELETON):
        raise FileNotFoundError("找不到骨架：%s" % SKELETON)

    name = str(name or "").strip()
    if not name:
        raise ValueError("卡名不能为空")
    if any(c in name for c in '\\/:*?"<>|'):
        raise ValueError('卡名不能带 \\ / : * ? " < > | 这些字符：%s' % name)

    dest = os.path.abspath(dest or os.getcwd())
    prefix = id_prefix or M.ascii_prefix(name)
    proj = os.path.join(dest, name)
    if os.path.exists(proj) and os.listdir(proj):
        raise FileExistsError("目录已存在而且不是空的：%s" % proj)

    # ---- 1. 抄骨架（整棵树；产物不带过去）
    #
    #  **换名只做三处替换**，先定下规则再抄 —— 沙箱模式下文件名要在**抄的那一刻**就换好：
    #  那儿改不了名，先抄一个旧名再换就等于留下一个删不掉的多余文件。
    subs = [(SRC_NAME, name), (SRC_SLUG.upper(), prefix.upper()), (SRC_SLUG, prefix)]

    def _换名(base):
        for a, b in subs:
            base = base.replace(a, b)
        return base

    copied = 0
    for root, dirs, files in os.walk(SKELETON):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f in SKIP_FILES:
                continue
            src = os.path.join(root, f)
            rel = os.path.relpath(src, SKELETON)
            if SB.enabled():
                rel = os.path.join(os.path.dirname(rel), _换名(f))
            dst = os.path.join(proj, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            copied += 1
    os.makedirs(os.path.join(proj, "成品"), exist_ok=True)

    # ---- 2. 换名字：先改内容，再改文件名
    #
    #  **为什么排在接模块之前**：模块的 JS/CSS 里写的是 skel / SKEL_HUD ——
    #  换名之后再接，模块那一份就由 forge.mods 按这张卡的真名落盘，
    #  两边走的是同一条替换规则，不必为某张卡改模块一个字。
    touched = renamed = 0
    for root, dirs, files in os.walk(proj):
        for f in files:
            p = os.path.join(root, f)
            if os.path.splitext(f)[1].lower() not in TEXT_EXT:
                continue
            try:
                text = open(p, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            new = text
            for a, b in subs:
                new = new.replace(a, b)
            if new != text:
                with open(p, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(new)
                touched += 1
            base = _换名(f)
            if base != f:
                # 沙箱模式下这一步上面已经做完了（文件名抄的时候就换好），走不到这儿
                SB.rename(p, os.path.join(root, base))
                renamed += 1

    spec_path = os.path.join(proj, "source", "%s.spec.yaml" % name)
    spec = M.yload(spec_path)
    if not (spec.get("library") or {}).get("entries"):
        raise RuntimeError("骨架坏了：生成出来的 spec 没有条目")

    说 = (lambda *a, **k: None) if quiet else print

    # ---- 2.5 接手现成的卡：界面层照抄骨架，内容层换成它的（--从）
    #
    #  为什么排在这儿：骨架那套名字已经换好（界面层与 spec 都姓新卡名），这时把内容层
    #  整体换掉，接下来第一次 `hud --写回` 就会拿新 conf 的正则与开场白去对齐这份内容 ——
    #  顺序反了就会先写回旧内容、再被灌掉。
    来源说明 = ""
    if source:
        工作区 = os.path.join(proj, ".forge", "_取")
        os.makedirs(工作区, exist_ok=True)
        try:
            外来, 来源说明 = 取内容层(source, 工作区, out=说)
            条数, 开场状态, 禁用 = 灌内容(spec_path, 外来, proj, out=说, 有界面=build_hud)
        except Exception:
            # 接手失败就**把这个刚建出来的目录撤掉**：它此刻是「骨架内容 + 一半东西」，
            # 留着比不留更容易骗人（用户会以为建好了）。proj 是这一趟刚建的，撤它安全。
            # 沙箱里撤不掉 —— 那也得说一声，不能让人以为这儿是干净的。
            if not SB.rmtree(proj) and os.path.isdir(proj):
                print("  ！沙箱模式撤不掉刚建的目录，它留在原地了：%s（可手删）" % proj)
            raise
        finally:
            SB.rmtree(工作区)
        if not quiet:
            print()
            print("接手现成的卡：%s" % 来源说明)
            print("  灌进 %d 条条目 · 开场白 %s" % (条数, 开场状态))
            if 禁用:
                print("  · 其中 %d 条来源里是「已禁用」，按原样留着（卡里留着，但不生效）：%s"
                      % (len(禁用), "、".join(禁用[:5]) + ("…" if len(禁用) > 5 else "")))
                print("      要让它生效：python forge.py entry <spec> --改 \"%s\" --启用" % 禁用[0])

    # ---- 3. 先把界面层的正则写进去（conf 那两条占 order 10 / 20）
    #
    #  **必须在接模块之前**：模块的正则是照着「现有正则的 order 往后排」放的，
    #  conf 那两条先落了位，模块就不会跟它们撞车（撞了平台那边先后会变得随机）。
    from . import hud as HUD
    if build_hud:
        HUD.build(proj, write_back=True, out=(lambda *a: None) if quiet else print)

    # ---- 4. 接模块（条目/正则进 spec，脚本/样式进 hud/模块/）
    names = [str(m).strip() for m in (modules or []) if str(m).strip()]
    mod_error = None
    if names:
        from . import mods as MODS
        if not quiet:
            print()
            print("顺手并模块：")
        try:
            MODS.apply_modules(spec_path, names, project=proj,
                               out=(lambda *a: None) if quiet else print)
        except Exception as exc:                        # 模块接不上不该毁掉整张卡
            mod_error = exc
            if not quiet:
                print("  !! 模块这一趟没接上：%s" % exc)

    # ---- 5. 再组装一次：把模块的脚本/样式拼进页面
    hud_problems = []
    if build_hud:
        hud_problems, _ = HUD.build(proj, write_back=True,
                                    out=(lambda *a: None) if quiet else print)
        spec = M.yload(spec_path)

    manual = os.path.join(ROOT, "文档", "使用说明.md")
    forge = os.path.join(ROOT, "forge.py")
    with open(os.path.join(proj, "怎么开工.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(PROJECT_README.format(name=name, forge=_rel(forge, proj),
                                      manual=_rel(manual, proj)))

    if not quiet:
        print("已开新卡 -> %s" % proj)
        print("  抄过来 %d 个文件 · 改写 %d 个 · 改名 %d 个" % (copied, touched, renamed))
        print("  卡名 %s · id 前缀 %s · HUD 全局名 %s_HUD" % (name, prefix, prefix.upper()))
        print("  条目 %d 条（含开场白）· 变量 %d 个"
              % (len(spec["library"]["entries"]), len((spec.get("variables") or {}).get("variables") or [])))
        if 来源说明:
            print("  内容层 %s" % 来源说明)
            print("  （条目 id 保持原样 —— 卡里按 id 互相引用，改名就断链）")
        if mod_error:
            print("  ⚠ 模块没接上：%s" % mod_error)
        if hud_problems:
            print("  ⚠ 界面组装有 %d 个问题：" % len(hud_problems))
            for p in hud_problems:
                print("      · %s" % p)
        print()
        print("下一步：")
        print("  1. 打开 %s\\预览.html 看看默认长什么样" % proj)
        print("  2. %s source\\%s.spec.yaml"
              % ("接着改" if 来源说明 else "改", name))
        print("  3. python %s check \"%s\"" % (_rel(forge, proj), spec_path))
    return proj


# ---------------------------------------------------------------- --从（接手现成的卡）
#
#  「别人给了一张卡」以前是条死路：单张 `.card.json` 收进来只有内容层（`hud/` 本来就不在
#  卡里），于是没有界面层 → `opener` 不认、`hud` 不肯凭空造、规程又让人别手改。唯一出路
#  「开新卡把条目搬过去」**根本没有搬运命令** —— 十一条条目加十个变量加九条正则，人肉重建。
#  这条命令就是那条缺失的搬运：**用骨架拿界面层，用卡拿内容层**，两边各取所长。

def 取内容层(src, 工作区, out=print):
    """把「卡 / 工程包 / spec / 工程目录」统一取成一份内容层 spec。返回 (spec, 来源说明)。

    四种来源走四条路，出来的都是同一个形状 —— 灌内容那一步不必知道东西从哪来。
    """
    src = os.path.abspath(str(src or ""))
    if not os.path.exists(src):
        raise FileNotFoundError("找不到来源：%s" % src)
    if os.path.isdir(src):
        return _从目录(src, 工作区, out)
    ext = os.path.splitext(src)[1].lower()
    if ext == ".zip":
        return _从包(src, 工作区, out)
    if ext in (".yaml", ".yml"):
        return M.yload(src), "spec：%s" % os.path.basename(src)
    return _从卡(src, 工作区, out)


def _从卡(src, 工作区, out=print):
    """单张卡：先按 ElecKoi 卡解，不成就按酒馆 V2 卡转。"""
    from . import bridge, pack
    临时 = os.path.join(工作区, "_取内容.spec.yaml")
    try:
        pack.unpack(src, 临时)
        说明 = "ElecKoi 卡：%s" % os.path.basename(src)
    except Exception as 一:
        try:
            bridge.to_eleckoi(src, 临时, out=lambda *a: None)
            说明 = "酒馆卡（转成草稿）：%s" % os.path.basename(src)
        except Exception as 二:
            raise RuntimeError("这张卡既不是 ElecKoi 卡也不是酒馆 V2 卡：%s" % 二)
    return M.yload(临时), 说明


def _从包(src, 工作区, out=print):
    """工程包：解开，优先取里面的 spec（最浅的那个），退一步取成品卡。"""
    from . import dist
    解包 = os.path.join(工作区, "_取包")
    os.makedirs(解包, exist_ok=True)
    try:
        with zipfile.ZipFile(src) as z:
            成员 = [n for n in z.namelist() if not n.endswith("/")]
            野 = [n for n in 成员 if not dist._safe_member(n)]
            if 野:
                raise RuntimeError(
                    "包里 %d 个条目路径不可信，整包拒收：%s" % (len(野), "、".join(野[:3])))
            z.extractall(解包)
    except zipfile.BadZipFile as exc:
        raise RuntimeError("这不是一个完好的 zip：%s" % exc)
    卡 = _找文件(解包, ".spec.yaml")
    if 卡:
        return M.yload(卡[0]), "工程包（内容层）：%s" % os.path.basename(src)
    卡 = _找文件(解包, ".card.json") or _找文件(解包, ".json")
    if 卡:
        return _从卡(卡[0], 工作区, out)
    raise RuntimeError("这个包里既没有 source/*.spec.yaml 也没有卡文件：%s" % src)


def _从目录(src, 工作区, out=print):
    卡 = _找文件(src, ".spec.yaml")
    if 卡:
        return M.yload(卡[0]), "工程目录：%s" % os.path.basename(os.path.abspath(src))
    卡 = _找文件(src, ".card.json") or _找文件(src, ".json")
    if 卡:
        return _从卡(卡[0], 工作区, out)
    raise RuntimeError("这个目录里既没有 spec 也没有卡文件：%s" % src)


def _找文件(root, 尾):
    """在 root 下找以 `尾` 结尾的文件，**最浅的排前面**（工程外层的才是正主）。"""
    出 = []
    for 层, _, 文件们 in os.walk(root):
        for f in 文件们:
            if f.lower().endswith(尾):
                出.append(os.path.join(层, f))
    出.sort(key=lambda p: (len(p.split(os.sep)), p))
    return 出


def 灌内容(spec_path, 外来, proj, out=print, 有界面=True):
    """把一份外来 spec 灌进新工程的 spec，并让开场白两边对齐。

    返回 `(条目数, 开场白状态, 已禁用的条目标题列表)`。

    **不动外来条目的 id**：卡里的变量、正则、条目互相按 id 引用，改名就是断链。
    新工程的 id 前缀只作用于骨架抄来的东西（界面层那套）。

    **卡名不回借**：character 层其余字段照收，只有 `name` 钉回新工程的名字 ——
    名字的真相只能有一个（工程目录 / 界面配置 / spec 三处必须同名）。
    """
    from . import opener as OPENER
    骨架 = M.yload(spec_path)
    新 = OrderedDict()
    for k in ("format", "version"):
        新[k] = 骨架.get(k) or 外来.get(k)
    #  **卡名归新卡。** 外来 character 层其余字段（简介、年龄、性别…）照收 —— 那一层是
    #  「借它的内容」；但名字借过来就是错的：工程目录与界面配置都叫新名，只有 spec 顶着
    #  旧名，`check` 也不报，等于埋了个静默矛盾（盲跑实测：`new 盲跑测试卡 --从 酒馆卡`
    #  之后 spec 里仍写着「示例酒馆卡」）。名字的真相只能有一个。
    外来壳 = dict(外来.get("character") or {})
    外来壳["name"] = (骨架.get("character") or {}).get("name") or 外来壳.get("name") or ""
    新["character"] = 外来壳
    新["assets"] = 外来.get("assets") or []
    新["library"] = 外来.get("library") or {}
    新["variables"] = 外来.get("variables") or {}
    新["regex_rules"] = 外来.get("regex_rules") or []
    for k, v in (外来 or {}).items():                    # unpack 留下的「原样保留」字段
        if k not in 新:
            新[k] = v

    lib = 新["library"]
    条 = [e for e in (lib.get("entries") or []) if isinstance(e, dict)]
    if not 条:
        raise RuntimeError("这份来源里没有条目（卡是空的），灌不进去。")
    lib["entries"] = 条
    开场 = None
    for e in 条:
        if str(e.get("kind") or "") == "opening":
            开场 = e
            break

    conf_p = os.path.join(proj, "hud", "hud.conf.json")
    conf = OPENER._读json(conf_p)
    块 = conf.setdefault("开场白", {})
    if 开场 is not None:
        正文 = _规整开场(_开场正文(开场), out)
        if 正文:
            开场["content"] = 正文
            方案 = [m for m in (开场.get("opening_messages") or []) if isinstance(m, dict)]
            块["条目"] = str(开场.get("id") or 块.get("条目")
                            or "fixed-opening-assistant")
            块["正文"] = 正文
            状态 = "取自外来卡 · %d 字" % len(正文.rstrip("\u200b"))
            # 各方案正文**原样留着**：酒馆卡常带好几套开场（默认 + 备选），一次写回
            # 会把它们压成同一份（骨架的建卡器只有一格正文）。那是损失，所以要出声 ——
            # 不接界面层建的工程不受这个影响。
            if 有界面 and len(方案) > 1:
                out("  ⚠ 外来卡有 %d 套开场方案 —— 骨架的建卡器只装得下一份正文，"
                    "这次接界面已把各方案统一成默认那套（备选那几套的内容没了）。" % len(方案))
                out("     想保住多套开场：别接界面层，用 `forge.py import <卡> --到 .` "
                    "收成内容档，各方案各自留着。")
        else:
            状态 = "⚠ 外来卡的开场白是空的 —— conf 保持骨架那条，记得改"
    else:
        骨架开场 = _骨架开场条目()
        if 骨架开场:
            条.insert(0, 骨架开场)
            状态 = "外来卡没有开场白 —— 用骨架那条占位，记得改"
        else:
            状态 = "外来卡没有开场白，骨架那条也没找到"
    OPENER._写json(conf_p, conf)
    M.ydump(新, spec_path)
    # 来源里带过来的「已禁用」条目：**原样留着**（卡里不生效），但得说出来 ——
    # 不然从列表上看它就是一条普通条目，「看着像生效、其实没生效」是最坑的那类。
    禁用 = [str(e.get("title") or "（无标题）") for e in 条 if not e.get("enabled", True)]
    return len(条), 状态, 禁用


def _规整开场(文, out=print):
    """开场白正文归位：末尾不多不少三个零宽标记。同 `opener.规范正文`，但**不因尖括号停工** ——
    这是搬运，不该因为来源里有个 `<` 就拒绝建卡；照实警告，让 `opener` 事后收拾。"""
    from . import opener as OPENER
    净 = str(文 or "").rstrip("\n").rstrip("\u200b")
    if not 净.strip():
        return ""
    if "<" in 净 or ">" in 净:
        out("  ⚠ 外来卡的开场白里有尖括号 —— 建卡界面可能不出现；跑一次 opener 改正文即可。")
    return 净 + OPENER.标记


def _开场正文(开场):
    """开场白条目里那份正文：优先 `content`，它空着就退到**默认方案**。

    两处会不一致（条目正文与世界书/卡里的方案正文），得按顺序问一遍 ——
    只认 `content` 的话，一份「正文只写进方案」的来源会被当成「没有开场白」，
    然后拿骨架那句占位，开场白**静默换人**。
    """
    if not isinstance(开场, dict):
        return ""
    文 = str(开场.get("content") or "").strip()
    if 文:
        return str(开场["content"])
    方案 = [m for m in (开场.get("opening_messages") or []) if isinstance(m, dict)]
    默认 = str(开场.get("default_opening_message_id") or "")
    if 默认:
        for m in 方案:
            if str(m.get("id") or "") == 默认 and str(m.get("content") or "").strip():
                return str(m["content"])
    for m in 方案:
        if str(m.get("content") or "").strip():
            return str(m["content"])
    return ""


def _骨架开场条目():
    """骨架里那条开场白（`kind: opening`），深拷贝一份 —— 外来卡没开场白时补个位。"""
    import copy
    p = os.path.join(SKELETON, "source", "%s.spec.yaml" % SRC_NAME)
    if not os.path.isfile(p):
        return None
    try:
        lib = (M.yload(p) or {}).get("library") or {}
    except Exception:
        return None
    for e in (lib.get("entries") or []):
        if isinstance(e, dict) and str(e.get("kind") or "") == "opening":
            return copy.deepcopy(e)
    return None


def _唯一spec(根):
    """工程里唯一那份 spec。没有或不止一份都返回 None（后者由 validate 去报）。"""
    d = os.path.join(根 or "", "source")
    if not os.path.isdir(d):
        return None
    hits = sorted(f for f in os.listdir(d) if f.endswith(".spec.yaml"))
    return os.path.join(d, hits[0]) if len(hits) == 1 else None


def 看卡名(target):
    """卡名现在是什么、几处对不对得上。返回 dict（给命令打印用）。"""
    from . import opener as OPENER
    根, 模式 = OPENER.定位(target)
    d = OrderedDict([("工程", 根), ("模式", 模式), ("目录名", os.path.basename(根 or "")),
                     ("spec", None), ("spec 卡名", ""), ("配置文件", None),
                     ("conf 卡名", "")])
    spec = _唯一spec(根)
    d["spec"] = spec
    if spec:
        try:
            doc = M.yload(spec) or {}
            d["spec 卡名"] = str(((doc.get("character") or {}).get("name")) or "")
        except Exception:
            pass
    conf_p = os.path.join(根 or "", "hud", "hud.conf.json")
    if os.path.isfile(conf_p):
        d["配置文件"] = conf_p
        try:
            conf = OPENER._读json(conf_p) or {}
            d["conf 卡名"] = str(conf.get("卡名") or "")
        except Exception:
            pass
    d["一致"] = (not d["conf 卡名"]) or (d["spec 卡名"] == d["conf 卡名"])
    return d


def 改卡名(target, 新名, out=print):
    """把卡名改成 新名：spec 的 `character.name` 与界面配置的「卡名」一起改。

    为什么要有这条命令：卡名散在两处（spec 是真相，conf 是界面层要用的），
    没有命令时只能手改 spec —— 手改完 conf 还是旧名，`check` 也不报，
    导进 ElecKoi 看到的卡名跟工程目录对不上，无从查起（盲跑实测）。

    **工程目录名不动**：改目录会把用户此刻的路径、以及别人手里的链接一并打乱。
    目录要不要跟着改，打印出来提醒，由用户自己决定。
    """
    from . import content as C
    from . import opener as OPENER
    名 = str(新名 or "").strip()
    if not 名:
        raise ValueError("新卡名不能空。")
    if any(c in 名 for c in '\\/:*?"<>|'):
        raise ValueError('卡名不能带 \\ / : * ? " < > | 这些字符：%s' % 名)

    根, _模式 = OPENER.定位(target)
    spec = _唯一spec(根)
    if not spec:
        raise FileNotFoundError(
            "这个工程里找不到唯一一份 spec（source/*.spec.yaml）：%s" % (根 or target))

    raw = C.load(spec)
    旧 = str(((raw.get("character") or {}).get("name")) or "")
    改了 = []
    if 旧 != 名:
        C.put_trash(spec, "卡名", "把卡名从「%s」改成「%s」" % (旧 or "（空）", 名),
                    [OrderedDict([("表", "卡名"), ("数据", {"name": 旧})])])
        raw.setdefault("character", OrderedDict())["name"] = 名
        C.commit(spec, raw, out)
        改了.append("spec")

    conf_p = os.path.join(根, "hud", "hud.conf.json")
    if os.path.isfile(conf_p):
        conf = OPENER._读json(conf_p) or OrderedDict()
        if str(conf.get("卡名") or "") != 名:
            conf["卡名"] = 名
            OPENER._写json(conf_p, conf)
            改了.append("界面配置")

    out("卡名：%s → %s" % (旧 or "（空）", 名))
    if 改了:
        out("  改了：%s" % "、".join(改了))
    else:
        out("  （两处本来就是这个名字，没动）")
    if os.path.basename(根) != 名:
        out("  ⚠ 工程目录还叫「%s」—— 目录名不在改名范围内（免得打乱你现在的路径）；"
            % os.path.basename(根))
        out("    想让目录名跟着改，自己在文件管理器里把那个文件夹重命名即可。")
    return {"旧": 旧, "新": 名, "改了": 改了}


def _rel(target, base):
    try:
        return os.path.relpath(target, base).replace("\\", "/")
    except Exception:
        return target
