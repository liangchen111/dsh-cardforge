# -*- coding: utf-8 -*-
"""给 forge 语料补一步 `build`。

为什么：`new` 只组装界面层（预览页 / hud），**不落 `成品/探卡.card.json`**；
`plan` 与 `analyze` 那两步都指着成品卡。少了这张卡，两边比的就不是命令行为，
而是「文件不存在时报什么」—— CPython 给 `[Errno 2] No such file or directory: '相对路径'`，
Node 给 `ENOENT: no such file or directory, open '绝对路径'`。那属于本移植
**没有覆盖**的一支（全仓没有 Node OSError → CPython OSError 的通用翻译层），
不该混进语料当成红项。补上 build 之后两步都走真路径。
"""
import pathlib
import sys

P = pathlib.Path(r"E:\workGZQ\制卡工具\差分\语料\forge.json")
raw = P.read_text(encoding="utf-8")
old = '{ "argv": ["new", "探卡", "--到", ".", "--id", "fix"] },'
new = ('{ "argv": ["new", "探卡", "--到", ".", "--id", "fix"] },\n'
       '        { "argv": ["build", "探卡/source/探卡.spec.yaml", "探卡/成品/探卡.card.json"] },')
n = raw.count(old)
print("hit", n)
if n != 1:
    sys.exit("anchor hit != 1")
P.write_text(raw.replace(old, new), encoding="utf-8", newline="")
print("patched")
