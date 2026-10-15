# -*- coding: utf-8 -*-
"""forge.sandbox —— 「沙箱友好模式」：在**不许删、不许改名**的文件系统里也能干活。

**为什么要有它**（2026-10-08 本机实测，见 `文档/ElecKoi内制卡·可行性勘察.md`）：
ElecKoi 里的 AI 跑命令时带着一层受限令牌沙箱（`workspace-write`）。在那层沙箱里：

    读 ✔   写 ✔   **删 ✘   改名 ✘**（全是 WinError 5）

而 forge 的习惯是「写临时文件 → 证明能打包 → 原子改名覆盖」（`os.replace`），
回收站与「撤皮肤」也都要删文件 —— 于是命令会在**第一次落盘时就挂**。

打开这个模式后（命令行加 `--沙箱`，或设环境变量 `FORGE_SANDBOX=1`），forge 换成：

| 原来 | 换成 |
|---|---|
| `os.replace(临时, 目标)` | 读临时内容 → **直接覆盖目标**（不做改名） |
| 删临时文件 | 照删；**删不掉不算失败**（收尾不该把已经成功的事报成错） |
| 回收站「用掉一条记录」 | 改写成**墓碑**（列表会跳过它），不删文件 |
| 撤皮肤（删 `主题.css`） | 把它写成**空壳**（只有一行 CSS 注释），读进去等于没有皮肤 |
| 撤模块（删 `hud/模块/<名>/`） | **留着目录**，靠 `hud.conf.json` 的「模块」列表说话（组装只看 conf） |

一句话：**沙箱里只创建、只覆盖，绝不让文件消失。**

代价（明说）：丢掉「原子落盘」——写一半崩了会留下半份文件，而不是完好的旧版；
工程里会留下几个删不掉的空壳与墓碑（都很小，且不影响 `check`）。
所以**能用普通模式就用普通模式**，这个模式是给「只有沙箱可用」的场合准备的。
"""
from __future__ import annotations

import os
import shutil

_ON = None


# ------------------------------------------------------------------ 开关
def enabled():
    """模式开着没有？先看进程内开关，没定过再看环境变量（只读一次）。"""
    global _ON
    if _ON is None:
        v = (os.environ.get("FORGE_SANDBOX") or "").strip().lower()
        _ON = v not in ("", "0", "false", "no", "off")
    return _ON


def enable(flag=True):
    global _ON
    _ON = bool(flag)


def take_flag(argv):
    """把 `--沙箱` / `--sandbox` 从参数里摘掉（它不取值，出现在哪儿都认）。"""
    argv = list(argv)
    if "--沙箱" in argv or "--sandbox" in argv:
        enable(True)
        argv = [a for a in argv if a not in ("--沙箱", "--sandbox")]
    else:
        enabled()
    return argv


def note():
    """命令行上打的那一句提醒。"""
    return ("沙箱友好模式：只创建、只覆盖 —— 不删文件、不改名（原子落盘让位）。"
            "要能删能改名时：去掉 --沙箱 / FORGE_SANDBOX 再跑。")


# ------------------------------------------------------------------ 落盘
def land(tmp, target):
    """把临时文件落到目标位置。

    正常：`os.replace`（原子，一步到位）。
    沙箱：读出来**直接覆盖目标** —— 只碰目标那一份文件，不涉及改名。
    """
    if not enabled():
        os.replace(tmp, target)
        return
    with open(tmp, "rb") as f:
        data = f.read()
    with open(target, "wb") as f:
        f.write(data)


def rename(src, dst):
    """改名。成功删掉源返回 True；沙箱里删不掉源，内容照写、返回 False。"""
    if not enabled():
        os.replace(src, dst)
        return True
    with open(src, "rb") as f:
        data = f.read()
    with open(dst, "wb") as f:
        f.write(data)
    remove(src)
    return False


def cleanup(path):
    """删临时文件。**永不抛** —— 收尾失败不该把已经成功的事报成错（与模式无关）。"""
    return remove(path)


def remove(path):
    """删一个文件：删掉 True，删不掉（含沙箱拒绝）False。**不抛**。"""
    try:
        if path and os.path.exists(path):
            os.remove(path)
            return True
    except OSError:
        pass
    return False


def rmtree(path):
    """删一棵目录树：同上，删不掉就 False，**不抛**。"""
    try:
        if path and os.path.isdir(path):
            shutil.rmtree(path)
            return True
    except OSError:
        pass
    return False


# ------------------------------------------------------------------ 替代「删除」的两种写法
def is_tombstone(rec):
    """这份 JSON 记录是不是墓碑（已作废）。"""
    return bool(isinstance(rec, dict) and rec.get("_作废"))


def retire(path):
    """让一份 JSON 记录**作废**。

    正常：删掉。
    沙箱：改写成墓碑（`content.list_trash` 会跳过它）—— 文件还在，但语义上它没了。
    """
    if not enabled():
        return remove(path)
    try:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write('{"_作废": true}\n')
        return True
    except OSError:
        return False


def shell(path, why):
    """把一份文件改写成**空壳**，替代「删掉它」。

    CSS / JS 里注释都是合法的，读进去等于没读；`.json` 就写一个空对象。
    """
    if not enabled():
        return remove(path)
    b = os.path.basename(path).lower()
    if b.endswith(".js"):
        body = "// %s\n" % why
    elif b.endswith(".json"):
        body = "{}\n"
    else:
        body = "/* %s */\n" % why
    try:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(body)
        return True
    except OSError:
        return False
