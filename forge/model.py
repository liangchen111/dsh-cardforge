# -*- coding: utf-8 -*-
"""forge.model —— 卡片数据模型：格式常量、键序、读写助手。

键序是从真实卡片里抄出来的（ElecKoi 的 entryFromJson 读得很松，但写出去时
顺序与官方一致最保险）。改动这张表前先想想：它在三处被引用（unpack/build/校验）。
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
from collections import OrderedDict
from dataclasses import dataclass, field as dc_field

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "缺少 PyYAML。装一个：\n"
        "    pip install pyyaml\n"
    )
    raise SystemExit(2)

CARD_FORMAT = "eleckoi.character-card"
LIB_FORMAT = "eleckoi.setting-library-snapshot"
VAR_FORMAT = "eleckoi.variable-config"

# 与官方写出的顺序一致
CHARACTER_KEYS = [
    "name", "group", "frontend_beauty_enabled", "profile_age", "profile_sex",
    "profile_height", "profile_birthday", "profile_like", "image_prompt",
    "opening", "show_opening",
]
ENTRY_KEYS = [
    "id", "title", "icon_id", "kind", "group_id", "content", "opening_messages",
    "default_opening_message_id", "agent_selection_hint", "agent_read_strategy",
    "dynamic_mode", "keywords", "keyword_scan_depth",
    "condition_keywords", "keyword_condition", "keyword_use_regex",
    "keyword_ignore_case", "keyword_whole_word", "keyword_recursion_depth",
    "trigger_mode", "enabled", "position", "prompt_position_id", "insert_role",
    "order", "view_order", "group_view_order", "tree_view_order", "created_at",
    "updated_at",
]
ENTRY_MESSAGE_KEYS = ["id", "title", "content", "initial_variable_state"]
GROUP_KEYS = ["id", "name", "parent_id", "order", "tree_view_order",
              "created_at", "updated_at"]
VAR_OBJECT_KEYS = ["id", "name", "parent_id", "enabled", "description",
                   "update_rule", "dynamic_key", "order", "tree_view_order",
                   "created_at", "updated_at"]
VAR_ITEM_KEYS = ["id", "title", "object_id", "enabled", "type", "default_value",
                 "description", "update_rule", "read_mode", "order",
                 "tree_view_order", "created_at", "updated_at"]
REGEX_KEYS = ["id", "name", "pattern", "replacement", "targets", "enabled",
              "display_only", "prompt_only", "run_on_edit", "order",
              # ↓ 官方「角色卡同步协议」里列的字段（docs/CHARACTER_CARD_TRANSFER.md §regex_rules），
              #   2026-10-15 补齐：以前只写前 10 个，多出来的四键虽然不会丢（ordered 会原样跟在后面），
              #   但**顺序与官方不一致** —— 公开工具照官方合同走，别自己定形状。
              "trim_strings", "min_depth", "max_depth", "substitute_regex"]

# 写回规格 YAML 的统一参数。多处引用，保证排版不随「最后跑的是谁」漂移。
YAML_OPTS = dict(allow_unicode=True, sort_keys=False, default_flow_style=False,
                 width=10 ** 6, indent=2)

# /pattern/flags 形式（软件用这种写法；纯字面量如 〔面板〕 也合法）
RE_SLASH = re.compile(r"^/.*/[gimsuy]*$", re.S)

# 变量条件的运行时根路径
STAT_ROOT = "stat_data."

CJK = re.compile(r"[\u3000-\u9fff\uff00-\uffef\u3040-\u30ff]")


# ------------------------------------------------------------------ 结果类型
@dataclass
class Issue:
    """一条诊断。level 用 ERROR / WARN / INFO，机器只看前两种。"""
    level: str
    code: str
    where: str
    message: str
    fix: str = ""

    def line(self) -> str:
        mark = {"ERROR": "✗", "WARN": "!", "INFO": "·"}.get(self.level, "?")
        tail = ("  → %s" % self.fix) if self.fix else ""
        return "  %s [%s] %s：%s%s" % (mark, self.code, self.where, self.message, tail)


def err(code, where, message, fix=""):
    return Issue("ERROR", code, where, message, fix)


def warn(code, where, message, fix=""):
    return Issue("WARN", code, where, message, fix)


def info(code, where, message, fix=""):
    return Issue("INFO", code, where, message, fix)


# ------------------------------------------------------------------ 小工具
def ordered(src, keys):
    """按 keys 顺序重排 dict，keys 之外的额外字段原样跟在后面。"""
    out = OrderedDict()
    if isinstance(src, dict):
        for k in keys:
            if k in src:
                out[k] = src[k]
        for k, v in src.items():
            if k not in out:
                out[k] = v
    return out


def plain(obj):
    """OrderedDict -> 普通 dict：PyYAML 的 safe_dump 不认 OrderedDict。"""
    if isinstance(obj, dict):
        return {k: plain(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [plain(v) for v in obj]
    return obj


def jload(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=OrderedDict)


def jdump(obj, path, indent=2):
    text = json.dumps(obj, ensure_ascii=False, indent=indent) if indent is not None \
        else json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def yload(path):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def ydump(obj, path):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        yaml.safe_dump(plain(obj), f, **YAML_OPTS)


def load_structured(path):
    """按扩展名读 json / yaml。"""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".yaml", ".yml"):
        return yload(path)
    return jload(path)


def is_yaml(path):
    return os.path.splitext(path)[1].lower() in (".yaml", ".yml")


def now_iso():
    """官方的时间戳形状：带微秒、带时区偏移。"""
    return datetime.datetime.now().astimezone().isoformat()


def new_id(prefix):
    return "%s-%s" % (prefix, uuid4hex())


def uuid4hex():
    import uuid
    return uuid.uuid4().hex


def disp_width(text):
    """按终端里的显示宽度数：中日韩全角算 2 列，其余算 1 列。

    报告里到处是中英混排（「骰子 v1.0.0 …」），用 %-6s 那种按字符数补齐
    会歪得很明显 —— 歪了人就不看了，而这份清单是要人看的。
    """
    import unicodedata
    n = 0
    for ch in str(text):
        n += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return n


def pad(text, width, align="left"):
    """按显示宽度补空格。"""
    text = str(text)
    gap = max(0, width - disp_width(text))
    if align == "right":
        return " " * gap + text
    return text + " " * gap


def ascii_prefix(name, fallback="card"):
    """从卡名折出一个合法的 id 前缀：字母开头、纯 ASCII。

    纯中文名折不出字母，这时退化成 fallback + 卡名的短哈希 —— 不用同一个
    'card' 兜住所有中文卡（那样两张中文卡的 id 会长得一模一样，混起来难认）。
    """
    s = re.sub(r"[^0-9A-Za-z]", "", name or "").lower()
    if re.search(r"[a-z]", s):
        if not s[0].isalpha():
            s = fallback + s
        return s[:16]
    h = hashlib.md5((name or "").encode("utf-8")).hexdigest()[:6]
    return (fallback + h)[:16]


def est_tokens(text):
    """粗略估算 token：中日韩字符约 1 字 1 token，其余约 3.6 字符 1 token。仅供比较。"""
    if not text:
        return 0
    text = str(text)
    cjk = len(CJK.findall(text))
    return int(round(cjk + (len(text) - cjk) / 3.6))


def temp_json():
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    return path


def strip_upload_prefix(base):
    """去掉上传时附加的 uuid 前缀：'f3e2..._艾瑟兰 (1).json' -> '艾瑟兰 (1)'。"""
    if "_" in base:
        head, tail = base.rsplit("_", 1)
        if tail:
            return tail
    return base
