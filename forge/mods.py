# -*- coding: utf-8 -*-
"""forge.mods —— 模块：给卡挂上一块现成的机制。

模块是什么：一张卡按需接的能力（骰子框、档案备份、点数池……）。骨架本身不带模块，
不接就不拼 —— 文件里不会多一个字。

一个模块占一个目录 `assets/模块/<名>/`：

    模块.json    清单：名 / 版本 / id / 一句话 / 需要 / 条目 / 正则 / 脚本 / 样式
    条目.yaml    往 spec 并的条目（可选）
    正则.json    往 spec 并的正则（可选）
    <名>.js      往 hud/模块/ 落的脚本（可选，需要工程有 hud/）
    <名>.css     往 hud/模块/ 落的样式（可选）

**两类东西，两个去处**（这是模块系统的分界）：

    条目 / 正则  →  source/<卡>.spec.yaml   —— 并一次就归这张卡，此后改就改 spec
    脚本 / 样式  →  <工程>/hud/模块/<名>/    —— 每次组装界面时重新拼，撤掉就删目录

条目怎么并（一条一种写法）：

    替换: <参照条目>   顶掉那一条，没写的字段沿用被替那一条
    底稿: <参照条目>   照那一条的形状克隆一条新的，加到末尾

「参照条目」写 id，也可以只写 id 的后半截 —— `rule-check` 能匹配
`moonlight-entry-rule-check`，这样模块就不必知道每张卡的前缀。

脚本/样式里的 `skel` / `SKEL_HUD` 会在落盘时换成这张卡的名字 ——
所以模块不必为某张卡改一个字。

并条目时 id / order / tree_view_order 这些「目录顺序」字段一律由本工具接管，
模块里写了也忽略：那是卡自己的事，不是模块该管的。

**账本（可撤）**：每接一个模块，都往工程里的 `模块账本.json` 记一笔 ——
并了哪几条、替换的那条原来长什么样（整份存着）、撤的时候要删哪些正则与界面文件。
所以 `forge drop <模块>` 能**精确撤回**，不是让你自己去 spec 里翻。

为什么替换的条目要连「原样」一起存：模块是**覆盖**进去的，不存原样就再也回不去了。
这也是这套东西和「复制粘贴一段规则进 spec」的区别 —— 后者不可撤。
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
from collections import OrderedDict

from . import model as M
from . import sandbox as SB

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODS_DIR = os.path.join(ROOT, "assets", "模块")

LEDGER_NAME = "模块账本.json"
LEDGER_NOTE = ("这张卡接过哪些模块、每个模块并进来了什么 —— 由 `forge add` / `forge drop` "
               "维护。**别手改**：撤模块全靠它，改坏了就撤不干净。")

# 模块不许碰的字段：目录顺序归卡自己
RESERVED = ("id", "order", "view_order", "group_view_order", "tree_view_order",
            "created_at", "updated_at")
DIRECTIVE = ("替换", "底稿")


# ------------------------------------------------------------------ 清点
def list_modules():
    """返回所有模块的清单（按目录名排序）。"""
    out = []
    if not os.path.isdir(MODS_DIR):
        return out
    for name in sorted(os.listdir(MODS_DIR)):
        d = os.path.join(MODS_DIR, name)
        meta_path = os.path.join(d, "模块.json")
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception as exc:
            meta = {"名": name, "一句话": "（清单读不出来：%s）" % exc}
        meta["_dir"] = d
        meta["_名"] = meta.get("名") or name
        out.append(meta)
    return out


def find_module(name):
    key = str(name).strip()
    for m in list_modules():
        if m["_名"] == key or m.get("id") == key:
            return m
    return None


# ------------------------------------------------------------------ 并入
def project_of(spec_path):
    up = os.path.dirname(os.path.abspath(spec_path))
    return os.path.dirname(up) if os.path.basename(up) == "source" else up


def apply_modules(spec_path, names, project=None, out=print):
    """把若干模块并进 spec.yaml（就地改写）。返回成功并进去的模块名列表。

    project：工程根。不传就从 spec_path 推（`<工程>/source/<卡>.spec.yaml`）。
    有 hud/ 的工程会顺便把模块的脚本/样式落进 `hud/模块/<名>/` 并登记进 conf。
    **每接一个都往 `模块账本.json` 记一笔**，这样 `drop` 才撤得回来。
    """
    spec = M.yload(spec_path) or {}
    if not (spec.get("library") or {}).get("entries"):
        raise ValueError("这个 spec 里没有 library.entries，不像本工具的骨架规格：%s"
                         % spec_path)
    if project is None:
        project = project_of(spec_path)
    ledger = load_ledger(project)
    recorded = ledger.setdefault("模块", {})
    done = []
    for raw in names:
        name = str(raw).strip()
        if not name:
            continue
        mod = find_module(name)
        if not mod:
            out("  ✗ 没有这个模块：%s（跑 `forge mods` 看有哪些）" % name)
            continue
        key = mod["_名"]
        if key in recorded:
            have = str(recorded[key].get("版本") or "?")
            out("  · %s —— 已经接过（%s），跳过。" % (key, have))
            out("        要换版本就先撤再接：forge drop %s <spec>，再 forge add %s <spec>"
                % (key, key))
            continue
        rec = _apply_one(spec, mod, project, out)
        recorded[key] = rec
        done.append(key)
    if done:
        M.ydump(spec, spec_path)
        save_ledger(project, ledger)
    return done


def _apply_one(spec, mod, project, out):
    lib = spec["library"]
    entries = lib.setdefault("entries", [])
    groups = lib.setdefault("groups", [])
    prefix = infer_prefix(spec)
    mod_id = str(mod.get("id") or mod["_名"])
    out("  · %s —— %s" % (mod["_名"], mod.get("一句话", "")))

    rec = OrderedDict([
        ("id", mod_id),
        ("版本", str(mod.get("版本") or "")),
        ("接于", M.now_iso()),
        ("条目", OrderedDict([("替换", []), ("新增", [])])),
        ("正则", []),
        ("界面", []),
    ])

    # ---- 条目
    ent_file = mod.get("条目")
    if ent_file:
        rows = _read_yaml(os.path.join(mod["_dir"], ent_file))
        added = replaced = 0
        for i, row in enumerate(rows or [], 1):
            if not isinstance(row, dict):
                continue
            mode = "替换" if "替换" in row else ("底稿" if "底稿" in row else None)
            if not mode:
                out("      ! 第 %d 条既没写「替换」也没写「底稿」，跳过" % i)
                continue
            ref = row.get(mode)
            target = _match_entry(ref, entries)
            if target is None:
                out("      ! 找不到参照条目 %r，跳过这一条" % ref)
                continue
            if mode == "替换":
                before = M.ordered(copy.deepcopy(target), M.ENTRY_KEYS)
                _merge_into(target, row, prefix, groups)
                rec["条目"]["替换"].append(OrderedDict([
                    ("id", target.get("id", "")),
                    ("title", target.get("title", "")),
                    ("原", before),
                    ("并入后", _fingerprint(target)),
                ]))
                replaced += 1
            else:
                new = _clone_from(target, row, prefix, groups, mod_id, i, entries)
                if new is None:
                    out("      = 条目已存在，跳过：%s" % row.get("title"))
                    continue
                entries.append(new)
                rec["条目"]["新增"].append(OrderedDict([
                    ("id", new.get("id", "")),
                    ("title", new.get("title", "")),
                    ("指纹", _fingerprint(new)),
                ]))
                added += 1
        if replaced:
            out("      ✓ 替换了 %d 条（原样已记进账本，撤得回来）" % replaced)
        if added:
            out("      ✓ 新增了 %d 条（已记进账本）" % added)

    # ---- 正则
    re_file = mod.get("正则")
    if re_file:
        rows = _read_json(os.path.join(mod["_dir"], re_file)) or []
        if rows:
            ids = _add_regex(spec, rows, prefix, mod_id)
            rec["正则"] = ids
            out("      ✓ 并入 %d 条正则（已记进账本）" % len(ids))

    # ---- 脚本 / 样式（B 轨素材）：落进工程的 hud/模块/<名>/
    placed = _install_hud(mod, project, spec, prefix, out)
    rec["界面"] = placed
    for p in placed:
        out("      ✓ %s" % p)
    return rec


def _install_hud(mod, project, spec, prefix, out):
    """把模块的脚本/样式落进 `<工程>/hud/模块/<名>/`，并登记进 hud.conf.json 的「模块」。

    只并 spec 的模块（如骰子）**不进** conf 那个列表 —— 那个列表管的是「往这一页里
    拼哪几段代码」，没有代码可拼的模块写进去，组装时就去找一个不存在的目录。
    """
    name = mod["_名"]
    if not project:
        return []
    hud_dir = os.path.join(project, "hud")
    conf_path = os.path.join(hud_dir, "hud.conf.json")
    if not os.path.isfile(conf_path):
        if mod.get("脚本") or mod.get("样式"):
            out("      · 这个工程没有 hud/（没有界面层），脚本与样式没地方放 —— 只并了 spec")
        return []

    with open(conf_path, encoding="utf-8") as f:
        conf = json.load(f)
    # 名字**以 conf 为准**（它才是这张卡界面层的事实来源），conf 里没写才退到 spec/推断
    card_name = str(conf.get("卡名") or (spec.get("character") or {}).get("name") or "")
    prefix = str(conf.get("id_prefix") or "").strip() or prefix
    subs = [("骨架", card_name), ("SKEL", prefix.upper()), ("skel", prefix)]

    placed = []
    for key, tail in (("脚本", ".js"), ("样式", ".css")):
        src = mod.get(key)
        if not src:
            continue
        p = os.path.join(mod["_dir"], str(src))
        if not os.path.isfile(p):
            raise ValueError("模块「%s」说给了%s「%s」，文件不在：%s" % (name, key, src, p))
        text = open(p, encoding="utf-8").read()
        for a, b in subs:
            if b:
                text = text.replace(a, b)
        dst_dir = os.path.join(hud_dir, "模块", name)
        os.makedirs(dst_dir, exist_ok=True)
        with open(os.path.join(dst_dir, name + tail), "w",
                  encoding="utf-8", newline="\n") as f:
            f.write(text)
        placed.append("hud/模块/%s/%s%s" % (name, name, tail))

    if not placed:
        return []

    names = [str(x) for x in (conf.get("模块") or [])]
    if name not in names:
        names.append(name)
    conf["模块"] = names
    with open(conf_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(conf, f, ensure_ascii=False, indent=2)
        f.write("\n")
    out("      ✓ 已登记进 hud.conf.json 的「模块」")
    return placed


# ------------------------------------------------------------------ 账本
def ledger_path(project):
    return os.path.join(project, LEDGER_NAME)


def load_ledger(project):
    """读工程账本；没有就返回一份空的（不落盘）。"""
    empty = OrderedDict([("_说明", LEDGER_NOTE), ("格式", 1),
                         ("模块", OrderedDict())])
    if not project:
        return empty
    p = ledger_path(project)
    if not os.path.isfile(p):
        return empty
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return empty
    if not isinstance(data, dict):
        return empty
    data.setdefault("模块", OrderedDict())
    return data


def save_ledger(project, ledger):
    if not project:
        return
    os.makedirs(project, exist_ok=True)
    out = OrderedDict()
    out["_说明"] = LEDGER_NOTE
    out["格式"] = 1
    out["模块"] = OrderedDict((k, v) for k, v in (ledger.get("模块") or {}).items())
    with open(ledger_path(project), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _fingerprint(obj):
    """一条条目的指纹：只比内容，不比键序与空白。用来判断「撤之前你动过没有」。"""
    return hashlib.sha1(
        json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]


def _by_id(entries, eid):
    eid = str(eid or "")
    if not eid:
        return None
    for e in entries:
        if str(e.get("id") or "") == eid:
            return e
    return None


# ------------------------------------------------------------------ 撤模块
def drop_modules(spec_path, names, project=None, out=print):
    """把接过模块撤回来（add 的反操作）。按账本精确撤：

        替换的条目 -> 还原成接之前那一份（原样在账本里存着）
        新增的条目 -> 删掉
        并进来的正则 -> 按 id 删掉
        落下的脚本/样式 -> 删目录 + 从 conf「模块」里摘掉

    只撤账本里记着的。**手写进 spec 的东西一律不动** —— 工具分不清那是谁的，
    宁可不撤，也不替人删东西。
    """
    spec = M.yload(spec_path) or {}
    if project is None:
        project = project_of(spec_path)
    ledger = load_ledger(project)
    recorded = ledger.setdefault("模块", OrderedDict())
    lib = spec.get("library") or {}
    entries = lib.get("entries")
    if entries is None:
        raise ValueError("这个 spec 里没有 library.entries，不像本工具的骨架规格：%s"
                         % spec_path)
    rules = spec.get("regex_rules") or []

    dropped = []
    for raw in names:
        name = str(raw).strip()
        if not name:
            continue
        key = _resolve_ledger_key(name, recorded)
        if not key:
            out("  ✗ 账本里没有「%s」。" % name)
            out("        这张卡没接过它；要么它是手写进 spec 的 —— 那种本工具不敢替你删，"
                "要删自己改 spec。")
            continue
        rec = recorded[key] or {}
        out("  · 撤 %s（版本 %s · 接于 %s）"
            % (key, rec.get("版本") or "?", rec.get("接于") or "?"))

        # ---- 1. 替换的：还原
        for item in ((rec.get("条目") or {}).get("替换") or []):
            cur = _by_id(entries, item.get("id"))
            title = str(item.get("title") or item.get("id") or "?")
            if cur is None:
                out("      ! 「%s」已经不在了（你删过？），跳过" % title)
                continue
            if item.get("并入后") and _fingerprint(cur) != item["并入后"]:
                out("      ⚠ 「%s」接模块之后你又改过 —— 还原会把那处改动一起盖掉" % title)
            entries[entries.index(cur)] = M.ordered(
                copy.deepcopy(item.get("原") or {}), M.ENTRY_KEYS)
            out("      ✓ 还原「%s」" % title)

        # ---- 2. 新增的：删
        for item in ((rec.get("条目") or {}).get("新增") or []):
            cur = _by_id(entries, item.get("id"))
            if cur is None:
                continue
            title = str(item.get("title") or item.get("id") or "?")
            if item.get("指纹") and _fingerprint(cur) != item["指纹"]:
                out("      ⚠ 「%s」是模块加的，但你改过 —— 还是照删（账本记着它归模块）"
                    % title)
            entries.remove(cur)
            out("      ✓ 删掉「%s」" % title)

        # ---- 3. 正则
        ids = {str(x) for x in (rec.get("正则") or [])}
        if ids:
            keep = [r for r in rules if str(r.get("id")) not in ids]
            gone = len(rules) - len(keep)
            rules[:] = keep
            if gone:
                out("      ✓ 撤掉 %d 条正则" % gone)

        # ---- 4. 界面
        _drop_hud(key, project, out)

        recorded.pop(key, None)
        dropped.append(key)

    if dropped:
        spec["regex_rules"] = rules
        M.ydump(spec, spec_path)
        save_ledger(project, ledger)
    return dropped


def _resolve_ledger_key(name, recorded):
    """账本里的键是模块「名」；也容许用目录名或 id 来撤。"""
    if name in recorded:
        return name
    mod = find_module(name)
    if mod:
        for k in (mod["_名"], os.path.basename(mod["_dir"])):
            if k in recorded:
                return k
        for k, rec in recorded.items():
            if str((rec or {}).get("id") or "") == str(mod.get("id") or ""):
                return k
    return None


def _drop_hud(name, project, out):
    if not project:
        return
    conf_path = os.path.join(project, "hud", "hud.conf.json")
    folder = os.path.join(project, "hud", "模块", name)
    removed = False
    if os.path.isdir(folder):
        # 沙箱里删不掉目录 —— 那也不影响结果：组装只按 conf 的「模块」列表拼，
        # 留下的目录是死的（conf 里已经没它了）。返回 False 让上层如实说一句。
        removed = SB.rmtree(folder)
    if os.path.isfile(conf_path):
        try:
            with open(conf_path, encoding="utf-8") as f:
                conf = json.load(f)
        except Exception:
            conf = None
        if isinstance(conf, dict):
            names = [str(x) for x in (conf.get("模块") or [])]
            if name in names:
                conf["模块"] = [x for x in names if x != name]
                with open(conf_path, "w", encoding="utf-8", newline="\n") as f:
                    json.dump(conf, f, ensure_ascii=False, indent=2)
                    f.write("\n")
                out("      ✓ 从 hud.conf.json 的「模块」里摘掉")
    if removed:
        out("      ✓ 删掉 hud/模块/%s/" % name)


# ------------------------------------------------------------------ 小工具
def _merge_into(target, row, prefix, groups):
    """替换：把模块写了的字段盖上去，其余沿用被替那一条。"""
    for k, v in row.items():
        if k in DIRECTIVE or k in RESERVED:
            continue
        target[k] = _resolve(k, v, prefix, groups)


def _clone_from(target, row, prefix, groups, mod_id, idx, entries):
    """底稿：照参照条目的形状克隆一条新的，模块字段盖上去，排到末尾。"""
    raw_id = str(row.get("id") or ("mod-%s-%d" % (mod_id, idx))).strip()
    new_id = raw_id if raw_id.startswith(prefix + "-") else ("%s-%s" % (prefix, raw_id))
    if _match_entry(new_id, entries) is not None:
        return None                      # 已经加过了（幂等）
    new = OrderedDict()
    for k in M.ENTRY_KEYS:
        if k in target and k not in RESERVED:
            new[k] = target[k]
    new.update(OrderedDict((k, target[k]) for k in M.ENTRY_KEYS
                           if k in target and k in RESERVED and k != "id"))
    new["id"] = new_id
    for k, v in row.items():
        if k in DIRECTIVE or k in RESERVED:
            continue
        new[k] = _resolve(k, v, prefix, groups)
    # 目录顺序：排到末尾
    max_order = 0
    for e in entries:
        try:
            max_order = max(max_order, int(e.get("order") or 0))
        except (TypeError, ValueError):
            pass
    new["order"] = max_order + 1
    new["view_order"] = 0
    new["group_view_order"] = 0
    new["tree_view_order"] = max_order + 1
    new["created_at"] = M.now_iso()
    new["updated_at"] = new["created_at"]
    return M.ordered(new, M.ENTRY_KEYS)


def _add_regex(spec, rows, prefix, mod_id):
    """把模块的正则并进去，返回并进去的那几条 id（账本要记）。"""
    rules = spec.setdefault("regex_rules", [])
    # 整体挪到现有正则之后，保持模块内部的相对先后
    max_order = 0
    for r in rules:
        try:
            max_order = max(max_order, int(r.get("order") or 0))
        except (TypeError, ValueError):
            pass
    base = max_order + 10
    min_mod = min((int(r.get("order") or 0) for r in rows), default=0)
    used = {r.get("id") for r in rules}
    added = []
    for i, r in enumerate(rows, 1):
        rid = "regex-%s-%s-%d" % (prefix, mod_id, i)
        if rid in used:
            continue
        rule = OrderedDict()
        rule["id"] = rid
        rule["name"] = r.get("name", "")
        rule["pattern"] = r.get("pattern", "")
        rule["replacement"] = r.get("replacement", "")
        rule["targets"] = r.get("targets") or ["AiOutput"]
        rule["enabled"] = bool(r.get("enabled", True))
        rule["display_only"] = bool(r.get("display_only", True))
        rule["prompt_only"] = bool(r.get("prompt_only", False))
        rule["run_on_edit"] = bool(r.get("run_on_edit", True))
        rule["order"] = base + (int(r.get("order") or 0) - min_mod)
        rules.append(M.ordered(rule, M.REGEX_KEYS))
        added.append(rid)
    rules.sort(key=lambda x: int(x.get("order") or 0))
    return added


# ------------------------------------------------------------------ 匹配与取数
def infer_prefix(spec):
    """从 spec 里猜 id 前缀（骨架是 <前缀>-entry-xxx / <前缀>-grp-xxx）。"""
    lib = spec.get("library") or {}
    for g in lib.get("groups") or []:
        gid = str(g.get("id") or "")
        if "-grp-" in gid and not gid.startswith("grp-"):
            return gid.split("-grp-")[0]
    for e in lib.get("entries") or []:
        eid = str(e.get("id") or "")
        for mark in ("-entry-", "-mod-"):
            if mark in eid:
                head = eid.split(mark)[0]
                if head and head != "entry":
                    return head
    return M.ascii_prefix((spec.get("character") or {}).get("name") or "") or "card"


def _match_entry(ref, entries):
    ref = str(ref or "").strip()
    if not ref:
        return None
    for e in entries:
        if str(e.get("id") or "") == ref:
            return e
    for e in entries:
        if str(e.get("id") or "").endswith("-" + ref):
            return e
    return None


def _match_group(ref, groups):
    """把模块写的分组（如 grp-world）对到这张卡真实的分组 id 上。对不上就留空。"""
    ref = str(ref or "").strip()
    if not ref:
        return ""
    for g in groups:
        if str(g.get("id") or "") == ref:
            return ref
    for g in groups:
        if str(g.get("id") or "").endswith("-" + ref):
            return str(g.get("id"))
    return ""


def _resolve(key, value, prefix, groups):
    if key == "group_id":
        return _match_group(value, groups)
    return value


def _read_yaml(path):
    if not os.path.isfile(path):
        return []
    return M.yload(path) or []


def _read_json(path):
    if not os.path.isfile(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------------ 打印
def module_state(mod, recorded):
    """这个模块相对某张卡的状态：(标记, 说明)。recorded 是该卡的账本。"""
    repo = str(mod.get("版本") or "")
    key = mod["_名"]
    if key not in recorded:
        return "未接", ""
    have = str((recorded.get(key) or {}).get("版本") or "")
    if not repo or not have or repo == have:
        return "已接", ("v" + (have or repo)) if (have or repo) else ""
    return "落后", "卡上 v%s → 仓库 v%s" % (have, repo)


def print_modules(project=None, out=print):
    mods = list_modules()
    if not mods:
        out("没有找到任何模块（%s）" % MODS_DIR)
        return
    recorded = (load_ledger(project).get("模块") or {}) if project else {}
    if project:
        out("可用模块（%d 个）· 这张卡：%s" % (len(mods), os.path.basename(project)))
    else:
        out("可用模块（%d 个）—— 接法：python forge.py add <名> <你的 spec.yaml>" % len(mods))
    out("")
    stale = 0
    for m in mods:
        bits = []
        if m.get("条目"):
            bits.append("条目")
        if m.get("正则"):
            bits.append("正则")
        hud_bits = []
        if m.get("脚本"):
            hud_bits.append("脚本")
        if m.get("样式"):
            hud_bits.append("样式")

        ver = str(m.get("版本") or "—")
        head = "  %s v%s %s" % (M.pad(m["_名"], 8), M.pad(ver, 8), m.get("一句话", ""))
        if project:
            state, note = module_state(m, recorded)
            mark = {"已接": "●", "落后": "▲", "未接": "○"}[state]
            head = "  %s %s v%s %s" % (mark, M.pad(m["_名"], 8), M.pad(ver, 8),
                                      m.get("一句话", ""))
            if note:
                head += "  [%s]" % note
            if state == "落后":
                stale += 1
        out(head)

        meta = []
        if m.get("id"):
            meta.append("id=%s" % m["id"])
        if bits:
            meta.append("并进内容：" + "+".join(bits))
        if hud_bits:
            meta.append("并进界面：" + "+".join(hud_bits) + "（落 hud/模块/）")
        if not bits and not hud_bits:
            meta.append("（这个模块什么都没给？）")
        if meta:
            out("         %s" % " · ".join(meta))
        if project and m["_名"] in recorded:
            rec = recorded[m["_名"]] or {}
            n_rep = len(((rec.get("条目") or {}).get("替换") or []))
            n_new = len(((rec.get("条目") or {}).get("新增") or []))
            out("         已并：替换 %d 条 · 新增 %d 条 · 正则 %d 条%s"
                % (n_rep, n_new, len(rec.get("正则") or []),
                   " · 界面文件 %d 个" % len(rec.get("界面") or [])
                   if rec.get("界面") else ""))
            out("         撤法：python forge.py drop %s <spec>" % m["_名"])
        need = m.get("需要") or []
        for n in (need if isinstance(need, list) else [need]):
            s = str(n)
            if len(s) > 96:
                s = s[:95] + "…"
            out("         需要：%s" % s)
        out("")
    if project:
        out("标记：● 已接 · ○ 未接 · ▲ 仓库里的模块比你卡上那份新")
        if stale:
            out("有 %d 个模块更新了：先 forge drop 再 forge add 才会吃到新版"
                "（卡上的条目归卡，工具不会偷偷替你覆盖）。" % stale)
