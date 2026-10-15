# -*- coding: utf-8 -*-
"""forge/ui.py —— 本地图形工作台（零依赖，只用标准库）

把命令行那二十条命令收成一页网页：左边是你的卡，右边是
「看一眼 / 改内容 / 加机制 / 换皮 / 出成品」。

    python forge.py ui                      从工具目录里找卡
    python forge.py ui --根 "D:\\我的卡"      从别处找
    python forge.py ui --口 8777 --不打开

安全上只做两件事，但做死了：

  1. **只监听 127.0.0.1** —— 不对外网开口子。
  2. **写操作必须带令牌** —— 令牌在启动时现生成，只随页面发给本机这一页。
     浏览器的同源策略拦不住「别的网页往 localhost 提交表单」，令牌能。

另有一份**只读禁区**（`READONLY` 名单，以及任何放着 `.只读` 标记的目录）：
命中就拒绝一切写操作。`E:\\workGZQ\\艾瑟兰` 就在名单上 —— 那是另一个会话
在维护的实卡，本工具对它只许看、不许动。
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import bundle as BUNDLE
from . import bridge, content as CONTENT, dist as DIST, domain, export, manual
from . import model as M, mods, opener as OPENER, pack, scaffold
from . import theme as THEME
from . import validate

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE_DIR = os.path.join(ROOT, "assets", "工作台")

# 只读禁区（绝对路径）。命中任何一个，写操作直接拒绝。
READONLY = [os.path.join(os.path.dirname(ROOT), "艾瑟兰")]
# 目录里放着这个空文件 = 整个目录按只读处理（给用户的通用开关）
MARKER = ".只读"

DEFAULT_ROOT = ROOT

# 扫描卡时跳过的目录
SKIP_DIRS = {"__pycache__", "out", "node_modules", ".git", ".workbuddy",
             ".venv", "venv", ".idea", ".vscode", "dist", "build"}
# 工具自己的家当不算「卡」（只在扫描根那一层跳过）
SKIP_AT_ROOT = {"forge", "assets", "文档"}

# 条目上允许改的字段（其余一律原样留着，工具不碰）
# 「条目能改哪些字段」由 content.可改字段 说了算 —— 两边各留一份白名单迟早分叉。
# 卡壳上允许改的字段
CHAR_TEXT = ("name", "group", "opening", "image_prompt", "profile_age",
             "profile_sex", "profile_height", "profile_birthday", "profile_like")
CHAR_BOOL = ("show_opening", "frontend_beauty_enabled")

BACKUP_DIR = ".workbuddy/原文备份"


class UiError(Exception):
    """工作台的硬错：禁区、参数不对、找不到东西。这类错给用户看，措辞要能读懂。"""


# ------------------------------------------------------------------ 只读禁区
def _norm(p):
    return os.path.normcase(os.path.abspath(str(p)))


def readonly_reason(path):
    """要写这个路径的话，给个拒绝理由；能写返回 None。"""
    p = _norm(path)
    for r in READONLY:
        rr = _norm(r)
        if p == rr or p.startswith(rr + os.sep):
            return ("「%s」在只读禁区名单上（它是另一个会话在维护的实卡），"
                    "工作台不许改动它 —— 只许看。" % os.path.basename(r))
    cur = p if os.path.isdir(p) else os.path.dirname(p)
    while cur:
        try:
            if os.path.isfile(os.path.join(cur, MARKER)):
                return ("「%s」里放着 %s 标记，整个目录按只读处理。" % (cur, MARKER))
        except OSError:
            break
        up = os.path.dirname(cur)
        if up == cur:
            break
        cur = up
    return None


def guard(path):
    """写之前过一道禁区。命中就抛，绝不「先斩后奏」。"""
    why = readonly_reason(path)
    if why:
        raise UiError(why)
    return path


# ------------------------------------------------------------------ 定位
def _q1(q, key):
    got = q.get(key) or [""]
    return got[0]


def _dir(p):
    p = os.path.abspath(str(p or "").strip().strip('"').strip("'"))
    if not os.path.isdir(p):
        raise UiError("找不到目录：%s" % (p or "(空)"))
    return p


def _project(p):
    d = _dir(p)
    if not os.path.isdir(os.path.join(d, "source")):
        raise UiError("这不是一个卡工程（里面没有 source/）：%s" % d)
    return d


def _spec(project):
    """工程的那一份 spec。多了少了都当场说清楚，不猜。"""
    spec = _find(project)
    if not spec:
        raise UiError("source/ 下没有 *.spec.yaml：%s" % project)
    return spec


def _find(project):
    from . import hud as HUD
    try:
        return HUD.find_spec(project)
    except Exception as exc:
        raise UiError(str(exc))


def _card_name(spec):
    base = os.path.basename(spec)
    return base[:-len(".spec.yaml")] if base.endswith(".spec.yaml") else os.path.splitext(base)[0]


# ------------------------------------------------------------------ 扫描
def find_projects(root, max_depth=5):
    """从 root 往下找所有「卡工程」（含 source/*.spec.yaml 的目录）。"""
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        return []
    base = root.rstrip(os.sep)
    got = []
    for cur, dirs, files in os.walk(root):
        if cur == base:
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS
                       and d not in SKIP_AT_ROOT and not d.startswith(".")]
        else:
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        if cur[len(base):].count(os.sep) >= max_depth:
            dirs[:] = []
        src = os.path.join(cur, "source")
        if os.path.isdir(src):
            try:
                if any(f.endswith(".spec.yaml") for f in os.listdir(src)):
                    got.append(cur)
                    dirs[:] = []          # 一张卡一个工程，不用再往里钻
            except OSError:
                pass
    return sorted(got)


def project_brief(project):
    """一张卡的摘要。**不构建整卡**，扫列表要快。"""
    name = os.path.basename(project)
    spec, spec_err = None, ""
    try:
        spec = _find(project)
    except UiError as exc:
        spec_err = str(exc)
    card_name, ent, grp, var, re_ = name, 0, 0, 0, 0
    if spec:
        card_name = _card_name(spec)
        try:
            raw = M.yload(spec) or {}
            lib = raw.get("library") or {}
            ent = len(lib.get("entries") or [])
            grp = len(lib.get("groups") or [])
            var = len((raw.get("variables") or {}).get("variables") or [])
            re_ = len(raw.get("regex_rules") or [])
        except Exception as exc:
            spec_err = spec_err or ("spec 读不出来：%s" % exc)
    led = {}
    try:
        led = mods.load_ledger(project).get("模块") or {}
    except Exception:
        pass
    has_hud = os.path.isfile(os.path.join(project, "hud", "hud.conf.json"))
    skin = ""
    if has_hud:
        try:
            skin = THEME.current(project)
        except Exception:
            skin = ""
    prod = os.path.join(project, "成品")
    cards = []
    if os.path.isdir(prod):
        cards = sorted(f for f in os.listdir(prod) if f.endswith(".card.json"))
    return {
        "名": name, "路径": project, "卡名": card_name, "spec": spec,
        "条目": ent, "分组": grp, "变量": var, "正则": re_,
        "模块": list(led.keys()), "皮肤": skin,
        "有界面": has_hud,
        "有预览": os.path.isfile(os.path.join(project, "预览.html")),
        "成品": cards,
        "只读": bool(readonly_reason(project)),
        "问题": spec_err,
    }


# ------------------------------------------------------------------ 体检
def issues_json(issues):
    return [{"级别": i.level, "编号": i.code, "位置": i.where,
             "说明": i.message, "修法": i.fix} for i in issues]


def run_check(project):
    """体检：内容层 + 界面层。返回结构化结果（不是给人看的文本）。"""
    spec = _spec(project)
    card = pack.spec_to_card(spec)
    issues = validate.validate_card(card, os.path.basename(spec))
    # 工程层：各层对不对得上、派生物过没过期（这几类错都不报错，只能靠查）
    try:
        issues += validate.validate_project(project)
    except Exception as exc:
        issues.append(M.warn("PROJ-CHECK", "工程层", "工程层的检查没跑完：%s" % exc))
    if os.path.isfile(os.path.join(project, "hud", "hud.conf.json")):
        try:
            issues += validate.validate_hud(project)
        except Exception as exc:
            issues.append(M.warn("HUD-CHECK", "界面层", "界面守则没跑完：%s" % exc))
    s = validate.summarize(card)
    return {
        "摘要": {
            "卡名": s["name"], "条目": s["entries"], "分组": s["groups"],
            "变量": s["variables"], "对象": s["objects"], "正则": s["regex"],
            "常驻": s["const"], "常驻字数": s["const_chars"],
            "常驻护栏": validate.CONST_CHARS_LIMIT,
            "触发": s["trigger"], "策略": s["strategy"], "角色": s["role"],
        },
        "问题": issues_json(issues),
        "错": len([i for i in issues if i.level == "ERROR"]),
        "警告": len([i for i in issues if i.level == "WARN"]),
        "提示": len([i for i in issues if i.level == "INFO"]),
    }


# ------------------------------------------------------------------ 详情
def project_detail(project):
    工程 = _project(project)
    spec = _spec(工程)
    raw = M.yload(spec) or {}
    lib = raw.get("library") or {}
    gname = {g.get("id"): g.get("name") for g in (lib.get("groups") or [])}

    条目 = []
    for i, e in enumerate(lib.get("entries") or []):
        e = e or {}
        body = str(e.get("content") or "")
        op = e.get("opening_messages") or []
        条目.append({
            "id": e.get("id"), "标题": e.get("title") or "",
            "类型": e.get("kind") or "normal",
            "分组": e.get("group_id") or "",
            "分组名": gname.get(e.get("group_id") or "") or "（未分组）",
            "启用": e.get("enabled") is not False,
            "顺序": e.get("order"),
            "触发": e.get("trigger_mode") or "", "策略": e.get("agent_read_strategy") or "",
            "关键词": e.get("keywords") or [],
            "位置": e.get("position") or "", "角色": e.get("insert_role") or "",
            "读取提示": e.get("agent_selection_hint") or "",
            "解释": e.get("content_mode") or "",
            "关键词条件": e.get("keyword_condition") or "",
            "动态模式": e.get("dynamic_mode") or "",
            "图标": e.get("icon_id") or "",
            "正文": body,
            "正文长度": len(body),
            "开场分支": len(op),
        })

    分组 = [{"id": g.get("id"), "名": g.get("name") or "", "父": g.get("parent_id") or "",
             "顺序": g.get("order")} for g in (lib.get("groups") or [])]

    var = raw.get("variables") or {}
    objname = {o.get("id"): (o.get("name") or "") for o in (var.get("objects") or [])}
    变量 = []
    for v in (var.get("variables") or []):
        v = v or {}
        变量.append({"id": v.get("id"), "名": v.get("title") or v.get("name") or v.get("id"),
                     "类型": v.get("type") or "", "初值": v.get("default_value"),
                     "说明": v.get("description") or "",
                     "对象": objname.get(v.get("object_id")) or "",
                     "对象id": v.get("object_id") or ""})
    数 = {}
    for v in 变量:
        数[v["对象id"]] = 数.get(v["对象id"], 0) + 1
    对象 = []
    for o in (var.get("objects") or []):
        o = o or {}
        对象.append({"id": o.get("id"), "名": o.get("name") or "",
                     "父": objname.get(o.get("parent_id")) or "",
                     "变量数": 数.get(o.get("id"), 0),
                     "说明": o.get("description") or "",
                     "固定": str(o.get("id") or "").startswith("fixed-")})

    return {
        "工程": project_brief(工程),
        "卡壳": dict(raw.get("character") or {}),
        "开场白": _开场白(工程),
        "条目": 条目, "分组": 分组, "变量": 变量,
        "对象": 对象,
        "正则": CONTENT.list_regex(spec),
        "回收站": len(CONTENT.list_trash(spec)),
        "模板": list(CONTENT.模板表.keys()),
        "变量类型": list(CONTENT.变量类型表),
        "体检": run_check(工程),
        "机制": mechanisms(工程),
        "成品": products(工程),
        "界面": {
            "有界面": os.path.isfile(os.path.join(工程, "hud", "hud.conf.json")),
            "预览": _rel_if(工程, "预览.html"),
            "手册": _rel_if(工程, "文档", "%s.手册.html" % _card_name(spec)),
            "索引": _rel_if(工程, "文档", "%s.索引.md" % _card_name(spec)),
        },
        "只读": readonly_reason(工程) or "",
    }


def _rel_if(project, *parts):
    p = os.path.join(project, *parts)
    if os.path.isfile(p):
        return os.path.relpath(p, project).replace(os.sep, "/")
    return ""


def mechanisms(project):
    led = {}
    try:
        led = mods.load_ledger(project).get("模块") or {}
    except Exception:
        pass
    模块 = []
    for m in mods.list_modules():
        state, note = mods.module_state(m, led)
        模块.append({
            "名": m["_名"], "版本": str(m.get("版本") or ""),
            "一句话": m.get("一句话") or "",
            "带条目": bool(m.get("条目")), "带正则": bool(m.get("正则")),
            "带脚本": bool(m.get("脚本")), "带样式": bool(m.get("样式")),
            "状态": state, "说明": note,
        })
    皮肤 = []
    for t in THEME.list_themes():
        try:
            rep = THEME.contrast_report(t)
        except Exception:
            rep = {}
        row = [{"角色": k, "比度": round(v["比度"], 2), "底线": v["底线"], "够": v["够"]}
               for k, v in rep.items()]
        皮肤.append({"名": t["_名"], "一句话": t.get("一句话") or "",
                     "槽数": len(t.get("变量") or {}),
                     "对比度": row,
                     "不达标": [r["角色"] for r in row if not r["够"]]})
    cur = ""
    if os.path.isfile(os.path.join(project, "hud", "hud.conf.json")):
        try:
            cur = THEME.current(project)
        except Exception:
            cur = ""
    return {"模块": 模块, "皮肤": 皮肤, "当前皮肤": cur, "账本": led}


def products(project):
    out = []
    for sub in ("成品", "文档", ""):
        d = os.path.join(project, sub) if sub else project
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            p = os.path.join(d, f)
            if not os.path.isfile(p):
                continue
            if not sub and not (f.endswith(".html") or f.endswith(".zip")):
                continue
            out.append({"名": f, "相对": os.path.relpath(p, project).replace(os.sep, "/"),
                        "大小": os.path.getsize(p), "时间": os.path.getmtime(p)})
    out.sort(key=lambda r: r["时间"], reverse=True)
    return out


# ------------------------------------------------------------------ GET 接口
def api_状态(q):
    根 = _dir(_q1(q, "根") or DEFAULT_ROOT)
    工程 = [project_brief(p) for p in find_projects(根)]
    return {
        "根": 根, "默认根": DEFAULT_ROOT,
        "工程": 工程,
        "模块": [{"名": m["_名"], "版本": str(m.get("版本") or ""),
                  "一句话": m.get("一句话") or ""} for m in mods.list_modules()],
        "主题": [{"名": t["_名"], "一句话": t.get("一句话") or ""}
                 for t in THEME.list_themes()],
        "真值域": {k: {"值": list(d.values), "缺省": d.default,
                       "旧值": dict(d.legacy), "说明": d.note}
                   for k, d in domain.DOMAINS.items()},
        "禁区": list(READONLY),
    }


def api_原文(q):
    project = _project(_q1(q, "工程"))
    spec = _spec(project)
    with open(spec, "r", encoding="utf-8") as f:
        return {"文本": f.read(),
                "相对": os.path.relpath(spec, project).replace(os.sep, "/")}


def api_文件(q):
    """取工程里的一个文件（相对路径），供页面里 iframe / 下载用。"""
    project = _project(_q1(q, "工程"))
    rel = _q1(q, "相对")
    p = os.path.abspath(os.path.join(project, rel))
    if not p.startswith(os.path.abspath(project) + os.sep):
        raise UiError("路径跑到工程外面去了：%s" % rel)
    if not os.path.isfile(p):
        raise UiError("工程里没有这个文件：%s" % rel)
    return p


# ------------------------------------------------------------------ POST 操作
def act_建卡(b):
    名 = str(b.get("名") or "").strip()
    if not 名:
        raise UiError("卡名不能空。")
    根 = _dir(b.get("根") or DEFAULT_ROOT)
    guard(根)
    guard(os.path.join(根, 名))
    模块 = [str(x) for x in (b.get("模块") or []) if str(x).strip()]
    前缀 = str(b.get("id前缀") or "").strip() or None
    proj = scaffold.new_card(名, dest=根, id_prefix=前缀, modules=模块, quiet=True)
    return {"工程": project_brief(proj), "日志": ["已开新卡：%s" % proj]}


def act_接模块(b):
    工程 = _project(b.get("工程"))
    spec = _spec(工程)
    guard(spec)
    模块 = [str(x) for x in (b.get("模块") or []) if str(x).strip()]
    if not 模块:
        raise UiError("没说要接哪个模块。")
    log = []
    done = mods.apply_modules(spec, 模块, project=工程, out=log.append)
    if done and os.path.isfile(os.path.join(工程, "hud", "hud.conf.json")):
        try:
            HUD_build(工程, log)
        except Exception as exc:
            log.append("界面组装没跑成：%s" % exc)
    return {"已接": done, "日志": log, "详情": project_detail(工程)}


def act_撤模块(b):
    工程 = _project(b.get("工程"))
    spec = _spec(工程)
    guard(spec)
    模块 = [str(x) for x in (b.get("模块") or []) if str(x).strip()]
    if not 模块:
        raise UiError("没说要撤哪个模块。")
    log = []
    done = mods.drop_modules(spec, 模块, project=工程, out=log.append)
    if done and os.path.isfile(os.path.join(工程, "hud", "hud.conf.json")):
        try:
            HUD_build(工程, log)
        except Exception as exc:
            log.append("界面组装没跑成：%s" % exc)
    return {"已撤": done, "日志": log, "详情": project_detail(工程)}


def act_换皮肤(b):
    工程 = _project(b.get("工程"))
    guard(工程)
    名 = str(b.get("主题") or "").strip()
    log = []
    if not 名 or 名 in ("核心默认", "撤"):
        THEME.clear_theme(工程, out=log.append)
    else:
        THEME.apply_theme(名, 工程, out=log.append)
    if os.path.isfile(os.path.join(工程, "hud", "hud.conf.json")):
        try:
            HUD_build(工程, log)
        except Exception as exc:
            log.append("界面组装没跑成：%s" % exc)
    return {"日志": log, "详情": project_detail(工程)}


def HUD_build(project, log):
    from . import hud as HUD
    problems, _ = HUD.build(project, write_back=True, out=log.append)
    return problems


def act_组装(b):
    工程 = _project(b.get("工程"))
    guard(工程)
    log = []
    problems = HUD_build(工程, log)
    return {"问题": issues_json(problems), "日志": log, "详情": project_detail(工程)}


def act_体检(b):
    工程 = _project(b.get("工程"))
    return {"体检": run_check(工程)}


def act_存条目(b):
    """改一条已有条目 —— 与命令行 `entry --改` 同一份实现（`content.set_entry`）。

    以前这里是另写的一套：白名单自己一份、落盘直接 `ydump`（少一道「先编出卡
    再落盘」的证明）。两套迟早分叉，所以并回内核。
    """
    工程 = _project(b.get("工程"))
    spec = _spec(工程)
    guard(spec)
    字段 = dict(b.get("字段") or {})
    if not 字段:
        raise UiError("没说要改什么。")
    # 过程日志静音：工作台靠返回的「改了」列表说话，日志只会漏进调用方的终端
    r = _内容(lambda: CONTENT.set_entry(spec, str(b.get("条目") or ""), 字段=字段,
                                        out=lambda *a, **k: None))
    return {"改了": r.get("改了") or [], "体检": run_check(工程)}


def act_存卡壳(b):
    工程 = _project(b.get("工程"))
    spec = _spec(工程)
    guard(spec)
    字段 = b.get("字段") or {}
    raw = M.yload(spec) or {}
    ch = raw.setdefault("character", {})
    改了 = []
    for k in CHAR_TEXT:
        if k in 字段 and isinstance(字段[k], str) and ch.get(k) != 字段[k]:
            ch[k] = 字段[k]
            改了.append(k)
    for k in CHAR_BOOL:
        if k in 字段 and isinstance(字段[k], bool) and bool(ch.get(k)) != 字段[k]:
            ch[k] = 字段[k]
            改了.append(k)
    if 改了:
        M.ydump(raw, spec)
    return {"改了": 改了, "体检": run_check(工程)}


def act_存开场白(b):
    """改开场白正文 —— 与「存卡壳」不是一回事。

    那个改的是 `character` 里的字段（角色壳）；这个改的是开场白**条目**的正文，
    真源在 `hud/hud.conf.json`。末尾那三个零宽标记由 OPENER 负责补齐 ——
    界面上既看不见它们，也不该让谁来数。
    """
    工程 = _project(b.get("工程"))
    guard(_spec(工程))                 # 只读禁区照样拒写
    try:
        r = OPENER.改正文(工程, b.get("正文") or "", 写回=True,
                          out=lambda *a, **k: None)
    except OPENER.OpenerError as exc:
        raise UiError(str(exc))
    log = ["开场白已改（%d 字）" % len(r["正文"].rstrip("\u200b").rstrip())] \
        if r["变了"] else ["开场白没有变化"]
    return _带详情(工程, log)


def act_存原文(b):
    """直接改写 spec.yaml。落盘前先证明它能解析、能打包；过不了就一个字不写。"""
    工程 = _project(b.get("工程"))
    spec = _spec(工程)
    guard(spec)
    文本 = b.get("文本")
    if not isinstance(文本, str) or not 文本.strip():
        raise UiError("文本是空的。")
    try:
        import yaml
        obj = yaml.safe_load(文本)
    except Exception as exc:
        raise UiError("这不像合法的 YAML：%s" % exc)
    if not isinstance(obj, dict) or not (obj.get("library") or {}).get("entries"):
        raise UiError("这份文本里没有 library.entries —— 不像本工具的卡规格，没敢写。")

    bak = _backup(spec)
    with open(spec, "w", encoding="utf-8", newline="\n") as f:
        f.write(文本)
    try:
        pack.spec_to_card(spec)
    except Exception as exc:
        shutil.copy2(bak, spec)
        raise UiError("这份文本打不出卡，已自动还原：%s" % exc)
    return {"备份": bak, "体检": run_check(工程)}


def act_还原原文(b):
    工程 = _project(b.get("工程"))
    spec = _spec(工程)
    guard(spec)
    bak = os.path.join(工程, BACKUP_DIR, os.path.basename(spec))
    if not os.path.isfile(bak):
        raise UiError("没有备份可还原（备份在改第一版原文时才生成）。")
    shutil.copy2(bak, spec)
    return {"还原自": bak, "体检": run_check(工程)}


def _backup(spec):
    project = os.path.dirname(os.path.dirname(spec))
    d = os.path.join(project, BACKUP_DIR)
    os.makedirs(d, exist_ok=True)
    bak = os.path.join(d, os.path.basename(spec))
    shutil.copy2(spec, bak)
    return bak


def act_导入包(b):
    包 = str(b.get("包") or "").strip().strip('"').strip("'")
    根 = _dir(b.get("根") or DEFAULT_ROOT)
    guard(根)
    if not os.path.isfile(包):
        raise UiError("找不到包：%s" % (包 or "(空)"))
    log = []
    try:
        dest = DIST.import_pack(包, 根, rename=bool(b.get("改名")), out=log.append)
    except DIST.DistError as exc:
        raise UiError(str(exc))
    return {"工程": project_brief(dest), "日志": log}


def act_导入卡(b):
    文件 = str(b.get("文件") or "").strip().strip('"').strip("'")
    if not os.path.isfile(文件):
        raise UiError("找不到卡文件：%s" % (文件 or "(空)"))
    根 = _dir(b.get("根") or DEFAULT_ROOT)
    名 = os.path.splitext(os.path.basename(文件))[0]
    if 名.endswith(".card"):
        名 = 名[:-len(".card")]
    dest = os.path.join(根, 名)
    guard(dest)
    src = os.path.join(dest, "source")
    os.makedirs(src, exist_ok=True)
    spec = os.path.join(src, 名 + ".spec.yaml")

    log = []
    try:
        pack.unpack(文件, spec)
        log.append("按 ElecKoi 卡解包。")
    except Exception as first:
        try:
            bridge.to_eleckoi(文件, spec, out=log.append)
            log.append("ElecKoi 解包没成（%s），按酒馆 V2 卡转过来了。" % first)
        except Exception as second:
            raise UiError("这张卡既不是 ElecKoi 卡也不是酒馆 V2 卡：%s" % second)
    log.append("注意：外来卡只有内容层（source/），没有界面层（hud/）。")
    log.append("想连卡内界面一起要：`forge.py new <卡名> --从 \"%s\"` —— 开一张带界面的新卡，内容用这张的。"
               % os.path.basename(文件))
    return {"工程": project_brief(dest), "日志": log}


# ------------------------------------------------------------------ 增 / 删
# 这一组和命令行共用同一份内核（forge/content.py）：两边不会各说各话。
# 每个动作都是「先 guard（禁区拒写）→ 改 spec → 返回新详情」，改不动就整句回滚
# （content 那边是「编得出卡才落盘」）。
def _内容(fn):
    """把内容内核的硬错翻译成工作台看得懂的错。"""
    try:
        return fn()
    except CONTENT.ContentError as exc:
        raise UiError(str(exc))


def _工程与spec(b):
    工程 = _project(b.get("工程"))
    spec = _spec(工程)
    guard(spec)
    return 工程, spec


def _开场白(工程):
    """给界面用的开场白快照。读不出来就当「这工程没有这一块」——
    开场白不该挡住别的页签（工程没有 hud/ 是允许的）。"""
    try:
        d = OPENER.读(工程)
        return {"有开场白": d["有开场白"], "正文": d["正文"], "字数": d["字数"],
                "标记数": d["标记数"], "写回一致": d["写回一致"], "条目": d["条目"]}
    except Exception:
        return {"有开场白": False, "正文": "", "字数": 0, "标记数": 0,
                "写回一致": None, "条目": ""}


def _带详情(工程, log, **extra):
    out = dict(extra)
    out["日志"] = log
    out["详情"] = project_detail(工程)
    return out


def act_新条目(b):
    工程, spec = _工程与spec(b)
    关键词 = b.get("关键词")
    if isinstance(关键词, str):
        关键词 = [x.strip() for x in 关键词.replace("，", ",").replace("、", ",").split(",")
                  if x.strip()]
    log = []
    e = _内容(lambda: CONTENT.add_entry(
        spec, b.get("标题"), 分组=str(b.get("分组") or ""),
        模板=str(b.get("模板") or "常驻"), 正文=str(b.get("正文") or ""),
        关键词=关键词 or [], 提示=str(b.get("读取提示") or ""), out=log.append))
    log.append("")
    log.append("新条目的 id 是 %s —— 想让模块对准它，记下尾部那截。" % e["id"])
    return _带详情(工程, log, 条目=e["id"])


def act_删条目(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.del_entry(spec, b.get("条目"), out=log.append))
    return _带详情(工程, log)


def act_复制条目(b):
    工程, spec = _工程与spec(b)
    log = []
    e = _内容(lambda: CONTENT.dup_entry(spec, b.get("条目"),
                                        标题=b.get("标题"), out=log.append))
    return _带详情(工程, log, 条目=e["id"])


def act_挪条目(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.move_entry(spec, b.get("条目"),
                                     str(b.get("分组") or ""), out=log.append))
    return _带详情(工程, log)


def act_新分组(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.add_group(spec, b.get("名"), 父=str(b.get("父") or ""),
                                    out=log.append))
    return _带详情(工程, log)


def act_改名分组(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.rename_group(spec, b.get("分组"), b.get("名"), out=log.append))
    return _带详情(工程, log)


def act_删分组(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.del_group(spec, b.get("分组"), out=log.append))
    return _带详情(工程, log)


def act_新对象(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.add_object(spec, b.get("名"), 父=str(b.get("父") or ""),
                                     说明=str(b.get("说明") or ""), out=log.append))
    return _带详情(工程, log)


def act_新变量(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.add_variable(
        spec, b.get("对象"), b.get("标题"),
        类型=str(b.get("类型") or "string"), 初值=b.get("初值"),
        说明=str(b.get("说明") or ""), out=log.append))
    return _带详情(工程, log)


def act_删变量(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.del_variable(spec, b.get("变量"), out=log.append))
    return _带详情(工程, log)


def act_删对象(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.del_object(spec, b.get("对象"), out=log.append))
    return _带详情(工程, log)


def act_改名变量(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.rename_variable(spec, b.get("变量"), b.get("新名"), out=log.append))
    return _带详情(工程, log)


def act_换变量对象(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.move_variable(spec, b.get("变量"), b.get("到"), out=log.append))
    return _带详情(工程, log)


def act_改名对象(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.rename_object(spec, b.get("对象"), b.get("新名"), out=log.append))
    return _带详情(工程, log)


def _名单(x):
    """前端可能给字符串（逗号/顿号分隔）也可能给数组，统一成名字列表。"""
    if isinstance(x, list):
        return [str(i).strip() for i in x if str(i).strip()]
    s = str(x or "")
    for 符 in ("，", "、", "\n", ";"):
        s = s.replace(符, ",")
    return [i.strip() for i in s.split(",") if i.strip()]


def act_批量条目(b):
    """批量挪组 / 删 / 启停 —— 与命令行的 `entry --挪/--删/--启用/--停用 一串` 同一份实现。

    **有认不出的名字就整批停下、一条不动** —— 这一条是 content 那边保证的，这里不重复判。
    """
    工程, spec = _工程与spec(b)
    个 = _名单(b.get("条目"))
    if not 个:
        raise UiError("没给要动的条目 —— 先在左栏勾几条。")
    做 = str(b.get("做") or "")
    log = []
    if 做 in ("挪", "挪组"):
        到 = str(b.get("到") or "")
        if not 到:
            raise UiError("没说挪到哪个分组。")
        _内容(lambda: CONTENT.move_entries(spec, 个, 到, out=log.append))
    elif 做 == "删":
        _内容(lambda: CONTENT.del_entries(spec, 个, out=log.append))
    elif 做 in ("启用", "停用"):
        _内容(lambda: CONTENT.set_entries_enabled(spec, 个, 做 == "启用", out=log.append))
    else:
        raise UiError("认不得的批量操作：%s（有 挪 / 删 / 启用 / 停用）" % 做)
    return _带详情(工程, log)


def act_批量改条目(b):
    """给勾中的一批条目同时改同一组字段 —— 转调 content.set_entries_fields 那一份。

    值的形状与值域拦截全在 content 里，这里只负责把前端的字段包解出来。
    """
    工程, spec = _工程与spec(b)
    个 = _名单(b.get("条目"))
    if not 个:
        raise UiError("没给要改的条目 —— 先在左栏勾几条。")
    # 前端只会把**用户明确要改的字段**放进来 —— 留空也照传（那是「清空这个字段」，
    # 不是「没填」）。所以这里只把 None 挡掉，不把空串当没填。
    字段 = {k: v for k, v in (b.get("字段") or {}).items() if v is not None}
    if not 字段:
        raise UiError("没说改哪个字段。")
    log = []
    _内容(lambda: CONTENT.set_entries_fields(spec, 个, 字段, out=log.append))
    return _带详情(工程, log)


def act_批量删变量(b):
    """一次删多个变量 —— 转调 content.del_variables 那一份（每个变量三处，一起撤）。"""
    工程, spec = _工程与spec(b)
    个 = _名单(b.get("变量"))
    if not 个:
        raise UiError("没给要删的变量 —— 先在表里勾几个。")
    log = []
    _内容(lambda: CONTENT.del_variables(spec, 个, out=log.append))
    return _带详情(工程, log)


def act_对齐schema(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.align_schema(spec, out=log.append))
    return _带详情(工程, log)


def act_新正则(b):
    工程, spec = _工程与spec(b)
    目标 = b.get("目标")
    if isinstance(目标, str):
        目标 = [x.strip() for x in 目标.replace("，", ",").split(",") if x.strip()]
    log = []
    _内容(lambda: CONTENT.add_regex(spec, b.get("名"), b.get("模式"),
                                    替换=str(b.get("替换") or ""), 目标=目标 or None,
                                    out=log.append))
    return _带详情(工程, log)


def act_删正则(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.del_regex(spec, b.get("正则"), out=log.append))
    return _带详情(工程, log)


def act_开关正则(b):
    工程, spec = _工程与spec(b)
    log = []
    _内容(lambda: CONTENT.set_regex(spec, b.get("正则"), bool(b.get("开")),
                                    out=log.append))
    return _带详情(工程, log)


def act_回收站(b):
    工程 = _project(b.get("工程"))
    rows = []
    for i, rec in enumerate(CONTENT.list_trash(_spec(工程)), 1):
        rows.append({
            "序号": i, "时间": rec.get("时间") or "", "种类": rec.get("种类") or "",
            "说明": rec.get("说明") or "", "项数": len(rec.get("项") or []),
            "文件": rec.get("_文件") or "",
        })
    return {"回收站": rows, "目录": CONTENT.TRASH_DIR}


def act_还原(b):
    工程, spec = _工程与spec(b)
    log = []
    r = _内容(lambda: CONTENT.restore(spec, b.get("序号"), out=log.append))
    log.append("")
    log.append("放回：%s" % (r.get("说明") or ""))
    for x in r.get("跳过") or []:
        log.append("  ⚠ 跳过 %s" % x)
    return _带详情(工程, log)


def act_清空回收站(b):
    工程, spec = _工程与spec(b)
    n = _内容(lambda: CONTENT.clear_trash(spec))
    return _带详情(工程, ["回收站清空了（%d 条）。" % n])


def act_出成品(b):
    工程 = _project(b.get("工程"))
    spec = _spec(工程)
    guard(工程)
    项 = b.get("项") or []
    if not 项:
        raise UiError("没勾要出什么。")
    名 = _card_name(spec)
    out_dir = os.path.join(工程, "成品")
    doc_dir = os.path.join(工程, "文档")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(doc_dir, exist_ok=True)
    log = []
    产物 = {}

    if "卡" in 项 or "酒馆" in 项 or "打包" in 项:
        card = os.path.join(out_dir, 名 + ".card.json")
        pack.build(spec, card)
        产物["卡"] = card
        s = validate.summarize(M.jload(card))
        log.append("卡   -> 成品/%s.card.json（条目 %d · 分组 %d · 变量 %d · 正则 %d）"
                   % (名, s["entries"], s["groups"], s["variables"], s["regex"]))

    if "手册" in 项:
        产物["手册"] = manual.build_manual(
            spec, os.path.join(doc_dir, 名 + ".手册.html"), out=log.append)
    if "索引" in 项:
        产物["索引"] = manual.build_index(
            spec, os.path.join(doc_dir, 名 + ".索引.md"), out=log.append)
    if "酒馆" in 项:
        产物["酒馆"] = export.to_tavern(
            产物["卡"], os.path.join(out_dir, 名 + ".酒馆V2.json"), out=log.append)
    if "打包" in 项:
        产物["包"] = BUNDLE.run(工程, out=os.path.join(out_dir, 名 + ".工程包.zip"),
                              out_print=log.append)
    return {"产物": 产物, "日志": log, "详情": project_detail(工程)}


# ------------------------------------------------------------------ HTTP
TOKEN = secrets.token_hex(16)
_LOCK = threading.Lock()

_Ctypes = {".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
           ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
           ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8",
           ".yaml": "text/plain; charset=utf-8", ".yml": "text/plain; charset=utf-8",
           ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
           ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "forge-workbench/1"

    def log_message(self, fmt, *a):        # 控制台别被静态资源刷屏
        pass

    # ---- 输出
    def _send(self, body, ctype, code=200, extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8", code)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        raw = self.rfile.read(n) if n else b""
        if not raw:
            return {}
        try:
            got = json.loads(raw.decode("utf-8"))
            return got if isinstance(got, dict) else {}
        except Exception:
            return {}

    # ---- GET
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        path = unquote(u.path)
        try:
            if path in ("/", "/index.html"):
                self._send(_page(), "text/html; charset=utf-8")
            elif path.startswith("/static/"):
                self._static(os.path.basename(path[len("/static/"):]))
            elif path == "/api/状态":
                self._json({"好": True, "数据": api_状态(q)})
            elif path == "/api/详情":
                self._json({"好": True, "数据": project_detail(_q1(q, "工程"))})
            elif path == "/api/原文":
                self._json({"好": True, "数据": api_原文(q)})
            elif path == "/api/文件":
                p = api_文件(q)
                ext = os.path.splitext(p)[1].lower()
                with open(p, "rb") as f:
                    body = f.read()
                extra = {}
                if ext not in _Ctypes:
                    extra["Content-Disposition"] = "attachment; filename*=UTF-8''%s" % \
                        _url_quote(os.path.basename(p))
                self._send(body, _Ctypes.get(ext, "application/octet-stream"), extra=extra)
            else:
                self._json({"好": False, "错": "没有这个地址：%s" % path}, 404)
        except UiError as exc:
            self._json({"好": False, "错": str(exc)}, 400)
        except Exception as exc:
            self._json({"好": False, "错": "%s: %s" % (type(exc).__name__, exc)}, 500)

    # ---- POST
    def do_POST(self):
        u = urlparse(self.path)
        path = unquote(u.path)
        if self.headers.get("X-Forge-Token") != TOKEN:
            self._json({"好": False,
                        "错": "令牌不对 —— 这个请求不是从工作台这一页发出的，不办。"},
                       403)
            return
        key = path[len("/api/"):] if path.startswith("/api/") else ""
        fn = POSTS.get(key)
        if not fn:
            self._json({"好": False, "错": "没有这个操作：%s" % path}, 404)
            return
        body = self._body()
        try:
            with _LOCK:                    # 组装/主题那些函数有模块级状态，串行跑
                data = fn(body)
            self._json({"好": True, "数据": data})
        except UiError as exc:
            self._json({"好": False, "错": str(exc)}, 400)
        except Exception as exc:
            self._json({"好": False, "错": "%s: %s" % (type(exc).__name__, exc)}, 500)

    # ---- 静态
    def _static(self, name):
        p = os.path.join(PAGE_DIR, name)
        if not os.path.isfile(p):
            self._json({"好": False, "错": "没有这个文件：%s" % name}, 404)
            return
        with open(p, "rb") as f:
            body = f.read()
        self._send(body, _Ctypes.get(os.path.splitext(p)[1].lower(), "application/octet-stream"))


POSTS = {
    "建卡": act_建卡,
    "接模块": act_接模块,
    "撤模块": act_撤模块,
    "换皮肤": act_换皮肤,
    "组装": act_组装,
    "体检": act_体检,
    "存条目": act_存条目,
    "存卡壳": act_存卡壳,
    "存开场白": act_存开场白,
    "存原文": act_存原文,
    "还原原文": act_还原原文,
    "导入卡": act_导入卡,
    "导入包": act_导入包,
    # 增 / 删（与命令行共用 forge/content.py）
    "新条目": act_新条目, "删条目": act_删条目,
    "复制条目": act_复制条目, "挪条目": act_挪条目,
    "新分组": act_新分组, "改名分组": act_改名分组, "删分组": act_删分组,
    "新对象": act_新对象, "新变量": act_新变量,
    "删变量": act_删变量, "删对象": act_删对象, "对齐schema": act_对齐schema,
    # 改名 / 换对象 / 批量（同一份 content 实现，命令行那半边也是这些）
    "改名变量": act_改名变量, "换变量对象": act_换变量对象, "改名对象": act_改名对象,
    "批量条目": act_批量条目, "批量改条目": act_批量改条目, "批量删变量": act_批量删变量,
    "新正则": act_新正则, "删正则": act_删正则, "开关正则": act_开关正则,
    "回收站": act_回收站, "还原": act_还原, "清空回收站": act_清空回收站,
    "出成品": act_出成品,
}


def _page():
    with open(os.path.join(PAGE_DIR, "index.html"), "r", encoding="utf-8") as f:
        return f.read().replace("__FORGE_TOKEN__", TOKEN)


def _url_quote(s):
    from urllib.parse import quote
    return quote(s)


# ------------------------------------------------------------------ 启动
def run(root=None, host="127.0.0.1", port=8777, open_browser=True, out=print):
    global DEFAULT_ROOT
    if root:
        DEFAULT_ROOT = os.path.abspath(root)
    if not os.path.isdir(PAGE_DIR):
        raise UiError("找不到工作台页面：%s" % PAGE_DIR)

    srv = None
    last = None
    for p in range(int(port), int(port) + 20):
        try:
            srv = ThreadingHTTPServer((host, p), Handler)
            break
        except OSError as exc:
            last = exc
    if srv is None:
        raise UiError("从 %d 起试了 20 个端口都被占了（%s）。换个 --口 再来。" % (port, last))

    url = "http://%s:%d/" % (host, srv.server_address[1])
    out("")
    out("  制卡工作台已开：%s" % url)
    out("  找卡的目录：%s" % DEFAULT_ROOT)
    out("  只监听本机（%s），关掉这个窗口即为关闭。" % host)
    out("")
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        out("\n工作台已关。")
    finally:
        srv.server_close()
    return 0
