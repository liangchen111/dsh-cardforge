# -*- coding: utf-8 -*-
"""forge.theme —— 换皮肤：一份 CSS 只覆盖颜色槽，版式一个字不动。

一个主题占一个文件 `assets/主题/<名>.json`：

    名 / 一句话 / 变量（一串 --hud-* 槽）/ 预览（预览页的外壳配色）

跑 `forge theme <名> <工程>` 会生成 `<工程>/hud/主题.css` ——
里面只有 `.hud, .hud-ball, .hud-ballpanel { --hud-*: … }` 这一段，
核心样式（hud.css）连碰都不碰。

**为什么分成两份而不是改核心那份**：换皮肤和改机制是两件事。
混在一份文件里，改配色的人会顺手把版式弄坏；而核心一升级，
配色又被覆盖。分成两份之后，两边各自演进，互不打扰 ——
这也让「主题」能跨卡复用：同一份主题对任何一张卡都成立。

主题只写它想改的槽，没写的落到核心默认（= 羊皮卷）。

一套主题能**离开这台电脑**：`--导出` 把卡上正在用的槽抄成一份 json，
`--导入` 把外来的 json 套上去，`--装` 则收进 assets/主题/ 变成全局可选。
"""

from __future__ import annotations

import json
import os

from . import model as M
from . import sandbox as SB

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES_DIR = os.path.join(ROOT, "assets", "主题")

THEME_FILE = "主题.css"
CONF_KEY = "主题"

# 核心（hud.css）认识的全部槽。主题写了清单外的键 = 硬错，当场停 ——
# 那种错不报错，只是在界面上永远不生效，谁也不会发现。
SLOTS = (
    "--hud-ink", "--hud-ink-2", "--hud-dim",
    "--hud-paper", "--hud-paper-solid", "--hud-field", "--hud-panel",
    "--hud-line", "--hud-line-2", "--hud-wash", "--hud-wash-2",
    "--hud-accent", "--hud-danger", "--hud-danger-ink", "--hud-danger-wash",
    "--hud-shadow", "--hud-radius", "--hud-radius-s", "--hud-font",
)

# 预览页外壳的默认配色（预览页不是卡，是给人看卡的台子；只影响这一页）
# 真正的默认值在 forge/hud.py —— 那里还要从主题给的三个色推出「暗 / 框 / 线」。


class ThemeError(Exception):
    """主题这一层的硬错：主题不存在、写了核心不认识的槽。停，不含糊过去。"""


# ------------------------------------------------------------------ 清点
def list_themes():
    out = []
    if not os.path.isdir(THEMES_DIR):
        return out
    for name in sorted(os.listdir(THEMES_DIR)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(THEMES_DIR, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            data = {"名": os.path.splitext(name)[0], "一句话": "（读不出来：%s）" % exc}
        data["_file"] = name
        data["_名"] = data.get("名") or os.path.splitext(name)[0]
        out.append(data)
    return out


def find_theme(name):
    key = str(name or "").strip()
    if not key:
        return None
    for t in list_themes():
        if t["_名"] == key or os.path.splitext(t["_file"])[0] == key:
            return t
    return None


# ------------------------------------------------------------------ 渲染
def render_css(theme):
    """把主题编成一份 CSS（只有变量覆盖）。"""
    name = theme.get("_名") or theme.get("名") or "(无名)"
    variables = theme.get("变量") or {}
    unknown = [k for k in variables if k not in SLOTS]
    if unknown:
        raise ThemeError(
            "主题「%s」写了核心不认识的槽：%s\n"
            "  核心认识的槽在 forge/theme.py 的 SLOTS 里；写错的槽不会报错、"
            "只是永远不生效 —— 所以这里直接停。" % (name, "、".join(unknown)))
    lines = [
        "/* 主题：%s —— %s" % (name, theme.get("一句话", "")),
        " * 由 `forge theme` 生成：只覆盖 --hud-* 颜色槽，版式来自 hud/hud.css。",
        " * 想微调就直接改这一段（下次跑 forge theme 会被覆盖）；",
        " * 想长期留住就把它做成 assets/主题/ 下的一个新主题。",
        " */",
        "",
        ".hud,",
        ".hud-ball,",
        ".hud-ballpanel {",
    ]
    for key in SLOTS:
        if key in variables:
            lines.append("  %s: %s;" % (key, variables[key]))
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def _read_conf(project):
    path = os.path.join(project, "hud", "hud.conf.json")
    if not os.path.isfile(path):
        raise ThemeError("这个工程里没有 hud/hud.conf.json：%s\n"
                         "  没有界面层就没有皮肤可换（内容层不受影响）。" % project)
    with open(path, "r", encoding="utf-8") as f:
        return path, json.load(f)


def current(project):
    """看这个工程现在用的皮肤。没有主题文件就是「核心默认」。"""
    _, conf = _read_conf(project)
    named = str(conf.get(CONF_KEY) or "").strip()
    exists = os.path.isfile(os.path.join(project, "hud", THEME_FILE))
    if named and exists:
        return named
    return "核心默认（羊皮卷）" if not exists else "（未登记）"


# ------------------------------------------------------------------ 应用
def apply_theme(name, spec_or_project, out=print):
    """给一个工程换皮肤。返回写出的 CSS 路径。"""
    project = _project_of(spec_or_project)
    theme = find_theme(name)
    if not theme:
        raise ThemeError("没有这个主题：%s（跑 `forge theme` 看有哪些）" % name)

    css_path = _apply(project, theme)

    out("已换皮肤：%s -> %s" % (theme["_名"], os.path.relpath(css_path, project)))
    out("  %s" % theme.get("一句话", ""))
    out("  %d 个槽写进 %s（核心样式一个字没动）"
        % (len(theme.get("变量") or {}), THEME_FILE))
    _speak_contrast(theme, out)
    out("")
    out("下一步： python forge.py hud \"%s\"   重新组装，看看新样子" % project)
    out("       python forge.py theme --巡览 \"%s\"   五套皮肤摆一起对比" % project)
    return css_path


def _apply(project, theme):
    """把一套主题真的落到工程上：写 hud/主题.css + 记进 hud.conf.json。

    只落盘、不出声 —— 换皮肤（apply）和套外来皮肤（import）都走这里，
    输出留给各自的调用方，措辞才贴得住场景。返回写出的 css 路径。
    """
    conf_path, conf = _read_conf(project)
    css = render_css(theme)

    hud_dir = os.path.join(project, "hud")
    css_path = os.path.join(hud_dir, THEME_FILE)
    with open(css_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(css)

    conf[CONF_KEY] = theme["_名"]
    # 预览页外壳的配色：主题给了就记下来，没给的由 hud 那边按三个色推
    prev = {k: v for k, v in (theme.get("预览") or {}).items() if v}
    if prev:
        conf["预览"] = prev
    else:
        conf.pop("预览", None)
    with open(conf_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(conf, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return css_path


def _speak_contrast(theme, out):
    """把一套皮肤的可读性体检结果说给人听。"""
    rep = contrast_report(theme)
    if rep:
        out("  可读性：%s（取最不利的宿主背景）" % _contrast_line(theme))
    poor = [k for k, v in rep.items() if not v["够"]]
    if poor:
        out("")
        out("  ⚠ %s 的对比度低于底线 —— 真界面上会发糊。" % "、".join(poor))
        out("    卡的底是半透明的，实际底色取决于宿主的聊天背景；"
            "这里按「宿主纯白」和「宿主近黑」各算一遍，取更差的那个。")


def clear_theme(spec_or_project, out=print):
    """撤掉皮肤，回到核心默认。"""
    project = _project_of(spec_or_project)
    conf_path, conf = _read_conf(project)
    css_path = os.path.join(project, "hud", THEME_FILE)
    removed = False
    if os.path.isfile(css_path):
        # 撤皮肤＝让这份文件不再起作用。沙箱里删不掉，就把它写成**空壳**
        # （一行 CSS 注释）—— 读进去等于没有皮肤，与删掉同一个效果。
        removed = SB.shell(css_path, "forge: 皮肤已撤回核心默认（沙箱模式不删文件，这一份是空壳）")
    if CONF_KEY in conf:
        conf.pop(CONF_KEY, None)
        removed = True
    conf.pop("预览", None)
    with open(conf_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(conf, f, ensure_ascii=False, indent=2)
        f.write("\n")
    out("已撤掉皮肤，回到核心默认（羊皮卷）。" if removed else "本来就是核心默认，没动。")
    return removed


def _project_of(spec_or_project):
    p = os.path.abspath(spec_or_project)
    if os.path.isfile(p):
        p = os.path.dirname(p)
    if os.path.basename(p) in ("source", "成品", "文档", "hud"):
        p = os.path.dirname(p)
    return p


# ------------------------------------------------------------------ 导出 / 导入
#
# 上面的五套是**自带的**；改出来的那一套原先只活在这一张卡的 hud/主题.css 里，
# 换张卡就没了。这里把两个方向都补上：
#
#   --导出   把这张卡现在用的槽抄成一份独立主题文件（能发给别人）
#   --导入   拿一份外来主题文件套到这张卡上（不必先装进 assets/主题/）
#   --装     把外来主题文件收进 assets/主题/（从此全局可选，像自带的那五套一样）
#
# 导出读的是**工程里那份 css**，不是 assets 里的原型 —— 这样「在卡上微调过的颜色」
# 也导得出来，那才是真正想留住的东西。


def _parse_css_slots(text):
    """从一份主题.css 里把 --hud-* 槽抄出来。"""
    import re
    out = {}
    for key, val in re.findall(r"(--hud-[a-z0-9-]+)\s*:\s*([^;{}]+);", text):
        out[key.strip()] = val.strip()
    return out


def export_theme(spec_or_project, out_path=None, name=None, out=print):
    """把工程当前用的皮肤导成一份独立主题文件。返回写出的 json 路径。"""
    import json as _json

    project = _project_of(spec_or_project)
    conf_path, conf = _read_conf(project)
    css_path = os.path.join(project, "hud", THEME_FILE)
    if not os.path.isfile(css_path):
        raise ThemeError(
            "这张卡现在用的是核心默认（没有 hud/%s），没有自己的槽可导。\n"
            "  先换一套再导： python forge.py theme <名> \"%s\"\n"
            "  或者在卡上微调 hud/%s 之后再来导 —— 导出的正是卡上那一份。"
            % (THEME_FILE, project, THEME_FILE))

    with open(css_path, "r", encoding="utf-8") as f:
        variables = _parse_css_slots(f.read())
    if not variables:
        raise ThemeError("hud/%s 里没抄到任何 --hud-* 槽，导不出东西。" % THEME_FILE)

    named = str(conf.get(CONF_KEY) or "").strip()
    theme = {
        "名": _clean_theme_name(name or named or (_card_name(project) + "皮肤")),
        "一句话": "从「%s」导出。" % (_card_name(project) or "某张卡"),
        "变量": variables,
    }
    prev = conf.get("预览")
    if isinstance(prev, dict) and prev:
        theme["预览"] = prev

    # 导之前先把可读性算一遍 —— 发出去的皮肤，别让人接到一片糊
    rep = contrast_report(theme)
    poor = [k for k, v in rep.items() if not v["够"]]

    out_path = out_path or os.path.join(project, "%s.皮肤.json" % theme["名"])
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        _json.dump(theme, f, ensure_ascii=False, indent=2)
        f.write("\n")

    out("已导出皮肤：%s（%d 个槽）" % (theme["名"], len(variables)))
    out("  -> %s" % out_path)
    if rep:
        out("  可读性：%s（取最不利的宿主背景）" % _contrast_line(theme))
    if poor:
        out("  ⚠ %s 的对比度低于底线 —— 换给别的卡同样会发糊。" % "、".join(poor))
    out("")
    out("给别人：把这份 json 发过去，对方跑 python forge.py theme --导入 \"%s\" <工程>"
        % os.path.basename(out_path))
    return out_path


def import_theme(json_path, spec_or_project, install=False, out=print):
    """拿一份外来主题文件套到工程上。install=True 顺带收进 assets/主题/。"""
    import json as _json

    json_path = os.path.abspath(str(json_path or ""))
    if not os.path.isfile(json_path):
        raise ThemeError("找不到主题文件：%s" % (json_path or "(空)"))
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            theme = _json.load(f)
    except Exception as exc:
        raise ThemeError("这份主题文件读不出来（不是 json？）：%s" % exc)
    if not isinstance(theme, dict) or not isinstance(theme.get("变量"), dict):
        raise ThemeError("这份文件里没有「变量」表 —— 不像是主题文件。"
                         "（用 `forge theme --导出` 出的那一份才是。）")

    theme = dict(theme)
    theme["_名"] = _clean_theme_name(theme.get("名") or
                                     os.path.splitext(os.path.basename(json_path))[0])
    if not theme["变量"]:
        raise ThemeError("这份主题的「变量」是空的。")

    # 先试编一遍 —— 槽写错就当场停，别写进工程才发现不生效
    render_css(theme)

    project = _project_of(spec_or_project)
    css_path = _apply(project, theme)
    out("已套上外来皮肤：%s -> %s" % (theme["_名"], os.path.relpath(css_path, project)))
    out("  %d 个槽写进 %s（核心样式一个字没动）"
        % (len(theme["变量"]), THEME_FILE))
    _speak_contrast(theme, out)

    if install:
        if not os.path.isdir(THEMES_DIR):
            os.makedirs(THEMES_DIR, exist_ok=True)
        target = os.path.join(THEMES_DIR, theme["_名"] + ".json")
        if os.path.exists(target):
            out("  （assets/主题/%s.json 已存在，没动它；要用就用 --导出 覆盖。）"
                % theme["_名"])
        else:
            with open(target, "w", encoding="utf-8", newline="\n") as f:
                f.write(json.dumps(theme, ensure_ascii=False, indent=2))
                f.write("\n")
            out("  已装进自带主题库：assets/主题/%s.json" % theme["_名"])
            out("  从此 `forge theme` 列表里就有它了，任何卡都能换。")
    out("")
    out("下一步： python forge.py hud \"%s\"   重新组装，看看新样子" % project)
    return theme["_名"]


def _clean_theme_name(s):
    s = str(s or "").strip()
    for tail in (".皮肤", ".json", ".主题"):
        if s.endswith(tail):
            s = s[:-len(tail)]
    for ch in '\\/:*?"<>|':
        s = s.replace(ch, "_")
    return s.strip() or "外来皮肤"


def _card_name(project):
    from . import hud as HUD
    spec = HUD.find_spec(project)
    if not spec:
        return ""
    data = M.yload(spec) or {}
    return str((data.get("character") or {}).get("name") or "")


# ------------------------------------------------------------------ 可读性体检
#
# 皮肤最容易出的问题不是「难看」，是「看不清」：浅色字配浅色底，
# 在编辑器里预览时刚好能看见，压到真界面上就成了灰糊糊一片 —— 那种错
# 没人会报，只会让人觉得「这张卡怎么这么累眼睛」。所以这里把对比度算出来。
#
# 卡片的底是半透明的（要压在宿主的消息背景上），宿主什么颜色我们不知道，
# 就按「最不利的两种情况」各算一遍取更差的那个：宿主纯白、宿主近黑。

_HOST_BACKDROPS = ((255, 255, 255), (20, 20, 20))

# 角色 -> (显示名, 最低对比度)。4.5 是 WCAG AA 的正文线；次级与淡字分级放宽。
_CONTRAST_ROLES = (
    ("--hud-ink", "正文", 4.5),
    ("--hud-ink-2", "次级", 3.0),
    ("--hud-dim", "淡字", 2.0),
)


def _parse_color(value):
    """认 #rrggbb 与 rgb()/rgba()，返回 (rgb 三元组, alpha)。认不出返回 (None, None)。"""
    import re
    v = str(value or "").strip()
    m = re.match(r"^#([0-9a-fA-F]{6})$", v)
    if m:
        h = m.group(1)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)), 1.0
    m = re.match(r"^rgba?\(([^)]*)\)$", v)
    if m:
        parts = [x.strip() for x in m.group(1).split(",")]
        if len(parts) >= 3:
            try:
                return (tuple(int(float(x)) for x in parts[:3]),
                        float(parts[3]) if len(parts) > 3 else 1.0)
            except ValueError:
                return None, None
    return None, None


def _composite(fg, alpha, bg):
    return tuple(round(fg[i] * alpha + bg[i] * (1 - alpha)) for i in range(3))


def _luminance(rgb):
    def f(x):
        x = x / 255.0
        return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    r, g, b = (f(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _ratio(a, b):
    la, lb = _luminance(a), _luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def contrast_report(theme):
    """算这套皮肤的三档对比度（取最不利宿主背景）。

    返回 OrderedDict：角色名 -> {"比度": float, "底线": float, "够": bool}。
    算不出来的（写的是渐变色之类）就跳过 —— 宁可漏报，不误报。
    """
    from collections import OrderedDict
    variables = theme.get("变量") or {}
    paper, pa = _parse_color(variables.get("--hud-paper-solid"))
    if not paper:
        paper, pa = _parse_color(variables.get("--hud-paper")) or (None, None)
    out = OrderedDict()
    if not paper:
        return out
    for key, label, need in _CONTRAST_ROLES:
        fg, fa = _parse_color(variables.get(key))
        if not fg:
            continue
        worst = None
        for host in _HOST_BACKDROPS:
            base = _composite(paper, pa, host)
            tone = fg if fa >= 1.0 else _composite(fg, fa, base)
            r = _ratio(tone, base)
            worst = r if worst is None else min(worst, r)
        out[label] = {"比度": worst, "底线": need, "够": worst >= need}
    return out


def _contrast_line(theme):
    rep = contrast_report(theme)
    if not rep:
        return ""
    bits = []
    for label, got in rep.items():
        bits.append("%s %.1f%s" % (label, got["比度"], "" if got["够"] else "!"))
    return " · ".join(bits)


# ------------------------------------------------------------------ 巡览
SHOWCASE_VIEWS = ("view_create.html", "view_card.html")

SHOWCASE_SHELL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@@card@@ · 皮肤巡览</title>
<style>
body{margin:0;background:#0f0e0c;color:#b9ae9b;font:14px/1.7 -apple-system,"PingFang SC",system-ui,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:26px 18px 80px}
h1{font-size:19px;letter-spacing:.2em;color:#c8a23c;margin:0 0 6px}
p.lead{margin:0 0 26px;color:#8d8677;font-size:12.5px;line-height:1.85}
.t{margin:0 0 34px;padding-top:22px;border-top:1px solid rgba(200,162,60,.2)}
.t__h{display:flex;align-items:baseline;gap:10px;margin:0 0 4px}
.t__n{font-size:16px;font-weight:700;letter-spacing:.12em;color:#d9c58a}
.t__now{font-size:11px;letter-spacing:.1em;color:#0f0e0c;background:#c8a23c;border-radius:2px;padding:1px 6px}
.t__d{margin:0 0 12px;color:#8d8677;font-size:12.5px}
.f{width:100%;height:300px;border:1px solid rgba(200,162,60,.22);border-radius:10px;background:#0a0908;display:block}
.f + .f{margin-top:10px}
.cap{margin:6px 0 0;font-size:11px;letter-spacing:.14em;color:#6f6757}
</style>
</head>
<body>
<div class="wrap">
  <h1>@@card@@ · 皮肤巡览</h1>
  <p class="lead">同一张卡、同一份代码，只换了那一组 <b>--hud-*</b> 颜色槽。<br>每套皮肤下面是同一间建卡器与同一块面板 —— 版式一个字没变，变的只有色。</p>
  @@blocks@@
</div>
</body>
</html>
"""


def showcase(spec_or_project, out_path=None, out=print):
    """把这张卡在每一套皮肤下各渲一遍，拼成一页对照图。

    只是给人挑皮肤用的 —— 不落任何工程文件，也不改工程现在的皮肤。
    """
    from . import hud as HUD          # 延迟导入：hud 不依赖 theme，反过来也一样

    project = _project_of(spec_or_project)
    themes = list_themes()
    if not themes:
        raise ThemeError("没有找到任何主题（%s）" % THEMES_DIR)

    now = ""
    try:
        now = current(project)
    except ThemeError:
        now = ""

    card = ""
    blocks = []
    for t in themes:
        docs = HUD.render_views(project, theme_override=render_css(t))
        card = card or _card_of(project)
        frames = []
        for view in SHOWCASE_VIEWS:
            doc = docs.get(view)
            if not doc:
                continue
            label = "建卡器" if view == "view_create.html" else "面板"
            payload = HUD.srcdoc_escape(doc)
            frames.append(
                '<p class="cap">%s</p>'
                '<iframe class="f" title="%s %s" srcdoc="%s"></iframe>'
                % (label, t["_名"], label, payload))
        mark = '<span class="t__now">现在这套</span>' if t["_名"] == now else ""
        blocks.append(
            '<section class="t">\n'
            '  <h2 class="t__h"><span class="t__n">%s</span>%s</h2>\n'
            '  <p class="t__d">%s</p>\n  %s\n</section>'
            % (t["_名"], mark, t.get("一句话", ""), "\n  ".join(frames)))

    page = SHOWCASE_SHELL.replace("@@card@@", card or "卡")
    page = page.replace("@@blocks@@", "\n".join(blocks))

    out_path = out_path or os.path.join(project, "皮肤巡览.html")
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    out("已生成皮肤巡览（%d 套皮肤 × %d 个视图）-> %s"
        % (len(themes), len(SHOWCASE_VIEWS), out_path))
    out("  %d KB —— 双击就能看，不用装任何东西。" % (len(page) // 1024))
    out("  （只是给人挑的对照图，工程现在的皮肤没动。）")
    return out_path


def _card_of(project):
    from . import hud as HUD
    spec = HUD.find_spec(project)
    if not spec:
        return ""
    data = M.yload(spec) or {}
    return str((data.get("character") or {}).get("name") or "")


# ------------------------------------------------------------------ 打印
def print_themes(project=None, out=print):
    themes = list_themes()
    if not themes:
        out("没有找到任何主题（%s）" % THEMES_DIR)
        return
    now = ""
    if project:
        try:
            now = current(project)
        except ThemeError:
            now = ""
    out("可用主题（%d 套）—— 换法：python forge.py theme <名> <工程>" % len(themes))
    out("")
    weak = []
    for t in themes:
        mark = " ← 现在这套" if now and t["_名"] == now else ""
        out("  %s %s%s" % (M.pad(t["_名"], 8), t.get("一句话", ""), mark))
        n = len(t.get("变量") or {})
        line = "         %d 个槽%s" % (n, "" if n >= 12 else "（其余落核心默认）")
        cl = _contrast_line(t)
        if cl:
            line += " · 对比度 " + cl
        out(line)
        rep = contrast_report(t)
        for label, got in rep.items():
            if not got["够"]:
                weak.append("%s 的%s（%.1f < %.1f）"
                            % (t["_名"], label, got["比度"], got["底线"]))
        out("")
    if weak:
        out("⚠ 可读性低于底线：%s" % "；".join(weak))
        out("  对比度按「宿主纯白 / 宿主近黑」两种背景各算一遍取更差 —— 卡的底是半透明的。")
        out("")
