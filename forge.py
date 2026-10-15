# -*- coding: utf-8 -*-
"""forge.py —— ElecKoi 制卡工具 · 命令行入口

一条命令的用法：

    python forge.py new   <你的卡名>              开一张新卡（抄骨架 + 界面层）
                              --从 <卡.json / 工程包.zip / spec.yaml / 工程目录>
                                                连界面层一起接手一张现成的卡（内容层用它的）
    python forge.py unpack <卡.json>              卡 -> 可读 spec.yaml
    python forge.py build  <spec.yaml> [出.json]  spec -> 卡
    python forge.py check  <文件 或 目录>          校验（值域 + 一致性 + 护栏 + 界面守则）
    python forge.py entry  <spec> --新 "标题"       加一条条目（--列 / 看 / 改 / 复制 / 挪 / 删；都能一次给一串）
    python forge.py name   <工程 或 spec> --改 新卡名  改卡名（spec 与界面配置一起改）
    python forge.py opener <工程> --正文@开场白.txt  换开场白（末尾那三个零宽标记工具负责）
    python forge.py group  <spec> --新 <名>        加一个分组（--列 / --改名 / --删）
    python forge.py var    <spec> --新 玩家.声望    加一个变量（三处一次写全；--改名 / --换对象 / --删 可给一串）
    python forge.py regex  <spec> --新 <名> --模式 "…"   加一条正则（--列 / --删 / --启 / --停）
    python forge.py trash  <工程>                  回收站：删掉的东西都在这儿，能放回去
    python forge.py hud    <工程 或 spec>          组装卡内 HUD（出 预览.html）
    python forge.py analyze <卡文件> ...           拆解报告（酒馆 / ElecKoi 都认）
    python forge.py to-eleckoi <酒馆卡> <出.yaml>  酒馆卡 -> ElecKoi 规格
    python forge.py to-tavern <ElecKoi卡> <出.json> ElecKoi 卡 -> 酒馆 V2 卡
    python forge.py png    <卡.json 或 spec.yaml> [-o 出.png] [--图 封面.png]
                                                出「可以当图片导入」的卡（.card.png）
                                                不加 --图 就现画一张渐变封面
    python forge.py preset <卡.json 或 spec.yaml> [-o 出.preset.json] [--png [出.png]]
                                                把卡里的设定搬成一份 ElecKoi「创作预设」
                                                （--名 改预设名 · --项 只搬这几条 · --png 一并出图）
    python forge.py plan   [<卡.json 或 spec.yaml>] [-o 出.md]
                                                写卡之前先落一份规划书；给了卡就从卡反推
                                                （`plan --查 规划书.md` 查缺什么）
    python forge.py lint   [<卡 或 文稿 或 ->] [-o 报告.md]
                                                正文体检（防八股）：只查句式骨架，不查词
                                                （`lint --标准` 打判据表；`-` 读标准输入）
    python forge.py manual <spec 或 卡> [-o 出.html]  生成人读手册（同时出索引）
    python forge.py index  <spec 或 卡> [-o 出.md]    生成给 AI 的导航索引
    python forge.py coach  [--到 <目录>]            出「怎么做一张卡」：给 AI 的规程 + 给 ElecKoi 的向导卡
    python forge.py guide  [--节 <名>|--篇 <名>|--对话 <名>|--全文]  打印制卡规程（给 AI 按需取：不给参数＝目录）
    python forge.py make   <卡稿.yaml> [--到 <目录>]  照一份卡稿一次落成整张卡（--示例 / --模板 / --试 / --覆盖）
    python forge.py mods  [--工程 <工程>]          列出模块（带版本；给工程则标出接没接）
    python forge.py add    <模块> <spec.yaml>      给卡挂上一块现成的机制
    python forge.py drop   <模块> <spec.yaml>      撤掉一块机制（add 的反操作，按账本精确撤）
    python forge.py theme  [<主题名> <工程>]        列出 / 换皮肤（只覆盖颜色槽，不碰版式）
    python forge.py theme  --导出 <工程>            把这张卡的配色导成一份皮肤文件（可发人）
    python forge.py theme  --导入 <皮肤.json> <工程> 套上别人给的皮肤（--装 则收进主题库）
    python forge.py bundle <工程> [-o 出.zip]       把工程打成一个包（分发用）
    python forge.py import <包.zip 或 卡.json>       收包：落到本地成一张能接着改的工程
    python forge.py diff   <a.json> <b.json>      语义比对
    python forge.py domains                       打印真值域表
    python forge.py selftest                      自检：四十二项，含负向用例与往返比对

沙箱友好模式：任何命令后面加 `--沙箱`（或设 `FORGE_SANDBOX=1`），
forge 就只创建、只覆盖 —— 不删文件、不改名。给「在受限沙箱里跑」的场合用
（ElecKoi 里的 AI 跑命令就是这种环境：能读能写，但不许删、不许改名）。
代价是丢掉原子落盘，所以**能用普通模式就用普通模式**。

设计约定：**spec.yaml 是唯一真相，card.json 是派生物。只手改 spec。**
界面那一层住在本工程里（`hud/` 与 `<卡>.spec.yaml` 同处一个工程目录）。

长正文这么写：凡是要写一段话的参数（`--正文` / `--标题` / `--说明` / `--模式` / `--替换`…）
值都可以写成 `@文件名`，从那个文件读 —— 换行、引号、多长都不必跟 shell 的转义规则搏斗。
例：`python forge.py entry <spec> --改 "核心 · 世界总纲" --正文@世界总纲.txt`。
读一条现在写了什么：`python forge.py entry <spec> --看 "id 或 标题"`。
查一个命令怎么用：`python forge.py <命令> --help`（例：`python forge.py entry --help`）。
"""
from __future__ import annotations

import json
import os
import sys
import time
import zipfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from forge import (bridge, coach as COACH, content as CONTENT, domain, draft as DRAFT,  # noqa: E402
                   export, hud as HUD, lint as LINT, manual, model as M, mods, opener as OPENER, pack,
                   plan as PLAN,
                   png as PNG, preset as PRESET, sandbox as SB, scaffold,
                   theme as THEME, validate)

HELP = __doc__


# ------------------------------------------------------------------ 命令
def cmd_new(argv):
    if not argv:
        print("用法：python forge.py new <卡名> [--到 目录] [--id 前缀] [--模块 骰子,备份]")
        print("      python forge.py new <卡名> --从 <卡.json / 工程包.zip / spec.yaml / 工程目录>")
        return 2
    name = argv[0]
    dest, prefix, wanted, 来源 = None, None, [], None
    i = 1
    while i < len(argv):
        if argv[i] in ("--到", "--to", "-d") and i + 1 < len(argv):
            dest = argv[i + 1]; i += 2
        elif argv[i] in ("--id", "-i") and i + 1 < len(argv):
            prefix = argv[i + 1]; i += 2
        elif argv[i] in ("--从", "--from", "-f") and i + 1 < len(argv):
            来源 = argv[i + 1]; i += 2
        elif argv[i] in ("--模块", "--带", "--mods") and i + 1 < len(argv):
            wanted = [x.strip() for x in argv[i + 1].replace("，", ",").split(",")
                      if x.strip()]
            i += 2
        else:
            print("认不得的参数：%s" % argv[i]); return 2
    proj = scaffold.new_card(name, dest=dest, id_prefix=prefix, modules=wanted,
                             source=来源)
    return 0


def cmd_name(argv):
    if not argv or argv[0].startswith("-"):
        print("用法：python forge.py name <工程 或 spec> --看              现在叫什么、几处一致")
        print("      python forge.py name <工程 或 spec> --改 <新卡名>     改卡名（spec 与界面配置一起改）")
        print("      （卡名散在两处：spec 的 character.name 是真源，hud/hud.conf.json 的「卡名」")
        print("        给界面用。这条命令把两处一起改，免得改一处、另一处悄悄留着旧名。）")
        return 2
    target = argv[0]
    if "--看" in argv or "--show" in argv:
        _print_cardname(scaffold.看卡名(target))
        return 0
    新 = _opt(argv, ("--改", "--set", "--to"))
    if 新 is None:
        print("没说要改成什么。用法：python forge.py name <工程> --改 <新卡名>")
        return 2
    try:
        scaffold.改卡名(target, 新)
    except (ValueError, FileNotFoundError) as exc:
        print("!! %s" % exc)
        return 1
    return 0


def _print_cardname(d):
    print("卡名 · 现状")
    print("─" * 56)
    for k, v in (("工程", d["工程"]), ("spec", d["spec"] or "（没有）"),
                 ("目录名", d["目录名"]), ("spec 里的名字", d["spec 卡名"] or "（空）"),
                 ("界面配置", d["配置文件"] or "（没有界面层）"),
                 ("配置里的卡名", d["conf 卡名"] or "（空）")):
        print("  %s%s" % (_标签(k, 14), v))
    print("")
    if d["一致"]:
        print("  两处一致 ✔")
    else:
        print("  ⚠ 两处不一样 —— 导进 ElecKoi 显示的是 spec 里那个名字，会跟工程目录对不上。")
        print("    改成同一个： python forge.py name <工程> --改 \"%s\"" % d["conf 卡名"])


def cmd_mods(argv):
    proj = _opt(argv, ("--工程", "--project", "-p"))
    mods.print_modules(project=proj)
    return 0


def cmd_add(argv):
    if len(argv) < 2:
        print("用法：python forge.py add <模块> <spec.yaml> [<模块2> ...]")
        print("      先跑 `python forge.py mods` 看有哪些模块。")
        return 2
    spec = argv[-1]
    if not os.path.exists(spec):
        print("找不到 spec：%s" % spec)
        return 2
    names = [a for a in argv[:-1]]
    print("往 %s 里并模块：" % os.path.basename(spec))
    done = mods.apply_modules(spec, names)
    if not done:
        print("  没有并进任何模块。")
        return 1
    print("")
    print("下一步： python forge.py check \"%s\"" % spec)
    print("       python forge.py hud   \"%s\" --写回   （界面跟着一起更新）"
          % os.path.dirname(os.path.dirname(os.path.abspath(spec))))
    print("       撤法： python forge.py drop <模块> \"%s\"" % spec)
    return 0


def cmd_drop(argv):
    if len(argv) < 2:
        print("用法：python forge.py drop <模块> <spec.yaml> [<模块2> ...]")
        print("      撤掉 add 接上的东西：替换的还原、新增的删掉、正则按 id 删、"
              "界面文件与登记一并摘掉。")
        print("      只撤账本里记着的；手写进 spec 的东西一律不动。")
        return 2
    spec = argv[-1]
    if not os.path.exists(spec):
        print("找不到 spec：%s" % spec)
        return 2
    names = [a for a in argv[:-1]]
    print("从 %s 里撤模块：" % os.path.basename(spec))
    dropped = mods.drop_modules(spec, names)
    if not dropped:
        print("  没有撤掉任何模块。")
        return 1
    print("")
    print("下一步： python forge.py check \"%s\"" % spec)
    proj = os.path.dirname(os.path.dirname(os.path.abspath(spec)))
    if os.path.isfile(os.path.join(proj, "hud", "hud.conf.json")):
        print("       python forge.py hud   \"%s\" --写回   （界面也跟着摘掉）" % proj)
    return 0


def cmd_import(argv):
    if not argv:
        print("用法：python forge.py import <工程包.zip 或 卡.json> [--到 目录] [--改名] [--不校验]")
        print("      收包：把别人给的工程包（或单张卡）落到本地，成一张能接着改的工程。")
        return 2
    dest_root = _opt(argv, ("--到", "--to", "-d"))
    src = next((a for a in argv if not a.startswith("-") and a != dest_root), None)
    if not src:
        print("没给包。")
        return 2

    dest_root = os.path.abspath(dest_root or os.getcwd())
    # 只读禁区（内核名单，见 forge/guard.py）：往外写之前先看一眼
    from forge import guard
    why = guard.readonly_reason(dest_root)
    if why:
        print("!! 落点在一个只读禁区里，不写：%s" % dest_root)
        print("   %s" % why)
        return 1

    try:
        from forge import dist as DIST
        DIST.import_pack(src, dest_root,
                         rename=("--改名" in argv or "--rename" in argv),
                         verify=("--不校验" not in argv and "--no-verify" not in argv))
    except Exception as exc:
        print("!! %s" % exc)
        return 1
    return 0


def cmd_theme(argv):
    # `--导出` / `--导入` / `--装`：让一套皮肤能离开这台电脑
    if "--导出" in argv or "--export" in argv:
        out_p = _opt(argv, ("-o", "--out"))
        nm = _opt(argv, ("--名", "--name"))
        target = next((a for a in argv
                       if not a.startswith("-") and a not in (out_p, nm)), None)
        if not target:
            print("用法：python forge.py theme --导出 <工程 或 spec> [-o 出.json] [--名 皮肤名]")
            return 2
        try:
            THEME.export_theme(target, out_path=out_p, name=nm)
        except THEME.ThemeError as exc:
            print("!! %s" % exc)
            return 1
        return 0

    if ("--导入" in argv or "--import" in argv
            or "--装" in argv or "--install" in argv):
        want_install = ("--装" in argv or "--install" in argv)
        rest = [a for a in argv if not a.startswith("-")]
        if len(rest) < 2:
            print("用法：python forge.py theme --导入 <皮肤.json> <工程 或 spec> [--装]")
            print("      --装 = 导入 + 收进 assets/主题/，从此任何卡都能换。")
            return 2
        json_path, target = rest[0], rest[1]
        try:
            THEME.import_theme(json_path, target, install=want_install)
        except THEME.ThemeError as exc:
            print("!! %s" % exc)
            return 1
        return 0

    # `--巡览`：把这张卡在每套皮肤下各渲一遍，拼成一页对照图（不改工程现在的皮肤）
    if "--巡览" in argv or "--showcase" in argv:
        rest = [a for a in argv if a not in ("--巡览", "--showcase")]
        target = next((a for a in rest if not a.startswith("-")), None)
        if not target:
            print("用法：python forge.py theme --巡览 <工程 或 spec> [-o 出.html]")
            return 2
        try:
            THEME.showcase(target, out_path=_opt(argv, ("-o", "--out")))
        except THEME.ThemeError as exc:
            print("!! %s" % exc)
            return 1
        except HUD.HudError as exc:
            print("!! %s" % exc)
            return 1
        return 0

    # `--撤` 单独处理：它自己就是个开关，不能被「滤掉带横杠的参数」那一步吃掉
    if "--撤" in argv or "--clear" in argv:
        rest = [a for a in argv if a not in ("--撤", "--clear")]
        target = next((a for a in rest if not a.startswith("-")), None)
        if not target:
            print("用法：python forge.py theme --撤 <工程 或 spec>")
            return 2
        try:
            THEME.clear_theme(target)
        except THEME.ThemeError as exc:
            print("!! %s" % exc)
            return 1
        return 0

    args = [a for a in argv if not a.startswith("-")]
    if not args:
        THEME.print_themes(project=_opt(argv, ("--工程", "--project", "-p")))
        return 0
    if len(args) < 2:
        if os.path.exists(args[0]):          # 只给一个词且那是个路径 = 看现在用什么
            try:
                print("现在这套：%s" % THEME.current(args[0]))
            except THEME.ThemeError as exc:
                print("!! %s" % exc)
                return 1
            return 0
        print("用法：python forge.py theme <主题名> <工程 或 spec>")
        print("      python forge.py theme                    看有哪些主题")
        print("      python forge.py theme <工程>              看这张卡现在用哪套")
        print("      python forge.py theme --撤 <工程>          回到核心默认")
        print("      python forge.py theme --导出 <工程>        把这张卡的配色导成一份皮肤文件")
        print("      python forge.py theme --导入 <皮肤.json> <工程>   套上别人给的皮肤")
        return 2
    name, target = args[0], args[1]
    try:
        THEME.apply_theme(name, target)
    except THEME.ThemeError as exc:
        print("!! %s" % exc)
        return 1
    return 0


def cmd_unpack(argv):
    if not argv:
        print("用法：python forge.py unpack <卡.json> [-o 出.yaml]")
        return 2
    src = argv[0]
    out = argv[2] if len(argv) > 2 and argv[1] in ("-o", "--out") else None
    path = pack.unpack(src, out)
    print("已解包 -> %s" % path)
    print("  下一步：改它，然后 python forge.py build \"%s\"" % path)
    return 0


def cmd_build(argv):
    if not argv:
        print("用法：python forge.py build <spec.yaml> [出.json]")
        return 2
    spec = argv[0]
    if len(argv) > 1:
        out = argv[1]
    else:
        stem = os.path.splitext(os.path.basename(spec))[0]
        out = os.path.join(os.path.dirname(os.path.abspath(spec)),
                           "..", "成品", stem.replace(".spec", "") + ".card.json")
        out = os.path.normpath(out)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    pack.build(spec, out)
    card = M.jload(out)
    s = validate.summarize(card)
    print("已打包 -> %s" % out)
    print("  条目 %d · 分组 %d · 变量 %d · 正则 %d"
          % (s["entries"], s["groups"], s["variables"], s["regex"]))
    return 0


def cmd_check(argv):
    if not argv:
        print("用法：python forge.py check <spec.yaml 或 卡.json 或 目录> [更多...]")
        return 2
    targets = []
    for a in argv:
        if a.startswith("-"):
            continue
        if os.path.isdir(a):
            targets += _collect(a)
        elif os.path.exists(a):
            targets.append(a)
        else:
            print("找不到：%s" % a)
            return 2
    if not targets:
        print("没找到可校验的文件（.spec.yaml / .card.json）。")
        return 2

    total_err = 0
    rows = []
    seen_projects = set()
    for path in targets:
        try:
            if M.is_yaml(path):
                card = pack.spec_to_card(path)
                label = os.path.basename(path)
            else:
                card = M.jload(path)
                label = os.path.basename(path)
        except Exception as exc:
            rows.append((path, "读不出版", ["%s" % exc]))
            total_err += 1
            continue
        issues = validate.validate_card(card, label)

        # 这份 spec/卡 若住在某个工程里，顺带把**工程层**与**界面层**也体检一遍
        proj = _project_of_path(path)
        if proj not in seen_projects:
            seen_projects.add(proj)
            issues += validate.validate_project(proj)
            if os.path.isfile(os.path.join(proj, "hud", "hud.conf.json")):
                issues += validate.validate_hud(proj)

        errs = [i for i in issues if i.level == "ERROR"]
        total_err += len(errs)
        rows.append((path, "ok" if not errs else "%d 错" % len(errs),
                     [i.line() for i in errs]))
        if len(targets) == 1:
            validate.print_report(card, label, issues)

    if len(targets) > 1:
        print("=" * 74)
        print("批量校验 · %d 个文件" % len(targets))
        print("=" * 74)
        for path, verdict, lines in rows:
            mark = "✔" if verdict == "ok" else "✗"
            print("  %s %-40s %s" % (mark, os.path.basename(path), verdict))
            for ln in lines[:3]:
                print("      %s" % ln)
        print("-" * 74)
        print("%d 个文件 · %d 个错误" % (len(targets), total_err))
    return 1 if total_err else 0


def _project_of_path(path):
    """从 spec/卡 的位置折出工程根（`<工程>/source/x.spec.yaml`、`<工程>/成品/x.card.json`）。"""
    p = os.path.dirname(os.path.abspath(path))
    if os.path.basename(p) in ("source", "成品", "文档"):
        p = os.path.dirname(p)
    return p


def _collect(root):
    """把一个目录里所有的 spec / 卡收集起来（跳过产物目录与缓存）。"""
    skip = {"__pycache__", "out", "node_modules", ".git", ".forge"}
    got = []
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".")]
        for f in sorted(files):
            if f.endswith(".spec.yaml") or f.endswith(".card.json"):
                got.append(os.path.join(base, f))
    return got


def cmd_hud(argv):
    if not argv:
        print("用法：python forge.py hud <工程目录 或 source/*.spec.yaml> [--写回]")
        print("      组装卡内 HUD：拼页面 -> 出 预览.html；--写回 再把正则写回 spec。")
        return 2
    target = None
    for a in argv:
        if not a.startswith("-"):
            target = a
            break
    if not target:
        print("没给工程或 spec。")
        return 2
    write_back = ("--写回" in argv or "--patch" in argv)
    try:
        problems, _ = HUD.build(target, write_back=write_back)
    except HUD.HudError as exc:
        print("!! %s" % exc)
        return 1
    return 1 if problems else 0


def _print_opener(d):
    if not d["有开场白"]:
        print("这个工程没有开场白 —— hud.conf.json 里没有「开场白」这一块。")
        print("  conf：%s" % d["配置文件"])
        print("  （没有它，开场那一步由宿主自己填。想要就照别的工程的形状补一块。）")
        return
    内容档 = d.get("模式") == "内容"
    print("开场白 · %s" % os.path.basename(d["工程"]))
    print("─" * 62)
    if 内容档:
        print(_标签("真源") + "spec 里那条（这个工程没有界面层，没有 conf 在上面盖）")
    print(_标签("配置文件") + (d["配置文件"] or "（没有——内容档）"))
    print(_标签("挂到条目") + (d["条目"] or "（没写）"))
    print(_标签("字数") + "%d（不含末尾标记）" % d["字数"])
    n = d["标记数"]
    print(_标签("零宽标记") + ("末尾 %d 个 ✔" % n if n == 3 else
                              "末尾 %d 个 ✗ 该是 3 个 —— 少了建卡界面不会出现，跑 --补齐" % n))
    print(_标签("尖括号") + ("有 ✗ 会从会话预览里露出来" if d["尖括号"] else "无 ✔"))
    if d["方案"]:
        print(_标签("方案") + "%d 个：%s（写回后共用这一份正文）"
              % (len(d["方案"]), "、".join(d["方案"])))
    if d["写回一致"] is None:
        print(_标签("写回状态") + "spec 里没有这条（%s）—— 开场那一步交给宿主"
              % (d["条目"] or "?"))
    elif 内容档:
        print(_标签("写回状态") + "不用写回 —— 改的就是 spec 里那条")
    else:
        print(_标签("写回状态") + ("与 spec 一致 ✔" if d["写回一致"]
                                  else "与 spec 不一致 ✗ —— 跑 --写回 灌进去"))
    print("")
    print("正文：")
    print(d["正文"].rstrip("\u200b") or "（空）")
    print("")
    if 内容档:
        print("（这个工程没有界面层，本来不需要末尾那 3 个零宽标记 —— 工具仍然按规矩补着，"
              "将来给这张卡接界面时就不用再回头补）")
    else:
        print("（末尾那 %d 个看不见的零宽空格就是它 —— 建卡界面靠它触发）" % n)


def cmd_opener(argv):
    用法 = (
        "用法：python forge.py opener <工程> --看              看开场白（正文 / 标记 / 写回没写回）\n"
        "      python forge.py opener <工程> --正文@开场白.txt   换正文（末尾的零宽标记自动补齐，改完写回 spec）\n"
        "      python forge.py opener <工程> --补齐             只补末尾的零宽标记（少了，建卡界面会静默消失）\n"
        "      python forge.py opener <工程> --写回             只写回（不改正文）\n"
        "  （工程有界面层时，开场白的真源是 hud/hud.conf.json，spec 里那条是派生物；\n"
        "   只有 source/ 的工程（比如 import 进来的单张卡）没有界面层，spec 里那条就是真源，\n"
        "   改它不会「改了白改」—— 两种都认。\n"
        "    --正文 默认改完顺手写回；想先只改配置，加 --不写回）")
    if not argv or argv[0].startswith("-"):
        print(用法)
        return 2
    target = argv[0]
    带正文 = any(a.startswith("--正文") or a.startswith("--body") for a in argv)
    try:
        if "--看" in argv or "--show" in argv:
            _print_opener(OPENER.读(target))
            return 0
        if "--补齐" in argv:
            OPENER.补齐(target)
            return 0
        if ("--写回" in argv or "--patch" in argv) and not 带正文:
            OPENER.写回(target)
            return 0
        if not 带正文:
            print(用法)
            return 2
        OPENER.改正文(target, _opt(argv, ("--正文", "--body")),
                       写回=("--不写回" not in argv))
        return 0
    except OPENER.OpenerError as exc:
        print("!! %s" % exc)
        return 1


def cmd_bundle(argv):
    if not argv:
        print("用法：python forge.py bundle <工程目录> [-o 出.zip] [--带卡]")
        print("      打的是**工程分发包**（含界面层源码，给人接着改）。")
        print("      它会把工程顺手收一遍：重组 HUD → 写回 spec → 重出成品卡 → 重出手册与索引；")
        print("      --带卡 时再额外导出一张酒馆 V2 卡 .json。")
        print("      只要成品卡、不要工程包：用 `python forge.py build <spec> <出.json>`。")
        return 2
    target = None
    for a in argv:
        if not a.startswith("-"):
            target = a
            break
    if not target:
        print("没给工程目录。")
        return 2
    try:
        from forge import bundle as BUNDLE
        BUNDLE.run(target, out=_opt(argv, ("-o", "--out")),
                   with_card=("--带卡" in argv))
    except Exception as exc:
        print("!! %s" % exc)
        return 1
    return 0


def cmd_analyze(argv):
    if not argv:
        print("用法：python forge.py analyze <卡文件> ...")
        return 2
    for p in argv:
        try:
            bridge.analyze(p)
        except Exception as exc:
            print("!! %s: %s" % (os.path.basename(p), exc))
        print()
    return 0


def cmd_to_eleckoi(argv):
    if len(argv) < 2:
        print("用法：python forge.py to-eleckoi <酒馆卡> <出.yaml>")
        return 2
    try:
        bridge.to_eleckoi(argv[0], argv[1])
    except Exception as exc:
        print("!! %s" % exc)
        return 1
    return 0


def cmd_to_tavern(argv):
    if len(argv) < 2:
        print("用法：python forge.py to-tavern <ElecKoi卡 或 spec.yaml> <出.json> [--带原卡]")
        return 2
    src, out_path = argv[0], argv[1]
    keep_raw = "--带原卡" in argv
    tmp = None
    try:
        if M.is_yaml(src):
            tmp = M.temp_json()
            pack.build(src, tmp)
            src = tmp
        export.to_tavern(src, out_path, keep_raw=keep_raw)
    except Exception as exc:
        print("!! %s" % exc)
        return 1
    finally:
        SB.cleanup(tmp)
    return 0


def cmd_png(argv):
    if not argv:
        print("用法：python forge.py png <卡.json 或 spec.yaml> [-o 出.png] [--图 封面.png] [--带酒馆块]")
        print()
        print("  出一条**可以当图片导入**的卡：把成品卡嵌进 PNG 的 tEXt 块 `eleckoi-card`")
        print("  （= base64(gzip(卡 JSON))）—— 手机与客户端「导入角色」选图片走的就是这条路，")
        print("  只给 .card.json 对方是导不进去的。")
        print("  再加一段 iTXt 摘要；像素一个字节不动，同一份卡跑两次得到同一个 PNG。")
        print("  **默认不写酒馆的 `chara` 块** —— 官方「角色卡同步协议」明写导出不得携带")
        print("  第三方兼容载荷，验收条款还专门查这个。真要一份酒馆也能吃的图，加 --带酒馆块。")
        print("  --图 不给就现画一张渐变封面（本工具不依赖 Pillow）。")
        return 2
    src = argv[0]
    out_path = _opt(argv, ("-o", "--out")) or PNG.default_out(src)
    cover = _opt(argv, ("--图", "--cover"))
    带酒馆块 = any(a in ("--带酒馆块", "--tavern") for a in argv)
    if 带酒馆块:
        argv = [a for a in argv if a not in ("--带酒馆块", "--tavern")]
    tmp = None
    try:
        if M.is_yaml(src):
            tmp = M.temp_json()
            pack.build(src, tmp)
            src = tmp
        res = PNG.write(src, out_path, cover, tavern=带酒馆块)
        PNG.verify(res["png"], allow_tavern=带酒馆块)
    except Exception as exc:
        print("!! %s" % exc)
        return 1
    finally:
        SB.cleanup(tmp)
    return 0


def cmd_preset(argv):
    if not argv:
        print("用法：python forge.py preset <卡.json 或 spec.yaml> [-o 出.preset.json] [--png [出.png]]")
        print()
        print("  把卡里那套设定搬成一份 ElecKoi **创作预设**（`eleckoi.agent-preset` v2）——")
        print("  在客户端「预设管理器 → 导入预设」选它、分类选「创作预设」，AI 就带着这套")
        print("  设定与规程干活。角色卡是「一次对话演一个人」，创作预设是「一次对话配一套做法」。")
        print("  条目按客户端白名单逐条核（kind / position / agent_read_strategy …），")
        print("  角色扮演机件（隐藏工具时间线、历史压缩）留在卡里不搬过来。")
        print("  可选项：--名 <预设名> · --作者 <署名> · --说明 <文字或 .md 文件>")
        print("          --工具组 a,b（默认 builtin:creator）· --版本名 <名>")
        print("          --留引擎条目（默认丢掉那两类机件）· --png [出.png] 一并出图片版")
        return 2
    src = argv[0]
    out_path = _opt(argv, ("-o", "--out")) or PRESET.default_out(src)
    name = _opt(argv, ("--名", "--name"))
    author = _opt(argv, ("--作者", "--author")) or ""
    instructions = _opt(argv, ("--说明", "--instructions"))
    if instructions and os.path.isfile(instructions):
        instructions = open(instructions, "r", encoding="utf-8").read().strip()
    version_name = _opt(argv, ("--版本名", "--version-name")) or ""
    groups = _opt(argv, ("--工具组", "--groups"))
    groups = [g.strip() for g in groups.split(",") if g.strip()] if groups else None
    drop_engine = not ("--留引擎条目" in argv or "--keep-engine" in argv)

    tmp = None
    try:
        if M.is_yaml(src):
            tmp = M.temp_json()
            pack.build(src, tmp)
            src = tmp
        got = PRESET.build(src, out_path, name=name, author=author,
                           instructions=instructions, tool_groups=groups,
                           version_name=version_name, drop_engine=drop_engine)
        PRESET.verify(got["json"])
        if "--png" in argv:
            idx = argv.index("--png")
            png_out = None
            if idx + 1 < len(argv) and not argv[idx + 1].startswith("-"):
                png_out = argv[idx + 1]
            PRESET.build_png(got["json"], png_out)
    except Exception as exc:
        print("!! %s" % exc)
        return 1
    finally:
        SB.cleanup(tmp)
    return 0


def cmd_plan(argv):
    """规划书：打一份空的 / 从卡反推 / 查一份写完的。"""
    if argv and argv[0] in ("--h", "--help", "-h"):
        print("用法：python forge.py plan [-o 出.md]                  打一份空规划书")
        print("      python forge.py plan <卡.json 或 spec.yaml>      从现成的卡反推一份")
        print("      python forge.py plan --查 规划书.md              查一份写完的，缺什么当场说")
        return 0
    return PLAN.main(argv)


def cmd_lint(argv):
    """正文体检（防八股）：只查句式骨架，不查词。"""
    # 空参分支＝这条命令的用法文本（`_打命令用法` 借它回答 `lint --help`，
    # 自检第 34 项要求这段里必须出现 `forge.py lint`）。
    if not argv or argv[0] in ("--h", "--help", "-h"):
        print("用法：python forge.py lint <卡.json 或 spec.yaml 或 文本> [-o 报告.md]")
        print("      python forge.py lint -      从标准输入读（写完一轮自查用）")
        print("      python forge.py lint --标准 打判据表（每条判据的口径与来源）")
        print("有硬判据不过 ⇒ 退出码 1；三条硬判据 = 提示冒号＋空行接列表 · 对立句式 ≤1 · 破折号 0")
        print("长文本（>2000 汉字）自动降级成只报密度 —— 硬阈值是按「一轮输出」标定的。")
        return 0 if argv else 2
    try:
        return LINT.main(argv)
    except LINT.LintError as exc:
        print("!! %s" % exc)
        return 1


def cmd_manual(argv):
    if not argv:
        print("用法：python forge.py manual <spec.yaml 或 卡.json> [-o 出.html] [--只手册]")
        return 2
    src = argv[0]
    out = _opt(argv, ("-o", "--out"))
    try:
        manual.build_manual(src, out)
        if "--只手册" not in argv:
            manual.build_index(src)
    except Exception as exc:
        print("!! %s" % exc)
        return 1
    return 0


def cmd_index(argv):
    if not argv:
        print("用法：python forge.py index <spec.yaml 或 卡.json> [-o 出.md]")
        return 2
    try:
        manual.build_index(argv[0], _opt(argv, ("-o", "--out")))
    except Exception as exc:
        print("!! %s" % exc)
        return 1
    return 0


def cmd_make(argv):
    """照一份卡稿（YAML）一次落成整张卡 —— 给「想清楚了，一次写完」用的。"""
    用法 = (
        "用法：python forge.py make <卡稿.yaml> [--到 <目录>] [--试] [--覆盖] [--保留]\n"
        "  稿子写的是「这张卡该长什么样」，不是「先做这步再做那步」：\n"
        "    · 条目按标题认人 —— 卡里已有同名的改它，没有才新建（不必管骨架里现成有什么）\n"
        "    · 分组 / 变量对象缺了自动补（报告里单列一份，名字打错看得见）\n"
        "    · **全程在临时目录里做，全绿了才整棵拷到目标位置** ——\n"
        "      稿子有毛病时，目标位置一个字都不会被写\n"
        "  --试    只验证：做到能出成品、体检通过，但不往目标位置写\n"
        "  --覆盖  那份工程已经在了就照稿子重落一遍（只认同一张卡：\n"
        "          目标里有 source/<卡名>.spec.yaml 才让盖；别的东西一律不碰）\n"
        "  --保留  把这一趟的临时工程留着（调试稿子用）\n"
        "  不知道稿子长什么样：\n"
        "    python forge.py make --模板   一份骨架（有哪些键、怎么缩进）\n"
        "    python forge.py make --示例   一张真能开的卡（连「话该写多细」一起示范）")
    if "--模板" in argv or "--template" in argv:
        print(DRAFT.卡稿模板(), end="")
        return 0
    if "--示例" in argv or "--sample" in argv or "--例子" in argv:
        print(DRAFT.卡稿示例(), end="")
        return 0
    稿 = next((a for a in argv if not a.startswith("-")), None)
    if not 稿:
        print(用法)
        return 2
    try:
        r = DRAFT.落卡(稿, 到=_opt(argv, ("--到", "--to", "-d")),
                       试=("--试" in argv or "--dry" in argv),
                       覆盖=("--覆盖" in argv or "--force" in argv),
                       保留=("--保留" in argv or "--keep" in argv))
    except DRAFT.DraftError as exc:
        print("!! %s" % exc)
        return 2
    DRAFT.打报告(r)
    return 0


def cmd_coach(argv):
    """出两份「怎么做一张 ElecKoi 卡」：给电脑 AI 的规程，给 ElecKoi 的向导卡。"""
    到 = _opt(argv, ("--到", "-o", "--out"))
    r = COACH.出(到)
    return 0


def cmd_guide(argv):
    """打印制卡规程：不给参数出目录，`--节 三` 取一节，`--篇 预算` 取一篇，
    `--对话 访谈` 取「在对话里做卡」的一段，`--全文` 全出。

    **给 AI 取知识用的**。规程全文一万七千字，一次全塞进上下文既贵又冲淡重点 ——
    所以先出目录、再按需取一段。ElecKoi 里装了「制卡工坊」插件的 AI 就靠这个
    自己把知识取到手（`cardforge(args=["guide","--节","三"])`），不必等人把规程贴进对话。
    """
    if "--全文" in argv:
        print(COACH.规程正文())
        return 0
    打了 = False
    for 长名, 短名, 取 in (("--节", "-s", COACH.取节), ("--篇", "-p", COACH.取篇),
                          ("--对话", "-d", COACH.取对话)):
        名 = _opt(argv, (长名, 短名))
        if 名 is None:
            continue
        try:
            print(取(名))
        except KeyError as exc:            # 认不出就报清楚 + 附上目录，绝不静默给空
            print("!! %s\n" % exc.args[0])
            print(COACH.目录())
            return 2
        打了 = True
    if not 打了:
        print(COACH.目录())
    return 0


class ArgError(Exception):
    """命令行参数本身有毛病（不是卡的问题）。"""


def _读文(v):
    """参数值写成 @文件名 且那个文件真在 -> 从文件读内容。

    为的是长正文。在命令行里塞几百上千字、还要带换行和引号，转义是地狱；
    而且跨 shell 各不相同（bash 认 `$'甲\\n乙'`，cmd 不认）。写成文件再 @ 进来，
    任何 shell、任何长度、带不带引号都一样。文件末尾那一个换行按编辑器习惯忽略。

    **文件不在就报错，绝不静默**。不然路径写错一个字母，写进去的是
    字符串 `@正文.txt` 本身 —— 卡里出现这么一段，而谁也不知道。
    """
    if not isinstance(v, str) or not v.startswith("@"):
        return v
    f = v[1:]
    if not f:
        raise ArgError("`@` 后面要跟文件名。例：--正文@正文.txt")
    if not os.path.isfile(f):
        raise ArgError(
            "参数里的 @%s 不是个文件（当前目录 %s）。\n"
            "  `@名字` 的意思是「从这个文件读内容」。写出绝对路径最稳；\n"
            "  真的想传一个以 @ 开头的字符串？把整段写进文件再 @ 引。" % (f, os.getcwd()))
    with open(f, encoding="utf-8") as fh:
        文 = fh.read()
    return 文[:-1] if 文.endswith("\n") else 文


def _opt(argv, names):
    for i, a in enumerate(argv):
        if a in names and i + 1 < len(argv):
            return _读文(argv[i + 1])
        for n in names:                       # 也认连写：--正文@正文.txt
            if a.startswith(n + "@"):
                return _读文(a[len(n):])
    return None


def cmd_diff(argv):
    if len(argv) < 2:
        print("用法：python forge.py diff <a.json> <b.json>")
        return 2
    return diff_cards(argv[0], argv[1])


def cmd_domains(argv):
    print("ElecKoi 真值域表（来源：反编译 0.2.8 逐字节取证）")
    print()
    for name, dom in domain.DOMAINS.items():
        print("  %s" % name)
        print("      合法值：%s" % " / ".join(dom.values))
        print("      缺省  ：%s" % dom.default)
        if dom.legacy:
            print("      旧值  ：%s" % "、".join("%s → %s" % kv for kv in dom.legacy.items()))
        print("      %s" % dom.note)
        print()
    print("平台不读的字段：")
    for f, why in domain.DEAD_FIELDS.items():
        print("  %s —— %s" % (f, why))
    print()
    for line in domain.POSITION_NOTE:
        print("  %s" % line)
    return 0


# ------------------------------------------------------------------ diff
def diff_cards(a_path, b_path):
    # 时间戳与「往返重建」无关，先抹掉再比，免得报告被它们淹没
    a, b = _scrub(M.jload(a_path)), _scrub(M.jload(b_path))
    if _canon(a) == _canon(b):
        print("✔ 两张卡语义完全一致")
        return 0

    print("✗ 存在差异")
    for key in ("format", "version", "character", "assets", "regex_rules"):
        if _canon(a.get(key)) != _canon(b.get(key)):
            print("  顶层字段不同：%s" % key)

    for key, label in (("setting_library", "设定库"), ("variable_config", "变量")):
        va, vb = pack.active_library(a), pack.active_library(b)
        if key == "variable_config":
            va, vb = pack.active_variables(a), pack.active_variables(b)
        if _canon(va) == _canon(vb):
            continue
        print("  %s 不同" % label)
        if key == "setting_library":
            ta = {e.get("title"): e for e in va.get("entries", []) or []}
            tb = {e.get("title"): e for e in vb.get("entries", []) or []}
            for t in ta:
                if t not in tb:
                    print("      仅 A 有：%s" % t)
                elif _canon(ta[t]) != _canon(tb[t]):
                    print("      内容不同：%s" % t)
            for t in tb:
                if t not in ta:
                    print("      仅 B 有：%s" % t)
    return 1


def _canon(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True)


# ------------------------------------------------------------------ selftest
def _常驻字数(卡):
    """一张卡里「每轮都要注入」的字数：常驻条目 + 缓存设定之外的正文量。"""
    lib = pack.active_library(卡)
    总 = 0
    for e in (lib.get("entries") or []):
        if (e.get("trigger_mode") or "") == "always" and (e.get("kind") or "normal") == "normal":
            总 += len(e.get("content") or "")
    return 总


def cmd_selftest(argv):
    """自检：骨架 -> 卡 -> 解包 -> 再打包，比对语义是否一致；顺带跑校验。"""
    import tempfile
    # 自检是**在普通文件系统上考工具自己** —— 有几项靠「删文件 / 改名」摆场景，
    # 沙箱模式下它们会假报错。所以这里把沙箱模式关掉（第 42 项自己会临时打开再关）。
    if SB.enabled():
        print("（沙箱友好模式已临时关掉 —— 自检要在能删能改名的文件系统上跑）")
        SB.enable(False)
    ok = True
    tmp = tempfile.mkdtemp(prefix="forge_selftest_")

    print("=" * 74)
    print("forge 自检（四十二项；编号 21 / 39 / 40 原为图形工作台，已迁出 → 弃用/工作台/）")
    print("=" * 74)

    # 1. 开新卡
    try:
        proj = scaffold.new_card("自检卡", dest=tmp, quiet=True)
        spec = os.path.join(proj, "source", "自检卡.spec.yaml")
        print("  1 开新卡          ✔ %s" % os.path.relpath(spec, tmp))
    except Exception as exc:
        print("  1 开新卡          ✗ %s" % exc)
        return 1

    # 2. 校验 spec
    card1 = pack.spec_to_card(spec)
    issues = validate.validate_card(card1, "骨架")
    errs = [i for i in issues if i.level == "ERROR"]
    if errs:
        ok = False
        print("  2 骨架校验        ✗ 有 %d 个错误（骨架不该有错）" % len(errs))
        for i in errs:
            print(i.line())
    else:
        print("  2 骨架校验        ✔ 0 错误，%d 警告"
              % len([i for i in issues if i.level == "WARN"]))

    # 3. 打包
    card_path = os.path.join(proj, "成品", "自检卡.card.json")
    pack.build(spec, card_path)
    card2 = M.jload(card_path)
    print("  3 打包            ✔ %s" % os.path.relpath(card_path, tmp))

    # 4. 解包
    round_spec = os.path.join(tmp, "round.spec.yaml")
    pack.unpack(card_path, round_spec)
    print("  4 解包            ✔ %s" % os.path.basename(round_spec))

    # 5. 往返语义一致
    card3 = pack.spec_to_card(round_spec)
    if _canon_pair(card2, card3):
        print("  5 往返一致        ✔ 卡 -> spec -> 卡，语义不变")
    else:
        ok = False
        print("  5 往返一致        ✗ 往返后语义变了")

    # 6. 值域拦截（负向验：故意写一个会被静默降级的旧值）
    bad = M.jload(card_path)
    pack.mutate_active_library(
        bad, lambda lib: lib["entries"][1].__setitem__("agent_read_strategy",
                                                       "variable_condition"))
    intercepted = [i for i in validate.validate_card(bad, "负向样本")
                   if i.code == "DOMAIN-LEGACY"]
    if intercepted:
        print("  6 值域拦截        ✔ 拦下了 variable_condition（会被静默降级）")
    else:
        ok = False
        print("  6 值域拦截        ✗ 没拦下 variable_condition")

    # 7. 常驻缺位置（负向）
    bad2 = M.jload(card_path)
    pack.mutate_active_library(
        bad2, lambda lib: lib["entries"][1].__setitem__("position", ""))
    caught = [i for i in validate.validate_card(bad2, "负向样本")
              if i.code == "CONST-NO-POSITION"]
    if caught:
        print("  7 常驻位置护栏    ✔ 拦下了「常驻但 position 为空」")
    else:
        ok = False
        print("  7 常驻位置护栏    ✗ 没拦下常驻缺位置")

    # 8. 关键词空（负向）
    bad3 = M.jload(card_path)
    def _blank_keywords(lib):
        lib["entries"][3]["agent_read_strategy"] = "keyword"
        lib["entries"][3]["keywords"] = []
    pack.mutate_active_library(bad3, _blank_keywords)
    caught3 = [i for i in validate.validate_card(bad3, "负向样本")
               if i.code == "KEYWORD-EMPTY"]
    if caught3:
        print("  8 关键词护栏      ✔ 拦下了「keyword 策略但没关键词」")
    else:
        ok = False
        print("  8 关键词护栏      ✗ 没拦下空关键词")

    # 9. 模块并入（骰子替换一条 + 并 7 条正则；备份底稿克隆一条）
    try:
        proj2 = scaffold.new_card("模块卡", dest=tmp, quiet=True,
                                  modules=["骰子", "备份"])
        spec2 = os.path.join(proj2, "source", "模块卡.spec.yaml")
        raw2 = M.yload(spec2)
        n_ent = len(raw2["library"]["entries"])
        n_re = len(raw2.get("regex_rules") or [])
        errs2 = [i for i in validate.validate_card(pack.spec_to_card(spec2), "模块卡")
                 if i.level == "ERROR"]
        if n_ent >= 5 and n_re >= 7 and not errs2:
            print("  9 模块并入        ✔ 骰子+备份 -> 条目 %d 条 / 正则 %d 条 / 0 错误"
                  % (n_ent, n_re))
        else:
            ok = False
            print("  9 模块并入        ✗ 条目 %d / 正则 %d / 错误 %d"
                  % (n_ent, n_re, len(errs2)))
    except Exception as exc:
        ok = False
        spec2 = None
        print("  9 模块并入        ✗ %s" % exc)

    # 10. 手册与索引
    try:
        html_path = os.path.join(tmp, "手册.html")
        manual.build_manual(spec2 or spec, html_path, out=lambda *a: None)
        text = open(html_path, "r", encoding="utf-8").read()
        paired = text.count("<details>") == text.count("</details>") and \
            text.count("<section") == text.count("</section>")
        idx_path = manual.build_index(spec2 or spec,
                                      os.path.join(tmp, "索引.md"), out=lambda *a: None)
        if paired and os.path.getsize(idx_path) > 200:
            print("  10 手册与索引      ✔ 手册 %d KB（%d 个条目块）+ 索引 %d 字节"
                  % (len(text) // 1024, text.count("<details>"),
                     os.path.getsize(idx_path)))
        else:
            ok = False
            print("  10 手册与索引      ✗ 标签不配对或索引为空")
    except Exception as exc:
        ok = False
        print("  10 手册与索引      ✗ %s" % exc)

    # 11. 酒馆 V2 卡 -> ElecKoi
    st_path = os.path.join(tmp, "st.json")
    with open(st_path, "w", encoding="utf-8") as f:
        json.dump({
            "spec": "chara_card_v2", "spec_version": "2.0",
            "data": {
                "name": "自检酒馆卡",
                "description": "这是一张自检用的酒馆卡。",
                "first_mes": "你好。",
                "alternate_greetings": ["另一个开场。"],
                "tags": ["自检"],
                "character_book": {"entries": [
                    {"name": "条目一", "keys": ["测试"], "content": "关键词条目。",
                     "constant": False, "enabled": True, "insertion_order": 1},
                    {"name": "条目二", "keys": [], "content": "常驻条目。",
                     "constant": True, "enabled": True, "insertion_order": 2},
                ]},
            },
        }, f, ensure_ascii=False)
    try:
        sp3 = os.path.join(tmp, "st.spec.yaml")
        bridge.to_eleckoi(st_path, sp3, out=lambda *a: None)
        errs3 = [i for i in validate.validate_card(pack.spec_to_card(sp3), "自检酒馆卡")
                 if i.level == "ERROR"]
        if not errs3:
            print("  11 酒馆卡转换      ✔ 酒馆 V2 -> ElecKoi，0 错误")
        else:
            ok = False
            print("  11 酒馆卡转换      ✗ %d 个错误" % len(errs3))
    except Exception as exc:
        ok = False
        print("  11 酒馆卡转换      ✗ %s" % exc)

    # 12. ElecKoi -> 酒馆 -> ElecKoi（无损往返）
    try:
        back = os.path.join(tmp, "back.json")
        export.to_tavern(card_path, back, out=lambda *a: None)
        sp4 = os.path.join(tmp, "back.spec.yaml")
        bridge.to_eleckoi(back, sp4, out=lambda *a: None)
        card4 = pack.spec_to_card(sp4)
        if _canon_pair(card2, card4):
            print("  12 往返无损        ✔ ElecKoi -> 酒馆 -> ElecKoi，语义不变")
        else:
            ok = False
            print("  12 往返无损        ✗ 转一圈之后语义变了")
    except Exception as exc:
        ok = False
        print("  12 往返无损        ✗ %s" % exc)

    # 13. 界面层：组装真的产出了东西，且守规矩
    try:
        prev = os.path.join(proj, "预览.html")
        raw3 = M.yload(spec)
        n_re3 = len(raw3.get("regex_rules") or [])
        hud_errs = [i for i in validate.validate_hud(proj) if i.level == "ERROR"]
        if os.path.isfile(prev) and n_re3 >= 2 and not hud_errs:
            print("  13 界面组装        ✔ 预览.html %d KB · 写回 %d 条正则 · 界面守则 0 错"
                  % (os.path.getsize(prev) // 1024, n_re3))
        else:
            ok = False
            print("  13 界面组装        ✗ 预览页=%s 正则=%d 守则错=%d"
                  % (os.path.isfile(prev), n_re3, len(hud_errs)))
    except Exception as exc:
        ok = False
        print("  13 界面组装        ✗ %s" % exc)

    # 14. 界面守则（负向）：模块 CSS 漏了 .hud 前缀，必须被拦下
    try:
        proj2b = os.path.join(tmp, "模块卡")
        css = os.path.join(proj2b, "hud", "模块", "备份", "备份.css")
        text = open(css, encoding="utf-8").read()
        with open(css, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\nbody { color: red; }\n.mine-x { color: blue; }\n")
        caught14 = [i for i in validate.validate_hud(proj2b) if i.code == "HUD-CSS-PREFIX"]
        if caught14:
            print("  14 界面守则        ✔ 拦下了模块 CSS 里 %d 处漏前缀的选择器" % len(caught14))
        else:
            ok = False
            print("  14 界面守则        ✗ 没拦下漏前缀的裸选择器")
    except Exception as exc:
        ok = False
        print("  14 界面守则        ✗ %s" % exc)

    # 15. 变量三处同步（负向）：initial_state 少一个对象，必须被拦下
    try:
        raw5 = M.yload(spec)
        raw5["variables"]["initial_state"].pop("存档", None)
        bad5 = os.path.join(tmp, "同步.spec.yaml")
        M.ydump(raw5, bad5)
        caught15 = [i for i in validate.validate_card(pack.spec_to_card(bad5), "同步样本")
                    if i.code.startswith("VAR-SYNC")]
        if caught15:
            print("  15 变量三处同步    ✔ 拦下了「initial_state 少一个对象」（%d 处）"
                  % len(caught15))
        else:
            ok = False
            print("  15 变量三处同步    ✗ 没拦下变量不同步")
    except Exception as exc:
        ok = False
        print("  15 变量三处同步    ✗ %s" % exc)

    # 16. 打包分发
    try:
        from forge import bundle as BUNDLE
        z = BUNDLE.run(os.path.join(tmp, "模块卡"), out=os.path.join(tmp, "包.zip"),
                       out_print=lambda *a: None)
        with zipfile.ZipFile(z) as zf:
            names = zf.namelist()
        has = all(any(n.endswith(s) for n in names)
                  for s in ("spec.yaml", "hud.core.js", "test_core.js", ".card.json"))
        if has and len(names) >= 8:
            print("  16 打包分发        ✔ %d 个文件进包（含内容层 / 界面层 / 成品 / 测试）"
                  % len(names))
        else:
            ok = False
            print("  16 打包分发        ✗ 包里少了东西（%d 个文件）" % len(names))
    except Exception as exc:
        ok = False
        print("  16 打包分发        ✗ %s" % exc)

    # 17. 撤模块：接上再撤，必须回到没接过的那一份（账本清空、界面目录删掉）
    try:
        proj3 = scaffold.new_card("撤模块卡", dest=tmp, quiet=True)
        spec3 = os.path.join(proj3, "source", "撤模块卡.spec.yaml")
        before = _fresh_snapshot(spec3)
        mods.apply_modules(spec3, ["骰子", "备份"], project=proj3, out=lambda *a: None)
        mid = _fresh_snapshot(spec3)
        # 撤之前先组装一次，让模块的脚本落进 hud/模块/
        HUD.build(proj3, write_back=True, out=lambda *a: None)
        mods.drop_modules(spec3, ["骰子", "备份"], project=proj3, out=lambda *a: None)
        after = _fresh_snapshot(spec3)
        led = mods.load_ledger(proj3).get("模块") or {}
        hud_gone = not os.path.isdir(os.path.join(proj3, "hud", "模块", "备份"))
        if mid != before and after == before and not led and hud_gone:
            print("  17 撤模块          ✔ 接上（%d -> %d 条）再撤，回到原样；账本清空"
                  % (before["条目"], mid["条目"]))
        else:
            ok = False
            print("  17 撤模块          ✗ 接=%s 撤=%s 原样=%s 账本=%d 界面残留=%s"
                  % (mid != before, after == before, before, len(led), not hud_gone))
    except Exception as exc:
        ok = False
        print("  17 撤模块          ✗ %s" % exc)

    # 18. 换皮肤：只动颜色槽，核心样式一个字不动
    try:
        theme_pick = "墨夜"
        # 比对的是「这个工程」的核心样式前后 —— 不是跟骨架比：
        # 建卡时会做一轮换名（骨架 -> 卡名），抄过来的 hud.css 本来就有一处不同。
        core_path = os.path.join(proj3, "hud", "hud.css")
        before_core = open(core_path, encoding="utf-8").read()
        THEME.apply_theme(theme_pick, proj3, out=lambda *a: None)
        HUD.build(proj3, write_back=True, out=lambda *a: None)
        core_after = open(core_path, encoding="utf-8").read()
        css_path = os.path.join(proj3, "hud", "主题.css")
        doc = open(os.path.join(proj3, "hud", "out", "view_create.html"),
                   encoding="utf-8").read()
        page = open(os.path.join(proj3, "预览.html"), encoding="utf-8").read()
        slot_ok = "--hud-ink: #e6dccb" in doc          # 主题真的注进去了
        core_same = core_after == before_core          # 核心没被改
        page_ok = "#0b0a08" in page                    # 预览页外壳也跟着换
        if os.path.isfile(css_path) and slot_ok and core_same and page_ok:
            print("  18 换皮肤          ✔ %s：槽进页面 · 核心样式未改 · 预览页跟着换"
                  % theme_pick)
        else:
            ok = False
            print("  18 换皮肤          ✗ 主题文件=%s 注入=%s 核心未改=%s 预览=%s"
                  % (os.path.isfile(css_path), slot_ok, core_same, page_ok))
    except Exception as exc:
        ok = False
        print("  18 换皮肤          ✗ %s" % exc)

    # 19. 主题写错槽（负向）：核心不认识的槽必须当场停，不许静默不生效
    try:
        try:
            THEME.render_css({"名": "坏主题", "变量": {"--hud-不存在的槽": "#fff"}})
            caught19 = False
        except THEME.ThemeError:
            caught19 = True
        if caught19:
            print("  19 主题护栏        ✔ 拦下了核心不认识的槽（那种错会静默不生效）")
        else:
            ok = False
            print("  19 主题护栏        ✗ 没拦下写错的槽")
    except Exception as exc:
        ok = False
        print("  19 主题护栏        ✗ %s" % exc)

    # 20. 可读性体检（负向）：浅灰字压浅底，必须被判成「看不清」
    try:
        bad_theme = {"名": "雾里看花", "变量": {
            "--hud-ink": "#c9c5bd", "--hud-ink-2": "#d5d1c9",
            "--hud-dim": "#dedbd4", "--hud-paper-solid": "rgba(250, 248, 242, 0.93)"}}
        rep = THEME.contrast_report(bad_theme)
        poor = [k for k, v in rep.items() if not v["够"]]
        good = all(v["够"] for v in THEME.contrast_report(THEME.find_theme("羊皮卷")).values())
        if len(poor) == 3 and good:
            print("  20 可读性体检      ✔ 浅灰压浅底被判成看不清；自带五套全部达标")
        else:
            ok = False
            print("  20 可读性体检      ✗ 判出 %d 处不达标 / 自带主题达标=%s" % (len(poor), good))
    except Exception as exc:
        ok = False
        print("  20 可读性体检      ✗ %s" % exc)

    # 22. 分发往返：打包 -> 收包 -> 语义一致；恶意包必须整包拒收
    try:
        from forge import bundle as BUNDLE, dist as DIST
        pack_zip = BUNDLE.run(proj, out=os.path.join(tmp, "自检卡.工程包.zip"),
                              out_print=lambda *a: None)
        got = DIST.import_pack(pack_zip, os.path.join(tmp, "收到的"),
                               out=lambda *a: None)
        man = DIST.read_manifest(pack_zip)
        back_spec = os.path.join(got, "source", "自检卡.spec.yaml")
        same = os.path.isfile(back_spec) and _canon_pair(
            M.yload(spec), M.yload(back_spec))

        evil = os.path.join(tmp, "恶意包.zip")
        with zipfile.ZipFile(evil, "w") as zf:
            zf.writestr("卡/../../forge_逃逸自检.txt", "x")
            zf.writestr("卡/source/x.spec.yaml", "x")
        refused = False
        try:
            DIST.import_pack(evil, tmp, out=lambda *a: None)
        except DIST.DistError:
            refused = True
        escaped = os.path.exists(os.path.join(tmp, "..", "forge_逃逸自检.txt"))

        if man and same and refused and not escaped:
            print("  22 分发往返        ✔ 包 %d 条清单 · 收回来语义一致 · 恶意包被拒"
                  % len(man.get("清单") or {}))
        else:
            ok = False
            print("  22 分发往返        ✗ 清单=%s 语义一致=%s 拒恶意=%s 未逃逸=%s"
                  % (bool(man), same, refused, not escaped))
    except Exception as exc:
        ok = False
        print("  22 分发往返        ✗ %s" % exc)

    # 23. 皮肤出入：卡上那份配色导得出去、回得来；坏槽必须当场停
    try:
        THEME.apply_theme("朱砂", proj, out=lambda *a: None)
        exp = THEME.export_theme(proj, out_path=os.path.join(tmp, "自检皮肤.json"),
                                 name="自检皮肤", out=lambda *a: None)
        THEME.clear_theme(proj, out=lambda *a: None)
        cleared = THEME.current(proj).startswith("核心默认")
        THEME.import_theme(exp, proj, out=lambda *a: None)
        css = open(os.path.join(proj, "hud", "主题.css"), encoding="utf-8").read()
        back_ok = ("--hud-accent" in css and THEME.current(proj) == "自检皮肤")

        bad = os.path.join(tmp, "坏皮肤.json")
        with open(bad, "w", encoding="utf-8") as f:
            json.dump({"名": "坏", "变量": {"--hud-没有这个槽": "#fff"}}, f)
        stopped = False
        try:
            THEME.import_theme(bad, proj, out=lambda *a: None)
        except THEME.ThemeError:
            stopped = True

        if back_ok and cleared and stopped:
            print("  23 皮肤出入        ✔ 导出/导入往返一致 · 撤得干净 · 坏槽被拦")
        else:
            ok = False
            print("  23 皮肤出入        ✗ 往返=%s 撤回=%s 坏槽被拦=%s"
                  % (back_ok, cleared, stopped))
    except Exception as exc:
        ok = False
        print("  23 皮肤出入        ✗ %s" % exc)

    # 24. Zod 保形：解析 -> 生成 -> 再解析必须一致，手写的约束不许被抹掉；
    #     认不出的形状必须当场拒绝（负向）
    try:
        from forge import zod as ZOD
        code = (M.yload(spec).get("variables") or {}).get("schema_code") or ""
        once = ZOD.emit(ZOD.parse(code))
        稳 = ZOD.roundtrip_ok(code) and once == ZOD.emit(ZOD.parse(once))
        保住 = "z.number().int().min(1).max(20)" in once      # 手写的约束
        拦住 = 0
        for bad in ("z.string()",                                   # 顶层不是 object
                    "z.object({ a: z.string() }).passthrough()",     # 后面带后缀
                    "z.object({ a b })"):                            # 切错了（缺冒号）
            try:
                ZOD.parse(bad)
            except ZOD.ZodError:
                拦住 += 1
        if 稳 and 保住 and 拦住 == 3:
            print("  24 Zod 保形        ✔ 往返一致 · 手写的 .min().max() 保住 · 三种怪形状被拒")
        else:
            ok = False
            print("  24 Zod 保形        ✗ 稳定=%s 约束保住=%s 拒了 %d/3"
                  % (稳, 保住, 拦住))
    except Exception as exc:
        ok = False
        print("  24 Zod 保形        ✗ %s" % exc)

    # 25. 内容增删：条目 / 分组 / 对象 / 变量 / 正则 加得上、删得进回收站、
    #     放回去能回到原样；错模板、错分组、重名都要被拦（负向）
    try:
        from forge import content as CONTENT
        _P = lambda *a: None                                        # noqa: E731
        # 数「这一项自己新增了几条记录」而不是总数 —— 同一份 spec 上前面几项
        # （比如前面几项）也会留下记录，总数不该由这一项来断言。
        起始回收 = len(CONTENT.list_trash(spec))
        前 = CONTENT.stats(spec)
        CONTENT.add_group(spec, "自检组", out=_P)
        e = CONTENT.add_entry(spec, "自检 · 新条目", 分组="自检组", 模板="关键词",
                              正文="占位", 关键词=["自检"], out=_P)
        CONTENT.add_object(spec, "自检对象", out=_P)
        v = CONTENT.add_variable(spec, "自检对象", "计数", "number", 7, out=_P)
        r = CONTENT.add_regex(spec, "自检正则", "/〔自检〕/g", "<b>$1</b>", out=_P)
        加完 = CONTENT.stats(spec)
        加齐 = (加完["条目"] == 前["条目"] + 1 and 加完["分组"] == 前["分组"] + 1
                and 加完["对象"] == 前["对象"] + 1 and 加完["变量"] == 前["变量"] + 1
                and 加完["正则"] == 前["正则"] + 1)

        拦 = 0
        for fn in (lambda: CONTENT.add_entry(spec, "没关键词", 模板="关键词", out=_P),
                   lambda: CONTENT.add_entry(spec, "错组", 分组="没这个组", out=_P),
                   lambda: CONTENT.add_entry(spec, "错模板", 模板="乱写", out=_P),
                   lambda: CONTENT.add_group(spec, "自检组", out=_P)):
            try:
                fn()
            except CONTENT.ContentError:
                拦 += 1

        CONTENT.del_entry(spec, e["id"], out=_P)
        CONTENT.del_variable(spec, v["id"], out=_P)
        CONTENT.del_regex(spec, r["id"], out=_P)
        CONTENT.del_object(spec, "自检对象", out=_P)
        CONTENT.del_group(spec, "自检组", out=_P)
        撤完 = CONTENT.stats(spec)
        回收站 = len(CONTENT.list_trash(spec)) - 起始回收

        for rec in CONTENT.list_trash(spec):        # 逐条放回去
            CONTENT.restore(spec, rec["_文件"], out=_P)
        回来 = CONTENT.stats(spec)
        还原齐 = (回来 == 加完)
        条目回 = any(x["id"] == e["id"] for x in CONTENT.list_entries(spec))

        if 加齐 and 撤完 == 前 and 回收站 == 5 and 还原齐 and 条目回 and 拦 == 4:
            print("  25 内容增删        ✔ 五种都能加 · 撤完回到原样 · 五条记录放回去一字不差 · 四种错被拦")
        else:
            ok = False
            print("  25 内容增删        ✗ 加齐=%s 撤净=%s 回收站=%d 还原=%s 错被拦=%d/4"
                  % (加齐, 撤完 == 前, 回收站, 还原齐, 拦))
    except Exception as exc:
        ok = False
        print("  25 内容增删        ✗ %s" % exc)

    # 26. 变量三处同步：加一个变量三处一次写全、删一个三处一起撤；
    #     对象表与初值形状对不上时必须拒写，且 spec 一个字不动（负向）
    try:
        from forge import content as CONTENT, zod as ZOD
        _P = lambda *a: None                                        # noqa: E731
        vv = CONTENT.add_variable(spec, "玩家", "自检值", "number", 5, out=_P)
        raw = CONTENT.load(spec)
        v = raw["variables"]
        z = ZOD.parse(v["schema_code"])
        齐 = (v["initial_state"].get("玩家", {}).get("自检值") == 5
              and isinstance(z.kids.get("玩家"), ZOD.Obj)
              and z.kids["玩家"].kids.get("自检值") is not None
              and any(x.get("id") == vv["id"] for x in v["variables"]))
        CONTENT.del_variable(spec, vv["id"], out=_P)
        raw = CONTENT.load(spec)
        v = raw["variables"]
        z = ZOD.parse(v["schema_code"])
        净 = ("自检值" not in (v["initial_state"].get("玩家") or {})
              and "自检值" not in z.kids["玩家"].kids)

        # 造一个「列表对象」：对象挂在别人下面、名字和它唯一的变量同名、初值那边是平的
        raw = CONTENT.load(spec)
        v = raw["variables"]
        v["objects"].append(M.ordered({"id": "obj-check-bag", "name": "自检夹",
                                       "parent_id": "obj-player", "enabled": True,
                                       "description": "", "update_rule": "",
                                       "dynamic_key": False, "order": 99,
                                       "tree_view_order": 99,
                                       "created_at": M.now_iso(),
                                       "updated_at": M.now_iso()}, M.VAR_OBJECT_KEYS))
        v["variables"].append(M.ordered({"id": "variable-check-bag", "title": "自检夹",
                                         "object_id": "obj-check-bag", "enabled": True,
                                         "type": "array", "default_value": "[]",
                                         "description": "", "update_rule": "",
                                         "read_mode": "on_demand", "order": 99,
                                         "tree_view_order": 99,
                                         "created_at": M.now_iso(),
                                         "updated_at": M.now_iso()}, M.VAR_ITEM_KEYS))
        v["initial_state"]["玩家"]["自检夹"] = []
        M.ydump(raw, spec)
        前文 = open(spec, encoding="utf-8").read()
        拒 = False
        try:
            CONTENT.add_variable(spec, "自检夹", "重量", "number", 1, out=_P)
        except CONTENT.ContentError:
            拒 = True
        没动 = open(spec, encoding="utf-8").read() == 前文
        # 形状不一致时，删那一条仍要认得准（靠「存不存在」认位置）
        CONTENT.del_variable(spec, "自检夹", out=_P)
        raw = CONTENT.load(spec)
        删净 = ("自检夹" not in (raw["variables"]["initial_state"].get("玩家") or {})
                and "自检夹" not in ZOD.parse(raw["variables"]["schema_code"])
                .kids["玩家"].kids)

        if 齐 and 净 and 拒 and 没动 and 删净:
            print("  26 变量三处同步    ✔ 加一个三处齐 · 删一个三处净 · 形状对不上时拒写且一字不动")
        else:
            ok = False
            print("  26 变量三处同步    ✗ 加齐=%s 删净=%s 拒写=%s 没动=%s 删准=%s"
                  % (齐, 净, 拒, 没动, 删净))
    except Exception as exc:
        ok = False
        print("  26 变量三处同步    ✗ %s" % exc)

    # 27. 工程层：模块目录↔conf、账本↔现状、界面有没有写回、派生物过没过期。
    #     这几类错的共同点是**都不报错**（界面上安静地少一块、撤模块撤不回原样、
    #     交出去的成品还是老内容），所以只能靠查 —— 每条都要能查出来（负向），
    #     同时**模板源那种「本来就没成品」的工程一条都不许报**（防误报）。
    try:
        import shutil as _sh
        工 = os.path.join(tmp, "模块卡")                 # 接过模块、有成品的那种
        _地 = lambda: [i.code for i in validate.validate_project(工)]      # noqa: E731

        # (a) 干净的时候一条都不该有
        净 = not _地()

        # (b) 模块目录在、conf 没登记 —— 组装时根本不拼它
        os.makedirs(os.path.join(工, "hud", "模块", "野模块"), exist_ok=True)
        拦b = "PROJ-MOD-UNLISTED" in _地()

        # (c) conf 登记了、账本没记 —— `forge drop` 撤不掉
        conf_p = os.path.join(工, "hud", "hud.conf.json")
        conf = json.load(open(conf_p, encoding="utf-8"))
        conf.setdefault("模块", []).append("野模块")
        json.dump(conf, open(conf_p, "w", encoding="utf-8", newline="\n"),
                  ensure_ascii=False, indent=2)
        拦c = "PROJ-MOD-NO-LEDGER" in _地()

        # (d) 账本记着替换过的条目，spec 里被删了 —— 撤的时候撤不动
        led_p = os.path.join(工, "模块账本.json")
        led = json.load(open(led_p, encoding="utf-8"))
        for rec in (led.get("模块") or {}).values():
            rec.setdefault("条目", {}).setdefault("替换", []).append(
                {"id": "早就不在了", "title": "幽灵条目", "原": {}, "并入后": "x"})
            break
        json.dump(led, open(led_p, "w", encoding="utf-8", newline="\n"),
                  ensure_ascii=False, indent=2)
        拦d = "PROJ-LEDGER-GONE" in _地()

        # (e) 账本记的界面文件不见了
        _界 = None
        for rec in (led.get("模块") or {}).values():
            for rel in (rec.get("界面") or []):
                _界 = os.path.join(工, str(rel).replace("/", os.sep))
                break
            if _界:
                break
        if _界 and os.path.isfile(_界):
            os.remove(_界)
        拦e = bool(_界) and "PROJ-LEDGER-HUD" in _地()

        # (f) 界面没写回卡里：把 conf 那条正则换个名，spec 里就没有同名的了
        conf = json.load(open(conf_p, encoding="utf-8"))
        conf["正则"][0]["name"] = "改了个名 · 没人写回"
        json.dump(conf, open(conf_p, "w", encoding="utf-8", newline="\n"),
                  ensure_ascii=False, indent=2)
        拦f = "PROJ-HUD-UNWRITTEN" in _地()

        # (g) 成品比 spec 旧：把 spec 摸新
        sp_p = os.path.join(工, "source", "模块卡.spec.yaml")
        os.utime(sp_p, (time.time() + 60, time.time() + 60))
        拦g = "PROJ-STALE-CARD" in _地()

        # (h) 两张 spec 并存 —— 谁也不知道该用哪份
        _sh.copy(sp_p, os.path.join(工, "source", "第二张.spec.yaml"))
        拦h = "PROJ-MULTI-SPEC" in _地()

        # (i) 防误报：把成品拿走（变成「模板源」那样），界面没写回也不许报
        _sh.rmtree(os.path.join(工, "成品"), ignore_errors=True)
        os.remove(os.path.join(工, "source", "第二张.spec.yaml"))
        不报 = "PROJ-HUD-UNWRITTEN" not in _地()

        条 = [净, 拦b, 拦c, 拦d, 拦e, 拦f, 拦g, 拦h, 不报]
        if all(条):
            print("  27 工程自洽       ✔ 七种「不报错的错」都查得出；"
                  "模板源（没成品）不误报")
        else:
            ok = False
            print("  27 工程自洽       ✗ 净=%s 目录↔conf=%s 账本无记录=%s 幽灵条目=%s "
                  "账本界面=%s 没写回=%s 成品过期=%s 两份spec=%s 不误报=%s"
                  % tuple(条))
    except Exception as exc:
        ok = False
        print("  27 工程自洽       ✗ %s" % exc)

    # 28. 制卡向导：一份内容两个出口；出完自己必须是绿的
    #     验收：规程成篇、技能有 frontmatter、卡体检 0 错、条目齐、往返一致、
    #     并且它自己守着「常驻不超预算」这条规矩（教别人省，自己不能胖）。
    try:
        向导 = os.path.join(tmp, "向导")
        静 = lambda *a, **k: None                                   # noqa: E731
        r = COACH.出(向导, out=静)
        with open(r["规程"], encoding="utf-8") as f:
            规程字 = len(f.read())
        with open(r["技能"], encoding="utf-8") as f:
            有头 = f.read().startswith("---\n")
        向导卡 = M.jload(r["卡"])
        概 = validate.summarize(向导卡)
        卡错 = [i for i in validate.validate_card(向导卡, "向导卡") if i.level == "ERROR"]
        pack.unpack(r["卡"], os.path.join(向导, "回.yaml"))
        往返 = 向导卡 == pack.spec_to_card(os.path.join(向导, "回.yaml"))
        常驻 = _常驻字数(向导卡)
        条 = [规程字 > 5000, 有头, 概["entries"] >= 13, not 卡错, 往返, 常驻 <= 700]
        if all(条):
            print("  28 制卡向导       ✔ 规程 %d 字 / 卡 %d 条 0 错 / 往返一致 / 常驻 %d 字"
                  % (规程字, 概["entries"], 常驻))
        else:
            ok = False
            print("  28 制卡向导       ✗ 规程=%d字 技能头=%s 条目=%d 卡错=%d 往返=%s 常驻=%d字"
                  % (规程字, 有头, 概["entries"], len(卡错), 往返, 常驻))
    except Exception as exc:
        ok = False
        print("  28 制卡向导       ✗ %s" % exc)

    # 29. 规程与工具对得上 —— 规程会腐烂：工具加了命令、改了值域，规程还写着老样子。
    #     它是给 AI 的唯一依据；里面一句跑不通的命令，AI 就会照着撞一次墙。
    #     查四样：命令都在、模板名都在、类型名都在、该有的章节与要点都在。
    try:
        import re as _re
        规程 = COACH.规程正文()
        命令 = sorted({c for c in _re.findall(r"forge\.py\s+([a-z][a-z_-]*)", 规程)})
        野命令 = [c for c in 命令 if c not in COMMANDS]
        模板 = {m.strip() for m in _re.findall(r"--模板\s+([^\s\\|]+)", 规程)}
        野模板 = sorted(t for t in 模板 if t and t not in CONTENT.模板表)
        类型 = sorted(set(_re.findall(r"--类型\s+([A-Za-z]+)", 规程)))
        野类型 = [t for t in 类型 if t not in CONTENT.变量类型表]
        缺节 = [h for h in ["## %s、" % x for x in "一二三四五六七八九"] if h not in 规程]
        缺要点 = [名 for 名, 串 in (("零宽标记本身", "u200B{3}"),
                                    ("--改 命令", "--改"),
                                    ("--看 命令", "--看"),
                                    ("@文件 写法", "--正文@"),
                                    ("开场白那一节", "## 三、开场白"),
                                    ("收卡那一节", "## 二、手上已经有一张卡"),
                                    ("opener 命令", "forge.py opener"),
                                    ("--补齐", "--补齐"),
                                    ("开场白兜底断言", "HUD-OPENER-MARK"),
                                    ("analyze 命令", "forge.py analyze"),
                                    ("import 命令", "forge.py import"),
                                    ("to-eleckoi 命令", "forge.py to-eleckoi"),
                                    ("--从 接手（连界面层）", "new <卡名> --从"))
                  if 串 not in 规程]
        # 负向：规程不许再出现「手改 conf 改开场白」的老教法。
        # 规程会腐烂成**自相矛盾**——§三 说「用 opener，别手改」，§八 还抄着老写法，
        # AI 抄的是 §八。正面查「有没有 opener」拦不住这个，得反面查「还在不在教手改」。
        老教法 = [串 for 串 in ("hud/hud.conf.json 的「开场白",
                                "hud.conf.json 的「开场白.正文」",
                                "conf 里的开场白正文（末尾")
                  if 串 in 规程]
        # 门牌（SKILL.md）是另一份会被读的东西：它必须指向**真**规程、里面的命令也得是真的。
        # 它以前是手抄的副本，与生成物脱节过 —— 现在由 coach 生成，这里顺手钉住。
        门牌 = COACH.技能正文
        野门牌 = [c for c in sorted({c for c in _re.findall(r"forge\.py\s+([a-z][a-z_-]*)", 门牌)})
                 if c not in COMMANDS]
        门牌缺 = [串 for 串 in ("AI制卡规程.md", "forge.py", "guide", "cardforge")
                 if 串 not in 门牌]
        前言缺 = [串 for 串 in ("name: eleckoi-card-maker", "description:")
                 if 串 not in COACH.技能前言]
        缺 = (["命令不存在：%s" % "、".join(野命令)] if 野命令 else []) + \
             (["模板不在表里：%s" % "、".join(野模板)] if 野模板 else []) + \
             (["类型不在表里：%s" % "、".join(野类型)] if 野类型 else []) + \
             (["缺章节：%s" % "、".join(缺节)] if 缺节 else []) + \
             (["缺要点：%s" % "、".join(缺要点)] if 缺要点 else []) + \
             (["规程自相矛盾（还在教手改 conf）：%s" % "、".join(老教法)] if 老教法 else []) + \
             (["门牌里的命令不存在：%s" % "、".join(野门牌)] if 野门牌 else []) + \
             (["门牌缺指向或命令：%s" % "、".join(门牌缺)] if 门牌缺 else []) + \
             (["技能前言缺：%s" % "、".join(前言缺)] if 前言缺 else [])
        if not 缺:
            print("  29 规程与工具     ✔ %d 条命令 / %d 种模板 / %d 种类型全对得上，九节齐、无手改残留；"
                  "门牌指向正确" % (len(命令), len(模板), len(类型)))
        else:
            ok = False
            print("  29 规程与工具     ✗ %s" % "；".join(缺))
    except Exception as exc:
        ok = False
        print("  29 规程与工具     ✗ %s" % exc)

    # 30. 制卡读写回路 —— 「AI 顺畅改一张卡」的两个最短动作：
    #     先读它现在写了什么（--看），再把长正文写回去（--正文@文件）。
    #     缺了这两个，AI 就只能把整份 spec 整个吞进去找一段话，
    #     还得跟命令行转义打架（换行、引号在 shell 里是另一门手艺）。
    try:
        CONTENT.add_entry(spec, "自检 · 读写回路", 模板="关键词",
                          正文="第一版正文", 关键词=["回路"], out=_P)
        d = CONTENT.entry_detail(spec, "自检 · 读写回路")
        读回 = d["正文"] == "第一版正文" and d["关键词"] == ["回路"] and bool(d["id"])

        多行 = "第一行\n第二行\n\n第四行 \t 制表符 \"引号\" \\ 反斜杠 $ 符号"
        f = os.path.join(tmp, "正文.txt")
        with open(f, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(多行 + "\n")            # 编辑器习惯：末尾多一个换行，不算内容
        CONTENT.set_entry(spec, "自检 · 读写回路",
                          字段={"content": _读文("@" + f)}, out=_P)
        写回 = CONTENT.entry_detail(spec, "自检 · 读写回路")["正文"] == 多行
        粘写 = _opt(["x", "--正文@" + f], ("--正文",)) == 多行      # --正文@文件
        分写 = _opt(["x", "--正文", "@" + f], ("--正文",)) == 多行  # --正文 @文件

        拦下 = False
        try:
            _opt(["x", "--正文@并没有这个文件.txt"], ("--正文",))
        except ArgError:
            拦下 = True
        前 = open(spec, encoding="utf-8").read()
        CONTENT.entry_detail(spec, "自检 · 读写回路")
        没动 = open(spec, encoding="utf-8").read() == 前          # --看 是纯读

        条 = [读回, 写回, 粘写, 分写, 拦下, 没动]
        if all(条):
            print("  30 制卡读写回路   ✔ 读一条（正文/关键词/多行原样）· "
                  "长正文 @文件 两种写法 · 路径写错当场拦 · 读不改盘")
        else:
            ok = False
            print("  30 制卡读写回路   ✗ 读回=%s 写回=%s 粘写=%s 分写=%s 拦下=%s 没动=%s"
                  % tuple(条))
    except Exception as exc:
        ok = False
        print("  30 制卡读写回路   ✗ %s" % exc)

    # 31. 开场白：真源在 hud/hud.conf.json，spec 里那条只是派生物；末尾那三个
    #     零宽空格是「建卡界面」正则的开关 —— 少一个，导入 ElecKoi 后界面静默消失。
    #     这一项盯三件事：改一处不落下另一处、标记永远不多不少、
    #     坏输入（尖括号 / 空正文）一个字都不许落盘。
    try:
        d0 = OPENER.读(proj)
        初 = bool(d0["有开场白"]) and d0["标记数"] == 3 and d0["写回一致"] is True

        新文 = "深夜十一点四十分。\n\n你推开那扇门。\n\n（写下你的名字。）"
        r = OPENER.改正文(proj, 新文, 写回=True, out=_P)
        d1 = OPENER.读(proj)
        改好 = (d1["正文"] == 新文 + OPENER.标记 and d1["标记数"] == 3
                and d1["写回一致"] is True and r["写回"] is True)

        前 = open(d1["配置文件"], encoding="utf-8").read()
        拦尖 = 拦空 = False
        try:
            OPENER.改正文(proj, "你推开「<长夜>」的门。", 写回=False, out=_P)
        except OPENER.OpenerError:
            拦尖 = True
        try:
            OPENER.改正文(proj, "   ", 写回=False, out=_P)
        except OPENER.OpenerError:
            拦空 = True
        没动 = open(d1["配置文件"], encoding="utf-8").read() == 前

        # 标记被弄丢（手改 conf 最容易出的那种事）：读得出、写回被拒、能补齐
        conf_p = d1["配置文件"]
        with open(conf_p, encoding="utf-8") as fh:
            s = fh.read()
        with open(conf_p, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(s.replace("\\u200b\\u200b\\u200b", "\\u200b"))
        看出 = OPENER.读(proj)["标记数"] == 1
        拒写回 = False
        try:
            OPENER.写回(proj, out=_P)
        except OPENER.OpenerError:
            拒写回 = True
        OPENER.补齐(proj, out=_P)
        d2 = OPENER.读(proj)
        补齐 = d2["标记数"] == 3 and d2["写回一致"] is True
        # 写回去的标记要是**转义写法**（跟模板一致）—— 写成真字符就没法用眼睛看见了
        with open(conf_p, encoding="utf-8") as fh:
            转义写 = "\\u200b\\u200b\\u200b" in fh.read()
        回收 = any(rec.get("种类") == "开场白" for rec in CONTENT.list_trash(spec))

        条 = [初, 改好, 拦尖, 拦空, 没动, 看出, 拒写回, 补齐, 转义写, 回收]
        if all(条):
            print("  31 开场白         ✔ 改一处两处齐 · 标记永远正好 3 个（转义写法）· "
                  "尖括号/空正文不落盘 · 丢了能补齐 · 旧版进回收站")
        else:
            ok = False
            print("  31 开场白         ✗ 初始=%s 改=%s 尖=%s 空=%s 没动=%s 看出丢=%s "
                  "拒写回=%s 补齐=%s 转义=%s 回收站=%s" % tuple(条))
    except Exception as exc:
        ok = False
        print("  31 开场白         ✗ %s" % exc)

    # 32. 接手别人的卡 + 不许静默丢改动。
    #     盲跑挖出来的两组「不报错的错」，共同点是都在「照规程做」的路上：
    #       · 只有内容层的工程（import 进来的单张卡）原本**改不了开场白** —— opener 只认界面层、
    #         hud 不肯凭空造界面层、规程又让人别手改，最后只能手抠那三个零宽标记；
    #         而且 `entry --改` 会**把标记一起抹掉还不报**（实测过）。
    #       · 同一条 spec 上并发跑两条写命令：两条各自读到同一份旧内容、各自打印「已改…成功」，
    #         后落盘的那份赢，前一条**静默消失**。AI 一次并发下两条命令就会撞上。
    try:
        from forge import dist as DIST
        收 = os.path.join(tmp, "收卡")
        卡 = DIST.import_pack(card_path, 收, verify=True, out=_P)
        卡spec = os.path.join(卡, "source", "自检卡.spec.yaml")
        没界面 = not os.path.exists(os.path.join(卡, "hud", "hud.conf.json"))

        d = OPENER.读(卡)                        # 内容档：认得出，且说清真源在 spec
        认得出 = d["模式"] == "内容" and d["有开场白"] and bool(d["条目"])

        新 = "凌晨两点十七分，长夜便利店。\n\n自动门「叮」地合上。"
        OPENER.改正文(卡, 新, out=_P)
        d2 = OPENER.读(卡)
        lib = (M.yload(卡spec) or {}).get("library") or {}
        开场条 = [e for e in (lib.get("entries") or [])
                  if str(e.get("kind")) == "opening"][0]
        内容档 = (d2["正文"] == 新 + OPENER.标记 and d2["标记数"] == 3
                  and 开场条.get("content") == 新 + OPENER.标记)   # 落盘后读回逐字一致
        方案齐 = bool(开场条.get("opening_messages")) and \
            all(m.get("content") == 开场条.get("content")
                for m in (开场条.get("opening_messages") or []))

        拦改 = False                            # 开场白正文不走 --改（会静默抹掉标记）
        try:
            CONTENT.set_entry(卡spec, "AI角色开场白", {"content": "硬改"},
                              out=_P)
        except CONTENT.ContentError:
            拦改 = True

        raw = CONTENT.load(卡spec)              # 读了一份之后，文件被别人改过
        with open(卡spec, "a", encoding="utf-8") as fh:
            fh.write("\n")
        撞前 = open(卡spec, encoding="utf-8").read()
        拦并发 = False
        try:
            CONTENT.commit(卡spec, raw, out=_P)
        except CONTENT.ContentError:
            拦并发 = True
        一字不动 = open(卡spec, encoding="utf-8").read() == 撞前

        raw2 = CONTENT.load(卡spec)             # 反例：正常一读一写不许被误拦
        raw2.setdefault("character", {})["nickname"] = "守卫反例"
        try:
            CONTENT.commit(卡spec, raw2, out=_P)
            放行 = "守卫反例" in (M.yload(卡spec) or {}).get("character", {}).get("nickname", "")
        except CONTENT.ContentError:
            放行 = False

        条 = [没界面, 认得出, 内容档, 方案齐, 拦改, 拦并发, 一字不动, 放行]
        if all(条):
            print("  32 接手与守卫     ✔ 单卡收进来就能改开场白（内容档，标记自动齐、方案同步）· "
                  "entry --改 不许碰开场白正文 · 文件被抢改过就拒写且一字不动 · 正常读写不误拦")
        else:
            ok = False
            print("  32 接手与守卫     ✗ 没界面=%s 认得=%s 内容档=%s 方案齐=%s 拦改=%s "
                  "拦并发=%s 一字不动=%s 放行=%s" % tuple(条))
    except Exception as exc:
        ok = False
        print("  32 接手与守卫     ✗ %s" % exc)

    # 33. 接手一张现成的卡（`new --从`）：界面层照抄骨架，内容层用它的。
    #     「别人给了一张卡」以前是条死路 —— 单张卡收进来只有内容层，没有界面层，
    #     opener 不认、hud 不肯凭空造。这条命令就是那次缺的搬运。顺带守三个静默：
    #       · 非 ElecKoi 卡不许被 unpack「成功」成空工程（宽容解析会让它一路绿灯）；
    #       · 接手失败不许把半成品目录留在盘上（用户会当成建好了）；
    #       · 开场白不许被骨架那句顶掉（桥接曾把它只写进方案，条目正文空着）。
    try:
        SAMP = os.path.join(HERE, "samples")
        演示卡 = os.path.join(SAMP, "演示卡", "成品", "演示卡.card.json")
        酒馆卡 = os.path.join(SAMP, "示例·酒馆V2卡.json")
        演示doc = M.yload(os.path.join(SAMP, "演示卡", "source", "演示卡.spec.yaml")) or {}
        源场 = [e for e in 演示doc["library"]["entries"]
                if str(e.get("kind")) == "opening"][0]
        骨场 = [e for e in (M.yload(os.path.join(HERE, "assets", "骨架", "source",
                  "骨架.spec.yaml")) or {})["library"]["entries"]
                if str(e.get("kind")) == "opening"][0]
        净 = lambda t: str(t or "").replace("\u200b", "").strip()

        搬 = scaffold.new_card("自检搬运", dest=tmp, source=演示卡, quiet=True)
        搬doc = M.yload(os.path.join(搬, "source", "自检搬运.spec.yaml")) or {}
        搬场 = [e for e in 搬doc["library"]["entries"]
                if str(e.get("kind")) == "opening"][0]
        有界面 = os.path.isfile(os.path.join(搬, "hud", "hud.conf.json"))
        条数对 = len(搬doc["library"]["entries"]) == len(演示doc["library"]["entries"])
        开场对 = (净(搬场["content"]) == 净(源场["content"])
                  and 净(搬场["content"]) != 净(骨场["content"]))
        with open(os.path.join(搬, "hud", "hud.conf.json"), encoding="utf-8") as fh:
            conf = json.load(fh)
        两处齐 = (conf["开场白"]["正文"] == 搬场["content"]
                  and OPENER.尾标记数(搬场["content"]) == 3)

        酒 = scaffold.new_card("自检酒馆", dest=tmp, source=酒馆卡, quiet=True)
        酒doc = M.yload(os.path.join(酒, "source", "自检酒馆.spec.yaml")) or {}
        酒场 = [e for e in 酒doc["library"]["entries"]
                if str(e.get("kind")) == "opening"][0]
        桥接对 = bool(净(酒场["content"])) and 净(酒场["content"]) != 净(骨场["content"])

        拦非卡, 没留空 = False, False
        try:
            pack.unpack(酒馆卡, os.path.join(tmp, "不许出.yaml"))
        except Exception:
            拦非卡 = True
            没留空 = not os.path.exists(os.path.join(tmp, "不许出.yaml"))

        没残骸 = False
        try:
            scaffold.new_card("自检残骸", dest=tmp,
                              source=os.path.join(tmp, "并没有这张卡.json"), quiet=True)
        except Exception:
            没残骸 = not os.path.exists(os.path.join(tmp, "自检残骸"))

        坏 = M.yload(os.path.join(SAMP, "演示卡", "source", "演示卡.spec.yaml"))
        坏场 = [e for e in 坏["library"]["entries"]
                if str(e.get("kind")) == "opening"][0]
        坏p = os.path.join(tmp, "坏开场.spec.yaml")
        坏场["content"] = ""
        M.ydump(坏, 坏p)
        抓到空 = "OPENING-BLANK" in {i.code for i in
                                     validate.validate_card(pack.spec_to_card(坏p))}
        坏场["content"] = "与各方案都不一样的一段话"
        M.ydump(坏, 坏p)
        抓到漂 = "OPENING-DRIFT" in {i.code for i in
                                     validate.validate_card(pack.spec_to_card(坏p))}

        条 = [有界面, 条数对, 开场对, 两处齐, 桥接对, 拦非卡, 没留空, 没残骸, 抓到空, 抓到漂]
        if all(条):
            print("  33 接手搬运       ✔ 单卡 / 酒馆卡都能连界面层一起建 · 开场白取自来源"
                  "（不是骨架那句）· 非卡不许静默成空工程 · 失败不留残骸 · "
                  "开场白空/漂移查得出")
        else:
            ok = False
            print("  33 接手搬运       ✗ 界面=%s 条数=%s 开场=%s 两处齐=%s 桥接=%s "
                  "拦非卡=%s 没空工程=%s 没残骸=%s 抓到空=%s 抓到漂=%s" % tuple(条))
    except Exception as exc:
        ok = False
        print("  33 接手搬运       ✗ %s" % exc)

    # 34. 子命令 --help：问一句用法，必须给出**这条命令**的用法，而且一个字都不写盘
    #
    #  以前 `forge.py entry --help` 回的是总表，唯一线索是总表末行那句「去掉参数直接跑」——
    #  没人会去猜那句话，于是「查不到 entry 有哪些参数」成了盲跑里最费劲的一处。
    try:
        import subprocess
        探 = os.path.join(tmp, "_问用法")
        os.makedirs(探, exist_ok=True)
        前 = sorted(os.listdir(探))
        自文档 = {"domains", "mods"}       # 这两条没有参数，跑一遍本身就是它的文档
        坏, 写盘 = [], []
        for c in sorted(COMMANDS):
            r = subprocess.run([sys.executable, os.path.join(HERE, "forge.py"),
                                c, "--help"],
                               cwd=探, capture_output=True, text=True, timeout=120,
                               # ★ 必须点名 utf-8：子进程的输出被 forge.py 钉成 UTF-8，
                               # 而中文 Windows 的默认解码是 GBK ⇒ 读线程当场
                               # `UnicodeDecodeError: 'gbk' codec can't decode byte …`，
                               # 34 号项必红（而且报的是线程异常，看着像环境问题）。
                               encoding="utf-8", errors="replace")
            文 = (r.stdout or "") + (r.stderr or "")
            if not r.returncode == 0 or not (
                    c in 自文档 or ("forge.py %s" % c) in 文):
                坏.append(c)
        for f in sorted(os.listdir(探)):
            if f not in 前:
                写盘.append(f)
        if not 坏 and not 写盘:
            print("  34 子命令用法     ✔ %d 条命令的 --help 都给出自己的用法，且一条没写盘"
                  % len(COMMANDS))
        else:
            ok = False
            print("  34 子命令用法     ✗ 没给出用法的=%s · 写盘的=%s" % (坏, 写盘))
    except Exception as exc:
        ok = False
        print("  34 子命令用法     ✗ %s" % exc)

    # 35. 卡名与接管：`--从` 之后名字归新卡 · `name --改` 两处一起动 · 禁用条目看得见改得动
    try:
        样卡 = os.path.join(HERE, "samples", "示例·酒馆V2卡.json")
        proj2 = scaffold.new_card("接管卡", dest=tmp, quiet=True, source=样卡)
        spec2 = os.path.join(proj2, "source", "接管卡.spec.yaml")
        conf2 = os.path.join(proj2, "hud", "hud.conf.json")

        def _名():
            return str((M.yload(spec2).get("character") or {}).get("name") or "")

        def _界面名():
            return str((M.jload(conf2) or {}).get("卡名") or "")

        名归新 = (_名() == "接管卡" and _界面名() == "接管卡")
        无漂 = not [i for i in validate.validate_project(proj2)
                    if i.code == "PROJ-NAME-DRIFT"]
        禁 = [r for r in CONTENT.list_entries(spec2) if not r.get("启用", True)]
        看得见 = bool(禁)
        if 禁:
            CONTENT.set_entry(spec2, 禁[0]["标题"], 字段={"enabled": True},
                              out=lambda *a, **k: None)
        改得动 = not [r for r in CONTENT.list_entries(spec2) if not r.get("启用", True)]
        scaffold.改卡名(proj2, "改名卡", out=lambda *a, **k: None)
        两处齐 = (_名() == "改名卡" and _界面名() == "改名卡")
        CONTENT.restore(spec2, "1", out=lambda *a, **k: None)
        还原回 = (_名() == "接管卡" and _界面名() == "接管卡")
        条 = (名归新, 无漂, 看得见, 改得动, 两处齐, 还原回)
        if all(条):
            print("  35 卡名与接管     ✔ --从 后名字归新卡 · 没有卡名漂移 · 禁用条目列得出也"
                  "改得动 · name 改两处齐 · 回收站连界面配置一起还原")
        else:
            ok = False
            print("  35 卡名与接管     ✗ 名归新=%s 无漂=%s 看得见=%s 改得动=%s "
                  "两处齐=%s 还原=%s" % 条)
    except Exception as exc:
        ok = False
        print("  35 卡名与接管     ✗ %s" % exc)

    # 36. 变量改名：一次把三处一起挪（面板 / 初值那一格的键 / Zod 那个字段名），
    #     id 不动、顺序不动；撤销能把三处**逐字**还原回原样。
    try:
        proj3 = scaffold.new_card("改名台", dest=tmp, quiet=True)
        spec3 = os.path.join(proj3, "source", "改名台.spec.yaml")
        哑 = lambda *a, **k: None
        CONTENT.add_object(spec3, "面板", out=哑)
        CONTENT.add_variable(spec3, "面板", "声望", 类型="number", 初值=5, out=哑)

        def _片():
            v = M.yload(spec3).get("variables") or {}
            return (v.get("initial_state") or {}, str(v.get("schema_code") or ""))

        初 = _片()
        改前 = str(初[1])
        CONTENT.rename_variable(spec3, "面板.声望", "名望", out=哑)
        st, sc = _片()
        面板格 = (st.get("面板") or {})
        三处 = (面板格 == {"名望": 5} and "名望: z.number()" in sc
                and "声望" not in sc and "声望" not in 面板格)
        id没换 = [x for x in (CONTENT.load(spec3).get("variables") or {}).get("variables", [])
                  if x.get("title") == "名望" and str(x.get("id") or "").startswith("variable-")]
        顺序没乱 = sc == 改前.replace("声望", "名望")     # 只换了名字，别的字节一个没动

        CONTENT.rename_object(spec3, "面板", "状态板", out=哑)
        st, sc = _片()
        对象齐 = ("状态板" in st and "面板" not in st and "状态板: z.object" in sc)

        禁止重名 = False
        try:
            CONTENT.add_variable(spec3, "状态板", "名望", out=哑)
        except CONTENT.ContentError:
            禁止重名 = True

        CONTENT.restore(spec3, "1", out=哑)
        CONTENT.restore(spec3, "1", out=哑)
        st, sc = _片()
        撤得回 = (st.get("面板") == {"声望": 5} and sc == 改前)

        条 = (三处, bool(id没换), 顺序没乱, 对象齐, 禁止重名, 撤得回)
        if all(条):
            print("  36 变量改名       ✔ 三处一起挪（面板/初值/Zod）· id 不动 · 顺序没乱 · "
                  "对象改名同办 · 同层重名拦下 · 撤销逐字还原")
        else:
            ok = False
            print("  36 变量改名       ✗ 三处=%s id在=%s 顺序=%s 对象=%s 拦重名=%s 撤销=%s"
                  % 条)
    except Exception as exc:
        ok = False
        print("  36 变量改名       ✗ %s" % exc)

    # 37. 条目批量：一次落盘、一条回收记录 · 有认不出的名字就**整批停下**（半条最难收拾）
    #     · 删多条再还原，顺序 / 分组 / 启用状态都回得来。
    try:
        spec4 = os.path.join(proj3, "source", "改名台.spec.yaml")
        哑 = lambda *a, **k: None
        CONTENT.add_group(spec4, "甲组", out=哑)
        for t in ("甲一", "甲二", "甲三"):
            CONTENT.add_entry(spec4, t, 模板="关键词", 关键词="试", 正文="正文 %s" % t, out=哑)
        删前 = [r["标题"] for r in CONTENT.list_entries(spec4)]

        CONTENT.move_entries(spec4, ["甲一", "甲二", "甲三"], "甲组", out=哑)
        挪齐 = all(r["分组"] == "甲组"
                   for r in CONTENT.list_entries(spec4) if r["标题"].startswith("甲"))
        CONTENT.set_entries_enabled(spec4, ["甲一", "甲二"], False, out=哑)
        停齐 = [r["标题"] for r in CONTENT.list_entries(spec4) if not r.get("启用", True)] \
            == ["甲一", "甲二"]

        整批停 = False
        拦报错 = ""
        try:
            CONTENT.del_entries(spec4, ["甲一", "不存在的条目", "甲二"], out=哑)
        except CONTENT.ContentError as exc:
            整批停 = "不存在的条目" in str(exc)
            拦报错 = str(exc)
        没动它 = [r["标题"] for r in CONTENT.list_entries(spec4)] == 删前

        CONTENT.del_entries(spec4, ["甲一", "甲二", "甲三"], out=哑)
        真删了 = not [r for r in CONTENT.list_entries(spec4) if r["标题"].startswith("甲")]
        CONTENT.restore(spec4, "1", out=哑)
        栏 = {r["标题"]: r for r in CONTENT.list_entries(spec4)}
        回得来 = ([r["标题"] for r in CONTENT.list_entries(spec4)] == 删前
                  and 栏["甲一"]["分组"] == "甲组" and 栏["甲二"]["分组"] == "甲组"
                  and 栏["甲一"]["启用"] is False and 栏["甲二"]["启用"] is False)

        条 = (挪齐, 停齐, 整批停, 没动它, 真删了, 回得来)
        if all(条):
            print("  37 条目批量       ✔ 挪组/启停/删都一次落盘一条记录 · 认不出的名字整批停下"
                  "（一条没动）· 删掉再还原顺序/分组/启用状态全齐")
        else:
            ok = False
            print("  37 条目批量       ✗ 挪=%s 停=%s 整批停=%s 没动=%s 删=%s 还原=%s%s"
                  % (条 + (("｜%s" % 拦报错) if not 整批停 else "")))
    except Exception as exc:
        ok = False
        print("  37 条目批量       ✗ %s" % exc)

    # 38. 变量换对象：名字不动，挂靠 / 初值那格 / Zod 那个字段 / 排序**一起搬**，
    #     id 不动；撤销能把这几处**逐字**还原。同对象 / 没这个对象 / 新层重名都拦。
    try:
        spec5 = spec4
        哑 = lambda *a, **k: None
        CONTENT.add_object(spec5, "乙", out=哑)
        CONTENT.add_variable(spec5, "乙", "金锭", 类型="number", 初值=3, out=哑)
        CONTENT.add_object(spec5, "甲", out=哑)

        def _变量(名):
            return [x for x in (CONTENT.load(spec5).get("variables") or {})
                    .get("variables", []) if x.get("title") == 名]

        def _对象id(名):
            return [o.get("id") for o in (CONTENT.load(spec5).get("variables") or {})
                    .get("objects", []) if o.get("name") == 名]

        def _片5():
            v = M.yload(spec5).get("variables") or {}
            return (v.get("initial_state") or {}, str(v.get("schema_code") or ""))

        改前5 = _片5()
        id前 = str(_变量("声望")[0].get("id"))

        拦同对象 = 拦没对象 = False
        try:
            CONTENT.move_variable(spec5, "面板.声望", "面板", out=哑)
        except CONTENT.ContentError:
            拦同对象 = True
        try:
            CONTENT.move_variable(spec5, "面板.声望", "没有这个对象", out=哑)
        except CONTENT.ContentError:
            拦没对象 = True
        没动 = _片5() == 改前5          # 两次拦截都不许落盘

        CONTENT.move_variable(spec5, "面板.声望", "甲", out=哑)
        st, sc = _片5()
        挂齐 = (str(_变量("声望")[0].get("object_id")) == str(_对象id("甲")[0])
               and str(_变量("声望")[0].get("id")) == id前)
        状态齐 = ((st.get("甲") or {}) == {"声望": 5}
                 and "声望" not in (st.get("面板") or {}))
        紧凑 = sc.replace(" ", "").replace("\n", "")
        zod齐 = "甲:z.object({声望:z.number()})" in 紧凑
        顺序齐 = _变量("声望")[0].get("order") == 1      # 甲下本来没变量，排到末尾 = 1

        CONTENT.restore(spec5, "1", out=哑)
        撤得回5 = _片5() == 改前5

        CONTENT.add_variable(spec5, "乙", "声望", 类型="number", 初值=9, out=哑)
        拦重名 = False
        try:
            CONTENT.move_variable(spec5, "面板.声望", "乙", out=哑)
        except CONTENT.ContentError:
            拦重名 = True

        条 = (拦同对象, 拦没对象, 没动, 挂齐, 状态齐, zod齐, 顺序齐, 撤得回5, 拦重名)
        if all(条):
            print("  38 变量换对象     ✔ 挂靠/初值那格/Zod 那个字段/排序一起搬 · id 不动 · "
                  "同对象与缺对象当场拦（不落盘）· 新层重名拦下 · 撤销逐字还原")
        else:
            ok = False
            print("  38 变量换对象     ✗ 拦同=%s 拦无=%s 没动=%s 挂=%s 态=%s Zod=%s 序=%s 撤=%s 重名=%s"
                  % 条)
    except Exception as exc:
        ok = False
        print("  38 变量换对象     ✗ %s" % exc)

    # 41. 条目复制：一次能复制一串（副本**顺在原件后面** · 默认「原名（副本）」· 内容原样 ·
    #     id 全新）· `--到 分组` 能让副本直接落进那个组、不给就跟着原件 ·
    #     认不出的名字整批停下 · 开场白条目不许复制（一张卡只有一条）。
    try:
        spec6 = spec4
        哑 = lambda *a, **k: None
        CONTENT.add_group(spec6, "复组", out=哑)
        for t in ("复一", "复二"):
            CONTENT.add_entry(spec6, t, 模板="关键词", 关键词="试", 正文="正文 %s" % t, out=哑)
        底 = len(CONTENT.list_entries(spec6))

        CONTENT.dup_entries(spec6, ["复一", "复二"], 到="复组", out=哑)
        列 = CONTENT.list_entries(spec6)
        名 = [r["标题"] for r in 列]
        栏 = {r["标题"]: r for r in 列}
        复制齐 = (len(列) == 底 + 2
                  and "复一（副本）" in 栏 and "复二（副本）" in 栏
                  and 栏["复一（副本）"]["分组"] == "复组"
                  and 栏["复二（副本）"]["分组"] == "复组"
                  and 名.index("复一（副本）") == 名.index("复一") + 1
                  and 名.index("复二（副本）") == 名.index("复二") + 1
                  and 栏["复一（副本）"]["字数"] == 栏["复一"]["字数"]
                  and len({r["id"] for r in 列}) == len(列))

        # 不给 --到：副本跟着原件待在同一个组（原件在未分组，副本也在未分组）
        CONTENT.dup_entries(spec6, ["复一"], 标题="复一·另一版", out=哑)
        栏2 = {r["标题"]: r for r in CONTENT.list_entries(spec6)}
        跟原件 = (栏2["复一·另一版"]["分组"] == 栏2["复一"]["分组"]
                and 栏2["复一"]["分组"] != "复组")

        # 认不出的名字：整批停下，一条副本都不加
        停 = len(CONTENT.list_entries(spec6))
        整批停41 = False
        try:
            CONTENT.dup_entries(spec6, ["复一", "根本没有这条"], out=哑)
        except CONTENT.ContentError as exc:
            整批停41 = "根本没有这条" in str(exc)
        没多 = len(CONTENT.list_entries(spec6)) == 停

        # 开场白不许复制
        拦开场 = False
        try:
            CONTENT.dup_entries(spec6, ["AI角色开场白"], out=哑)
        except CONTENT.ContentError as exc:
            拦开场 = "开场白" in str(exc)

        条41 = (复制齐, 跟原件, 整批停41, 没多, 拦开场)
        if all(条41):
            print("  41 条目复制       ✔ 一次复制一串（副本顺在原件后面 · 内容原样 · id 全新）"
                  "· --到 分组 能让副本落进那个组 · 认不出的名字整批停下 · 开场白不许复制")
        else:
            ok = False
            print("  41 条目复制       ✗ 复制齐=%s 跟原件=%s 整批停=%s 没多=%s 拦开场=%s"
                  % 条41)
    except Exception as exc:
        ok = False
        print("  41 条目复制       ✗ %s" % exc)

    # 42. 沙箱友好模式：把 os.replace / os.remove / shutil.rmtree 全换成炸弹
    #     （模拟受限令牌沙箱里的 WinError 5），再把「开新卡 → 加条目 → 出成品 → 验卡」
    #     整条走一遍。**全程一次都不许碰到那三个** —— 碰到，就说明还有地方在依赖「删 / 改名」，
    #     而那条路（ElecKoi 里的 AI 直接跑 forge.py）会在那一步挂掉。
    try:
        import shutil as _sh2
        沙箱根 = os.path.join(tmp, "沙箱试")
        os.makedirs(沙箱根, exist_ok=True)
        _真三件 = (os.replace, os.remove, _sh2.rmtree)

        def _炸弹(*a, **k):
            raise PermissionError(5, "沙箱拒绝：不许删、不许改名")

        SB.enable(True)
        os.replace, os.remove, _sh2.rmtree = _炸弹, _炸弹, _炸弹
        try:
            哑42 = lambda *a, **k: None
            proj2 = scaffold.new_card("沙箱卡", dest=沙箱根, quiet=True)
            spec2 = os.path.join(proj2, "source", "沙箱卡.spec.yaml")
            CONTENT.add_entry(spec2, "沙箱条目", 模板="关键词",
                              正文="沙箱里写下的正文", 关键词=["沙箱"], out=哑42)
            card2 = os.path.join(proj2, "成品", "沙箱卡.card.json")
            pack.build(spec2, card2)
            沙箱错 = [i for i in validate.validate_card(M.jload(card2), "沙箱")
                     if i.level == "ERROR"]
            正文回 = CONTENT.entry_detail(spec2, "沙箱条目")["正文"]
            过沙箱 = (正文回 == "沙箱里写下的正文" and not 沙箱错)
        finally:
            os.replace, os.remove, _sh2.rmtree = _真三件
            SB.enable(False)
        if 过沙箱:
            print("  42 沙箱友好模式    ✔ 不许删 / 不许改名时：开新卡 + 加条目 + 出成品"
                  " 全程用不到 os.replace / os.remove / rmtree")
        else:
            ok = False
            print("  42 沙箱友好模式    ✗ 正文回读=%r 卡片错误=%d"
                  % (正文回, len(沙箱错)))
    except Exception as exc:
        ok = False
        print("  42 沙箱友好模式    ✗ %s" % exc)

    # 43. 规程取节：目录里列出的**每一节 / 每一篇 / 每一对话段**都要能真取到、且不是空的。
    #     这是给 ElecKoi 里的 AI 自己取知识用的（`guide`）—— 目录说有的、取不到，
    #     AI 只会以为规程就这么多，然后照着半份知识做卡。**静默地少给**是最坏的一种错。
    #     负向两侧：认不出的名字要拦；撞名的（两篇同前缀）要报「不止一个」而不是挑一个。
    try:
        取错43, 取空43 = [], []
        for 标题, _ in COACH._规程段():
            try:
                if len(COACH.取节(标题)) <= len(标题):
                    取空43.append("节 " + 标题)
            except KeyError:
                取错43.append("节 " + 标题)
        for 标题 in COACH.方法论:
            try:
                if len(COACH.取篇(标题)) <= len(标题):
                    取空43.append("篇 " + 标题)
            except KeyError:
                取错43.append("篇 " + 标题)
        for 标题 in COACH.对话段:
            try:
                if len(COACH.取对话(标题)) <= len(标题):
                    取空43.append("段 " + 标题)
            except KeyError:
                取错43.append("段 " + 标题)
        拦了43 = 0
        for 怪名 in ("第四十节", "这一节不存在"):
            try:
                COACH.取节(怪名)
            except KeyError:
                拦了43 += 1
        try:
            COACH.取篇("机制")            # 方法论里两篇同前缀：要报「不止一个」，不许挑
        except KeyError:
            拦了43 += 1
        目录43 = COACH.目录()
        有头43 = all(k in 目录43 for k in ("## 节", "## 篇", "## 对话段"))
        if not 取错43 and not 取空43 and 拦了43 == 3 and 有头43:
            print("  43 规程取节       ✔ 目录里每一节/每一篇/每一对话段都真取得到；"
                  "认不出的名字与撞名的都当场拦")
        else:
            ok = False
            print("  43 规程取节       ✗ 取不到=%s 取空=%s 该拦的只拦了%d/3 目录有头=%s"
                  % (取错43, 取空43, 拦了43, 有头43))
    except Exception as exc:
        ok = False
        print("  43 规程取节       ✗ %s" % exc)

    # 44. 卡稿落卡：一份稿子 -> 一张卡。
    #     盯的是「一次落成」的三条命根子：
    #       · 改 / 建 / 删 都对（同名即改、无名即建、说删就删，清空只清没提到的）
    #       · 稿子有毛病时**目标位置一个字都不写** —— 这是这个命令存在的理由
    #       · 目标已有工程（不给 --覆盖）与别人的目录（给了也不给）都不许乱盖
    #     顺带钉住「落出来的卡真能过体检」与「开场白末尾那三个零宽标记跟着走完这一趟」——
    #     落得成但卡是坏的、或者建卡界面悄悄不见了，都等于没落。
    try:
        from forge import draft as _D44
        根44 = tempfile.mkdtemp(prefix="forge_st44_")
        稿44 = os.path.join(根44, "稿.yaml")
        M.ydump({
            "卡名": "自检卡44",
            "清空条目": True,
            "分组": ["甲组"],
            "条目": [
                {"标题": "核心 · 世界总纲", "正文": "改过的总纲"},            # 骨架有 -> 改
                {"标题": "甲组 · 一条", "模板": "关键词", "分组": "甲组",      # 没有 -> 建
                 "关键词": ["甲", "乙"], "提示": "问起甲乙时读这条", "正文": "……"},
            ],
            "变量": [{"对象": "玩家", "名": "自检数", "类型": "number", "初值": 1}],
            "正则": [{"名": "自检正则", "模式": "【(.*?)】", "替换": "「$1」"}],
            "开场白": "自检开场白。",
        }, 稿44)
        库44 = os.path.join(根44, "库")
        r44 = _D44.落卡(稿44, 到=库44, out=lambda *a, **k: None)
        坑44 = []
        if (r44["条目改"], r44["条目新"], r44["条目删"]) != (1, 1, 3):
            坑44.append("改/新/删 该是 1/1/3，实际 %d/%d/%d"
                        % (r44["条目改"], r44["条目新"], r44["条目删"]))
        if r44["变量"] != 1 or r44["正则"] != 1 or not r44["开场白"]:
            坑44.append("变量 %d / 正则 %d / 开场白 %s"
                        % (r44["变量"], r44["正则"], r44["开场白"]))
        if r44["错误"]:
            坑44.append("落出来的卡有 %d 个错" % len(r44["错误"]))
        if not os.path.isfile(r44["成品"]):
            坑44.append("成品没落出来")
        if OPENER.读(r44["工程"]).get("标记数") != 3:
            坑44.append("开场白末尾的零宽标记不是 3 个")

        # `make --模板` 给的那份骨架**自己必须跑得通** —— 空手想 YAML 的键名最容易卡壳，
        # 而「说了有模板、模板却是坏的」是最气人的一种。
        模44 = os.path.join(根44, "模板.yaml")
        open(模44, "w", encoding="utf-8").write(_D44.卡稿模板())
        r模44 = _D44.落卡(模44, 到=os.path.join(根44, "模板库"), out=lambda *a, **k: None)
        if r模44["错误"]:
            坑44.append("模板自己跑出来的卡有 %d 个错" % len(r模44["错误"]))
        if not os.path.isfile(r模44["成品"]):
            坑44.append("模板自己没跑出成品")

        # 负向一：稿子有毛病 -> 目标位置一个字都不许写
        坏44 = os.path.join(根44, "坏.yaml")
        M.ydump({"卡名": "坏卡44", "条目": [{"标题": "甲", "模板": "没这个档"}]}, 坏44)
        坏库44 = os.path.join(根44, "坏库")
        try:
            _D44.落卡(坏44, 到=坏库44, out=lambda *a, **k: None)
            坑44.append("坏稿竟然没被拦下")
        except _D44.DraftError:
            if os.path.exists(os.path.join(坏库44, "坏卡44")):
                坑44.append("坏稿被拦下了，可目标位置还是被写了东西")
        # 负向二：目标已有一份工程，不给 --覆盖 就该停
        try:
            _D44.落卡(稿44, 到=库44, out=lambda *a, **k: None)
            坑44.append("目标已存在时竟然没拦")
        except _D44.DraftError:
            pass
        # 负向三：那一层住着别人的东西 -> 连 --覆盖 都不许盖
        别人44 = os.path.join(根44, "别人的库", "自检卡44", "source")
        os.makedirs(别人44, exist_ok=True)
        open(os.path.join(别人44, "别人的.spec.yaml"), "w", encoding="utf-8").close()
        try:
            _D44.落卡(稿44, 到=os.path.join(根44, "别人的库"), 覆盖=True,
                      out=lambda *a, **k: None)
            坑44.append("别人的目录竟然被盖了")
        except _D44.DraftError:
            pass
        if not 坑44:
            print("  44 卡稿落卡       ✔ 一份稿子一次落成一张卡（改 1 / 建 1 / 删 3）；"
                  "坏稿在动手前就被拦下、目标位置一个字没写；别人的目录不给盖")
        else:
            ok = False
            print("  44 卡稿落卡       ✗ %s" % "；".join(坑44))
    except Exception as exc:
        ok = False
        print("  44 卡稿落卡       ✗ %s" % exc)

    # 45. 示例卡稿 + 「改已有条目」那两条容易静默的路。
    #     三件事，全是「不报错但结果不对」的那一类：
    #       · `make --示例` 打出来的那份**必须自己就是一张绿卡** —— 它是给人照抄的，
    #         样板自己跑不通比没有样板更坏（照抄的每一条都撞墙）。
    #       · 稿子里给**已有条目**写「模板:」不许崩（模板表里带着 kind，set_entry 不收身份）。
    #       · 稿子里给**已有条目**写「分组:」要真的挪过去 —— 早先这里默默忽略，
    #         稿子写了「分组: 角色」，条目纹丝不动，一个字都不报。
    #     顺带：变量跟骨架里现成的重名，得是一句人话，不能是 traceback。
    try:
        from forge import draft as _D45
        根45 = tempfile.mkdtemp(prefix="forge_st45_")
        库45 = os.path.join(根45, "库")

        # 示例卡稿：原样落一遍，必须是绿卡
        示45 = os.path.join(根45, "示例.yaml")
        open(示45, "w", encoding="utf-8", newline="\n").write(_D45.卡稿示例())
        r45 = _D45.落卡(示45, 到=库45, out=lambda *a, **k: None)
        坑45 = []
        if r45["错误"] or r45.get("落点错误"):
            坑45.append("示例卡稿落出来的卡有错：%s"
                        % "；".join((r45["错误"] or []) + (r45.get("落点错误") or []))[:120])
        if not os.path.isfile(r45["成品"]):
            坑45.append("示例卡稿没落出成品")
        if OPENER.读(r45["工程"]).get("标记数") != 3:
            坑45.append("示例卡稿的开场白末尾零宽标记不是 3 个")

        # 已有条目 + 模板 / 分组：换档到「关键词」并把骨架那条世界总纲挪进自建分组
        改45 = os.path.join(根45, "改.yaml")
        M.ydump({
            "卡名": "自检卡45",
            "分组": ["新家"],
            "条目": [
                {"标题": "核心 · 世界总纲", "模板": "关键词", "分组": "新家",
                 "关键词": ["甲", "乙"], "提示": "问起甲乙时读这条", "正文": "换过档的总纲"},
                {"标题": "规则 · 判定", "模板": "常驻", "正文": "换成常驻的判定"},
            ],
        }, 改45)
        r改45 = _D45.落卡(改45, 到=库45, out=lambda *a, **k: None)
        if r改45["错误"]:
            坑45.append("改已有条目落出来的卡有错：%s" % "；".join(r45["错误"])[:120])
        spec45 = _D45._找规格(r改45["工程"])
        栏45 = {e.get("title"): e for e in CONTENT.entries_of(CONTENT.load(spec45), must=True)}
        组45 = {g.get("id"): g.get("name") for g in CONTENT.groups_of(CONTENT.load(spec45))}
        总纲 = 栏45.get("核心 · 世界总纲") or {}
        判定 = 栏45.get("规则 · 判定") or {}
        if 组45.get(总纲.get("group_id")) != "新家":
            坑45.append("「分组:」没把已有条目挪过去（它还在 %r）"
                        % 组45.get(总纲.get("group_id")))
        if 总纲.get("agent_read_strategy") != "keyword":
            坑45.append("给已有条目换档没生效（策略还是 %r）" % 总纲.get("agent_read_strategy"))
        if 总纲.get("content") != "换过档的总纲":
            坑45.append("给已有条目改正文没生效")
        if 判定.get("trigger_mode") != "always" or not str(判定.get("position") or "").strip():
            坑45.append("已有条目换档到常驻后没补插入位置（%r / %r）"
                        % (判定.get("trigger_mode"), 判定.get("position")))

        # 变量与骨架里的重名：要给一句人话（DraftError），不是 traceback
        重45 = os.path.join(根45, "重名.yaml")
        M.ydump({"卡名": "自检卡45重名",
                 "变量": [{"对象": "玩家", "名": "等级", "类型": "number", "初值": 9}]}, 重45)
        try:
            _D45.落卡(重45, 到=库45, out=lambda *a, **k: None)
            坑45.append("变量跟骨架重名竟然落了进去")
        except _D45.DraftError:
            pass
        except Exception as exc:                      # ContentError / 其它都不行
            坑45.append("变量重名抛的是 %s，不是能读的 DraftError" % type(exc).__name__)

        if not 坑45:
            print("  45 示例卡稿       ✔ 一份 3.8k 字的完整示例自己就是绿卡；给已有条目"
                  "换档 / 改正文 / 挪分组都真的落下去；变量重名给人话不抛栈")
        else:
            ok = False
            print("  45 示例卡稿       ✗ %s" % "；".join(坑45))
    except Exception as exc:
        ok = False
        print("  45 示例卡稿       ✗ %s" % exc)

    print("-" * 74)
    print("结论：%s" % ("全绿 ✔" if ok else "有失败 ✗"))
    print("（临时工程在 %s，看完可删）" % tmp)
    return 0 if ok else 1


def _fresh_snapshot(spec_path):
    """一张 spec 的「内容指纹」：条目 id/标题/正文长度 + 正则 id。

    撤模块的验收就靠它 —— 撤完必须一字不差地回到没接过的那一份。
    """
    spec = M.yload(spec_path) or {}
    lib = spec.get("library") or {}
    entries = sorted(
        (str(e.get("id") or ""), str(e.get("title") or ""),
         len(str(e.get("content") or "")), str(e.get("agent_read_strategy") or ""))
        for e in (lib.get("entries") or []))
    rules = sorted(str(r.get("id") or "") for r in (spec.get("regex_rules") or []))
    return {"条目": len(entries), "条目明细": entries, "正则": len(rules),
            "正则明细": rules}


def _canon_pair(a, b):
    """比语义：忽略键顺序、忽略空白。"""
    return _canon(_scrub(a)) == _canon(_scrub(b))


def _scrub(obj):
    """去掉与语义无关的易变字段（时间戳），避免往返比对被它们带偏。

    卡里 `setting_library` / `variable_config` 是嵌套的 JSON **字符串**，
    光在顶层 dict 上删键是不够的 —— 得先把它当 JSON 解析开，再往里删。
    """
    if isinstance(obj, dict):
        return {k: _scrub(v) for k, v in obj.items()
                if k not in ("created_at", "updated_at", "updatedAt",
                             "config_updated_at")}
    if isinstance(obj, list):
        return [_scrub(v) for v in obj]
    if isinstance(obj, str) and obj[:1] in "{[":
        try:
            return _scrub(json.loads(obj))
        except Exception:
            return obj
    return obj


# ------------------------------------------------------------------ 内容编辑
def _spec_of(target):
    """把「工程目录 或 spec 路径」都收成一个 spec 路径。找不到返回 None。"""
    p = os.path.abspath(target or ".")
    if os.path.isfile(p):
        return p
    for sub in ("source", ""):
        d = os.path.join(p, sub) if sub else p
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith(".spec.yaml"):
                return os.path.join(d, f)
    return None


def _need_spec(argv, 用法):
    if not argv or argv[0].startswith("-"):
        print(用法)
        return None
    p = _spec_of(argv[0])
    if not p or not os.path.isfile(p):
        print("找不到 spec：%s" % argv[0])
        return None
    return p


def _list(txt):
    if not txt:
        return []
    return [x.strip() for x in str(txt).replace("，", ",").replace("、", ",").split(",")
            if x.strip()]


def _多值(argv, names):
    """取一组名字：`--删 a b c`（吃到下一个 --旗标为止），`--删 "a,b"` 也认。

    单条命令一直写成 `--删 "标题"`。多值只是把「一个」放宽成「一串」——
    老写法一个字都不用改。
    """
    out = []
    for i, a in enumerate(argv):
        if a in names:
            j = i + 1
            while j < len(argv) and not argv[j].startswith("-"):
                out.extend(_list(argv[j]))
                j += 1
        for n in names:
            if a.startswith(n + "@"):
                out.extend(_list(_读文(a[len(n):])))
    return out


def _next(spec):
    print("")
    print("下一步： python forge.py check \"%s\"" % spec)


def _tail(rows, cols, right=()):
    """按显示宽度对齐地打一张小表。中英混排非得这么打，不然一定歪。"""
    widths = [M.disp_width(c[0]) for c in cols]
    for r in rows:
        for i, v in enumerate(r):
            widths[i] = max(widths[i], M.disp_width(v))
    print("  " + "  ".join(M.pad(c[0], widths[i]) for i, c in enumerate(cols)))
    for r in rows:
        print("  " + "  ".join(
            M.pad(v, widths[i], "right" if i in right else "left")
            for i, v in enumerate(r)))


def cmd_entry(argv):
    用法 = (
        "用法：python forge.py entry <spec> --新 \"标题\" [--分组 X]\n"
        "                                      [--模板 常驻|必读|关键词|选读|开场]\n"
        "                                      [--正文 \"…\"] [--关键词 判定,掷骰]\n"
        "                                      [--位置 instructions] [--提示 \"什么时候读我\"]\n"
        "      python forge.py entry <spec> --列 [--分组 X]\n"
        "      python forge.py entry <spec> --看 <id 或 标题>      看一条的全貌（正文全文在内）\n"
        "      python forge.py entry <spec> --改 <id 或 标题> [<id 或 标题> …] --正文 \"…\"\n"
        "                                      [--标题 \"…\"] [--关键词 a,b]\n"
        "                                      [--提示 \"什么时候读我\"] [--模板 常驻|必读|关键词|选读]\n"
        "                                      [--策略 …] [--位置 …] [--角色 …] [--内容模式 …]\n"
        "                                      [--启用 | --停用]   卡里留着但不生效 / 让它生效\n"
        "  （--改 后面给一串就是**批量改**：这批条目同时改成同一组字段，一次落盘、\n"
        "    一条回收记录。值域照旧当场拦 —— 只要有一条会被降级，整批一个字都不落盘。）\n"
        "      python forge.py entry <spec> --复制 <id 或 标题> [<id 或 标题> …]\n"
        "                                      [--标题 \"…\"] [--到 分组]\n"
        "      python forge.py entry <spec> --挪 <id 或 标题> [<id 或 标题> …] [--到 分组]\n"
        "      python forge.py entry <spec> --删 <id 或 标题> [<id 或 标题> …]\n"
        "      python forge.py entry <spec> --启用|--停用 <id 或 标题> [<id 或 标题> …]\n"
        "  （--复制 / --挪 / --删 / --启用 / --停用 后面可以跟一串，一次动多条：\n"
        "    一次落盘、一条回收记录，`trash --还原 N` 一次全捞回来。\n"
        "    有认不出的名字就**整批停下**，绝不半个批次落盘 —— 半条是最难收拾的。）\n"
        "  （--复制 的副本顺着原件排、默认叫「原名（副本）」；--到 分组 能让副本直接落进那个组。\n"
        "    复制是加一条、跟 --新 一样不写回收记录 —— 不要了就 --删 掉它。开场白条目不许复制。）\n"
        "  （--改 只动内容与偏好；id / 顺序号 / 分组位置一概不动，卡里引用旧 id 的地方不会断）\n"
        "  （凡要写一段话的地方，值都可以写成 @文件名 —— 正文太长、带换行或引号时这么写，\n"
        "    例：--正文@正文.txt ，或 --正文 @正文.txt ）")
    spec = _need_spec(argv, 用法)
    if not spec:
        return 2
    try:
        if "--列" in argv or "--list" in argv:
            _print_entries(spec, _opt(argv, ("--分组", "--group")))
            return 0
        if "--看" in argv or "--show" in argv or "--详情" in argv:
            谁 = _opt(argv, ("--看", "--show", "--详情"))
            if not 谁:
                print(用法)
                return 2
            _print_entry_detail(CONTENT.entry_detail(spec, 谁))
            return 0
        if "--新" in argv or "--add" in argv:
            CONTENT.add_entry(spec, _opt(argv, ("--新", "--add")),
                              分组=_opt(argv, ("--分组", "--group")) or "",
                              模板=_opt(argv, ("--模板", "--template")) or "常驻",
                              正文=_opt(argv, ("--正文", "--body")) or "",
                              关键词=_list(_opt(argv, ("--关键词", "--kw"))),
                              位置=_opt(argv, ("--位置", "--position")),
                              提示=_opt(argv, ("--提示", "--hint")))
            _next(spec)
            return 0
        if "--改" in argv or "--set" in argv:
            字段 = {}
            for 旗, 键 in (("--标题", "title"), ("--正文", "content"),
                           ("--提示", "agent_selection_hint"),
                           ("--策略", "agent_read_strategy"),
                           ("--位置", "position"), ("--角色", "insert_role"),
                           ("--内容模式", "content_mode"), ("--图标", "icon_id")):
                v = _opt(argv, (旗,))
                if v is not None:
                    字段[键] = v
            if "--关键词" in argv or "--kw" in argv:
                字段["keywords"] = _opt(argv, ("--关键词", "--kw")) or ""
            # 启用状态：卡里 `enabled: false` 的条目留着但不生效。列表现已标出来，
            # 也得给一个开关 —— 否则看得见、动不了。
            if "--启用" in argv or "--enable" in argv:
                字段["enabled"] = True
            elif "--停用" in argv or "--disable" in argv:
                字段["enabled"] = False
            模板 = _opt(argv, ("--模板", "--template"))
            if 模板:
                if 模板 not in CONTENT.模板表:
                    print("!! 没有名为「%s」的模板。能用的：%s"
                          % (模板, "、".join(CONTENT.模板表)))
                    return 2
                # 模板表里带着 kind 这类身份字段 —— 改条目不动身份，滤掉
                字段.update({k: v for k, v in CONTENT.模板表[模板].items()
                             if k in CONTENT.可改字段})
            # `--改` 后面可以是一个名字，也可以是一串 —— 一串就是「这批条目同
            # 时改同一组字段」。单条走 set_entry（报错与回显都是老样子），
            # 多条走 set_entries_fields（一次落盘、一条回收记录）。
            谁们 = _多值(argv, ("--改", "--set"))
            if not 谁们:
                print("没说改哪条。用法：python forge.py entry <spec> --改 \"标题\" --正文 \"…\"")
                return 2
            if len(谁们) == 1:
                CONTENT.set_entry(spec, 谁们[0], 字段=字段)
            else:
                if not 字段:
                    print("批量改要说清改什么："
                          "python forge.py entry <spec> --改 甲 乙 --正文 \"…\"")
                    return 2
                CONTENT.set_entries_fields(spec, 谁们, 字段)
            _next(spec)
            return 0
        if "--复制" in argv or "--dup" in argv:
            谁们 = _多值(argv, ("--复制", "--dup"))
            if not 谁们:
                print("没说复制哪条。用法："
                      "python forge.py entry <spec> --复制 \"标题\" [\"标题\" …] [--到 分组]")
                return 2
            CONTENT.dup_entries(spec, 谁们,
                                标题=_opt(argv, ("--标题", "--title")),
                                到=_opt(argv, ("--到", "--to", "--分组", "--group")) or "")
            _next(spec)
            return 0
        if "--挪" in argv or "--move" in argv:
            CONTENT.move_entries(spec, _多值(argv, ("--挪", "--move")),
                                 _opt(argv, ("--到", "--to")) or "")
            _next(spec)
            return 0
        if "--删" in argv or "--del" in argv:
            CONTENT.del_entries(spec, _多值(argv, ("--删", "--del")))
            _next(spec)
            return 0
        # 批量开关。注意顺序：这一段必须排在 `--改` 后面 —— `--改 X --启用` 里的
        # `--启用` 是个**不带值**的开关，那是老写法，不算批量。
        if "--启用" in argv or "--enable" in argv or "--停用" in argv or "--disable" in argv:
            开 = _多值(argv, ("--启用", "--enable"))
            关 = _多值(argv, ("--停用", "--disable"))
            if 开 and 关:
                print("!! --启用 跟 --停用 不能一起给。")
                return 2
            谁 = 开 or 关
            if not 谁:
                print("!! --启用 / --停用 后面要跟条目（id 或 标题），可以跟一串。")
                return 2
            CONTENT.set_entries_enabled(spec, 谁, bool(开))
            _next(spec)
            return 0
    except CONTENT.ContentError as exc:
        print("!! %s" % exc)
        return 1
    print(用法)
    return 2


def _print_entries(spec, 分组=None):
    rows = [r for r in CONTENT.list_entries(spec) if not 分组 or r["分组"] == 分组]
    rows.sort(key=lambda r: (r["顺序"] is None, r["顺序"]))
    if not rows:
        print("（没有条目%s）" % ("，分组「%s」里一个都没有" % 分组 if 分组 else ""))
        return
    _tail([[str(r["id"]), r["标题"], r["分组"] or "—", r["触发"], r["策略"],
            str(r["字数"]), ",".join(r["关键词"]) or "—",
            "是" if r.get("启用", True) else "禁用"] for r in rows],
          [("id", 0), ("标题", 0), ("分组", 0), ("触发", 0), ("策略", 0),
           ("字数", 0), ("关键词", 0), ("启用", 0)],
          right=(5,))
    禁 = [r for r in rows if not r.get("启用", True)]
    print("")
    print("  共 %d 条%s。改一条：entry --改 <id 或 标题> --正文 \"…\" [--提示 \"…\"]"
          % (len(rows),
             "（其中 %d 条已禁用 —— 卡里留着，但不生效）" % len(禁) if 禁 else ""))


def _标签(k, w=12):
    return k + " " * max(1, w - M.disp_width(k))


def _print_entry_detail(d):
    """打一条条目的全貌。正文单独起一段、原样输出 —— 它是要被读走和改写的，
    夹进表格里就没法原样用了（多行、缩进全糊）。"""
    print("条目 · %s" % d["标题"])
    print("─" * 62)
    for k, v in (("id", d["id"]), ("分组", d["分组"]), ("类型", d["类型"]),
                 ("启用", d.get("启用")),
                 ("顺序", d["顺序"]), ("触发方式", d["触发方式"]),
                 ("读取策略", d["读取策略"]), ("动态模式", d["动态模式"]),
                 ("内容模式", d["内容模式"]),
                 ("关键词", "、".join(d["关键词"]) or "（无）"),
                 ("关键词条件", d["关键词条件"]),
                 ("读取提示", d["读取提示"] or "（无）"),
                 ("插入位置", d["插入位置"] or "（无）"),
                 ("插入角色", d["插入角色"] or "（无）"),
                 ("图标", d["图标"] or "（无）")):
        print(_标签(k) + str("" if v is None else v))
    if "开场白方案" in d:
        print(_标签("开场白方案") + "%d 个，默认 %s"
              % (len(d["开场白方案"]), d.get("默认方案") or "—"))
        for m in d["开场白方案"]:
            print(" " * 12 + "· %s  [%s]  %d 字" % (m["标题"], m["id"], m["字数"]))
    print("")
    print("正文（%d 字）：" % d["字数"])
    print(d["正文"] if str(d["正文"]).strip()
          else "（空 —— 现在是条占位，别就这么出卡）")
    print("")
    if "开场白方案" in d:
        print("这条是开场白 —— 正文**别用 `--改`**（有界面层时它只是派生物，改了白改）：")
        print("  python forge.py opener <工程 或 spec> --正文@新正文.txt")
        print("  （末尾那三个零宽标记、方案正文同步、写回，都归 opener 管；`opener --看` 看全貌）")
    else:
        print("改这条： python forge.py entry <spec> --改 \"%s\" --正文@新正文.txt" % d["标题"])


def cmd_group(argv):
    用法 = ("用法：python forge.py group <spec> --列\n"
            "      python forge.py group <spec> --新 <名> [--父 分组]\n"
            "      python forge.py group <spec> --改名 <旧名> <新名>\n"
            "      python forge.py group <spec> --删 <名>")
    spec = _need_spec(argv, 用法)
    if not spec:
        return 2
    try:
        if "--列" in argv or "--list" in argv:
            rows = CONTENT.list_entries(spec)
            表 = CONTENT.list_groups(spec)
            if not 表:
                print("（这张卡没有分组）")
                return 0
            _tail([[str(g["id"]), g["名"], g["父"] or "—",
                    str(len([r for r in rows if r["分组"] == g["名"]]))]
                   for g in 表],
                  [("id", 0), ("名", 0), ("父", 0), ("条目数", 0)], right=(3,))
            return 0
        if "--新" in argv or "--add" in argv:
            CONTENT.add_group(spec, _opt(argv, ("--新", "--add")),
                              父=_opt(argv, ("--父", "--parent")) or "")
            _next(spec)
            return 0
        if "--改名" in argv or "--rename" in argv:
            rest = [a for a in argv[1:] if not a.startswith("-")
                    and a not in (_opt(argv, ("--改名", "--rename")),)]
            CONTENT.rename_group(spec, _opt(argv, ("--改名", "--rename")), rest[0])
            _next(spec)
            return 0
        if "--删" in argv or "--del" in argv:
            CONTENT.del_group(spec, _opt(argv, ("--删", "--del")))
            _next(spec)
            return 0
    except CONTENT.ContentError as exc:
        print("!! %s" % exc)
        return 1
    print(用法)
    return 2


def cmd_var(argv):
    用法 = ("用法：python forge.py var <spec> --列\n"
            "      python forge.py var <spec> --新对象 <名> [--父 对象] [--说明 \"…\"]\n"
            "      python forge.py var <spec> --新 <对象>.<变量> [--类型 number]\n"
            "                                      [--初值 1] [--说明 \"…\"]\n"
            "      python forge.py var <spec> --改名 <变量 id 或 对象.变量> --成 <新名>\n"
            "      python forge.py var <spec> --改名对象 <对象> --成 <新名>\n"
            "      python forge.py var <spec> --换对象 <变量 id 或 对象.变量> --到 <对象>\n"
            "      python forge.py var <spec> --删 <变量 id 或 对象.变量> [<…> …]\n"
            "      python forge.py var <spec> --删对象 <名>\n"
            "      python forge.py var <spec> --对齐       把 Zod 对齐另两处\n"
            "  （改名一次把**三处**一起挪：面板 / 初值那一格的键 / Zod 那个字段名 ——\n"
            "    只改一处，另两处会悄悄悬空。id 不动，按 id 引用的地方不会断。\n"
            "    正文里写着旧名字的地方**只报不改** —— 工具不知道那是变量名还是恰好同字的词。\n"
            "  --换对象 是名字不动、换它挂在哪个对象下：挂靠关系 / 初值那格 / Zod 那个字段\n"
            "    一起搬到新对象那棵子树下，顺带排到新对象末尾。id 同样不动。\n"
            "  --删 后面给一串就是批量删：一次落盘、一条回收记录，`trash --还原 N` 一次全捞回来。）")
    spec = _need_spec(argv, 用法)
    if not spec:
        return 2
    try:
        if "--列" in argv or "--list" in argv:
            _print_vars(spec)
            return 0
        if "--换对象" in argv or "--move-obj" in argv:
            到 = _opt(argv, ("--到", "--to"))
            if not 到:
                print("!! 少了目标对象，要写成：--换对象 <变量> --到 <对象>")
                return 2
            CONTENT.move_variable(spec, _opt(argv, ("--换对象", "--move-obj")), 到)
            _next(spec)
            return 0
        if "--改名对象" in argv or "--重命名对象" in argv:
            新 = _opt(argv, ("--成", "--名", "--to"))
            if not 新:
                print("!! 少了新名字，要写成：--改名对象 <对象> --成 <新名>")
                return 2
            CONTENT.rename_object(spec, _opt(argv, ("--改名对象", "--重命名对象")), 新)
            _next(spec)
            return 0
        if "--改名" in argv or "--rename" in argv:
            新 = _opt(argv, ("--成", "--名", "--to"))
            if not 新:
                print("!! 少了新名字，要写成：--改名 <变量> --成 <新名>")
                return 2
            CONTENT.rename_variable(spec, _opt(argv, ("--改名", "--rename")), 新)
            _next(spec)
            return 0
        if "--新对象" in argv:
            CONTENT.add_object(spec, _opt(argv, ("--新对象",)),
                               父=_opt(argv, ("--父", "--parent")) or "",
                               说明=_opt(argv, ("--说明", "--desc")) or "",
                               更新规则=_opt(argv, ("--更新规则",)) or "")
            _next(spec)
            return 0
        if "--新" in argv:
            全 = _opt(argv, ("--新",))
            if not 全 or "." not in 全:
                print("!! 要写成「对象.变量」，例如：--新 玩家.声望")
                return 2
            对象, 标 = 全.rsplit(".", 1)
            CONTENT.add_variable(spec, 对象, 标,
                                 类型=_opt(argv, ("--类型", "--type")) or "string",
                                 初值=_opt(argv, ("--初值", "--value")),
                                 说明=_opt(argv, ("--说明", "--desc")) or "",
                                 更新规则=_opt(argv, ("--更新规则",)) or "")
            _next(spec)
            return 0
        if "--删对象" in argv:
            CONTENT.del_object(spec, _opt(argv, ("--删对象",)))
            _next(spec)
            return 0
        if "--删" in argv or "--del" in argv:
            # 跟 `entry --删` 一样：后面可以是一个，也可以是一串（一次落盘、
            # 一条回收记录）。每个变量三处，一串就是三处 × N，一起撤、一起还原。
            谁们 = _多值(argv, ("--删", "--del"))
            if not 谁们:
                print("没说删哪个变量。用法：python forge.py var <spec> --删 <对象.变量> [<对象.变量> …]")
                return 2
            if len(谁们) == 1:
                CONTENT.del_variable(spec, 谁们[0])
            else:
                CONTENT.del_variables(spec, 谁们)
            _next(spec)
            return 0
        if "--对齐" in argv or "--align" in argv:
            CONTENT.align_schema(spec)
            _next(spec)
            return 0
    except CONTENT.ContentError as exc:
        print("!! %s" % exc)
        return 1
    print(用法)
    return 2


def _print_vars(spec):
    raw = CONTENT.load(spec)
    v = raw.get("variables") or {}
    objs = {o.get("id"): (o.get("name") or "") for o in (v.get("objects") or [])}
    rows = v.get("variables") or []
    if not rows:
        print("（这张卡没有变量）")
        return False
    _tail([[objs.get(x.get("object_id"), "?"), str(x.get("title") or ""),
            str(x.get("type") or ""),
            json.dumps(x.get("default_value"), ensure_ascii=False),
            str(x.get("id") or "")] for x in rows],
          [("对象", 0), ("变量", 0), ("类型", 0), ("初值", 0), ("id", 0)])
    print("")
    print("  共 %d 个。把 Zod 对齐另两处：python forge.py var \"%s\" --对齐"
          % (len(rows), spec))
    return True


def cmd_regex(argv):
    用法 = ("用法：python forge.py regex <spec> --列\n"
            "      python forge.py regex <spec> --新 <名> --模式 \"/〔试〕/g\" [--替换 \"…\"]\n"
            "                                        [--目标 AiOutput] [--顺序 30]\n"
            "      python forge.py regex <spec> --删 <名 或 id>\n"
            "      python forge.py regex <spec> --启 <名> / --停 <名>")
    spec = _need_spec(argv, 用法)
    if not spec:
        return 2
    try:
        if "--列" in argv or "--list" in argv:
            rows = CONTENT.list_regex(spec)
            if not rows:
                print("（这张卡没有正则）")
                return 0
            rows.sort(key=lambda r: (r["顺序"] is None, r["顺序"]))
            _tail([["开" if r["开"] else "停", str(r["顺序"]), r["名"],
                    ",".join(r["目标"]), r["模式"][:48]] for r in rows],
                  [("", 0), ("顺序", 0), ("名", 0), ("作用", 0), ("模式", 0)], right=(1,))
            print("")
            print("  共 %d 条。ElecKoi 是按 order 从小到大依次跑的。" % len(rows))
            return 0
        if "--新" in argv or "--add" in argv:
            CONTENT.add_regex(spec, _opt(argv, ("--新", "--add")),
                              模式=_opt(argv, ("--模式", "--pattern")) or "",
                              替换=_opt(argv, ("--替换", "--repl")) or "",
                              目标=_list(_opt(argv, ("--目标", "--targets"))),
                              顺序=(int(_opt(argv, ("--顺序", "--order")))
                                    if _opt(argv, ("--顺序", "--order")) else None))
            _next(spec)
            return 0
        if "--删" in argv or "--del" in argv:
            CONTENT.del_regex(spec, _opt(argv, ("--删", "--del")))
            _next(spec)
            return 0
        if "--启" in argv or "--开" in argv:
            CONTENT.set_regex(spec, _opt(argv, ("--启", "--开")), True)
            _next(spec)
            return 0
        if "--停" in argv or "--关" in argv:
            CONTENT.set_regex(spec, _opt(argv, ("--停", "--关")), False)
            _next(spec)
            return 0
    except CONTENT.ContentError as exc:
        print("!! %s" % exc)
        return 1
    print(用法)
    return 2


def cmd_trash(argv):
    用法 = ("用法：python forge.py trash <工程 或 spec>            看回收站里有什么\n"
            "      python forge.py trash <工程 或 spec> --还原 1      把第 1 条放回去（1 = 最近）\n"
            "      python forge.py trash <工程 或 spec> --清空")
    spec = _need_spec(argv, 用法)
    if not spec:
        return 2
    try:
        if "--清空" in argv or "--clear" in argv:
            n = CONTENT.clear_trash(spec)
            print("回收站清空了（%d 条）。" % n)
            return 0
        if "--还原" in argv or "--restore" in argv:
            r = CONTENT.restore(spec, _opt(argv, ("--还原", "--restore")))
            print("已放回：%s" % (r.get("说明") or ""))
            for x in r["放回"]:
                print("  · %s" % x)
            for x in r["跳过"]:
                print("  ⚠ 跳过 %s" % x)
            _next(spec)
            return 0
        rows = CONTENT.list_trash(spec)
        if not rows:
            print("回收站是空的（%s 下没有东西）。" % CONTENT.trash_dir(spec))
            return 0
        for i, rec in enumerate(rows, 1):
            print("  %s  %s" % (M.pad(str(i), 3, "right"), rec.get("说明") or ""))
            print("        %s · %s · %d 项"
                  % (rec.get("时间", "")[:19], rec.get("种类", ""),
                     len(rec.get("项") or [])))
        print("")
        print("  放回去： python forge.py trash \"%s\" --还原 1" % argv[0])
        return 0
    except CONTENT.ContentError as exc:
        print("!! %s" % exc)
        return 1


# ------------------------------------------------------------------ 分发
COMMANDS = {
    "new": cmd_new, "name": cmd_name,
    "unpack": cmd_unpack, "build": cmd_build, "check": cmd_check,
    "hud": cmd_hud, "bundle": cmd_bundle, "import": cmd_import,
    "analyze": cmd_analyze, "to-eleckoi": cmd_to_eleckoi, "to-tavern": cmd_to_tavern,
    "png": cmd_png, "preset": cmd_preset, "plan": cmd_plan, "lint": cmd_lint,
    "manual": cmd_manual, "index": cmd_index, "coach": cmd_coach, "guide": cmd_guide,
    "make": cmd_make,
    "mods": cmd_mods, "add": cmd_add, "drop": cmd_drop,
    "entry": cmd_entry, "group": cmd_group, "var": cmd_var, "regex": cmd_regex,
    "opener": cmd_opener,
    "trash": cmd_trash,
    "theme": cmd_theme,
    "diff": cmd_diff,
    "domains": cmd_domains, "selftest": cmd_selftest,
}


# 裸跑会真干活（写盘 / 跑整轮自检）的命令 —— 问用法时不能真把它们跑起来
_问用法别跑 = {"coach", "selftest"}


def _打命令用法(cmd):
    """`python forge.py <命令> --help` 的出口。

    问一个命令怎么用，最自然的动作就是在这条命令后面加 `--help`。以前这里
    只回一份总表，还附一句「看某个命令的用法：去掉参数直接跑」—— 那句话没人会去猜，
    于是「查不到 `entry` 有哪些参数」成了盲跑里最费劲的一处。
    现在：各命令的空参分支本来就是它的用法文本，直接借它来打。
    """
    if cmd in _问用法别跑:
        print("用法：python forge.py %s（直接跑即可，参数见下面总表里那一行）" % cmd)
        print()
        print(HELP)
        return 0
    try:
        COMMANDS[cmd]([])
    except ArgError as exc:                # 空参就报参数的，把话原样带出来
        print("!! %s" % exc)
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    # `--沙箱`（或 FORGE_SANDBOX=1）：沙箱友好模式 —— 只创建、只覆盖，不删文件、不改名。
    # 给「ElecKoi 里的 AI 直接跑 forge.py」那条路用的，见 forge/sandbox.py 顶上那段。
    argv = SB.take_flag(argv)
    if SB.enabled():
        print("· %s" % SB.note())
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(HELP)
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd not in COMMANDS:
        print("认不得的命令：%s\n" % cmd)
        print(HELP)
        return 2
    # `forge.py new --help` 这种：以前会把 `--help` 当成卡名，在工具自己目录里建出一个
    # 叫「--help」的工程 —— 没人会想到「问一句用法」竟然会写盘。统一拦在这里，
    # 并把这一问**转给该命令自己**回答（见 `_打命令用法`）。
    if any(a in ("-h", "--help") for a in rest):
        return _打命令用法(cmd)
    try:
        return COMMANDS[cmd](rest)
    except ArgError as exc:
        print("!! %s" % exc)
        return 2
    except Exception as exc:
        # **谁该打栈、谁该打一行。** 本工具自定义的错误类（ContentError / HudError /
        # OpenerError / DistError …）以及「内容或来源不对」型的 ValueError / RuntimeError /
        # OSError，说的都是「这事现在办不了」，一句人话就够 —— 栈只会把原因埋掉。
        # 反过来，KeyError / TypeError / AttributeError 那种是**代码自己的 bug**，照旧炸。
        # 调试时想看栈：设 FORGE_TRACEBACK=1。
        if os.environ.get("FORGE_TRACEBACK"):
            raise
        自带 = (str(type(exc).__module__).startswith("forge")
              and type(exc).__name__.endswith("Error"))
        if not (自带 or isinstance(exc, (ValueError, RuntimeError, OSError))):
            raise
        print("!! %s: %s" % (type(exc).__name__, exc))
        print("   （不是崩溃 —— 上面那句就是原因。想看调用栈：设 FORGE_TRACEBACK=1）")
        return 2


if __name__ == "__main__":
    sys.exit(main())
