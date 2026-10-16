# -*- coding: utf-8 -*-
"""一次性脚本：造 `差分/语料/preset.json`（preset 模块的差分语料）。

语料是 JSON，形状与 `png.json` 完全一致（两侧的 `算_preset` 就是照 `算_png` 写的）：

    {"名": …, "预置": {"目录": [...], "文件": {名: 内容}}, "操作": [{"调用": …, "参数": [...]}]}

预置文件的内容写 dict ⇒ 两侧都按 `json.dumps(v, ensure_ascii=False, indent=2)` /
`JSON.stringify(v, null, 2)` 落盘（形状逐字节对得上）。

**比 png 多认一种步**：`{"调用": "常量:KINDS"}`（带 `常量:` 前缀）返回模块常量本身，
不再调用 —— 用来把 `FORMAT / VERSION / KINDS / ENTRY_KEYS / _DEFAULTS …` 逐个比一遍。

用法：python 差分/_造preset语料.py      （跑完即可删）
"""
import json
import sys
from pathlib import Path

根 = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))


# ---------------------------------------------------------------- 造一张卡
def 卡(名="  艾瑟兰测试卡  ", 库=None, 库为字符串=False, **kw):
    d = {
        "format": "eleckoi.character-card",
        "version": 1,
        "character": {"name": 名, "description": "差分用。", "personality": ""},
        "setting_library": (json.dumps(库, ensure_ascii=False, indent=2) if 库为字符串 else 库),
    }
    d.update(kw)
    return d


E全 = {
    "id": "e-1", "title": "总纲", "icon_id": "i-1", "kind": "normal", "group_id": "g-1",
    "content": "正文甲。", "opening_messages": [
        {"id": "m-1", "title": "起手", "content": "你好。", "initial_variable_state": {"hp": 3}},
        {"id": "m-2"},
    ],
    "default_opening_message_id": "m-1", "agent_selection_hint": "看总纲",
    "agent_read_strategy": "required", "dynamic_mode": "standard",
    "keywords": ["甲", "乙"], "keyword_scan_depth": 2, "condition_keywords": ["丙"],
    "keyword_condition": "any", "keyword_use_regex": True, "keyword_ignore_case": False,
    "keyword_whole_word": True, "keyword_recursion_depth": 1, "trigger_mode": "always",
    "enabled": True, "position": "instructions", "prompt_position_id": "p-1",
    "insert_role": "user", "order": 3, "view_order": 4, "group_view_order": 5,
    "tree_view_order": 6, "created_at": "2026-01-01T00:00:00.000000+08:00",
    "updated_at": "2026-01-02T00:00:00.000000+08:00", "content_mode": "ejs",
    "note": "客户端不认的键（搬运时应当丢掉）",
}
E缺 = {"id": "e-2", "title": "只有三个键"}
E引擎1 = {"title": None, "kind": "hidden_tool_timeline", "content": "引擎甲"}
E引擎2 = {"id": "e-4", "title": "历史压缩", "kind": "history_compaction"}
E非法 = {
    "id": "e-5", "title": "全是错值", "kind": "weird", "agent_read_strategy": "sometimes",
    "dynamic_mode": "x", "content_mode": "y", "keyword_condition": "z",
    "position": "after_character", "trigger_mode": "nope", "insert_role": "robot",
    "enabled": 0, "keywords": [1, True, "甲"], "condition_keywords": None,
    "opening_messages": [{"title": "只有标题"}],
    "order": "7", "view_order": None, "group_view_order": True, "tree_view_order": [],
    "keyword_scan_depth": "3", "keyword_recursion_depth": None,
    "prompt_position_id": "p-不存在",
}
E空标签 = {"title": "", "kind": "opening", "content": "", "enabled": "x",
           "prompt_position_id": "p-2", "trigger_mode": "agent_tool"}

组们 = [
    {"id": "g-1", "name": "第一组", "parent_id": "", "order": 1, "tree_view_order": 2,
     "created_at": "2026-01-01T00:00:00.000000+08:00", "updated_at": ""},
    {"name": "只有名字"},
]
插位们 = [
    {"id": "p-1", "name": "开头", "anchor": "instructions", "side": "before_setting_position",
     "order": 1, "created_at": "", "updated_at": ""},
    {"name": "只有名字", "anchor": "bogus", "side": "bogus"},
]
正则们 = [
    {"id": "r-1", "name": "去空行", "pattern": r"\n{3,}", "replacement": "\n\n",
     "targets": ["content"], "enabled": True, "display_only": False, "prompt_only": True,
     "run_on_edit": False, "order": 2, "trim_strings": True, "min_depth": 0,
     "max_depth": 9, "substitute_regex": "$1"},
    {"name": "只有名字", "targets": None, "enabled": 1},
]

库好 = {
    "format": "eleckoi.setting-library-snapshot",
    "active_version_id": "v-2",
    "versions": [
        {"id": "v-1", "name": "旧版"},
        {"id": "v-2", "name": "现役", "entries": [E全, E缺, E引擎1, E引擎2, E非法, E空标签],
         "groups": 组们, "prompt_positions": 插位们},
    ],
}
库无现役 = {
    "format": "eleckoi.setting-library-snapshot",
    "active_version_id": "v-404",
    "versions": [{"id": "v-1", "name": "旧版", "entries": [E缺], "groups": [], "prompt_positions": []}],
}

好卡 = 卡(库=库好, 库为字符串=True)
好卡字典库 = 卡(库=库好)
无名卡 = 卡(名="", 库=库好)
无名字段卡 = 卡(库=库好)
无名字段卡["character"] = {"description": "没有名字"}
无角色卡 = 卡(库=库好)
无角色卡.pop("character")
坏格式卡 = 卡(库=库好, 库为字符串=True, format="some.other.format")
没库卡 = 卡(库=库好)
没库卡.pop("setting_library")
空库卡 = 卡(库=库好, 库为字符串=True)
空库卡["setting_library"] = ""
数字库卡 = 卡(库=库好)
数字库卡["setting_library"] = 5
空对象库卡 = 卡(库={})
异格式库卡 = 卡(库={"format": "别的库格式", "versions": [{"id": "v"}]})
无版本库卡 = 卡(库={"format": "eleckoi.setting-library-snapshot", "versions": []})
旧版库卡 = 卡(库=库无现役)

# ---------------------------------------------------------------- 手搓预设产物
def 预设(版本=2, 目的="creator", 条目=None, 格式="eleckoi.agent-preset", **pr):
    d = {"format": 格式, "version": 版本,
         "preset": {"name": "差分用预设", "purpose": 目的, "entries": 条目 if 条目 is not None else [E全]}
         if 目的 is not None else {}}
    if 目的 is None:
        d["preset"] = {"name": "差分用预设", "entries": 条目 if 条目 is not None else [E全]}
    d["preset"].update(pr)
    return d


好条目 = {"id": "x-1", "title": "甲", "kind": "normal", "agent_read_strategy": "normal",
        "dynamic_mode": "standard", "content_mode": "plain_text", "trigger_mode": ""}
预设好v2 = {"format": "eleckoi.agent-preset", "version": 2,
          "preset": {"name": "好预设", "purpose": "creator", "entries": [好条目],
                     "groups": [组们[0]], "regex_rules": 正则们,
                     "prompt_positions": [插位们[0]]}}
预设好v1 = {"format": "eleckoi.agent-preset", "version": 1,
          "preset": {"name": "老预设", "entries": [好条目]}}
预设坏格式 = {"format": "eleckoi.character-card", "version": 2, "preset": {}}
预设坏版本 = {"format": "eleckoi.agent-preset", "version": 3, "preset": {"purpose": "creator"}}
预设无层 = {"format": "eleckoi.agent-preset", "version": 2, "preset": 123}
预设无目的 = {"format": "eleckoi.agent-preset", "version": 2,
            "preset": {"name": "没分类", "entries": [好条目]}}
预设错目的 = {"format": "eleckoi.agent-preset", "version": 2,
            "preset": {"name": "分类错", "purpose": "roleplay", "entries": [好条目]}}
预设条目非列表 = {"format": "eleckoi.agent-preset", "version": 2,
              "preset": {"name": "条目不是列表", "purpose": "creator", "entries": "x"}}
预设条目坏 = {"format": "eleckoi.agent-preset", "version": 2,
            "preset": {"name": "条目坏", "purpose": "creator",
                       "entries": [
                           "不是对象",
                           {"id": "b-1", "kind": "weird", "agent_read_strategy": "sometimes",
                            "dynamic_mode": "x", "content_mode": "y", "trigger_mode": "nope",
                            "position": "after_character", "note": "多余的键", "extra": 1},
                           {"kind": "normal", "agent_read_strategy": "normal",
                            "dynamic_mode": "standard", "content_mode": "plain_text",
                            "trigger_mode": ""},
                           {"id": "b-3", "kind": "normal", "agent_read_strategy": "normal",
                            "dynamic_mode": "standard", "content_mode": "plain_text",
                            "trigger_mode": "", "prompt_position_id": "p-404"},
                           {"id": "b-3", "kind": "normal", "agent_read_strategy": "normal",
                            "dynamic_mode": "standard", "content_mode": "plain_text",
                            "trigger_mode": "", "prompt_position_id": "p-1"},
                       ],
                       "groups": None, "regex_rules": [1, 2], "prompt_positions": [None, {"id": "p-1"}]}}
预设位置空 = {"format": "eleckoi.agent-preset", "version": 2,
            "preset": {"name": "位置是 null", "purpose": "creator",
                       "entries": [{"id": "c-1", "kind": "normal", "agent_read_strategy": "normal",
                                    "dynamic_mode": "standard", "content_mode": "plain_text",
                                    "trigger_mode": "", "position": None}]}}

# ---------------------------------------------------------------- 情形
情形们 = []


def 情形(名, 文件=None, 目录=None, 操作=None):
    情形们.append({
        "名": 名,
        "预置": {"目录": 目录 or [], "文件": 文件 or {}},
        "操作": 操作 or [],
    })


# ① 常量与逐条搬运
情形("常量与逐条搬运", 文件={"好卡.json": 好卡, "字典库卡.json": 好卡字典库}, 操作=[
    {"调用": "常量:FORMAT"}, {"调用": "常量:VERSION"}, {"调用": "常量:PURPOSE"},
    {"调用": "常量:PNG_KEY"}, {"调用": "常量:MAX_BYTES"}, {"调用": "常量:MODEL_FAMILIES"},
    {"调用": "常量:KINDS"}, {"调用": "常量:READ_STRATEGIES"}, {"调用": "常量:DYNAMIC_MODES"},
    {"调用": "常量:CONTENT_MODES"}, {"调用": "常量:KEYWORD_CONDITIONS"},
    {"调用": "常量:POSITIONS"}, {"调用": "常量:INSERT_ROLES"}, {"调用": "常量:TRIGGER_MODES"},
    {"调用": "常量:SIDES"}, {"调用": "常量:ENGINE_KINDS"}, {"调用": "常量:ENTRY_KEYS"},
    {"调用": "常量:POSITION_KEYS"}, {"调用": "常量:TOOL_GROUPS_DEFAULT"},
    {"调用": "常量:EPOCH"}, {"调用": "常量:_DEFAULTS"},
    {"调用": "from_card", "参数": ["@工作@/好卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/字典库卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/好卡.json", "我的预设"]},
    {"调用": "from_card", "参数": ["@工作@/好卡.json", "  带空白的名字  ", "作者甲",
                                   "自己写的说明", ["builtin:creator", "g-9"], "版本名"]},
    {"调用": "from_card", "参数": ["@工作@/好卡.json", None, "", None, None, "", False]},
    {"调用": "from_card", "参数": ["@工作@/好卡.json", None, "", None, [], "", True]},
    {"调用": "_lib_snapshot", "参数": [好卡]},
    {"调用": "_active_version", "参数": [库好]},
    {"调用": "_active_version", "参数": [库无现役]},
    {"调用": "_pick", "参数": ["normal", ["normal", "opening"], "x"]},
    {"调用": "_pick", "参数": [None, ["normal"], "x"]},
    {"调用": "_entry", "参数": [E全, 0]},
    {"调用": "_entry", "参数": [E缺, 1]},
    {"调用": "_entry", "参数": [E非法, 2]},
    {"调用": "_group", "参数": [组们[0], 0]},
    {"调用": "_group", "参数": [组们[1], 1]},
    {"调用": "_position", "参数": [插位们[0], 0]},
    {"调用": "_position", "参数": [插位们[1], 1]},
    {"调用": "_regex", "参数": [正则们[0], 0]},
    {"调用": "_regex", "参数": [正则们[1], 1]},
    {"调用": "_auto_instructions", "参数": ["甲", [E全, E缺], []]},
    {"调用": "_auto_instructions", "参数": ["乙", [], []]},
    {"调用": "_auto_instructions", "参数": ["丙", [E全, E缺, E引擎1, E引擎2, E非法, E空标签], []]},
    {"调用": "_dump", "参数": [{"a": 1, "b": [1, 2], "c": None}]},
])

# ② 落盘与自检
情形("落盘与自检", 文件={"好卡.json": 好卡}, 操作=[
    {"调用": "build", "参数": ["@工作@/好卡.json"]},
    {"调用": "build", "参数": ["@工作@/好卡.json", "@工作@/出.preset.json"]},
    {"调用": "build", "参数": ["@工作@/好卡.json", "@工作@/深的/一层/出.preset.json"]},
    {"调用": "build", "参数": ["@工作@/好卡.json", "@工作@/静默.preset.json", None, "", None, None, "", True, True]},
    {"调用": "verify", "参数": ["@工作@/出.preset.json"]},
    {"调用": "verify", "参数": ["@工作@/静默.preset.json"]},
    {"调用": "verify", "参数": ["@工作@/好卡.json"]},
    {"调用": "verify", "参数": ["@工作@/没有这个.json"]},
    {"调用": "verify", "参数": ["@工作@"]},
])

# ③ 缺键与非法值（把整批搬运走一遍，看默认值填得对不对）
情形("缺键与非法值", 文件={"坏值卡.json": 卡(库=库好), "旧版卡.json": 旧版库卡,
                          "无名卡.json": 无名卡, "无名字段卡.json": 无名字段卡,
                          "无角色卡.json": 无角色卡}, 操作=[
    {"调用": "from_card", "参数": ["@工作@/坏值卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/旧版卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/无名卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/无名字段卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/无角色卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/无名卡.json", "   "]},
    {"调用": "from_card", "参数": ["@工作@/无名卡.json", "", "作者甲"]},
])

# ④ 错误面
情形("错误面", 文件={
    "坏格式卡.json": 坏格式卡, "没库卡.json": 没库卡, "空库卡.json": 空库卡,
    "数字库卡.json": 数字库卡, "空对象库卡.json": 空对象库卡, "异格式库卡.json": 异格式库卡,
    "无版本库卡.json": 无版本库卡, "坏JSON.json": "{oops",
}, 操作=[
    {"调用": "from_card", "参数": ["@工作@/坏格式卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/没库卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/空库卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/数字库卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/空对象库卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/异格式库卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/无版本库卡.json"]},
    {"调用": "from_card", "参数": ["@工作@/坏JSON.json"]},
    {"调用": "from_card", "参数": ["@工作@/没有这个.json"]},
    {"调用": "from_card", "参数": ["@工作@"]},
    {"调用": "_lib_snapshot", "参数": [5]},
    {"调用": "_lib_snapshot", "参数": ["x"]},
    {"调用": "_lib_snapshot", "参数": [None]},
    {"调用": "_lib_snapshot", "参数": [[]]},
    {"调用": "_active_version", "参数": [{"versions": []}]},
    {"调用": "_active_version", "参数": [5]},
    {"调用": "_entry", "参数": [None, 0]},
    {"调用": "_entry", "参数": [5, 0]},
    {"调用": "_position", "参数": [None, 0]},
    {"调用": "_regex", "参数": [None, 0]},
    {"调用": "_dump", "参数": [None]},
])

# ⑤ 路径与默认出口
情形("路径与默认出口", 目录=["source", "成品", "只有source/source"], 文件={
    "source/卡.card.json": 好卡, "成品/占位.txt": "占位",
    "只有source/source/卡.card.json": 好卡,
    "p.preset.json": 预设好v2,
}, 操作=[
    {"调用": "default_out", "参数": ["@工作@/source/卡.card.json"]},
    {"调用": "default_out", "参数": ["@工作@/source/sub/卡.card.json"]},
    {"调用": "default_out", "参数": ["@工作@/只有source/source/卡.card.json"]},
    {"调用": "default_out", "参数": ["@工作@/光秃秃.card.json"]},
    {"调用": "build", "参数": ["@工作@/source/卡.card.json"]},
    {"调用": "default_out", "参数": ["a/b/卡.spec.yaml"]},
    {"调用": "default_out", "参数": ["卡.spec.yml"]},
    {"调用": "default_out", "参数": ["卡.card.json"]},
    {"调用": "default_out", "参数": ["卡.preset.json"]},
    {"调用": "default_out", "参数": ["卡.yaml"]},
    {"调用": "default_out", "参数": ["卡.yml"]},
    {"调用": "default_out", "参数": ["卡.json"]},
    {"调用": "default_out", "参数": ["卡.card"]},
    {"调用": "default_out", "参数": ["卡.preset"]},
    {"调用": "default_out", "参数": ["没有后缀"]},
    {"调用": "default_out", "参数": ["混合.SPEC.YAML"]},
    {"调用": "default_out", "参数": ["两层.tar.gz"]},
    {"调用": "default_out", "参数": ["卡.preset.card.json"]},
])

# ⑥ PNG 面（预设 PNG 里的 tEXt 不压缩 ⇒ 只有封面的 IDAT 由两个 zlib 各压一遍，
#    而默认封面是渐变图、两边逐字节同；万一不同，_折回 / _折树 会把整张图折成逐块分解）
情形("PNG面", 文件={"p.preset.json": 预设好v2}, 操作=[
    {"调用": "build_png", "参数": ["@工作@/p.preset.json"]},
    {"调用": "build_png", "参数": ["@工作@/p.preset.json", "@工作@/自定义.preset.png", None, True]},
    {"调用": "build_png", "参数": ["@工作@/没有这个.json"]},
])

# ⑦ 命令行
情形("命令行", 文件={"好卡.json": 好卡}, 操作=[
    {"调用": "main", "参数": [[]]},
    {"调用": "main", "参数": [["@工作@/好卡.json"]]},
    {"调用": "main", "参数": [["@工作@/好卡.json", "-o", "@工作@/命令行.preset.json"]]},
    {"调用": "main", "参数": [["@工作@/好卡.json", "--out", "@工作@/长选项.preset.json", "--png"]]},
    {"调用": "main", "参数": [["@工作@/好卡.json", "-o", "@工作@/带png.preset.json", "--png", "@工作@/带png.png"]]},
    {"调用": "main", "参数": [["@工作@/没有这个.json", "-o", "@工作@/x.json"]]},
    {"调用": "main", "参数": [["@工作@/好卡.json", "--png", "-x"]]},
    {"调用": "main", "参数": [["@工作@/好卡.json", "--不认识"]]},
])

# ⑧ 自检面
情形("自检面", 文件={
    "好v2.json": 预设好v2, "好v1.json": 预设好v1, "坏格式.json": 预设坏格式,
    "坏版本.json": 预设坏版本, "无层.json": 预设无层, "无目的.json": 预设无目的,
    "错目的.json": 预设错目的, "条目非列表.json": 预设条目非列表,
    "条目坏.json": 预设条目坏, "位置空.json": 预设位置空,
    "坏字节.json": {"@十六进制@": "fffe7b7d"},
    "断字节.json": {"@十六进制@": "e4b8"},
}, 操作=[
    {"调用": "verify", "参数": ["@工作@/好v2.json"]},
    {"调用": "verify", "参数": ["@工作@/好v1.json"]},
    {"调用": "verify", "参数": ["@工作@/坏格式.json"]},
    {"调用": "verify", "参数": ["@工作@/坏版本.json"]},
    {"调用": "verify", "参数": ["@工作@/无层.json"]},
    {"调用": "verify", "参数": ["@工作@/无目的.json"]},
    {"调用": "verify", "参数": ["@工作@/错目的.json"]},
    {"调用": "verify", "参数": ["@工作@/条目非列表.json"]},
    {"调用": "verify", "参数": ["@工作@/条目坏.json"]},
    {"调用": "verify", "参数": ["@工作@/位置空.json"]},
    {"调用": "verify", "参数": ["@工作@/坏字节.json"]},
])

说明 = (
    "preset 模块的差分语料。与 png 那套同形：情形制、工作目录建在 差分/ 底下"
    "（`_tmp_preset-`），每步记「调用 + 参数 + 返回值 + 异常 + stdout」，最后比整棵工作树。"
    "★ 已申报差异（唯一一处）：**JSON 解析器与 UTF-8 解码器的原话两边天生不同** —— "
    "CPython 抛 `json.JSONDecodeError`（`Expecting property name enclosed in double quotes: "
    "line 1 column 2 (char 1)`），Node 抛 `SyntaxError`（`Expected property name or '}' in JSON "
    "at position 1 (line 1 column 2)`）。两侧 `算_preset` 用同一张折叠表 `_折错预设` 把"
    "「解析器原话」折成 `<解析器说>`，**只丢措辞、不丢「在哪一层失败的」**"
    "（`读不了预设 JSON：<解析器说>` / `设定库那段 JSON 解不开：<解析器说>` / "
    "`JSONDecodeError: <解析器说>`）。其余一律逐字节比："
    "工作树、stdout、异常类名（`exc.constructor.name` ⇔ `type(exc).__name__`）、"
    "以及每一个常量的取值。"
    "★ 预设 PNG 的 `tEXt eleckoi_agent_preset` 那一块**不压缩**（客户端只做 base64→utf8），"
    "所以它逐字节可比；整张图仍由 `_折回` / `_折树` 折成逐块分解（同 png 那套）。"
    "★ 语料里别放整数值的浮点（Python 写 21.0、JS 写 21）。"
    "★ `{\"调用\": \"常量:名字\"}` 这种步返回模块常量本身，不调用它。"
)

料 = {"说明": 说明, "情形": 情形们}

出 = 根 / "差分" / "语料" / "preset.json"
出.write_text(json.dumps(料, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print("语料 %s  %d 情形 %d 步" % (出, len(情形们), sum(len(c["操作"]) for c in 情形们)))
