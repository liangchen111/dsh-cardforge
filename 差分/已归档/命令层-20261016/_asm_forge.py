# -*- coding: utf-8 -*-
"""把 cfg 自检段（_st_pre.js + _st_partA..G.js）拼进 forgejs/forge.mjs。

- 插在 `// ----…---- selftest` 标记行之后（紧挨 `_常驻字数` 之前）。
- 预置文件里的 `_读文本` 与 forge.mjs:78 的同名函数等价，这里丢掉预置版，避免重复声明。
- 换行风格跟随目标文件（先探测 CRLF/LF）。
"""
import io
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

根 = Path(r"E:\workGZQ\制卡工具")
差分 = 根 / "差分"
目标 = 根 / "forgejs" / "forge.mjs"

文 = 目标.read_text(encoding="utf-8")
assert "export function cmd_selftest" not in 文, "cmd_selftest 已经在了，别插第二遍"

import re
找 = re.findall(r"// -+ selftest", 文)
assert len(找) == 1, f"selftest 标记不是恰好一处：{找}"
标记 = 找[0]

预 = (差分 / "_st_pre.js").read_text(encoding="utf-8")
丢 = """/** `open(p, 'r', encoding='utf-8').read()` —— Python 默认通用换行（CRLF/CR → LF）。 */
function _读文本(p) {
  return readFileSync(p, 'utf8').split('\\r\\n').join('\\n').split('\\r').join('\\n')
}

"""
assert 预.count(丢) == 1, "预置里的 _读文本 尾部文本对不上"
预 = 预.replace(丢, "")

段 = []
for 名 in "ABCDEFG":
    p = 差分 / f"_st_part{名}.js"
    assert p.is_file(), f"缺 {p}"
    段.append(p.read_text(encoding="utf-8").rstrip() + "\n")

块 = 预.rstrip() + "\n\n" + "".join(段)

# 换行风格跟随目标
if "\r\n" in 文:
    块 = 块.replace("\r\n", "\n").replace("\n", "\r\n")

i = 文.index(标记)
j = 文.index("\n", i) + 1
新 = 文[:j] + "\n" + 块 + 文[j:]
目标.write_text(新, encoding="utf-8", newline="")
print(f"forge.mjs 自检段落盘：{len(新.encode('utf-8'))} 字节（块 {len(块.encode('utf-8'))} 字节）")
