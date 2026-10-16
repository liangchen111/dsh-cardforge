# -*- coding: utf-8 -*-
"""把两侧的模块级名字各列一份（导出清单）。"""
import ast
import json
import pathlib
import subprocess

根 = pathlib.Path(r"E:\workGZQ\制卡工具")
t = ast.parse((根 / "forge.py").read_text(encoding="utf-8"))
名字 = []
for n in t.body:
    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        名字.append(n.name)
    elif isinstance(n, ast.Assign):
        for tg in n.targets:
            if isinstance(tg, ast.Name):
                名字.append(tg.id)

码 = "import('./forgejs/forge.mjs').then(m=>console.log(JSON.stringify(Object.keys(m).sort())))"
r = subprocess.run([r"D:\node.exe", "-e", 码], capture_output=True, text=True,
                   encoding="utf-8", cwd=str(根))
js = json.loads(r.stdout.strip())
线 = [
    "PY(%d): %s" % (len(名字), "  ".join(sorted(名字))),
    "",
    "JS(%d): %s" % (len(js), "  ".join(js)),
    "",
    "缺：%s" % "  ".join(sorted(set(名字) - set(js))),
    "多：%s" % "  ".join(sorted(set(js) - set(名字))),
]
(根 / "差分" / "_names.txt").write_text("\n".join(线) + "\n", encoding="utf-8", newline="\n")
print("ok")
