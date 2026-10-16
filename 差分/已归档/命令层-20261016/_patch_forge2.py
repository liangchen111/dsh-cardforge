# -*- coding: utf-8 -*-
"""把 forge 收进差分台：两侧各加一个 `算_forge` 并注册进 `算式`。

★ 定点替换：每处都断言命中次数，绝不整文件覆盖。
"""
from __future__ import annotations

import sys
from pathlib import Path

根 = Path(__file__).resolve().parent.parent
差分 = 根 / "差分"

PY_ANCHOR = "def main(argv):\n    要跑的 = argv[1:] or sorted(算式)"

PY_FORGE = '''def 算_forge(料: dict) -> dict:
    """`forge.py` —— 命令行入口（33 条命令）逐条走一遍 `main(argv)`。

    ★ 走 `forge.cli.main`（＝`runpy.run_path("forge.py", run_name="__main__")`）：
      `forge\\cli.py` 与 `forge\\__main__.py` 就是这么落地的，把它抛出的 `SystemExit`
      折成**退出码** —— JS 侧 `cli.mjs` 的 `main` 直接 `return` 那个码，两侧同一个数。
    ★ 每条命令都 `chdir` 到临时目录里跑（语料 argv 全是相对路径）：`plan` / `guide` /
      `mods` / `theme` 的「--help」就是它们的**空参分支**，会真的把模板或清单打出来、
      也可能往 cwd 落文件 —— 一律落进临时目录，**绝不碰工具根**。
    ★ 临时目录建在**差分目录**底下（同 算_scaffold：系统 temp 的 8.3 短名会让两侧
      路径归一后对不上）。
    ★ 新条目 id 是 `前缀-32位十六进制`（随机）：先按 `[0-9a-f]{32}` 折成 `<hex32>`，
      再走 `_净文本` 的 8 位规则 —— 顺序反过来就折不动了（32 位后面还跟着十六进制，
      `_文本8` 的 `(?![0-9a-f])` 不认）。
    """
    import contextlib
    import io as _io
    import shutil

    from forge import cli as CLI
    from forge import sandbox as SBB

    这里 = Path(__file__).resolve().parent
    原cwd = os.getcwd()
    原沙箱 = SBB.enabled()
    SBB.enable(False)
    情形们 = []

    def 折32(s):
        return re.sub(r"[0-9a-f]{32}", "<hex32>", s)

    def 码(exc):
        c = getattr(exc, "code", None)
        if c is None:
            return 0
        return int(c) if isinstance(c, int) else 1

    try:
        for 情形 in 料["情形"]:
            工作 = Path(tempfile.mkdtemp(prefix="_tmp_forge-", dir=str(这里)))
            try:
                os.chdir(工作)
                出 = {"名": 情形["名"], "步": []}
                for 步 in 情形["步"]:
                    原参 = 步.get("argv")
                    argv = [] if 原参 is None else [str(a) for a in 原参]
                    rec = {"argv": _动(argv), "回": None, "错": None}
                    buf = _io.StringIO()
                    try:
                        with contextlib.redirect_stdout(buf):
                            CLI.main(list(argv))
                        rec["回"] = 0
                    except SystemExit as exc:
                        rec["回"] = 码(exc)
                    except Exception as exc:  # noqa: BLE001
                        rec["回"] = None
                        rec["错"] = 错文本("main", exc)
                    rec["出"] = 折32(_净文本(buf.getvalue()))
                    出["步"].append(rec)
            finally:
                os.chdir(原cwd)
                shutil.rmtree(工作, ignore_errors=True)
            情形们.append(
                _换路径(
                    出,
                    [
                        (str(工作), "<工作>"),
                        (str(工作).replace("\\\\", "\\\\\\\\"), "<工作>"),
                        (str(工作).lower(), "<工作>"),
                        (str(工作).lower().replace("\\\\", "\\\\\\\\"), "<工作>"),
                    ],
                )
            )
    finally:
        os.chdir(原cwd)
        SBB.enable(原沙箱)
    return {"情形": 情形们}


算式["forge"] = 算_forge


'''

JS_IMPORT_ANCHOR = """  GU = await import('../forgejs/lib/guard.mjs')
} catch (e) {
  GU = null
}
"""

JS_IMPORT_NEW = """  GU = await import('../forgejs/lib/guard.mjs')
} catch (e) {
  GU = null
}

// forge：命令行的实体（33 条命令）与它的安装薄壳 `cli.mjs`。
// `算_forge` 走 `CLI.main(argv)` —— 这一路同时盖住 `forge\\cli.py` 与 `forge\\__main__.py`。
let FG = null
try {
  FG = await import('../forgejs/forge.mjs')
} catch (e) {
  FG = null
}
let CLI = null
try {
  CLI = await import('../forgejs/cli.mjs')
} catch (e) {
  CLI = null
}
"""

JS_RUNNER_ANCHOR = "const 要跑的 = process.argv.slice(2)"

JS_FORGE = '''async function 算_forge(料) {
  // `forge.py`（33 条命令）逐条走一遍 —— 与 Python 侧 `算_forge` 同构：
  //   · 每条命令都 chdir 到**差分目录底下的**临时目录里跑，argv 全是相对路径；
  //   · 走 `CLI.main(argv)`（＝`cli.mjs` → 动态 import `forge.mjs` → 它的 `main`），
  //     把返回值（退出码）原样记下 —— Python 侧 `runpy` 抛的 `SystemExit` 也折成同一个数；
  //   · stdout 用换 `process.stdout.write` 收，收完过 `净文本` 与 32 位十六进制折叠。
  const 原cwd = process.cwd()
  const 原沙箱 = SB.enabled()
  SB.enable(false)
  const 情形们 = []
  const 折32 = (s) => String(s).replace(/[0-9a-f]{32}/g, '<hex32>')
  try {
    for (const 情形 of 料['情形']) {
      const 工作 = mkdtempSync(join(这里, '_tmp_forge-'))
      try {
        process.chdir(工作)
        const 出 = { 名: 情形['名'], 步: [] }
        for (const 步 of 情形['步']) {
          // `argv` 缺省＝空数组（`main([])` 打总表）；`'argv' in 步` 才是判据，不能用 `??`。
          const 原参 = 步['argv']
          const argv = 原参 === undefined || 原参 === null ? [] : Array.from(原参, String)
          const rec = { argv: 动(argv), 回: null, 错: null }
          let 出文 = ''
          const 原写 = process.stdout.write.bind(process.stdout)
          process.stdout.write = (s) => {
            出文 += String(s)
            return true
          }
          try {
            const 回 = await CLI.main(argv)
            rec.回 = 动(回 === undefined ? null : 回)
          } catch (e) {
            rec.回 = null
            rec.错 = 错文本('main', e)
          } finally {
            process.stdout.write = 原写
          }
          rec.出 = 折32(净文本(出文))
          出.步.push(rec)
        }
        情形们.push(
          换路径(出, [
            [工作.split('\\\\').join('/'), '<工作>'],
            [工作, '<工作>'],
            [工作.split('\\\\').join('\\\\\\\\'), '<工作>'],
            [工作.split('\\\\').join('\\\\\\\\').replace(/\\\\/g, '/'), '<工作>'],
            [工作.toLowerCase(), '<工作>'],
            [工作.toLowerCase().split('\\\\').join('\\\\\\\\'), '<工作>'],
          ]),
        )
      } finally {
        process.chdir(原cwd)
        rmSync(工作, { recursive: true, force: true })
      }
    }
  } finally {
    process.chdir(原cwd)
    SB.enable(原沙箱)
  }
  return { 情形: 情形们 }
}

算式.forge = 算_forge

'''


def 补(path: Path, 旧: str, 新: str, 名: str):
    文 = path.read_text(encoding="utf-8")
    n = 文.count(旧)
    if n != 1:
        raise SystemExit("!! %s：锚点命中 %d 次（要 1 次）" % (名, n))
    path.write_text(文.replace(旧, 新), encoding="utf-8", newline="\n")
    print("补好 %s" % 名)


def 主():
    p = 差分 / "出黄金.py"
    文 = p.read_text(encoding="utf-8")
    if "算式[\"forge\"] = 算_forge" in 文:
        print("出黄金.py 已经有 算_forge，跳过")
    else:
        补(p, PY_ANCHOR, PY_FORGE + PY_ANCHOR, "出黄金.py 插入 算_forge")

    p = 差分 / "比一比.mjs"
    文 = p.read_text(encoding="utf-8")
    if "算式.forge = 算_forge" in 文:
        print("比一比.mjs 已经有 算_forge，跳过")
    else:
        补(p, JS_IMPORT_ANCHOR, JS_IMPORT_NEW, "比一比.mjs 插入 FG/CLI 导入")
        补(p, JS_RUNNER_ANCHOR, JS_FORGE + JS_RUNNER_ANCHOR, "比一比.mjs 插入 算_forge")

    p = 差分 / "比一比.mjs"
    文 = p.read_text(encoding="utf-8")
    旧 = "const js文本 = JSON.stringify(算式[名](料), null, 2)"
    新 = "const js文本 = JSON.stringify(await 算式[名](料), null, 2)"
    if 旧 in 文:
        if 文.count(旧) != 1:
            raise SystemExit("!! 主循环锚点不止一处")
        p.write_text(文.replace(旧, 新), encoding="utf-8", newline="\n")
        print("补好 比一比.mjs 主循环 await")
    else:
        print("比一比.mjs 主循环已经是 await")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    主()
