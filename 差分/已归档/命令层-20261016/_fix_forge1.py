# -*- coding: utf-8 -*-
"""第一轮自检红项修补（定点、带计数断言）。

1. forge.mjs：自检第 37 / 41 项把 `'试'` 当关键词传 —— CPython 那边 `关键词="试"`
   会按**码点逐字迭代**成 `['试']`，JS 的 `(或(关键词, [])).map` 会当场炸。
   这里照 CPython 的真实结果写死成 `['试']`（不改 content.mjs）。
2. forge.mjs：补 `ZOD` 静态导入（Python 是在 cmd_selftest 里 `from forge import zod`）。
3. scaffold.mjs:368：Python 是 `MODS.apply_modules(spec_path, names, project=proj, out=…)`，
   JS 侧误把「关键字参数」整体写成对象实参 ⇒ `project` 收到一个对象、`hud/` 永远找不到。
   这是**真 bug**（scaffold 语料没覆盖 `new_card(modules=…)`），改成位置实参。
4. scaffold.mjs:596：`M.ydump(新, spec_path)` 在 forgejs 里明确抛错 ⇒ 照全仓先例改 `M.jdump`
   （文件名一个字不改，`_树()` 对 `.spec.` 走结构比较）。同样属于真 bug（source= 那条路走不通）。
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

根 = Path(r"E:\workGZQ\制卡工具")


def 换(p: Path, 组: list[tuple[str, str, int]]) -> None:
    文 = p.read_text(encoding="utf-8")
    for 旧, 新, 次 in 组:
        n = 文.count(旧)
        assert n == 次, f"{p.name}: 命中 {n} 处，期望 {次} 处 —— {旧[:60]!r}"
        文 = 文.replace(旧, 新)
    p.write_text(文, encoding="utf-8", newline="")
    print(f"{p.name} 改好（{len(文.encode('utf-8'))} 字节）")


换(根 / "forgejs" / "forge.mjs", [
    ("'正文 ' + t, '试', null, null, _P)", "'正文 ' + t, ['试'], null, null, _P)", 2),
    ("import * as exportMod from './lib/export.mjs'",
     "import * as exportMod from './lib/export.mjs'\nimport * as ZOD from './lib/zod.mjs'", 1),
])

换(根 / "forgejs" / "lib" / "scaffold.mjs", [
    ("MODS.apply_modules(spec_path, names, { project: proj, out: quiet ? _无 : _print })",
     "MODS.apply_modules(spec_path, names, proj, quiet ? _无 : _print)", 1),
    ("  // ★ 移植记号：forgejs 的 `M.ydump` 是抛错（见文件头第 2 条）——这条路要等 YAML 写出器。\n  M.ydump(新, spec_path)",
     "  // ★ 移植记号：forgejs 的 `M.ydump` 是抛错（见文件头第 2 条）⇒ 照全仓先例改走 `M.jdump`，\n"
     "  //   文件名一个字不改（`差分` 的 `_树()` 对 `.spec.` 文件走 `M.loadStructured` 结构比较，不比字节）。\n"
     "  M.jdump(新, spec_path)", 1),
])

for 名 in ("F", "G"):
    p = 根 / "差分" / f"_st_part{名}.js"
    换(p, [("'正文 ' + t, '试', null, null, _P)", "'正文 ' + t, ['试'], null, null, _P)", 1)])
