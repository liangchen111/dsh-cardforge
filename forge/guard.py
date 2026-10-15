# -*- coding: utf-8 -*-
"""forge/guard.py —— 只读禁区名单（任何写操作落盘前都要先问它）

这份名单原来长在 `forge/ui.py`（图形工作台）里。工作台已迁出（见工程根的
`弃用/工作台/`），但「**哪些目录一个字都不许写**」这件事跟工作台没关系 ——
命令行同样要守（`forge.py import` 往外落盘前会问这里）。所以把它提进内核。

名单有三处，**全是用户可配的，代码里不带任何人的私有路径**：

  · `FORGE_READONLY` 环境变量：一次一个或多个路径，用系统路径分隔符隔开
    （Windows 是 `;`，macOS / Linux 是 `:`）。临时用、给 CI 用都合适。
  · `只读名单.txt`（工程根，一行一个绝对路径，`#` 起头是注释）：
    想长期设防又不想动代码，写这里。**这份文件属于本机配置，在 `.gitignore` 里**。
  · `MARKER`（`.只读`）：某个目录里放一个这个名字的空文件 = 整个目录按只读处理。
    最省事的开关，随手一放就生效，连名单都不用维护。

命中任何一条，写操作直接拒绝。
"""
from __future__ import annotations

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 本机名单文件（工程根）＋ 环境变量名
LIST_FILE = "只读名单.txt"
ENV = "FORGE_READONLY"
# 目录里放着这个空文件 = 整个目录按只读处理（给用户的通用开关）
MARKER = ".只读"


def _norm(p):
    return os.path.normcase(os.path.abspath(str(p)))


def readonly_paths():
    """当前生效的只读禁区（绝对路径列表）。每次现读 —— 改完名单立刻生效。"""
    out = []
    for part in (os.environ.get(ENV) or "").split(os.pathsep):
        part = part.strip().strip('"')
        if part:
            out.append(part)
    path = os.path.join(ROOT, LIST_FILE)
    if os.path.isfile(path):
        # 名单可能有中文路径 —— 显式点名 utf-8（Windows 默认是 GBK）
        with open(path, encoding="utf-8-sig") as fh:
            for line in fh:
                line = line.split("#", 1)[0].strip().strip('"')
                if line:
                    out.append(line)
    return out


def readonly_reason(path):
    """要写这个路径的话，给个拒绝理由；能写返回 None。"""
    p = _norm(path)
    for r in readonly_paths():
        rr = _norm(r)
        if p == rr or p.startswith(rr + os.sep):
            return ("「%s」在只读禁区名单上 —— 它是只读参考，本工具对它只许看、不许动。"
                    % (r if os.path.isabs(r) else os.path.basename(r)))
    # 从落点往上找，看哪一层放了 `.只读` 标记
    d = p
    while True:
        if os.path.isfile(os.path.join(d, MARKER)):
            return "「%s」里有 `%s` 标记 —— 整个目录按只读处理。" % (d, MARKER)
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return None
