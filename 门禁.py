# -*- coding: utf-8 -*-
"""门禁 —— 发布 / 改完代码之后跑这一条就够。

    python 门禁.py          # 全跑
    python 门禁.py --快      # 跳过 selftest（改文档时用）

三道闸，各管一件事：

| 闸 | 防的是什么 |
| --- | --- |
| `selftest` | 四十二项内核自检：值域、往返、护栏 —— 改坏了当场红 |
| 单测 `tests/` | 产物级硬口径：客户端白名单、往返逐字节、预设不压缩 |
| 确定性 | 同一份输入跑两遍**字节必须相同** —— 这条挂了，别人没法核对你的产物 |

**为什么把确定性单列一道闸**：`gzip.compress(..., mtime=0)` 与写死的时间戳
不是「讲究」，是**可核对的前提**：产品的 sha256 一旦随运行时间变，
用户拿到的东西就没人能复现，出问题也无法二分。
"""

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

样例卡 = os.path.join(ROOT, "向导", "制卡助手", "成品", "制卡助手.card.json")


def _sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()


def _读(p):
    with open(p, "rb") as f:
        return f.read()


def 跑命令(名, argv):
    print("\n" + "=" * 68)
    print("▌%s" % 名)
    print("=" * 68)
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    got = subprocess.run(argv, cwd=ROOT, env=env, capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    body = (got.stdout or "") + (got.stderr or "")
    print(body.rstrip())
    ok = got.returncode == 0
    print("→ %s（rc=%d）" % ("过" if ok else "★ 不过", got.returncode))
    return ok, body


def 闸_确定性():
    print("\n" + "=" * 68)
    print("▌确定性　同一份输入跑两遍，字节必须相同")
    print("=" * 68)
    if not os.path.isfile(样例卡):
        print("→ 跳过（没找到样例卡 %s）" % 样例卡)
        return True, "跳过"
    from forge import png as PNG, preset as PRESET

    tmp = tempfile.mkdtemp(prefix="menjin-")
    try:
        好 = True
        话 = []
        # ① 卡图
        a = PNG.write(样例卡, os.path.join(tmp, "a.png"), quiet=True, out=lambda *_: None)["sha256"]
        b = PNG.write(样例卡, os.path.join(tmp, "b.png"), quiet=True, out=lambda *_: None)["sha256"]
        same = a == b
        好 &= same
        print("卡图  %s  a=%s b=%s" % ("✔ 一致" if same else "★ 不一致", a[:16], b[:16]))
        话.append("card.png=%s" % a[:16])
        # ② 预设
        c = _sha(_读(PRESET.build(样例卡, out_path=os.path.join(tmp, "a.preset.json"),
                                  quiet=True, out=lambda *_: None)["json"]))
        d = _sha(_读(PRESET.build(样例卡, out_path=os.path.join(tmp, "b.preset.json"),
                                  quiet=True, out=lambda *_: None)["json"]))
        same2 = c == d
        好 &= same2
        print("预设  %s  a=%s b=%s" % ("✔ 一致" if same2 else "★ 不一致", c[:16], d[:16]))
        话.append("preset.json=%s" % c[:16])
        print("→ %s" % ("过" if 好 else "★ 不过"))
        return 好, " ".join(话)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    快 = "--快" in argv or "-q" in argv
    sys.path.insert(0, ROOT)
    try:
        from forge import __version__ as 版本
    except Exception:
        版本 = "?"

    print("forge 门禁 · v%s · %s" % (版本, ROOT))
    结果 = []
    if not 快:
        结果.append(("selftest", 跑命令("闸一 · 内核自检", [sys.executable, "forge.py", "selftest"])))
    结果.append(("单测", 跑命令("闸二 · 独立单测", [sys.executable, "-m", "unittest", "discover", "-s", "tests"])))
    结果.append(("确定性", 闸_确定性()))

    print("\n" + "=" * 68)
    print("▌合计")
    print("=" * 68)
    坏 = 0
    for 名, (ok, _) in 结果:
        print("  %-8s %s" % (名, "✔ 过" if ok else "★ 不过"))
        坏 += 0 if ok else 1
    print("  —— %d 道闸，%d 道不过" % (len(结果), 坏))
    return 1 if 坏 else 0


if __name__ == "__main__":
    sys.exit(main())
