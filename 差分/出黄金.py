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


def _指纹(p: Path, 工作: Path) -> dict:
    """把一个产物文件的形态记下来：字节数 / 行数 / sha1 前十六 / 首尾行。

    为什么不把正文整个记进差分：手册 HTML 几十 KB、索引也是，黄金会膨胀到几 MB 且
    一处改动就满屏 diff。**结构上**「产物没变」＝ sha1 相同；「变成什么了」＝ 首尾行 +
    行数字节。真要逐字节看，去比对 `差分/黄金/manual.json` 里的 sha1 就够定位到哪一步。
    """
    import hashlib

    原 = str(p)
    b = p.read_bytes()
    文本 = b.decode("utf-8", errors="replace")
    行 = 文本.split("\n")
    return {
        "路径": 原.replace(str(工作), "<工作>").replace(str(工作).replace("\\", "\\\\"), "<工作>"),
        "字节": len(b),
        "行数": len(行),
        "sha1": hashlib.sha1(b).hexdigest()[:16],
        "首行": _动(行[0])[:200],
        "尾行": _动(行[-1])[:200],
    }


def 算_manual(料: dict) -> dict:
    """顺序跑一串 manual 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    与 `算_hud` 同形，两处不一样：

      · 返回值里的大字符串（手册 HTML、索引 md）**不整个记进差分** —— 折成产物的形态
        （见 `_指纹`）。这不是放水：落盘后的文件仍然进 `树`、逐字节比 sha1，
        两条证据是分开的。
      · 返回值里凡是**已经存在的文件路径**，一律顺带记一份 `产物` 形态，于是
        `build_manual` / `build_index` 交回来的路径与它写出来的东西都进了差分。
    """
    import contextlib
    import hashlib
    import io
    import shutil
    import tempfile

    from forge import manual as MN

    工作 = Path(tempfile.mkdtemp(prefix="_tmp_manual-", dir=str(根)))

    预置 = 料.get("预置") or {}
    for 名 in 预置.get("目录") or []:
        (工作 / 名).mkdir(parents=True, exist_ok=True)
    for 名, 文 in (预置.get("文件") or {}).items():
        p = 工作 / 名
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(文, encoding="utf-8", newline="\n")

    def 折回(v):
        """返回值折成能比的结构：长字符串换成形态；现有文件顺带带上 `产物`。"""
        if isinstance(v, str):
            if len(v) > 400:
                b = v.encode("utf-8")
                return {"_长文本": {"字节": len(b), "行数": v.count("\n") + 1,
                                    "sha1": hashlib.sha1(b).hexdigest()[:16],
                                    "首行": _动(v.split("\n")[0])[:200],
                                    "尾行": _动(v.split("\n")[-1])[:200]}}
            try:
                存在 = os.path.isfile(v)
            except (OSError, ValueError, TypeError):
                存在 = False
            if 存在:
                return {"_回": _动(v), "产物": _指纹(Path(v), 工作)}
            return _动(v)
        if isinstance(v, dict):
            return {k: 折回(x) for k, x in v.items()}
        if isinstance(v, list):
            return [折回(x) for x in v]
        return _动(v)

    出: dict = {"步": []}
    try:
        for 步 in 料["操作"]:
            # 语料里「参数」可以写单个值（`{"参数": 42}`），也可以写数组；没有这个键就是无参。
            # `参数2` 是追加的第二个位置参数（`_cell(s, limit)` 这种两个位置的）。
            原参 = 步["参数"] if "参数" in 步 else []
            参数 = [出参数(a, 工作, 根) for a in (原参 if isinstance(原参, list) else [原参])]
            if "参数2" in 步:
                参数.append(出参数(步["参数2"], 工作, 根))
            buf = io.StringIO()
            rec: dict = {"调用": 步["调用"], "参数": _动(参数)}
            try:
                with contextlib.redirect_stdout(buf):
                    回 = getattr(MN, 步["调用"])(*参数)
                rec["回"] = 折回(动回(回))
                rec["错"] = None
            except Exception as exc:  # noqa: BLE001
                rec["回"] = None
                rec["错"] = 错文本(步["调用"], exc)
            rec["出"] = _净文本(buf.getvalue())
            if 步.get("收出"):
                rec["记出"] = True
            出["步"].append(rec)
        出["树"] = _树(工作)
    finally:
        shutil.rmtree(工作, ignore_errors=True)

    对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
    return _换路径(收_uuid(出), 对)


算式["manual"] = 算_manual


_读不出来 = re.compile(r"（读不出来：[^）]*）")
def _收元组(x):
    """把 tuple 递归折成 list。

    `_modules_of` / `_top_of` 交出来的是 tuple，JS 那边是天生的数组 ⇒ 不折的话
    Python 的 `json.dumps` 会给数组（它本来就把 tuple 写成数组）、JS 也一样 ——
    真正会岔的是**差分里的 `_动`**：`_动` 对 tuple 不递归，元组里带着路径就归一不了。
    进门先折成 list，两边形状一致。
    """
    if isinstance(x, tuple):
        return [_收元组(v) for v in x]
    if isinstance(x, dict):
        return {k: _收元组(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_收元组(v) for v in x]
    if isinstance(x, (set, frozenset)):
        # `SKIP_DIRS` 是 set：JS 那边是 Set（`JSON.stringify` 给 `{}`）⇒ 折成排序后的数组。
        return sorted(x, key=lambda v: [ord(c) for c in str(v)])
    return x


# `import_theme()`（`theme.py:308`）把解析器原话插在另一句话里，形状不同、同样只差措辞。
_不是json = re.compile(r"（不是 json？）：.*$", re.S)


def _折浮(x):
    """把「值为整数的 float」折成 int（-0.0 也折成 0）。

    这是**申报差异 1**：Python `json.dumps` 把 float 写成 `21.0`，JS `JSON.stringify`
    写成 `21`。`_parse_color` 的 alpha、`_luminance` / `_ratio` 的结果都可能是整数，
    不折的话两侧的 JSON 逐字节比必然红 —— 而那不是 bug，是两种语言的浮点写法。
    折的是**写法**不是数：真算错了（21 vs 20.999…）折完照样红。
    """
    if isinstance(x, float):
        if x.is_integer():
            return int(x)
        return x
    if isinstance(x, dict):
        return {k: _折浮(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_折浮(v) for v in x]
    return x


def _折读不出来(x):
    """把 `（读不出来：…）` 里的正文换成 `<解析器说>`。

    这是**申报差异 2**：`list_themes()` 读不出某份 `.json` 时，异常文本是解析器原话 ——
    Python 给 `Expecting property name enclosed in double quotes: line 1 column 13 (char 12)`，
    Node 给 `Expected double-quoted property name in JSON at position 12 (line 1 column 13)`。
    两侧天生不同，故只比「读不出来」这件事发生过、以及前后文。
    """
    if isinstance(x, str):
        return _不是json.sub("（不是 json？）：<解析器说>", _读不出来.sub("（读不出来：<解析器说>）", x))
    if isinstance(x, dict):
        return {k: _折读不出来(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_折读不出来(v) for v in x]
    return x


_解析器错 = re.compile(r"^(JSONDecodeError|SyntaxError|ValueError): .*$", re.S)


def _折解析器(x):
    """把「解析器读不出 json」的整条异常文本折成 `解析器: <解析器说>`。

    这是**申报差异 3**：`_read_conf()` 读一份坏掉的 `hud.conf.json` 时，
    Python 抛 `JSONDecodeError: Expecting property name enclosed in double quotes: …`，
    Node 抛 `SyntaxError: Expected double-quoted property name in JSON at …` ——
    连类名带措辞都不同。只折**错**这一格（语料正文里不带这种字样）。

    ★ `ValueError` 也在这个名单里：`plan.反推` 读不出卡时抛的是 `ValueError`
      （「这不是 ElecKoi 卡」/「设定库是空的」/「卡里读不出设定库」），
      而 `plan.mjs` 那一侧的措辞与类名同样只能折 —— 与 `比一比.mjs:1361` 的
      `折解析器` 保持一字不差。实测对 `theme` 的 6 处折行**零影响**
      （`黄金\\theme.json` 里 `ValueError` 出现 0 次，只添名单不会把已折的解开）。
    """
    if isinstance(x, str) and _解析器错.match(x):
        return "解析器: <解析器说>"
    return x


def 算_theme(料: dict) -> dict:
    """顺序跑一串 theme 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    与 `算_hud` 的区别只有一处形状：料里是 `情形` 列表 —— 一个情形一份工作目录 + 一个主题库。
    `THEMES_DIR` 是模块级变量（`os.path.join(ROOT, "assets", "主题")`），这里直接赋值、
    跑完还原，真仓库的 `assets/主题/` 一个字节都不动（`import_theme(install=True)` 否则会往里落）。
    每步还可以带一个可选的 `"沙箱"`：那一分钟里把 `sandbox.enable()` 设成它，跑完还原。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import sandbox as _SB
    from forge import theme as T

    原主题库 = T.THEMES_DIR
    原沙箱 = _SB.enabled()
    # ★ 沙箱开关是**进程级**状态，而算_sandbox（字母序排在 theme 前面）跑完会把它留在「开」上
    #   —— 它自己的黄金里 `enabled: true` 就是照实记的，两边都不还原（同 算_scaffold 的注释）。
    #   本函数的黄金必须与调用顺序无关，所以进门一律先关掉，出门再按原样还原。
    #   少了这一行：`跑.py --刷 theme` 单跑出的黄金是「关」着的行为，而 `跑.py` 整套跑时
    #   JS 侧还开着 ⇒ 清皮肤第 2 次 `回` 会 true/false 分岔（实测差在第 1049 行 · 偏移 26584）。
    _SB.enable(False)
    情形们 = []
    try:
        for 情形 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_theme-", dir=str(根)))
            对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
            try:
                预置 = 情形.get("预置") or {}
                for 名 in 预置.get("目录") or []:
                    (工作 / 名).mkdir(parents=True, exist_ok=True)
                for 名, 文 in (预置.get("文件") or {}).items():
                    p = 工作 / 名
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(文, encoding="utf-8", newline="\n")

                T.THEMES_DIR = os.path.join(str(工作), 情形["主题库"])

                出: dict = {"名": 情形.get("名"), "步": []}
                for 步 in 情形["操作"]:
                    # 「参数」可以写单个值，也可以写数组；没有这个键就是无参。
                    原参 = 步["参数"] if "参数" in 步 else []
                    参数 = [出参数(a, 工作, 根) for a in (原参 if isinstance(原参, list) else [原参])]
                    buf = io.StringIO()
                    rec: dict = {"调用": 步["调用"], "参数": _动(参数)}
                    if "沙箱" in 步:
                        _SB.enable(bool(步["沙箱"]))
                    try:
                        with contextlib.redirect_stdout(buf):
                            回 = getattr(T, 步["调用"])(*参数)
                        rec["回"] = _动(动回(list(回) if isinstance(回, tuple) else 回))
                        rec["错"] = None
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = _折解析器(错文本(步["调用"], exc))
                    finally:
                        if "沙箱" in 步:
                            _SB.enable(False)  # 回到本函数的基调（进门关掉那个），不是原沙箱
                    rec["出"] = _净文本(buf.getvalue())
                    出["步"].append(rec)
                出["树"] = _树(工作)
            finally:
                shutil.rmtree(工作, ignore_errors=True)
                T.THEMES_DIR = 原主题库
            情形们.append(_换路径(_折读不出来(_折浮(收_uuid(出))), 对))
    finally:
        T.THEMES_DIR = 原主题库
        _SB.enable(原沙箱)
    return {"情形": 情形们, "沙箱还原": _SB.enabled() == 原沙箱}


算式["theme"] = 算_theme


def 算_coach(料: dict) -> dict:
    """顺序跑一串 coach 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    与 `算_theme` 同形（情形制），三点不一样：

      · **进门关沙箱、出门还原**：`coach.出()` 走 `C.add_entry` / `pack.build`，路过的
        兄弟模块会看 `sandbox.enabled()`；沙箱开关是进程级状态，而 `算_sandbox`（字母序
        排在 coach 前）跑完会把它留在「开」上 ⇒ 不钉住就会「单跑绿、整套红」。
      · 工作目录建在**差分目录**底下（**不是工具根**）：`_出卡()` 里的 `os.path.abspath`
        会碰它，系统 temp 可能是 8.3 短名，Python `abspath` 与 Node `resolve` 会算出两种
        写法。★ 更不能建在工具根 —— scaffold 语料第 27 条走 `abspath("")`＝工具根，
        工具根底下的任何 `_tmp_*` 都会被它照进快照里，直接把它顶红（本轮真踩过）。
      · **已申报差异**：`_出卡()` / `_认回身份()` 写 spec 走 `M.ydump`（YAML），JS 侧
        `M.ydump` 明确抛错 ⇒ 走 `M.jdump`（JSON）—— 文件名不变，由 `_树()` 里的
        `.spec.` 分支按 `load_structured()` **结构**比，不比字节。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import sandbox as _SB
    from forge import coach as CO

    def _树带卡(工作):
        """`_树()` 加一道本地归一：`成品/*.card.json` 与 `文档/*.索引.md` 里带
        **每次新发的 uuid 与时间戳**（实测：原文不同、`_净文本` 后逐字同、`_动` 收不住
        ——卡是酒馆形状，id 不叫 `id`），所以按净文本比。

        ★ 不动共享的 `_树()`：别的模块树里的 `.md` / `.card.json` 都是确定的，
        改成净文本比会白松一道闸。
        """
        树 = _树(工作)
        for 项 in 树:
            if 项["路径"].endswith(".card.json") or 项["路径"].endswith(".索引.md"):
                项.pop("sha1", None)
                p = os.path.join(str(工作), 项["路径"])
                项["文本"] = _净文本(io.open(p, encoding="utf-8", newline="").read())
        return 树

    原沙箱 = _SB.enabled()
    _SB.enable(False)
    情形们 = []
    try:
        for 情形 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_coach-", dir=str(根 / "差分")))
            对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
            try:
                预置 = 情形.get("预置") or {}
                for 名 in 预置.get("目录") or []:
                    (工作 / 名).mkdir(parents=True, exist_ok=True)
                for 名, 文 in (预置.get("文件") or {}).items():
                    p = 工作 / 名
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(文, encoding="utf-8", newline="\n")

                出: dict = {"名": 情形.get("名"), "步": []}
                for 步 in 情形["操作"]:
                    # 「参数」可以写单个值，也可以写数组；没有这个键就是无参。
                    原参 = 步["参数"] if "参数" in 步 else []
                    参数 = [出参数(a, 工作, 根) for a in (原参 if isinstance(原参, list) else [原参])]
                    buf = io.StringIO()
                    rec: dict = {"调用": 步["调用"], "参数": _动(参数)}
                    try:
                        with contextlib.redirect_stdout(buf):
                            回 = getattr(CO, 步["调用"])(*参数)
                        rec["回"] = _动(动回(list(回) if isinstance(回, tuple) else 回))
                        rec["错"] = None
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = 错文本(步["调用"], exc)
                    rec["出"] = _净文本(buf.getvalue())
                    出["步"].append(rec)
                出["树"] = _树带卡(工作)
            finally:
                shutil.rmtree(工作, ignore_errors=True)
            情形们.append(_换路径(_折读不出来(_折浮(收_uuid(出))), 对))
    finally:
        _SB.enable(原沙箱)
    return {"情形": 情形们, "沙箱还原": _SB.enabled() == 原沙箱}


算式["coach"] = 算_coach


def 算_export(料: dict) -> dict:
    """逐个情形跑 `export.to_tavern`：比返回值 / 异常消息 / out 收集到的行 / 写出来的文件原文 / 整棵工作树。

    与 `算_theme` 同形（情形制），三处不一样：

      · 卡是语料里当场写盘的（`json.dumps(ensure_ascii=False, indent=2)`，与 JS 侧
        `JSON.stringify(卡, null, 2)` 逐字节同；所以语料里**别放整数值的浮点**，
        Python 写 `21.0`、JS 写 `21`）；
      · `out` 默认传收集器（`行.append`）；情形写 `"用默认出口": true` 时**不传**，
        走 `to_tavern` 自己的 `out=print` 默认值 ⇒ 报告进 stdout，用 redirect_stdout 收进
        `出["出"]`（不传 out 的情形这条恒为空串）；
      · 「文」是导出文件读回来的**原文**，不做任何归一 —— 文件由 `M.jdump` 写，两边
        逐字节比，这是本模块最硬的一条。

    ★ 工作目录**建在差分目录底下**（与 算_bridge 同）：语料里要拿 `@工作@` 拼路径时，
      同盘、同写法才比得到一条线上。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import export as E

    差分 = Path(__file__).resolve().parent
    情形们 = []
    for 情 in 料["情形"]:
        工作 = Path(tempfile.mkdtemp(prefix="_tmp_export-", dir=str(差分)))
        卡路径 = 工作 / (情.get("卡名") or "卡.json")
        出路径 = 工作 / (情.get("出名") or "导出.json")
        keep_raw = bool(情.get("keep_raw", False))
        用默认出口 = bool(情.get("用默认出口", False))
        出: dict = {"名": 情["名"]}
        try:
            卡路径.write_text(
                json.dumps(情["卡"], ensure_ascii=False, indent=2), encoding="utf-8", newline="\n"
            )
            行: list = []
            buf = io.StringIO()
            try:
                with contextlib.redirect_stdout(buf):
                    if 用默认出口:
                        回 = E.to_tavern(str(卡路径), str(出路径), keep_raw)
                    else:
                        回 = E.to_tavern(str(卡路径), str(出路径), keep_raw, 行.append)
                出["回"] = _动(动回(回))
                出["错"] = None
            except Exception as exc:  # noqa: BLE001
                出["回"] = None
                出["错"] = 错文本("to_tavern", exc)
            出["参数"] = _动([str(卡路径), str(出路径), keep_raw])
            出["行"] = [_动(x) for x in 行]
            出["出"] = _净文本(buf.getvalue())
            出["文"] = 出路径.read_text(encoding="utf-8") if 出路径.exists() else None
            出["树"] = _树(工作)
        finally:
            shutil.rmtree(工作, ignore_errors=True)
        对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
        情形们.append(_换路径(收_uuid(出), 对))
    return {"情形": 情形们}


def _稳时间(x):
    """把结果里的「生成时间」换成记号 —— 两边跑的时刻天然不同，不归一必红。

    `build_manifest()` 的 `生成时间` 走的是 `M.now_iso()`，`_动()` 兜底那层只收
    8 位十六进制与开头像 uuid 的东西，收不走它（值形如
    `2026-10-16T07:47:28.442635+08:00`，里面一个十六进制串都没有）。
    """
    if isinstance(x, str):
        return _ISO.sub("<时间>", x)
    if isinstance(x, dict):
        return {k: _稳时间(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_稳时间(v) for v in x]
    return x


def 算_dist(料: dict) -> dict:
    """顺序跑一串 dist 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    与 `算_coach` 同形（情形制），四点不一样：

      · 语料里给的是**两段**：`步骤`（会造树，也把树当输入）与`收尾`（同一棵树上接着调，
        通常是非落盘的纯函数与「清单被改过」这类要读盘的事）。两段共用同一棵工作树。
      · 只调 `dist` 自己：卡用**钉死的 zip / json 夹具**（`语料/dist/` 下，`_造语料.py` 生成
        一次、两边读同一份）⇒ 生成包的字节不被重写，compression 与时间戳的差异整个绕开。
      · zip 自己写一份读法（Node 标准库没有 zipfile），坏 zip 抛的类名必须叫 `BadZipFile`
        —— 差分记 `type(exc).__name__`，名字不对当场红。
      · **已申报差异**：`_import_card` 写 spec 走 `M.jdump`（Python 是 `M.ydump`，JS 侧
        明确抛错）⇒ 落出来的规格后缀是 `.json`，由 `_树()` 里的 `.spec.` 分支按
        `load_structured()` **结构**比，不比字节。
      · 工作目录建在**差分目录**底下（不是系统 temp，更不是工具根）：`build_manifest`
        一进门就 `os.path.abspath`，系统 temp 可能是 8.3 短名 ⇒ 两边两种写法；工具根底下
        任何 `_tmp_*` 会被 scaffold 语料第 27 条（`abspath("")`＝工具根）照进快照直接顶红。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import dist as D
    from forge import sandbox as _SB

    def _造(工作, 步):
        """写文件 / 建目录 / 改文件 —— 只归一化「路径」这一格，内容原样。"""
        参数 = [出参数(a, 工作, 根) for a in 步["参数"]]
        p = 参数[0]
        if 步["调用"] == "写文件":
            文 = 参数[1]
            if 文 is None:
                os.makedirs(p, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "w", encoding="utf-8", newline="") as f:
                    f.write(文)
        elif 步["调用"] == "改文件":
            with open(p, "w", encoding="utf-8", newline="") as f:
                f.write(参数[1])
        elif 步["调用"] == "拷目录":
            _拷目录(p, 参数[1])
        elif 步["调用"] == "删路径":
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            elif os.path.exists(p):
                os.remove(p)
        else:
            raise AssertionError("不认得的造树动作：%s" % 步["调用"])
        return None

    def _拷目录(来源, 去处):
        """`fs.cpSync(..., {recursive:true})` 在本机 Node v24.14.0 会把进程打崩
        （退出码 0xC0000409）⇒ 递归拷目录两边都自己写：readdirSync + copyFileSync + utimes。
        **这一支在 dist 里只被语料用**（dist 自己的 import 走 zip 与单文件卡）。"""
        os.makedirs(去处, exist_ok=True)
        for 名 in sorted(os.listdir(来源)):
            s = os.path.join(来源, 名)
            d = os.path.join(去处, 名)
            if os.path.isdir(s):
                _拷目录(s, d)
            else:
                shutil.copyfile(s, d)

    def _常量(名):
        return getattr(D, 名)

    _造树 = ("写文件", "改文件", "拷目录", "删路径")
    _常量名 = ("MANIFEST", "MANIFEST_FORMAT", "MANIFEST_VERSION", "SKIP_DIRS", "SKIP_TAILS")

    原沙箱 = _SB.enabled()
    _SB.enable(False)
    情形们 = []
    try:
        for 情形 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_dist-", dir=str(根 / "差分")))
            对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
            try:
                出: dict = {"名": 情形.get("名"), "步": []}
                for 步 in list(情形.get("步骤") or []) + list(情形.get("收尾") or []):
                    原参 = 步["参数"] if "参数" in 步 else []
                    参数 = [出参数(a, 工作, 根) for a in (原参 if isinstance(原参, list) else [原参])]
                    buf = io.StringIO()
                    rec: dict = {"调用": 步["调用"], "参数": _动(参数)}
                    行: list = []
                    try:
                        with contextlib.redirect_stdout(buf):
                            if 步["调用"] in _造树:
                                回 = _造(工作, 步)
                            elif 步["调用"] in _常量名:
                                回 = _常量(步["调用"])
                            else:
                                参 = list(参数)
                                if 步.get("出") == "行.append":
                                    参.append(行.append)
                                回 = getattr(D, 步["调用"])(*参)
                        if isinstance(回, tuple):
                            回 = list(回)
                        rec["回"] = _稳时间(_动(动回(_收元组(回))))
                        rec["错"] = None
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = 错文本(步["调用"], exc)
                    rec["行"] = [_净文本(x) for x in 行]
                    rec["出"] = _净文本(buf.getvalue())
                    出["步"].append(rec)
                出["树"] = _稳时间(_树(工作))
            finally:
                shutil.rmtree(工作, ignore_errors=True)
            情形们.append(_换路径(_折读不出来(_折浮(收_uuid(出))), 对))
    finally:
        _SB.enable(原沙箱)
    return {"情形": 情形们, "沙箱还原": _SB.enabled() == 原沙箱}


算式["dist"] = 算_dist


算式["export"] = 算_export


# ------------------------------------------------------------------ png（成品图）

def _折字节(x):
    """bytes/bytearray 折成 `{"@十六进制@": …}` —— 差分是 JSON，装不下二进制。"""
    if isinstance(x, (bytes, bytearray)):
        return {"@十六进制@": bytes(x).hex()}
    if isinstance(x, dict):
        return {_折字节(k): _折字节(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_折字节(v) for v in x]
    return x


_壳注 = re.compile(r"酒馆外壳降级生成（[\s\S]*）")


def _折壳(x):
    """酒馆外壳降级时那句 `note` 里嵌的是**语言自己的异常原文**（两边永远不同）
    ⇒ 折成 `酒馆外壳降级生成（<降级原因>）`。**已申报差异**，写在 `差分/语料/png.json` 的「说明」里。"""
    if isinstance(x, str):
        return _壳注.sub("酒馆外壳降级生成（<降级原因>）", x)
    if isinstance(x, dict):
        return {k: _折壳(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_折壳(v) for v in x]
    return x


_读卡错 = re.compile(r"读不了源卡 JSON：[\s\S]*")


def _折错(文: str) -> str:
    """`读不了源卡 JSON：…` 里嵌的是解析器原文（两边的措辞永远不同）⇒ 折成 `<解析器说>`。"""
    return _读卡错.sub("读不了源卡 JSON：<解析器说>", 文)


def _参(x, 工作: Path, 根: Path):
    """`出参数` 的 png 版：多认两个语料标记 —— `{"@字节@": "<hex>"}` 与 `{"@读文件@": 路径}`。"""
    if isinstance(x, str):
        s = x.replace("@根@", str(根)).replace("@工作@", str(工作))
        return s.replace("@@重复x4100@@", "x" * 4100)
    if isinstance(x, dict):
        if list(x.keys()) == ["@字节@"]:
            return bytes.fromhex(x["@字节@"])
        if list(x.keys()) == ["@读文件@"]:
            return Path(_参(x["@读文件@"], 工作, 根)).read_bytes()
        return {_参(k, 工作, 根): _参(v, 工作, 根) for k, v in x.items()}
    if isinstance(x, list):
        return [_参(v, 工作, 根) for v in x]
    return x


def _预置文(文):
    """预置文件的内容：`{"@十六进制@": …}` → 二进制；dict/list → JSON；字符串 → 原文。"""
    if isinstance(文, dict) and list(文.keys()) == ["@十六进制@"]:
        return bytes.fromhex(文["@十六进制@"])
    if isinstance(文, (dict, list)):
        return json.dumps(文, ensure_ascii=False, indent=2).encode("utf-8")
    return str(文).encode("utf-8")


def _PNG分解(buf: bytes):
    """把一张 PNG 折成**逐块可比**的结构。

    ★ 已申报差异（写在 `差分/语料/png.json` 的「说明」里）：
      Node v24.14.0 自带的是 **fork 过的 zlib**（`process.versions.zlib == '1.3.1-e00f703'`），
      CPython 用上游 zlib 1.3.1（`zlib.ZLIB_VERSION == ZLIB_RUNTIME_VERSION == '1.3.1'`）。
      在 Z_DEFAULT_STRATEGY（两边都用默认）下 **deflate 产物不同**：实测 strategy 1/2/3
      （Z_FILTERED / Z_HUFFMAN_ONLY / Z_RLE）两边逐字节同，strategy 0/4 不同；
      `memLevel 1..9 × strategy 0..4` 全矩阵扫过，**没有任何组合能复现 Python 的默认产物**。
      分歧还是**数据相关**的：400×'A'、2400 B 渐变图、500 B 混合载荷都逐字节同，
      只有结构化 JSON 触发；把 388 B 的卡 JSON 按前缀二分，最短分歧前缀＝ **42 字节**。
      ⇒ `png.write()` 卡支路那句 `gzip.compress(raw, 9, mtime=0)` 在 JS 侧**无法逐字节复现**，
        整张 PNG 的字节数 / sha256 / 文件 sha1 全都跟着变（实测 4513 vs 4517）。

    退到结构层比（比对强度除了那段压缩体之外一点没丢）：
      · 每块记「类型 + 数据字节 sha1」；
      · `tEXt` 的 `eleckoi-card` 那块把 base64 解回 gzip 容器，记
        「容器头 10 字节 + 容器尾 8 字节 + gunzip 后原生字节数/sha256」——
        这四样两边**逐字节相同**（客户端要的也是这四样）。
    """
    import base64 as _b64
    import gzip as _gz
    import hashlib as _hl

    from forge import png as _P

    块 = []
    for typ, data, _起, _止 in _P.chunks(buf):
        if typ == b"tEXt":
            sep = data.find(b"\x00")
            kw = data[:sep] if sep > 0 else b""
            if kw == b"eleckoi-card":
                包 = _b64.b64decode(data[sep + 1:])
                原 = _gz.decompress(包)
                块.append({"类型": "tEXt", "关键字": "eleckoi-card",
                          "容器头": 包[:10].hex(), "容器尾": 包[-8:].hex(),
                          "原生字节": len(原), "原生sha256": _hl.sha256(原).hexdigest()})
                continue
        块.append({"类型": typ.decode("latin-1"),
                  "字节": len(data), "sha1": _hl.sha1(data).hexdigest()})
    return 块


def _试分解(p: Path):
    """能拆就拆；拆不动（-例如语料手搓的坏图）返回 None —— 那种文件两边本来逐字节同。"""
    try:
        return _PNG分解(p.read_bytes())
    except Exception:  # noqa: BLE001
        return None


def _折回(x):
    """`write()` 的返回值：`bytes` / `sha256` 换掉，改记 PNG 逐块分解（见 `_PNG分解`）。"""
    if isinstance(x, dict) and "png" in x and "sha256" in x:
        p = Path(x["png"])
        if p.is_file():
            分解 = _试分解(p)
            if 分解 is not None:
                return {"png": x["png"], "native_bytes": x.get("native_bytes"), "PNG": 分解}
    if isinstance(x, list):
        return [_折回(v) for v in x]
    if isinstance(x, dict):
        return {k: _折回(v) for k, v in x.items()}
    return x


def _折树(树, 工作: Path):
    """工作树里 `.png` 的 sha1 同样换掉（同 `_折回`）。"""
    for 项 in 树:
        rel = 项.get("路径") or ""
        if rel.lower().endswith(".png") and "sha1" in 项:
            p = 工作 / rel
            if p.is_file():
                分解 = _试分解(p)
                if 分解 is not None:
                    项.pop("sha1")
                    项["PNG"] = 分解
    return 树


_PNG字节 = re.compile(r"（\d+ 字节，")
_PNGbase64 = re.compile(r"（base64 \d+）")
_PNG自检 = re.compile(r"· \d+ 字节 · sha256 [0-9A-F]{12}")


def _折出文(文: str) -> str:
    """stdout 里那三个「整张 PNG 有多大」的数不可比（见 `_PNG分解`），折掉。

    `write()` 第 1 行 `（%d 字节，%.2f MB）`、第 2 行 `（base64 %d）`，
    以及 `verify()` 自检行 `· %d 字节 · sha256 %s`（`%s` 是整张图的 sha256 前 12）。
    """
    文 = _PNG字节.sub("（<PNG字节>，", 文)
    文 = _PNGbase64.sub("（base64 <PNG长度>）", 文)
    return _PNG自检.sub("· <PNG字节> 字节 · sha256 <PNGsha12>", 文)


def 算_png(料: dict) -> dict:
    """顺序跑一串 png 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    与 `算_theme` 同形（情形制），两处不一样：

      · **工作目录建在 `差分/` 底下**（不是工具根、更不是系统 temp）—— `write()` 的默认出口
        是从 `abspath(卡路径)` 推出来的，而系统 temp 可能是 8.3 短名
        （`C:\\Users\\ADMINI~1\\…`），Python `abspath` 与 Node `resolve` 会算出两种写法；
        工具根则会被 `scaffold` 语料第 27 条（`abspath("")`＝工具根）撞上。
      · 返回的 bytes 一律折成 `{"@十六进制@": …}`（`_折字节`）—— JSON 装不下二进制，
        但「写出来的 PNG 到底逐字节是什么」正是本模块唯一要证明的事，所以**要折、不能丢**。
        折出来的是原文 hex，比对强度与逐字节比等同。
      · 步骤可带 `"看JSON": true`：返回的 bytes 先按 JSON 解一遍再记（用于 `_chara_wrapper`，
        那句降级 note 要过 `_折壳`）。
    """
    import contextlib
    import io
    import shutil

    from forge import png as P
    from forge import sandbox as _SB

    差分 = Path(__file__).resolve().parent
    F = {名: getattr(P, 名) for 名 in dir(P) if not 名.startswith("__")}

    原沙箱 = _SB.enabled()
    # ★ 沙箱开关是**进程级**状态；`SB.land` 开着时走"复制"而不是 `os.replace`，
    #   黄金必须与「单跑 / 整套跑」的调用顺序无关 ⇒ 进门一律先关掉，出门按原样还原（同 算_theme）。
    _SB.enable(False)
    情形们 = []
    try:
        for 情形 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_png-", dir=str(差分)))
            对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
            try:
                预置 = 情形.get("预置") or {}
                for 名 in 预置.get("目录") or []:
                    (工作 / 名).mkdir(parents=True, exist_ok=True)
                for 名, 文 in (预置.get("文件") or {}).items():
                    p = 工作 / 名
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_bytes(_预置文(文))

                出: dict = {"名": 情形.get("名"), "步": []}
                for 步 in 情形["操作"]:
                    原参 = 步["参数"] if "参数" in 步 else []
                    参数 = [_参(a, 工作, 根) for a in (原参 if isinstance(原参, list) else [原参])]
                    buf = io.StringIO()
                    rec: dict = {"调用": 步["调用"], "参数": _动(_折壳(_折字节(参数)))}
                    try:
                        with contextlib.redirect_stdout(buf):
                            回 = F[步["调用"]](*参数)
                        if 步.get("看JSON") and isinstance(回, (bytes, bytearray)):
                            回 = _折壳(json.loads(bytes(回).decode("utf-8")))
                        rec["回"] = _折回(_折字节(_动(动回(回))))
                        rec["错"] = None
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = _折错(错文本(步["调用"], exc))
                    rec["出"] = _折出文(_净文本(buf.getvalue()))
                    出["步"].append(rec)
                出["树"] = _折树(_树(工作), 工作)
                情形们.append(_换路径(收_uuid(出), 对))
            finally:
                shutil.rmtree(工作, ignore_errors=True)
    finally:
        _SB.enable(原沙箱)
    return {"情形": 情形们, "沙箱还原": _SB.enabled() == 原沙箱}


算式["png"] = 算_png


# ---------------------------------------------------------------- preset
# 与 png 那套同形（情形制、工作目录建在 `差分/` 底下、每步比 stdout/返回值/异常、最后比整棵树），
# 只多两处：
#   · 步名带 `常量:` 前缀 ⇒ 返回模块常量本身（不调用）—— 用来把 FORMAT / KINDS /
#     ENTRY_KEYS / TRIGGER_MODES / _DEFAULTS … 逐个比一遍；
#   · 异常里嵌的**解析器 / 解码器原文**两边天生不同（CPython 的 `json.JSONDecodeError`
#     vs Node 的 `SyntaxError`，措辞与列号都不一路）⇒ 换一条折叠表 `_折错预设`（已申报差异）。
_折错预设 = re.compile(r"(读不了预设 JSON：|设定库那段 JSON 解不开：|JSONDecodeError: )[\s\S]*")


def _折错预设文(文: str) -> str:
    """把嵌在消息里的**解析器 / 解码器原文**折成 `<解析器说>`（已申报差异）。

    只丢措辞，不丢「在哪一层失败的」—— 前缀（`读不了预设 JSON：` / `设定库那段 JSON 解不开：`
    / `JSONDecodeError: `）逐个留着比。
    """
    return _折错预设.sub(lambda m: m.group(1) + "<解析器说>", 文)


def 算_preset(料: dict) -> dict:
    """顺序跑一串 preset 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    与 `算_png` 逐条同形（照着它改的），三处差别：

      · `F` 换成 `forge.preset` 的模块级名字表；步名带 `常量:` 前缀时返回**常量本身**；
      · 异常走 `_折错预设文`（解析器原文两边不同，见上）；
      · 临时目录前缀是 `_tmp_preset-`。

    ★ 工作目录必须建在 `差分/` 底下（不是工具根、更不是系统 temp）：`default_out`
      是从 `abspath(源路径)` 推出来的，系统 temp 在 Windows 上可能是 8.3 短名
      （`C:\\Users\\ADMINI~1\\…`），Python `abspath` 与 Node `resolve` 会算出两种写法；
      工具根则会被 `scaffold` 语料第 27 条（`abspath("")` ＝ 工具根）撞上。
    """
    import contextlib
    import io
    import shutil

    from forge import preset as P
    from forge import sandbox as _SB

    差分 = Path(__file__).resolve().parent
    F = {名: getattr(P, 名) for 名 in dir(P) if not 名.startswith("__")}

    原沙箱 = _SB.enabled()
    # ★ 沙箱开关是**进程级**状态；`SB.land` 开着时走"复制"而不是 `os.replace`，
    #   黄金必须与「单跑 / 整套跑」的调用顺序无关 ⇒ 进门一律先关掉，出门按原样还原。
    _SB.enable(False)
    情形们 = []
    try:
        for 情形 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_preset-", dir=str(差分)))
            对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
            try:
                预置 = 情形.get("预置") or {}
                for 名 in 预置.get("目录") or []:
                    (工作 / 名).mkdir(parents=True, exist_ok=True)
                for 名, 文 in (预置.get("文件") or {}).items():
                    p = 工作 / 名
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_bytes(_预置文(文))

                出: dict = {"名": 情形.get("名"), "步": []}
                for 步 in 情形["操作"]:
                    原参 = 步["参数"] if "参数" in 步 else []
                    参数 = [_参(a, 工作, 根) for a in (原参 if isinstance(原参, list) else [原参])]
                    调用 = 步["调用"]
                    buf = io.StringIO()
                    rec: dict = {"调用": 调用, "参数": _动(_折壳(_折字节(参数)))}
                    try:
                        with contextlib.redirect_stdout(buf):
                            if 调用.startswith("常量:"):
                                回 = F[调用[len("常量:"):]]
                            else:
                                回 = F[调用](*参数)
                        rec["回"] = _折回(_折字节(_动(动回(回))))
                        rec["错"] = None
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = _折错预设文(_折错(错文本(调用, exc)))
                    rec["出"] = _折出文(_净文本(buf.getvalue()))
                    出["步"].append(rec)
                出["树"] = _折树(_树(工作), 工作)
                情形们.append(_换路径(收_uuid(出), 对))
            finally:
                shutil.rmtree(工作, ignore_errors=True)
    finally:
        _SB.enable(原沙箱)
    return {"情形": 情形们, "沙箱还原": _SB.enabled() == 原沙箱}


算式["preset"] = 算_preset


# ---------------------------------------------------------------- lint
# 与 png / preset 那套同形（情形制、工作目录建在 `差分/` 底下、每步比 stdout/返回值/异常、
# 最后比整棵树），只多三处：
#   · 语料自带 `{"@造文本@": [头, 次数]}` ⇒ `头 + "汉" * 次数`：造 2000/2001 字的单轮分界
#     与 8000/16000 字的长文本（配 `%.2f` / `%.3f` 的半值取偶）；
#   · 语料自带 `{"@标准输出@": true}` ⇒ 这个位置参数传 `print` —— `体检` 的 out 是第 2 个
#     位置参，语料递不了函数，只能这样塞进去（它**不进** `rec["参数"]`，否则没法序列化）；
#   · 两处**已申报差异**在下面本地折（不动共享的 `错文本`）：坏 .json 里嵌的解析器原文、
#     文件不存在时 Python / Node 的错类名与措辞。
_折错lint = re.compile(r"(这个 \.json 读不出来：)[\s\S]*")
_折错lint文件 = re.compile(r"^(?:FileNotFoundError|Error): (?:\[Errno \d+\]|ENOENT)[\s\S]*")


def _展文本(x):
    if isinstance(x, dict) and list(x.keys()) == ["@造文本@"]:
        头, 次 = x["@造文本@"]
        return str(头) + "汉" * int(次)
    if isinstance(x, dict):
        return {k: _展文本(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_展文本(v) for v in x]
    return x


def _折文本lint(x):
    if isinstance(x, str):
        return _折错lint文件.sub("<文件系统错>", _折错lint.sub(r"\1<解析器说>", x))
    if isinstance(x, dict):
        return {k: _折文本lint(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_折文本lint(v) for v in x]
    return x


def _树lint(工作):
    """比树，但把 `main -o` 写出来的那份报告换成**正文**再比。

    报告正文里嵌着源文件的**绝对路径**，而那个路径每次 mkdtemp 都不一样 —— sha1 折不掉。
    换成正文以后，外层 `_换路径` 会把工作目录整个替换成 `<工作>`，两侧就对得上了。
    """
    树 = _树(工作)
    for 项 in 树:
        名 = 项["路径"].split("/")[-1]
        if 名.startswith("报告") and 名.endswith(".md"):
            del 项["sha1"]
            项["文本"] = _净文本((工作 / 项["路径"]).read_text(encoding="utf-8"))
    return 树


def 算_lint(料: dict) -> dict:
    """跑 lint（正文体检）：常量与六条正则的命中、六个查* 函数、体检 的打印与三条结尾、
    读 的三种输入与两条异常支、main 的 argv 分派与 `-o` 报告落盘，最后比整棵工作树。
    """
    import contextlib
    import io
    import shutil

    from forge import lint as LI
    from forge import sandbox as _SB

    原沙箱 = _SB.enabled()
    _SB.enable(False)
    情形们 = []
    try:
        for 情形 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_lint-", dir=str(Path(__file__).resolve().parent)))
            对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
            try:
                预置 = 情形.get("预置") or {}
                for 名 in 预置.get("目录") or []:
                    (工作 / 名).mkdir(parents=True, exist_ok=True)
                for 名, 文 in (预置.get("文件") or {}).items():
                    p = 工作 / 名
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_bytes(_预置文(_展文本(文)))

                出: dict = {"名": 情形.get("名"), "步": []}
                for 步 in 情形["操作"]:
                    原参 = 步["参数"] if "参数" in 步 else []
                    显示参: list = []
                    调用参: list = []
                    for a in (原参 if isinstance(原参, list) else [原参]):
                        v = _展文本(a)
                        if isinstance(v, dict) and list(v.keys()) == ["@标准输出@"]:
                            显示参.append("<标准输出>")
                            调用参.append(print)
                        else:
                            w = 出参数(v, 工作, 根)
                            显示参.append(w)
                            调用参.append(w)
                    buf = io.StringIO()
                    rec: dict = {"调用": 步["调用"], "参数": _动(显示参)}
                    try:
                        with contextlib.redirect_stdout(buf):
                            回 = getattr(LI, 步["调用"])(*调用参)
                        rec["回"] = _动(动回(list(回) if isinstance(回, tuple) else 回))
                        rec["错"] = None
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = 错文本(步["调用"], exc)
                    rec["出"] = _净文本(buf.getvalue())
                    出["步"].append(rec)
                出["树"] = _树lint(工作)
            finally:
                shutil.rmtree(工作, ignore_errors=True)
            情形们.append(_换路径(_折文本lint(收_uuid(出)), 对))
    finally:
        _SB.enable(原沙箱)

    正则 = []
    for 试 in 料.get("正则") or []:
        条 = getattr(LI, 试["名"])
        if isinstance(条, str):
            正则.append({"名": 试["名"], "串": 条})
            continue
        正则.append({
            "名": 试["名"],
            "样本": 试["样本"],
            "中": [[[m.start(), m.group()] for m in 条.finditer(s)] for s in 试["样本"]],
        })
    return {
        "汉字": LI.汉字,
        "标准": [list(x) for x in LI.标准],
        "正则": 正则,
        "情形": 情形们,
        "沙箱还原": _SB.enabled() == 原沙箱,
    }


算式["lint"] = 算_lint


def 算_guard(料):
    """`forge/guard.py` —— 只读禁区名单。

    ★ 本模块的输入**全在环境里**（环境变量 ＋ 工具根下的名单文件 ＋ 目录里的 `.只读` 标记），
      所以每个情形都把 `guard.ROOT` 临时指到自己的工作目录（`finally` 里还原），
      名单文件就写在那底下 —— **绝不去碰工具根上那份真名单**。
    ★ `os.environ` 也是模块外的状态：进门先存原值、出门逐字还原（`None` ＝ 原本就没有这个变量）。
    """
    import contextlib
    import io as _io
    import shutil

    from forge import guard as G

    原ROOT = G.ROOT
    原env = os.environ.get(G.ENV)
    情形们 = []

    def 设环境(v):
        if v is None:
            os.environ.pop(G.ENV, None)
        else:
            os.environ[G.ENV] = v

    try:
        for 情形 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_guard-", dir=str(Path(__file__).resolve().parent)))
            try:
                G.ROOT = str(工作)
                设环境(None if 情形.get("环境") is None else 出参数(情形["环境"], 工作, 根))
                料名单 = 情形.get("名单")
                if 料名单 is not None:
                    # `_预置文` 的同一套写法：字符串＝原文、`{"@十六进制@": …}`＝二进制。
                    # `出参数` 先替换 `@工作@`／`@根@`，再交给它折。
                    (工作 / G.LIST_FILE).write_bytes(_预置文(出参数(料名单, 工作, 根)))
                预置 = 情形.get("预置") or {}
                # ★ `预置` 里的名字是**相对工作目录**的（与 `算_lint` 同形）—— 必须自己拼上
                #   `工作`，否则 `Path("子")` 会按 cwd（＝工具根）造目录，往工具根里落垃圾树，
                #   而那棵树里正好有 `.只读` ⇒ 后面所有情形的「往上找标记」都会撞上它。
                for 名 in 预置.get("目录") or []:
                    (工作 / 出参数(名, 工作, 根)).mkdir(parents=True, exist_ok=True)
                for 名, 文 in (预置.get("文件") or {}).items():
                    p = 工作 / 出参数(名, 工作, 根)
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_bytes(_预置文(文))
                出 = {"名": 情形["名"], "步": []}
                for 步 in 情形["操作"]:
                    # `参数` 可以写成裸字符串（一个参数）或表（多个参数）—— **不能**
                    # 用 `步.get("参数") or []` 收口：`readonly_reason("")` 那个空串会让
                    # `or` 把它折成「零个参数」，Python 抛 `TypeError` 而 JS 收到 `undefined`。
                    原参 = 步["参数"] if "参数" in 步 else []
                    参 = 出参数(原参 if isinstance(原参, list) else [原参], 工作, 根)
                    rec = {"调用": 步["调用"], "参数": _动(参), "回": None, "错": None}
                    buf = _io.StringIO()
                    try:
                        with contextlib.redirect_stdout(buf):
                            回 = getattr(G, 步["调用"])(*参)
                        rec["回"] = _动(回)
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = 错文本(步["调用"], exc)
                    rec["出"] = _净文本(buf.getvalue())
                    出["步"].append(rec)
            finally:
                shutil.rmtree(工作, ignore_errors=True)
            # ★ 标记那一支的报错里印的是 `_norm()` 归一后的路径 —— **小写**的
            #   （`os.path.normcase` 在 Windows 上 lower），而 `mkdtemp` 给的是原样大小写。
            #   少了小写这两对，黄金里会留着 `_tmp_guard-qe9h6ohp` 这种本趟随机的尾巴。
            对 = [
                (str(工作), "<工作>"),
                (str(工作).replace("\\", "\\\\"), "<工作>"),
                (str(工作).lower(), "<工作>"),
                (str(工作).lower().replace("\\", "\\\\"), "<工作>"),
            ]
            情形们.append(_换路径(收_uuid(出), 对))
    finally:
        G.ROOT = 原ROOT
        # ★ 还原要**逐字**（`None` 在 `os.environ` 里就是「删掉」）：`os.environ[x] = None`
        #   与 `pop` 等价，所以 `设环境` 一句就够。
        设环境(原env)
    出 = {
        "常量": {"ROOT": str(原ROOT), "LIST_FILE": G.LIST_FILE, "ENV": G.ENV, "MARKER": G.MARKER},
        "情形": 情形们,
        "环境还原": os.environ.get(G.ENV) == 原env,
    }
    # 顶层那个 `ROOT` 也要折 —— 它是工具根的绝对路径，逐字比会把「本机装在哪儿」钉进黄金里。
    return _换路径(出, [(str(根), "<根>"), (str(根).replace("\\", "\\\\"), "<根>")])


算式["guard"] = 算_guard


def 算_plan(料: dict) -> dict:
    """顺序跑 plan 的四个入口，每步比 stdout / 返回值 / 异常消息。

    ★ 工作目录建在**差分目录**底下（同 算_scaffold：系统 temp 可能是 8.3 短名，
      `os.path.abspath` 与 `path.resolve` 算出的写法会对不上，`<工作>` 替换失配）。
    ★ 沙箱开关是**进程级**状态（`plan._写文本` 走 `SB.land`），而 `算_sandbox` 跑完会
      把它留在「开」上 —— 本函数的黄金必须与调用顺序无关，故进门摁回关、出门按原样还原。
    ★ 语料里的 `@工作@` 一律写**正斜杠**（`@工作@/卡/齐备.json`）：这里替成
      `工作.as_posix()`，两侧拼串写法一致；反斜杠形态在 JSON 里要翻倍，两头容易对不上。
    ★ `反推`/`查`/`主` 里读不出 json 的异常文本是**解析器原话**（申报差异 3），
      两侧天生不同 ⇒ 走 `_折解析器` 折成 `解析器: <解析器说>`。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import plan as PLAN
    from forge import sandbox as SB

    工作 = Path(tempfile.mkdtemp(prefix="_tmp_plan-", dir=str(根 / "差分")))
    原沙箱 = SB.enabled()
    SB.enable(False)
    出: dict = {"常量": {}, "模板": [], "反推": [], "查": [], "主": []}
    try:
        for 件 in 料["预置"]:
            if "目录" in 件:
                (工作 / 件["目录"]).mkdir(parents=True, exist_ok=True)
                continue
            p = 工作 / 件["文件"]
            p.parent.mkdir(parents=True, exist_ok=True)
            # 与 JS 侧一一对应：`对象` 走 `json.dumps(ensure_ascii=False, indent=2)` + 末尾一个 \n
            # （与 `JSON.stringify(x, null, 2)` 同形），`文本` 原样写。
            if "对象" in 件:
                文 = json.dumps(件["对象"], ensure_ascii=False, indent=2) + "\n"
            else:
                文 = 件["文本"]
            p.write_text(文, encoding="utf-8", newline="")

        def 替(s):
            return str(s).replace("@工作@", 工作.as_posix())

        for 名 in 料["常量"]:
            出["常量"][名] = _动(getattr(PLAN, 名) if 料["常量"][名] else None)

        for 步 in 料["模板"]:
            名 = 步.get("名")
            出["模板"].append({
                "参数": _动(名),
                "回": _动(PLAN.模板() if 名 is None else PLAN.模板(名)),
            })

        for 步 in 料["反推"]:
            卡 = 替(步["卡"])
            名 = 步.get("名")
            rec: dict = {"卡": 卡, "名": _动(名), "回": None, "错": None}
            try:
                rec["回"] = _动(PLAN.反推(卡) if 名 is None else PLAN.反推(卡, 名))
            except Exception as exc:  # noqa: BLE001
                rec["错"] = _折解析器(_净文本("%s: %s" % (type(exc).__name__, exc)))
            出["反推"].append(rec)

        for 步 in 料["查"]:
            # ★ 成功时不写 `错` 键（JS 侧 `rec` 只带 名/行，`错` 只在 except 里出现）。
            rec: dict = {"名": 步["名"], "行": []}
            buf = io.StringIO()
            try:
                with contextlib.redirect_stdout(buf):
                    回 = _动(PLAN.查(替(步["文"]).replace("@模@", PLAN.模板())))
                rec["回"] = 回
            except Exception as exc:  # noqa: BLE001
                rec["错"] = _折解析器(_净文本("%s: %s" % (type(exc).__name__, exc)))
            rec["出"] = _净文本(buf.getvalue())
            出["查"].append(rec)

        for 步 in 料["主"]:
            if "开关" in 步:
                SB.enable(步["开关"])
            argv = [替(a) for a in 步["argv"]]
            rec: dict = {"argv": argv, "开关": _动(步.get("开关")), "回": None, "错": None}
            buf = io.StringIO()
            try:
                with contextlib.redirect_stdout(buf):
                    rec["回"] = _动(PLAN.main(argv))
            except Exception as exc:  # noqa: BLE001
                rec["错"] = _折解析器(_净文本("%s: %s" % (type(exc).__name__, exc)))
            rec["出"] = _净文本(buf.getvalue())
            出["主"].append(rec)
    finally:
        SB.enable(原沙箱)
        shutil.rmtree(工作, ignore_errors=True)

    # ★ Windows 文件找不到时报错文本里路径走 `%r`（反斜杠翻倍）⇒ 归一表里要同时有「翻倍」那份，
    #   否则 `FileNotFoundError: [Errno 2] … 'E:\\workGZQ\\…\\_tmp_plan-x\\卡\\不存在.json'` 替不掉。
    #   顺序与 JS 侧 `算_plan` 的 `换路径` 四对一致（`str.replace` 是顺序生效的）。
    对 = [
        (工作.as_posix(), "<工作>"),
        (str(工作), "<工作>"),
        (str(工作).replace("\\", "\\\\"), "<工作>"),
        (工作.as_posix(), "<工作>"),
    ]
    return _换路径(出, 对)


算式["plan"] = 算_plan

# ================================================================ bundle
#
# 同 `算_coach` 的架构：预置夹具 → 按序调 `bundle.run` → 记 stdout／返回值／异常消息 → 比整棵树。
#
# 【本模块唯一的真不可比物：zip 本身】两种 deflate 天生不同（CPython zlib 1.3.1 vs Node 那个
# fork 1.3.1-e00f703），条目头的 mtime 也每次不一样 ⇒ 差分不比 zip 字节，改比**解包后的内容**
# （`_zip`：逐条目记「内部名 / 大小 / 文字（或 sha256）」，顺序照 zip 自己的条目表）。这是**折法**，
# 不是放宽比对 —— 与 JS 侧 `算_bundle` 的 `_zip` 一一对应。
#
# 【第二处：卡 / 手册 / 索引里带着每次新发的 uuid 与时间戳】`.card.json` 里的条目 id 与
# created_at/updated_at、索引 md 里的条目号，两侧每跑一次都不一样，且这些键名（卡是酒馆形状）
# 收不进 `_动` 的 `id`/`*_at` 口径；手册与索引正文里还嵌着绝对路径。⇒ 照 `算_coach` 的
# `树带卡` 先例，只在本模块的树里把这些文件的 sha1 换成 `_净文本(正文)`，再靠外层 `_换路径`
# 把工作目录折成 `<工作>`。**共享的 `_树()` 一个字节没动。**
#
# 【第三处：`生成时间`】`包信息.json` 是 `DIST.build_manifest` 产的，里面有 `M.now_iso()`；
# `_zip` 读出来的文字过一次 `_净文本`（ISO ⇒ <时间>）。

_包大小 = re.compile(r"^(\s*\d+ 个文件 · )[\d.]+( KB · .*)$")


def _折行(s):
    """把「N 个文件 · X KB · …」里的那个 X 折成 `<包大小>`。

    ★ 申报差异，理由见上面「唯一的真不可比物」：文件数与清单条数都是确定的，只有体积随
      deflate 实现变。与 JS 侧 `_折行` 的 `_包大小` 一字不差。
    """
    if not isinstance(s, str):
        return s
    return _包大小.sub(r"\1<包大小>\2", s, count=1)


_UUID4 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_UUID32 = re.compile(r"(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])")


def _折正文(s):
    """新发的 uuid4 折成 `<uuid4>`，再过 `_净文本`。

    卡里写成带连字符的 `8-4-4-4-12`，源码（spec / 预览页）里是连写的 32 位十六进制 —— 两支都要折。
    """
    return _净文本(_UUID32.sub("<uuid4>", _UUID4.sub("<uuid4>", s)))


def _读zip(路径):
    """读一个 zip：返回 `[{内部名, 体: bytes}]`，顺序照**中央目录**（＝写进去的顺序）。

    ★ CPython 的 `ZipFile.read(name)` 查的是 `NameToInfo` —— **后写覆盖前写**。
      `bundle.py:98` 那个恒假判断（`os.path.dirname(base) == project`，base 是相对路径、
      project 是 abspath）会让工程根那份旧 `包信息.json` 也进包，于是 zip 里
      `骨架/包信息.json` 出现两次，而 `read()` 两条都回**后写**那份。
      这里必须照抄 last-wins，否则两条同名条目的内容对不上黄金。
    """
    import struct
    import zlib

    buf = Path(路径).read_bytes()
    尾 = -1
    下限 = max(0, len(buf) - 22 - 65535)
    for i in range(len(buf) - 22, 下限 - 1, -1):
        if struct.unpack_from("<I", buf, i)[0] == 0x06054B50:
            尾 = i
            break
    if 尾 < 0:
        raise ValueError("不是 zip：找不到中央目录结尾")
    条数 = struct.unpack_from("<H", buf, 尾 + 10)[0]
    p = struct.unpack_from("<I", buf, 尾 + 16)[0]
    表 = []
    for _ in range(条数):
        if struct.unpack_from("<I", buf, p)[0] != 0x02014B50:
            raise ValueError("不是 zip：中央目录坏了")
        旗 = struct.unpack_from("<H", buf, p + 8)[0]
        法 = struct.unpack_from("<H", buf, p + 10)[0]
        压 = struct.unpack_from("<I", buf, p + 20)[0]
        名长 = struct.unpack_from("<H", buf, p + 28)[0]
        附长 = struct.unpack_from("<H", buf, p + 30)[0]
        注长 = struct.unpack_from("<H", buf, p + 32)[0]
        偏移 = struct.unpack_from("<I", buf, p + 42)[0]
        名 = buf[p + 46:p + 46 + 名长].decode("utf-8" if (旗 & 0x800) else "latin-1")
        表.append({"名": 名, "法": 法, "压": 压, "偏移": 偏移})
        p += 46 + 名长 + 附长 + 注长

    def 解一条(项):
        q = 项["偏移"]
        if struct.unpack_from("<I", buf, q)[0] != 0x04034B50:
            raise ValueError("不是 zip：本地头坏了")
        名长 = struct.unpack_from("<H", buf, q + 26)[0]
        附长 = struct.unpack_from("<H", buf, q + 28)[0]
        起 = q + 30 + 名长 + 附长
        体 = buf[起:起 + 项["压"]]
        if 项["法"] == 0:
            return bytes(体)
        if 项["法"] == 8:
            return zlib.decompress(体, -15)
        raise ValueError("不是 zip：不支持的压缩方式 %d" % 项["法"])

    后写 = {}
    for 项 in 表:
        后写[项["名"]] = 项
    return [{"内部名": 项["名"], "体": 解一条(后写[项["名"]])} for 项 in 表]


def _zip(路径):
    """逐条目记「内部名 / 大小 / 文字（或 sha256）」。"""
    import hashlib
    import shutil
    import tempfile as _tempfile

    暂 = _tempfile.mkdtemp(prefix="_zip-")
    出 = []
    try:
        for 条 in _读zip(路径):
            内部名 = 条["内部名"]
            体 = 条["体"]
            单片 = re.split(r"[\\/]", 内部名)[-1]
            if ".spec." in 单片:
                # `HUD.patch_spec` 落盘时 JS 侧走 `M.jdump`（JSON）、Python 侧走 `M.ydump`（YAML）
                # —— **字节**天生不同（计划 §二① 备案过的申报差异），只能按读回来的**结构**比。
                临时 = os.path.join(暂, 单片)
                Path(临时).write_bytes(体)
                出.append({"内部名": 内部名, "结构": _动(M.load_structured(临时))})
                continue
            try:
                出.append({"内部名": 内部名, "大小": len(体),
                           "文字": _折正文(体.decode("utf-8"))})
            except UnicodeDecodeError:
                出.append({"内部名": 内部名, "大小": len(体),
                           "sha256": hashlib.sha256(体).hexdigest()})
    finally:
        shutil.rmtree(暂, ignore_errors=True)
    return 出


def _折树包(树, 工作):
    """`.zip` 换逐条目折法、可比文本换正文，**只改本地这份树**。"""
    import io

    for 项 in 树:
        rel = 项.get("路径") or ""
        if "sha1" not in 项:
            continue
        p = os.path.join(str(工作), rel)
        if not os.path.isfile(p):
            continue
        低 = rel.lower()
        if 低.endswith(".zip"):
            项.pop("sha1", None)
            项["ZIP"] = _zip(p)
        elif any(低.endswith(t) for t in (".card.json", ".md", ".html", ".json", ".js", ".css")):
            项.pop("sha1", None)
            项["文本"] = _折正文(io.open(p, encoding="utf-8", newline="").read())
    return 树


def 算_bundle(料: dict) -> dict:
    """顺序跑一串 bundle 操作，每步比 stdout / 返回值 / 异常消息，最后比整棵工作树。

    · 工作目录建在**差分目录**底下（**不是工具根**）：工具根会被 scaffold 语料第 27 条
      （`abspath("")`）照进快照当场顶红；系统 temp 又可能是 8.3 短名，两侧 `abspath` 归一对不上。
    · `out` / `out_print` 没法进 JSON ⇒ 语料写口令 `"@行@"`（`rec["行"]` 收它），
      `out` 写 `"@工作@/…"`。两边用同一套口令，**出口本身**也进了差分。
    · ★ `hud.py:51` 的模块级出口 `_P = print` 会被 `bundle.run` 里那句
      `HUD.build(..., out=out_print)`（`hud.py:650 global _P`）**永久换掉**，hud 自己也不还原
      —— 不收拾就会让**排在 bundle 后面跑的 `算_hud`** 把输出吐进一个已经没人看的收集器，
      hud 当场红（实测：`bundle hud` 红 / `hud bundle` 绿）。`算_bridge` 从不碰它 ⇒ 进这里
      之前恒是初始的 `print`。照 `算_coach` 存还原沙箱那一手。
    """
    import contextlib
    import io
    import shutil
    import tempfile

    from forge import bundle as BU

    原出口 = BU.HUD._P
    情形们 = []
    try:
        for 情 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_bundle-", dir=str(根 / "差分")))
            对 = [(str(工作), "<工作>"), (str(工作).replace("\\", "\\\\"), "<工作>")]
            try:
                工程名 = 情.get("夹具")
                if 工程名:
                    shutil.copytree(str(根 / "差分" / "语料" / "bundle" / 工程名),
                                    str(工作 / 工程名))
                for 旧 in 情.get("守旧") or []:
                    旧路径 = 工作 / 旧["路径"]
                    旧路径.parent.mkdir(parents=True, exist_ok=True)
                    旧路径.write_text(旧["正文"], encoding="utf-8", newline="\n")

                出: dict = {"名": 情.get("名"), "步": []}
                for 步 in 情.get("步骤") or []:
                    原参 = 步.get("参数") or []
                    参数0 = [_换路径(a, [("@工作@", str(工作)), ("@根@", str(根))])
                            for a in 原参]
                    行: list = []
                    参数 = [(行.append if a == "@行@" else a) for a in 参数0]
                    buf = io.StringIO()
                    rec: dict = {"调用": 步["调用"], "参数": None}
                    try:
                        with contextlib.redirect_stdout(buf):
                            回 = getattr(BU, 步["调用"])(*参数)
                        rec["回"] = _动(None if 回 is None else 回)
                        rec["错"] = None
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = _净文本("%s: %s" % (type(exc).__name__, exc))
                    rec["参数"] = _动(原参)
                    rec["行"] = [_折行(_净文本(str(x))) for x in 行]
                    rec["出"] = _折行(_净文本(buf.getvalue()))
                    出["步"].append(rec)
                出["树"] = _折树包(_树(工作), 工作)
            finally:
                shutil.rmtree(工作, ignore_errors=True)
                BU.HUD._P = 原出口
            情形们.append(_换路径(_折浮(收_uuid(出)), 对))
    finally:
        BU.HUD._P = 原出口
    return {"情形": 情形们}


算式["bundle"] = 算_bundle


def 算_forge(料: dict) -> dict:
    """`forge.py` —— 命令行入口（33 条命令）逐条走一遍 `main(argv)`。

    ★ 走 `forge.cli.main`（＝`runpy.run_path("forge.py", run_name="__main__")`）：
      `forge\cli.py` 与 `forge\__main__.py` 就是这么落地的，把它抛出的 `SystemExit`
      折成**退出码** —— JS 侧 `cli.mjs` 的 `main` 直接 `return` 那个码，两侧同一个数。
    ★ 每条命令都 `chdir` 到临时目录里跑（语料 argv 全是相对路径）：`plan` / `guide` /
      `mods` / `theme` 的「--help」就是它们的**空参分支**，会真的把模板或清单打出来、
      也可能往 cwd 落文件 —— 一律落进临时目录，**绝不碰工具根**。
    ★ 临时目录建在**差分目录**底下（同 算_scaffold：系统 temp 的 8.3 短名会让两侧
      路径归一后对不上）。
    ★ 新条目 id 是 `前缀-32位十六进制`（随机）：先按 `[0-9a-f]{32}` 折成 `<hex32>`，
      再走 `_净文本` 的 8 位规则 —— 顺序反过来就折不动了（32 位后面还跟着十六进制，
      `_文本8` 的 `(?![0-9a-f])` 不认）。
    """
    import contextlib
    import io as _io
    import shutil

    from forge import cli as CLI
    from forge import sandbox as SBB

    这里 = Path(__file__).resolve().parent
    原cwd = os.getcwd()
    原沙箱 = SBB.enabled()
    SBB.enable(False)
    情形们 = []

    def 折32(s):
        # 32 位连写十六进制（新发 id）先折；`_净文本` 只认带微秒与时区的完整 ISO，
        # 而回收站清单打的是 `时间[:19]`（`2026-10-16T09:55:20`，没有微秒也没有时区）
        # ⇒ 这里补一条**短 ISO** 的形状折法（两侧必须一样，否则同一个清单两边对不上）。
        s = re.sub(r"[0-9a-f]{32}", "<hex32>", s)
        return re.sub(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", "<时间>", s)

    def 码(exc):
        c = getattr(exc, "code", None)
        if c is None:
            return 0
        return int(c) if isinstance(c, int) else 1

    try:
        for 情形 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_forge-", dir=str(这里)))
            try:
                os.chdir(工作)
                出 = {"名": 情形["名"], "步": []}
                for 步 in 情形["步"]:
                    原参 = 步.get("argv")
                    argv = [] if 原参 is None else [str(a) for a in 原参]
                    rec = {"argv": _动(argv), "回": None, "错": None}
                    buf = _io.StringIO()
                    try:
                        with contextlib.redirect_stdout(buf):
                            CLI.main(list(argv))
                        rec["回"] = 0
                    except SystemExit as exc:
                        rec["回"] = 码(exc)
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = 错文本("main", exc)
                    rec["出"] = 折32(_净文本(buf.getvalue()))
                    出["步"].append(rec)
            finally:
                os.chdir(原cwd)
                shutil.rmtree(工作, ignore_errors=True)
            情形们.append(
                _换路径(
                    出,
                    [
                        (str(工作), "<工作>"),
                        (str(工作).replace("\\", "\\\\"), "<工作>"),
                        (str(工作).lower(), "<工作>"),
                        (str(工作).lower().replace("\\", "\\\\"), "<工作>"),
                    ],
                )
            )
    finally:
        os.chdir(原cwd)
        SBB.enable(原沙箱)
    return {"情形": 情形们}


算式["forge"] = 算_forge


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
