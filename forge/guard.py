# -*- coding: utf-8 -*-
"""forge/guard.py —— 只读禁区名单（任何写操作落盘前都要先问它）

这份名单原来长在 `forge/ui.py`（图形工作台）里。工作台已迁出（见工程根的
`弃用/工作台/`），但「**哪些目录一个字都不许写**」这件事跟工作台没关系 ——
命令行同样要守（`forge.py import` 往外落盘前会问这里）。所以把它提进内核。

名单有两处：

  · `READONLY`：写死的绝对路径（`E:\\workGZQ\\艾瑟兰` —— 那是另一个会话在维护的
    实卡，本工具对它只许看、不许动）。
  · `MARKER`（`.只读`）：某个目录里放一个这个名字的空文件 = 整个目录按只读处理。
    它是给用户的一个「不用改代码就能设防」的开关。
"""
from __future__ import annotations

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 只读禁区（绝对路径）。命中任何一个，写操作直接拒绝。
READONLY = [os.path.join(os.path.dirname(ROOT), "艾瑟兰")]
# 目录里放着这个空文件 = 整个目录按只读处理（给用户的通用开关）
MARKER = ".只读"


def _norm(p):
    return os.path.normcase(os.path.abspath(str(p)))


def readonly_reason(path):
    """要写这个路径的话，给个拒绝理由；能写返回 None。"""
    p = _norm(path)
    for r in READONLY:
        rr = _norm(r)
        if p == rr or p.startswith(rr + os.sep):
            return ("「%s」在只读禁区名单上 —— 它是只读参考，本工具对它只许看、不许动。"
                    % os.path.basename(r))
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
