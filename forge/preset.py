# -*- coding: utf-8 -*-
"""预设 —— 把卡里的那套设定，搬成一份「创作预设」。

**为什么要有这一件。**

ElecKoi 里有两种容器，各自装不同的东西：

    · 角色卡（`eleckoi.character-card`）—— 一次对话演一个人；
    · 创作预设（`eleckoi.agent-preset`）—— 一次对话配一套工作方式。

「制卡助手」这种产物，天生属于后者：它不是一张用来扮演的卡，它是一套
「开新卡的时候，AI 该照什么规矩动手」的规程。以前 `forge.py` 只能出前者，
用户拿到的压缩包里有 `.card.json` 却没有预设，等于这件工具最想干的事没落地。

**格式是从客户端源码里抄出来的**（`@eleckoi/dsh-product-data` 的
`AgentPresetImportCodec.ts`，v2）：

    { "format": "eleckoi.agent-preset", "version": 2,
      "preset": { "purpose": "creator", "name": …, "entries": [...], … } }

三条客户端规矩，一条都绕不开：

    · `version: 2` 才带 `purpose`，且导入时必须与用户选的分类一致
      （拿角色扮演分类导创作预设，客户端会拒）；
    · 条目 `kind` / `position` / `agent_read_strategy` 等是**白名单枚举**，
      值不在表里整条会被拒；`position` 只认 `instructions` 与 `insert_point_1..5`
      （艾瑟兰那轮修过的非法 `after_character` 就是栽在这里）；
    · 条目里引用的 `prompt_position_id` 必须真的存在。

**从卡到预设的搬运是「减」，不是「换」** —— 卡与预设共用同一套设定库条目结构
（同一个 `ENTRY_KEYS`，只多一个 `content_mode`），所以这一件不发明；真正要做的
判断只有一条：**卡里的引擎条目（隐藏工具时间线、历史压缩）不进创作预设**，
那是扮演用的机件，搬到创作侧只会让 AI 每轮都去查设定库。
"""
from __future__ import annotations

import json
import os
from collections import OrderedDict

from . import model as M
from . import png as PNG
from . import sandbox as SB

FORMAT = "eleckoi.agent-preset"
VERSION = 2                       # v2 = 带 purpose，客户端会要求分类对齐
PURPOSE = "creator"
PNG_KEY = PNG.KEYWORD["preset"]   # eleckoi_agent_preset
MAX_BYTES = 64 * 1024 * 1024      # 客户端整份输入的上限（codec MAX_INPUT_BYTES）

MODEL_FAMILIES = ("general", "claude", "openai", "gemini", "deepseek", "other")

# 客户端的白名单（codec 里的 Set）。值落不进去的，整条会被丢掉或报错。
KINDS = ("normal", "opening", "history_compaction", "hidden_tool_timeline")
READ_STRATEGIES = ("required", "keyword", "normal")
DYNAMIC_MODES = ("standard", "ejs_reference")
CONTENT_MODES = ("plain_text", "ejs")
KEYWORD_CONDITIONS = ("none", "any", "all", "not_any")
POSITIONS = ("instructions", "insert_point_1", "insert_point_2",
             "insert_point_3", "insert_point_4", "insert_point_5")
INSERT_ROLES = ("system", "user", "assistant")
TRIGGER_MODES = ("always", "agent_tool", "")
SIDES = ("before_setting_position", "after_setting_position")

# 扮演机件：留在卡里，不搬进创作预设
ENGINE_KINDS = ("hidden_tool_timeline", "history_compaction")

# 条目键序 = 卡的那一套，只在 dynamic_mode 后面插一个 content_mode
ENTRY_KEYS = list(M.ENTRY_KEYS)
ENTRY_KEYS.insert(ENTRY_KEYS.index("dynamic_mode") + 1, "content_mode")

POSITION_KEYS = ["id", "name", "anchor", "side", "order", "created_at", "updated_at"]
TOOL_GROUPS_DEFAULT = ["builtin:creator"]

# 时间戳写死 —— 同一份卡跑两次必须得到同一份预设（PNG 要进指纹，字节得稳）
EPOCH = 0


class PresetError(RuntimeError):
    """预设这一层的事 —— 内容/来源不对，说一句人话就够。"""


# ------------------------------------------------------------------ 取值
def _lib_snapshot(native):
    """卡里的设定库是一段**字符串化的 JSON**（`setting_library` 是 str，不是 dict）。

    直接 `native['setting_library']['versions']` 会报 `'str' object is not
    subscriptable` —— 这一条踩过一次，写在这里省得下一个人再踩。
    """
    raw = native.get("setting_library")
    if isinstance(raw, str):
        try:
            snap = json.loads(raw)
        except Exception as exc:
            raise PresetError("设定库那段 JSON 解不开：%s" % exc)
    elif isinstance(raw, dict):
        snap = raw
    else:
        raise PresetError("这张卡里没有设定库（setting_library 是空的）")

    if snap.get("format") and snap["format"] != M.LIB_FORMAT:
        raise PresetError("设定库格式不对：%r（应该是 %r）" % (snap["format"], M.LIB_FORMAT))
    return snap


def _active_version(snap):
    versions = snap.get("versions") or []
    if not versions:
        raise PresetError("设定库里一条版本都没有")
    want = snap.get("active_version_id")
    for v in versions:
        if want and v.get("id") == want:
            return v
    return versions[0]


def _pick(value, allowed, fallback):
    return value if value in allowed else fallback


def _entry(src, index):
    """一条设定：照卡里的原样搬，缺的补默认，非法的收回白名单内。"""
    out = OrderedDict()
    for k in ENTRY_KEYS:
        if k == "content_mode":
            out[k] = _pick(src.get("content_mode"), CONTENT_MODES, "plain_text")
        elif k in src:
            out[k] = src[k]
        else:
            out[k] = _DEFAULTS.get(k, "")
    out["id"] = src.get("id") or "entry-%d" % (index + 1)
    out["kind"] = _pick(src.get("kind"), KINDS, "normal")
    out["agent_read_strategy"] = _pick(src.get("agent_read_strategy"), READ_STRATEGIES, "normal")
    out["dynamic_mode"] = _pick(src.get("dynamic_mode"), DYNAMIC_MODES, "standard")
    out["content_mode"] = _pick(src.get("content_mode"), CONTENT_MODES, "plain_text")
    out["keyword_condition"] = _pick(src.get("keyword_condition"), KEYWORD_CONDITIONS, "none")
    out["position"] = src.get("position") if src.get("position") in POSITIONS else None
    out["insert_role"] = _pick(src.get("insert_role"), INSERT_ROLES, "system")
    out["trigger_mode"] = src.get("trigger_mode") if src.get("trigger_mode") in TRIGGER_MODES else ""
    out["enabled"] = bool(src.get("enabled", True))
    out["keywords"] = [str(x) for x in (src.get("keywords") or [])]
    out["condition_keywords"] = [str(x) for x in (src.get("condition_keywords") or [])]
    msgs = []
    for m in (src.get("opening_messages") or []):
        mm = OrderedDict()
        for mk in M.ENTRY_MESSAGE_KEYS:
            mm[mk] = m.get(mk, {} if mk == "initial_variable_state" else "")
        msgs.append(mm)
    out["opening_messages"] = msgs
    for ik in ("order", "view_order", "group_view_order", "tree_view_order"):
        out[ik] = int(src.get(ik) or 0)
    for nk in ("keyword_scan_depth", "keyword_recursion_depth"):
        out[nk] = int(src.get(nk) or 0)
    for bk in ("keyword_use_regex", "keyword_ignore_case", "keyword_whole_word"):
        out[bk] = bool(src.get(bk, False))
    return M.plain(out)


_DEFAULTS = {
    "title": "", "icon_id": "", "group_id": "", "content": "",
    "default_opening_message_id": "", "agent_selection_hint": "",
    "prompt_position_id": "", "created_at": "", "updated_at": "",
}


def _group(src, index):
    out = OrderedDict()
    for k in M.GROUP_KEYS:
        if k in src:
            out[k] = src[k]
    out["id"] = src.get("id") or "group-%d" % (index + 1)
    out["name"] = src.get("name") or ""
    out["parent_id"] = src.get("parent_id") or ""
    out["order"] = int(src.get("order") or 0)
    out["tree_view_order"] = int(src.get("tree_view_order") or 0)
    out["created_at"] = src.get("created_at") or ""
    out["updated_at"] = src.get("updated_at") or ""
    return M.plain(out)


def _position(src, index):
    out = OrderedDict()
    for k in POSITION_KEYS:
        out[k] = src.get(k, 0 if k == "order" else "")
    out["id"] = src.get("id") or "position-%d" % (index + 1)
    out["name"] = src.get("name") or ""
    out["anchor"] = _pick(src.get("anchor"), POSITIONS, "instructions")
    out["side"] = _pick(src.get("side"), SIDES, "after_setting_position")
    out["order"] = int(src.get("order") or 0)
    return M.plain(out)


def _regex(src, index):
    out = OrderedDict()
    for k in M.REGEX_KEYS:
        if k in src:
            out[k] = src[k]
    out["id"] = src.get("id") or "regex-%d" % (index + 1)
    out["name"] = src.get("name") or ""
    out["pattern"] = src.get("pattern") or ""
    out["replacement"] = src.get("replacement") or ""
    out["targets"] = list(src.get("targets") or [])
    for bk in ("enabled", "display_only", "prompt_only", "run_on_edit"):
        out[bk] = bool(src.get(bk, False))
    out["order"] = int(src.get("order") or 0)
    return M.plain(out)


# ------------------------------------------------------------------ 组装
def from_card(card_path, name=None, author="", instructions=None,
              tool_groups=None, version_name="", drop_engine=True, out=print):
    """读一张**原生卡 JSON**，拼出预设信封（dict），不落盘。

    返回 `{"doc": 信封, "dropped": [被丢掉的引擎条目标题], "stats": {…}}`。
    """
    with open(card_path, "r", encoding="utf-8") as _f:
        native = json.load(_f, object_pairs_hook=OrderedDict)
    fmt = native.get("format")
    if fmt != M.CARD_FORMAT:
        raise PresetError("这不是 ElecKoi 角色卡（format=%r，应该是 %r）" % (fmt, M.CARD_FORMAT))

    snap = _lib_snapshot(native)
    ver = _active_version(snap)

    raw_entries = list(ver.get("entries") or [])
    dropped = []
    if drop_engine:
        keep = []
        for e in raw_entries:
            if e.get("kind") in ENGINE_KINDS:
                dropped.append("%s（%s）" % (e.get("title") or "?", e.get("kind")))
            else:
                keep.append(e)
        raw_entries = keep

    entries = [_entry(e, i) for i, e in enumerate(raw_entries)]
    groups = [_group(g, i) for i, g in enumerate(ver.get("groups") or [])]
    positions = [_position(p, i) for i, p in enumerate(ver.get("prompt_positions") or [])]
    regexes = [_regex(r, i) for i, r in enumerate(native.get("regex_rules") or [])]

    # 条目引用的插入位必须真的存在，否则客户端那侧对不上
    ids = {p["id"] for p in positions}
    for e in entries:
        if e.get("prompt_position_id") and e["prompt_position_id"] not in ids:
            e["prompt_position_id"] = ""

    card_name = ((native.get("character") or {}).get("name") or "").strip()
    pname = (name or card_name or "未命名预设").strip()
    pid = "forge-%s" % M.ascii_prefix(pname, "preset")

    if instructions is None:
        instructions = _auto_instructions(pname, entries, groups)
    groups_in = tool_groups or TOOL_GROUPS_DEFAULT

    content = OrderedDict()
    content["entries"] = entries
    content["groups"] = groups
    content["regex_rules"] = regexes
    content["prompt_positions"] = positions
    content["tool_configuration"] = OrderedDict([
        ("included_group_ids", list(groups_in)),
        ("enabled_group_ids", list(groups_in)),
    ])
    content["roleplay_plan"] = None
    content["expanded_group_ids"] = []

    version = OrderedDict()
    version["id"] = "%s:v1" % pid
    version["number"] = 1
    version["name"] = (version_name or pname).strip()
    version["created_at_epoch_ms"] = EPOCH
    version["usage_instructions"] = instructions
    version["timeline"] = []
    for k, v in content.items():
        version[k] = v

    preset = OrderedDict()
    preset["name"] = pname
    preset["purpose"] = PURPOSE        # 客户端自己的编码器就是 name 之后（codec :117-119）
    preset["model_family"] = "general"
    preset["model_tags"] = []
    preset["profile"] = OrderedDict([
        ("author_name", author or ""),
        ("usage_instructions", instructions),
        ("timeline", []),
    ])
    preset["active_version_id"] = version["id"]
    preset["active_version_number"] = 1
    for k, v in content.items():
        preset[k] = v
    preset["versions"] = [version]

    doc = OrderedDict([("format", FORMAT), ("version", VERSION), ("preset", preset)])

    stats = {"entries": len(entries), "groups": len(groups),
             "regex": len(regexes), "positions": len(positions),
             "常驻": sum(1 for e in entries if e.get("trigger_mode") == "always"),
             "必读": sum(1 for e in entries if e.get("agent_read_strategy") == "required"),
             "字": sum(len(e.get("content") or "") for e in entries)}
    if out:
        out("  预设内容：%d 条设定 · %d 组 · %d 条正则 · %d 个插入位"
            % (stats["entries"], stats["groups"], stats["regex"], stats["positions"]))
        if dropped:
            out("  留在卡里没搬过来的引擎条目 %d 条：%s"
                % (len(dropped), " · ".join(dropped)))
    return {"doc": doc, "dropped": dropped, "stats": stats}


def _auto_instructions(pname, entries, groups):
    """没说就自动写一段 —— 预设管理器里那一栏总得有字，否则两个预设分不清。"""
    titles = [e.get("title") for e in entries if e.get("title")]
    head = " · ".join(titles[:4]) + ("…" if len(titles) > 4 else "")
    return ("「%s」的创作预设：把这张卡里的 %d 条设定搬了过来%s。"
            "选中它之后，AI 手里就有这套设定与规程，可以照着开新卡、改老卡。"
            % (pname, len(entries), ("（%s）" % head) if head else ""))


# ------------------------------------------------------------------ 落盘
def _stem(name):
    """`制卡助手.card.json` / `制卡助手.preset.json` -> `制卡助手`。"""
    stem = os.path.basename(name)
    for suf in (".spec.yaml", ".spec.yml", ".card.json", ".preset.json",
                ".yaml", ".yml", ".json"):
        if stem.lower().endswith(suf):
            stem = stem[:-len(suf)]
            break
    else:
        stem = os.path.splitext(stem)[0]
    for suf in (".card", ".preset"):
        if stem.lower().endswith(suf):
            stem = stem[:-len(suf)]
    return stem


def default_out(src):
    """`<名>.card.json` -> `<名>.preset.json`；`source/` 里的出到同工程 `成品/`。"""
    d = os.path.dirname(os.path.abspath(src))
    stem = _stem(src)
    if os.path.basename(d).lower() == "source":
        made = os.path.join(os.path.dirname(d), "成品")
        if os.path.isdir(made):
            d = made
    return os.path.join(d, stem + ".preset.json")


def _dump(doc):
    return json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8")


def build(card_path, out_path=None, name=None, author="", instructions=None,
          tool_groups=None, version_name="", drop_engine=True, quiet=False, out=print):
    """出一份 `.preset.json`。返回 from_card 的结果 + 落盘信息。"""
    got = from_card(card_path, name=name, author=author, instructions=instructions,
                    tool_groups=tool_groups, version_name=version_name,
                    drop_engine=drop_engine, out=out)
    doc = got["doc"]
    data = _dump(doc)
    if len(data) > MAX_BYTES:
        raise PresetError("预设 %d 字节，超过客户端 %d MB 上限"
                          % (len(data), MAX_BYTES // 1048576))
    if out_path is None:
        out_path = default_out(card_path)

    d = os.path.dirname(os.path.abspath(out_path))
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    tmp = out_path + ".part"          # 同目录临时文件：跨盘 os.replace 会 WinError 17
    with open(tmp, "wb") as f:
        f.write(data)
    SB.land(tmp, out_path)
    SB.cleanup(tmp)

    got["json"] = out_path
    got["bytes"] = len(data)
    if not quiet:
        out("写出：%s（%d 字节）" % (out_path, len(data)))
        out("  用法：ElecKoi「预设管理器 → 导入预设」选这份文件，分类选**创作预设**")
    return got


def build_png(preset_path, out_path=None, cover=None, quiet=False, out=print):
    """预设也能装进 PNG —— 客户端认的是 `tEXt eleckoi_agent_preset`。"""
    out_path = out_path or os.path.join(os.path.dirname(os.path.abspath(preset_path)),
                                        _stem(preset_path) + ".preset.png")
    res = PNG.write(preset_path, out_path, cover, kind="preset", quiet=quiet, out=out)
    PNG.verify(res["png"])
    return res


# ------------------------------------------------------------------ 自检
def verify(path, out=print):
    """照客户端的口径把产物复读一遍 —— 值落不进白名单的当场报出来。

    「导出成功但导不进去」是这份工具最该防的事：`format` 对了不代表条目合法，
    客户端的 `entryFromPortable` 遇到表外的 `kind` 会直接抛。
    """
    with open(path, "rb") as _f:
        data = _f.read()
    if len(data) > MAX_BYTES:
        raise PresetError("整份 %d 字节，超过客户端 %d MB 上限"
                          % (len(data), MAX_BYTES // 1048576))
    try:
        root = json.loads(data.decode("utf-8"))
    except Exception as exc:
        raise PresetError("读不了预设 JSON：%s" % exc)

    if root.get("format") != FORMAT:
        raise PresetError("format 不对（拿到 %r，客户端要 %r）" % (root.get("format"), FORMAT))
    if root.get("version") not in (1, VERSION):
        raise PresetError("version 不对（拿到 %r，客户端只认 1 / %d）" % (root.get("version"), VERSION))
    pr = root.get("preset")
    if not isinstance(pr, dict):
        raise PresetError("没有 preset 这一层（客户端会报「不是 ElecKoi 预设」）")
    if root.get("version") == 2 and pr.get("purpose") != PURPOSE:
        raise PresetError("version 2 的 purpose 必须是 %r，拿到 %r —— 客户端会因为"
                          "分类对不上而拒收" % (PURPOSE, pr.get("purpose")))

    entries = pr.get("entries") or []
    if not isinstance(entries, list):
        raise PresetError("entries 不是列表")
    bad = []
    seen = set()
    for i, e in enumerate(entries):
        where = "entries[%d]" % i
        if not isinstance(e, dict):
            bad.append("%s 不是对象" % where); continue
        if e.get("kind") not in KINDS:
            bad.append("%s kind=%r 不在白名单" % (where, e.get("kind")))
        if e.get("agent_read_strategy") not in READ_STRATEGIES:
            bad.append("%s agent_read_strategy=%r 不在白名单" % (where, e.get("agent_read_strategy")))
        if e.get("dynamic_mode") not in DYNAMIC_MODES:
            bad.append("%s dynamic_mode=%r 不在白名单" % (where, e.get("dynamic_mode")))
        if e.get("content_mode") not in CONTENT_MODES:
            bad.append("%s content_mode=%r 不在白名单" % (where, e.get("content_mode")))
        if e.get("position") is not None and e.get("position") not in POSITIONS:
            bad.append("%s position=%r 不在白名单（只认 instructions 与 insert_point_1..5）"
                       % (where, e.get("position")))
        if e.get("trigger_mode") not in TRIGGER_MODES:
            bad.append("%s trigger_mode=%r 不收" % (where, e.get("trigger_mode")))
        extra = [k for k in e if k not in ENTRY_KEYS]
        if extra:
            bad.append("%s 带了客户端不认的键：%s" % (where, extra))
        eid = e.get("id")
        if not eid:
            bad.append("%s 没有 id" % where)
        elif eid in seen:
            bad.append("%s id 重复：%s" % (where, eid))
        seen.add(eid)
    pids = {(p or {}).get("id") for p in (pr.get("prompt_positions") or [])}
    for i, e in enumerate(entries):
        if isinstance(e, dict) and e.get("prompt_position_id") and e["prompt_position_id"] not in pids:
            bad.append("entries[%d] 引用了不存在的插入位 %r" % (i, e["prompt_position_id"]))

    if bad:
        raise PresetError("预设自检没过（%d 处）：\n    %s" % (len(bad), "\n    ".join(bad[:20])))

    if out:
        out("✔ 自检：%s · %d 字节 · %s · %d 条设定 · %d 组 · %d 正则"
            % (os.path.basename(path), len(data), pr.get("name"),
               len(entries), len(pr.get("groups") or []), len(pr.get("regex_rules") or [])))
    return {"json": path, "bytes": len(data), "entries": len(entries),
            "name": pr.get("name"), "purpose": pr.get("purpose")}


def main(argv=None):
    """独跑：`python -m forge.preset <卡.json> [-o 出.preset.json] [--png [出.png]]`。"""
    import sys
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print(__doc__.strip().splitlines()[0])
        print("用法：python -m forge.preset <卡.json> [-o 出.preset.json] [--png [出.png]]")
        return 2
    src = argv[0]
    out_path = None
    png_out = None
    rest = argv[1:]
    i = 0
    while i < len(rest):
        if rest[i] in ("-o", "--out") and i + 1 < len(rest):
            out_path = rest[i + 1]; i += 2; continue
        if rest[i] == "--png":
            if i + 1 < len(rest) and not rest[i + 1].startswith("-"):
                png_out = rest[i + 1]; i += 2
            else:
                png_out = ""; i += 1
            continue
        i += 1
    got = build(src, out_path)
    verify(got["json"])
    if png_out is not None:
        build_png(got["json"], png_out or None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
