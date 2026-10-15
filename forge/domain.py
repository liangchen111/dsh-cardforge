# -*- coding: utf-8 -*-
"""forge.domain —— ElecKoi 真值域表与静默降级拦截。

这张表是本工具的护城河：市面上所有 SillyTavern 制卡工具都不知道 ElecKoi 的
真实字段值域，于是导进去的卡有一半字段是「看着对、其实没生效」。

事实来源（可复核）：
    E:\\workGZQ\\艾瑟兰\\文档\\ElecKoi真规则-取证.md
    反编译自本机 ElecKoi 0.2.8 的 resources\\app.asar（647,889,675 字节），
    逐字节全包搜索，命中次数写在下面每条的 note 里。

两条平台行为：
    1. 未知值不会报错，会被「静默降级」成缺省值 —— 症状是「填了没反应」。
    2. 有些字段平台根本不读（如 agent_read_condition，全 asar 0 次），
       留在卡里只是死重量，且会误导后来人以为它生效。
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from typing import Dict, List, Optional

from .model import Issue, err, warn, info


@dataclass
class Domain:
    """一个字段的合法值域。"""
    values: List[str]                 # 平台认的值
    default: str                      # 缺省值（不写字段时的值）
    legacy: Dict[str, str] = dc_field(default_factory=dict)   # 旧值 -> 被降级成什么
    unknown_to: Optional[str] = None   # 未认出的值 -> 被降级成什么（None = 保持原样）
    note: str = ""


DOMAINS: Dict[str, Domain] = {
    "trigger_mode": Domain(
        values=["always", "agent_tool"],
        default="always",
        note="always = 提示词常驻；agent_tool = 由 AI 读取。缺省 always。",
    ),
    "agent_read_strategy": Domain(
        values=["required", "keyword", "normal"],
        default="normal",
        legacy={"variable_condition": "normal"},
        note="required=必读 / keyword=命中后本轮必读 / normal=选读。"
             "旧值 variable_condition 会被显式降级为 normal（源码 normalizeEntry 原文）。",
    ),
    "kind": Domain(
        values=["normal", "opening", "history_compaction", "hidden_tool_timeline"],
        default="normal",
        note="条目类型。缺省 normal。",
    ),
    "dynamic_mode": Domain(
        values=["standard", "ejs_reference"],
        default="standard",
        legacy={"ejs_controller": "standard", "single_condition": "standard"},
        unknown_to="standard",
        note="ejs_controller 会被显式降级；single_condition 全 asar 0 次，平台不认识。",
    ),
    "content_mode": Domain(
        values=["plain_text", "ejs"],
        default="plain_text",
        note="正文解释方式。缺省 plain_text。字段通常不写。",
    ),
    "keyword_condition": Domain(
        values=["none", "any", "all", "not_any"],
        default="none",
        note="多关键词之间的逻辑。空串按 none 处理，无害。",
    ),
    "insert_role": Domain(
        values=["system", "user", "assistant"],
        default="user",
        note="正文以谁的口气插入。",
    ),
}

# 「插入位置」（条目字段 position）**故意不进 DOMAINS**：
#   卡里可以在 library.prompt_positions 里自定义位置 id，一旦进了值域表，
#   那些自定义 id 就会被当成「不合法」报出来 —— 宁可少报也不误报。
#   所以这里只给说明，由 `forge.py domains` 末尾打出来。
POSITION_NOTE = (
    "插入位置（条目字段 position）：",
    "      留空 \"\"          不占系统提示词位 —— 关键词命中、或由 AI 选读时才插入（世界书 / 参考类）",
    "      \"instructions\"  并入系统提示词区 —— 每轮都在（常驻 / 必读类条目用它）",
    "      卡里在 library.prompt_positions 自定义的位置，也可以写那个位置的 id（本工具不校验）。",
)

# 平台读都不读的字段：留着只是死重量，且会让后来人误以为生效。
DEAD_FIELDS: Dict[str, str] = {
    "agent_read_condition": "全 asar 出现 0 次 —— ElecKoi 根本不读它。"
                            "它承载的「变量条件加载」意图在 ElecKoi 里不生效。",
}

# 空串按缺省处理的字段（写了也不报错，但值是无意义的）
EMPTY_IS_DEFAULT = ("keyword_condition",)


def check_entry_domains(entry: dict, where: str) -> List[Issue]:
    """检查一条条目的值域。只在字段「存在」时校验（缺省不写是合法的）。"""
    out: List[Issue] = []

    for field, dom in DOMAINS.items():
        if field not in entry:
            continue
        raw = entry.get(field)
        if raw is None:
            continue
        if not isinstance(raw, str):
            out.append(warn(
                "DOMAIN-TYPE", where,
                "字段 %s 的值不是字符串（%r）" % (field, raw),
                "改成字符串 %r。" % dom.default,
            ))
            continue

        value = raw.strip()

        if value == "":
            if field in EMPTY_IS_DEFAULT:
                out.append(info(
                    "DOMAIN-EMPTY", where,
                    "%s 是空串，平台按缺省 %r 处理" % (field, dom.default),
                    "可以留着，也可以显式写成 %r。" % dom.default,
                ))
            elif dom.default:
                out.append(warn(
                    "DOMAIN-EMPTY", where,
                    "%s 是空串，会被当成缺省 %r" % (field, dom.default),
                    "显式写成 %r 更清楚。" % dom.default,
                ))
            continue

        if value in dom.values:
            continue

        # 不合法 —— 分「已知旧值」与「彻底不认识」两种
        if value in dom.legacy:
            target = dom.legacy[value]
            out.append(err(
                "DOMAIN-LEGACY", where,
                "%s = %r 是平台已知的旧值，会被静默降级为 %r（意图丢失）"
                % (field, value, target),
                "改成 %r；若原意是「满足变量条件才加载」，ElecKoi 没有这个策略，"
                "改用 keyword 关键词，或把该条改成 agent_tool + normal 由 AI 选读。"
                % target if field == "agent_read_strategy" else "改成 %r。" % target,
            ))
        elif dom.unknown_to:
            out.append(err(
                "DOMAIN-UNKNOWN", where,
                "%s = %r 不被平台识别，会被降级为 %r" % (field, value, dom.unknown_to),
                "改成 %r。" % dom.unknown_to,
            ))
        else:
            out.append(err(
                "DOMAIN-UNKNOWN", where,
                "%s = %r 不在合法值域内" % (field, value),
                "合法值：%s。" % " / ".join(dom.values),
            ))

    for field, why in DEAD_FIELDS.items():
        if entry.get(field):
            out.append(info(
                "DOMAIN-DEAD", where,
                "字段 %s 平台不读：%s" % (field, why),
                "删掉它，或改成平台认的策略（见 agent_read_strategy 的值域）。",
            ))

    return out


def domain_table_markdown() -> str:
    """生成一张给人看的值域表（进手册）。"""
    lines = [
        "| 字段 | 合法值 | 缺省 | 旧值会怎样 |",
        "|---|---|---|---|",
    ]
    for name, dom in DOMAINS.items():
        legacy = "、".join("%s→%s" % (k, v) for k, v in dom.legacy.items()) or "—"
        lines.append("| `%s` | %s | `%s` | %s |"
                     % (name, " / ".join("`%s`" % v for v in dom.values),
                        dom.default, legacy))
    return "\n".join(lines)
