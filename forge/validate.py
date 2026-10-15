# -*- coding: utf-8 -*-
"""forge.validate —— 校验器：值域 + 一致性 + 交付前护栏。

分四段：
    1. 值域段   —— 交给 domain.check_entry_domains（拦静默降级）
    2. 一致性段 —— 引用完整性：分组、父对象、开场白指向、id/order 撞车
    3. 护栏段   —— 字数上限、空条目、命名重复等「慢慢长出来」的问题
    4. 工程层段 —— 各层之间对不对得上、派生物过没过期（模块目录↔conf、账本↔现状、
                  spec↔成品）；这几类错的共同点是**都不报错**，只能靠查

每条诊断都带一个「怎么改」，因为「怎么改」才是作者真正缺的东西。
所有断言都是「艾瑟兰实机上撞过的坑」，不是理论。
"""
from __future__ import annotations

import json
import os
import re
from collections import Counter, defaultdict

from . import domain as D
from . import model as M
from . import pack as P

# ------------------------------------------------------------------ 阈值
# 常驻条目每轮都进提示，字数就是钱。这两个数的来历见「模板世界书 · 条目怎么落地」。
CONST_CHARS_LIMIT = 3000      # 常驻合计上限，超了给 WARN
ENTRY_CHARS_LIMIT = 2600      # 单条上限，超了给 INFO


def validate_card(card, source_label="卡片"):
    """对一张已解析的卡做全量校验，返回 Issue 列表。"""
    issues = []

    # ---- 0. 顶层
    fmt = card.get("format", "")
    if fmt and fmt != M.CARD_FORMAT:
        issues.append(M.err("TOP-FORMAT", "卡", "format 是 %r，不是 %r"
                            % (fmt, M.CARD_FORMAT), "确认这是 ElecKoi 卡。"))

    character = card.get("character", {}) or {}
    if not str(character.get("name", "")).strip():
        issues.append(M.warn("TOP-NAME", "卡", "character.name 是空的",
                             "给卡一个名字，否则列表里认不出来。"))

    lib = P.active_library(card)
    var = P.active_variables(card)
    entries = lib.get("entries", []) or []
    groups = lib.get("groups", []) or []
    regex_rules = card.get("regex_rules", []) or []

    gids = {g.get("id") for g in groups}
    oids = {o.get("id") for o in var.get("objects", []) or []}

    # ---- 1. 值域段 + 2. 一致性段（逐条）
    eids = [e.get("id") for e in entries]
    dup_ids = {i for i, n in Counter(eids).items() if n > 1}
    if dup_ids:
        issues.append(M.err("ID-DUP", "设定库", "重复的条目 id：%s"
                            % "、".join(sorted(str(x) for x in dup_ids)),
                            "每个条目 id 必须唯一。"))

    # 同组内 order 撞车才可能影响先后（跨组撞车是常态，不算问题）
    per_group = defaultdict(list)
    for e in entries:
        if e.get("order") is not None:
            per_group[(e.get("group_id") or "", e.get("order"))].append(
                str(e.get("title") or "")[:16])
    clash = {k: v for k, v in per_group.items() if len(v) > 1}
    for (gid, od), titles in sorted(clash.items())[:5]:
        issues.append(M.info("ORDER-CLASH", "设定库",
                             "同组内 order=%s 撞车：%s" % (od, "、".join(titles)),
                             "平台文档没写 order 必须唯一；但同组内撞车时先后可能不确定，"
                             "建议错开。"))
    if len(clash) > 5:
        issues.append(M.info("ORDER-CLASH", "设定库",
                             "另有 %d 处同组 order 撞车" % (len(clash) - 5),
                             "同上。"))

    opening_entries = 0
    const_chars = 0
    const_list = []
    oversized = []

    for e in entries:
        title = str(e.get("title") or "(无标题)").strip()
        where = "条目「%s」" % (title[:24] or "(无标题)")

        if not str(e.get("title") or "").strip():
            issues.append(M.warn("ENTRY-TITLE", where, "条目没有标题",
                                 "给一个标题；AI 的目录里只看得见标题。"))

        # 1. 值域
        issues.extend(D.check_entry_domains(e, where))

        # 2. 分组归属
        gid = e.get("group_id")
        if gid and gid not in gids:
            issues.append(M.err("GROUP-MISSING", where,
                                "分组 %r 不存在" % gid,
                                "改成分组表里已有的 id，或补一个分组。"))

        kind = e.get("kind", "normal")
        trigger = e.get("trigger_mode", "always")

        # 开场白条目
        if kind == "opening":
            opening_entries += 1
            msgs = e.get("opening_messages") or []
            ids = {m.get("id") for m in msgs}
            dflt = e.get("default_opening_message_id")
            if not msgs:
                issues.append(M.err("OPENING-EMPTY", where,
                                    "是开场白条目，但一个开场方案都没有",
                                    "至少给一个方案；开卡第一屏靠它。"))
            if dflt and dflt not in ids:
                issues.append(M.err("OPENING-DEFAULT", where,
                                    "默认开场白指向不存在的方案 %r" % dflt,
                                    "改成一个真实存在的方案 id。"))
            continue

        # 常驻必须有插入位置，否则被直接过滤（不是「约束变弱」，是压根不加载）
        if trigger == "always" and not str(e.get("position") or "").strip():
            issues.append(M.err("CONST-NO-POSITION", where,
                                "是常驻条目（trigger_mode=always），但 position 是空的",
                                "常驻条目位置空着会被平台直接过滤掉，一个字都进不去。"
                                "给一个插入位置（如 instructions）。"))
            const_chars += len(str(e.get("content") or ""))
            const_list.append((title, len(str(e.get("content") or ""))))
        elif trigger == "always":
            const_chars += len(str(e.get("content") or ""))
            const_list.append((title, len(str(e.get("content") or ""))))

        # 单条过长（先记账，循环后聚合报告，免得几十条一起把报告淹了）
        n_chars = len(str(e.get("content") or ""))
        if n_chars > ENTRY_CHARS_LIMIT and kind != "opening":
            oversized.append((title, n_chars))

        # 关键词策略却没有关键词 —— 永远读不到
        if e.get("agent_read_strategy") == "keyword" and not (e.get("keywords") or []):
            issues.append(M.err("KEYWORD-EMPTY", where,
                                "读取策略是 keyword（命中后本轮必读），但关键词是空的",
                                "补关键词，或把策略改成 normal（由 AI 选读）。"))

        # 已是常驻，还要必读是多余的
        if trigger == "always" and e.get("agent_read_strategy") == "required":
            issues.append(M.info("REQUIRED-REDUNDANT", where,
                                 "既 trigger_mode=always 又 agent_read_strategy=required",
                                 "常驻每轮都进提示，required 是多余的，改成 normal。"))

        # 按需条目没写「什么时候读我」
        if trigger == "agent_tool" and not str(e.get("agent_selection_hint") or "").strip():
            issues.append(M.warn("HINT-MISSING", where,
                                 "由 AI 读取，但没写 agent_selection_hint（什么时候读我）",
                                 "目录里只给四项：路径、标题、策略、读取提示。"
                                 "这行写实，AI 才知道什么时候该读。"))

        # 空条目
        if kind == "normal" and not str(e.get("content") or "").strip():
            issues.append(M.info("ENTRY-BLANK", where, "正文是空的",
                                 "空条目占目录位置，删掉或填上。"))

    if opening_entries == 0:
        issues.append(M.err("OPENING-NONE", "设定库", "没有开场白条目",
                            "卡需要一条 kind=opening 的固定开场白。"))
    elif opening_entries > 1:
        issues.append(M.warn("OPENING-MULTI", "设定库",
                             "有 %d 条开场白条目" % opening_entries,
                             "开场白是固定条目，通常只留一条。"))

    # 开场白那一格的**内容**：空着正是它最坏的地方 —— 平台照样开卡，只是第一屏什么都没有，
    # 而人判断一张卡好不好，看的恰恰是「能不能开、开出来什么」。顺带盯一眼「条目正文与各套
    # 方案正文都不一样」：卡里到底用哪一份说不清（两个字段各有各的实现，谁说了算没定论）。
    for e in entries:
        if str(e.get("kind") or "") != "opening":
            continue
        where = "条目「%s」" % (str(e.get("title") or "开场白").strip()[:24] or "开场白")
        正文 = _净文(e.get("content"))
        方案 = [_净文(m.get("content")) for m in (e.get("opening_messages") or [])
                if isinstance(m, dict)]
        方案 = [x for x in 方案 if x]
        if not 正文:
            issues.append(M.warn(
                "OPENING-BLANK", where,
                "开场白条目的正文是空的（%s）" % ("正文只在方案里" if 方案 else "方案也是空的"),
                "有些实现读的是条目正文 —— 空着开卡第一屏就什么都没有。"
                "`python forge.py opener <工程> --正文@开场白.txt` 写一份。"))
        elif 方案 and 正文 not in 方案:
            issues.append(M.info("OPENING-DRIFT", where,
                                 "开场白条目正文与它所带各套方案的正文都不一样",
                                 "卡里到底用哪一份说不清 —— 跑 "
                                 "`python forge.py opener <工程> --看` 对一遍。"))

    if const_chars > CONST_CHARS_LIMIT:
        top = sorted(const_list, key=lambda kv: -kv[1])[:3]
        biggest = "、".join("%s(%d字)" % (t[:14], n) for t, n in top)
        issues.append(M.warn("SIZE-CONST", "设定库",
                             "常驻正文合计 %d 字，超过护栏 %d 字"
                             % (const_chars, CONST_CHARS_LIMIT),
                             "常驻每轮都进提示，字数就是成本（经验值：常驻压到 1,900 字以内）。"
                             "最大的是：%s。把长示例、对照表挪进按需条目，"
                             "是省字数最多的一次改动。" % biggest))

    if oversized:
        top = sorted(oversized, key=lambda kv: -kv[1])[:5]
        shown = "、".join("%s(%d字)" % (t[:12], n) for t, n in top)
        more = "，另有 %d 条" % (len(oversized) - 5) if len(oversized) > 5 else ""
        issues.append(M.info("SIZE-ENTRY", "设定库",
                             "有 %d 条正文超过单条护栏 %d 字：%s%s"
                             % (len(oversized), ENTRY_CHARS_LIMIT, shown, more),
                             "越长越该拆：拆开之后各自有自己的标题和"
                             "「什么时候读我」，AI 才可能按需取到对的那一条。"))

    # ---- 3. 变量段
    issues.extend(_validate_variables(var, entries, oids))

    # ---- 4. 正则段
    issues.extend(_validate_regex(regex_rules))

    return issues


# ------------------------------------------------------------------ 变量
def _validate_variables(var, entries, oids):
    issues = []
    objects = var.get("objects", []) or []
    variables = var.get("variables", []) or []
    state = var.get("initial_state", {}) or {}

    for o in objects:
        pid = o.get("parent_id")
        if pid and pid not in oids:
            issues.append(M.err("VAROBJ-PARENT", "变量对象「%s」" % o.get("name"),
                                "父对象 %r 不存在" % pid, "改成存在的父对象 id。"))

    for item in variables:
        oid = item.get("object_id")
        if oid and oid not in oids:
            issues.append(M.err("VAR-ORPHAN", "变量「%s」" % item.get("title"),
                                "挂在不存在的对象 %r 上" % oid,
                                "改成存在的对象 id。"))

    # 变量条件的路径存在性（agent_read_condition 平台不读，这里只作意图体检）
    for e in entries:
        cond = str(e.get("agent_read_condition") or "").strip()
        if not cond:
            continue
        where = "条目「%s」" % str(e.get("title") or "(无标题)")[:24]
        for token in re.findall(r"[\u4e00-\u9fffA-Za-z_][\u4e00-\u9fffA-Za-z0-9_.]*", cond):
            if "." not in token:
                continue
            probe = token[len(M.STAT_ROOT):] if token.startswith(M.STAT_ROOT) else token
            probe = probe.lstrip(".")
            if probe and not _path_exists(state, probe):
                issues.append(M.info("COND-PATH", where,
                                     "变量条件引用了初始状态里没有的路径：%s" % token,
                                     "该字段平台不读；但若以后要改成真机制，这个路径也得对。"))
    issues.extend(_variable_sync(objects, state, var.get("schema_code")))
    return issues


def _variable_sync(objects, state, schema_code):
    """变量「三处同步」—— 这几处不同步，界面不会报错，只会安静地少一块。

        ① objects      面板是按这张表画的；表里没有，界面上就不出现那一格
        ② initial_state 宿主初始化时取的是它；没有，界面读不到
        ③ schema_code  Zod 校验；不认，写入**被静默丢掉**（最难查的一种）

    这是「档案备份」模块踩出来的那口坑（存档 › 角色 那四处要同时在），
    这里把它变成机器检查：任何一处分叉都报出来。
    """
    issues = []
    if not isinstance(state, dict):
        return issues
    obj_names = {str(o.get("name")) for o in objects
                 if not o.get("parent_id") and not str(o.get("id") or "").startswith("fixed-")}
    state_keys = set(str(k) for k in state.keys())

    for k in sorted(state_keys - obj_names):
        issues.append(M.warn("VAR-SYNC-STATE", "变量",
                             "initial_state 里有「%s」，但 objects 里没有同名对象" % k,
                             "面板按 objects 画 —— 对象表里缺了它，这一格在界面上不会出现。"))
    for k in sorted(obj_names - state_keys):
        issues.append(M.warn("VAR-SYNC-OBJ", "变量",
                             "objects 里有对象「%s」，但 initial_state 里没有初值" % k,
                             "宿主初始化时没有它，界面读不到 —— 在 initial_state 里补一个同名键。"))

    schema = str(schema_code or "")
    if schema:
        for k in sorted(state_keys):
            if k not in schema:
                issues.append(M.warn("VAR-SYNC-SCHEMA", "变量",
                                     "schema_code（Zod）里没有「%s」" % k,
                                     "往它写入会被 schema 静默丢掉 —— 这是最难查的一种。"))
    return issues


def _path_exists(state, path):
    cur = state
    for seg in path.split("."):
        if isinstance(cur, dict) and seg in cur:
            cur = cur[seg]
        else:
            return False
    return True


# ------------------------------------------------------------------ 正则
def _validate_regex(rules):
    issues = []
    for r in rules:
        name = str(r.get("name") or "(无名)")
        where = "正则「%s」" % name
        pat = str(r.get("pattern") or "").strip()
        if not pat:
            issues.append(M.warn("RE-EMPTY", where, "pattern 是空的", "删掉或补上。"))
            continue
        if pat.startswith("/") and not M.RE_SLASH.match(pat):
            issues.append(M.err("RE-SLASH", where,
                                "看起来是 /.../flags 形式但收尾不完整",
                                "写成 /模式/flags，或直接写字面量（如 〔面板〕）。"))

    orders = [r.get("order") for r in rules if r.get("order") is not None]
    dup = {o for o, n in Counter(orders).items() if n > 1}
    if dup:
        issues.append(M.warn("RE-ORDER", "正则",
                             "重复的 order：%s" % "、".join(str(x) for x in sorted(dup)),
                             "替换是「谁先认走就是谁的」——order 撞车时先后随机。"
                             "更专一的规则排前面，兜底的排最后。"))
    return issues


# ------------------------------------------------------------------ 界面层（HUD）
#
# 界面这一段代码是整段注进宿主页面的：它跟宿主共用一个 DOM、一个 window。
# 所以「守规矩」不是风格问题，是**边界问题** —— 越界一处，宿主的界面就跟着变形，
# 或者整页被截断。下面这些规矩全是从坑里捡回来的，逐条变成机器检查。

HUD_SCAN_TAILS = (".js", ".css", ".html")

# 逐字扫描的禁物：(找什么, 为什么, 只查模块?) —— 这三条谁都不许犯
HUD_FORBIDDEN = (
    ("```", "三个反引号 —— 宿主把整页当富文本，会在这儿截断", False),
    ("<!--", "HTML 注释开头 —— 会被宿主当成标记处理", False),
    ("</script", "「</script」字面量 —— 会提前闭合这一页的 script 标签", False),
    # 核心自带那颗常驻悬浮球（.hud-ball / .hud-ballpanel），它本来就该脱离消息流；
    # 模块是「借来的机制」，不许再放一个 —— 这条**只查模块**。
    ("position:fixed", "内联 position:fixed —— 会脱离宿主的消息流", True),
)


def _hit(text, needle):
    if needle == "position:fixed":
        return re.search(r"position\s*:\s*fixed", text, re.I) is not None
    return needle in text


def validate_hud(project):
    """体检工程里的界面层：模块文件守不守规矩、CSS 有没有漏加前缀。

    project 是工程根（有 hud/ 的那种）。没有 hud/ 就返回空 —— 纯内容卡不受影响。
    """
    issues = []
    hud_dir = os.path.join(project, "hud")
    conf_path = os.path.join(hud_dir, "hud.conf.json")
    if not os.path.isfile(conf_path):
        return issues

    try:
        with open(conf_path, "r", encoding="utf-8") as f:
            conf = json.load(f)
    except Exception as exc:
        return [M.err("HUD-CONF", "hud.conf.json", "读不出来：%s" % exc, "修好它再构建。")]

    card_name = str(conf.get("卡名") or "")
    # conf 的「模块」列着的目录必须存在 —— 那种状态比不接更坏：卡看着是接了的，
    # 界面上却安静地少一块，谁也不会发现。
    for m in conf.get("模块") or []:
        d = os.path.join(hud_dir, "模块", str(m))
        if not os.path.isdir(d):
            issues.append(M.err("HUD-MOD-MISSING", "hud.conf.json",
                                "「模块」里写着「%s」，但 %s 不存在" % (m, d),
                                "删掉那一项，或把模块目录补回来（`forge add %s …`）。" % m))

    # 逐文件扫规矩（预览.html 是拼出来的产物，它的 </script> 是外壳自带的，不算）
    targets = []
    for base, dirs, files in os.walk(hud_dir):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", "out")]
        for f in sorted(files):
            if f.endswith(HUD_SCAN_TAILS):
                targets.append(os.path.join(base, f))

    for p in targets:
        rel = os.path.relpath(p, project).replace("\\", "/")
        is_module = rel.startswith("hud/模块/") or rel.startswith("hud/模块\\")
        try:
            text = open(p, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for needle, why, only_module in HUD_FORBIDDEN:
            if only_module and not is_module:
                continue
            if _hit(text, needle):
                issues.append(M.err("HUD-FORBID", rel, "出现了 %s" % why,
                                    "换一种写法；这条是跟宿主共用一个页面才有的约束。"))
        if not rel.endswith(".css"):
            continue
        # CSS：每个选择器都要以 .hud 打头 —— 前缀就是它和宿主页面之间的边界
        bare = _bare_selectors(text)
        if bare:
            shown = "、".join(bare[:4]) + ("…" if len(bare) > 4 else "")
            issues.append(M.err("HUD-CSS-PREFIX", rel,
                                "有 %d 处选择器没带 .hud 前缀：%s" % (len(bare), shown),
                                "漏一个裸选择器（比如 body / .message），宿主的界面就会跟着变形。"))
    issues += _check_opener(project, conf)
    return issues


def _zw_count(text):
    s = str(text or "")
    return s.count("\u200b") + s.count("\u200B")


def _净文(text):
    """去零宽标记再 strip —— 比正文时不该被那三个看不见的字符搅局。"""
    return str(text or "").replace("\u200b", "").replace("\u200B", "").strip()


def _marker_need(pattern):
    """从 `/\u200B{3}/` 这类触发模式里取出「需要几个零宽空格」。取不到就 0。"""
    p = str(pattern or "")
    n = 0
    for m in re.finditer(r"\\u200[bB]\s*\{\s*(\d+)\s*\}", p):
        n = max(n, int(m.group(1)))
    if not n and re.search(r"\\u200[bB]", p):
        n = 1
    return n


def _check_opener(project, conf):
    """开场白那一格：**源头在 hud.conf.json**，spec 里那条是派生物。

    两种「不报错、也就没人发现」的坏法：

      · spec 里开场白正文少了建卡器标记（三个零宽空格 U+200B）→
        导入 ElecKoi 后**建卡界面根本不出现**，check 一个字不报；
      · spec 里那条与 conf 里的对不上 → 你改的是派生物，下次 `forge hud --写回`
        会把它一字不留地冲掉（改了白改）。

    只在「有成品」的工程上查：骨架是**模板源**，`new` 拷一份出来才会写回开场白与
    正则 —— 拿它当错报就是误报（`PROJ-HUD-UNWRITTEN` 已经踩过这个坑一次）。
    """
    issues = []
    op = conf.get("开场白") or {}
    if not isinstance(op, dict) or not op.get("条目"):
        return issues
    cdir = os.path.join(project, "成品")
    if not (os.path.isdir(cdir) and
            any(f.endswith(".card.json") for f in os.listdir(cdir))):
        return issues

    marker = ""
    for r in (conf.get("正则") or []):
        if isinstance(r, dict) and str(r.get("view") or "") == "view_create.html":
            marker = str(r.get("pattern") or "")
    需要 = _marker_need(marker)

    sdir = os.path.join(project, "source")
    specs = []
    if os.path.isdir(sdir):
        specs = [os.path.join(sdir, f) for f in sorted(os.listdir(sdir))
                 if f.endswith(".spec.yaml")]
    if len(specs) != 1:
        return issues                      # 两份 spec 有 PROJ-MULTI-SPEC 管，这里不凑热闹
    try:
        doc = M.yload(specs[0]) or {}
    except Exception:
        return issues
    rel = "source/%s" % os.path.basename(specs[0])

    target = None
    for e in ((doc.get("library") or {}).get("entries") or []):
        if str((e or {}).get("id") or "") == str(op.get("条目")):
            target = e
            break
    if target is None:
        issues.append(M.info(
            "HUD-OPENER-GONE", rel,
            "spec 里没有开场白条目「%s」" % op.get("条目"),
            "这条是 `forge hud --写回` 写进去的 —— 现在开场的正文由宿主自己填。"))
        return issues

    body = str(target.get("content") or "")
    conf_body = str(op.get("正文") or "")
    if 需要 and _zw_count(body) < 需要:
        issues.append(M.err(
            "HUD-OPENER-MARK", rel,
            "开场白正文里少了建卡器标记（%d 个零宽空格 U+200B）" % 需要,
            "**导入 ElecKoi 后建卡界面不会出现，而且不报错。** 这个标记肉眼看不见 —— "
            "别手改这条正文：改 `hud/hud.conf.json` 的「开场白.正文」，"
            "再跑 `python forge.py hud <工程> --写回`。"))
    if conf_body and body.strip() != conf_body.strip():
        issues.append(M.warn(
            "HUD-OPENER-DRIFT", rel,
            "spec 里的开场白与 hud/hud.conf.json 里的对不上",
            "**开场白的源头是 hud.conf.json**，spec 里这条是派生物 —— 你改的是派生物，"
            "下次 `forge hud --写回` 会把它冲掉（改了白改）。要改就改 conf，再写回。"))
    return issues


def _bare_selectors(css_text):
    """挑出没带 .hud 前缀的选择器。

    @media / @keyframes 这类外层包着的规则先不深挖 —— 宁可漏报，也不误报
    （误报会让人不再看报告，那比不报还糟）。
    """
    text = re.sub(r"/\*.*?\*/", "", css_text, flags=re.S)
    out = []
    for rule in text.split("}"):
        if "{" not in rule:
            continue
        head = rule.split("{")[0]
        for one in head.split(","):
            sel = one.strip()
            if not sel or sel.startswith("@"):
                continue
            sel = sel.split("{")[-1].strip()
            if sel and not sel.startswith(".hud"):
                out.append(sel[:28])
    return out


# ------------------------------------------------------------------ 工程层
# 上面查的是「这张卡自己通不通」；这一段查的是「这个工程里各层对不对得上」。
#
# 这几类错的共同点是 —— **都不报错**：
#   · 模块目录在，conf 没登记  → 组装时根本不拼它，界面上安静地少一块
#   · 接了模块账本没记         → `forge drop` 撤不掉，你以为撤了其实没撤
#   · spec 改过没重出成品       → 交出去、导入 ElecKoi 的还是老内容
# 人往往要等到下一局才发现。所以宁可在这儿多说一句。
#
# 规矩同前：**宁可少报，也不误报**。凡是有第二种合理解释的，一律降成提示。

def _load_json_soft(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


def _newest(paths):
    return max([_mtime(p) for p in paths] or [0.0])


def _fingerprint(obj):
    """跟 mods._fingerprint 同一套算法（只比内容，不比键序与空白）。"""
    import hashlib
    return hashlib.sha1(
        json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]


def validate_project(project):
    """体检工程这一层：各层之间对不对得上、派生物是不是过期了。

    project 是工程根。目录不存在就返回空 —— 单张卡的校验不受影响。
    """
    issues = []
    if not project or not os.path.isdir(project):
        return issues

    src = os.path.join(project, "source")
    hud_dir = os.path.join(project, "hud")
    conf_path = os.path.join(hud_dir, "hud.conf.json")
    conf = _load_json_soft(conf_path)

    # ---- 1. source/ 下的 spec：一张工程只该有一份 ----
    specs = []
    if os.path.isdir(src):
        specs = sorted(os.path.join(src, f) for f in os.listdir(src)
                       if f.endswith(".spec.yaml"))
    if len(specs) > 1:
        issues.append(M.err(
            "PROJ-MULTI-SPEC", "source/",
            "有 %d 份 spec：%s" % (len(specs),
                                  "、".join(os.path.basename(p) for p in specs)),
            "一张卡只该有一份 —— 组装界面、出成品都靠「唯一那份」定位，"
            "两份就谁也不知道该用哪份了。多张卡请各自独立成一个目录。"))

    spec_doc = None
    if len(specs) == 1:
        try:
            spec_doc = M.yload(specs[0]) or {}
        except Exception:
            spec_doc = None           # spec 读不出来，交给卡那一层去报
    entries = ((spec_doc or {}).get("library") or {}).get("entries") or []
    rules = (spec_doc or {}).get("regex_rules") or []
    rule_ids = {str(r.get("id") or "") for r in rules}
    rule_by_name = {str(r.get("name") or ""): r for r in rules}
    entry_ids = {str(e.get("id") or "") for e in entries}

    # ---- 1.5 卡名三处得同名 ----
    # 工程目录名 / 界面配置的「卡名」/ spec 的 character.name，三处说的应该是同一个名字。
    # 盲跑实测：`new <新名> --从 <外来卡>` 之后，spec 里顶着**外来卡**的名字，另两处是新名，
    # 而 `check` 一声不响 —— 用户导进 ElecKoi 看到的卡名跟工程目录对不上，无从查起。
    if len(specs) == 1 and conf and spec_doc:
        conf_name = str((conf or {}).get("卡名") or "").strip()
        spec_name = str(((spec_doc.get("character") or {}).get("name")) or "").strip()
        if conf_name and spec_name and conf_name != spec_name:
            issues.append(M.warn(
                "PROJ-NAME-DRIFT", "source/%s" % os.path.basename(specs[0]),
                "界面配置叫「%s」，spec 里却叫「%s」" % (conf_name, spec_name),
                "导进 ElecKoi 显示的是 spec 里那个名字，会跟工程目录对不上。"
                "改成同一个：python forge.py name <工程> --改 \"%s\"" % conf_name))

    # ---- 2. 模块目录 ↔ conf 登记 ----
    # 组装**只按 conf 那一行拼**（hud.py 就是遍历「模块」），所以目录在这儿而名字
    # 不在 conf 里，等于这个模块白接了：脚本与样式一个字都不进页面。
    mod_root = os.path.join(hud_dir, "模块")
    on_disk = []
    if os.path.isdir(mod_root):
        on_disk = sorted(d for d in os.listdir(mod_root)
                         if os.path.isdir(os.path.join(mod_root, d)))
    registered = [str(x) for x in ((conf or {}).get("模块") or [])]
    for name in on_disk:
        if name not in registered:
            issues.append(M.err(
                "PROJ-MOD-UNLISTED", "hud/模块/%s" % name,
                "目录在这儿，却不在 hud.conf.json 的「模块」里",
                "组装时只按「模块」那一行拼 —— 这个模块的脚本与样式不会进页面，"
                "界面上安静地少一块。补上 conf，或重新接一次（`forge add %s …`）。" % name))

    # ---- 3. 账本 ↔ conf ↔ 现状 ----
    ledger = _load_json_soft(os.path.join(project, "模块账本.json")) or {}
    recorded = ledger.get("模块") or {}
    for name in registered:
        if name not in recorded:
            issues.append(M.warn(
                "PROJ-MOD-NO-LEDGER", "hud.conf.json",
                "「%s」登记在 conf 里，账本里却没有它" % name,
                "账本是 `forge drop` 唯一的依据 —— 没记就撤不掉（工具分不清那是"
                "谁的，宁可不撤）。要么重新接一次，要么自己动手摘。"))

    for name, rec in recorded.items():
        rec = rec or {}
        条目 = rec.get("条目") or {}
        for item in (条目.get("替换") or []):
            item = item or {}
            eid = str(item.get("id") or "")
            title = str(item.get("title") or eid or "?")
            if eid not in entry_ids:
                issues.append(M.warn(
                    "PROJ-LEDGER-GONE", "模块账本.json",
                    "「%s」记着它替换过条目「%s」，但 spec 里已经没有这条" % (name, title),
                    "撤这个模块时会撤不动那一处。要么把条目找回来，要么自己改 spec。"))
                continue
            cur = next((e for e in entries if str(e.get("id") or "") == eid), {})
            if item.get("并入后") and _fingerprint(cur) != item["并入后"]:
                issues.append(M.info(
                    "PROJ-LEDGER-DRIFT", "模块账本.json",
                    "「%s」接上「%s」之后你又改过它" % (name, title),
                    "撤模块时会**连你那处改动一起还原**（账本里存的是接之前那一份）。"
                    "不想这样，就先把它从账本里摘掉。"))
        for item in (条目.get("新增") or []):
            item = item or {}
            eid = str(item.get("id") or "")
            title = str(item.get("title") or eid or "?")
            if eid not in entry_ids:
                issues.append(M.info(
                    "PROJ-LEDGER-GONE", "模块账本.json",
                    "「%s」记着它新加了条目「%s」，spec 里已经没有这条" % (name, title),
                    "撤的时候会跳过它，不影响别的。"))
            else:
                cur = next((e for e in entries if str(e.get("id") or "") == eid), {})
                if item.get("指纹") and _fingerprint(cur) != item["指纹"]:
                    issues.append(M.info(
                        "PROJ-LEDGER-DRIFT", "模块账本.json",
                        "「%s」加的条目「%s」你改过" % (name, title),
                        "撤这个模块时它**照删**（账本记着它归模块）—— 舍不得就先把"
                        "它从账本里摘掉。"))
        gone_rules = [str(x) for x in (rec.get("正则") or []) if str(x) not in rule_ids]
        if gone_rules:
            issues.append(M.info(
                "PROJ-LEDGER-REGEX", "模块账本.json",
                "「%s」记着 %d 条正则，spec 里现在没有" % (name, len(gone_rules)),
                "撤的时候会少撤这几条，别的照撤。"))
        for rel in (rec.get("界面") or []):
            p = os.path.join(project, str(rel).replace("/", os.sep))
            if not os.path.exists(p):
                issues.append(M.warn(
                    "PROJ-LEDGER-HUD", "模块账本.json",
                    "「%s」记着界面文件 %s，它不在了" % (name, rel),
                    "撤模块时会删不干净，或者 conf 与目录从此对不上 —— "
                    "手工补回来，或把这一条从账本里摘掉。"))

    # ---- 4. 界面有没有写回卡里 ----
    # conf 里那几条正则就是「卡里出现界面」的唯一入口。spec 里没有同名那条，
    # 导入 ElecKoi 之后什么都不会发生 —— 而且不报错。
    #
    # 只在**已经出过成品**的工程上查：那种工程是真要交出去用的。
    # 骨架这类「模板源」本来就没有成品、也没有那几条正则（`new` 拷一份出来才会写回），
    # 拿它当错报就是误报。
    card_dir = os.path.join(project, "成品")
    card_files = ([f for f in os.listdir(card_dir) if f.endswith(".card.json")]
                  if os.path.isdir(card_dir) else [])
    if conf is not None and spec_doc is not None and card_files:
        for r in (conf.get("正则") or []):
            nm = str((r or {}).get("name") or "")
            if not nm:
                continue
            if nm not in rule_by_name:
                issues.append(M.warn(
                    "PROJ-HUD-UNWRITTEN", "source/%s" % os.path.basename(specs[0]),
                    "hud.conf.json 里那条「%s」不在 spec 的正则里" % nm,
                    "卡里就靠这条正则把界面注进去 —— 少它，导入 ElecKoi 之后"
                    "界面根本不会出现。跑一次 `forge hud <工程> --写回`。"))
            else:
                want = str((r or {}).get("pattern") or "")
                have = str(rule_by_name[nm].get("pattern") or "")
                if want and have and want != have:
                    issues.append(M.info(
                        "PROJ-HUD-PATTERN", "source/%s" % os.path.basename(specs[0]),
                        "正则「%s」的模式与 conf 里那份不一样" % nm,
                        "下次 `forge hud --写回` 会按 conf 覆盖它 —— 若有意改在这里，"
                        "请把 conf 也改了。"))

    # ---- 5. 派生物是不是过期了 ----
    # 交付给 ElecKoi 的是**成品**，不是 spec。改完 spec 忘了重出，导进去的还是老内容。
    if len(specs) == 1 and card_files:
        spec_t = _mtime(specs[0])
        old = [f for f in sorted(card_files)
               if _mtime(os.path.join(card_dir, f)) < spec_t]
        if old:
            issues.append(M.warn(
                "PROJ-STALE-CARD", "成品/",
                "%s 比 spec 旧" % "、".join(old),
                "**交付给 ElecKoi 的是成品，不是 spec** —— 现在导进去的还是改之前"
                    "那一版。跑一次 `forge build` 重新生成。"))
    hud_files = []
    for base, dirs, files in os.walk(hud_dir):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", "out")]
        hud_files += [os.path.join(base, f) for f in files]
    preview = os.path.join(project, "预览.html")
    if os.path.isfile(preview) and hud_files and _mtime(preview) < _newest(hud_files):
        issues.append(M.info(
            "PROJ-STALE-PREVIEW", "预览.html",
            "预览页比 hud/ 下的文件旧",
            "预览不是最新的 —— 跑一次 `forge hud <工程>` 重出（不影响卡本身）。"))
    return issues


# ------------------------------------------------------------------ 汇总
def summarize(card):
    """给出一张卡的结构摘要（不判断对错，只数数）。"""
    lib = P.active_library(card)
    var = P.active_variables(card)
    entries = lib.get("entries", []) or []
    const = [e for e in entries
             if e.get("trigger_mode", "always") == "always" and e.get("kind") != "opening"]
    const_chars = sum(len(str(e.get("content") or "")) for e in const)
    return {
        "name": (card.get("character", {}) or {}).get("name", ""),
        "entries": len(entries),
        "groups": len(lib.get("groups", []) or []),
        "variables": len(var.get("variables", []) or []),
        "objects": len(var.get("objects", []) or []),
        "regex": len(card.get("regex_rules", []) or []),
        "const": len(const),
        "const_chars": const_chars,
        "trigger": dict(Counter(e.get("trigger_mode") for e in entries)),
        "strategy": dict(Counter(e.get("agent_read_strategy") for e in entries)),
        "role": dict(Counter(e.get("insert_role") for e in entries)),
    }


def print_report(card, source, issues):
    """把校验结果打给人看。返回 ERROR 的条数。"""
    s = summarize(card)
    print("=" * 74)
    print("对象    : %s" % source)
    print("卡片    : %s" % (s["name"] or "(无名)"))
    print("条目 %d · 分组 %d · 变量 %d · 对象 %d · 正则 %d"
          % (s["entries"], s["groups"], s["variables"], s["objects"], s["regex"]))
    print("常驻    : %d 条 / %d 字（护栏 %d 字）"
          % (s["const"], s["const_chars"], CONST_CHARS_LIMIT))
    print("触发方式: %s" % _fmt(s["trigger"]))
    print("读取策略: %s" % _fmt(s["strategy"]))
    print("插入角色: %s" % _fmt(s["role"]))

    errs = [i for i in issues if i.level == "ERROR"]
    warns = [i for i in issues if i.level == "WARN"]
    infos = [i for i in issues if i.level == "INFO"]

    print("-" * 74)
    if not issues:
        print("  ✔ 没有发现问题")
    for i in errs + warns + infos:
        print(i.line())
    print("-" * 74)
    print("结论：%d 个错误 · %d 个警告 · %d 条提示"
          % (len(errs), len(warns), len(infos)))
    if errs:
        # 错误全在工程层的话，「导进客户端填了不生效」那句话就不对路了 —— 换一句说准的
        工程 = [i for i in errs if i.code.startswith("PROJ-")]
        if len(工程) == len(errs):
            print("  → 卡本身没毛病，是**这个工程**里两处对不上（上面那几条 PROJ-）——"
                  "不改的话，界面上会安静地少一块，或者交出去的还是老内容。")
        else:
            print("  → 有错误，这张卡导进客户端会有一部分「填了没生效」。先改错误。")
    elif warns:
        工程 = [i for i in warns if i.code.startswith("PROJ-")]
        if len(工程) == len(warns):
            print("  → 卡本身没问题；工程层有几处对不上（PROJ-），建议看一眼。")
        else:
            print("  → 没有错误，警告建议看一眼。")
    else:
        print("  → 可以交付。")
    return len(errs)


def _fmt(counter):
    if not counter:
        return "（无）"
    return " · ".join("%s=%d" % (k, v) for k, v in
                      sorted(counter.items(), key=lambda kv: -kv[1]))
