"""`python -m forge <命令>` 的入口，等价于 `python forge.py <命令>`。"""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
