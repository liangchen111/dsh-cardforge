# -*- coding: utf-8 -*-
"""出黄金 —— 用 **Python 版** 对差分语料算一遍，把结果存成 `差分/黄金/<名>.json`。

这份文件是**参照物**：JS 版必须算出逐字节一样的输出。只在确认「行为变更」时才重跑它，
而且要在重写计划里写明为什么变。

用法：
    python 差分/出黄金.py            # 刷新全部黄金
    python 差分/出黄金.py model      # 只刷某一份
"""
from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

根 = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from forge import model as M  # noqa: E402  （必须放在 sys.path 之后）

语料目录 = 根 / "差分" / "语料"
黄金目录 = 根 / "差分" / "黄金"


def 算_model(料: dict) -> dict:
    出: dict = {}

    出["常量"] = {
        "CARD_FORMAT": M.CARD_FORMAT,
        "LIB_FORMAT": M.LIB_FORMAT,
        "VAR_FORMAT": M.VAR_FORMAT,
        "STAT_ROOT": M.STAT_ROOT,
    }

    出["键序"] = {
        "CHARACTER_KEYS": list(M.CHARACTER_KEYS),
        "ENTRY_KEYS": list(M.ENTRY_KEYS),
        "ENTRY_MESSAGE_KEYS": list(M.ENTRY_MESSAGE_KEYS),
        "GROUP_KEYS": list(M.GROUP_KEYS),
        "VAR_OBJECT_KEYS": list(M.VAR_OBJECT_KEYS),
        "VAR_ITEM_KEYS": list(M.VAR_ITEM_KEYS),
        "REGEX_KEYS": list(M.REGEX_KEYS),
    }

    出["ordered"] = [list(M.ordered(项["src"], 项["keys"]).items()) for 项 in 料["ordered"]]
    出["dispWidth"] = [M.disp_width(文) for 文 in 料["dispWidth"]]
    出["pad"] = [M.pad(项["text"], 项["width"], 项["align"]) for 项 in 料["pad"]]
    出["estTokens"] = [M.est_tokens(文) for 文 in 料["estTokens"]]
    出["asciiPrefix"] = [M.ascii_prefix(项["name"], 项["fallback"]) for 项 in 料["asciiPrefix"]]
    出["stripUploadPrefix"] = [M.strip_upload_prefix(名) for 名 in 料["stripUploadPrefix"]]
    出["issueLine"] = [
        M.Issue(项["level"], 项["code"], 项["where"], 项["message"], 项["fix"]).line()
        for 项 in 料["issueLine"]
    ]
    出["RE_SLASH"] = [
        bool(M.RE_SLASH.match(样本))
        for 样本 in ["/abc/g", "〔面板〕", "/^.+$/isu", "abc", "/a"]
    ]
    出["isYaml"] = [M.is_yaml(名) for 名 in ["a.yaml", "a.YML", "a.json", "a", "a.txt"]]

    jdump结果 = []
    for 项 in 料["jdump"]:
        fd, 路径 = tempfile.mkstemp(suffix=".json")
        import os
        os.close(fd)
        M.jdump(项["obj"], 路径, 项["indent"])
        jdump结果.append(Path(路径).read_text(encoding="utf-8"))
        os.unlink(路径)
    出["jdump"] = jdump结果

    # 非确定性的东西只比「形状」
    出["形状"] = {
        "uuid4hex": bool(re.fullmatch(r"[0-9a-f]{32}", M.uuid4hex())),
        "newId": bool(re.fullmatch(r"card-[0-9a-f]{32}", M.new_id("card"))),
        "nowIso": bool(re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}[+-]\d{2}:\d{2}", M.now_iso())),
    }
    return 出


算式 = {"model": 算_model}


def 算_domain(料: dict) -> dict:
    from forge import domain as D

    出: dict = {}
    出["条目"] = [
        [
            {"level": i.level, "code": i.code, "where": i.where,
             "message": i.message, "fix": i.fix}
            for i in D.check_entry_domains(项["entry"], 项["where"])
        ]
        for 项 in 料["条目"]
    ]
    出["值域键序"] = list(D.DOMAINS.keys())
    出["表"] = {
        名: {
            "values": list(d.values),
            "default": d.default,
            "legacy": dict(d.legacy),
            "unknown_to": d.unknown_to,
            "note": d.note,
        }
        for 名, d in D.DOMAINS.items()
    }
    出["表格"] = D.domain_table_markdown()
    出["说明"] = {
        "POSITION_NOTE": list(D.POSITION_NOTE),
        "DEAD_FIELDS": dict(D.DEAD_FIELDS),
        "EMPTY_IS_DEFAULT": list(D.EMPTY_IS_DEFAULT),
    }
    return 出


算式["domain"] = 算_domain


def 算_zod(料: dict) -> dict:
    from forge import zod as Z

    def 试(fn):
        try:
            return {"值": fn()}
        except Z.ZodError as e:
            return {"错": "ZodError", "消息": str(e)}

    出: dict = {}
    出["解析"] = [试(lambda c=项["code"]: Z.dump(Z.parse(c))) for 项 in 料["解析"]]
    出["生成"] = [试(lambda c=项["code"]: Z.emit(Z.parse(c))) for 项 in 料["生成"]]
    出["往返"] = [试(lambda c=项["code"]: Z.roundtrip_ok(c)) for 项 in 料["往返"]]
    出["顶层键"] = [试(lambda c=项["code"]: Z.top_keys(c)) for 项 in 料["顶层键"]]
    出["是对象"] = [试(lambda c=项["code"]: Z.is_object(c)) for 项 in 料["是对象"]]
    出["类型表达式"] = [Z.expr_for(项["type"], 项["value"]) for 项 in 料["类型表达式"]]
    出["键写法"] = [Z.key_raw(名) for 名 in 料["键写法"]]
    return 出


算式["zod"] = 算_zod


def main(argv):
    要跑的 = argv[1:] or sorted(算式)
    黄金目录.mkdir(parents=True, exist_ok=True)
    for 名 in 要跑的:
        料 = json.loads((语料目录 / ("%s.json" % 名)).read_text(encoding="utf-8"))
        出 = 算式[名](料)
        文本 = json.dumps(出, ensure_ascii=False, indent=2)
        (黄金目录 / ("%s.json" % 名)).write_text(文本, encoding="utf-8", newline="\n")
        print("黄金 %-8s %d 字节" % (名, len(文本.encode("utf-8"))))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main(sys.argv)
