# -*- coding: utf-8 -*-
"""forge.content —— 内容编辑内核：往卡里加东西、从卡里删东西。

在这之前，工具只能改「**已经存在**」的条目：工作台的编辑器是这样，命令行也只能
改已有的键值。做卡的人真正卡住的，是**第一条**和**删错的那一条** —— 所以这一层
补的就是「增」和「删」。命令行与工作台共用这一份，两边不会各说各话。

三条约定，都是硬的：

  1. **改的永远是 spec.yaml**（唯一真相）。改完先在内存里编一遍卡：编不出来就整个
     不落盘，绝不留半成品。证明在落盘之前，不在之后。
  2. **删和改都留底**（`<工程>/.forge/回收站/`），随时能还原。删一目了然，
     改是**无声覆盖** —— 被盖掉的那一版同样值得留，所以 `set_entry` 也进回收站。
  3. **变量要一次写全三处**（objects 画面板 / initial_state 初值 / schema_code 校验）。
     少一处不报错，只是安静地少一块。所以「加一个变量」这件事由工具一次写完，
     不该指望人记着。
"""
from __future__ import annotations

import hashlib
import json
import os
import re as _re
import shutil
import tempfile
from collections import OrderedDict

from . import domain as D
from . import model as M
from . import pack
from . import sandbox as SB
from . import zod as ZOD

TRASH_DIR = ".forge/回收站"
TRASH_MAX = 60           # 回收站最多留几条，超了删最旧的

# 新条目用的模板。键名与卡里的字段一一对应，改这里就是改「新建条目」的默认样子。
模板表 = OrderedDict([
    ("常驻", OrderedDict([
        ("kind", "normal"), ("trigger_mode", "always"),
        ("agent_read_strategy", "normal"), ("position", "instructions"),
        ("insert_role", "system"),
    ])),
    ("必读", OrderedDict([
        ("kind", "normal"), ("trigger_mode", "agent_tool"),
        ("agent_read_strategy", "required"), ("insert_role", "user"),
    ])),
    ("关键词", OrderedDict([
        ("kind", "normal"), ("trigger_mode", "agent_tool"),
        ("agent_read_strategy", "keyword"), ("insert_role", "user"),
    ])),
    ("选读", OrderedDict([
        ("kind", "normal"), ("trigger_mode", "agent_tool"),
        ("agent_read_strategy", "normal"), ("insert_role", "user"),
    ])),
    ("开场", OrderedDict([
        ("kind", "opening"), ("trigger_mode", "always"),
        ("agent_read_strategy", "normal"), ("insert_role", "assistant"),
    ])),
])

# 变量类型 -> 初值的默认样子
默认初值 = {"boolean": False, "number": 0, "string": "", "array": [], "object": {}}

变量类型表 = ("string", "number", "boolean", "array", "object")


# 一条新条目的完整默认形状。字段名与值照真实卡抄（骨架里的 skel-world-core）——
# 官方写卡时这些键**一个不落**地写出来，缺键虽然软件也读，但键不全会让后来人
# 分不清「没写」和「写了空」。
_条目默认 = OrderedDict([
    ("icon_id", ""), ("kind", "normal"), ("group_id", ""), ("content", ""),
    ("opening_messages", []), ("default_opening_message_id", ""),
    ("agent_selection_hint", ""), ("agent_read_strategy", "normal"),
    ("dynamic_mode", "standard"), ("keywords", []), ("keyword_scan_depth", 1),
    ("condition_keywords", []), ("keyword_condition", "none"),
    ("keyword_use_regex", False), ("keyword_ignore_case", True),
    ("keyword_whole_word", False), ("keyword_recursion_depth", 0),
    ("trigger_mode", "always"), ("enabled", True), ("position", ""),
    ("prompt_position_id", ""), ("insert_role", "user"), ("order", 1),
    ("view_order", 0), ("group_view_order", 0), ("tree_view_order", 1),
])
# 从卡里现有条目继承的「这张卡的偏好」（不继承身份与正文）
# 注意 agent_selection_hint **不在**这里：它是这一条自己的内容（「什么时候读我」），
# 照抄上一条的会得到一句对不上的话 —— 内容是卡主的，工具不替人编。
_继承字段 = ("icon_id", "keyword_scan_depth",
             "keyword_condition", "keyword_use_regex", "keyword_ignore_case",
             "keyword_whole_word", "keyword_recursion_depth")


class ContentError(Exception):
    """内容编辑的硬错。给用户看的，措辞要能直接照着改。"""


# ------------------------------------------------------------------ 位置
def project_of(spec):
    p = os.path.abspath(spec)
    if os.path.isfile(p):
        p = os.path.dirname(p)
    if os.path.basename(p) in ("source", "成品", "文档", "hud"):
        p = os.path.dirname(p)
    return p


def _prefix(spec):
    """条目 / 正则的 id 前缀。以 hud.conf.json 里那份为准（界面层才是事实来源）。"""
    conf = os.path.join(project_of(spec), "hud", "hud.conf.json")
    if os.path.isfile(conf):
        try:
            with open(conf, encoding="utf-8") as f:
                p = str((json.load(f) or {}).get("id_prefix") or "").strip()
            if p:
                return p
        except Exception:
            pass
    try:
        name = (M.yload(spec) or {}).get("character", {}).get("name") or ""
    except Exception:
        name = ""
    return M.ascii_prefix(name or os.path.splitext(os.path.basename(spec))[0])


# ------------------------------------------------------------------ 读写
_载入快照 = {}          # 绝对路径 -> 读出内容那一刻的指纹


def _指纹(path):
    try:
        with open(path, "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()
    except OSError:
        return None


def load(spec):
    """读 spec，并**记下它此刻的指纹** —— 落盘之前要比一次（见 commit）。"""
    if not os.path.isfile(spec):
        raise ContentError("找不到 spec：%s" % spec)
    p = os.path.abspath(spec)
    _载入快照[p] = _指纹(p)
    return M.yload(spec) or {}


def commit(spec, raw, out=print):
    """把改过的 spec 编一遍卡，编得出才覆盖落盘；编不出就一个字不写。

    落盘前还比一次**载入时的指纹**：文件若在「读它」到「写它」之间被改过，就拒绝落盘。
    直接写上去等于把别人那一次改动**静默吃掉** —— 最容易撞上的是「同一条命令被并发跑了两遍」
    （两条各自读到同一份旧内容、各自打印「已改…成功」，最后只有一条留在盘上，且没有任何提示）。
    宁可让人重跑一遍，也不静默丢一次改动。
    """
    p = os.path.abspath(spec)
    旧, 今 = _载入快照.get(p), _指纹(p)
    if 旧 is not None and 今 is not None and 旧 != 今:
        raise ContentError(
            "这个 spec 在你读它之后被改过了 —— 拒绝覆盖（写上去会把那一次改动**静默吃掉**）。\n"
            "  多半是同一条命令被并发跑了两遍（各自读到同一份旧内容，后落盘的那份赢）。\n"
            "  串行重跑一遍就好；想看清楚先 `python forge.py diff` 比一下。")
    d = os.path.dirname(p) or "."
    if SB.enabled():
        # 沙箱里临时文件**别放进工程目录** —— 那儿删不掉，会留下一地 `.forge-tmp-*`。
        # 反正沙箱模式不走改名，就不需要「同盘才能原子换」这个理由了。
        d = tempfile.gettempdir()
    fd, tmp = tempfile.mkstemp(suffix=".yaml", prefix=".forge-tmp-", dir=d)
    os.close(fd)
    try:
        M.ydump(raw, tmp)
        try:
            pack.spec_to_card(tmp)
        except Exception as exc:
            raise ContentError("改完之后打不出卡（已放弃，spec 一个字没动）：%s" % exc)
        SB.land(tmp, spec)
        _载入快照[p] = _指纹(p)
    finally:
        SB.cleanup(tmp)
    return spec


# ------------------------------------------------------------------ 取表
def entries_of(raw, must=True):
    lib = raw.setdefault("library", OrderedDict()) if must else (raw.get("library") or {})
    return lib.setdefault("entries", []) if must else (lib.get("entries") or [])


def groups_of(raw, must=True):
    lib = raw.setdefault("library", OrderedDict()) if must else (raw.get("library") or {})
    return lib.setdefault("groups", []) if must else (lib.get("groups") or [])


def _vars(raw, must=False):
    v = raw.get("variables")
    if not isinstance(v, dict):
        if not must:
            return None
        v = OrderedDict()
        raw["variables"] = v
    return v


def _find(rows, who, fields=("id", "name", "title")):
    """按 id / 名字找一个。完全等于优先，其次「以 -名字 收尾」（模块那种写法）。"""
    who = str(who or "").strip()
    if not who:
        return None
    for r in rows:
        for f in fields:
            if str((r or {}).get(f) or "").strip() == who:
                return r
    for r in rows:
        for f in fields:
            if str((r or {}).get(f) or "").strip().endswith("-" + who):
                return r
    return None


def _max_order(rows):
    n = 0
    for r in rows:
        try:
            n = max(n, int((r or {}).get("order") or 0))
        except (TypeError, ValueError):
            pass
    return n


def list_groups(spec):
    raw = load(spec)
    return [{"id": g.get("id"), "名": g.get("name") or "", "父": g.get("parent_id") or ""}
            for g in groups_of(raw, must=False)]


def list_entries(spec):
    raw = load(spec)
    gname = {g.get("id"): g.get("name") for g in groups_of(raw, must=False)}
    out = []
    for e in entries_of(raw, must=False):
        out.append({
            "id": e.get("id"), "标题": e.get("title") or "",
            "分组": gname.get(e.get("group_id") or "") or "",
            "顺序": e.get("order"),
            "触发": e.get("trigger_mode") or "",
            "策略": e.get("agent_read_strategy") or "",
            "类型": e.get("kind") or "normal",
            "启用": bool(e.get("enabled", True)),
            "关键词": e.get("keywords") or [],
            "字数": len(str(e.get("content") or "")),
        })
    return out


def entry_detail(spec, 谁):
    """一条条目的全貌 —— 给「读一条」用。

    工具能改条目（--改）、能列条目（--列），却**读不到单条正文**。而
    「先看它现在写了什么，再决定怎么改」恰恰是改一张卡的第一步。缺了它，
    想改一段话就得把整份 spec（几十条 × 三十来个字段）整个吞进去找。
    """
    raw, e = find_entry(spec, 谁)
    gname = {g.get("id"): (g.get("name") or "") for g in groups_of(raw, must=False)}
    正文 = str(e.get("content") or "")
    d = OrderedDict([
        ("id", str(e.get("id") or "")),
        ("标题", str(e.get("title") or "")),
        ("分组", gname.get(e.get("group_id") or "") or "（未分组）"),
        ("类型", str(e.get("kind") or "normal")),
        ("启用", "是" if e.get("enabled", True) else "否 —— 卡里留着，但不生效"),
        ("顺序", e.get("order")),
        ("触发方式", str(e.get("trigger_mode") or "")),
        ("读取策略", str(e.get("agent_read_strategy") or "")),
        ("动态模式", str(e.get("dynamic_mode") or "")),
        ("内容模式", str(e.get("content_mode") or "")),
        ("关键词", list(e.get("keywords") or [])),
        ("关键词条件", str(e.get("keyword_condition") or "")),
        ("读取提示", str(e.get("agent_selection_hint") or "")),
        ("插入位置", str(e.get("position") or "")),
        ("插入角色", str(e.get("insert_role") or "")),
        ("图标", str(e.get("icon_id") or "")),
        ("字数", len(正文)),
        ("正文", 正文),
    ])
    if str(e.get("kind") or "") == "opening":
        d["开场白方案"] = [
            {"id": str(m.get("id") or ""), "标题": str(m.get("title") or ""),
             "字数": len(str(m.get("content") or ""))}
            for m in (e.get("opening_messages") or [])]
        d["默认方案"] = str(e.get("default_opening_message_id") or "")
    return d


# ------------------------------------------------------------------ 回收站
def trash_dir(spec):
    return os.path.join(project_of(spec), TRASH_DIR)


def put_trash(spec, 种类, 说明, 项):
    d = trash_dir(spec)
    os.makedirs(d, exist_ok=True)
    rec = OrderedDict([
        ("时间", M.now_iso()),
        ("种类", 种类),
        ("说明", 说明),
        ("项", 项),
    ])
    # 文件名就是**顺序**：回收站按名字倒排给用户看。所以时间戳要一路到微秒 ——
    # 精确到秒的话，同一秒里删两样东西，谁先谁后就变成随机的了。
    stamp = M.now_iso()[:26].replace(":", "")       # 2026-10-08T153456.158674
    name = "%s-%s.json" % (stamp, M.uuid4hex()[:4])
    path = os.path.join(d, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)
        f.write("\n")
    _trim_trash(d)
    return path


def _trim_trash(d):
    """超出上限就把最老的几条**作废**。

    注意上限数的是「还认得的记录」，墓碑不计 —— 否则沙箱里一堆墓碑会把名额占满。
    """
    files = sorted(f for f in os.listdir(d) if f.endswith(".json"))
    活 = []
    for f in files:
        p = os.path.join(d, f)
        try:
            with open(p, encoding="utf-8") as fh:
                rec = json.load(fh)
        except Exception:
            continue
        if not SB.is_tombstone(rec):
            活.append(p)
    for p in 活[:-TRASH_MAX]:
        SB.retire(p)


def trash_note(out):
    out("  · 这一份在回收站里，能还原（python forge.py trash --还原 1）")


def list_trash(spec):
    d = trash_dir(spec)
    if not os.path.isdir(d):
        return []
    out = []
    for f in sorted(os.listdir(d), reverse=True):
        if not f.endswith(".json"):
            continue
        p = os.path.join(d, f)
        try:
            with open(p, encoding="utf-8") as fh:
                rec = json.load(fh)
        except Exception:
            continue
        if SB.is_tombstone(rec):
            continue          # 沙箱里「删掉」的记录写成了墓碑 —— 语义上它已经不在
        rec["_文件"] = f
        rec["_路径"] = p
        out.append(rec)
    return out


_表中文 = {"entries": "条目", "groups": "分组", "objects": "变量对象",
           "variables": "变量", "regex": "正则"}

_表名 = {
    "entries": ("library", "entries"),
    "groups": ("library", "groups"),
    "objects": ("variables", "objects"),
    "variables": ("variables", "variables"),
    "regex": (None, "regex_rules"),
    "initial_state": ("variables", "initial_state"),
    "schema": ("variables", "schema_code"),
}


def _table(raw, name, must=False):
    a, b = _表名[name]
    cur = raw
    if a:
        if not isinstance(cur.get(a), dict):
            if not must:
                return None
            cur[a] = OrderedDict()
        cur = cur[a]
    if must:
        cur.setdefault(b, [] if name in ("entries", "groups", "objects", "variables",
                                        "regex") else None)
    return cur.get(b)


def restore(spec, which, out=print):
    """按回收站里的记录原样放回去。which = 序号（1 = 最近一条）或记录文件名。"""
    recs = list_trash(spec)
    if not recs:
        raise ContentError("回收站是空的。")
    rec = None
    s = str(which or "").strip()
    if s.isdigit():
        i = int(s) - 1
        if not (0 <= i < len(recs)):
            raise ContentError("回收站里只有 %d 条记录。" % len(recs))
        rec = recs[i]
    else:
        for r in recs:
            if r["_文件"] == s or r["_文件"].startswith(s):
                rec = r
                break
    if rec is None:
        raise ContentError("回收站里没有这一条：%s" % s)

    raw = load(spec)
    放回 = []
    跳过 = []
    # 开场白这类项不能边循环边做：它动的是 conf 与 spec **两个文件**，
    # 而循环末尾会拿这里读到的 raw 快照整份覆盖 spec —— 会把它吃掉。
    # 所以先收着，等 commit 落完盘再动手。
    开场白项 = []
    卡名项 = []
    for item in (rec.get("项") or []):
        t = item.get("表")
        data = item.get("数据")
        if t == "initial_state":
            父 = raw.setdefault("variables", OrderedDict()).setdefault(
                "initial_state", OrderedDict())
            cur = 父
            for seg in (item.get("路径") or [])[:-1]:
                cur = cur.setdefault(seg, OrderedDict())
            k = (item.get("路径") or [])[-1]
            if k in cur:
                跳过.append("初值「%s」（已经有了）" % ".".join(item.get("路径") or []))
            else:
                cur[k] = data
                放回.append("初值「%s」" % ".".join(item.get("路径") or []))
            continue
        if t == "regroup":
            # 删分组时被挪到「未分组」的那些条目：还原时认回来
            n = 0
            for e in entries_of(raw, must=False):
                if str(e.get("id")) in (data or {}) and not str(e.get("group_id") or ""):
                    e["group_id"] = (data or {})[str(e.get("id"))]
                    e["updated_at"] = M.now_iso()
                    n += 1
            if n:
                放回.append("%d 条条目归回原组" % n)
            continue
        if t == "挪变量":
            # 变量换对象：反向挪回去 —— 挂靠关系、初值那格、Zod 那个字段、顺序，逐一还原。
            # 跟「改名」一样，三处各自独立还原：当时哪一处没跟着改，这里也不凭空编。
            v = raw.setdefault("variables", OrderedDict())
            键 = str(item.get("键") or "")
            目标 = _find(v.get("variables") or [], item.get("变量id"), ("id",))
            if 目标 is None:
                跳过.append("变量「%s」（已经不在卡里）" % 键)
            else:
                目标["object_id"] = item.get("旧对象id")
                if item.get("旧顺序") is not None:
                    目标["order"] = item.get("旧顺序")
                if item.get("旧视图序") is not None:
                    目标["tree_view_order"] = item.get("旧视图序")
                目标["updated_at"] = M.now_iso()
                放回.append("变量挂回「%s」下" % item.get("旧对象"))
            if _搬格子(v.get("initial_state") or {}, item.get("新状态路径"),
                        item.get("旧状态路径")):
                放回.append("初值那一格搬回「%s」" % ".".join(list(item.get("旧状态路径") or [])))
            p从, p到 = item.get("新Zod路径"), item.get("旧Zod路径")
            if p从 and p到:
                try:
                    root = ZOD.parse(v.get("schema_code") or "")
                    n从 = ZOD.node_at(root, tuple(list(p从)[:-1]))
                    if isinstance(n从, ZOD.Obj) and str(p从[-1]) in n从.kids:
                        表达式 = n从.kids[str(p从[-1])].code
                        ZOD.drop(root, tuple(list(p从)[:-1]), str(p从[-1]))
                        ZOD.set_leaf(root, tuple(list(p到)[:-1]), str(p到[-1]), 表达式)
                        v["schema_code"] = ZOD.emit(root)
                        放回.append("Zod 字段搬回「%s」" % ".".join(list(p到)))
                    else:
                        跳过.append("Zod 字段（在新位置没找着）")
                except ZOD.ZodError as exc:
                    跳过.append("Zod 字段（%s）" % exc)
            continue
        if t == "改名":
            # 变量 / 变量对象改名：反向挪回去（键名换回来，位置本来就没动）。
            # 三处各自独立还原 —— 哪一处当时没跟着改（比如 Zod 认不出），
            # 这里也不会凭空去编一个。
            v = raw.setdefault("variables", OrderedDict())
            种类 = str(item.get("种类") or "变量")
            旧名 = str(item.get("旧") or "")
            新名 = str(item.get("新") or "")
            if 种类 == "变量":
                目标 = _find(v.get("variables") or [], item.get("变量id"), ("id",))
                if 目标 is None:
                    跳过.append("变量「%s」（已经不在卡里）" % 新名)
                else:
                    目标["title"] = 旧名
                    目标["updated_at"] = M.now_iso()
                    放回.append("变量名 →「%s」" % 旧名)
            else:
                目标 = _find(v.get("objects") or [], item.get("对象id"), ("id",))
                if 目标 is None:
                    跳过.append("变量对象「%s」（已经不在卡里）" % 新名)
                else:
                    目标["name"] = 旧名
                    目标["updated_at"] = M.now_iso()
                    放回.append("对象名 →「%s」" % 旧名)
            p = item.get("状态路径")
            if p:
                cur, ok = _走状态(v.get("initial_state") or {}, list(p)[:-1])
                if ok and isinstance(cur, dict) and _改键序(cur, str(p[-1]), 旧名):
                    放回.append("初值那一格 →「%s」" % 旧名)
                else:
                    跳过.append("初值那一格（路径对不上了）")
            p = item.get("Zod路径")
            if p:
                try:
                    root = ZOD.parse(v.get("schema_code") or "")
                    node = ZOD.node_at(root, tuple(list(p)[:-1]))
                    if isinstance(node, ZOD.Obj) and ZOD.rename_key(node, str(p[-1]), 旧名):
                        v["schema_code"] = ZOD.emit(root)
                        放回.append("Zod 字段名 →「%s」" % 旧名)
                except ZOD.ZodError as exc:
                    跳过.append("Zod 字段名（%s）" % exc)
            continue
        if t == "挪组":
            # 批量挪组留下的旧组：**无条件**挪回去（跟上面那条不一样 —— 上面那条是
            # 只在「现在没组」时才认领，因为那是删分组甩出来的）。
            n = 0
            for e in entries_of(raw, must=False):
                if str(e.get("id")) not in (data or {}):
                    continue
                e["group_id"] = (data or {})[str(e.get("id"))]
                e["updated_at"] = M.now_iso()
                n += 1
            if n:
                放回.append("%d 条条目归回原组" % n)
            else:
                跳过.append("原来的那些条目（已经不在卡里）")
            continue
        if t == "schema":
            v = raw.setdefault("variables", OrderedDict())
            try:
                root = ZOD.parse(v.get("schema_code") or "")
                ZOD.set_leaf(root, tuple(item.get("路径") or [])[:-1],
                             (item.get("路径") or [])[-1], data)
                v["schema_code"] = ZOD.emit(root)
                放回.append("Zod 字段「%s」" % ".".join(item.get("路径") or []))
            except ZOD.ZodError as exc:
                跳过.append("Zod 字段「%s」（%s）" % (".".join(item.get("路径") or []), exc))
            continue
        if t == "开场白":
            # 开场白住在 hud/hud.conf.json（spec 里那条只是派生物）—— 得请 opener 动手，
            # 它才知道末尾那三个零宽标记该怎么补。推到 commit 之后再执行，见上面。
            开场白项.append(item)
            continue
        if t == "卡名":
            # 卡名也跨两个文件：spec 的 character.name 是真相，conf 的「卡名」给界面用。
            # spec 这一段跟批走（commit 落盘），conf 那一段推到 commit 之后（见 卡名项）。
            壳 = raw.setdefault("character", OrderedDict())
            旧名 = str((data or {}).get("name") or "")
            壳["name"] = 旧名
            卡名项.append(item)
            放回.append("卡名 →「%s」" % (旧名 or "（空）"))
            continue
        if t == "fields":
            # 改条目时留下的旧值：还原时把字段写回去。
            # 「改」比「删」更隐蔽地丢数据 —— 删了你至少知道没了，改是无声覆盖。
            目标 = _find(entries_of(raw, must=False), str(item.get("谁") or ""), ("id",))
            if 目标 is None:
                跳过.append("条目「%s」已经不在，旧值无处可放" % item.get("谁"))
                continue
            d = data or {}
            n = 0
            for k, v in (d.get("旧") or {}).items():
                目标[k] = v
                n += 1
            for k in (d.get("本就无") or []):
                目标.pop(k, None)
                n += 1
            目标["updated_at"] = M.now_iso()
            放回.append("条目「%s」的 %d 个字段改回旧值"
                        % (目标.get("title") or item.get("谁"), n))
            continue

        rows = _table(raw, t, must=True)
        if not isinstance(rows, list):
            continue
        key = str((data or {}).get("id") or (data or {}).get("name") or "")
        if key and _find(rows, key, ("id", "name", "title")):
            跳过.append("%s「%s」（已经有了，没覆盖）"
                        % (_表中文.get(t, t), key))
            continue
        pos = item.get("位置")
        if isinstance(pos, int) and 0 <= pos <= len(rows):
            rows.insert(pos, data)
        else:
            rows.append(data)
        放回.append("%s「%s」" % (_表中文.get(t, t),
                                (data or {}).get("title") or (data or {}).get("name")
                                or key or "?"))

    if not 放回 and not 开场白项:
        raise ContentError("这一条没有能放回去的东西。%s"
                           % ("（%s）" % "；".join(跳过) if 跳过 else ""))
    commit(spec, raw, out)

    for item in 开场白项:
        # 到这儿 spec 已经落完盘 —— 再动 conf，它写完会顺手把 spec 里那条也灌成一致
        from . import opener as OP
        try:
            OP.改正文(project_of(spec), str((item.get("数据") or {}).get("正文") or ""),
                      out=lambda *a, **k: None)
            放回.append("开场白正文（改回改之前那一版）")
        except Exception as exc:
            跳过.append("开场白（%s）" % exc)

    for item in 卡名项:
        # spec 那一段已落盘；界面配置里那份也改回来，免得两处又对不上
        from . import opener as OP
        p = os.path.join(project_of(spec), "hud", "hud.conf.json")
        if os.path.isfile(p):
            try:
                conf = OP._读json(p) or OrderedDict()
                conf["卡名"] = str((item.get("数据") or {}).get("name") or "")
                OP._写json(p, conf)
            except Exception as exc:
                跳过.append("界面配置里的卡名（%s）" % exc)

    # 这条记录已经用掉了 —— 正常删掉，沙箱里写成墓碑（列表会跳过）
    SB.retire(rec["_路径"])
    return {"放回": 放回, "跳过": 跳过, "说明": rec.get("说明") or ""}


def clear_trash(spec):
    d = trash_dir(spec)
    n = 0
    if os.path.isdir(d):
        for f in list_trash(spec):
            if SB.retire(f["_路径"]):
                n += 1
    return n


# ------------------------------------------------------------------ 条目
def add_entry(spec, 标题, 分组="", 模板="常驻", 正文="", 关键词=None, 位置=None,
              提示=None, out=print):
    raw = load(spec)
    rows = entries_of(raw, must=True)
    名 = str(标题 or "").strip()
    if not 名:
        raise ContentError("标题不能空。")
    模板 = str(模板 or "常驻").strip()
    if 模板 not in 模板表:
        raise ContentError("没有这个模板：%s（有 %s）" % (模板, " / ".join(模板表)))

    分组id = ""
    if str(分组 or "").strip():
        g = _find(groups_of(raw, must=False), 分组, ("id", "name"))
        if g is None:
            raise ContentError("这张卡里没有分组「%s」。先建：python forge.py group %s --新 %s"
                               % (分组, spec, 分组))
        分组id = g.get("id") or ""

    # 继承「这张卡的偏好」，不继承身份与正文。
    # 找一个**真实写过的值**：先看同一档（触发方式相同）的条目，再看其它条目。
    # 不拿「第一条条目」的字段照抄 —— 那条多半这一格是空的，照抄等于把
    # 「没人写过」当成一种写法（新条目就会带着空 agent_selection_hint 出生，AI 读不到它）。
    形 = 模板表[模板]
    同档 = [e for e in rows if (e.get("trigger_mode") or "") == 形.get("trigger_mode")]

    def _偏好(k):
        for 池 in (同档, rows):
            for e in 池:
                if e.get(k) not in (None, "", [], {}):
                    return e[k]
        return None

    new = OrderedDict(_条目默认)
    for k in _继承字段:
        v = _偏好(k)
        if v is not None:
            new[k] = v
    new["id"] = "%s-entry-%s" % (_prefix(spec), M.uuid4hex()[:8])
    new["title"] = 名
    new["group_id"] = 分组id
    new["content"] = str(正文 or "")
    new["keywords"] = [str(x).strip() for x in (关键词 or []) if str(x).strip()]
    new.update(形)
    if 位置 is not None:
        new["position"] = str(位置)
    if 提示:  # 空串当作没给 —— 新建时没有「清空」的意义，空着就留继承来的那份
        new["agent_selection_hint"] = str(提示)
    if 模板 == "关键词" and not new["keywords"]:
        raise ContentError("模板「关键词」要有关键词，否则这条永远不触发。"
                           "加一个：--关键词 判定,掷骰")
    prev = _max_order(rows) + 1
    new["order"] = prev
    new["view_order"] = 0
    new["group_view_order"] = 0
    new["tree_view_order"] = prev
    new["created_at"] = M.now_iso()
    new["updated_at"] = new["created_at"]
    rows.append(M.ordered(new, M.ENTRY_KEYS))
    commit(spec, raw, out)

    out("已加条目「%s」" % 名)
    out("  id      %s" % new["id"])
    out("  模板    %s（触发 %s · 策略 %s · 角色 %s）"
        % (模板, new["trigger_mode"], new["agent_read_strategy"], new["insert_role"]))
    out("  分组    %s" % (分组 or "（未分组）"))
    out("  位置    %s" % (new.get("position") or "（不占提示词位 —— 关键词命中或 AI 选读时才插入）"))
    for w in _entry_worry(new):
        out("  ⚠ %s" % w)
    return new


def _entry_worry(e):
    """新条目上最该提醒的两件事 —— 不拦，只是说。"""
    out = []
    # 开场白条目**本来就不填 position**：它由平台当「开卡第一屏」单独处理，
    # 不走常驻条目那条注入链。骨架、演示卡、艾瑟兰（真在跑的卡）三条都是这么写的。
    # `validate` 一直是这么判的（kind=opening 直接 continue 掉位置这一条）；
    # 这里以前没跟上，于是同一条条目「--改 报缺位置、check 说没问题」——两个口径。
    if (str(e.get("kind") or "") != "opening"
            and e.get("trigger_mode") == "always"
            and not str(e.get("position") or "").strip()):
        out.append("常驻条目必须填 position，否则平台放不进去 —— 用 entry --改 \"标题\" --位置 instructions 补。")
    if e.get("agent_read_strategy") == "keyword" and not (e.get("keywords") or []):
        out.append("策略是 keyword 但没有关键词，这条永远不触发。")
    if e.get("trigger_mode") == "agent_tool" and \
            not str(e.get("agent_selection_hint") or "").strip():
        out.append("这条由 AI 读取，却没写 agent_selection_hint（什么时候读我）——"
                   "AI 只在目录里看到路径、标题、策略、读取提示这四项，"
                   "缺这一项它就不知道何时该读。用 entry --改 \"标题\" --提示 '什么时候读我' 补。")
    if not str(e.get("content") or "").strip():
        out.append("正文还是空的 —— 现在是条占位，别就这么出卡。")
    return out


def find_entry(spec, eid):
    raw = load(spec)
    e = _find(entries_of(raw, must=False), eid, ("id", "title"))
    if e is None:
        raise ContentError("这张卡里没有条目 %s。列出来看：python forge.py entry %s --列"
                           % (eid, spec))
    return raw, e


# 条目上允许「改」的字段。改的是内容与偏好；id / order / kind 是身份与排序，
# 换身份请复制一条再删旧的（沿用同一个 id 会让卡里引用它的地方指向改了意思的那条）。
可改字段 = ("title", "content", "keywords", "trigger_mode", "agent_read_strategy",
            "agent_selection_hint", "position", "insert_role", "content_mode",
            "keyword_condition", "dynamic_mode", "icon_id", "enabled")

# 「改成 None」等于清空的纯文本字段
_文本字段 = ("content", "agent_selection_hint", "position", "insert_role")

_字段中文 = {
    "title": "标题", "content": "正文", "keywords": "关键词",
    "trigger_mode": "触发方式", "agent_read_strategy": "读取策略",
    "agent_selection_hint": "读取提示", "position": "插入位置",
    "insert_role": "插入角色", "content_mode": "内容模式",
    "keyword_condition": "关键词条件", "dynamic_mode": "动态模式",
    "icon_id": "图标", "enabled": "启用",
}


def _切词(s):
    return [x for x in _re.split(r"[,，、;；\s]+", str(s or "")) if x]


def _规整字段值(k, v):
    """把一个待写入字段的值规整成卡里该有的形状。

    `set_entry`（改一条）与 `set_entries_fields`（一次改一批）共用这一份 ——
    两边各写一遍，迟早会有一边漏掉「标题不许空」这类规矩。
    """
    if k == "keywords":
        if isinstance(v, str):
            v = _切词(v)
        return [str(x).strip() for x in (v or []) if str(x).strip()]
    if k == "title":
        v = str(v or "").strip()
        if not v:
            raise ContentError("标题不能改成空的。不要这条就删掉它（--删）。")
        return v
    if k in _文本字段:
        return "" if v is None else str(v)
    if isinstance(v, str):
        return v.strip()
    return v


def _域错(e):
    """这条条目身上「会被平台静默吃掉」的错（只看 error 级）。

    用来做**前后对比**：只拦「因为这次改动而新出现的」错，不翻旧账 ——
    否则一条本来就带小毛病的条目会永远改不动，而那条毛病又不是这次改出来的。
    """
    try:
        # Issue.level 是 "ERROR" / "WARN" / "INFO"（大写）—— 这里比错过一次，
        # 结果集永远是空的，「值域拦截」四个字形同虚设。
        # 返回 code -> 人话：拦下时要打人话，只甩一个 DOMAIN-LEGACY 没人看得懂。
        return {i.code: i.message for i in D.check_entry_domains(e, "")
                if str(i.level).upper() == "ERROR"}
    except Exception:
        return {}


def set_entry(spec, eid, 字段=None, out=print):
    """改一条已有条目的字段（改内容，不改身份）。

    在这之前，「改一条已经存在的条目」只有「删了重建」一条路 —— 那会把 id、
    顺序号、分组位置全换掉，卡里引用旧 id 的地方就断了。而真正天天要改的恰恰
    是正文：先落一个占位、想清楚了再填。

    值域字段（触发方式 / 读取策略 / 内容模式 …）改完当场比一遍，**只拦这次
    改动新引入的静默降级**；拦下就整个不落盘，旧值一个字节都没动。
    """
    raw, e = find_entry(spec, eid)
    字段 = dict(字段 or {})
    if str(e.get("kind") or "") == "opening" and "content" in 字段:
        raise ContentError(
            "这条是开场白（kind=opening），正文不走 `--改`：\n"
            "  · 有界面层的工程里，它的真源是 hud/hud.conf.json，改 spec 里这条是**改了白改**；\n"
            "  · 它的正文末尾挂着三个零宽标记（建卡界面的触发开关），`--改` 会把标记一起抹掉 ——\n"
            "    而且一个字都不报，导进 ElecKoi 才发现建卡界面没出来。\n"
            "  用这个： python forge.py opener <工程 或 spec> --正文@新正文.txt\n"
            "  （标记补齐、方案正文同步、写回都归它管。标题 / 关键词这些非正文字段，--改 照旧能用。）")
    if not 字段:
        raise ContentError(
            "没说改什么。用法：\n"
            "  python forge.py entry <spec> --改 \"条目标题\" --正文 \"…\" [--标题 \"…\"]\n"
            "        [--关键词 a,b] [--提示 \"什么时候读我\"] [--模板 常驻|必读|关键词|选读]\n"
            "  能改的字段：%s" % "、".join(可改字段))
    无名 = [k for k in 字段 if k not in 可改字段]
    if 无名:
        raise ContentError(
            "这些字段不给改：%s\n  能改的：%s\n"
            "  id / order / kind 是身份与排序 —— 要换身份就复制一条再删旧的。"
            % ("、".join(无名), "、".join(可改字段)))

    前 = _域错(e)
    改, 旧, 本就无 = OrderedDict(), OrderedDict(), []
    for k, v in 字段.items():
        v = _规整字段值(k, v)

        if k not in e:
            本就无.append(k)
        elif e.get(k) == v:
            continue
        else:
            旧[k] = M.plain(e.get(k))
        e[k] = v
        改[k] = v

    if not 改:
        out("一个字段都没变（值跟现在一样）。")
        return {}

    后 = _域错(e)
    新错 = [m for c, m in 后.items() if c not in 前]
    if 新错:
        for k, v in 旧.items():
            e[k] = v
        for k in 本就无:
            e.pop(k, None)
        raise ContentError(
            "这么改会被平台静默吃掉，一个字没落盘：\n%s\n"
            "  看真值域表：python forge.py domains" % "\n".join("  · " + m for m in 新错))

    e["updated_at"] = M.now_iso()
    put_trash(spec, "条目字段", "改了条目「%s」的 %s"
             % (e.get("title") or e.get("id"), "、".join(_字段中文.get(k, k) for k in 改)),
             [OrderedDict([("表", "fields"), ("谁", e.get("id")),
                           ("数据", {"旧": 旧, "本就无": 本就无})])])
    commit(spec, raw, out)

    out("已改条目「%s」" % (e.get("title") or e.get("id")))
    out("  %s" % "、".join(_字段中文.get(k, k) for k in 改))
    for w in _entry_worry(e):
        out("  ⚠ %s" % w)
    trash_note(out)
    return {"id": e.get("id"), "改了": list(改)}


def del_entry(spec, eid, out=print):
    raw, e = find_entry(spec, eid)
    rows = entries_of(raw)
    i = rows.index(e)
    put_trash(spec, "条目", "删了条目「%s」" % (e.get("title") or e.get("id")),
             [OrderedDict([("表", "entries"), ("位置", i),
                           ("数据", M.plain(e))])])
    rows.pop(i)
    commit(spec, raw, out)
    out("已删条目「%s」（%s 字）" % (e.get("title") or "", len(str(e.get("content") or ""))))
    trash_note(out)
    return {"id": e.get("id"), "标题": e.get("title") or ""}


# ---------------------------------------------------------- 批量（条目）
def _认多条(raw, 谁列表, 表="条目"):
    """一次认出多条 —— 有认不出的就整批停下，**绝不半个批次落盘**。

    「一部分成功」是最难收拾的状态：你以为挪了 10 条，其实进了 6 条，还得自己
    去数哪 6 条。所以这里宁可整批不做。
    """
    rows = entries_of(raw, must=False)
    找, 缺 = [], []
    for 谁 in (谁列表 or []):
        e = _find(rows, 谁, ("id", "title"))
        if e is None:
            缺.append(str(谁))
        elif e not in 找:
            找.append(e)
    if 缺:
        raise ContentError("没有这些%s：%s\n  一条都没动。看看 id / 标题："
                           "python forge.py entry <spec> --列" % (表, "、".join(缺)))
    if not 找:
        raise ContentError("没给要动哪些%s。" % 表)
    return 找


def move_entries(spec, 谁列表, 分组, out=print):
    """批量挪组 —— 一次落盘、一条回收记录（不是 N 条）。"""
    raw = load(spec)
    找 = _认多条(raw, 谁列表)
    gid = ""
    if str(分组 or "").strip():
        g = _find(groups_of(raw, must=False), 分组, ("id", "name"))
        if g is None:
            raise ContentError("没有分组「%s」。建它：python forge.py group <spec> --新 %s"
                               % (分组, 分组))
        gid = g.get("id") or ""
    旧 = OrderedDict()
    for e in 找:
        if str(e.get("group_id") or "") != gid:
            旧[str(e.get("id"))] = e.get("group_id") or ""
        e["group_id"] = gid
        e["updated_at"] = M.now_iso()
    if 旧:
        # 跟「删分组时把条目甩到未分组」用的不是同一种记录：那种只在条目**现在没组**
        # 时才认领，这里要能无条件挪回去，否则批量挪组撤不回来。
        put_trash(spec, "条目", "%d 条挪到「%s」" % (len(找), 分组 or "未分组"),
                  [OrderedDict([("表", "挪组"), ("数据", 旧)])])
    commit(spec, raw, out)
    out("已把 %d 条挪到 %s" % (len(找), 分组 or "（未分组）"))
    for e in 找:
        out("  · %s" % (e.get("title") or e.get("id")))
    if 旧:
        trash_note(out)
    else:
        out("（这 %d 条本来就在那儿）" % len(找))
    return 找


def set_entries_enabled(spec, 谁列表, 启用, out=print):
    """批量启用 / 停用。停用的条目**留在卡里但不生效**（从酒馆收来的卡常见）。"""
    raw = load(spec)
    找 = _认多条(raw, 谁列表)
    项 = []
    for e in 找:
        老 = bool(e.get("enabled", True))
        if 老 != bool(启用):
            项.append(OrderedDict([("表", "fields"), ("谁", e.get("id")),
                                   ("数据", {"旧": {"enabled": 老}, "本就无": []})]))
        e["enabled"] = bool(启用)
        e["updated_at"] = M.now_iso()
    if 项:
        put_trash(spec, "条目字段", "%d 条%s" % (len(项), "启用" if 启用 else "停用"), 项)
    commit(spec, raw, out)
    out("已%s %d 条" % ("启用" if 启用 else "停用", len(找)))
    for e in 找:
        out("  · %s" % (e.get("title") or e.get("id")))
    if 项:
        trash_note(out)
    return 找


def set_entries_fields(spec, 谁列表, 字段, out=print):
    """给一批条目同时改同一组字段 —— 与 set_entry 同一套规整与值域拦截。

    值域按**批次**判定：只要有一条改了会被平台静默吃掉，整批一个字都不落盘。
    宁可整批不做，也不做「一半成功」—— 你以为改了 10 条、其实成了 6 条，
    还得自己回去数哪 6 条，那才是最难收拾的状态。
    """
    raw = load(spec)
    找 = _认多条(raw, 谁列表)
    字段 = dict(字段 or {})
    if not 字段:
        raise ContentError(
            "没说改什么。用法：\n"
            "  python forge.py entry <spec> --改 \"甲\" [\"乙\" …] --正文 \"…\" [--标题 \"…\"]\n"
            "        [--关键词 a,b] [--提示 \"什么时候读我\"] [--模板 常驻|必读|关键词|选读]\n"
            "  能改的字段：%s" % "、".join(可改字段))
    无名 = [k for k in 字段 if k not in 可改字段]
    if 无名:
        raise ContentError(
            "这些字段不给改：%s\n  能改的：%s\n"
            "  id / order / kind 是身份与排序 —— 要换身份就复制一条再删旧的。"
            % ("、".join(无名), "、".join(可改字段)))
    if "content" in 字段:
        开场 = [e for e in 找 if str(e.get("kind") or "") == "opening"]
        if 开场:
            raise ContentError(
                "这批里有开场白条目（%s）—— 正文不走 `--改`：\n"
                "  · 有界面层的工程里，它的真源是 hud/hud.conf.json，改 spec 里这条是**改了白改**；\n"
                "  · 它的正文末尾挂着三个零宽标记，`--改` 会一起抹掉，而且一个字都不报。\n"
                "  用 python forge.py opener <工程 或 spec> --正文@新正文.txt\n"
                "  （只改别的字段就把正文去掉，那些不受影响。）"
                % "、".join((e.get("title") or e.get("id")) for e in 开场[:3]))

    规整 = OrderedDict((k, _规整字段值(k, v)) for k, v in 字段.items())
    前 = {id(e): _域错(e) for e in 找}
    批 = []
    for e in 找:
        旧, 本就无, 本 = OrderedDict(), [], OrderedDict()
        for k, v in 规整.items():
            if k not in e:
                本就无.append(k)
            elif e.get(k) == v:
                continue
            else:
                旧[k] = M.plain(e.get(k))
            e[k] = v
            本[k] = v
        if 本:
            批.append((e, 本, 旧, 本就无))
    if not 批:
        out("这些字段的值跟现在一样，一条都没改。")
        return []

    新错 = []
    for e, 本, 旧, 本就无 in 批:
        后 = _域错(e)
        新错 += [m for c, m in 后.items() if c not in 前[id(e)]]
    if 新错:
        for e, 本, 旧, 本就无 in 批:
            for k, v in 旧.items():
                e[k] = v
            for k in 本就无:
                e.pop(k, None)
        raise ContentError(
            "这么改会被平台静默吃掉，一个字没落盘：\n%s\n"
            "  看真值域表：python forge.py domains" % "\n".join("  · " + m for m in 新错))

    汉 = "、".join(_字段中文.get(k, k) for k in 规整)
    动过 = {id(e) for e, _, _, _ in 批}
    项 = []
    for e, 本, 旧, 本就无 in 批:
        e["updated_at"] = M.now_iso()
        项.append(OrderedDict([("表", "fields"), ("谁", e.get("id")),
                               ("数据", {"旧": 旧, "本就无": 本就无})]))
    # 一条回收记录装全部：`trash --还原 N` 一次把这一批的旧值全放回去
    put_trash(spec, "条目字段", "%d 条改了 %s" % (len(批), 汉), 项)
    commit(spec, raw, out)
    out("已改 %d 条的 %s" % (len(批), 汉))
    for e, 本, 旧, 本就无 in 批:
        out("  · %s" % (e.get("title") or e.get("id")))
    没动 = [e for e in 找 if id(e) not in 动过]
    if 没动:
        out("  （另有 %d 条这些字段本来就是那个值，没动）" % len(没动))
    trash_note(out)
    return [e for e, _, _, _ in 批]


def del_entries(spec, 谁列表, out=print):
    """批量删 —— 一条回收记录装全部，`trash --还原 N` 一次就能全捞回来。

    位置按**从小到大**记（还原是照记录顺序逐个插回原位置），真正删的时候反过来
    从后往前删 —— 否则删掉靠前的那条，后面记的位置全错一格。
    """
    raw = load(spec)
    找 = _认多条(raw, 谁列表)
    rows = entries_of(raw)
    带位 = sorted(((rows.index(e), e) for e in 找), key=lambda x: x[0])
    项 = [OrderedDict([("表", "entries"), ("位置", i), ("数据", M.plain(e))])
          for i, e in 带位]
    put_trash(spec, "条目", "删了 %d 条（%s）"
              % (len(找), "、".join((e.get("title") or "?") for e in 找[:4])
                 + ("…" if len(找) > 4 else "")), 项)
    for _, e in reversed(带位):
        rows.pop(rows.index(e))
    commit(spec, raw, out)
    out("已删 %d 条" % len(找))
    for _, e in 带位:
        out("  · %s（%s 字）" % (e.get("title") or e.get("id"),
                               len(str(e.get("content") or ""))))
    trash_note(out)
    return [e for _, e in 带位]


def dup_entries(spec, 谁列表, 标题=None, 到=None, out=print):
    """复制条目 —— 可以一次一串（跟 `--挪 / --删 / --启用` 一个规矩）。

    · 复制出来的那条**紧跟在原件后面**（顺序号仍在末尾），默认叫「原名（副本）」。
    · `--到 分组` 能让副本直接落进指定分组；不给就跟着原件待在同一个组。
    · 复制是「加一条」，跟 `--新` 一样**不写回收记录** —— 不想要了 `--删` 掉它。
    · 一张卡只有一条开场白，所以开场白条目不许复制。
    """
    raw = load(spec)
    找 = _认多条(raw, 谁列表)
    开场 = [e for e in 找 if str(e.get("kind") or "") == "opening"]
    if 开场:
        raise ContentError(
            "开场白条目不能复制（%s）—— 一张卡只有一条开场白。\n"
            "  想多一个开场方案：python forge.py opener <工程 或 spec> --列"
            % "、".join((e.get("title") or e.get("id")) for e in 开场[:3]))
    标题 = str(标题 or "").strip()
    if 标题 and len(找) > 1:
        raise ContentError(
            "一次复制多条时 --标题 只能给一条用。\n"
            "  想给它们都起名：一条条复制，或复制完用 --改 批量改标题。")
    gid = None
    if str(到 or "").strip():
        g = _find(groups_of(raw, must=False), 到, ("id", "name"))
        if g is None:
            raise ContentError("没有分组「%s」。建它：python forge.py group <spec> --新 %s"
                               % (到, 到))
        gid = g.get("id") or ""
    rows = entries_of(raw)
    新们 = []
    for e in 找:
        new = OrderedDict((k, v) for k, v in e.items())
        new["id"] = "%s-entry-%s" % (_prefix(spec), M.uuid4hex()[:8])
        new["title"] = 标题 or ("%s（副本）" % (e.get("title") or ""))
        new["order"] = _max_order(rows) + 1
        new["tree_view_order"] = new["order"]
        new["created_at"] = M.now_iso()
        new["updated_at"] = new["created_at"]
        if gid is not None:
            new["group_id"] = gid
        rows.insert(rows.index(e) + 1, M.ordered(new, M.ENTRY_KEYS))
        新们.append(new)
    commit(spec, raw, out)
    out("已复制 %d 条" % len(新们))
    for 源, new in zip(找, 新们):
        out("  · %s -> 「%s」%s" % (源.get("title") or 源.get("id"), new["title"],
                                 "（在「%s」下）" % 到 if gid is not None else ""))
    out("  （顺着原件排 · 顺序号在末尾 · 不要了就 python forge.py entry <spec> --删 \"%s\"）"
        % (新们[0]["title"] if 新们 else ""))
    return 新们


def dup_entry(spec, eid, 标题=None, out=print):
    """留一个单条入口给工作台用（`ui.py` 的「复制」按钮）。"""
    return dup_entries(spec, [eid], 标题=标题, out=out)[0]


def move_entry(spec, eid, 分组, out=print):
    raw, e = find_entry(spec, eid)
    if str(分组 or "").strip():
        g = _find(groups_of(raw, must=False), 分组, ("id", "name"))
        if g is None:
            raise ContentError("没有分组「%s」。" % 分组)
        e["group_id"] = g.get("id") or ""
    else:
        e["group_id"] = ""
    e["updated_at"] = M.now_iso()
    commit(spec, raw, out)
    out("已把「%s」挪到 %s" % (e.get("title") or "", 分组 or "（未分组）"))
    return e


# ------------------------------------------------------------------ 分组
def add_group(spec, 名, 父="", out=print):
    raw = load(spec)
    rows = groups_of(raw, must=True)
    名 = str(名 or "").strip()
    if not 名:
        raise ContentError("分组名不能空。")
    if _find(rows, 名, ("id", "name")):
        raise ContentError("已经有分组「%s」了。" % 名)
    父id = ""
    if str(父 or "").strip():
        g = _find(rows, 父, ("id", "name"))
        if g is None:
            raise ContentError("没有父分组「%s」。" % 父)
        父id = g.get("id") or ""
    g = OrderedDict([
        ("id", "%s-grp-%s" % (_prefix(spec), M.uuid4hex()[:8])),
        ("name", 名), ("parent_id", 父id), ("order", _max_order(rows) + 1),
        ("tree_view_order", _max_order(rows) + 1),
        ("created_at", M.now_iso()), ("updated_at", M.now_iso()),
    ])
    rows.append(M.ordered(g, M.GROUP_KEYS))
    commit(spec, raw, out)
    out("已加分组「%s」%s" % (名, ("（父：%s）" % 父) if 父 else ""))
    return g


def rename_group(spec, 谁, 新名, out=print):
    raw = load(spec)
    g = _find(groups_of(raw, must=False), 谁, ("id", "name"))
    if g is None:
        raise ContentError("没有分组「%s」。" % 谁)
    旧 = g.get("name") or ""
    g["name"] = str(新名 or "").strip()
    if not g["name"]:
        raise ContentError("新名字不能空。")
    g["updated_at"] = M.now_iso()
    commit(spec, raw, out)
    out("分组「%s」改名成「%s」" % (旧, g["name"]))
    return g


def del_group(spec, 谁, out=print):
    raw = load(spec)
    rows = groups_of(raw)
    g = _find(rows, 谁, ("id", "name"))
    if g is None:
        raise ContentError("没有分组「%s」。" % 谁)
    kids = [x for x in groups_of(raw, must=False) if x.get("parent_id") == g.get("id")]
    if kids:
        raise ContentError("分组「%s」下面还有 %d 个子分组，先删子分组。"
                           % (g.get("name") or "", len(kids)))
    moved = [e for e in entries_of(raw, must=False) if e.get("group_id") == g.get("id")]
    项 = [OrderedDict([("表", "groups"), ("位置", rows.index(g)),
                       ("数据", M.plain(g))])]
    if moved:
        # 把「谁原来在这个组里」也记下来，不然还原了组、条目却留在未分组
        项.append(OrderedDict([
            ("表", "regroup"),
            ("数据", OrderedDict((str(e.get("id")), g.get("id")) for e in moved)),
        ]))
    put_trash(spec, "分组", "删了分组「%s」" % (g.get("name") or ""), 项)
    rows.pop(rows.index(g))
    for e in moved:
        e["group_id"] = ""
        e["updated_at"] = M.now_iso()
    commit(spec, raw, out)
    out("已删分组「%s」" % (g.get("name") or ""))
    trash_note(out)
    if moved:
        out("  里面 %d 条条目没删，挪到「未分组」了（删分组不是删内容）" % len(moved))
    return g


# ------------------------------------------------------------------ 变量
def _get_vars(raw, must=True):
    v = _vars(raw, must=must)
    if v is None:
        return None
    v.setdefault("objects", [])
    v.setdefault("variables", [])
    v.setdefault("initial_state", OrderedDict())
    if not isinstance(v.get("initial_state"), dict):
        v["initial_state"] = OrderedDict()
    return v


def add_object(spec, 名, 父="", 说明="", 更新规则="", out=print):
    raw = load(spec)
    v = _get_vars(raw)
    objs = v["objects"]
    名 = str(名 or "").strip()
    if not 名:
        raise ContentError("对象名不能空。")
    if _find(objs, 名, ("id", "name")):
        raise ContentError("已经有对象「%s」了。" % 名)
    父id = ""
    父路径 = []
    if str(父 or "").strip():
        p = _find(objs, 父, ("id", "name"))
        if p is None:
            raise ContentError("没有父对象「%s」。" % 父)
        父id = p.get("id") or ""
        父路径 = _对象路径(v, p)
        if not _可写状态(v["initial_state"], 父路径):
            哪, 什么 = _挡路的(v["initial_state"], 父路径)
            raise ContentError(
                "父对象「%s」在 initial_state 里对不上号：%s 那一格是%s。\n"
                "  对象表说它是一层能放子对象的对象，初值那边却不是 —— 形状是卡自己写的，"
                "工具不猜。去「原文」页把那一格改成一层对象再来。"
                % (父, 哪, _形状(什么)))
    o = OrderedDict([
        ("id", "obj-%s-%s" % (_prefix(spec), M.uuid4hex()[:8])),
        ("name", 名), ("parent_id", 父id), ("enabled", True),
        ("description", str(说明 or "")), ("update_rule", str(更新规则 or "")),
        ("dynamic_key", False), ("order", _max_order(objs) + 1),
        ("tree_view_order", _max_order(objs) + 1),
        ("created_at", M.now_iso()), ("updated_at", M.now_iso()),
    ])
    objs.append(M.ordered(o, M.VAR_OBJECT_KEYS))

    说 = []
    节点 = v["initial_state"]
    for seg in 父路径:
        节点 = 节点.setdefault(seg, OrderedDict())
    if 名 not in 节点:
        节点[名] = OrderedDict()
        说.append("initial_state 里补上「%s: {}」" % ".".join(父路径 + [名]))
    try:
        root = ZOD.parse(v.get("schema_code") or "")
        _节点 = root
        _可 = True
        for seg in 父路径:
            if isinstance(_节点, ZOD.Obj) and isinstance(_节点.kids.get(seg), ZOD.Obj):
                _节点 = _节点.kids[seg]
            else:
                _可 = False
                break
        if _可:
            if 名 not in _节点.kids:
                ZOD.set_leaf(root, tuple(父路径), 名, "z.object({})")
                v["schema_code"] = ZOD.emit(root)
                说.append("Zod 里补上「%s: z.object({})」" % ".".join(父路径 + [名]))
            else:
                说.append("Zod 里本来就有「%s」，原样留着没动" % 名)
        else:
            说.append("Zod 里找不到「%s」那层（形状对不上），没动它" % ".".join(父路径))
    except ZOD.ZodError as exc:
        说.append("Zod 那段工具认不出（%s），没动它 —— 记得手补一行" % exc)
    commit(spec, raw, out)
    out("已加变量对象「%s」%s" % (名, ("（父：%s）" % 父) if 父 else ""))
    for s in 说:
        out("  · %s" % s)
    return o


def _初值(类型, 值):
    t = str(类型 or "string").lower()
    if 值 is None:
        return 默认初值.get(t, "")
    if t == "boolean":
        if isinstance(值, bool):
            return 值
        s = str(值).strip().lower()
        return s in ("1", "true", "yes", "y", "是", "真", "on")
    if t == "number":
        s = str(值).strip()
        try:
            return int(s)
        except ValueError:
            try:
                return float(s)
            except ValueError:
                raise ContentError("«%s» 不是个数 —— 类型是 number，初值得是数字。" % 值)
    if t == "array":
        if isinstance(值, list):
            return 值
        s = str(值).strip()
        if not s:
            return []
        if s.startswith("["):
            try:
                return json.loads(s)
            except Exception:
                pass
        return [x.strip() for x in s.replace("，", ",").replace("、", ",").split(",")
                if x.strip()]
    if t == "object":
        if isinstance(值, dict):
            return 值
        s = str(值).strip()
        if s.startswith("{"):
            try:
                return json.loads(s)
            except Exception:
                pass
        raise ContentError("类型是 object，初值得写成 JSON，比如 --初值 '{\"a\":1}'")
    return str(值)


def add_variable(spec, 对象, 标题, 类型="string", 初值=None, 说明="", 更新规则="",
                 out=print):
    raw = load(spec)
    v = _get_vars(raw)
    o = _find(v["objects"], 对象, ("id", "name"))
    if o is None:
        raise ContentError("没有变量对象「%s」。先建：python forge.py var %s --新对象 %s"
                           % (对象, spec, 对象))
    标 = str(标题 or "").strip()
    if not 标:
        raise ContentError("变量名不能空。")
    t = str(类型 or "string").strip().lower()
    if t not in 变量类型表:
        raise ContentError("没有这个类型：%s（有 %s）" % (类型, " / ".join(变量类型表)))
    同对象 = [x for x in v["variables"] if x.get("object_id") == o.get("id")]
    if any(str(x.get("title") or "") == 标 for x in 同对象):
        raise ContentError("对象「%s」里已经有变量「%s」了。" % (o.get("name"), 标))
    值 = _初值(t, 初值)
    # default_value 在卡里是个**字符串**：字符串原样写，其余转成 JSON 文本。
    # （照真实卡的样子来的：布尔写 'false'、数字写 '1'、数组写 '[]'、字符串就写原话）
    存档值 = 值 if isinstance(值, str) else json.dumps(值, ensure_ascii=False)

    item = OrderedDict([
        ("id", "variable-%s-%s" % (_prefix(spec), M.uuid4hex()[:8])),
        ("title", 标), ("object_id", o.get("id")), ("enabled", True), ("type", t),
        ("default_value", 存档值), ("description", str(说明 or "")),
        ("update_rule", str(更新规则 or "")), ("read_mode", "on_demand"),
        ("order", _max_order(同对象) + 1), ("tree_view_order", _max_order(同对象) + 1),
        ("created_at", M.now_iso()), ("updated_at", M.now_iso()),
    ])
    v["variables"].append(M.ordered(item, M.VAR_ITEM_KEYS))

    # 第二处：初值。先证明这条路径真的是一层层对象，再动笔 ——
    # 半路撞上「不是对象」的值就当场停，绝不往旁边那层乱写。
    路径 = _对象路径(v, o)
    状态 = v["initial_state"]
    if not _可写状态(状态, 路径):
        哪, 什么 = _挡路的(状态, 路径)
        raise ContentError(
            "对象「%s」在 initial_state 里对不上号：%s 那一格是%s，不是一层对象。\n"
            "  对象表说「%s」能放变量，初值那边却不是 —— 形状是卡自己写的，工具不猜"
            "（乱写会把值塞到旁边那一层，而且不报错）。\n"
            "  两个办法：① 去「原文」页把 initial_state 那格改成一层对象；"
            "② 或者把这个变量加到别的对象下。"
            % (o.get("name"), 哪, _形状(什么), ".".join(路径) or "(根)"))
    节点 = 状态
    for seg in 路径:
        节点 = 节点.setdefault(seg, OrderedDict())
    节点[标] = 值
    说 = ["initial_state 里写上「%s = %s」"
          % (".".join(路径 + [标]), json.dumps(值, ensure_ascii=False))]

    # 第三处：Zod
    try:
        root = ZOD.parse(v.get("schema_code") or "")
        层 = root
        可到 = True
        for seg in 路径:
            kid = 层.kids.get(seg) if isinstance(层, ZOD.Obj) else None
            if kid is None:
                可到 = False
                break
            层 = kid
        if 可到 and isinstance(层, ZOD.Obj) and 标 in 层.kids:
            说.append("Zod 里本来就有「%s」，原样留着没动（要改表达式去「原文」页）" % 标)
        else:
            ZOD.set_leaf(root, tuple(路径), 标, ZOD.expr_for(t, 值))
            v["schema_code"] = ZOD.emit(root)
            说.append("Zod 里补上「%s: %s」" % (标, ZOD.expr_for(t, 值)))
    except ZOD.ZodError as exc:
        说.append("⚠ Zod 那段工具认不出（%s），只写了另外两处 —— 手补一行，"
                  "否则运行时会静默丢掉这个字段" % exc)
    commit(spec, raw, out)
    out("已加变量「%s.%s」（%s）" % (o.get("name"), 标, t))
    for s in 说:
        out("  · %s" % s)
    return item


def _对象路径(v, o):
    """从根到某个对象的名字路径（跟着 parent_id 往上走）。"""
    by_id = {x.get("id"): x for x in v.get("objects") or []}
    names = []
    cur = o
    seen = set()
    while cur is not None and cur.get("id") not in seen:
        seen.add(cur.get("id"))
        names.append(cur.get("name") or "")
        cur = by_id.get(cur.get("parent_id") or "")
    return list(reversed([n for n in names if n]))


def _形状(v):
    if isinstance(v, bool):
        return "布尔"
    if isinstance(v, dict):
        return "一层对象"
    if isinstance(v, list):
        return "数组"
    if isinstance(v, (int, float)):
        return "数字"
    if isinstance(v, str):
        return "文本"
    return "空"


def _走状态(st, 路径):
    """按路径取初值那一格。返回 (值, 找到没)。"""
    cur = st
    for seg in 路径:
        if not isinstance(cur, dict) or seg not in cur:
            return None, False
        cur = cur[seg]
    return cur, True


def _可写状态(st, 路径):
    """这条路径能不能写进去：一路都得是「一层对象」。

    中间缺的那几层可以现建（建出来是空的，后面自然也就没有），但**半路撞上一个
    不是对象的值**就没法写了 —— 比如对象表说「背包」是一层，初值那边它却是个数组。
    这种不一致是卡自己写出来的形状，工具不猜，照实说。
    """
    cur = st
    for seg in 路径:
        if not isinstance(cur, dict):
            return False
        if seg not in cur:
            return True
        cur = cur[seg]
    return isinstance(cur, dict)


def _挡路的(st, 路径):
    """写不进去时，指出是哪一格挡住的（报错要说到点上）。"""
    cur = st
    for i, seg in enumerate(路径):
        if not isinstance(cur, dict):
            return ".".join(路径[:i]) or "(根)", cur
        if seg not in cur:
            return None, None
        cur = cur[seg]
    return ".".join(路径), cur


def _找状态格子(st, 路径, 键):
    """读的时候不必这么严：**存不存在**说了算，两条候选里挑真的那条。

    候选甲是对象表直读（艾瑟兰那种规规矩矩的卡走这条）；候选乙是「去掉对象自己
    那一层」（手写的卡里偶尔有「列表对象」——对象名就是数据键，不额外加一层）。
    只用来**读和删**，选中哪条都只动真找到的那一格。
    """
    候选 = [list(路径) + [键]]
    if len(路径) >= 2:
        候选.append(list(路径[:-1]) + [键])
    for p in 候选:
        cur, ok = _走状态(st, p[:-1])
        if ok and isinstance(cur, dict) and p[-1] in cur:
            return p, cur
    return None, None


def _find_variable(raw, 谁):
    v = _get_vars(raw, must=False)
    if not v:
        raise ContentError("这张卡没有变量层。")
    rows = v.get("variables") or []
    e = _find(rows, 谁, ("id", "title"))
    if e is None and "." in str(谁):
        对象, 标 = str(谁).rsplit(".", 1)
        o = _find(v.get("objects") or [], 对象, ("id", "name"))
        if o is not None:
            e = _find([x for x in rows if x.get("object_id") == o.get("id")],
                      标, ("title", "id"))
    if e is None:
        raise ContentError("没有变量「%s」。" % 谁)
    return v, e


def del_variable(spec, 谁, out=print):
    raw = load(spec)
    v, item = _find_variable(raw, 谁)
    o = _find(v.get("objects") or [], item.get("object_id"), ("id",))
    名 = (o or {}).get("name") or ""
    标 = item.get("title") or ""
    路径 = _对象路径(v, o) if o else []
    键 = str(item.get("title") or "")
    项 = [OrderedDict([("表", "variables"), ("位置", v["variables"].index(item)),
                       ("数据", M.plain(item))])]
    st = v.get("initial_state") or {}
    # 读的时候靠**存不存在**认路径：对象表直读那条找不到，就试「去掉对象自己那层」
    真路径, 容器 = _找状态格子(st, 路径, 键)
    if 真路径 is not None:
        项.append(OrderedDict([("表", "initial_state"), ("路径", 真路径),
                               ("数据", 容器.pop(键))]))
    if 真路径 is not None:
        try:
            root = ZOD.parse(v.get("schema_code") or "")
            node = root
            存在 = True
            for seg in 真路径[:-1]:
                node = node.kids.get(seg) if isinstance(node, ZOD.Obj) else None
                if node is None:
                    存在 = False
                    break
            if 存在 and isinstance(node, ZOD.Obj) and 真路径[-1] in node.kids:
                表达式 = node.kids[真路径[-1]].code
                ZOD.drop(root, tuple(真路径[:-1]), 真路径[-1])
                v["schema_code"] = ZOD.emit(root)
                项.append(OrderedDict([("表", "schema"), ("路径", 真路径),
                                       ("数据", 表达式)]))
        except ZOD.ZodError:
            pass

    v["variables"].pop(v["variables"].index(item))
    put_trash(spec, "变量", "删了变量「%s.%s」" % (名, 标), 项)
    commit(spec, raw, out)
    out("已删变量「%s.%s」" % (名, 标))
    trash_note(out)
    out("  三处一起撤了：画面板 · 初值 · Zod%s" % ("（Zod 那段认不出，没动）"
                                                   if len(项) < 3 else ""))
    if 真路径 is None:
        out("  注意：初值与 Zod 里没找到对应的那一格（形状和对象表对不上），只撤了变量条目本身。")
    return item


def del_variables(spec, 谁列表, out=print):
    """批量删变量 —— 一条回收记录装全部，`trash --还原 N` 一次全捞回来。

    每个变量都牵着三处（画面板 + 初值那格 + Zod 那个字段），所以这里是三处 × N。
    位置按**从小到大**记（还原是照记录顺序逐个插回原位置），真删时从后往前删 ——
    否则删掉靠前那个，后面记的位置全错一格。
    有认不出的名字就**整批停下、一个都不删**。
    """
    raw = load(spec)
    v = _get_vars(raw, must=False)
    if not v:
        raise ContentError("这张卡没有变量层。")
    找, 缺 = [], []
    for 谁 in (谁列表 or []):
        try:
            _, item = _find_variable(raw, 谁)
        except ContentError:
            缺.append(str(谁))
            continue
        if item not in 找:
            找.append(item)
    if 缺:
        raise ContentError("没有这些变量：%s\n  一个都没动。看看有哪些："
                           "python forge.py var <spec> --列" % "、".join(缺))
    if not 找:
        raise ContentError("没给要删哪些变量。")

    rows = v["variables"]
    带位 = sorted(((rows.index(item), item) for item in 找), key=lambda x: x[0])
    st = v.get("initial_state") or {}
    项, 名们 = [], []
    for i, item in 带位:
        o = _find(v.get("objects") or [], item.get("object_id"), ("id",))
        名 = (o or {}).get("name") or ""
        标 = item.get("title") or ""
        名们.append("%s.%s" % (名, 标))
        键 = str(item.get("title") or "")
        项.append(OrderedDict([("表", "variables"), ("位置", i),
                               ("数据", M.plain(item))]))
        路径 = _对象路径(v, o) if o else []
        # 读的时候靠**存不存在**认路径：对象表直读那条找不到，就试「去掉对象自己那层」
        真路径, 容器 = _找状态格子(st, 路径, 键)
        if 真路径 is not None:
            项.append(OrderedDict([("表", "initial_state"), ("路径", 真路径),
                                   ("数据", 容器.pop(键))]))
        if 真路径 is not None:
            try:
                root = ZOD.parse(v.get("schema_code") or "")
                node = root
                存在 = True
                for seg in 真路径[:-1]:
                    node = node.kids.get(seg) if isinstance(node, ZOD.Obj) else None
                    if node is None:
                        存在 = False
                        break
                if 存在 and isinstance(node, ZOD.Obj) and 真路径[-1] in node.kids:
                    表达式 = node.kids[真路径[-1]].code
                    ZOD.drop(root, tuple(真路径[:-1]), 真路径[-1])
                    v["schema_code"] = ZOD.emit(root)
                    项.append(OrderedDict([("表", "schema"), ("路径", 真路径),
                                           ("数据", 表达式)]))
            except ZOD.ZodError:
                pass

    for i, item in reversed(带位):
        rows.pop(rows.index(item))

    标题 = "、".join(名们[:4]) + ("…" if len(名们) > 4 else "")
    put_trash(spec, "变量", "删了 %d 个变量（%s）" % (len(找), 标题), 项)
    commit(spec, raw, out)
    out("已删 %d 个变量" % len(找))
    for 名 in 名们:
        out("  · %s" % 名)
    缺处 = 3 * len(找) - len(项)
    if 缺处:
        out("  注意：有 %d 处（初值 / Zod）没找着对应的格子，只撤了能找到的。" % 缺处)
    else:
        out("  三处一起撤了：画面板 · 初值 · Zod")
    trash_note(out)
    return [item for _, item in 带位]


# ------------------------------------------------------ 改名（变量 / 变量对象）
def _改键序(d, 旧, 新):
    """把一个 dict 里的键改名，**原地保序** —— 键换了，位置不换。"""
    if 旧 not in d or 旧 == 新:
        return False
    新表 = OrderedDict()
    for k, val in d.items():
        新表[新 if k == 旧 else k] = val
    d.clear()
    d.update(新表)
    return True


def _提到(raw, 名字):
    """条目正文 / 读取提示里提到这个名字的地方 —— **只数，不改**。

    正文是人写的句子。工具不知道那个词是「这个变量」还是恰好同字的常用说法
    （变量叫「名」时会命中一大片）。所以位置如实报出来，改不改由人定 ——
    悄悄替换正文才是真正会咬人的那种「贴心」。
    """
    hits = []
    for e in entries_of(raw, must=False):
        for 域, 汉 in (("content", "正文"), ("agent_selection_hint", "读取提示")):
            n = str(e.get(域) or "").count(名字)
            if n:
                hits.append((e.get("title") or "?", 汉, n))
    return hits


def rename_variable(spec, 谁, 新名, out=print):
    """给变量改名 —— 一次把**三处**一起挪，顺序与 id 都不动。

    在这之前只有「删了重建」一条路：换掉的是 id，卡里按 id 互相引用的地方
    （正则、条目、变量之间）全部断链，而且另外两处的键名跟着对新不上。

    变的名不是一个孤立字符串，它同时是：

      · `variables[].title` —— 面板上那一行
      · `initial_state` 里那一格的**键**
      · `schema_code` 里那个**字段名**

    只改一处，另两处就悄悄悬空（`check` 会报 VAR-SYNC-*，但那已经是改完之后了）。
    """
    raw = load(spec)
    v, item = _find_variable(raw, 谁)
    o = _find(v.get("objects") or [], item.get("object_id"), ("id",))
    对象名 = (o or {}).get("name") or ""
    旧 = str(item.get("title") or "")
    新 = str(新名 or "").strip()
    if not 新:
        raise ContentError("新名字不能空。")
    if 新 == 旧:
        raise ContentError("新名字跟旧的一样（「%s」），没改。" % 旧)
    兄弟 = [x for x in (v.get("variables") or [])
            if x is not item and x.get("object_id") == (o or {}).get("id")]
    if any(str(x.get("title") or "") == 新 for x in 兄弟):
        raise ContentError("对象「%s」里已经有一个叫「%s」的变量了 —— 同一层里两个同名，"
                           "初值与 Zod 那两格会打架。" % (对象名, 新))

    路径 = _对象路径(v, o) if o else []
    item["title"] = 新
    item["updated_at"] = M.now_iso()

    st = v.get("initial_state") or {}
    真路径, 容器 = _找状态格子(st, 路径, 旧)
    状态路径 = None
    if 真路径 is not None and _改键序(容器, 旧, 新):
        状态路径 = list(真路径[:-1]) + [新]          # 改完之后它在哪儿
    zod路径 = None
    基础 = list(真路径[:-1]) if 真路径 else list(路径)
    try:
        root = ZOD.parse(v.get("schema_code") or "")
        node = ZOD.node_at(root, tuple(基础))
        if isinstance(node, ZOD.Obj) and ZOD.rename_key(node, 旧, 新):
            v["schema_code"] = ZOD.emit(root)
            zod路径 = 基础 + [新]
    except ZOD.ZodError:
        pass

    put_trash(spec, "变量", "变量「%s.%s」改名成「%s」" % (对象名, 旧, 新),
              [OrderedDict([("表", "改名"), ("种类", "变量"), ("旧", 旧), ("新", 新),
                            ("变量id", item.get("id")), ("对象", 对象名),
                            ("状态路径", 状态路径), ("Zod路径", zod路径)])])
    commit(spec, raw, out)
    out("变量「%s.%s」改名为「%s」" % (对象名, 旧, 新))
    out("  三处一起挪：面板 ✓ · 初值 %s · Zod %s"
        % ("✓" if 状态路径 else "（没找到那一格，没动）",
           "✓" if zod路径 else "（没找到那个字段，没动）"))
    if not (状态路径 and zod路径):
        out("  ⚠ 有两处没跟上 —— 跑一遍 check 看 VAR-SYNC-* 报哪一条，再看着补。")
    提 = _提到(raw, 旧)
    if 提:
        out("  另：正文 / 提示里有 %d 处写着「%s」—— 工具**没动**（不知道那是变量名还是"
            "恰好同字的词），你自己扫一眼要不要改："
            % (sum(x[2] for x in 提), 旧))
        for 标, 域, n in 提[:5]:
            out("    · 「%s」的%s %d 处" % (标, 域, n))
        if len(提) > 5:
            out("    · …还有 %d 处" % (len(提) - 5))
    trash_note(out)
    return item


def rename_object(spec, 谁, 新名, out=print):
    """给变量对象改名 —— 对象名同样是**三处**：`objects[].name`、
    `initial_state` 里那一层的键、Zod 里那个嵌套对象的键。

    子对象整棵跟着走（路径是父子链，换上面一段，下面的路自然一起换），
    `variables[].object_id` 认的是 id，不受影响。
    """
    raw = load(spec)
    v = _get_vars(raw)
    o = _find(v.get("objects") or [], 谁, ("id", "name"))
    if o is None:
        raise ContentError("没有变量对象「%s」。列出来看：python forge.py var %s --列"
                           % (谁, spec))
    旧 = str(o.get("name") or "")
    新 = str(新名 or "").strip()
    if not 新:
        raise ContentError("新名字不能空。")
    if 新 == 旧:
        raise ContentError("新名字跟旧的一样（「%s」），没改。" % 旧)
    if _find([x for x in (v.get("objects") or []) if x is not o], 新, ("name", "id")):
        raise ContentError("已经有一个叫「%s」的对象了 —— 同一层两个同名，路就分不清了。" % 新)
    路径 = _对象路径(v, o)
    if not 路径:
        raise ContentError("对象「%s」没有名字（路径是空的），先给它个名字。" % 谁)

    o["name"] = 新
    o["updated_at"] = M.now_iso()
    父 = list(路径[:-1])
    状态路径 = None
    cur, ok = _走状态(v.get("initial_state") or {}, 父)
    if ok and isinstance(cur, dict) and _改键序(cur, 路径[-1], 新):
        状态路径 = 父 + [新]
    zod路径 = None
    try:
        root = ZOD.parse(v.get("schema_code") or "")
        node = ZOD.node_at(root, tuple(父))
        if isinstance(node, ZOD.Obj) and ZOD.rename_key(node, 路径[-1], 新):
            v["schema_code"] = ZOD.emit(root)
            zod路径 = 父 + [新]
    except ZOD.ZodError:
        pass

    put_trash(spec, "变量", "变量对象「%s」改名成「%s」" % (旧, 新),
              [OrderedDict([("表", "改名"), ("种类", "对象"), ("旧", 旧), ("新", 新),
                            ("对象id", o.get("id")), ("对象", 新),
                            ("状态路径", 状态路径), ("Zod路径", zod路径)])])
    commit(spec, raw, out)
    out("变量对象「%s」改名为「%s」" % (旧, 新))
    out("  三处一起挪：对象表 ✓ · 初值 %s · Zod %s"
        % ("✓" if 状态路径 else "（没找到那一层，没动）",
           "✓" if zod路径 else "（没找到那一层，没动）"))
    if not (状态路径 and zod路径):
        out("  ⚠ 有两处没跟上 —— 跑一遍 check 看 VAR-SYNC-* 报哪一条，再看着补。")
    提 = _提到(raw, 旧)
    if 提:
        out("  另：正文 / 提示里有 %d 处写着「%s」—— 工具**没动**，你自己扫一眼。"
            % (sum(x[2] for x in 提), 旧))
    trash_note(out)
    return o


def _搬格子(st, 从, 到):
    """把 `st` 里「从」那条路径上的值，搬到「到」那条路径下 —— 中途缺的层现建。

    只搬**真存在**的那一格（读得到才搬），目标那层写不进去（半路撞上非对象的值）
    就一个字节都不动。返回 True 表示真搬了。变量换对象与它的撤销都走这里，
    免得正反两条路各写一份、慢慢写岔。
    """
    if not (从 and 到) or not isinstance(st, dict):
        return False
    从, 到 = list(从), list(到)
    if not 从 or not 到:
        return False
    旧容器, ok = _走状态(st, 从[:-1])
    if not (ok and isinstance(旧容器, dict) and 从[-1] in 旧容器):
        return False
    if not _可写状态(st, 到[:-1]):
        return False
    值 = 旧容器.pop(从[-1])
    节点 = st
    for seg in 到[:-1]:
        节点 = 节点.setdefault(seg, OrderedDict())
    节点[到[-1]] = 值
    return True


def move_variable(spec, 谁, 到, out=print):
    """把一个变量挪到另一个变量对象下 —— **四处一起挪**，变量 id 一个字母不动。

    变量名本身不变，变的是它挂在哪：

      · `variables[].object_id` —— 挂靠关系
      · `initial_state` 里那一格 —— 从旧对象那棵树搬到新对象那棵树下
      · `schema_code` 里那个字段 —— 同上，只是换在 Zod 那棵树上
      · `order` / `tree_view_order` —— 排到新对象末尾

    以前只能「删了重建」：换掉的是 id，而且同一个变量名要在**另一棵子树**下重新
    出现，手改两处路径极易漏一处 —— 漏了 Zod 那处，运行时会静默丢掉写进去的值
    （`check` 的 VAR-SYNC-SCHEMA 兜的就是这种，但那已经是改完之后了）。
    """
    raw = load(spec)
    v, item = _find_variable(raw, 谁)
    o = _find(v.get("objects") or [], item.get("object_id"), ("id",))
    if o is None:
        raise ContentError("变量「%s」挂的那个对象找不到了（object_id 悬空）——"
                           "先跑一遍 check 看 VAR-SYNC-ORPHAN。" % item.get("title"))
    旧对象名 = str(o.get("name") or "")
    旧路径 = _对象路径(v, o)
    no = _find(v.get("objects") or [], 到, ("id", "name"))
    if no is None:
        raise ContentError("没有变量对象「%s」。列出来看：python forge.py var %s --列"
                           % (到, spec))
    新对象名 = str(no.get("name") or "")
    if no.get("id") == o.get("id"):
        raise ContentError("变量「%s」已经在对象「%s」下了，没挪。"
                           % (item.get("title"), 新对象名))
    键 = str(item.get("title") or "")
    同层 = [x for x in (v.get("variables") or [])
            if x is not item and x.get("object_id") == no.get("id")]
    if any(str(x.get("title") or "") == 键 for x in 同层):
        raise ContentError("对象「%s」下已经有一个叫「%s」的变量了 —— 同一层两个同名，"
                           "初值与 Zod 那两格会打架。" % (新对象名, 键))
    新路径 = _对象路径(v, no)
    if not 新路径:
        raise ContentError("对象「%s」没有名字（路径是空的），挪不了。" % 新对象名)

    st = v.get("initial_state") or {}
    旧真路径, _旧容器 = _找状态格子(st, 旧路径, 键)
    # 新位置跟旧位置**同一套写法**：有的卡「对象名就是数据键」，不额外加自己那层。
    去层 = bool(旧真路径) and len(旧路径) >= 2 and list(旧真路径) != list(旧路径) + [键]
    新容器路径 = list(新路径[:-1]) if (去层 and len(新路径) >= 2) else list(新路径)
    if not _可写状态(st, 新容器路径):
        哪, 什么 = _挡路的(st, 新容器路径)
        raise ContentError(
            "对象「%s」在 initial_state 里对不上号：%s 那一格是%s，不是一层对象。\n"
            "  对象表说它是一层能放变量的对象，初值那边却不是 —— 形状是卡自己写的，"
            "工具不猜（乱写会把值塞到旁边那一层，而且不报错）。\n"
            "  两个办法：① 去「原文」页把那一格改成一层对象；② 或挑别的对象。"
            % (新对象名, 哪, _形状(什么)))

    旧顺序 = item.get("order")
    旧视图序 = item.get("tree_view_order")
    新顺序 = _max_order(同层) + 1
    item["object_id"] = no.get("id")
    item["order"] = 新顺序
    item["tree_view_order"] = 新顺序
    item["updated_at"] = M.now_iso()

    状态从 = 状态到 = None
    if 旧真路径 is not None:
        状态从 = list(旧真路径)
        状态到 = 新容器路径 + [键]
        if not _搬格子(st, 状态从, 状态到):
            状态从 = 状态到 = None

    zod从 = zod到 = None
    try:
        root = ZOD.parse(v.get("schema_code") or "")
        旧基础 = list(旧真路径[:-1]) if 旧真路径 else list(旧路径)
        旧节点 = ZOD.node_at(root, tuple(旧基础))
        if isinstance(旧节点, ZOD.Obj) and 键 in 旧节点.kids:
            表达式 = 旧节点.kids[键].code
            ZOD.drop(root, tuple(旧基础), 键)
            ZOD.set_leaf(root, tuple(新容器路径), 键, 表达式)
            v["schema_code"] = ZOD.emit(root)
            zod从 = 旧基础 + [键]
            zod到 = 新容器路径 + [键]
    except ZOD.ZodError:
        pass

    put_trash(spec, "变量", "变量「%s.%s」挪到「%s」下" % (旧对象名, 键, 新对象名),
              [OrderedDict([("表", "挪变量"), ("变量id", item.get("id")), ("键", 键),
                            ("旧对象id", o.get("id")), ("新对象id", no.get("id")),
                            ("旧对象", 旧对象名), ("新对象", 新对象名),
                            ("旧状态路径", 状态从), ("新状态路径", 状态到),
                            ("旧Zod路径", zod从), ("新Zod路径", zod到),
                            ("旧顺序", 旧顺序), ("旧视图序", 旧视图序)])])
    commit(spec, raw, out)
    out("变量「%s.%s」挪到「%s」下" % (旧对象名, 键, 新对象名))
    out("  一起挪的：对象表 ✓ · 初值 %s · Zod %s · 排序 → 末尾（order %s）"
        % ("✓" if 状态到 else "（本来就查不到那一格，没动）",
           "✓" if zod到 else "（没找到那个字段，没动）", 新顺序))
    if not 状态到:
        out("  ⚠ initial_state 里没找着它原来那一格（形状对不上）—— 跑 check 看 VAR-SYNC-STATE。")
    if not zod到:
        out("  ⚠ Zod 里那一处没跟上 —— 跑 check 看 VAR-SYNC-SCHEMA，值会静默丢。")
    trash_note(out)
    return item


def del_object(spec, 谁, out=print):
    raw = load(spec)
    v = _get_vars(raw)
    o = _find(v["objects"], 谁, ("id", "name"))
    if o is None:
        raise ContentError("没有变量对象「%s」。" % 谁)
    # 连子对象一起收（对象树是父子的）
    全 = [o]
    i = 0
    while i < len(全):
        for x in v["objects"]:
            if x.get("parent_id") == 全[i].get("id") and x not in 全:
                全.append(x)
        i += 1
    ids = {x.get("id") for x in 全}
    变量 = [x for x in v["variables"] if x.get("object_id") in ids]
    项 = []
    for x in 全:
        项.append(OrderedDict([("表", "objects"), ("位置", v["objects"].index(x)),
                               ("数据", M.plain(x))]))
    for x in 变量:
        项.append(OrderedDict([("表", "variables"), ("位置", v["variables"].index(x)),
                               ("数据", M.plain(x))]))
    st = v.get("initial_state") or {}
    for x in 全:
        路径 = _对象路径(v, x)
        cur = st
        ok = True
        for seg in 路径[:-1]:
            if isinstance(cur, dict) and isinstance(cur.get(seg), dict):
                cur = cur[seg]
            else:
                ok = False
                break
        if ok and isinstance(cur, dict) and 路径[-1] in cur:
            项.append(OrderedDict([("表", "initial_state"), ("路径", 路径),
                                   ("数据", cur.pop(路径[-1]))]))
    try:
        root = ZOD.parse(v.get("schema_code") or "")
        for x in 全:
            路径 = _对象路径(v, x)
            node = root
            ok = True
            for seg in 路径[:-1]:
                node = node.kids.get(seg) if isinstance(node, ZOD.Obj) else None
                if node is None:
                    ok = False
                    break
            if ok and isinstance(node, ZOD.Obj) and 路径[-1] in node.kids:
                表达式 = ZOD.emit(node.kids[路径[-1]])
                ZOD.drop(root, tuple(路径[:-1]), 路径[-1])
                项.append(OrderedDict([("表", "schema"), ("路径", 路径),
                                       ("数据", 表达式)]))
        v["schema_code"] = ZOD.emit(root)
    except ZOD.ZodError:
        pass

    for x in 变量:
        v["variables"].remove(x)
    for x in 全:
        v["objects"].remove(x)
    put_trash(spec, "变量对象",
              "删了变量对象「%s」连它下面 %d 个变量" % (o.get("name") or "", len(变量)), 项)
    commit(spec, raw, out)
    out("已删变量对象「%s」（一起收走 %d 个变量、%d 个子对象）"
        % (o.get("name") or "", len(变量), len(全) - 1))
    trash_note(out)
    return o


def align_schema(spec, out=print):
    """把 schema_code 对齐另外两处（对象表 + 初值）。已有的叶子表达式不动。"""
    raw = load(spec)
    v = _get_vars(raw)
    if not str(v.get("schema_code") or "").strip():
        root = ZOD.Obj()
    else:
        try:
            root = ZOD.parse(v["schema_code"])
        except ZOD.ZodError as exc:
            raise ContentError(
                "schema_code 的形状工具不认，不敢自动对齐：%s\n"
                "  现在长这样（前 80 字）：%s" % (exc, str(v["schema_code"])[:80]))
    类型 = {}
    by_id = {x.get("id"): x for x in v["objects"]}
    for it in v["variables"]:
        o = by_id.get(it.get("object_id"))
        if not o:
            continue
        类型[tuple(_对象路径(v, o) + [it.get("title") or ""])] = it.get("type")
    说 = []
    ZOD.sync(root, v.get("initial_state") or {}, 类型, out=说.append)
    v["schema_code"] = ZOD.emit(root)
    commit(spec, raw, out)
    out("Zod 已对齐另两处（对象表 + 初值）")
    for s in 说:
        out(s)
    if not 说:
        out("  · 本来就是齐的，一个字没改")
    return 说


# ------------------------------------------------------------------ 正则
def list_regex(spec):
    raw = load(spec)
    return [{"id": r.get("id"), "名": r.get("name") or "", "顺序": r.get("order"),
             "开": bool(r.get("enabled", True)),
             "模式": str(r.get("pattern") or ""),
             "目标": r.get("targets") or []}
            for r in (raw.get("regex_rules") or [])]


def add_regex(spec, 名, 模式, 替换="", 目标=None, 顺序=None, 显示用=True, out=print):
    raw = load(spec)
    rules = raw.setdefault("regex_rules", [])
    名 = str(名 or "").strip()
    pat = str(模式 or "").strip()
    if not 名:
        raise ContentError("正则名不能空。")
    if not pat:
        raise ContentError("模式不能空。")
    # Git Bash（MSYS）会把以 / 开头的参数当路径，就地展开成 Windows 路径：
    #   --模式 "/〔重点〕/g"  ->  E:/.../PortableGit/〔重点〕/g
    # 这会把一条正则悄悄换成一句乱码，而卡本身不报错。宁可当场拦下并说清怎么绕。
    if _re.match(r"^[A-Za-z]:[\\/]", pat):
        raise ContentError(
            "这个模式看起来被 shell 改成路径了：\n    %s\n"
            "  Git Bash / MSYS 会把以 / 开头的参数当路径展开。绕法：\n"
            "    · 跑之前加一句  export MSYS_NO_PATHCONV=1"
            % pat)
    if _find(rules, 名, ("id", "name")):
        raise ContentError("已经有同名正则「%s」了（宁可重名拦下，也好过两条互相盖）。" % 名)
    r = OrderedDict([
        ("id", "regex-%s-%s" % (_prefix(spec), M.uuid4hex()[:8])),
        ("name", 名), ("pattern", pat), ("replacement", str(替换 or "")),
        ("targets", [str(x) for x in (目标 or ["AiOutput"])]),
        ("enabled", True), ("display_only", bool(显示用)), ("prompt_only", False),
        ("run_on_edit", True),
        ("order", int(顺序) if 顺序 is not None else _max_order(rules) + 10),
    ])
    rules.append(M.ordered(r, M.REGEX_KEYS))
    commit(spec, raw, out)
    out("已加正则「%s」" % 名)
    out("  %s" % pat)
    out("  顺序 %s · 作用 %s" % (r["order"], "、".join(r["targets"])))
    return r


def del_regex(spec, 谁, out=print):
    raw = load(spec)
    rules = raw.get("regex_rules") or []
    r = _find(rules, 谁, ("id", "name"))
    if r is None:
        raise ContentError("没有正则「%s」。" % 谁)
    put_trash(spec, "正则", "删了正则「%s」" % (r.get("name") or ""),
             [OrderedDict([("表", "regex"), ("位置", rules.index(r)),
                           ("数据", M.plain(r))])])
    rules.pop(rules.index(r))
    commit(spec, raw, out)
    out("已删正则「%s」" % (r.get("name") or ""))
    trash_note(out)
    return r


def set_regex(spec, 谁, 开=True, out=print):
    raw = load(spec)
    r = _find(raw.get("regex_rules") or [], 谁, ("id", "name"))
    if r is None:
        raise ContentError("没有正则「%s」。" % 谁)
    r["enabled"] = bool(开)
    commit(spec, raw, out)
    out("正则「%s」已%s" % (r.get("name") or "", "启用" if 开 else "停用"))
    return r


# ------------------------------------------------------------------ 整体
def stats(spec):
    raw = load(spec)
    v = raw.get("variables") or {}
    return {
        "条目": len(entries_of(raw, must=False)),
        "分组": len(groups_of(raw, must=False)),
        "对象": len(v.get("objects") or []),
        "变量": len(v.get("variables") or []),
        "正则": len(raw.get("regex_rules") or []),
    }


def clone(src, dst, out=print):
    """把一份 spec 拷成一个新工程（只搬内容层，界面层留给 new）。"""
    os.makedirs(os.path.dirname(os.path.abspath(dst)) or ".", exist_ok=True)
    shutil.copy2(src, dst)
    if out:
        out("已复制 %s -> %s" % (src, dst))
    return dst
