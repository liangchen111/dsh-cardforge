# 接手：把制卡引擎从 Python 重写成零依赖 ESM

> 给**新会话**用。读这一页就够，不需要旧会话的记忆。
> 详细计划在 `E:\workGZQ\制卡工具\文档\重写-JS引擎-计划.md`（§七 约定 · §八 状态）。

## 一句话目标

引擎现在是一万六千行 Python（`E:\workGZQ\制卡工具\forge.py` 3,106 行 ＋ `forge\` 27 个模块 13,083 行）。
手机端 ElecKoi 的 proot Ubuntu 里**没有 python3**（实测只有 `apt`/`dpkg`），所以插件装得上、一调就死。
要把引擎搬成**零依赖 ESM**，让手机端那个 DSH 宿主直接跑。

- 手机端运行时里的 Node 是 **v24.19.0** ⇒ `node:zlib` 的 `deflateSync` / `gzipSync` / `crc32` 都能用 ⇒ **PNG 不用自己实现**。
- 整份引擎的非标准库依赖**只有 `yaml`**，且只在 `forge\model.py` 与 `forge\lint.py` 出现。
- 插件形态（手机端实测）：`manifest.json` ＋ `cordis.yml` ＋ **纯 `.mjs`**，**没有 npm / package.json / 依赖声明**。桌面端继续用现在的 npm bundle，**同一个仓库出两种壳**。

## 现状（12/27 个模块逐字节绿）

| 模块 | JS | 差分 |
|---|---|---|
| `model` | `forgejs\lib\model.mjs` | ✔ 3,864 字节 |
| `domain` | `forgejs\lib\domain.mjs` | ✔ 7,975 字节 |
| `zod` | `forgejs\lib\zod.mjs` | ✔ 2,661 字节 |
| `pack` | `forgejs\lib\pack.mjs` | ✔ 136,436 字节（3 份语料） |
| `validate` | `forgejs\lib\validate.mjs` | ✔ 29,091 字节（**47/47 种诊断 code 全覆盖**） |
| YAML 子集读取器 | `forgejs\lib\yaml.mjs`（`model.yload` 走它） | ✔ 109,826 字节（结构相等 · 10 份语料） |
| `sandbox` | `forgejs\lib\sandbox.mjs` | ✔ 5,397 字节（模式关／开各跑一遍） |
| `content` | `forgejs\lib\content.mjs` | ✔ 94,122 字节（30+ 步操作 ＋ 整棵工程树） |
| `opener` | `forgejs\lib\opener.mjs` | ✔ 228,776 字节（105 步 · 10 个夹具工程） |
| `scaffold` | `forgejs\lib\scaffold.mjs` | ✔ 331,130 字节（52 步 · 整棵工程树） |
| `draft` | `forgejs\lib\draft.mjs` | ✔ 59,823 字节（33 条预置 · 126 条操作） |
| `mods` | `forgejs\lib\mods.mjs` | ✔ 303,578 字节（9 份夹具 · 100 步操作） |

**在跑**：`bridge`（707 行）＋ `hud`（693 行）。`coach` 要等 `manual`，排在后面。

## 怎么跑

```
cd E:\workGZQ\制卡工具
python 差分\跑.py               # 一条命令跑全套逐字节比
python 差分\跑.py --刷          # 先用 Python 版刷黄金（只在确认行为变更时才跑）
python 差分\数覆盖.py           # 数「语料走到了源码里的哪些诊断 code」
```

- Python 解释器：`C:\Users\Administrator\.workbuddy\binaries\python\envs\cardforge\Scripts\python.exe`
  （3.13.14 ＋ PyYAML 6.0.3；**第一次调用可能报 `did not find executable at ...versions\3.13.12\python.exe`，
  重跑一次就好**，venv 基解释器是好的）
- Node：`D:\node.exe`（v24.14.0）
- 加语料：`差分\语料\<名>.json` 写输入；`出黄金.py` / `比一比.mjs` 各加一个 `算_<名>` 函数。

## 下一步（照顺序）

1. **在跑**：`bridge`(707) ＋ `hud`(693)，两个子代理并排。`coach`(1,353) 要等 `manual`(556)。
2. 之后按剩下来的**大小**排（别按计划 §四 那份旧批次表，它写的时候还没搬掉 `content`）：
   `coach`(1,353 · 最肥的一块) → `bridge`(707)／`hud`(693)／`theme`(592)／`manual`(556)／`preset`(500)
   → `export`(396)／`png`(384)／`dist`(373)／`lint`(293)／`plan`(262)／`bundle`(119)／`guard`(71)
   → 命令层（`cli.py` 37 ＋ `__main__.py` 8 ＋ `forge.py` 3,106 行 · 33 条命令，名字一个不改）。
   **`hud`(693) 要提前** —— `opener` 的 3 条分支（`写回` / 改正文时 `写回=true` / `补齐`界面档）与
   `scaffold` 的 `build_hud` 都因为它没搬而留成抛错，差分覆盖率缺口全卡在这。
   **行数以 Python 实测为准**（`forge/` 合计 13,134 行）—— 别用 PowerShell 的
   `(Get-Content 文件).Count`，它按 GBK 读 UTF-8，`draft.py` 会被数成 649（实际 815）。
3. 还欠着的两处：`content.restore()` 里那两处 `from . import opener as OP` 是**惰性导入**，
   `opener.mjs` 已落地但没回填，等命令层合拢时一起接；需要写 YAML 的调用点都得把 `M.ydump`
   改成 `M.jdump`（`opener.mjs` / `scaffold.mjs` 已这么做）。
4. **子代理派工单必须写死**：验收标准是 `python 差分\跑.py` **全绿**（不是「我那个模块绿就行」）；
   临时目录建在 `差分\` 底下（系统 temp 可能是 8.3 短名，路径归一对不上）；不许改 `forge\` 下任何 Python。
   **父级收工前必须自己复核**：`git status --short -- forge forge.py` 空 · 差分目录无残留 ·
   `git diff -U0` 只看得到该看的行 · `--刷` 重刷后**旧黄金一个字节没动**。


## 十一条纪律（差分台已经证明有用）

1. **行为照抄不顺手改**；要改先改 Python 版再同步过来。
2. **能逐字节比的必须逐字节比**；唯一例外是 YAML（JS 不复刻 PyYAML 排版：读用自写子集、写默认 JSON，比对时用 PyYAML 解析回来做**结构相等**）。
3. **抓到的坑**：Python `round()` 是**银行家舍入**（`.5` 进偶数，token 估算会撞上）；Python `repr()` 会**递归**（`repr(['normal'])` 是 `['normal']`）。宽度表是从 `unicodedata` **生成**的（`差分\生成宽度表.py` → `forgejs\lib\east_asian_width.mjs`），不手抄。
4. **`cpSync(..., {recursive:true})` 会把 Node 进程打崩**（本机 v24.14.0，退出码 `0xC0000409`，连一行输出都不给）—— 递归拷目录用 `readdirSync + copyFileSync + utimesSync` 自己写。单文件 `cpSync` 是好的。
5. **`JSON.stringify` 会把 `undefined` 的键整个丢掉** —— Python 的 `None` 在 JS 侧有 `null` 与 `undefined` 两个来源，记进差分结构前一律 `?? null`，否则黄金里的 `"回": null` 会凭空少一个键。
6. **随机量必须先归一才比得动** —— id、时间戳、回收站文件名两侧天生不同：按**形状**收（`-` 后跟 8 位十六进制、后面不再接十六进制）＋ 按**键**收（`id` / `*_id` / `谁` / `时间` / `_文件` / `_路径`），**键名也要收**。
7. **YAML 要照抄 PyYAML，不是照抄 YAML 规范**（两者不一样，差分当场逮到两处）：
   **`1e3` 在 PyYAML 眼里是字符串**（它的浮点正则要求必须有小数点）；**八进制是 YAML 1.1 的「前导 0」**
   （`012` → 10，PyYAML 不认 `0o`）。另外**流式标量要折行**：单个换行折成空格、连续 n 个换行折成 `n-1` 个
   （真 spec 里 `content: '第一段。`／空行／空行／`第二段'` 到处都是，折错就多／少一个换行）。
   `yaml.mjs` 的文件头记着「哪些语法**故意不认**」（锚点/别名/标签/多文档/裸时间戳/六十进制数），**遇到抛错，不猜**。
8. **差分台自己也有状态**（2026-10-16 两处修正；改完复核过「`--刷` 重刷后旧黄金一个字节没动」）：
   `_动()` 要认 **tuple** —— Python `opener.定位()` 返回 tuple，原来整个跳过归一，而 JS 侧 Array 照样归一，必红；
   回收站判定 `rel.startswith(".forge/回收站/")` 要放宽成「路径里出现 `/.forge/回收站/`」—— 多夹具并排时 rel 是 `甲界面/.forge/回收站/…`。
   **沙箱开关是进程级状态**：`算_sandbox` 跑完把它留在「开」⇒ 依赖它的模块会随「单跑 / 全套跑」给出两种结果；
   新写 `算_X` 若碰沙箱，进门 `SB.enable(False)`、出门还原。
9. **`M.ydump` 在 JS 侧是明确抛错**（计划 §二① 备案的唯一差异：不写 YAML、改写 JSON）⇒
   凡原文调 `M.ydump` 的调用点一律改 `M.jdump`，差分按结构相等比。`opener.mjs` / `scaffold.mjs` / `content.mjs` 已这么做。
10. **Python 内建 `str()` 不等于 JS 里的 `_字()`** —— `str(None)` 是**真名字** `"None"`，`_字()` 是空串。
    `draft.mjs` 为此单开 `_strPy()`（影响 `_字段名`、`模块`、`要的分组`、报告「问题」，是被 `{"模块":[null]}` 当场抓住的）。
    同一个坑的另一面：**Windows 的 OSError 文本只能硬抄**（Node 的错误对象里**没有 `winerror`**）——
    `[WinError 267] 目录名称无效。` · `[WinError 3] 系统找不到指定的路径。`（**是 3 不是 2**）· `[WinError 5] 拒绝访问。`
11. **跑差分前确认工具根没有 `_tmp_*` 残目录** —— `scaffold` 语料第 27 条 `取内容层("", 工作区)` 走的是
    `abspath("")`/`resolve("")`（＝当前工作目录＝工具根），它会去扫根下最浅的 `.spec.yaml`，结果**取决于根里当时有什么**。
    干净时固定命中 `_tmp_scaffold-XXXX/前缀卡/source/前缀卡.spec.yaml`（`_` 排在 `a` 前）。这不是移植错，是语料依赖工作树形状（待改显式路径）。


## 官方卡格式还差两件（照 `docs/CHARACTER_CARD_TRANSFER.md` 核出来的真缺口）

1. **`ejs_display_templates: {enabled, templates}`** —— 卡与预设都会带。模板字段 `id`/`name`/`enabled`/`position`/`pattern`/`flags`/`source`/`delimiter`/`openDelimiter`/`closeDelimiter`/`rmWhitespace`，`position ∈ before/after/replace/partial`；导入保持顺序、库保持停用。作者原话「尽量适配 ejs」指的就是这条。
2. **`script_library`**（可选根字段）`{trees, variables, enabled, files}`。

（已照官方改掉并发在 v0.28.8：PNG 默认不写 `chara` 块、`REGEX_KEYS` 补齐 `trim_strings`/`min_depth`/`max_depth`/`substitute_regex`、插件替调用方拆整条命令。）

## 一条要给作者的话

用户明确说过：**尽量避免让用户给 AI 输命令行**（「没人会记这个东西」），操作要往简单里做；
以及**不只是手机端，将来 DSH 与电子爱也要换成 node**。
