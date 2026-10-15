# -*- coding: utf-8 -*-
"""forge.bundle —— 把一张卡的工程打成一个包。

一个「工程包」里装的是**这张卡的全部家当**，拿到的人不用装 forge 也能看：

    source/<卡>.spec.yaml    内容真相（改它）
    hud/                     界面那一层（改它、拼它）
    测试/test_core.js        界面纯函数单测
    成品/<卡>.card.json      交付物（导入 ElecKoi 的就是它）
    文档/<卡>.手册.html      人读手册（不用装任何东西，双击就看）
    文档/<卡>.索引.md        给 AI 的导航索引
    预览.html                界面在浏览器里的预览
    怎么开工.md              这包怎么用
    包信息.json              包的信封（卡名 / 模块 / 皮肤 / 每个文件的 sha256 清单）

打包前会**重新构建一遍**（spec -> 卡 -> 手册 -> 索引），所以包里不会有过期的派生物。
组装不过就停，不拿半成品覆盖。

`包信息.json` 是给**收包那一头**用的：`forge import` 照着它核完整性、认卡名。
它是包的信封，不是工程的内容 —— 只写进 zip，不落在工程目录里。
"""
from __future__ import annotations

import json
import os
import shutil
import zipfile

from . import hud as HUD
from . import manual as MANUAL
from . import model as M
from . import pack

# 不带进包里的东西
SKIP_DIRS = {"__pycache__", "out", ".git", ".forge", "node_modules"}
SKIP_TAILS = (".pyc", ".pyo")


def run(project, out=None, with_card=False, out_print=print):
    """把工程打包。返回生成的 zip 路径。"""
    project = os.path.abspath(project)
    if not os.path.isdir(project):
        raise FileNotFoundError("找不到工程目录：%s" % project)

    from . import dist as DIST          # 清单在 dist 里（导入方向也用同一套结构）

    spec = HUD.find_spec(project)
    if not spec:
        raise FileNotFoundError(
            "工程里没有 source/*.spec.yaml —— 这不是本工具开的工程：%s" % project)

    # 卡名 = spec 文件名去掉 `.spec.yaml`（不能只剥最后一段扩展名）
    base = os.path.basename(spec)
    name = base[:-len(".spec.yaml")] if base.endswith(".spec.yaml") else os.path.splitext(base)[0]
    out_print("打包 %s" % name)
    out_print("")

    # ---- 1. 界面层先组装（有 hud/ 的话）—— 顺便校验，不过就停
    hud_dir = os.path.join(project, "hud")
    if os.path.isfile(os.path.join(hud_dir, "hud.conf.json")):
        problems, _ = HUD.build(project, write_back=True, out=out_print)
        if problems:
            raise RuntimeError("界面组装有 %d 个问题，先修完再打包。" % len(problems))
    else:
        out_print("  （这个工程没有 hud/，只打内容层）")

    # ---- 2. 卡 + 手册 + 索引
    prod = os.path.join(project, "成品")
    os.makedirs(prod, exist_ok=True)
    card_path = os.path.join(prod, "%s.card.json" % name)
    pack.build(spec, card_path)
    out_print("  卡   -> %s" % os.path.relpath(card_path, project))

    docs = os.path.join(project, "文档")
    os.makedirs(docs, exist_ok=True)
    MANUAL.build_manual(spec, os.path.join(docs, "%s.手册.html" % name), out=out_print)
    MANUAL.build_index(spec, os.path.join(docs, "%s.索引.md" % name), out=out_print)

    if with_card:
        from . import export
        st = os.path.join(prod, "%s.酒馆卡.json" % name)
        export.to_tavern(card_path, st, out=out_print)

    # ---- 3. 收进 zip
    zip_path = out or os.path.join(project, "%s.工程包.zip" % name)
    zip_path = os.path.abspath(zip_path)

    # 先清点要收哪些文件 —— 清单得在写 zip 之前算出来
    plan = []
    for base, dirs, files in os.walk(project):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in sorted(files):
            if f.endswith(SKIP_TAILS):
                continue
            p = os.path.join(base, f)
            if os.path.abspath(p) == zip_path:
                continue
            if f == DIST.MANIFEST and os.path.dirname(base) == project:
                continue          # 工程里万一躺着一份旧的包信息，不进包（每次现算）
            plan.append(p)

    manifest = DIST.build_manifest(project, name, files=plan, with_card=with_card)
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(os.path.join(name, DIST.MANIFEST),
                   json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        for p in plan:
            rel = os.path.relpath(p, project)
            z.write(p, os.path.join(name, rel.replace(os.sep, "/")))
            count += 1

    size = os.path.getsize(zip_path)
    out_print("")
    out_print("已打包 -> %s" % zip_path)
    out_print("  %d 个文件 · %.1f KB · 附 %s（%d 条清单）"
              % (count, size / 1024.0, DIST.MANIFEST, len(manifest.get("清单") or {})))
    out_print("  包里最上面一层是「%s/」，解开即可用。" % name)
    out_print("  收包那一头： python forge.py import \"%s\"" % zip_path)
    return zip_path
