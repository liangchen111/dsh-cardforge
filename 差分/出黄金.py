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
        if 键 in ("created_at", "updated_at", "时间") or (isinstance(键, str) and 键.endswith("_at")):
            # ★ `*_at` 一律当时间：bridge 产出的库里还有 `config_updated_at` /
            #   `config_created_at` 这类**不叫 created_at/updated_at** 的时间戳，
            #   按名字枚举会漏，两侧各拿一次 `now_iso()` ⇒ 差分必红（且黄金本身也会随
            #   每次重出而变）。按后缀收，见 比一比.mjs 同名分支。
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
    if isinstance(x, (list, tuple)):
        # ★ tuple 也要走：`json.dumps` 本来就把 tuple 写成数组，JS 那边 Array 一直走的就是这条。
        #   少这一条，Python 侧 tuple 里的字符串就**整个跳过归一**，而 JS 侧照样归一 —— 差分必红。
        return [_动(v, 键) for v in x]
    if hasattr(x, "__dict__"):
        # ★ 带属性的对象 —— `draft._体检()` 交回来的 `model.Issue` 就是这一类。
        #   JS 那边的 `动()`（比一比.mjs:281）本来就把**任何**对象递归成键值对；Python 这边少了这一条，
        #   `json.dumps` 会在写黄金那一步直接 `TypeError: Object of type Issue is not JSON serializable`。
        #   键序与 `Issue.__init__` 的赋值序一致，与 JS 的 `Object.entries()` 同一个序。
        return {_文本8.sub("<hex8>", str(k)): _动(v, str(k)) for k, v in vars(x).items()}
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
            # 回收站记录的名字与内容里都带随机量（时间戳 + uuid），只能按**位次**比结构。
            # 注意**嵌套的**也算（语料把多个夹具工程并排放进一个拷出来的根里，
            # rel 就成了 `甲界面/.forge/回收站/…`）——少这一支，两边就只能比 sha1，必红。
            if f.endswith(".json") and (rel.startswith(".forge/回收站/") or "/.forge/回收站/" in rel):
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


def 算_opener(料: dict) -> dict:
    """顺序跑一串开场白操作，每步比 stdout / 返回值 / 异常消息，最后比整棵树。

    与 `算_content` 同形，只有两点不同：

      · opener 的入口**有时是工程目录、有时是 spec 文件**，没有 content 那种固定的「规格」
        首位参数 ⇒ 参数全写在语料里（`@根@` 照样被换成临时工程根，dict / list 里的字符串也换）。
      · 界面档的「写回 spec」支路要 `hud` 的 `HUD.build` —— 夹具 `卯全界面` 带整份
        `assets/骨架`，这条支路已**真跑**；`HUD.build` 每次都现生成 `regex-<uuid4>`，
        所以出口要过一道 `收_uuid()`（见那边的注释）。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import opener as O

    # ★ 工作目录**建在工具根底下**，不用系统 temp：Windows 的 temp 路径可能是 8.3 短名
    #   （`C:\Users\ADMINI~1\...`），而 Python 的 `os.path.abspath` 走 `GetFullPathNameW`、
    #   Node 的 `path.resolve` 只做字符串规范化 —— 同一个目录两边会算出两个写法，
    #   归一用的 `<工程>` 替换就对不上。同盘同长名才比得到同一条分支（scaffold 同此法）。
    工作 = Path(tempfile.mkdtemp(prefix="_tmp_opener-", dir=str(根)))
    工程 = 工作 / "工程"
    shutil.copytree(根 / 料["工程"], 工程)

    出: dict = {"步": []}
    for 步 in 料["操作"]:
        参数 = [_换路径(a, [("@根@", str(工程))]) for a in 步.get("参数", [])]
        buf = io.StringIO()
        rec: dict = {"调用": 步["调用"], "参数": 参数}
        try:
            with contextlib.redirect_stdout(buf):
                回 = getattr(O, 步["调用"])(*参数)
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
    return _换路径(收_uuid(出), 对)


算式["opener"] = 算_opener


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


def 算_scaffold(料: dict) -> dict:
    """顺序跑一串 scaffold 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    ★ 工作目录**建在工具根底下**，不用系统 temp：`forge.scaffold._rel` 是 `os.path.relpath`
      包了一层 `except Exception: return target` —— Windows 上跨盘符 relpath 会抛
      `ValueError: path is on mount 'C:', start on mount 'E:'`、被那层 except 吞掉、
      原样返回绝对路径；而 Node 的 `path.relative` 根本不抛、会算出一串 `../../`。
      两边同盘才比得到同一条分支（跨盘那条已在 scaffold.mjs 的 `_rel` 里单独拦下）。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import scaffold as SC

    工作 = Path(tempfile.mkdtemp(prefix="_tmp_scaffold-", dir=str(根)))
    原沙箱 = SC.SB.enabled()
    # ★ 沙箱开关是**进程级**状态，而算_sandbox 跑完会把它留在「开」上（它的黄金里
    #   `enabled: true` 就是照实记下来的，没还原）。本函数的黄金必须与调用顺序无关
    #   —— 单独 `出黄金.py scaffold` 与整套 `跑.py --刷` 得是同一份 —— 所以这里显式摁回关，
    #   出门再按原样还原（不动下游模块看到的那个值）。
    SC.SB.enable(False)
    出: dict = {
        "常量": {
            "SRC_NAME": SC.SRC_NAME,
            "SRC_SLUG": SC.SRC_SLUG,
            "SKELETON": str(SC.SKELETON),
            "TEXT_EXT": sorted(SC.TEXT_EXT),
            "SKIP_DIRS": sorted(SC.SKIP_DIRS),
            "SKIP_FILES": sorted(SC.SKIP_FILES),
        },
        "开工说明": SC.PROJECT_README,
        "步": [],
    }
    try:
        (工作 / "工作区").mkdir()
        (工作 / "空卡").mkdir()
        (工作 / "空目录").mkdir()
        (工作 / "非空卡").mkdir()
        (工作 / "非空卡" / "里面.txt").write_text("占位\n", encoding="utf-8", newline="\n")
        (工作 / "非目录").write_text("我是个文件\n", encoding="utf-8", newline="\n")
        (工作 / "双spec" / "source").mkdir(parents=True)
        for 名 in ("a", "b"):
            shutil.copy2(
                根 / "assets" / "骨架" / "source" / "骨架.spec.yaml",
                工作 / "双spec" / "source" / ("%s.spec.yaml" % 名),
            )

        for 步 in 料["操作"]:
            if 步.get("开关"):
                SC.SB.enable(步["开关"][0])
            参数 = [
                a.replace("@根@", str(根)).replace("@工作@", str(工作)) if isinstance(a, str) else a
                for a in 步.get("参数", [])
            ]
            buf = io.StringIO()
            rec: dict = {"调用": 步["调用"], "参数": 参数}
            try:
                with contextlib.redirect_stdout(buf):
                    回 = getattr(SC, 步["调用"])(*参数)
                # 元组不是 list，_动 不会往里递归 —— 换成 list，跟 JS 侧（那边天生是数组）对齐
                rec["回"] = _动(list(回) if isinstance(回, tuple) else 回)
                rec["错"] = None
            except Exception as exc:  # noqa: BLE001
                rec["回"] = None
                rec["错"] = _净文本("%s: %s" % (type(exc).__name__, exc))
            rec["出"] = _净文本(buf.getvalue())
            出["步"].append(rec)
        出["树"] = _树(工作)
    finally:
        SC.SB.enable(原沙箱)
        shutil.rmtree(工作, ignore_errors=True)

    对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
    return _换路径(出, 对)


算式["scaffold"] = 算_scaffold


def 算_draft(料: dict) -> dict:
    """顺序跑一串 draft 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    语料分「预置」（建目录 / 写文件）与「操作」（按序调 draft 的函数）两段。

    ★ 工作目录**建在工具根底下**（同 算_scaffold / 算_opener）：Windows 的 temp 可能是 8.3
      短名（`C:\\Users\\ADMINI~1\\...`），Python 的 `os.path.abspath` 走 `GetFullPathNameW`、
      Node 的 `path.resolve` 只做字符串规范化 —— 同一目录两边算出两个写法，`<工作>` 替换失配。
    ★ 语料里没有「落卡成功落出一张卡」的用例：`draft.落卡` 的第一步就是
      `scaffold.new_card(..., build_hud=True)`（Python 原件的默认值），JS 侧 scaffold.mjs 的
      `_要(HUD,'hud')` 会明确抛错（hud.mjs 还没搬）⇒ 语料只覆盖 scaffold.new_card 之前的
      早期分支。清单与理由写在 差分/语料/draft.json 的「说明」里。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import draft as D

    工作 = Path(tempfile.mkdtemp(prefix="_tmp_draft-", dir=str(根)))
    # ★ 与 JS 侧一一对应（比一比.mjs 算_draft）：把当前目录切进工作目录，跑完在 finally 里
    #   切回来 —— 必须先切回来再 rmtree，Windows 上删不掉自己的 cwd。理由见那边的注释：
    #   稿里的 `到` / `落点` / `to` 三个键，以及「一个 到 都不给」时 `or os.getcwd()` 那条
    #   支路，都靠当前目录解析；cwd 停在工程根会让 `目标 = <cwd>/卡名` 不存在而走进主路径
    #   （Python 有 hud，真会在工程根里落出一张卡 —— 实测污染过一次）。
    原目录 = os.getcwd()
    os.chdir(str(工作))
    try:
        for 件 in 料["预置"]:
            if "目录" in 件:
                (工作 / 件["目录"]).mkdir(parents=True, exist_ok=True)
                continue
            p = 工作 / 件["文件"]
            p.parent.mkdir(parents=True, exist_ok=True)
            # ★ 写文件一律落到字节上（newline="\n"），`对象` 的 JSON 形状与分隔符也要跟 JS 侧
            #   `JSON.stringify(x, null, 2)` 逐字节对齐（末尾各加一个 \n）。
            if "对象" in 件:
                文 = json.dumps(
                    _换路径(件["对象"], [("@工作@", str(工作)), ("@根@", str(根))]),
                    ensure_ascii=False, indent=2,
                ) + "\n"
            else:
                文 = _换路径(件["文本"], [("@工作@", str(工作)), ("@根@", str(根))])
            p.write_text(文, encoding="utf-8", newline="\n")

        出: dict = {"步": []}
        for 步 in 料["操作"]:
            # dict / list 里的字符串也换（稿的 `到` 就藏在参数里的嵌套对象里）。
            参数 = _换路径(步.get("参数", []), [("@工作@", str(工作)), ("@根@", str(根))])
            buf = io.StringIO()
            rec: dict = {"调用": 步["调用"], "参数": 参数}
            try:
                with contextlib.redirect_stdout(buf):
                    # 有的名字是**常量**不是函数（`_条目特殊` 是 tuple、`_别名` 是 dict）
                    # ⇒ 语料给一步 `"常量": true`，两侧都只取值、不调用。
                    回 = getattr(D, 步["调用"]) if 步.get("常量") else getattr(D, 步["调用"])(*参数)
                rec["回"] = _动(list(回) if isinstance(回, tuple) else 回)
                rec["错"] = None
            except Exception as exc:  # noqa: BLE001
                rec["回"] = None
                rec["错"] = _净文本("%s: %s" % (type(exc).__name__, exc))
            rec["出"] = _净文本(buf.getvalue())
            出["步"].append(rec)
        出["树"] = _树(工作)
    finally:
        # 先切回来再删：Windows 上删不掉自己的 cwd。
        os.chdir(原目录)
        shutil.rmtree(工作, ignore_errors=True)

    对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
    return _换路径(出, 对)


算式["draft"] = 算_draft


def 算_mods(料: dict) -> dict:
    """逐个调 mods 的入口，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    ★ 工作目录**建在工具根底下**（同 算_scaffold / 算_opener / 算_draft）：Windows 的 temp 可能是
      8.3 短名（`C:\\Users\\ADMINI~1\\...`），Python 的 `os.path.abspath` 走 `GetFullPathNameW`、
      Node 的 `path.resolve` 只做字符串规范化 —— 同一目录两边算出两个写法，`<工作>` 替换失配。
    ★ 夹具全部在这里硬编码（甲/乙/丙/丁/戊/己/库无/零条目/坏账本/数账本/落版本），语料只给
      「换」（改文件）与「调用」两类步子；**两侧建法必须一字不差**。
    ★ 「接于」是时间戳，而公共 `_动()` 的 ISO 归一在值上只认 `created_at` / `updated_at` / `时间`，
      账本那个键不在口径里 ⇒ 收尾时把每份 `模块账本.json` 里的 ISO 形状文本换成 `<时间>`
      （两侧同做），否则 `_树` 的 sha1 必红。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import mods as MM

    def 写文本(p, 文: str):
        p = Path(p)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(文, encoding="utf-8", newline="\n")

    def 改文本(p, 对):
        文 = Path(p).read_text(encoding="utf-8")
        for 旧, 新 in 对:
            文 = 文.replace(旧, 新)
        写文本(p, 文)

    def 账本(表) -> str:
        # 跟 save_ledger 落盘一个形状（ensure_ascii=False · indent=2 · 末尾一个换行），
        # 这样 JS 侧 `JSON.stringify(表, null, 2) + "\n"` 与它逐字节同。
        return json.dumps(
            {"_说明": MM.LEDGER_NOTE, "格式": 1, "模块": 表}, ensure_ascii=False, indent=2
        ) + "\n"

    def 账本值(x):
        """把账本里的「接于」改名成「时间」，再交给公共 `_动()`。

        `_动()` 的 ISO 归一在**值**上只认 `created_at` / `updated_at` / `时间`，账本那个键
        不在口径里 —— 直接丢进去，两侧会把各自的真实时间戳原样写进黄金，必红。
        改名之后再走 `_动`，`时间` 那一支就会换成 `<时间>`（落盘的那份文件另外有收尾一遍
        正则替换，见下）。
        """
        if isinstance(x, dict):
            return {("时间" if k == "接于" else k): 账本值(v) for k, v in x.items()}
        if isinstance(x, (list, tuple)):
            return [账本值(v) for v in x]
        return x

    工作 = Path(tempfile.mkdtemp(prefix="_tmp_mods-", dir=str(根)))
    # ★ 把时钟钉死。`_fingerprint()` 是 `sha1(json.dumps(条目, sort_keys=True))`，而条目里
    #   带着 `created_at` / `updated_at`（`_clone_from` 现取 `M.now_iso()`）⇒ 不钉死的话
    #   两侧指纹必然不同，黄金自己两次跑都不一样（实测：连跑两遍黄金 md5 就不同）。
    #   钉死之后指纹才真的在比 `_pyJson` 的键序/分隔符/引号与整条条目的结构。
    from forge import model as MMODEL

    冻结 = "2026-01-01T00:00:00.000000+08:00"
    原now = MMODEL.now_iso
    MMODEL.now_iso = lambda: 冻结
    try:
        骨架 = 根 / "assets" / "骨架"

        def 拷(名: str) -> Path:
            目的 = 工作 / 名
            shutil.copytree(str(骨架), str(目的))
            return 目的

        甲 = 拷("工程甲")

        乙 = 拷("工程乙")
        (乙 / "hud" / "hud.conf.json").unlink()  # 没 hud 层的工程

        丙 = 拷("工程丙")  # 前缀不是 skel：走 infer_prefix 的 -grp- / -entry- 两支
        改文本(丙 / "source" / "骨架.spec.yaml", [("grp-skel-", "moonlight-grp-"), ("skel-", "moonlight-")])

        丁 = 拷("工程丁")  # 前缀 card ＋ 目标条目已存在（_clone_from 的撞名分支）
        改文本(
            丁 / "source" / "骨架.spec.yaml",
            [("skel-rule-check", "card-entry-rule-check"), ("skel-world-core", "card-mod-backup")],
        )

        戊 = 拷("工程戊")  # 参照条目被改名 ⇒ 找不到参照条目
        改文本(戊 / "source" / "骨架.spec.yaml", [("skel-rule-check", "skel-sentinel")])

        己 = 拷("工程己")  # 账本说接过『代笔』，但 spec 里没有 ⇒ 撤时不还原、也不删
        _接于 = "2020-01-01T00:00:00.000000+08:00"
        写文本(
            己 / "模块账本.json",
            账本({"代笔": {"id": "ai", "版本": "1.0.0", "接于": _接于,
                          "条目": {"替换": [], "新增": []}, "正则": [], "界面": []}}),
        )

        坏账本 = 拷("坏账本")
        写文本(坏账本 / "模块账本.json", "{这不是 JSON")

        数账本 = 拷("数账本")
        写文本(数账本 / "模块账本.json", "[]")

        落版本 = 拷("落版本")  # 账本里 v0.9.0 ⇒ print_modules 走「落后 ● ▲」那支
        写文本(
            落版本 / "模块账本.json",
            账本({"骰子": {"id": "dice", "版本": "0.9.0", "接于": _接于,
                          "条目": {"替换": [], "新增": []}, "正则": [], "界面": []}}),
        )

        写文本(工作 / "库无" / "source" / "空.spec.yaml", "library: {}\n")
        写文本(工作 / "零条目" / "source" / "零.spec.yaml", "library:\n  entries: []\n")

        出: dict = {
            "常量": {
                "ROOT": str(MM.ROOT),
                "MODS_DIR": str(MM.MODS_DIR),
                "LEDGER_NAME": MM.LEDGER_NAME,
                "LEDGER_NOTE": MM.LEDGER_NOTE,
                "RESERVED": list(MM.RESERVED),
                "DIRECTIVE": list(MM.DIRECTIVE),
            },
            "操作": [],
        }

        for 步 in 料["操作"]:
            if "换" in 步:
                路径 = _换路径(步["换"]["路径"], [("@工作@", str(工作)), ("@根@", str(根))])
                改文本(路径, [(步["换"]["旧"], 步["换"]["新"])])
                出["操作"].append({"做": "换", "参数": [路径], "回": None, "错": None, "出": ""})
                continue
            参数 = _换路径(步.get("参数", []), [("@工作@", str(工作)), ("@根@", str(根))])
            buf = io.StringIO()
            rec: dict = {"调用": 步["调用"], "参数": 参数}
            try:
                with contextlib.redirect_stdout(buf):
                    回 = getattr(MM, 步["调用"])(*参数)
                rec["回"] = _动(账本值(回))
                rec["错"] = None
            except Exception as exc:  # noqa: BLE001
                rec["回"] = None
                rec["错"] = _净文本("%s: %s" % (type(exc).__name__, exc))
            rec["出"] = _净文本(buf.getvalue())
            出["操作"].append(rec)

        # 账本里的「接于」不在 _动 的口径里 ⇒ 两侧都把 ISO 形状的文本换成 <时间>
        for p in sorted(工作.rglob("模块账本.json")):
            写文本(p, _ISO.sub("<时间>", p.read_text(encoding="utf-8")))

        出["树"] = _树(工作)
    finally:
        MMODEL.now_iso = 原now
        shutil.rmtree(工作, ignore_errors=True)

    对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
    return _换路径(出, 对)


算式["mods"] = 算_mods


def 出参数(x, 工作: Path, 根: Path):
    """把语料里的参数折成真参数，逐项递归替换占位符。

    逐项递归：dict / list 里的字符串也要换（比如 `{"out": "@工作@/out.txt"}`）。
    另有 `@@重复x4100@@` 这一类**展开占位符** —— 语料是 JSON，写不了 `"x" * 4100`，
    只能让两侧各自展开（比一比.mjs 那边同做）。
    """
    if isinstance(x, str):
        s = x.replace("@根@", str(根)).replace("@工作@", str(工作))
        return s.replace("@@重复x4100@@", "x" * 4100)
    if isinstance(x, dict):
        return {出参数(k, 工作, 根): 出参数(v, 工作, 根) for k, v in x.items()}
    if isinstance(x, list):
        return [出参数(v, 工作, 根) for v in x]
    return x


def 动回(x):
    """返回值的额外归一（`_动` 之前压一层）。

    ★ `parse_pattern()` 返回的是 `re.Pattern` 对象 —— Python 的 `repr` 里带内存地址
      （`re.compile('a.c', re.IGNORECASE|re.DOTALL)` 这种），两边永远不可能逐字节同。
      统一折成 `{"来源": pattern, "i": bool, "m": bool, "s": bool}`（比一比.mjs 那边
      把 `new RegExp` 的 `.source` / `.flags` 折成同一形状）。这是**已申报差异**，
      写在 差分/语料/hud.json 的「说明」里。
    """
    import re as _re

    if isinstance(x, _re.Pattern):
        f = x.flags
        return {"来源": x.pattern,
                "i": bool(f & _re.I), "m": bool(f & _re.M), "s": bool(f & _re.S)}
    if isinstance(x, list):
        return [动回(v) for v in x]
    if isinstance(x, tuple):
        return [动回(v) for v in x]
    return x


def 错文本(调用: str, exc: Exception) -> str:
    """异常消息归一。

    ★ **已申报差异**：`configure()` 读 hud.conf.json 是用 `json.load()` —— conf 不是合法
      JSON 时抛 `json.decoder.JSONDecodeError`，而两侧 JSON 解析器的报错措辞天生不同
      （Python 给 `Expecting ',' delimiter: line 132 column 77 (char 8418)`，Node 给
      `Unexpected token ... in JSON at position ...`）。这条**只**在 `configure` 上发生，
      且语料有一步专门踩它来证明「确实抛了、确实抛在这支」⇒ 消息统一收成
      `JSONDecodeError: 读不出来：<解析器原文>`。
    """
    import json as _json

    if 调用 == "configure" and isinstance(exc, _json.JSONDecodeError):
        return "JSONDecodeError: 读不出来：<解析器原文>"
    return _净文本("%s: %s" % (type(exc).__name__, exc))


# `patch_spec()` 给**新增**的正则规则生成 `regex-<uuid4>`。已有的 `_UUID8`（8 位十六进制）
# / `_文本8`（`-` 后 8 位、后面不再接十六进制）都收不住一个完整的 uuid4 —— 剩下
# `-7a74-49d8-986e-` 这几段每次跑都不一样，黄金当场变成「只有这一次对」的假黄金。
# 所以按**形状**再收一道：uuid4 的 B/C 段天生是 4 位十六进制，被判到就说明这是个新生成的 id。
_UUID4状 = re.compile(r"^regex-.*-[0-9a-f]{4}-[0-9a-f]{4}-")


def 收_uuid(x):
    """把 `patch_spec()` 现生成的 `regex-<uuid4>` 按形状收成 `regex-<uuid4>`（字面）。"""
    if isinstance(x, str):
        return "regex-<uuid4>" if _UUID4状.match(x) else x
    if isinstance(x, dict):
        return {k: 收_uuid(v) for k, v in x.items()}
    if isinstance(x, list):
        return [收_uuid(v) for v in x]
    return x


def 算_hud(料: dict) -> dict:
    """顺序跑一串 hud 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    与 `算_scaffold` 同形，只有两点不同：

      · 夹具是**先写盘**再跑操作（`预置` 里的 目录 / 文件），不是代码里硬编码的；
      · 入口参数全写在语料里（`@工作@` / `@根@` 照样被换，dict / list 里的字符串也换）。

    ★ 工作目录**建在工具根底下**，不用系统 temp：Windows 的 temp 可能是 8.3 短名
      （`C:\\Users\\ADMINI~1\\…`），Python 的 `os.path.abspath` 走 `GetFullPathNameW`
      会把它还原成长名，Node 的 `path.resolve` 只做字符串规范化 ⇒ 同一个目录在两边
      成了两种写法，`<工作>` 归一失配。同盘、同写法才比得到一条线上。

    ★ 随机量：`patch_spec()` 给**新增**的正则规则生成 `regex-<uuid4>`；语料里那份
      spec 的结构快照走 `_动()` 收（按形状 `-` 后 8 位十六进制，键 `id` / `*_id` 收）。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import hud as H

    工作 = Path(tempfile.mkdtemp(prefix="_tmp_hud-", dir=str(根)))

    # 先把夹具写盘。目录要在文件之前建（浅的在前），文件一律 LF ——
    # `read_text(encoding="utf-8", newline="\n")` / `write_text(..., newline="\n")` 两边对齐。
    预置 = 料.get("预置") or {}
    for 名 in 预置.get("目录") or []:
        (工作 / 名).mkdir(parents=True, exist_ok=True)
    for 名, 文 in (预置.get("文件") or {}).items():
        p = 工作 / 名
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(文, encoding="utf-8", newline="\n")

    出: dict = {"步": []}
    try:
        for 步 in 料["操作"]:
            参数 = [出参数(a, 工作, 根) for a in (步.get("参数") or [])]
            buf = io.StringIO()
            rec: dict = {"调用": 步["调用"], "参数": _动(参数)}
            try:
                with contextlib.redirect_stdout(buf):
                    回 = getattr(H, 步["调用"])(*参数)
                # 元组不是 list，_动 不会往里递归 —— 换成 list，跟 JS 侧（那边天生是数组）对齐
                rec["回"] = _动(动回(list(回) if isinstance(回, tuple) else 回))
                rec["错"] = None
            except Exception as exc:  # noqa: BLE001
                rec["回"] = None
                rec["错"] = 错文本(步["调用"], exc)
            rec["出"] = _净文本(buf.getvalue())
            出["步"].append(rec)
        出["树"] = _树(工作)
    finally:
        shutil.rmtree(工作, ignore_errors=True)

    对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
    return _换路径(收_uuid(出), 对)


算式["hud"] = 算_hud


def 算_bridge(料: dict) -> dict:
    """顺序跑一串 bridge 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    与 `算_opener` 同形，两处不一样：

      · 夹具不是现成的工程目录，而是语料里「预置」当场写出来的（PNG / zip 这类二进制
        用 base64 驮在 JSON 里）—— bridge 本来就是读这些输入的。
      · 参数里 `{"__字节__": "..."}` 还原成 bytes（`decode_card_text` 收的就是 bytes）；
        返回值里的 bytes 反向包回 `{"__字节__": "..."}`，否则 `json.dumps` 会在写黄金
        那一步直接 `TypeError: Object of type bytes is not JSON serializable`
        （`read_chunks_png` 交回来的就是一个「关键词 -> bytes」的字典）。

    ★ 工作目录建在**差分根底下**（不用系统 temp）：Windows 的 temp 可能是 8.3 短名
      （`C:\\Users\\ADMINI~1\\...`），Python 的 `os.path.abspath` 走 `GetFullPathNameW`、
      Node 的 `path.resolve` 只做字符串规范化 —— 同一个目录两边会算出两个写法。
    """
    import base64
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import bridge as B

    工作 = Path(tempfile.mkdtemp(prefix="_tmp_bridge-", dir=str(Path(__file__).resolve().parent)))

    def 还原(x):
        if isinstance(x, dict):
            if list(x) == ["__字节__"]:
                return base64.b64decode(x["__字节__"])
            return {k: 还原(v) for k, v in x.items()}
        if isinstance(x, list):
            return [还原(v) for v in x]
        return x

    def 字节化(x):
        if isinstance(x, (bytes, bytearray)):
            return {"__字节__": base64.b64encode(bytes(x)).decode("ascii")}
        if isinstance(x, dict):
            return {k: 字节化(v) for k, v in x.items()}
        if isinstance(x, (list, tuple)):
            return [字节化(v) for v in x]
        return x

    for 件 in 料.get("预置", []):
        p = 工作 / 件["路径"]
        if 件["调用"] == "写文本":
            with open(p, "w", encoding="utf-8", newline="") as f:
                f.write(件["文本"])
        else:
            p.write_bytes(base64.b64decode(件["字节"]))

    出: dict = {"步": []}
    for 步 in 料["操作"]:
        # 与 opener 同形：`@工作@` 换成临时工作目录，dict / list 里的字符串也换。
        # ★ 参数交进函数前只做 `还原`（bytes 就是 bytes）；记进差分的另包一层 `字节化`
        #   —— 早先写成 `字节化(还原(a))`，两者相消，函数拿到的是 `{"__字节__": …}`
        #   字典，`decode_card_text` 当场 AttributeError，整条 bytes 入参的路走不到。
        参数 = [_换路径(还原(a), [("@工作@", str(工作))]) for a in 步.get("参数", [])]
        buf = io.StringIO()
        rec: dict = {"调用": 步["调用"], "参数": 字节化(参数)}
        try:
            with contextlib.redirect_stdout(buf):
                回 = getattr(B, 步["调用"])(*参数)
            rec["回"] = 字节化(_动(回))
            rec["错"] = None
        except Exception as exc:  # noqa: BLE001
            rec["回"] = None
            rec["错"] = _净文本("%s: %s" % (type(exc).__name__, exc))
        rec["出"] = _净文本(buf.getvalue())
        出["步"].append(rec)
    出["树"] = _树(工作)
    shutil.rmtree(工作, ignore_errors=True)

    对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
    return _换路径(出, 对)


算式["bridge"] = 算_bridge


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
