# -*- coding: utf-8 -*-
"""forge.pack —— spec.yaml ⇄ card.json 打包与解包。

为什么需要这一层：ElecKoi 的卡把「设定库」和「变量」各自压成了一坨 JSON 字符串，
手改极易错位（少一个引号、顺序乱了，软件就静默读不到）。本模块把它拆成人可读的
YAML（唯一真相），再原样打包回去。

设计约定：
    · spec.yaml 是唯一真相，card.json 是派生物 —— 只手改 spec，别手改卡。
    · 不认识的字段一律原样保留，不丢东西。
    · 键序与官方一致（见 model.ENTRY_KEYS 等）。
"""
from __future__ import annotations

import json
import os
from collections import OrderedDict

from . import model as M
from . import sandbox as SB

KEEP_LIB_VERSIONS = "#其它版本(原样保留)"
KEEP_VAR_VERSIONS = "#其它版本(原样保留)"
KEEP_TOP_EXTRA = "#其它顶层字段(原样保留)"

_KNOWN_TOP = {"format", "version", "character", "assets",
              "setting_library", "variable_config", "regex_rules"}


# ------------------------------------------------------------------ unpack
def unpack(card_path, out_path=None):
    """卡片 -> 可读 YAML 规格。返回写出的 spec 路径。"""
    card = M.jload(card_path)

    # ---- 认卡守卫：**先确认它是个 ElecKoi 卡，再动手**
    #
    #  这道守卫是给「先试 ElecKoi 解包、不成就按酒馆卡转」那条路用的（`import`、
    #  `new --从`）。少了它，一张酒馆卡会**解包成功**地变成空工程 —— 酒馆卡没有
    #  setting_library / character / variable_config 任何一个，宽容解析一律填默认，
    #  于是 entries 为空也一路不报错，最后报「收下了」。那种错不报错，只是收进来一张
    #  什么都装不了的卡 —— 正是本工具最该消灭的那种静默。
    if not any(k in card for k in ("character", "setting_library", "variable_config")):
        raise ValueError(
            "这不像 ElecKoi 卡：character / setting_library / variable_config 三样一样都没有。\n"
            "  先认一下是什么卡： python forge.py analyze \"%s\"\n"
            "  酒馆卡走 python forge.py to-eleckoi（`import` 与 `new --从` 会自动转）。"
            % os.path.basename(str(card_path)))

    base = M.strip_upload_prefix(os.path.basename(card_path))
    stem = os.path.splitext(base)[0].strip(". ") or "card"
    out_path = out_path or os.path.join(
        os.path.dirname(os.path.abspath(card_path)), stem + ".spec.yaml")

    spec = OrderedDict()
    spec["format"] = card.get("format", M.CARD_FORMAT)
    spec["version"] = card.get("version", 1)
    spec["character"] = M.ordered(card.get("character", {}) or {}, M.CHARACTER_KEYS)
    spec["assets"] = card.get("assets", []) or []

    # ---- 设定库
    lib = _as_obj(card.get("setting_library"))
    versions = lib.get("versions", []) or []
    act = _pick_active(versions, lib.get("active_version_id", ""))

    library = OrderedDict()
    library["snapshot_format"] = lib.get("format", M.LIB_FORMAT)
    library["snapshot_version"] = lib.get("version", 1)
    library["active_version_id"] = act.get("id", lib.get("active_version_id", ""))
    library["version_name"] = act.get("name", "")
    library["list_all_expanded"] = act.get("list_all_expanded", True)
    library["expanded_group_ids"] = act.get("expanded_group_ids", []) or []
    library["prompt_positions"] = act.get("prompt_positions", []) or []
    library["created_at"] = act.get("created_at", "")
    library["updated_at"] = act.get("updated_at", "")
    library["groups"] = [M.ordered(g, M.GROUP_KEYS) for g in act.get("groups", []) or []]
    entries = []
    for e in act.get("entries", []) or []:
        e = M.ordered(e, M.ENTRY_KEYS)
        e["opening_messages"] = [M.ordered(m, M.ENTRY_MESSAGE_KEYS)
                                 for m in (e.get("opening_messages") or [])]
        entries.append(e)
    library["entries"] = entries
    others = [v for v in versions if v is not act]
    if others:
        library[KEEP_LIB_VERSIONS] = others
    spec["library"] = library

    # ---- 变量
    vc = _as_obj(card.get("variable_config"))
    vvers = vc.get("versions", []) or []
    vact = _pick_active(vvers, vc.get("active_version_id", ""))

    variables = OrderedDict()
    variables["config_format"] = vc.get("format", M.VAR_FORMAT)
    variables["config_version"] = vc.get("version", 1)
    variables["character_id"] = vc.get("character_id", "")
    variables["name"] = vc.get("name", "")
    variables["version_name"] = vact.get("name", vc.get("name", ""))
    variables["active_version_id"] = vact.get("id", vc.get("active_version_id", ""))
    variables["initial_state"] = vact.get("initial_state", {}) or {}
    variables["schema_code"] = vact.get("schema_code", "") or ""
    variables["objects"] = [M.ordered(o, M.VAR_OBJECT_KEYS)
                            for o in vact.get("objects", []) or []]
    variables["variables"] = [M.ordered(v, M.VAR_ITEM_KEYS)
                              for v in vact.get("variables", []) or []]
    variables["expanded_object_ids"] = vact.get("expanded_object_ids", []) or []
    variables["created_at"] = vact.get("created_at", "")
    variables["updated_at"] = vact.get("updated_at", "")
    variables["config_updated_at"] = vc.get("updated_at", "")
    v_others = [v for v in vvers if v is not vact]
    if v_others:
        variables[KEEP_VAR_VERSIONS] = v_others
    spec["variables"] = variables

    spec["regex_rules"] = [M.ordered(r, M.REGEX_KEYS) for r in card.get("regex_rules", []) or []]

    extra = OrderedDict((k, v) for k, v in card.items() if k not in _KNOWN_TOP)
    if extra:
        spec[KEEP_TOP_EXTRA] = extra

    M.ydump(spec, out_path)
    return out_path


# ------------------------------------------------------------------ build
def build(spec_path, out_path):
    """可读 YAML 规格 -> 卡片。返回写出的卡路径。"""
    spec = M.yload(spec_path) or {}

    card = OrderedDict()
    card["format"] = spec.get("format", M.CARD_FORMAT)
    card["version"] = spec.get("version", 1)
    card["character"] = M.ordered(spec.get("character", {}) or {}, M.CHARACTER_KEYS)
    card["assets"] = spec.get("assets", []) or []

    # ---- 设定库
    library = spec.get("library", {}) or {}
    entries = []
    for e in library.get("entries", []) or []:
        e = M.ordered(e, M.ENTRY_KEYS)
        e["opening_messages"] = [M.ordered(m, M.ENTRY_MESSAGE_KEYS)
                                 for m in (e.get("opening_messages") or [])]
        entries.append(e)
    groups = [M.ordered(g, M.GROUP_KEYS) for g in (library.get("groups", []) or [])]

    lib_version = OrderedDict([
        ("id", library.get("active_version_id", "")),
        ("name", library.get("version_name", "")),
        ("entries", entries),
        ("groups", groups),
        ("prompt_positions", library.get("prompt_positions", []) or []),
        ("list_all_expanded", library.get("list_all_expanded", True)),
        ("expanded_group_ids", library.get("expanded_group_ids", []) or []),
        ("created_at", library.get("created_at", "")),
        ("updated_at", library.get("updated_at", "")),
    ])
    snap = OrderedDict([
        ("format", library.get("snapshot_format", M.LIB_FORMAT)),
        ("version", library.get("snapshot_version", 1)),
        ("active_version_id", library.get("active_version_id", "")),
        ("versions", [lib_version] + list(library.get(KEEP_LIB_VERSIONS, []) or [])),
    ])
    card["setting_library"] = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))

    # ---- 变量
    v = spec.get("variables", {}) or {}
    v_objects = [M.ordered(o, M.VAR_OBJECT_KEYS) for o in (v.get("objects", []) or [])]
    v_items = []
    for item in (v.get("variables", []) or []):
        item = M.ordered(item, M.VAR_ITEM_KEYS)
        if "default_value" in item and not isinstance(item["default_value"], str):
            item["default_value"] = json.dumps(item["default_value"], ensure_ascii=False)
        v_items.append(item)

    def _var_payload():
        return OrderedDict([
            ("initial_state", v.get("initial_state", {}) or {}),
            ("schema_code", v.get("schema_code", "") or ""),
            ("objects", v_objects),
            ("variables", v_items),
            ("expanded_object_ids", v.get("expanded_object_ids", []) or []),
        ])

    var_version = OrderedDict([("id", v.get("active_version_id", "")),
                               ("name", v.get("version_name", v.get("name", "")))])
    var_version.update(_var_payload())
    var_version["created_at"] = v.get("created_at", "")
    var_version["updated_at"] = v.get("updated_at", "")

    vc = OrderedDict([
        ("format", v.get("config_format", M.VAR_FORMAT)),
        ("version", v.get("config_version", 1)),
        ("character_id", v.get("character_id", "")),
        ("name", v.get("name", "")),
        ("active_version_id", v.get("active_version_id", "")),
        ("updated_at", v.get("config_updated_at", "")),
    ])
    vc.update(_var_payload())
    vc["versions"] = [var_version] + list(v.get(KEEP_VAR_VERSIONS, []) or [])
    card["variable_config"] = json.dumps(vc, ensure_ascii=False, indent=2)

    card["regex_rules"] = [M.ordered(r, M.REGEX_KEYS)
                           for r in (spec.get("regex_rules", []) or [])]

    for k, val in (spec.get(KEEP_TOP_EXTRA) or {}).items():
        card[k] = val

    M.jdump(card, out_path, indent=2)
    return out_path


# ------------------------------------------------------------------ 取数
def card_parts(card):
    """从卡里取出 (character, setting_library_snapshot, variable_config) 三个对象。"""
    lib = _as_obj(card.get("setting_library"))
    vc = _as_obj(card.get("variable_config"))
    return card.get("character", {}) or {}, lib, vc


def active_library(card):
    _, lib, _ = card_parts(card)
    versions = lib.get("versions", []) or []
    return _pick_active(versions, lib.get("active_version_id", "")) or {}


def raw_setting_library(card):
    """整份设定库容器（含 versions / active_version_id），给导出存档用。"""
    return _as_obj(card.get("setting_library"))


def raw_variable_config(card):
    """整份变量容器（含 versions / character_id），给导出存档用。"""
    return _as_obj(card.get("variable_config"))


def active_variables(card):
    _, _, vc = card_parts(card)
    versions = vc.get("versions", []) or []
    return _pick_active(versions, vc.get("active_version_id", "")) or {}


def mutate_active_library(card, fn):
    """在卡上就地改「当前设定库版本」，并把改动写回卡片字符串。

    注意：card['setting_library'] 是一段 JSON **字符串**，每次解析都得到新副本；
    改了副本不写回，等于没改。凡是要改卡的结构，都走这个口。
    """
    snap = _as_obj(card.get("setting_library"))
    versions = snap.get("versions", []) or []
    act = _pick_active(versions, snap.get("active_version_id", ""))
    fn(act)
    card["setting_library"] = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))
    return card


def mutate_active_variables(card, fn):
    """同上，改「当前变量版本」。"""
    vc = _as_obj(card.get("variable_config"))
    versions = vc.get("versions", []) or []
    act = _pick_active(versions, vc.get("active_version_id", ""))
    fn(act)
    card["variable_config"] = json.dumps(vc, ensure_ascii=False, separators=(",", ":"))
    return card


def spec_to_card(spec_path):
    """把 spec 在内存里编成卡（不落盘），供校验使用。"""
    tmp = M.temp_json()
    try:
        build(spec_path, tmp)
        return M.jload(tmp)
    finally:
        SB.cleanup(tmp)


# ------------------------------------------------------------------ 内部
def _as_obj(raw):
    if raw is None:
        return {}
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return {}
        try:
            return json.loads(raw, object_pairs_hook=OrderedDict)
        except Exception:
            return {}
    return raw if isinstance(raw, dict) else {}


def _pick_active(versions, active_id):
    if not versions:
        return {}
    for v in versions:
        if v.get("id") == active_id:
            return v
    return versions[0]
