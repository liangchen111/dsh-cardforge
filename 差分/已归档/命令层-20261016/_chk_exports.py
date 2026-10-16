# -*- coding: utf-8 -*-
"""列出 forge.py 的模块级名字（def / class / 赋值）与 forge.mjs 的导出名，做差。"""
import ast
import io
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

PY = r"E:\workGZQ\制卡工具\forge.py"
MJS = r"E:\workGZQ\制卡工具\forgejs\forge.mjs"
NODE = r"D:\node.exe"

tree = ast.parse(io.open(PY, encoding="utf-8").read())
py = []
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        py.append(node.name)
    elif isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name):
                py.append(t.id)
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        py.append(node.target.id)

js_src = (
    "const m = await import('file:///E:/workGZQ/制卡工具/forgejs/forge.mjs');"
    "for (const k of Object.keys(m).sort()) console.log(k);"
)
out = subprocess.run([NODE, "--input-type=module", "-e", js_src],
                     capture_output=True, text=True, encoding="utf-8")
if out.returncode != 0:
    print(out.stdout)
    print(out.stderr)
    raise SystemExit("!! 动态 import forge.mjs 失败")
js = [ln for ln in out.stdout.splitlines() if ln.strip()]

print("forge.py 模块级名字 %d 个；forge.mjs 导出 %d 个" % (len(py), len(js)))
miss = [n for n in py if n not in js]
extra = [n for n in js if n not in py]
print("\n== Python 有、JS 没导出（必须为空）==")
for n in miss:
    print("  " + n)
print("\n== JS 多导出（允许，多为移植辅助）==")
for n in extra:
    print("  " + n)
