# -*- coding: utf-8 -*-
"""forge.hud —— 卡内 HUD 的组装器（B 轨）。

做三件事：

  1. 把工程 hud/ 下的 CSS、JS、视图拼成「完整 HTML 文档」
     （ElecKoi 只把完整 HTML 文档提升成富文本消息，片段会被当普通文本吐出来），
     顺手把 conf「模块」里那几个模块的脚本与样式拼在核心之后；
  2. 转成正则的替换串，按 hud/hud.conf.json 里写的规则写回 source/*.spec.yaml；
  3. 产出一份浏览器可直接打开的 预览.html。

这份脚本里没有一处卡名：卡名、样式 id、HUD 全局名、要接几条正则，
全在 hud/hud.conf.json 里。**换名（骨架 → 卡名、skel → 前缀）是 forge.scaffold
在建卡那一趟做完的**，这里只负责拼 —— 所以它能给任何一张卡用。

一条命令处理一个工程，进程内不留上一张卡的残渣（configure() 每次重设）。

用法（也可由 forge.py hud 调）：
    python -m forge.hud <工程或 spec>          组装 + 预览 + 校验（不写回 spec）
    python -m forge.hud <工程或 spec> --写回    组装过了再写回 spec
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid

from . import model as M

# 每次组装前由 configure() 设定
PROJECT = ""
HUD_DIR = ""
OUT = ""
SPEC = ""
PREVIEW = ""
CONF = {}
CARD_NAME = ""
STYLE_ID = ""
GLOBAL = ""
RULES = []
CHECK = {}
CSS_ALL = ""
JS_ALL = ""

SPEC_TAIL = ".spec.yaml"

# 组装过程的输出走这里 —— build() 一进来就换掉它，静默调用方传 lambda 即可
_P = print


class HudError(Exception):
    """HUD 这一层的硬错：缺文件、名字对不上、正则撞车。一律当场停，不含糊过去。"""


def project_of(spec_or_project):
    """给 spec 或工程根，都折出工程根。"""
    p = os.path.abspath(spec_or_project)
    if os.path.isfile(p):
        p = os.path.dirname(p)
        if os.path.basename(p) == "source":
            p = os.path.dirname(p)
    return p


def find_spec(project):
    """一份工程只该有一份 spec —— 多份就停，别猜。"""
    src = os.path.join(project, "source")
    if not os.path.isdir(src):
        return None
    got = sorted(os.path.join(src, f) for f in os.listdir(src)
                 if f.endswith(SPEC_TAIL))
    if len(got) > 1:
        raise HudError("source/ 下有 %d 份 spec：%s\n"
                       "  一张卡只该有一份；多张卡请各自独立成一个目录。"
                       % (len(got), "、".join(os.path.basename(p) for p in got)))
    return got[0] if got else None


def configure(spec_or_project, theme_override=None):
    """定位一个工程的全部路径与配置。缺 hud/hud.conf.json 就当场抛 HudError。

    theme_override：临时换一套皮肤 CSS（「皮肤巡览」用）。传 None = 按工程里那份走。
    """
    global PROJECT, HUD_DIR, OUT, SPEC, PREVIEW, CONF, CARD_NAME, STYLE_ID, GLOBAL
    global RULES, CHECK, CSS_ALL, JS_ALL

    PROJECT = project_of(spec_or_project)
    HUD_DIR = os.path.join(PROJECT, "hud")
    conf_path = os.path.join(HUD_DIR, "hud.conf.json")
    if not os.path.isfile(conf_path):
        raise HudError("这个工程里没有 hud/hud.conf.json：%s\n"
                       "  没有它就没有界面这一层。`forge new` 建的工程自带一份。" % PROJECT)
    with open(conf_path, "r", encoding="utf-8") as f:
        CONF = json.load(f)

    SPEC = find_spec(PROJECT)
    OUT = os.path.join(HUD_DIR, "out")
    PREVIEW = os.path.join(PROJECT, "预览.html")
    CARD_NAME = str(CONF.get("卡名") or "")
    STYLE_ID = str(CONF.get("style_id") or "")
    GLOBAL = str(CONF.get("global") or "")
    RULES = CONF.get("正则") or []
    CHECK = CONF.get("校验") or {}

    js, css = module_files()
    # 顺序：核心 -> 主题 -> 模块。主题压核心（换色），模块压主题
    # （某个模块自带的强调色，比如骰子按结果分色，该赢）。
    CSS_ALL = (read("hud.css") + theme_css(theme_override)
               + "".join("\n" + read_at(p) for p in css))
    JS_ALL = read("hud.core.js") + "".join("\n" + read_at(p) for p in js)
    return PROJECT


THEME_FILE = "主题.css"


def theme_css(override=None):
    """皮肤那一段 CSS。

    override 不为 None 就用它（巡览时临时换皮，不碰磁盘上的文件）；
    否则读工程里的 hud/主题.css；没有 = 用核心默认那套。
    """
    if override is not None:
        return "\n" + override
    p = os.path.join(HUD_DIR, THEME_FILE)
    if not os.path.isfile(p):
        return ""
    return "\n" + read_at(p)


# ------------------------------------------------------------------ 读取素材

def read(name):
    with open(os.path.join(HUD_DIR, name), "r", encoding="utf-8") as f:
        return f.read()


def read_at(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


# ------------------------------------------------------------ 可选模块给的料

# conf 的「模块」里写着哪几个模块，就把 hud/模块/<名>/<名>.js（和 .css）拼在核心之后。
# 名字对不上目录是**硬错，直接停** —— 那种状态比不接更坏：卡看着是接了的，
# 界面上却安静地少一块，谁也不会发现。
def module_files():
    js, css = [], []
    mod_dir = os.path.join(HUD_DIR, "模块")
    names = [str(x) for x in (CONF.get("模块") or [])]
    for name in names:
        folder = os.path.join(mod_dir, name)
        if not os.path.isdir(folder):
            raise HudError("hud.conf.json 的「模块」里写着「%s」，但 %s 不存在。"
                           "（接模块用 `forge add %s <你的 spec>`）" % (name, folder, name))
        for tail, bucket in ((".js", js), (".css", css)):
            p = os.path.join(folder, name + tail)
            if os.path.exists(p):
                bucket.append(p)
    # 反过来：目录在这儿、名字不在 conf 里 —— 它**不会被拼进去**。
    # 这是那种「看着接了、其实没接」的状态，所以当场说一句，别让它安静地过去。
    if os.path.isdir(mod_dir):
        stray = sorted(d for d in os.listdir(mod_dir)
                       if os.path.isdir(os.path.join(mod_dir, d)) and d not in names)
        if stray:
            _P("  提示：%s 下有目录没写进 conf 的「模块」：%s"
               % (os.path.relpath(mod_dir, PROJECT).replace("\\", "/"), "、".join(stray)))
            _P("        没登记就不会被拼进页面 —— 要接就把它写进 conf（或 `forge add`）。")
    return js, css


def document(body_html, pre_script=""):
    """把片段包成 ElecKoi 富消息要求的完整 HTML 文档。"""
    css = CSS_ALL
    js = JS_ALL
    head = ""
    if pre_script.strip():
        head = "<script>\n%s\n</script>\n" % pre_script.strip()
    return (
        "<!DOCTYPE html>\n"
        '<html lang="zh-CN">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<style id="%s">\n%s\n</style>\n'
        "%s"
        "</head>\n"
        "<body>\n"
        "%s\n"
        "<script>\n%s\n</script>\n"
        "</body>\n"
        "</html>"
    ) % (STYLE_ID, css, head, body_html.strip(), js)


def to_replacement(doc):
    """包成 ```html 围栏，并把 $ 转义成 $$（正则替换里 $ 有特殊含义）。"""
    return "```html\n" + doc.replace("$", "$$") + "\n```"


def validate(doc, content, label):
    """content 是我们自己写的内容（CSS+JS+视图），外壳包装不参与检查。"""
    problems = []
    if "```" in content:
        problems.append("%s：内容里出现了三反引号，会破坏代码围栏" % label)
    if re.search(r"</script", content, re.I):
        problems.append("%s：内容里出现 </script 字面量，会提前闭合脚本" % label)
    if "<!--" in content:
        problems.append("%s：内容里出现 HTML 注释开头，可能干扰富消息标记识别" % label)
    for token in ('id="%s"' % STYLE_ID, GLOBAL):
        if token not in doc:
            problems.append("%s：缺少必需标记 %s" % (label, token))
    for token in CHECK.get("must_contain", []):
        if token not in doc:
            problems.append("%s：内容里找不到 %s" % (label, token))
    limit = CHECK.get("page_max")
    if limit and len(doc) > limit:
        problems.append("%s：整页 %d 字符，超过上限 %d —— 富消息单条太大会被宿主丢掉"
                        % (label, len(doc), limit))
    return problems


# ------------------------------------------------------------------ 预览桩

MOCK = """
/* 本地预览用的 ElecKoi 桩；真实环境里不存在，会被真 API 顶掉 */
(function () {
  var HAS_PLAYER = @@has_player@@;

  var player = HAS_PLAYER ? {
    '姓名': '示例角色',
    '性别': '女',
    '种族': '人类',
    '等级': 3,
    '状态': '正常',
    '钱币': 42,
    '背包': ['短剑', '干粮 ×3', '火绒盒']
  } : {
    '姓名': '', '性别': '', '种族': '', '等级': 1, '状态': '正常', '钱币': 0, '背包': []
  };

  var store = { stat_data: {
    '世界设定': { '压力源': false, '叙事尺度': '标准' },
    '玩家': player
  } };

  function reply(v) { return Promise.resolve(v); }

  window.ElecKoi = {
    context: { current: function () {
      return reply({ surface: 'message-renderer', messageId: 'm-1', conversationId: 'c-1' });
    } },
    messages: {
      current: function () { return reply({ id: 'm-1' }); },
      list: function () { return reply([]); }
    },
    variables: {
      getState: function () { return reply(JSON.parse(JSON.stringify(store))); },
      setState: function (state) {
        if (state && typeof state === 'object') store = state;
        window.__mockState = store;
        return reply(store);
      }
    },
    input: { set: function (text) {
      window.__mockOutgoing = text;
      return reply({ text: text });
    } },
    chat: { send: function (text) {
      window.__mockOutgoing = text;
      return reply({});
    } }
  };
})();
"""

PREVIEW_SHELL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@@card@@ HUD · 预览</title>
<style>
body{margin:0;background:@@p_bg@@;color:@@p_ink@@;font:14px/1.7 @@font@@}
.wrap{max-width:760px;margin:0 auto;padding:26px 18px 120px}
h1{font-size:19px;letter-spacing:.2em;color:@@p_accent@@;font-weight:700;margin:0 0 8px}
p.lead{margin:0 0 24px;color:@@p_dim@@;font-size:12.5px;line-height:1.85}
p.lead b{color:@@p_accent@@;font-weight:700}
.demo{margin:0 0 22px}
.demo__t{font-size:12px;letter-spacing:.18em;color:@@p_dim@@;font-weight:400;margin:0 0 8px}
.demo__f{width:100%;height:280px;border:1px solid @@p_line@@;border-radius:10px;background:@@p_frame@@;display:block}
.demo__badge{margin:6px 0 0;padding:6px 10px;border-left:2px solid @@p_accent@@;background:@@p_wash@@;
  color:@@p_accent@@;font-size:11.5px;line-height:1.6;word-break:break-all;border-radius:0 6px 6px 0}
</style>
<style id="@@style_id@@">@@css@@</style>
</head>
<body>
<div class="wrap">
  <h1>@@card@@ HUD · 预览</h1>
  <p class="lead">一份代码，两个视图，一颗球。<b>建卡器</b>只在开场出现一次；<b>面板</b>每轮出现在回复末尾；球常驻页面右下角，可拖拽、点击展开。<br>预览里的角色数据是假数据，右下角那颗球是真的在跑宿主挂载逻辑，可以直接拖着玩。</p>
  @@demos@@
</div>
<script>@@mock@@</script>
<script>@@js@@</script>
<script>
(function () {
  var frames = [].slice.call(document.querySelectorAll('.demo__f'));
  frames.forEach(function (f) {
    var badge = document.createElement('p');
    badge.className = 'demo__badge';
    badge.hidden = true;
    f.parentNode.appendChild(badge);
    f.__badge = badge;
  });

  /* 持续轮询：既跟随内容自动调高，也接住桩里记录的「已交出」文本 */
  function tick() {
    frames.forEach(function (f) {
      var w, d;
      try { w = f.contentWindow; d = f.contentDocument; } catch (e) { return; }
      if (!w || !d) return;
      try {
        var h = Math.ceil((d.documentElement && d.documentElement.scrollHeight)
                       || (d.body && d.body.scrollHeight) || 0);
        if (h > 40) f.style.height = (h + 22) + 'px';
      } catch (e) { /* 跨源就保持默认高度 */ }
      try {
        if (w.__mockOutgoing) {
          f.__badge.hidden = false;
          f.__badge.textContent = '已交给 ElecKoi → ' + String(w.__mockOutgoing).replace(/\\s+/g, ' ').slice(0, 160);
        }
      } catch (e) { /* 忽略 */ }
    });
  }
  tick();
  setInterval(tick, 400);

  /* 真·悬浮球：把宿主文档当作挂载目标，演示常驻悬浮路径 */
  @@global@@.mountBall(null, document);
})();
</script>
</body>
</html>
"""


def fill(template, values):
    """占位符替换。Python 的 str.replace 不解释 $，所以插入内容是安全的。"""
    out = template
    for key, value in values.items():
        out = out.replace("@@%s@@" % key, value)
    return out


# ------------------------------------------------------- 预览页外壳的配色

# 预览页的外壳配色单独一份 —— 它不是卡的一部分，是给人看卡的台子。
# 主题可以在自己那份 JSON 的「预览」里指定「底 / 字 / 强调」；只给这三个就够，
# 剩下的（次级字、框底色、线、淡底）从这里按它们现推，免得主题作者要填十来项。
_PREVIEW_FALLBACK = {"底": "#12100c", "字": "#bdb2a0", "强调": "#c8a23c"}
_PREVIEW_FONT = ('-apple-system,"PingFang SC",system-ui,sans-serif')


def _hex_to_rgb(value):
    v = str(value or "").strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6:
        return None
    try:
        return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def _rgba(color, alpha):
    """把 #rrggbb 变成 rgba(...)；不是十六进制就原样退回（如 rgba() 字符串）。"""
    rgb = _hex_to_rgb(color)
    if not rgb:
        return color
    return "rgba(%d,%d,%d,%s)" % (rgb[0], rgb[1], rgb[2], alpha)


def _shift(color, amount):
    """整体提亮（amount>0）或压暗（amount<0），0.35 大约是「明显但不刺眼」。"""
    rgb = _hex_to_rgb(color)
    if not rgb:
        return color
    f = 1.0 + amount
    return "#%02x%02x%02x" % tuple(
        max(0, min(255, int(round(c * f)))) for c in rgb)


def _frame_color(bg):
    """演示框（iframe）的底 —— 比台面略暗一点，好让卡有边界。

    深浅两路：浅色主题只压暗一点点（压多了会变成一块脏灰），
    深色主题可以压得狠（本来就在暗处，再暗也是暗）。
    """
    rgb = _hex_to_rgb(bg)
    if not rgb:
        return bg
    lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255.0
    return _shift(bg, -0.06 if lum > 0.55 else -0.45)


def preview_palette():
    """组装预览页外壳要用的色。"""
    given = {k: v for k, v in (CONF.get("预览") or {}).items() if v}
    got = dict(_PREVIEW_FALLBACK)
    got.update(given)
    bg, ink, accent = got["底"], got["字"], got["强调"]
    return {
        "p_bg": bg,
        "p_ink": ink,
        "p_dim": given.get("暗") or _rgba(ink, 0.72),
        "p_accent": accent,
        "p_line": given.get("线") or _rgba(accent, 0.32),
        "p_frame": given.get("框") or _frame_color(bg),
        "p_wash": _rgba(accent, 0.08),
        "font": _PREVIEW_FONT,
    }


def srcdoc_escape(doc):
    """把一份完整 HTML 文档塞进 iframe 的 srcdoc 属性。

    三个字符要换：`&`（实体本身的规矩）、`"`（不然属性值提前闭合）、
    `<`（尖括号）。裸尖括号在浏览器里其实也能过 —— 属性值状态里 `<`
    是普通字符 —— 但那样这份 HTML 就经不起任何一次「读出再写回」
    （格式化、压缩、序列化），中间过一手就当场坏掉，而且坏得没有提示。
    `>` 不必换（同上，它在属性值里没有歧义），换了只是白白变大。
    """
    return (str(doc).replace("&", "&amp;")
                     .replace('"', "&quot;")
                     .replace("<", "&lt;"))


def demo_block(title, body, has_player=True):
    mock = fill(MOCK, {"has_player": "true" if has_player else "false"})
    full = document(body, mock)
    return ('<section class="demo"><h3 class="demo__t">%s</h3>'
            '<iframe class="demo__f" title="%s" srcdoc="%s"></iframe></section>'
            % (title, title, srcdoc_escape(full)))


# ------------------------------------------------------------------ 装配

def assemble(write=True):
    """拼页面。write=False 时只算不落盘（「皮肤巡览」要一次算好几套）。"""
    views = []
    for r in RULES:
        if r["view"] not in views:
            views.append(r["view"])

    bodies = {v: read(v) for v in views}
    docs = {v: document(bodies[v]) for v in views}

    css, js = CSS_ALL, JS_ALL
    problems = []
    for v in views:
        problems += validate(docs[v], css + js + bodies[v], v)

    files = {}
    for v in views:
        files[v] = docs[v]
        files["replacement_%s.txt" % v.replace("view_", "").replace(".html", "")] = to_replacement(docs[v])

    if write:
        os.makedirs(OUT, exist_ok=True)
        for name, text in files.items():
            with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
                f.write(text)

        demos = "\n  ".join([
            demo_block("① 建卡器 · 还没填", bodies.get("view_create.html", bodies[views[0]]), has_player=False),
            demo_block("② 建卡器 · 已有一份档案", bodies.get("view_create.html", bodies[views[0]])),
            demo_block("③ 面板 · 有档案", bodies.get("view_card.html", bodies[views[-1]])),
            demo_block("④ 面板 · 还没档案", bodies.get("view_card.html", bodies[views[-1]]), has_player=False),
        ])
        page = fill(PREVIEW_SHELL, dict(
            {
                "card": CARD_NAME,
                "style_id": STYLE_ID,
                "global": GLOBAL,
                "css": css,
                "js": js,
                "mock": fill(MOCK, {"has_player": "true"}),
                "demos": demos,
            },
            **preview_palette()
        ))
        with open(PREVIEW, "w", encoding="utf-8", newline="\n") as f:
            f.write(page)
    else:
        page = ""

    _P("组装完成（卡名：%s · 模块：%s）："
          % (CARD_NAME, "、".join(str(x) for x in (CONF.get("模块") or [])) or "没接"))
    for name in sorted(files):
        _P("  out/%-28s %8d 字符" % (name, len(files[name])))
    if write:
        _P("  预览页                        %8d 字符  -> %s" % (len(page), PREVIEW))

    if problems:
        _P("\n校验发现问题：")
        for p in problems:
            _P("  x " + p)
    else:
        _P("\n校验通过：无三反引号 / 无 </script 字面量 / 无 HTML 注释 / 关键标记齐备。")
    return problems, docs


# ------------------------------------------------------------------ 写回 spec

def rule(rid, name, pattern, replacement, order):
    return {
        "id": rid,
        "name": name,
        "pattern": pattern,
        "replacement": replacement,
        "targets": ["AiOutput"],
        "enabled": True,
        "display_only": True,
        "prompt_only": False,
        "run_on_edit": True,
        "order": order,
    }


def re_slash(text):
    """纯字面量 / 已经是 /.../flags 的，都照原样用；其余包成 /.../g。"""
    t = (text or "").strip()
    if t.startswith("/") and re.match(r"^/.*/[gimsuy]*$", t, re.S):
        return t
    if re.search(r"[\\^$.*+?()[\]{}|]", t):
        return "/%s/g" % t
    return t


def parse_pattern(text):
    """照 ElecKoi 的 parseRegexPattern 拆：/body/flags 拆开，其余整体当 body。"""
    t = (text or "").strip()
    if len(t) >= 3 and t.startswith("/"):
        closing = t.rfind("/")
        if closing > 0:
            flags = {"i": re.I, "m": re.M, "s": re.S}
            return re.compile(t[1:closing],
                              sum(flags.get(f, 0) for f in t[closing + 1:]))
    return re.compile(t)


def patch_spec():
    if not SPEC:
        raise HudError("source/ 下没有 *%s —— 没有 spec 就没有地方写回。" % SPEC_TAIL)
    spec = M.yload(SPEC)

    # --- 1. 开场白：正文里那个标记不能少，否则开场那一条渲染不出建卡器 ---
    opening = CONF.get("开场白") or {}
    if opening:
        marker = ""
        for r in RULES:
            if r["view"] == "view_create.html":
                marker = r["pattern"]
        touched = 0
        for entry in spec["library"]["entries"]:
            if entry.get("id") != opening.get("条目"):
                continue
            body = opening.get("正文", "")
            # 建卡器标记是三个零宽空格（U+200B），conf 里正文写的是真字符、pattern 写的是
            # /\u200B{3}/ 这种转义写法 —— 两者长得不一样，所以这里按「正则真能命中正文」
            # 来查，而不是比字符串。顺带守住「正文里不许有尖括号」：那意味着标记又变回
            # 可见的了，会从 ElecKoi 的会话预览（侧栏 / 历史检索）里露出来。
            if marker and not parse_pattern(marker).search(body):
                raise HudError("hud.conf.json 的开场白正文里没有建卡器标记「%s」，停" % marker)
            if "<" in body or ">" in body:
                raise HudError("hud.conf.json 的开场白正文里有尖括号，会话预览会露出来，停")
            # 写回前先记下各方案原本写着什么 —— 一会儿全要被 conf 那份盖掉。
            # 若本来就有多种正文（酒馆卡常带默认 + 备选几套），那是**有损**的，
            # 得说一句：骨架的建卡器只有一格正文，多出来的那几套从此没了。
            旧正文 = {str(m.get("content") or "") for m in (entry.get("opening_messages") or [])}
            旧正文 = {x for x in 旧正文 if x.strip()}
            entry["content"] = body
            for msg in entry.get("opening_messages") or []:
                msg["content"] = body
                touched += 1
            if len(旧正文) > 1:
                _P("  提示：开场白原本有 %d 套不同正文，已统一成 conf 里那一份 ——"
                   " 建卡器只有一格正文。" % len(旧正文))
                _P("      想保住多套开场：别接界面层（用 `forge.py import` 收成内容档）。")
        if not touched:
            _P("  提示：spec 里没有开场白条目（%s），开场那一步由宿主自己填。"
                  % opening.get("条目"))

    # --- 2. 正则：conf 里那几条按 order 接，**外来的一条都不许动** ---
    #     spec 里的正则有两个来源：这份 conf，以及「不是 conf 给的」—— 模块接的、
    #     作者手写的。以前这里是光秃秃一句 spec["regex_rules"] = rules，每跑一次
    #     构建就把后一类全抹掉；那种错不报错，只是某种界面从此不再出现，
    #     而人往往要等到下一局才发现。所以改成「两拨按 order 合起来」，并当场查撞车。
    conf_names = {r["name"] for r in RULES}
    orders = [r["order"] for r in RULES]
    if len(set(orders)) != len(orders):
        raise HudError("hud.conf.json 里有重复的 order：%s（顺序不明，停）" % orders)

    before = spec.get("regex_rules") or []
    existing = {str(r.get("name", "")): r for r in before}
    foreign = [r for r in before if str(r.get("name", "")) not in conf_names]

    made = []
    for r in sorted(RULES, key=lambda x: x["order"]):
        rid = existing.get(r["name"], {}).get("id") or ("regex-" + str(uuid.uuid4()))
        repl = read_at(os.path.join(OUT, "replacement_%s.txt"
                                    % r["view"].replace("view_", "").replace(".html", "")))
        made.append(rule(rid, r["name"], re_slash(r["pattern"]), repl, r["order"]))

    merged = sorted(foreign + made, key=lambda r: r["order"])
    slots = {}
    for r in merged:
        slots.setdefault(r["order"], []).append(str(r.get("name", "")))
    clash = ["order=%s 上有 %s" % (o, "、".join(n)) for o, n in sorted(slots.items()) if len(n) > 1]
    if clash:
        raise HudError("正则 order 撞车：%s\n"
                       "  conf 那几条与 spec 里的外来规则要各占一个号 —— 挪开再跑。"
                       % "；".join(clash))
    spec["regex_rules"] = merged

    M.ydump(spec, SPEC)

    _P("已写回 spec：")
    if opening:
        _P("  开场白 %s 已更新（正文与开场消息都换了）" % opening.get("条目"))
    _P("  正则规则共 %d 条（conf %d 条 · 非 conf 来源 %d 条，一个字没动）："
          % (len(merged), len(made), len(foreign)))
    for r in merged:
        _P("    order=%-3s %-24s pattern=%-14s 替换 %d 字符" % (
            r["order"], r["name"], r["pattern"][:14], len(r["replacement"])))
    return spec


def build(spec_or_project, write_back=False, out=print, theme_override=None):
    """组装一个工程的 HUD。

    返回 (problems, docs)：problems 非空 = 有校验问题（这时**不写回** spec）。
    组装本身失败（缺文件、名字对不上）会抛 HudError。
    """
    global _P
    _P = out
    configure(spec_or_project, theme_override=theme_override)
    problems, docs = assemble()
    if write_back:
        if problems:
            out("")
            out("有校验问题，已跳过写回 spec —— 不拿半成品覆盖源文件。")
        else:
            out("")
            patch_spec()
    return problems, docs


def render_views(spec_or_project, theme_override=None, out=lambda *a: None):
    """只算不落盘：返回 {视图文件名: 完整 HTML 文档}。

    「皮肤巡览」靠它一次算好几套皮肤 —— 每算一套都重新 configure，
    进程里不留上一套的残渣（CSS_ALL / JS_ALL 每次都是重算的）。
    """
    global _P
    _P = out
    configure(spec_or_project, theme_override=theme_override)
    _, docs = assemble(write=False)
    return docs


def main(argv=None):
    ap = argparse.ArgumentParser(prog="forge hud",
                                 description="组装卡内 HUD（拼页面 → 可选写回 spec）")
    ap.add_argument("目标", help="工程目录，或工程里的 source/*.spec.yaml")
    ap.add_argument("--写回", dest="write_back", action="store_true",
                    help="组装无问题后，把正则与开场白写回 spec")
    args = ap.parse_args(argv)
    try:
        problems, _ = build(args.目标, write_back=args.write_back)
    except HudError as exc:
        print("!! %s" % exc)
        return 1
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
