# -*- coding: utf-8 -*-
"""forge.manual —— 从卡生成两份「看的文档」。

    manual  ->  <卡名>.手册.html   给人看：结构、条目全文、变量、正则、体检
                 <卡名>.索引.md     给 AI 看：清单与「想改什么动哪里」

为什么要有这两份：
    · 卡 JSON 里，条目正文塞在嵌套 JSON 字符串中，人和 AI 都读不动；
      spec.yaml 虽然可读，但 3000 行起就没人愿意翻。
    · 手册是「交付物」：拿给别人看这张卡有什么，不用他装任何东西。
    · 索引是「施工图」：下次要改一张卡时，先看它，再动手。

两份都从同一份 spec 生成，所以永远不会与卡脱节。
"""
from __future__ import annotations

import html
import os

from . import model as M
from . import pack as P
from . import validate as V

CSS = """
:root{
  --ink:#2f2a22; --ink2:#6b6152; --ink3:#9a8f7c;
  --line:rgba(120,94,52,.26); --line2:rgba(120,94,52,.14);
  --bg:#faf6ee; --card:#fffdf8; --accent:#8d2a22; --gold:#ad8527;
  --err:#a01a10; --warn:#8a6410; --info:#5b6b7a;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.layout{display:flex;align-items:flex-start;max-width:1400px;margin:0 auto;gap:28px;padding:28px}
nav{position:sticky;top:28px;flex:0 0 196px;padding:16px;border:1px solid var(--line);
  border-radius:8px;background:var(--card);font-size:13.5px}
nav h4{margin:0 0 10px;font-size:12px;letter-spacing:.18em;color:var(--ink3);font-weight:700}
nav a{display:block;padding:4px 0;color:var(--ink2)}
nav a:hover{color:var(--accent)}
main{flex:1;min-width:0}
header{border-bottom:2px solid var(--line);padding-bottom:18px;margin-bottom:26px}
h1{margin:0 0 6px;font-size:27px;letter-spacing:.03em}
h1 .sub{font-size:14px;color:var(--ink3);font-weight:400;letter-spacing:0;margin-left:10px}
section{margin:0 0 40px;scroll-margin-top:20px}
h2{font-size:18px;margin:0 0 14px;padding-bottom:7px;border-bottom:1px solid var(--line);letter-spacing:.05em}
h2 .n{color:var(--gold);font-weight:700;margin-right:8px}
h3{font-size:14.5px;margin:22px 0 9px;color:var(--ink2);letter-spacing:.06em}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 0}
.stat{flex:0 0 auto;padding:9px 15px;border:1px solid var(--line);border-radius:7px;background:var(--card)}
.stat b{display:block;font-size:21px;line-height:1.25;color:var(--accent)}
.stat span{font-size:11.5px;color:var(--ink3);letter-spacing:.1em}
table{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--card);
  border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:7px 11px;border-bottom:1px solid var(--line2);vertical-align:top}
th{background:rgba(120,94,52,.07);font-weight:700;font-size:12.5px;letter-spacing:.06em;color:var(--ink2);white-space:nowrap}
tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tag{display:inline-block;padding:0 7px;border-radius:4px;font-size:11.5px;line-height:18px;white-space:nowrap}
.tag.always{background:rgba(173,133,39,.16);color:#7a5c10}
.tag.agent{background:rgba(90,110,130,.15);color:#4c5c6b}
.tag.kw{background:rgba(141,42,34,.12);color:var(--accent)}
.tag.off{background:rgba(0,0,0,.07);color:var(--ink3)}
details{border:1px solid var(--line);border-radius:8px;background:var(--card);margin:0 0 9px;overflow:hidden}
details>summary{cursor:pointer;padding:9px 13px;font-size:13.5px;list-style:none;display:flex;gap:10px;align-items:baseline}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"▸";color:var(--gold);flex:0 0 auto}
details[open]>summary::before{content:"▾"}
details>summary .t{font-weight:700;flex:0 0 auto}
details>summary .g{color:var(--ink3);font-size:12px;margin-left:auto;white-space:nowrap}
.body{padding:2px 15px 15px;border-top:1px dashed var(--line2)}
.body pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;
  font:13px/1.8 inherit;color:var(--ink);background:transparent;padding:0}
.hint{margin:9px 0 0;padding:6px 10px;border-left:2px solid var(--gold);
  background:rgba(173,133,39,.07);font-size:12.5px;color:var(--ink2)}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.meta code{font-size:11.5px;color:var(--ink2);background:rgba(120,94,52,.08);
  padding:1px 6px;border-radius:4px;font-family:ui-monospace,Consolas,monospace}
.issue{padding:7px 12px;border-left:3px solid;border-radius:0 6px 6px 0;margin:0 0 7px;
  font-size:13px;background:var(--card);border-top:1px solid var(--line2);
  border-right:1px solid var(--line2);border-bottom:1px solid var(--line2)}
.issue.ERROR{border-left-color:var(--err)}
.issue.WARN{border-left-color:var(--warn)}
.issue.INFO{border-left-color:var(--info)}
.issue .lv{font-weight:700;font-size:11.5px;letter-spacing:.08em;margin-right:8px}
.issue.ERROR .lv{color:var(--err)} .issue.WARN .lv{color:var(--warn)} .issue.INFO .lv{color:var(--info)}
.issue .fx{color:var(--ink2);font-size:12.5px}
.issue .cd{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--ink3)}
.empty{color:var(--ink3);font-size:13px;padding:8px 0}
footer{margin:40px 0 0;padding-top:14px;border-top:1px solid var(--line);
  font-size:12px;color:var(--ink3)}
@media(max-width:900px){.layout{flex-direction:column}nav{position:static;width:100%;flex:auto}}
"""


# ------------------------------------------------------------------ 取数
def load_card(path):
    """读 spec.yaml 或 card.json，返回 (card, 是否来自 spec)。"""
    if M.is_yaml(path):
        return P.spec_to_card(path), True
    return M.jload(path), False


def gather(path):
    """把手册/索引需要的一切收进一个上下文 dict。"""
    card, from_spec = load_card(path)
    lib = P.active_library(card)
    var = P.active_variables(card)
    entries = lib.get("entries", []) or []
    groups = lib.get("groups", []) or []
    objects = var.get("objects", []) or []
    variables = var.get("variables", []) or []
    regex_rules = card.get("regex_rules", []) or []
    char = card.get("character", {}) or {}
    name = str(char.get("name") or "").strip() or \
        os.path.splitext(os.path.basename(path))[0].replace(".spec", "")

    gname = {g.get("id"): str(g.get("name") or "") for g in groups}
    oname = {o.get("id"): str(o.get("name") or "") for o in objects}

    const = [e for e in entries
             if e.get("trigger_mode", "always") == "always" and e.get("kind") != "opening"]
    total_chars = sum(len(str(e.get("content") or "")) for e in entries)
    const_chars = sum(len(str(e.get("content") or "")) for e in const)

    return {
        "card": card, "from_spec": from_spec, "name": name, "character": char,
        "entries": entries, "groups": groups, "objects": objects,
        "variables": variables, "regex_rules": regex_rules,
        "gname": gname, "oname": oname,
        "const": const, "const_chars": const_chars, "total_chars": total_chars,
        "issues": V.validate_card(card, name),
    }


# ------------------------------------------------------------------ 通用小件
def _esc(s):
    return html.escape(str(s if s is not None else ""))


def _nl(s):
    """正文里的换行在 HTML 里靠 pre-wrap 保留，这里只做转义。"""
    return _esc(s)


def _tokens(text):
    return M.est_tokens(str(text or ""))


def _trig_tag(e):
    if not e.get("enabled", True):
        return '<span class="tag off">已禁用</span>'
    if e.get("kind") == "opening":
        return '<span class="tag always">开场白</span>'
    t = e.get("trigger_mode", "always")
    if t == "always":
        return '<span class="tag always">常驻</span>'
    s = e.get("agent_read_strategy", "normal")
    if s == "keyword":
        return '<span class="tag kw">关键词</span>'
    if s == "required":
        return '<span class="tag kw">必读</span>'
    return '<span class="tag agent">按需</span>'


# ------------------------------------------------------------------ HTML 手册
def _default_dir(path):
    """默认把手册/索引放在哪儿。

    spec 住在 `<工程>/source/` 下就是一张工程，往后一律落在 `<工程>/文档/`
    （那是这类派生物该待的地方）；否则就摆在输入文件旁边。
    """
    here = os.path.dirname(os.path.abspath(path))
    if os.path.basename(here) == "source":
        docs = os.path.join(os.path.dirname(here), "文档")
        os.makedirs(docs, exist_ok=True)
        return docs
    return here


def build_manual(path, out_path=None, out=print):
    ctx = gather(path)
    out_path = out_path or os.path.join(_default_dir(path), "%s.手册.html" % ctx["name"])
    _write(_render_html(ctx), out_path)

    s = V.summarize(ctx["card"])
    errs = len([i for i in ctx["issues"] if i.level == "ERROR"])
    out("已生成手册 -> %s" % out_path)
    out("  条目 %d · 分组 %d · 变量 %d · 对象 %d · 正则 %d"
        % (s["entries"], s["groups"], s["variables"], s["objects"], s["regex"]))
    out("  体检：%d 错 · %d 警告"
        % (errs, len([i for i in ctx["issues"] if i.level == "WARN"])))
    return out_path


def _render_html(c):
    name = c["name"]
    s = V.summarize(c["card"])
    return (
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n"
        "<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
        "<title>%s · 卡片手册</title>\n<style>%s</style>\n</head>\n<body>\n"
        "<div class=\"layout\">%s<main>%s%s%s%s%s%s%s</main></div>\n</body>\n</html>\n"
        % (_esc(name), CSS, _nav(c), _head(c, s), _sec_overview(c, s),
           _sec_entries(c), _sec_vars(c), _sec_regex(c), _sec_domains(), _sec_health(c))
    )


def _nav(c):
    items = [("overview", "总览"), ("entries", "条目清单"),
             ("vars", "变量"), ("regex", "正则"), ("domains", "平台真值域"),
             ("health", "体检")]
    links = "".join('<a href="#%s">%s</a>' % (i, t) for i, t in items)
    return ('<nav><h4>目录</h4>%s<h4 style="margin-top:14px">构成</h4>'
            '<a href="#entries">条目 %d</a><a href="#vars">变量 %d</a>'
            '<a href="#regex">正则 %d</a></nav>'
            % (links, len(c["entries"]), len(c["variables"]), len(c["regex_rules"])))


def _head(c, s):
    char = c["character"]
    prof = " · ".join("%s %s" % (k, char.get(v))
                      for k, v in (("年龄", "profile_age"), ("性别", "profile_sex"),
                                   ("身高", "profile_height"))
                      if str(char.get(v) or "").strip())
    sub = ('<span class="sub">%s</span>' % _esc(prof)) if prof else ""
    src = "由规格文件编译" if c["from_spec"] else "直接读卡"
    return ('<header><h1>%s%s</h1>'
            '<div style="color:var(--ink3);font-size:13px">ElecKoi 角色卡手册 · %s</div>'
            '</header>' % (_esc(c["name"]), sub, src))


def _sec_overview(c, s):
    stats = [
        (s["entries"], "条目"), (s["groups"], "分组"),
        (s["const"], "常驻条目"), (s["variables"], "变量"),
        (s["regex"], "正则"),
        (("{:,}".format(c["total_chars"])), "设定库总字数"),
        (("{:,}".format(_tokens("x" * c["total_chars"]))), "≈ token"),
    ]
    boxes = "".join('<div class="stat"><b>%s</b><span>%s</span></div>' % v
                    for v in stats)
    warn = ""
    if c["const_chars"] > V.CONST_CHARS_LIMIT:
        warn = ('<div class="issue WARN" style="margin-top:18px">'
                '<span class="lv">注意</span>常驻条目合计 %d 字，超过护栏 %d 字。'
                '常驻每轮都进提示，字数就是成本 —— 这是最值得先动的一处。'
                '</div>' % (c["const_chars"], V.CONST_CHARS_LIMIT))
    return ('<section id="overview"><h2><span class="n">1</span>总览</h2>'
            '<div class="stats">%s</div>%s</section>' % (boxes, warn))


def _sec_entries(c):
    entries, gname = c["entries"], c["gname"]
    # 分组树
    rows = []
    by_group = {}
    for e in entries:
        by_group.setdefault(e.get("group_id") or "", []).append(e)
    for g in c["groups"]:
        gid = g.get("id")
        kids = by_group.get(gid, [])
        rows.append('<tr><td><b>%s</b></td><td class="num">%d</td><td>%s</td></tr>'
                    % (_esc(g.get("name")), len(kids),
                       _esc("、".join(str(k.get("title"))[:16] for k in kids[:4])
                            + ("…" if len(kids) > 4 else ""))))
    loose = by_group.get("", [])
    if loose:
        rows.append('<tr><td><b>（未分组）</b></td><td class="num">%d</td>'
                    '<td>%s</td></tr>'
                    % (len(loose), _esc("、".join(str(k.get("title"))[:16]
                                                 for k in loose[:4]))))
    group_table = ("<h3>分组</h3><table><tr><th>分组</th><th>条目数</th><th>包含</th></tr>"
                   + "".join(rows) + "</table>")

    # 清单表
    trs = []
    for i, e in enumerate(entries, 1):
        title = str(e.get("title") or "(无标题)")
        n = len(str(e.get("content") or ""))
        kw = len(e.get("keywords") or [])
        trs.append(
            '<tr><td class="num">%d</td><td>%s</td><td>%s</td><td>%s</td>'
            '<td class="num">%s</td><td class="num">%d</td>'
            '<td class="num">%d</td><td class="num">%d</td></tr>'
            % (i, _esc(title), _trig_tag(e),
               _esc(gname.get(e.get("group_id"), "") or "—"),
               _esc(e.get("agent_read_strategy", "")), kw,
               n, _tokens(e.get("content"))))
    list_table = (
        "<h3>全部条目</h3><table>"
        "<tr><th>#</th><th>标题</th><th>触发</th><th>分组</th><th>策略</th>"
        "<th>键</th><th>字数</th><th>≈token</th></tr>"
        + "".join(trs) + "</table>")

    # 详情
    details = []
    for i, e in enumerate(entries, 1):
        title = str(e.get("title") or "(无标题)")
        hint = str(e.get("agent_selection_hint") or "")
        metas = []
        if e.get("trigger_mode", "always") == "always":
            metas.append("位置 %s" % (e.get("position") or "（空！会被过滤）"))
        metas.append("角色 %s" % e.get("insert_role", "user"))
        if e.get("keywords"):
            metas.append("关键词 " + "、".join(str(k) for k in e["keywords"][:8]))
        if e.get("order") is not None:
            metas.append("order %s" % e["order"])
        mh = "".join("<code>%s</code>" % _esc(m) for m in metas)
        hh = ('<div class="hint">什么时候读我：%s</div>' % _esc(hint)) if hint else ""
        details.append(
            '<details><summary><span class="t">%d. %s</span>%s'
            '<span class="g">%d 字</span></summary>'
            '<div class="body"><div class="meta">%s</div>%s<pre>%s</pre></div></details>'
            % (i, _esc(title), _trig_tag(e),
               len(str(e.get("content") or "")), mh, hh,
               _nl(e.get("content") or "")))

    return ('<section id="entries"><h2><span class="n">2</span>条目清单</h2>'
            '%s%s<h3>正文（点标题展开）</h3>%s</section>'
            % (group_table, list_table, "".join(details)))


def _sec_vars(c):
    objs, vars_ = c["objects"], c["variables"]
    if not vars_ and not objs:
        return ('<section id="vars"><h2><span class="n">3</span>变量</h2>'
                '<div class="empty">这张卡没有变量。变量用来让卡记住状态'
                '（数值、开关、背包……），不变量化的卡也可以很完整。</div></section>')
    blocks = []
    by_obj = {}
    for v in vars_:
        by_obj.setdefault(v.get("object_id") or "", []).append(v)
    for o in objs:
        oid = o.get("id")
        kids = by_obj.get(oid, [])
        desc = str(o.get("description") or "")
        rowsh = "".join(
            "<tr><td>%s</td><td><code>%s</code></td><td><code>%s</code></td>"
            "<td>%s</td><td>%s</td></tr>"
            % (_esc(v.get("title")), _esc(v.get("type")), _esc(v.get("default_value")),
               _esc(v.get("read_mode")), _esc(v.get("description")))
            for v in kids)
        tbl = ("<table><tr><th>变量</th><th>类型</th><th>默认</th><th>读取</th><th>说明</th></tr>"
               + rowsh + "</table>") if kids else '<div class="empty">（无变量）</div>'
        blocks.append('<h3>%s <span style="color:var(--ink3);font-weight:400">%d 项</span>'
                      '</h3>%s%s'
                      % (_esc(o.get("name")), len(kids),
                         ('<div class="empty" style="padding:0 0 6px">%s</div>'
                          % _esc(desc)) if desc else "", tbl))
    orphan = by_obj.get("", [])
    if orphan:
        blocks.append('<h3>（未挂到对象）</h3>'
                      + "".join('<div class="empty">%s（%s）</div>'
                                % (_esc(v.get("title")), _esc(v.get("type")))
                                for v in orphan))
    return ('<section id="vars"><h2><span class="n">3</span>变量（%d 个对象 / %d 项）</h2>'
            '%s</section>' % (len(objs), len(vars_), "".join(blocks)))


def _sec_regex(c):
    rules = c["regex_rules"]
    if not rules:
        return ('<section id="regex"><h2><span class="n">4</span>正则</h2>'
                '<div class="empty">这张卡没有正则。正则用来把正文里的记号'
                '（如 〔骰·…〕）渲成视觉块，或做文本替换。</div></section>')
    trs = []
    for i, r in enumerate(rules, 1):
        pat = str(r.get("pattern") or "")
        rep = str(r.get("replacement") or "")
        trs.append('<tr><td class="num">%d</td><td>%s</td><td class="num">%s</td>'
                   '<td>%s</td><td class="num">%d</td><td class="num">%d</td>'
                   '<td>%s</td></tr>'
                   % (i, _esc(r.get("name")), _esc(r.get("order")),
                      _esc("、".join(str(t) for t in (r.get("targets") or []))),
                      len(pat), len(rep),
                      _esc("开" if r.get("enabled", True) else "关")))
    return ('<section id="regex"><h2><span class="n">4</span>正则（%d 条）</h2>'
            '<div class="empty" style="padding-bottom:8px">替换是「order 小的先认走」——'
            '更具体的排前面，兜底的排最后。</div>'
            '<table><tr><th>#</th><th>名称</th><th>order</th><th>作用对象</th>'
            '<th>模式字数</th><th>替换字数</th><th>状态</th></tr>%s</table></section>'
            % (len(rules), "".join(trs)))


def _sec_domains():
    from . import domain as D
    trs = []
    for nm, dom in D.DOMAINS.items():
        legacy = "、".join("%s→%s" % kv for kv in dom.legacy.items()) or "—"
        trs.append("<tr><td><code>%s</code></td><td>%s</td><td><code>%s</code></td>"
                   "<td>%s</td></tr>"
                   % (_esc(nm), " / ".join("<code>%s</code>" % _esc(v) for v in dom.values),
                      _esc(dom.default), _esc(legacy)))
    dead = "".join("<tr><td><code>%s</code></td><td>平台根本不读它 —— %s</td></tr>"
                   % (_esc(f), _esc(w)) for f, w in D.DEAD_FIELDS.items())
    return ('<section id="domains"><h2><span class="n">5</span>平台真值域</h2>'
            '<div class="empty" style="padding-bottom:8px">'
            '这几个字段的值只有下面这些是认的。写别的不会报错 —— '
            '平台会把它们<b>静默降级</b>成缺省值，症状是「填了没反应」。'
            '本工具在打包前会拦住。</div>'
            '<table><tr><th>字段</th><th>合法值</th><th>缺省</th><th>旧值会被改成</th></tr>'
            '%s</table>'
            '<h3>平台不读的字段</h3><table>%s</table></section>'
            % ("".join(trs), dead))


def _sec_health(c):
    issues = c["issues"]
    if not issues:
        return ('<section id="health"><h2><span class="n">6</span>体检</h2>'
                '<div class="issue INFO"><span class="lv">通过</span>'
                '没有发现问题。</div></section>')
    order = {"ERROR": 0, "WARN": 1, "INFO": 2}
    items = sorted(issues, key=lambda i: order.get(i.level, 3))
    blocks = []
    for i in items:
        fx = ('<div class="fx">→ %s</div>' % _esc(i.fix)) if i.fix else ""
        blocks.append('<div class="issue %s"><span class="lv">%s</span>'
                      '<span class="cd">%s</span> %s%s</div>'
                      % (i.level, i.level, _esc(i.where), _esc(i.message), fx))
    n = {k: len([i for i in issues if i.level == k]) for k in ("ERROR", "WARN", "INFO")}
    return ('<section id="health"><h2><span class="n">6</span>体检</h2>'
            '<div class="empty" style="padding-bottom:10px">%d 错 · %d 警告 · %d 提示</div>'
            '%s</section>' % (n["ERROR"], n["WARN"], n["INFO"], "".join(blocks)))


# ------------------------------------------------------------------ Markdown 索引
def build_index(path, out_path=None, out=print):
    ctx = gather(path)
    out_path = out_path or os.path.join(_default_dir(path), "%s.索引.md" % ctx["name"])
    _write(_render_index(ctx), out_path)
    out("已生成索引 -> %s" % out_path)
    return out_path


def _render_index(c):
    s = V.summarize(c["card"])
    L = []
    A = L.append
    A("# %s · 索引" % c["name"])
    A("")
    A("> 本文件由 `forge index` 从 spec 自动生成，**不要手改**。"
      "给人看的手册见同名 `.手册.html`。")
    A("")
    A("| 项 | 数 |")
    A("|---|---|")
    A("| 条目 | %d |" % s["entries"])
    A("| 分组 | %d |" % s["groups"])
    A("| 常驻条目 | %d（%d 字）|" % (s["const"], c["const_chars"]))
    A("| 变量 | %d（%d 个对象）|" % (s["variables"], s["objects"]))
    A("| 正则 | %d |" % s["regex"])
    A("| 设定库总字数 | %d ≈ %d token |" % (c["total_chars"], _tokens("x" * c["total_chars"])))
    A("")

    A("## 分组")
    A("")
    A("| 组 | 条目数 |")
    A("|---|---|")
    by_group = {}
    for e in c["entries"]:
        by_group.setdefault(e.get("group_id") or "", []).append(e)
    for g in c["groups"]:
        A("| %s `%s` | %d |" % (g.get("name"), g.get("id"), len(by_group.get(g.get("id"), []))))
    if by_group.get(""):
        A("| （未分组） | %d |" % len(by_group[""]))
    A("")

    A("## 条目")
    A("")
    A("| # | 标题 | 触发 | 策略 | 位置 | 关键词 | 字数 | id |")
    A("|---|---|---|---|---|---|---|---|")
    for i, e in enumerate(c["entries"], 1):
        if not e.get("enabled", True):
            trig = "禁用"
        elif e.get("kind") == "opening":
            trig = "开场白"
        elif e.get("trigger_mode", "always") == "always":
            trig = "常驻"
        else:
            trig = "按需"
        kw = "、".join(str(k) for k in (e.get("keywords") or [])[:5])
        A("| %d | %s | %s | %s | %s | %s | %d | `%s` |"
          % (i, _cell(e.get("title")), trig, e.get("agent_read_strategy", ""),
             _cell(e.get("position")) or "—", _cell(kw) or "—",
             len(str(e.get("content") or "")), e.get("id", "")))
    A("")

    if c["variables"]:
        A("## 变量")
        A("")
        A("| 对象 | 变量 | 类型 | 默认 | 读取 | 说明 |")
        A("|---|---|---|---|---|---|")
        for v in c["variables"]:
            A("| %s | %s | `%s` | `%s` | %s | %s |"
              % (c["oname"].get(v.get("object_id"), "—"), _cell(v.get("title")),
                 v.get("type"), _cell(v.get("default_value"), 24),
                 v.get("read_mode"), _cell(v.get("description"), 40)))
        A("")

    if c["regex_rules"]:
        A("## 正则")
        A("")
        A("| # | 名称 | order | 对象 | 状态 |")
        A("|---|---|---|---|---|")
        for i, r in enumerate(c["regex_rules"], 1):
            A("| %d | %s | %s | %s | %s |"
              % (i, _cell(r.get("name")), r.get("order"),
                 "、".join(str(t) for t in (r.get("targets") or [])),
                 "开" if r.get("enabled", True) else "关"))
        A("")

    A("## 想改什么，动哪里")
    A("")
    A("| 想做的事 | 动这里 |")
    A("|---|---|")
    A("| 改某一句话 | 在 `spec.yaml` 里搜条目标题，改它的 `content` |")
    A("| 让某条常驻每轮都进提示 | 该条 `trigger_mode: always`，且 `position` 必须非空 |")
    A("| 让某条按关键词触发 | `trigger_mode: agent_tool` + `agent_read_strategy: keyword` + 填 `keywords` |")
    A("| 让某条由 AI 自己决定读不读 | `agent_read_strategy: normal` + 写实 `agent_selection_hint` |")
    A("| 加一条新条目 | 复制现有条目整块，改 `id` 与 `title`（`id` 必须唯一）|")
    A("| 加一个分组 | `library.groups` 里加一项，条目的 `group_id` 指过去 |")
    A("| 加一个变量 | `variables.objects` 加对象、`variables.variables` 加变量，"
      "`initial_state` 与 `schema_code` 也要各加一处 |")
    A("| 改完不知道对不对 | `python forge.py check <spec>` |")
    A("")

    A("## 体检")
    A("")
    if not c["issues"]:
        A("- ✔ 没有发现问题。")
    else:
        for i in sorted(c["issues"], key=lambda x: {"ERROR": 0, "WARN": 1, "INFO": 2}[x.level]):
            A("- [%s] `%s` %s：%s%s" % (i.level, i.code, i.where, i.message,
                                        ("　→ " + i.fix) if i.fix else ""))
    A("")
    return "\n".join(L)


def _cell(s, limit=None):
    t = str(s if s is not None else "").replace("|", "\\|").replace("\n", " ").strip()
    if limit and len(t) > limit:
        t = t[:limit - 1] + "…"
    return t


# ------------------------------------------------------------------ 落盘
def _write(text, path):
    d = os.path.dirname(os.path.abspath(path))
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return path
