# -*- coding: utf-8 -*-
"""复现 `hud 探卡` 一步：Python 侧返回 0，JS 侧返回 1。"""
import contextlib
import io
import os
import pathlib
import runpy
import sys
import tempfile

根 = pathlib.Path(r"E:\workGZQ\制卡工具")
sys.path.insert(0, str(根))
from forge import cli as CLI  # noqa: E402

tmp = tempfile.mkdtemp(prefix="_tmp_probe_hud-", dir=str(根 / "差分"))
os.chdir(tmp)


def run(argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            rc = CLI.main(argv)
        except SystemExit as exc:
            rc = exc.code
    return rc, buf.getvalue()


rc1, o1 = run(["new", "探卡", "--到", ".", "--id", "fix"])
print("new rc=", rc1)
rc2, o2 = run(["hud", "探卡"])
print("hud rc=", rc2)
pathlib.Path(str(根 / "差分" / "_probe_hud_py.txt")).write_text(
    "rc=%s\n%s" % (rc2, o2), encoding="utf-8", newline="\n")
