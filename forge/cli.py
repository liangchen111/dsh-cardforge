"""安装入口：让 `pip install -e .` 之后的 `forge` 命令能用。

为什么要有这个文件：这个仓库里 CLI 的**实体**是根目录的 `forge.py`，
而 `forge/` 是它的内核包 —— 两个同名。Python 会优先认**包**（目录带 `__init__.py`），
所以 `import forge` 拿到的是内核包，不是 CLI；`forge.py` 只能当脚本裸跑。

于是这里不搬那三千行，只干一件事：**找到仓库根，按脚本方式把 `forge.py` 跑起来**。
这样三条路同时活着 —— `python forge.py …`（老文档 / 老习惯 / `forge.py:1888` 的自调用）、
`python -m forge …`（见 `forge/__main__.py`）、`forge …`（装过之后）。

搬到包里会让上面第一条和第二条自相矛盾，所以选了这个薄壳。
"""

import os
import runpy
import sys


def 仓库根():
    """`<根>/forge/cli.py` → `<根>`；找不到 `forge.py` 就报清楚。"""
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    if os.path.isfile(os.path.join(root, "forge.py")):
        return root
    raise SystemExit(
        "找不到 forge.py（应当在 %s 下）。\n"
        "本工具是「一个文件夹」的整体：assets/、samples/、向导/ 与 forge.py 要在一起。\n"
        "请用可编辑安装 `pip install -e .`，或直接用 `python forge.py <命令>`。" % root)


def main(argv=None):
    root = 仓库根()
    if argv is not None:
        sys.argv = [os.path.join(root, "forge.py")] + [str(a) for a in argv]
    # run_path 会执行 forge.py 底部的 `if __name__ == "__main__": sys.exit(main())`
    runpy.run_path(os.path.join(root, "forge.py"), run_name="__main__")
    return 0
