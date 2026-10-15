# -*- coding: utf-8 -*-
"""出厂.py —— 打一个**能见人**的版本。

这个仓库里有两类东西：

  · **给使用者的**：命令（`forge.py` / `forge/`）、资产、样例、向导（规程 + 向导卡）、插件、
    测试与门禁、说明文档。
  · **只给自己看的**：内部底稿（拆解 / 机制融合 / 玩法机制库 / 形态判定）、本机会话与沙箱
    日志（`.workbuddy/`）、私人路径、以及**别人家东西的名字和链接**。

出厂 = 只装第一类，而且在装之前**逐字节扫一遍**第二类有没有混进来。命中任何一条就**拒绝出厂**，
不会「警告一下照样打」—— 打出去的包收不回来。

用法：

    python 出厂.py                  # 扫描 + 装 + 打包
    python 出厂.py --检查           # 只扫描，不落盘（提交前跑这个）
    python 出厂.py --仓库           # 装完顺手在里面 git init + 首次提交（推 GitHub 用）
    python 出厂.py --自检           # 自测：集合本身对不对（挂进门禁）
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
出厂目录 = "出厂"

#: 记下出厂仓库地址的小文件（`--远端 <地址>` 写它，`--仓库` 读它自动挂 origin）。
#: 放git 忽略的范围外没意义，它含的是公开仓库地址，但也不值得进版本库 —— 见 .gitignore。
远端记录 = os.path.join(HERE, 出厂目录, "远端.txt")

# 中文 Windows 上子进程/管道的默认编码是 GBK，中文与 ✔/✘ 会当场炸
for _流 in (sys.stdout, sys.stderr):
    try:
        _流.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# ---------------------------------------------------------------- 集合

#: 整份照搬的顶层条目
要装的目录 = ["forge", "assets", "samples", "向导", "插件", "tests"]
#: 单件照搬
要装的文件 = ["forge.py", "README.md", "CHANGELOG.md", "LICENSE", "pyproject.toml",
              "package.json", "cordis.patch.yml",
              ".gitignore", "门禁.py", "文档/使用说明.md"]

#: 明确不装（写在代码里是为了让 --自检 能断言它们真的没被装）
不装 = ["文档/制卡助手-拆解（2026-10-15）.md",
        "文档/制卡助手-机制融合（2026-10-15）.md",
        "文档/制卡助手-玩法机制库（2026-10-15）.md",
        "文档/形态判定与下一步（2026-10-15）.md",
        "文档/ElecKoi内制卡·可行性勘察.md",
        "文档/C轨插件·实测单.md",
        "文档/真机实测单.md",
        "制卡工具·方案.md", "只读名单.txt", ".workbuddy", "弃用", "插件试样"]

#: 红线：命中即拒出厂。(正则, 说明)
红线 = [
    (r"TavernWeave|LiarMTTT|liarmttt", "外部项目名"),
    (r"leyu6922|ShanTing-sy|misbahsy", "外部仓库"),
    (r"lieflat|de-aigc|humanizer-zh|anti-slop-writing|sillytavern-embedded-ui", "外部仓库"),
    (r"st-guides|design-wiki", "外部资料名"),
    (r"深海蓝|大肥鱼|龙宇", "别人的预设"),
    (r"WorkBuddy|\.workbuddy", "本机会话 / 沙箱日志"),
    (r"[A-Za-z]:[\\/]Users[\\/]Administrator", "私人路径"),
    (r"[A-Za-z]:[\\/]workGZQ", "私人路径"),
    (r"制卡助手-拆解|制卡助手-机制融合|制卡助手-玩法机制库", "内部底稿"),
    (r"形态判定与下一步|可行性勘察|真机实测单|C轨插件", "内部文档"),
]

#: 只扫这些扩展名（其余按二进制跳过）
文本后缀 = {".py", ".md", ".json", ".yaml", ".yml", ".txt", ".toml", ".html", ".htm",
            ".js", ".mjs", ".css", ".bat", ".cmd", ".ps1", ".gitignore", ".cfg", ".ini"}

跳过目录 = {"__pycache__", ".git", 出厂目录}
跳过后缀 = {".pyc", ".pyo", ".egg-info"}


def _版本():
    p = os.path.join(HERE, "forge", "__init__.py")
    with open(p, encoding="utf-8") as f:
        m = re.search(r'__version__\s*=\s*"([^"]+)"', f.read())
    return m.group(1) if m else "0"


def _相对路径们(根):
    """列出根下面所有文件的相对路径（跳过缓存与出厂目录本身）。"""
    out = []
    for 目录, 子目录们, 文件们 in os.walk(根):
        子目录们[:] = [d for d in 子目录们 if d not in 跳过目录 and not d.endswith(".egg-info")]
        for 名 in 文件们:
            if 名.endswith(tuple(跳过后缀)):
                continue
            p = os.path.join(目录, 名)
            out.append(os.path.relpath(p, 根).replace("\\", "/"))
    return sorted(out)


def 集合():
    """出厂集合：要装的全展开成相对路径。"""
    果 = []
    for 名 in 要装的文件:
        if os.path.exists(os.path.join(HERE, 名)):
            果.append(名.replace("\\", "/"))
    for 名 in 要装的目录:
        p = os.path.join(HERE, 名)
        if os.path.isdir(p):
            果 += [(名 + "/" + r).replace("\\", "/") for r in _相对路径们(p)]
    return sorted(set(果))


def 走查(根, 路径们=None):
    """扫一遍。返回 [(相对路径, 行号, 说明, 命中片段)]。"""
    命中 = []
    路径们 = 路径们 if 路径们 is not None else _相对路径们(根)
    for 相对 in 路径们:
        后缀 = os.path.splitext(相对)[1].lower()
        名 = os.path.basename(相对).lower()
        if 后缀 not in 文本后缀 and 名 != ".gitignore":
            continue
        p = os.path.join(根, 相对)
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                for i, 行 in enumerate(f, 1):
                    for 模式, 说明 in 红线:
                        m = re.search(模式, 行, re.I)
                        if m:
                            片段 = 行.strip()
                            if len(片段) > 90:
                                片段 = 片段[:90] + "…"
                            命中.append((相对, i, 说明, 片段))
        except OSError:
            continue
    return 命中


# ---------------------------------------------------------------- 装 / 打包

def _复制(相对, 到):
    src = os.path.join(HERE, 相对)
    dst = os.path.join(到, 相对)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


def _删树(路径):
    """删目录树 —— Windows 上 `.git` 里的对象文件是只读的，`shutil.rmtree` 会当场
    `PermissionError: [WinError 5] 拒绝访问`。照官方配方先改权限再删。"""
    def _放(func, 子):
        os.chmod(子, 0o700)
        func(子)
    try:
        shutil.rmtree(路径, onexc=lambda f, q, e: _放(f, q))
    except TypeError:                      # Python < 3.12 只认 onerror
        shutil.rmtree(路径, onerror=lambda f, q, e: _放(f, q))


def 安装(出):
    """把出厂集合复制到 `出`。

    ★ **保留已有的 `.git`** —— 重打出厂不该顺手毁掉出厂仓库，否则每重打一次都得
    重新 `git init` 再强推一回（第一版就是栽在这：装的时候整棵删，`.git` 没了，
    接着 `git -C 出厂/… add` 一路往上找到**开发仓库**的 `.git`，把出厂提交写进了
    开发仓库的历史）。"""
    藏 = None
    if os.path.isdir(出):
        点git = os.path.join(出, ".git")
        if os.path.isdir(点git):
            # ★ 藏在**同级**（`出` 外面）—— 藏在里面会被紧接着的 `_删树(出)` 一起删掉
            藏 = os.path.abspath(出).rstrip("\\/") + ".git.keep"
            if os.path.isdir(藏):
                _删树(藏)
            os.replace(点git, 藏)
        _删树(出)
    os.makedirs(出)
    if 藏:
        os.replace(藏, os.path.join(出, ".git"))
    for 相对 in 集合():
        _复制(相对, 出)
    return 出


def 打包(目录, 出zip=None):
    """把 `目录` 打成 zip（顶层套一层目录名）。

    ★ **不装 `.git`** —— 出厂目录里有独立仓库（`--仓库` 建的），`os.walk` 会连整个
    对象库一起塞进 zip（实测 1.7 MB → 3.8 MB）。zip 是给人下载的成品，不带版本库。"""
    出zip = 出zip or (目录.rstrip("\\/") + ".zip")
    固定时间 = (2026, 10, 15, 0, 0, 0)  # 同一份内容每次打出来的 zip 逐字节相同
    with zipfile.ZipFile(出zip, "w", zipfile.ZIP_DEFLATED) as z:
        for 目录_, 子目录们, 文件们 in os.walk(目录):
            子目录们[:] = sorted(d for d in 子目录们 if d != ".git")
            for 名 in sorted(文件们):
                p = os.path.join(目录_, 名)
                内部 = os.path.join(os.path.basename(目录.rstrip("\\/")),
                                    os.path.relpath(p, 目录)).replace("\\", "/")
                信息 = zipfile.ZipInfo(内部, 固定时间)
                信息.compress_type = zipfile.ZIP_DEFLATED
                信息.external_attr = 0o644 << 16
                with open(p, "rb") as f:
                    z.writestr(信息, f.read())
    return 出zip


def _sha256(p, n=16):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for 块 in iter(lambda: f.read(1 << 20), b""):
            h.update(块)
    return h.hexdigest()[:n].upper()


# ---------------------------------------------------------------- 自检

def 自检():
    """不碰盘：只验集合本身立不立得住。返回 (过, [问题])。"""
    问题 = []
    要 = 集合()
    if not 要:
        问题.append("出厂集合是空的 —— 路径写错了？")
    for 名 in 要装的文件:
        if not os.path.exists(os.path.join(HERE, 名)):
            问题.append("该有的没有：%s" % 名)
    for 名 in 要装的目录:
        if not os.path.isdir(os.path.join(HERE, 名)):
            问题.append("该有的没有：%s/" % 名)
    # 不装的，一条都不许进集合
    for 禁 in 不装:
        禁 = 禁.replace("\\", "/")
        for 相对 in 要:
            if 相对 == 禁 or 相对.startswith(禁 + "/"):
                问题.append("禁区混进集合：%s（命中的禁令是 %s）" % (相对, 禁))
    # 集合里不许有缓存
    for 相对 in 要:
        if "__pycache__" in 相对 or 相对.endswith(".pyc"):
            问题.append("缓存混进集合：%s" % 相对)
    # 红线表本身要非空且每条都合法
    if len(红线) < 8:
        问题.append("红线表太短了，八成是被删过")
    for 模式, 说明 in 红线:
        try:
            re.compile(模式)
        except re.error as e:
            _ = e
            问题.append("红线正则写错了：%s（%s）" % (模式, 说明))
    # ★ 重打不许毁出厂仓库：在临时目录里放个假 `.git`，装一遍看它还在不在
    import tempfile
    with tempfile.TemporaryDirectory(prefix="forge_出厂_") as 窝:
        试 = os.path.join(窝, "试")
        os.makedirs(os.path.join(试, ".git"))
        with open(os.path.join(试, ".git", "HEAD"), "w", encoding="utf-8") as f:
            f.write("ref: refs/heads/main\n")
        安装(试)
        if not os.path.isfile(os.path.join(试, ".git", "HEAD")):
            问题.append("重打出厂会把出厂仓库的 .git 抹掉 —— 安装() 得先把 .git 挪开再放回来")
        if not os.path.isfile(os.path.join(试, "forge.py")):
            问题.append("安装() 没把 forge.py 放进去")
        # ★ zip 不许带 `.git`
        os.makedirs(os.path.join(试, ".git"), exist_ok=True)
        with open(os.path.join(试, ".git", "HEAD"), "w", encoding="utf-8") as f:
            f.write("ref: refs/heads/main\n")
        z = 打包(试, os.path.join(窝, "试.zip"))
        with zipfile.ZipFile(z) as zf:
            # 按**路径段**判，别用子串 —— `.gitignore` 里也有 `.git`
            坏 = [n for n in zf.namelist() if ".git" in n.split("/")]
        if 坏:
            问题.append("zip 里混进了版本库：%s" % 坏[:3])
    return (not 问题), 问题


# ---------------------------------------------------------------- main

def _打命中(命中, 上限=40):
    if not 命中:
        print("✔ 红线扫描：整包 0 命中")
        return
    print("✘ 红线扫描：%d 处命中 —— 拒绝出厂" % len(命中))
    for 相对, 行, 说明, 片段 in 命中[:上限]:
        print("   %s:%d  [%s]  %s" % (相对, 行, 说明, 片段))
    if len(命中) > 上限:
        print("   …… 还有 %d 处" % (len(命中) - 上限))


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--自检" in argv:
        过, 问题 = 自检()
        for q in 问题:
            print("✘ " + q)
        print("✔ 出厂自检：%d 项断言全过" % 8 if 过 else "✘ 出厂自检：%d 处问题" % len(问题))
        return 0 if 过 else 1

    过, 问题 = 自检()
    if not 过:
        for q in 问题:
            print("✘ " + q)
        print("✘ 出厂自检没过，先修集合")
        return 1

    版本 = _版本()
    命中 = 走查(HERE, 集合())
    _打命中(命中)

    if "--检查" in argv:
        print("（--检查：只扫描，什么都没落盘 · 集合 %d 个文件）" % len(集合()))
        return 1 if 命中 else 0
    if 命中:
        print("（一个字节都没写。先修上面的命中，再打。）")
        return 1

    出 = os.path.join(HERE, 出厂目录, "forge-%s" % 版本)
    安装(出)
    z = 打包(出)
    print("✔ 装好：%s（%d 个文件）" % (os.path.relpath(出, HERE), len(集合())))
    print("✔ 打包：%s · %d 字节 · sha256 %s"
          % (os.path.relpath(z, HERE), os.path.getsize(z), _sha256(z)))

    if "--远端" in argv:
        i = argv.index("--远端")
        地址 = (argv[i + 1] if i + 1 < len(argv) else "").strip()
        if not 地址:
            print("✘ --远端 后面要给仓库地址，例如：--远端 https://github.com/你/仓库.git")
            return 1
        os.makedirs(os.path.dirname(远端记录), exist_ok=True)
        with open(远端记录, "w", encoding="utf-8") as f:
            f.write(地址 + "\n")
        print("✔ 记下了出厂仓库地址：%s（下次 --仓库 会自动挂上 origin）" % 地址)

    if "--仓库" in argv:
        if os.path.isdir(os.path.join(出, ".git")):
            # 走 _删树：git 的对象文件在 Windows 上是只读的，裸 rmtree 会 WinError 5。
            _删树(os.path.join(出, ".git"))
        for cmd in (["git", "init", "-q", "-b", "main"],
                    ["git", "add", "-A"],
                    ["git", "commit", "-q", "-m",
                     "forge %s —— ElecKoi 制卡工具（出厂版本）" % 版本]):
            果 = subprocess.run(cmd, cwd=出, capture_output=True, text=True,
                                encoding="utf-8", errors="replace")
            if 果.returncode != 0:
                print("✘ %s 失败：%s" % (" ".join(cmd), (果.stderr or "").strip()))
                return 1
        print("✔ 已在出厂目录里建了独立仓库（单次提交、零历史）")
        地址 = ""
        if os.path.isfile(远端记录):
            with open(远端记录, encoding="utf-8") as f:
                地址 = f.read().strip()
        if 地址:
            果 = subprocess.run(["git", "remote", "add", "origin", 地址], cwd=出,
                                capture_output=True, text=True, encoding="utf-8",
                                errors="replace")
            if 果.returncode != 0:
                print("✘ 挂 origin 失败：%s" % (果.stderr or "").strip())
                return 1
            print("✔ origin 已挂上 %s" % 地址)
            print("   推：git -C %s push -u --force origin main"
                  % os.path.relpath(出, HERE))
        else:
            print("   推的时候：cd %s && git remote add origin <你的仓库> && git push -u origin main"
                  % os.path.relpath(出, HERE))
            print("   （用 `python 出厂.py --远端 <仓库地址>` 记一次，以后就不用再手挂 origin）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
