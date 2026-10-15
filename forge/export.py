# -*- coding: utf-8 -*-
"""forge.export —— ElecKoi 卡 -> 酒馆（SillyTavern）V2 卡。

为什么要有反向这一条：只有单向（酒馆 -> ElecKoi）时，一旦你在 ElecKoi 里把卡
改好了，就再也回不去酒馆 —— 人会被锁死在一边。有来有回，两边才是同一个东西的
两种外壳。

映射规约（重要，决定了「换过去还能不能用」）：

    常驻 + insert_role=system  ->  并进 data.description
        酒馆里没有「常驻条目」这种一等公民，真正每轮都进提示的只有 description /
        system_prompt 这几格。把常驻系统块并进去，它们在酒馆里才是真的每轮生效。
    常驻 + 其他 role           ->  character_book 条目，constant=true
    非常驻 + 有关键词          ->  character_book 条目，keys=关键词，constant=false
    非常驻 + 无关键词          ->  character_book 条目，keys=[]（⚠ 酒馆不会自动触发它）
        酒馆表达不了「AI 自己决定读哪份」，这一条是真实的能力缺口，报告里会点数。
    开场白                     ->  first_mes + alternate_greetings
    变量 / 分组 / 未映射字段   ->  extensions.eleckoi（原样存着，回迁时取回）

回迁：forge to-eleckoi 认得出 data.extensions.eleckoi，会把它里面的字段并回去，
所以「ElecKoi -> 酒馆 -> ElecKoi」不会把变量和分组丢掉。

⚠️ 转换只做能确定的映射。做不到的一律如实说明，不猜、不假装。
"""
from __future__ import annotations

import json
import os
from collections import OrderedDict

from . import model as M
from . import pack as P

# ElecKoi insert_role -> 酒馆 extensions.role
ST_ROLE = {"system": 0, "user": 1, "assistant": 2}
# 展示顺序用的 position（0=角色定义前，1=角色定义后）
ST_POS_NUM = {"before_char": 0, "after_char": 1, "before_an": 2, "after_an": 3,
              "at_depth": 4}
# ElecKoi keyword_condition -> 酒馆 selectiveLogic
ST_SELECTIVE = {"none": 0, "any": 0, "all": 3, "not_any": 2}
# ElecKoi regex targets -> 酒馆 placement（1=用户输入，2=AI 输出）
ST_PLACEMENT = {"UserInput": 1, "AiOutput": 2}


# ------------------------------------------------------------------ 主流程
def to_tavern(card_path, out_path, keep_raw=False, out=print):
    """ElecKoi 卡 -> 酒馆 V2 卡。返回写出路径。"""
    card = M.jload(card_path)
    if not str(card.get("format", "")).startswith("eleckoi."):
        raise ValueError("这不是 ElecKoi 卡（format=%r）。反向导出只认 ElecKoi 卡；"
                         "若想拆解酒馆卡，请用 forge analyze。"
                         % card.get("format", ""))

    char = card.get("character", {}) or {}
    lib = P.active_library(card)
    var = P.active_variables(card)
    entries = lib.get("entries", []) or []
    groups = lib.get("groups", []) or []
    gname = {g.get("id"): g.get("name", "") for g in groups}

    name = str(char.get("name") or "").strip() or \
        os.path.splitext(os.path.basename(card_path))[0]

    # ---- 开场白
    first_mes, alts = _openings(entries)

    # ---- 条目分流
    desc_parts, book_entries, untriggered = [], [], []
    meta_rows = []          # 回迁用的「原条目身份证」
    book_id = 0
    for e in entries:
        if e.get("kind") == "opening":
            continue
        if not e.get("enabled", True):
            continue
        content = str(e.get("content") or "")
        if not content.strip():
            continue
        title = str(e.get("title") or "(无标题)").strip()
        trigger = e.get("trigger_mode", "always")
        role = e.get("insert_role", "user")
        keys = [str(k) for k in (e.get("keywords") or []) if str(k).strip()]
        const = (trigger == "always")

        if const and role == "system":
            desc_parts.append("## %s\n\n%s" % (title, content))
            meta_rows.append(_meta_row(e, title, "desc", seq=len(meta_rows)))
            continue

        book_id += 1
        pos = "before_char" if role == "system" else "after_char"
        st_entry = OrderedDict([
            ("id", book_id),
            ("keys", [] if const else keys),
            ("secondary_keys", [str(k) for k in (e.get("condition_keywords") or [])]),
            ("comment", title),
            ("content", content),
            ("constant", bool(const)),
            ("selective", bool(not const and keys)),
            ("insertion_order", int(e.get("order") or book_id)),
            ("enabled", True),
            ("position", pos),
            ("use_regex", bool(e.get("keyword_use_regex"))),
            ("extensions", _st_entry_ext(e, role, pos)),
        ])
        book_entries.append(st_entry)
        meta_rows.append(_meta_row(e, title, "book", tavern_id=book_id,
                                   seq=len(meta_rows)))
        if not const and not keys:
            untriggered.append(title)

    # ---- 组装
    data = OrderedDict()
    data["name"] = name
    data["description"] = "\n\n".join(desc_parts) or str(char.get("opening") or "")
    data["personality"] = ""
    data["scenario"] = ""
    data["first_mes"] = first_mes
    data["mes_example"] = _pick_example(entries)
    data["creator_notes"] = _creator_notes(char, groups, entries)
    data["system_prompt"] = ""
    data["post_history_instructions"] = ""
    data["alternate_greetings"] = alts
    data["character_book"] = _book(name, book_entries)
    data["tags"] = [t.strip() for t in str(char.get("group") or "").split("、") if t.strip()]
    data["creator"] = ""
    data["character_version"] = ""
    data["extensions"] = OrderedDict([
        ("eleckoi", _eleckoi_payload(card, char, groups, meta_rows,
                                     raw=(card if keep_raw else None))),
        ("regex_scripts", _regex_scripts(card.get("regex_rules", []) or [])),
    ])

    tavern = OrderedDict([
        ("spec", "chara_card_v2"),
        ("spec_version", "2.0"),
        ("data", data),
    ])
    # chara_card_v3 会在顶层再抄一份 data（酒馆两种都认，V2 更通用）
    M.jdump(tavern, out_path)

    # ---- 报告
    chars = sum(len(str(e.get("content") or "")) for e in entries)
    out("已导出 -> %s" % out_path)
    out("  名字      : %s" % name)
    out("  开场白    : 默认 1 套 + 备选 %d 套" % len(alts))
    out("  description 收进常驻系统块 %d 条（%d 字）"
        % (len(desc_parts), sum(len(p) for p in desc_parts)))
    out("  世界书条目: %d 条（常驻 %d / 关键词 %d）"
        % (len(book_entries),
           sum(1 for b in book_entries if b["constant"]),
           sum(1 for b in book_entries if not b["constant"])))
    out("  正则脚本  : %d 条" % len(card.get("regex_rules", []) or []))
    out("  变量      : %d 个对象 / %d 个变量（存进 extensions，酒馆没有变量系统）"
        % (len(var.get("objects", []) or []), len(var.get("variables", []) or [])))
    out("  设定库正文合计 %d 字 ≈ %d token" % (chars, M.est_tokens("x" * chars)))
    out("")

    if untriggered:
        out("⚠️ 有 %d 条「按需但没写关键词」的条目，酒馆不会自动触发它们：" % len(untriggered))
        for t in untriggered[:8]:
            out("     · %s" % t)
        if len(untriggered) > 8:
            out("     …… 另有 %d 条" % (len(untriggered) - 8))
        out("   → 二选一：在酒馆里给这些条目补关键词；或把它们改成常驻"
            "（constant=true，代价是每轮都占上下文）。")
        out("   根因：ElecKoi 有「由 AI 自己选读」这一档（agent_tool + normal），"
            "酒馆没有对应能力 —— 这是真实的能力缺口，不是转换漏了。")
        out("")

    out("注意：")
    out("  1. 变量、分组、character 的 profile_* 等未映射字段都存进了 "
        "data.extensions.eleckoi，")
    out("     用 forge to-eleckoi 转回来时会取回（往返不丢东西）。")
    out("  2. 酒馆没有 `%s` 这种「嵌套 JSON 字符串」结构，"
        "转回去时由本工具重新组装。" % "setting_library")
    out("  3. 想把卡发到酒馆，通常还要一张 PNG 头像：把这份 JSON 导入酒馆后另存即可。")
    return out_path


# ------------------------------------------------------------------ 各段
def _openings(entries):
    """从开场白条目里取出默认开场与备选。"""
    first, alts = "", []
    for e in entries:
        if e.get("kind") != "opening":
            continue
        msgs = e.get("opening_messages") or []
        if not msgs:
            continue
        dflt = e.get("default_opening_message_id") or ""
        chosen = None
        for m in msgs:
            if m.get("id") == dflt:
                chosen = m
                break
        chosen = chosen or msgs[0]
        first = str(chosen.get("content") or "").strip()
        for m in msgs:
            if m is chosen:
                continue
            c = str(m.get("content") or "").strip()
            if c:
                alts.append(c)
        break
    return first, alts


def _pick_example(entries):
    """挑一条「对话示例」当 mes_example。"""
    for e in entries:
        if e.get("kind") == "opening":
            continue
        title = str(e.get("title") or "")
        if "示例" in title and "对话" in title:
            return str(e.get("content") or "").strip()
    return ""


def _creator_notes(char, groups, entries):
    lines = ["由 ElecKoi 制卡工具导出。", ""]
    if groups:
        lines.append("分组：" + "、".join(str(g.get("name") or "") for g in groups))
    nm = str(char.get("name") or "")
    prof = []
    for key, label in (("profile_age", "年龄"), ("profile_sex", "性别"),
                       ("profile_height", "身高"), ("profile_birthday", "生日"),
                       ("profile_like", "喜好")):
        v = str(char.get(key) or "").strip()
        if v:
            prof.append("%s：%s" % (label, v))
    if prof:
        lines.append("角色档案：" + "；".join(prof))
    if nm:
        lines.append("")
        lines.append("原卡名：%s" % nm)
    return "\n".join(lines).strip()


def _book(name, entries):
    return OrderedDict([
        ("name", "%s · 设定库" % name),
        ("description", "由 ElecKoi 制卡工具导出。常驻条目 = constant=true。"),
        ("scan_depth", 4),
        ("token_budget", 2048),
        ("recursive_scanning", False),
        ("extensions", {}),
        ("entries", entries),
    ])


def _st_entry_ext(e, role, pos):
    """酒馆条目那条又长又死的 extensions（版本不同字段会多会少，写全更稳）。"""
    return OrderedDict([
        ("position", ST_POS_NUM.get(pos, 1)),
        ("exclude_recursion", bool(e.get("keyword_recursion_depth") in (0, None))),
        ("display_index", 0),
        ("probability", 100),
        ("useProbability", True),
        ("depth", int(e.get("keyword_scan_depth") or 4)),
        ("selectiveLogic", ST_SELECTIVE.get(str(e.get("keyword_condition") or "none"), 0)),
        ("group", str(e.get("group_id") or "")),
        ("group_override", False),
        ("group_weight", 100),
        ("prevent_recursion", True),
        ("delay_until_recursion", False),
        ("scan_depth", None),
        ("match_whole_words", bool(e.get("keyword_whole_word")) if e.get("keyword_whole_word") else None),
        ("use_group_scoring", False),
        ("case_sensitive", None if e.get("keyword_ignore_case", True) else True),
        ("automation_id", ""),
        ("role", ST_ROLE.get(role, 1)),
        ("vectorized", False),
        ("sticky", 0),
        ("cooldown", 0),
        ("delay", 0),
        ("eleckoi", OrderedDict([
            ("id", e.get("id", "")),
            ("agent_read_strategy", e.get("agent_read_strategy", "normal")),
            ("agent_selection_hint", e.get("agent_selection_hint", "")),
            ("insert_role", role),
            ("order", e.get("order")),
        ])),
    ])


def _meta_row(e, title, kind, tavern_id=None, seq=None):
    """一条原条目的「身份证」：回迁时凭标题找回 id / 分组 / 顺序 / 全部字段。"""
    return OrderedDict([
        ("seq", seq),                         # 原条目在设定库里的位次，回迁时照它排
        ("eleckoi_id", e.get("id", "")),
        ("title", title),
        ("icon_id", e.get("icon_id", "")),
        ("group_id", str(e.get("group_id") or "")),
        ("order", e.get("order")),
        ("view_order", e.get("view_order", 0)),
        ("group_view_order", e.get("group_view_order", 0)),
        ("tree_view_order", e.get("tree_view_order", 0)),
        ("bin", kind),                        # desc = 并进了 description；book = 世界书条目
        ("tavern_id", tavern_id),
        ("trigger_mode", e.get("trigger_mode", "always")),
        ("agent_read_strategy", e.get("agent_read_strategy", "normal")),
        ("agent_selection_hint", e.get("agent_selection_hint", "")),
        ("insert_role", e.get("insert_role", "user")),
        ("position", e.get("position", "")),
        ("enabled", bool(e.get("enabled", True))),
        ("keywords", list(e.get("keywords") or [])),
        ("condition_keywords", list(e.get("condition_keywords") or [])),
        ("keyword_condition", e.get("keyword_condition", "none")),
        ("keyword_use_regex", bool(e.get("keyword_use_regex", False))),
        ("keyword_ignore_case", bool(e.get("keyword_ignore_case", True))),
        ("keyword_whole_word", bool(e.get("keyword_whole_word", False))),
        ("keyword_recursion_depth", e.get("keyword_recursion_depth", 0)),
        ("keyword_scan_depth", e.get("keyword_scan_depth", 1)),
        ("dynamic_mode", e.get("dynamic_mode", "standard")),
        ("kind", e.get("kind", "normal")),
    ])


def _opening_arch(entries):
    """开场白条目的存档：它在世界书里没有对应条目，不存就丢了。"""
    for e in entries:
        if e.get("kind") != "opening":
            continue
        return OrderedDict([
            ("id", e.get("id", "")),
            ("title", e.get("title", "")),
            ("icon_id", e.get("icon_id", "")),
            ("group_id", str(e.get("group_id") or "")),
            ("order", e.get("order")),
            ("view_order", e.get("view_order", 0)),
            ("group_view_order", e.get("group_view_order", 0)),
            ("tree_view_order", e.get("tree_view_order", 0)),
            ("content", e.get("content", "")),
            ("default_opening_message_id", e.get("default_opening_message_id", "")),
            ("agent_read_strategy", e.get("agent_read_strategy", "normal")),
            ("trigger_mode", e.get("trigger_mode", "always")),
            ("insert_role", e.get("insert_role", "assistant")),
            ("opening_messages", [
                M.ordered(m, M.ENTRY_MESSAGE_KEYS)
                for m in (e.get("opening_messages") or [])]),
        ])
    return None


def _eleckoi_payload(card, char, groups, meta_rows, raw=None):
    """回迁所需的一切：变量、分组、未映射字段、条目身份证。"""
    canonical = str(card.get("format", "")).startswith("eleckoi.")
    act = P.active_library(card) or {}
    payload = OrderedDict([
        ("format", M.CARD_FORMAT),
        ("version", card.get("version", 1)),
        ("character", OrderedDict((k, v) for k, v in char.items()
                                  if k not in ("name", "group"))),
        ("groups", groups),
        ("variable_config", P.raw_variable_config(card)),
        ("regex_rules", card.get("regex_rules", []) or []),
        ("library_meta", OrderedDict([
            ("active_version_id", act.get("id", "")),
            ("version_name", act.get("name", "")),
            ("prompt_positions", act.get("prompt_positions", []) or []),
            ("expanded_group_ids", act.get("expanded_group_ids", []) or []),
            ("list_all_expanded", act.get("list_all_expanded", True)),
        ])),
        ("entry_map", meta_rows),
        ("opening", _opening_arch((P.active_library(card) or {}).get("entries") or [])),
        ("note", "本字段由 ElecKoi 制卡工具写入，用于无损回迁；酒馆不读它。"),
    ])
    if raw and canonical:
        payload["source_card"] = raw
    return payload


def _regex_scripts(rules):
    out = []
    for r in rules:
        targets = r.get("targets") or []
        placement = sorted({ST_PLACEMENT.get(str(t), 2) for t in targets}) or [2]
        out.append(OrderedDict([
            ("id", str(r.get("id") or "")),
            ("scriptName", str(r.get("name") or "")),
            ("findRegex", str(r.get("pattern") or "")),
            ("replaceString", str(r.get("replacement") or "")),
            ("trimStrings", []),
            ("placement", placement),
            ("disabled", not bool(r.get("enabled", True))),
            ("markdownOnly", bool(r.get("display_only", False))),
            ("promptOnly", bool(r.get("prompt_only", False))),
            ("runOnEdit", bool(r.get("run_on_edit", False))),
            ("substituteRegex", 0),
            ("minDepth", None),
            ("maxDepth", None),
            ("extensions", OrderedDict([("order", r.get("order", 0)),
                                        ("eleckoi_targets", targets)])),
        ]))
    return out
