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
import os
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


def 算_pack(料: dict) -> dict:
    """拿真卡走一遍 unpack → build。卡那边逐字节比，规格那边结构相等比。"""
    import os
    import tempfile

    import yaml

    from forge import pack as P

    出: dict = {"卡": []}
    for 相对 in 料["卡"]:
        卡 = str(根 / 相对)
        工作 = tempfile.mkdtemp(prefix="pack-")
        规格 = os.path.join(工作, "x.spec.yaml")
        P.unpack(卡, 规格)
        结构 = yaml.safe_load(Path(规格).read_text(encoding="utf-8"))
        重建 = os.path.join(工作, "x.card.json")
        P.build(规格, 重建)
        出["卡"].append({
            "输入": 相对,
            "规格": 结构,
            "卡字节": Path(重建).read_text(encoding="utf-8"),
        })
    # 认卡守卫：不是 ElecKoi 卡时必须当场拒绝（只比消息，因为两边的异常类型名不同）
    出["非卡"] = []
    for 相对 in 料.get("非卡", []):
        卡 = str(根 / 相对)
        工作 = tempfile.mkdtemp(prefix="pack-")
        try:
            P.unpack(卡, os.path.join(工作, "x.spec.yaml"))
            出["非卡"].append({"输入": 相对, "值": "没报错（不该）"})
        except Exception as exc:  # noqa: BLE001
            出["非卡"].append({"输入": 相对, "消息": str(exc)})
    return 出


算式["pack"] = 算_pack


def _诊断(i) -> dict:
    """一条诊断的差分形状。

    `HUD-CONF` 的 message 里嵌着**解释器自己的 JSON 报错原文**（Python 的
    JSONDecodeError 与 V8 的 SyntaxError 措辞天生不同）⇒ 这一条只比前缀，
    归一成「读不出来：<解析器原文>」。这是**备案过的例外**，见 `差分/语料/validate.json`。
    """
    msg = "读不出来：<解析器原文>" if i.code == "HUD-CONF" else i.message
    return {"level": i.level, "code": i.code, "where": i.where, "message": msg, "fix": i.fix}


def 算_validate(料: dict) -> dict:
    """卡层：validate_card + summarize + print_report（抓 stdout 逐字节比）。"""
    import contextlib
    import io

    from forge import validate as V

    出: dict = {"卡": [], "工程": []}
    for 相对 in 料["卡"]:
        card = M.jload(str(根 / 相对))
        issues = V.validate_card(card)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            errs = V.print_report(card, 相对, issues)
        出["卡"].append({
            "输入": 相对,
            "诊断": [_诊断(i) for i in issues],
            "摘要": V.summarize(card),
            "报告": buf.getvalue(),
            "错误数": errs,
        })
    for 相对 in 料["工程"]:
        p = str(根 / 相对)
        出["工程"].append({
            "输入": 相对,
            "界面": [_诊断(i) for i in V.validate_hud(p)],
            "工程": [_诊断(i) for i in V.validate_project(p)],
        })
    return 出


算式["validate"] = 算_validate


def _净化(x):
    """把 PyYAML 解析出来的东西变成**两边可比**的形状。

    `safe_load` 会给出 `datetime` / `date` / 非有限 float 这类 JSON 塞不进去的值 ——
    这里把它们换成带类型名的标记对象，**让差分当场炸出来**，而不是悄悄当成字符串。
    （引擎写出的 spec 里时间戳一律带单引号，所以正常路径撞不上；撞上就是手写文件。）
    """
    if isinstance(x, dict):
        return {str(k): _净化(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_净化(v) for v in x]
    if isinstance(x, bool) or x is None or isinstance(x, int):
        return x
    if isinstance(x, float):
        if x != x or x in (float("inf"), float("-inf")):
            return {"__python类型__": "float", "__repr__": repr(x)}
        return x
    if isinstance(x, str):
        return x
    return {"__python类型__": type(x).__name__, "__repr__": repr(x)}


def 算_yaml(料: dict) -> dict:
    """YAML：比**结构**，不比排版（唯一备案过的例外）。"""
    import yaml as Y

    出: dict = {"文件": []}
    for 相对 in 料["文件"]:
        文 = (根 / 相对).read_text(encoding="utf-8")
        出["文件"].append({"输入": 相对, "结构": _净化(Y.safe_load(文))})
    return 出


算式["yaml"] = 算_yaml


# ------------------------------------------------------------------ content
_UUID8 = re.compile(r"[0-9a-f]{8}")
_ISO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}[+-]\d{2}:\d{2}")
# 打在**人话里**的随机 id（`id      skel-entry-6912e0a8` 这种）：紧跟在 `-` 后面、且后面不再接
# 十六进制字符的 8 位十六进制才算 —— 免得把 12 位的指纹（sha1 前 12 位）咬掉一截。
_文本8 = re.compile(r"(?<=-)[0-9a-f]{8}(?![0-9a-f])")


def _净文本(s: str) -> str:
    return _ISO.sub("<时间>", _文本8.sub("<hex8>", s))


def _动(x, 键=None):
    """把随机/时间那一类东西归一：id 里的 8 位十六进制、created_at/updated_at/回收站时间。

    不归一就没法比 —— 两侧每一步的 uuid 与时间戳天生不同。
    """
    if isinstance(x, str):
        if 键 in ("created_at", "updated_at", "时间"):
            return _ISO.sub("<时间>", x)
        if 键 in ("id", "谁") or (isinstance(键, str) and 键.endswith("_id")):
            return _UUID8.sub("<hex8>", x)
        if 键 == "_文件":
            return "<回收站文件名>"
        if 键 == "_路径":
            return "<回收站路径>"
        # 兜底：任何**值**里那种「`-` 后面跟 8 位十六进制」的随机 id 尾巴（键名五花八门，
        # `变量id` / `对象 id` / 数据里当键用的 id 都见过）—— 与其逐个键名去猜，不如按形状收。
        return _文本8.sub("<hex8>", x)
    if isinstance(x, dict):
        return {_文本8.sub("<hex8>", str(k)): _动(v, str(k)) for k, v in x.items()}
    if isinstance(x, list):
        return [_动(v, 键) for v in x]
    return x


def _树(根):
    """整棵树的快照：普通文件比 sha1；spec 比**结构**；回收站记录按位次编号比结构。"""
    import hashlib

    from forge import model as MM

    项 = []
    第几条 = 0
    for base, dirs, files in os.walk(根):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        for f in sorted(files):
            p = os.path.join(base, f)
            rel = os.path.relpath(p, 根).replace("\\", "/")
            if rel.startswith(".forge/回收站/") and f.endswith(".json"):
                第几条 += 1
                try:
                    记录: object = json.loads(Path(p).read_text(encoding="utf-8"))
                except Exception as exc:  # noqa: BLE001
                    记录 = {"读不出来": str(exc)}
                项.append({"路径": ".forge/回收站/<第 %d 条>.json" % 第几条, "记录": _动(记录)})
                continue
            if ".spec." in f:
                项.append({"路径": rel, "结构": _动(MM.load_structured(p))})
                continue
            项.append({"路径": rel, "sha1": hashlib.sha1(Path(p).read_bytes()).hexdigest()})
    return 项


def _换路径(x, 对):
    if isinstance(x, str):
        for a, b in 对:
            x = x.replace(a, b)
        return x
    if isinstance(x, dict):
        return {_换路径(k, 对): _换路径(v, 对) for k, v in x.items()}
    if isinstance(x, list):
        return [_换路径(v, 对) for v in x]
    return x


def 算_content(料: dict) -> dict:
    """顺序跑一串内容操作，每步比 stdout / 返回值 / 异常消息，最后比整棵树。"""
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import content as C

    工作 = Path(tempfile.mkdtemp(prefix="content-"))
    工程 = 工作 / "工程"
    shutil.copytree(根 / 料["工程"], 工程)
    规格 = str(工程 / 料["规格"])

    出: dict = {"步": []}
    for 步 in 料["操作"]:
        参数 = [a.replace("@根@", str(工程)) if isinstance(a, str) else a for a in 步.get("参数", [])]
        buf = io.StringIO()
        rec: dict = {"调用": 步["调用"], "参数": 参数}
        try:
            with contextlib.redirect_stdout(buf):
                回 = getattr(C, 步["调用"])(规格, *参数)
            rec["回"] = _动(回)
            rec["错"] = None
        except Exception as exc:  # noqa: BLE001
            rec["回"] = None
            rec["错"] = _净文本("%s: %s" % (type(exc).__name__, exc))
        rec["出"] = _净文本(buf.getvalue())
        出["步"].append(rec)
    出["树"] = _树(工程)
    shutil.rmtree(工作, ignore_errors=True)

    对 = [(str(工程), "<工程>"), (str(工作), "<临时>"),
          (str(工程).replace("\\", "\\\\"), "<工程>"), (str(工作).replace("\\", "\\\\"), "<临时>")]
    return _换路径(出, 对)


算式["content"] = 算_content


def 算_sandbox(料: dict) -> dict:
    """同一串步骤跑两遍：模式关 / 模式开。开与关的差别只落在 land / retire / shell 上。"""
    import shutil
    import tempfile

    from forge import sandbox as SB

    工作 = Path(tempfile.mkdtemp(prefix="sandbox-"))

    def 跑一遍(标签: str, 开关: bool):
        SB.enable(开关)
        词根 = 工作 / 标签
        词根.mkdir(parents=True, exist_ok=True)

        def 路(k):
            return str(词根 / k[4:].lstrip("/")) if k.startswith("@根@/") else k

        def 路相对(k):
            """写 / 读 / 问在不在 —— 这几处的路径**一律相对词根**（夹具不该落到工作目录里）。"""
            return str(词根 / k[4:].lstrip("/")) if k.startswith("@根@/") else str(词根 / k)

        def 写文本(p, s):
            Path(p).parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w", encoding="utf-8", newline="\n") as f:
                f.write(s)

        步 = []
        for s in 料["步骤"]:
            做 = s["做"]
            if 做 == "写":
                写文本(路相对(s["路径"]), s["内容"])
                步.append({"做": 做, "路径": s["路径"]})
            elif 做 == "目录":
                Path(路相对(s["路径"])).mkdir(parents=True, exist_ok=True)
                步.append({"做": 做, "路径": s["路径"]})
            elif 做 == "在":
                步.append({"做": 做, "路径": s["路径"], "回": Path(路相对(s["路径"])).exists()})
            elif 做 == "读":
                p = Path(路相对(s["路径"]))
                步.append({"做": 做, "路径": s["路径"],
                           "回": p.read_text(encoding="utf-8") if p.exists() else None})
            else:
                参数 = [路(a) if isinstance(a, str) else a for a in s.get("参数", [])]
                步.append({"做": 做, "调用": s["调用"], "回": getattr(SB, s["调用"])(*参数)})
        return 步

    出: dict = {"关": 跑一遍("关", False), "开": 跑一遍("开", True)}
    开关 = []
    for s in 料["开关"]:
        开关.append({"调用": s["调用"], "回": getattr(SB, s["调用"])(*s.get("参数", []))})
    出["开关"] = 开关
    出["enabled"] = SB.enabled()
    shutil.rmtree(工作, ignore_errors=True)
    return 出


算式["sandbox"] = 算_sandbox


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
