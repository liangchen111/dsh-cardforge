# -*- coding: utf-8 -*-
"""forge.bridge —— 酒馆（SillyTavern）卡 / 世界书 ⇄ ElecKoi 规格的识别与转换。

支持输入：
    *.json   酒馆 V2/V3 卡、V1 旧卡、独立世界书、ElecKoi 卡
    *.png    卡数据藏在图片元数据里（chara / ccv3 两种代号）
    *.charx  本质是 zip，里面有 card.json
    *.webp   少数嵌法也支持

两条命令：
    analyze     拆解报告：字段、条目、触发方式、token 估算
    to-eleckoi  转成 ElecKoi 规格（spec.yaml），再用 forge build 打包

⚠️ 两种格式不是一一对应。转换只做能确定的映射，其余一律留白并如实说明，
   绝不「尽力解析」（认不出就报错，不猜）。
"""
from __future__ import annotations

import base64
import json
import os
import re
import struct
import zipfile
import zlib
from collections import OrderedDict

from . import model as M

PNG_SIG = b"\x89PNG\r\n\x1a\n"

# 酒馆的插入位置 -> 中文名
ST_POSITION = {
    "before_char": "角色定义之前", "after_char": "角色定义之后",
    "before_example": "示例消息之前", "after_example": "示例消息之后",
    "before_an": "作者注释之前", "after_an": "作者注释之后",
    "at_depth": "指定深度",
    "before_author_note": "作者注释之前", "after_author_note": "作者注释之后",
}
ST_POSITION_NUM = {
    0: "角色定义之前", 1: "角色定义之后", 2: "作者注释之前", 3: "作者注释之后",
    4: "指定深度", 5: "示例消息之前", 6: "示例消息之后", 7: "Outlet",
}

KIND_LABEL = {
    "eleckoi": "ElecKoi 角色卡",
    "tavern_v3": "酒馆角色卡 V3",
    "tavern_v2": "酒馆角色卡 V2",
    "tavern_v1": "酒馆角色卡 V1（旧版扁平结构）",
    "lorebook": "独立世界书",
    "unknown": "未识别的结构",
}


# ------------------------------------------------------------------ 读取
def read_chunks_png(path):
    """取出 PNG 里所有文本块的原始字节。"""
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:8] != PNG_SIG:
        raise ValueError("不是 PNG 文件")
    out, i, n = {}, 8, len(raw)
    while i + 8 <= n:
        (ln,) = struct.unpack(">I", raw[i:i + 4])
        typ = raw[i + 4:i + 8]
        chunk = raw[i + 8:i + 8 + ln]
        i += 12 + ln
        try:
            if typ == b"tEXt":
                kw, _, txt = chunk.partition(b"\x00")
                out.setdefault(kw.decode("latin-1"), txt)
            elif typ == b"zTXt":
                kw, _, rest = chunk.partition(b"\x00")
                out.setdefault(kw.decode("latin-1"), zlib.decompress(rest[1:]))
            elif typ == b"iTXt":
                kw, _, rest = chunk.partition(b"\x00")
                if len(rest) >= 2:
                    comp, _method = rest[0], rest[1]
                    rest = rest[2:]
                    _lang, _, rest = rest.partition(b"\x00")
                    _trans, _, txt = rest.partition(b"\x00")
                    out.setdefault(kw.decode("latin-1"),
                                   zlib.decompress(txt) if comp == 1 else txt)
        except Exception:
            pass
        if typ == b"IEND":
            break
    return out


def decode_card_text(blob):
    """文本块可能是 base64 的 JSON，也可能是裸 JSON。"""
    if isinstance(blob, bytes):
        for trial in ("utf-8", "utf-16", "latin-1"):
            try:
                text = blob.decode(trial)
                break
            except UnicodeDecodeError:
                continue
        else:
            return None
    else:
        text = blob
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    pad = text + "=" * (-len(text) % 4)
    try:
        return json.loads(base64.b64decode(pad).decode("utf-8"))
    except Exception:
        return None


def load_any(path):
    """返回 (kind, data, note)。"""
    ext = os.path.splitext(path)[1].lower()

    if ext == ".png":
        chunks = read_chunks_png(path)
        for key in ("ccv3", "chara", "character", "card"):
            if key in chunks:
                data = decode_card_text(chunks[key])
                if isinstance(data, dict):
                    note = "PNG 元数据块「%s」%s" % (
                        key, "（base64 编码）" if isinstance(chunks[key], bytes) else "")
                    return classify(data, note)
        raise ValueError("这张 PNG 里没有找到角色卡数据块（chara / ccv3）")

    if ext in (".charx", ".byaf", ".zip"):
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".json")]
            names.sort(key=lambda n: (0 if "card" in n.lower() else 1, len(n)))
            for name in names:
                try:
                    data = json.loads(z.read(name).decode("utf-8"))
                except Exception:
                    continue
                if isinstance(data, dict):
                    return classify(data, "压缩包内的 %s" % name)
        raise ValueError("压缩包里没有可用的 card.json")

    data = M.jload(path)
    if not isinstance(data, dict):
        raise ValueError("顶层不是 JSON 对象")
    if "__meta__" in data and len(data) == 1 and isinstance(data["__meta__"], dict):
        data = data["__meta__"]
    return classify(data, "JSON 文件")


def classify(data, note=""):
    if str(data.get("format", "")).startswith("eleckoi."):
        return "eleckoi", data, note
    if data.get("spec") == "chara_card_v3" or str(data.get("spec_version", "")).startswith("3"):
        return "tavern_v3", data, note
    if "spec_version" in data or ("data" in data and isinstance(data["data"], dict)
                                  and "name" in data["data"]):
        return "tavern_v2", data, note
    if "entries" in data and isinstance(data["entries"], (list, dict)) and not any(
            k in data for k in ("description", "personality", "first_mes",
                                "scenario", "mes_example")):
        return "lorebook", data, note
    if "name" in data:
        return "tavern_v1", data, note
    return "unknown", data, note


def card_body(data):
    """V2/V3 的字段在 data.data 里，V1 在顶层。"""
    if isinstance(data.get("data"), dict):
        return data["data"]
    return data


def normalize_entries(book):
    """酒馆世界书条目：可能是 list，也可能是 {id: {...}}。统一成 list[dict]。"""
    if not book:
        return []
    raw = book.get("entries") if isinstance(book, dict) else book
    if isinstance(raw, dict):
        raw = list(raw.values())
    if not isinstance(raw, list):
        return []
    out = []
    for e in raw:
        if not isinstance(e, dict):
            continue
        ext = e.get("extensions") if isinstance(e.get("extensions"), dict) else {}
        keys = e.get("keys") or e.get("key") or []
        if isinstance(keys, str):
            keys = [k.strip() for k in keys.split(",") if k.strip()]
        sec = e.get("secondary_keys") or e.get("keysecondary") or []
        if isinstance(sec, str):
            sec = [k.strip() for k in sec.split(",") if k.strip()]
        pos = e.get("position")
        if pos is None:
            pos = ext.get("position")
        out.append({
            "title": e.get("name") or e.get("comment") or (keys[0] if keys else "(无标题)"),
            "keys": keys,
            "secondary": sec,
            "content": e.get("content") or e.get("entry") or "",
            "constant": bool(e.get("constant", False)),
            "selective": bool(e.get("selective", False)),
            "order": e.get("insertion_order", e.get("order", 100)),
            "position": pos,
            "depth": ext.get("depth"),
            "role": ext.get("role"),
            "probability": ext.get("probability", 100),
            "group": ext.get("group"),
            "enabled": e.get("enabled", not e.get("disable", False)),
        })
    return out


# ------------------------------------------------------------------ 报告
def analyze(path, out=print):
    kind, data, note = load_any(path)
    body = card_body(data)

    out("=" * 78)
    out("文件      : %s" % os.path.basename(path))
    out("大小      : %.1f KB" % (os.path.getsize(path) / 1024.0))
    if note:
        out("来源      : %s" % note)
    out("识别为    : %s" % KIND_LABEL.get(kind, kind))

    if kind == "eleckoi":
        _analyze_eleckoi(data, out)
        return kind, data, body

    if kind == "lorebook":
        entries = normalize_entries(data)
        out("-" * 78)
        out("【世界书】共 %d 条" % len(entries))
        if data.get("name"):
            out("  世界书名称：%s" % data["name"])
        print_book_table(entries, out)
        out("  正文合计 %d 字 ≈ %d token" % (
            sum(len(str(e["content"])) for e in entries),
            sum(M.est_tokens(str(e["content"])) for e in entries)))
        return kind, data, body

    fields = [
        ("name", "名字"), ("creator", "作者"), ("character_version", "版本"),
        ("description", "角色描述 Description"), ("personality", "性格 Personality"),
        ("scenario", "场景 Scenario"), ("first_mes", "开场白 First Message"),
        ("mes_example", "对话示例 Example Messages"),
        ("system_prompt", "系统提示词 System Prompt"),
        ("post_history_instructions", "历史后置指令 Post-History"),
        ("creator_notes", "作者备注 Creator Notes"),
    ]
    out("-" * 78)
    out("【角色字段】")
    total = 0
    for key, label in fields:
        val = body.get(key, "")
        if isinstance(val, list):
            val = "\n".join(str(v) for v in val)
        val = (val or "").strip()
        total += len(val)
        out("  %-26s %6d 字  ≈%5d token" % (label, len(val), M.est_tokens(val)))

    tags = body.get("tags") or []
    alts = body.get("alternate_greetings") or []
    out("  %-26s %s" % ("标签 tags", tags if tags else "（无）"))
    out("  %-26s %d 个" % ("备选开场白", len(alts)))
    for i, a in enumerate(alts, 1):
        out("        [%d] %d 字" % (i, len(str(a))))

    book = body.get("character_book") or data.get("character_book")
    entries = normalize_entries(book)
    out("-" * 78)
    if entries:
        out("【内嵌世界书】共 %d 条" % len(entries))
        if isinstance(book, dict) and book.get("name"):
            out("  世界书名称：%s" % book["name"])
        print_book_table(entries, out)
        out("  世界书正文合计 %d 字 ≈ %d token" % (
            sum(len(str(e.get("content") or "")) for e in entries),
            sum(M.est_tokens(str(e.get("content") or "")) for e in entries)))
    else:
        out("【内嵌世界书】无")
    return kind, data, body


def _analyze_eleckoi(data, out):
    lib = _obj(data.get("setting_library"))
    vc = _obj(data.get("variable_config"))
    act = _pick(lib.get("versions", []) or [], lib.get("active_version_id"))
    va = _pick(vc.get("versions", []) or [], vc.get("active_version_id"))
    out("-" * 78)
    out("  %-26s %s" % ("名字", (data.get("character", {}) or {}).get("name", "")))
    out("  %-26s %d 条 / %d 组" % ("设定库", len(act.get("entries", []) or []),
                                   len(act.get("groups", []) or [])))
    out("  %-26s %d 个对象 / %d 个变量" % ("变量",
                                           len(va.get("objects", []) or []),
                                           len(va.get("variables", []) or [])))
    out("  %-26s %d 条" % ("正则", len(data.get("regex_rules", []) or [])))
    # 开场白其实也是设定库里的一条（kind=opening）—— 单独拎出来说一句。
    # 不然它混在「设定库 N 条」里数不出来，复核成品卡时找不到它在哪
    # （盲跑的最后一问：「成品卡的开场白」到底怎么看）。
    开场 = [e for e in (act.get("entries") or [])
            if str(e.get("kind") or "") == "opening"]
    if 开场:
        o = 开场[0]
        正文 = str(o.get("content") or "")
        尾 = len(正文) - len(正文.rstrip("\u200b"))
        out("  %-26s %d 字%s" % ("开场白", len(正文.rstrip("\u200b")),
                                "（末尾零宽标记 %d 个）" % 尾 if 尾 else
                                "（⚠ 末尾没有建卡标记，界面可能不出现）"))
        方案 = o.get("opening_messages") or []
        if len(方案) > 1:
            out("  %-26s %d 个" % ("开场白备选方案", len(方案)))
    else:
        out("  %-26s （没有开场白条目）" % "开场白")
    chars = sum(len(e.get("content") or "") for e in act.get("entries", []) or [])
    out("  设定库正文合计 %d 字 ≈ %d token" % (chars, M.est_tokens("x" * chars)))


def print_book_table(entries, out=print):
    out("  %-3s %-22s %-8s %-6s %-16s %-6s %-6s %s"
        % ("#", "标题", "触发", "关键词", "插入位置", "顺序", "概率", "字数"))
    for i, e in enumerate(entries, 1):
        if not e["enabled"]:
            trig = "已禁用"
        elif e["constant"]:
            trig = "常驻"
        elif e["keys"]:
            trig = "关键词"
        else:
            trig = "无键"
        pos = e["position"]
        if isinstance(pos, (int, float)) and not isinstance(pos, bool):
            posname = ST_POSITION_NUM.get(int(pos), "位置%s" % pos)
        elif isinstance(pos, str):
            posname = ST_POSITION.get(pos, pos or "—")
        else:
            posname = "—"
        if e.get("depth") not in (None, ""):
            posname += "/深度%s" % e["depth"]
        title = str(e["title"])
        if len(title) > 20:
            title = title[:19] + "…"
        out("  %-3d %-22s %-8s %-6s %-16s %-6s %-6s %d"
            % (i, title, trig, len(e["keys"]), posname,
               e["order"] if e["order"] is not None else "-",
               e["probability"] if e["probability"] is not None else "-",
               len(str(e["content"]))))
    const = sum(1 for e in entries if e["constant"])
    out("  合计：%d 条（常驻 %d 条，关键词 %d 条，共 %d 个关键词）"
        % (len(entries), const, len(entries) - const,
           sum(len(e["keys"]) for e in entries)))


# ------------------------------------------------------------------ 转 ElecKoi
def to_eleckoi(path, out_spec, out=print):
    """酒馆卡 -> ElecKoi 规格（spec.yaml）。

    若这张酒馆卡是 forge to-tavern 导出的（data.extensions.eleckoi 里有存档），
    会走「回迁」：变量、分组、正则、未映射字段、条目 id 全取回来，
    ElecKoi -> 酒馆 -> ElecKoi 不掉东西。条目正文以酒馆侧的当前内容为准。
    """
    kind, data, _ = load_any(path)
    if kind == "eleckoi":
        out("这本来就是 ElecKoi 卡，直接用 forge unpack 拆开即可。")
        return None
    if kind == "unknown":
        raise ValueError("认不出这是什么结构，不猜。请确认是酒馆 V2/V3 卡或世界书。")

    body = card_body(data)
    now = M.now_iso()
    name = str(body.get("name") or os.path.splitext(os.path.basename(path))[0])

    # 反向导出的存档：有它就能无损回迁
    restore = _restore_payload(body)
    id_map = {}
    if restore:
        for row in restore.get("entry_map") or []:
            t = str(row.get("title") or "").strip()
            if t:
                id_map.setdefault(t, row)

    if restore and restore.get("groups"):
        groups = [M.ordered(g, M.GROUP_KEYS) for g in restore["groups"]]
    else:
        groups = [
            _group("grp-opening-wrap", "开场", 0),
            _group("grp-core", "核心", 1),
            _group("grp-world", "世界书", 2),
            _group("grp-ref", "参考", 3),
        ]
    gids = {g.get("id") for g in groups}
    core_gid = "grp-core" if "grp-core" in gids else (groups[0].get("id") if groups else "")
    ref_gid = "grp-ref" if "grp-ref" in gids else core_gid

    entries = []
    order = 0
    seq_hint = {}          # 条目 -> 原设定库里的位次（回迁时照它排回原顺序）

    def add(title, content, *, trigger="agent_tool", strategy="normal",
            keywords=None, position="", role="user", hint="", group="", enabled=True):
        nonlocal order
        order += 1
        row = id_map.get(str(title).strip()) or {}
        use_order = row.get("order") or order
        e = OrderedDict()
        e.update({
            "id": row.get("eleckoi_id") or M.new_id("entry"), "title": title,
            "icon_id": row.get("icon_id") or "",
            "kind": row.get("kind") or "normal",
            "group_id": row.get("group_id") or group,
            "content": content,
            "opening_messages": [], "default_opening_message_id": "",
            "agent_selection_hint": row.get("agent_selection_hint") or hint,
            "agent_read_strategy": row.get("agent_read_strategy") or strategy,
            "dynamic_mode": row.get("dynamic_mode") or "standard",
            "keywords": row.get("keywords") or keywords or [],
            "keyword_scan_depth": row.get("keyword_scan_depth", 6),
            "condition_keywords": row.get("condition_keywords") or [],
            "keyword_condition": row.get("keyword_condition") or "none",
            "keyword_use_regex": bool(row.get("keyword_use_regex")),
            "keyword_ignore_case": bool(row.get("keyword_ignore_case", True)),
            "keyword_whole_word": bool(row.get("keyword_whole_word")),
            "keyword_recursion_depth": row.get("keyword_recursion_depth", 0),
            "trigger_mode": row.get("trigger_mode") or trigger,
            "enabled": bool(row.get("enabled", enabled)),
            "position": row["position"] if "position" in row else position,
            "prompt_position_id": "",
            "insert_role": row.get("insert_role") or role,
            "order": use_order,
            "view_order": row.get("view_order", 0),
            "group_view_order": row.get("group_view_order", 0),
            "tree_view_order": row.get("tree_view_order", use_order),
            "created_at": now, "updated_at": now,
        })
        entries.append(e)
        if row.get("seq") is not None:
            seq_hint[id(e)] = row["seq"]

    # 固定开场白条目（永远第一条）
    # 开场白在世界书里没有对应条目，回迁时靠存档还原 id / 标题 / 顺序 / 参数；
    # 正文仍以酒馆侧的 first_mes 与备选开场为准。
    oa = (restore or {}).get("opening") or {}
    arch_msgs = oa.get("opening_messages") or []

    def _arch(i):
        return arch_msgs[i] if i < len(arch_msgs) else {}

    openings = []
    if str(body.get("first_mes") or "").strip():
        a = _arch(0)
        openings.append(OrderedDict([
            ("id", a.get("id") or "opening-default"),
            ("title", a.get("title") or "默认开场"),
            ("content", str(body["first_mes"])),
            ("initial_variable_state", a.get("initial_variable_state", "")),
        ]))
    for i, alt in enumerate(body.get("alternate_greetings") or [], 1):
        if str(alt).strip():
            a = _arch(i)
            openings.append(OrderedDict([
                ("id", a.get("id") or ("opening-alt-%d" % i)),
                ("title", a.get("title") or ("备选开场 %d" % i)),
                ("content", str(alt)),
                ("initial_variable_state", a.get("initial_variable_state", "")),
            ]))

    arch_default = oa.get("default_opening_message_id", "")
    dflt_id = arch_default if any(m["id"] == arch_default for m in openings) else ""
    dflt_id = dflt_id or (openings[0]["id"] if openings else "")

    opening_entry = OrderedDict([
        ("id", oa.get("id") or "fixed-opening-assistant"),
        ("title", oa.get("title") or "AI角色开场白"),
        ("icon_id", oa.get("icon_id") or "chat"),
        ("kind", "opening"),
        ("group_id", oa.get("group_id", "")),
        # 正文取「默认方案」那一份，别留空：`oa` 只有走存档回迁时才有 content，
        # 直接转换时它是 {} —— 于是开场白条目**content 空着**，正文只躺在
        # opening_messages 里。后果是接界面时（`new --从` / `hud --写回`）拿不到正文，
        # 开场白被骨架那条占位顶掉，而 check 一个字都不报。
        ("content", oa.get("content") or (openings[0]["content"] if openings else "")),
        ("opening_messages", openings),
        ("default_opening_message_id", dflt_id),
        ("agent_selection_hint", ""),
        ("agent_read_strategy", oa.get("agent_read_strategy") or "normal"),
        ("dynamic_mode", "standard"), ("keywords", []), ("keyword_scan_depth", 1),
        ("condition_keywords", []), ("keyword_condition", "none"),
        ("keyword_use_regex", False), ("keyword_ignore_case", True),
        ("keyword_whole_word", False), ("keyword_recursion_depth", 0),
        ("trigger_mode", oa.get("trigger_mode") or "always"), ("enabled", True),
        ("position", oa.get("position", "")),
        ("prompt_position_id", ""),
        ("insert_role", oa.get("insert_role") or "assistant"),
        ("order", oa.get("order", 0)),
        ("view_order", oa.get("view_order", 0)),
        ("group_view_order", oa.get("group_view_order", 0)),
        ("tree_view_order", oa.get("tree_view_order", 0)),
        ("created_at", now), ("updated_at", now),
    ])

    # 角色字段 -> 核心条目（常驻）
    if str(body.get("system_prompt") or "").strip():
        add("核心 · 系统提示词", str(body["system_prompt"]), trigger="always",
            strategy="normal", position="instructions", role="system", group=core_gid)

    desc_text = str(body.get("description") or "")
    if desc_text.strip():
        if restore:
            # 回迁：description 里装的是当初合并进去的常驻系统块，按「## 标题」拆回来
            for title, content in _split_description(desc_text):
                add(title, content, trigger="always", strategy="normal",
                    position="instructions", role="system", group=core_gid)
        else:
            add("核心 · 角色描述", desc_text, trigger="always", strategy="normal",
                position="instructions", role="system", group=core_gid)

    for key, title in (("personality", "核心 · 性格"),
                       ("scenario", "核心 · 场景"),
                       ("post_history_instructions", "核心 · 历史后置指令")):
        if str(body.get(key) or "").strip():
            add(title, str(body[key]), trigger="always", strategy="normal",
                position="instructions", role="system", group=core_gid)

    if str(body.get("mes_example") or "").strip():
        add("参考 · 对话示例", str(body["mes_example"]), group=ref_gid,
            hint="需要模仿说话腔调、确认输出格式时读取。")

    # 世界书条目
    for e in normalize_entries(body.get("character_book")):
        content = str(e["content"])
        if not content.strip():
            continue
        kw = [str(k) for k in e["keys"] if str(k).strip()]
        const = e["constant"]
        raw_title = str(e["title"]).strip()
        # 回迁时用原标题（好让 id_map 认得出来），否则加个前缀并截断
        title = raw_title if raw_title in id_map else ("世界书 · %s" % raw_title)[:60]
        # 有键才走 keyword；非常驻又没键 = 原卡里的「AI 自选读」，对应 normal
        add(title, content,
            trigger="always" if const else "agent_tool",
            strategy="normal" if (const or not kw) else "keyword",
            keywords=[] if const else kw,
            position="instructions" if const else "",
            role="system" if const else "user",
            group="grp-world" if "grp-world" in gids else core_gid,
            enabled=e["enabled"],
            hint="" if const else ("涉及 %s 时读取。" % "、".join(kw[:6]) if kw
                                   else "%s 相关时读取。" % raw_title[:20]))

    # ---- 组装 spec（回迁时把存档里的变量 / 正则 / 未映射字段取回来）
    if seq_hint:
        entries.sort(key=lambda x: seq_hint.get(id(x), 10 ** 6))

    lib_meta = (restore or {}).get("library_meta") or {}
    tags = "、".join(str(t) for t in (body.get("tags") or []))

    spec = OrderedDict()
    spec["format"] = M.CARD_FORMAT
    spec["version"] = (restore or {}).get("version", 1) or 1

    char_out = OrderedDict([
        ("name", name), ("group", tags),
        ("frontend_beauty_enabled", False), ("profile_age", ""), ("profile_sex", ""),
        ("profile_height", ""), ("profile_birthday", ""), ("profile_like", ""),
        ("image_prompt", ""), ("opening", ""), ("show_opening", False),
    ])
    for k, v in ((restore or {}).get("character") or {}).items():
        if k in char_out and k not in ("name", "group"):
            char_out[k] = v
    spec["character"] = M.ordered(char_out, M.CHARACTER_KEYS)
    spec["assets"] = []
    spec["library"] = OrderedDict([
        ("snapshot_format", M.LIB_FORMAT), ("snapshot_version", 1),
        ("active_version_id", lib_meta.get("active_version_id") or M.new_id("library")),
        ("version_name", lib_meta.get("version_name", "")),
        ("list_all_expanded", lib_meta.get("list_all_expanded", True)),
        ("expanded_group_ids", lib_meta.get("expanded_group_ids", []) or []),
        ("prompt_positions", lib_meta.get("prompt_positions", []) or []),
        ("created_at", now), ("updated_at", now),
        ("groups", groups), ("entries", [opening_entry] + entries),
    ])
    if restore and restore.get("variable_config"):
        spec["variables"] = _variables_from_config(restore["variable_config"], now)
    else:
        spec["variables"] = OrderedDict([
            ("config_format", M.VAR_FORMAT), ("config_version", 1),
            ("character_id", M.new_id("character")), ("name", ""), ("version_name", ""),
            ("active_version_id", "variable-config-default"),
            ("initial_state", {}), ("schema_code", ""), ("objects", []),
            ("variables", []), ("expanded_object_ids", []),
            ("created_at", ""), ("updated_at", ""), ("config_updated_at", now),
        ])
    spec["regex_rules"] = [M.ordered(r, M.REGEX_KEYS)
                           for r in ((restore or {}).get("regex_rules") or [])]

    M.ydump(spec, out_spec)

    out("已转换 -> %s" % out_spec)
    if restore:
        out("  ↻ 回迁模式：这张卡是 ElecKoi 制卡工具导出的，已从 data.extensions.eleckoi 取回")
        out("    变量 %d 项 / 分组 %d 个 / 正则 %d 条 / 条目 id 与顺序。"
            % (len(spec["variables"].get("variables") or []), len(groups),
               len(spec["regex_rules"])))
        out("    条目正文以酒馆侧当前内容为准（你在酒馆里改过的会被带上）。")
    out("  条目 %d 条（含开场白）· 分组 %d 个 · 开场方案 %d 套"
        % (len(entries) + 1, len(groups), len(openings)))
    out("")
    if not restore:
        out("注意：酒馆和 ElecKoi 不是一一对应，以下三处要人工确认——")
        out("  1. 酒馆有 8 个插入位置，这里只按「强约束 → instructions / 其余留空」粗略映射，")
        out("     导入后请在软件里按需调整（常驻条目位置空着会被过滤掉）。")
        out("  2. 酒馆的「概率触发」「包含组」「向量匹配」「递归扫描」在 ElecKoi 侧没有等价字段，未转换。")
        out("  3. 变量需要在 ElecKoi 里重新定义（酒馆卡通常不变量化）。")
        out("")
    out("下一步： python forge.py check %s" % out_spec)
    return out_spec


# ------------------------------------------------------------------ 回迁支持
def _restore_payload(body):
    """取出 to-tavern 写下的存档（data.extensions.eleckoi）。没有就返回 None。"""
    ext = body.get("extensions")
    if not isinstance(ext, dict):
        return None
    e = ext.get("eleckoi")
    if not isinstance(e, dict) or e.get("format") != M.CARD_FORMAT:
        return None
    return e


def _split_description(text):
    """把 to-tavern 合并进 description 的常驻系统块按「## 标题」拆回来。

    只认二级标题：作者自己写的正文里若有 ## 会一起被拆，所以这个函数只在
    「确认是自家导出的卡」(restore 模式) 时才调用。
    """
    text = str(text or "")
    if not text.strip():
        return []
    parts = re.split(r"(?m)^##[ \t]+", text)
    out = []
    for p in parts:
        if not p.strip():
            continue
        seg = p.split("\n\n", 1)
        title = seg[0].strip()
        content = seg[1] if len(seg) > 1 else ""
        # 块与块之间的 "\n\n" 是导出时拼进去的分隔符，还回去
        if content.endswith("\n\n"):
            content = content[:-2]
        if title:
            out.append((title, content))
    return out


def _variables_from_config(vc, now):
    """把存档里的整份 variable_config 还原成 spec 的 variables 段。"""
    if isinstance(vc, str):
        try:
            vc = json.loads(vc)
        except Exception:
            vc = {}
    vc = vc or {}
    versions = vc.get("versions") or []
    act = _pick(versions, vc.get("active_version_id")) or {}
    return OrderedDict([
        ("config_format", vc.get("format", M.VAR_FORMAT)),
        ("config_version", vc.get("version", 1)),
        ("character_id", vc.get("character_id", "")),
        ("name", vc.get("name", "")),
        ("version_name", act.get("name", vc.get("name", ""))),
        ("active_version_id", act.get("id") or vc.get("active_version_id")
         or "variable-config-default"),
        ("initial_state", act.get("initial_state", {}) or {}),
        ("schema_code", act.get("schema_code", "") or ""),
        ("objects", [M.ordered(o, M.VAR_OBJECT_KEYS) for o in (act.get("objects") or [])]),
        ("variables", [M.ordered(v, M.VAR_ITEM_KEYS) for v in (act.get("variables") or [])]),
        ("expanded_object_ids", act.get("expanded_object_ids", []) or []),
        ("created_at", act.get("created_at", "")),
        ("updated_at", act.get("updated_at", "")),
        ("config_updated_at", vc.get("updated_at", now)),
    ])


def _group(gid, name, order):
    return OrderedDict([("id", gid), ("name", name), ("parent_id", ""),
                        ("order", order), ("tree_view_order", order),
                        ("created_at", ""), ("updated_at", "")])


def _obj(raw):
    if isinstance(raw, str):
        try:
            return json.loads(raw) or {}
        except Exception:
            return {}
    return raw if isinstance(raw, dict) else {}


def _pick(versions, active_id):
    for v in versions:
        if v.get("id") == active_id:
            return v
    return versions[0] if versions else {}
