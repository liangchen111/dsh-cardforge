# -*- coding: utf-8 -*-
"""把 ntpath 的六个函数在**一大批串**上的返回值落成 JSON，供 JS 侧逐条对拍。
一次性探针，用完即删。"""
import json
import ntpath
import os
import sys

串 = [
    "", "a", "a/b", "a\\b", "a/b\\c", "a\\b/",
    "/", "\\", "//", "\\\\", "///", "\\\\\\",
    ".", "..", "...", "....",
    "a.", "a..", "a...", ".a", "..a", "...a", ".a.", "a.b", "a.tar.gz",
    ".皮肤", "..皮肤", "皮肤.txt", "皮肤", "a/b.c/d", "a.b/c", "a.b\\c.d",
    "a/b/", "a\\b\\", "a/", "a\\", "/a", "\\a", "/a/", "\\a\\",
    "C:", "C:a", "C:/a", "C:\\a", "C:\\a\\", "C:\\", "C:/", "C:a\\b",
    "c:x", "Z:..", "C:..\\a",
    "\\\\srv", "\\\\srv\\", "\\\\srv\\share", "\\\\srv\\share\\",
    "\\\\srv\\share\\a", "\\\\srv\\share\\a\\b", "\\\\srv\\share\\a.txt",
    "//srv/share/a", "\\\\?\\C:\\a", "\\\\?\\C:\\",
    "a/./b", "a/../b", "a//b", "a\\\\b", "./a", "../a", "a/..", "a/../..",
]
# 造一批「长尾 + 各段组合」的笛卡尔样本，专打 dirname/basename 的尾分隔符与盘符分支
for 头 in ["", "C:", "C:\\", "\\\\srv\\share", "/", "\\", "//", "a", "a/", "a\\"]:
    for 尾 in ["", "x", "x/", "x\\", "/x", "\\x", ".", "..", ".x", "a.b", "x/y", "x\\y"]:
        if 头 + 尾 not in 串:
            串.append(头 + 尾)

出 = {}
for s in 串:
    _ = None
    rec = {}
    try:
        rec["basename"] = ntpath.basename(s)
    except Exception as e:
        rec["basename"] = "%s: %s" % (type(e).__name__, e)
    try:
        rec["dirname"] = ntpath.dirname(s)
    except Exception as e:
        rec["dirname"] = "%s: %s" % (type(e).__name__, e)
    try:
        rec["splitext"] = list(ntpath.splitext(s))
    except Exception as e:
        rec["splitext"] = "%s: %s" % (type(e).__name__, e)
    try:
        rec["splitdrive"] = list(ntpath.splitdrive(s))
    except Exception as e:
        rec["splitext2"] = "%s: %s" % (type(e).__name__, e)
    try:
        rec["join_cwd"] = ntpath.join(os.getcwd(), s) if s else ntpath.join(os.getcwd(), s)
    except Exception as e:
        rec["join_cwd"] = "%s: %s" % (type(e).__name__, e)
    try:
        rec["abspath"] = os.path.abspath(s)
    except Exception as e:
        rec["abspath"] = "%s: %s" % (type(e).__name__, e)
    try:
        rec["normpath"] = ntpath.normpath(s)
    except Exception as e:
        rec["normpath"] = "%s: %s" % (type(e).__name__, e)
    出[s] = rec

# join 的两段组合样本（plan.py 只用 _join(cwd, s)，但归一函数本身要核到）
两段 = []
for a in ["", "a", "a\\", "a/", "C:", "C:\\", "C:/", "/", "\\", "//", "\\\\",
          "\\\\srv\\share", "\\\\srv\\share\\", "E:\\x", "E:\\x\\", "Z:"]:
    for b in ["", "b", "b\\", "b/", "/b", "\\b", ".", "..", "C:", "C:b", "D:\\b",
              "D:/b", "\\\\srv\\share", "//srv/share", "E:\\y", "e:\\y", "/"]:
        两段.append([a, b])
for 组 in [("", "a", "b"), ("C:", "", "b"), ("E:\\x", "", "a"), ("a", "b", "c"),
           ("C:", "b", "c"), ("a", "/b", "c"), ("\\\\srv\\share", "a", "b")]:
    两段.append(list(组))
出_join = []
for 组 in 两段:
    try:
        v = ntpath.join(*组)
    except Exception as e:
        v = "%s: %s" % (type(e).__name__, e)
    出_join.append(list(组) + [v])

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_probe_plan_tmp", "python_path.json"),
          "w", encoding="utf-8", newline="\n") as f:
    json.dump({"串": 出, "两段": 出_join, "cwd": os.getcwd()}, f, ensure_ascii=False, indent=1)
print("样本数", len(出), "join 对", len(出_join), "cwd", os.getcwd())
