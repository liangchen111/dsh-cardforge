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

## 现状（27/27 —— **全部搬完**，2026-10-16）

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
| `opener` | `forgejs\lib\opener.mjs` | ✔ 341,131 字节（105 步 · 10 个夹具工程 · 界面档三条支路已真跑） |
| `scaffold` | `forgejs\lib\scaffold.mjs` | ✔ 331,130 字节（52 步 · 整棵工程树） |
| `draft` | `forgejs\lib\draft.mjs` | ✔ 59,823 字节（33 条预置 · 126 条操作） |
| `mods` | `forgejs\lib\mods.mjs` | ✔ 303,578 字节（9 份夹具 · 100 步操作） |
| `bridge` | `forgejs\lib\bridge.mjs` | ✔ 273,900 字节（1274 行 · 51 条预置 · 198 条操作 · 27 条以异常收场） |
| `hud` | `forgejs\lib\hud.mjs` | ✔ 70,619 字节（952 行 · 95 条操作 · 5 目录 56 文件） |
| `manual` | `forgejs\lib\manual.mjs` | ✔ 73,272 字节（870 行 · 39 步 · 3 份夹具） |
| `theme` | `forgejs\lib\theme.mjs` | ✔ 58,911 字节（886 行 · 8 情形 / 124 步） |
| `coach` | `forgejs\lib\coach.mjs` | ✔ 709,969 字节（1,510 行 · 6 情形 · 37 步 · 18 个长常量逐字节核过） |
| `export` | `forgejs\lib\export.mjs` | ✔ 115,144 字节（616 行 · 14 情形 / 14 次调用） |
| `png` | `forgejs\lib\png.mjs` | ✔ 80,563 字节（748 行 · 26 情形 / 83 步 · **deflate 体已申报差异**，见纪律 14） |
| `dist` | `forgejs\lib\dist.mjs` | ✔ 56,388 字节（721 行 · 17 情形 / 96 步） |
| `preset` | `forgejs\lib\preset.mjs` | ✔ 441,131 字节（802 行 · 8 情形 / 122 步 · **PNG 走 `算_png` 折法**） |
| `lint` | `forgejs\lib\lint.mjs` | ✔ 161,769 字节（456 行 · 4 情形 / 87 步 · **`yaml` 走自写子集**） |
| `plan` | `forgejs\lib\plan.mjs` | ✔ 40,095 字节（904 行 · 预置 16 · 模板 5 · 反推 17 · 查 12 · 主 15） |
| `bundle` | `forgejs\lib\bundle.mjs` | ✔ 2,037,261 字节（397 行 · 5 情形 / 5 步 · zip 字节走申报差异） |
| `guard` | `forgejs\lib\guard.mjs` | ✔ 16,896 字节（233 行 · 23 情形 / 57 步） |
| **命令层** | `forgejs\forge.mjs` | ✔ 133,725 字节（3,898 行 · 3 情形 / 136 步 · **33 条命令全覆盖**） |
| **CLI 薄壳** | `forgejs\cli.mjs` | 75 行（对位 `forge\cli.py` 37 ＋ `forge\__main__.py` 8） |

**在跑**：无。`node forgejs\cli.mjs selftest` 在**只有 Node**（没有 Python）时可以独立跑，45 项全绿。

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

## 下一步（**搬完了**，剩下的都是「交货」不是「搬」）

1. **端到端实机验证**：在只有 Node 的环境（或手机）上，拿一张真工程跑一遍
   `node forgejs\cli.mjs new / entry / build / png`，产物与 Python 版逐字节比。
   差分台只证明了「每个函数等价」，还没证明「整条命令行在无 Python 的机器上跑得起来」。
2. **决定插件化形态**（`manifest.json` ＋ `cordis.yml` ＋ 纯 `.mjs`，**不进 npm**）—— **要玩家点头再动**。
3. 若只想在手机上改卡、不想背全量：**语料与黄金 27 份全部可复用**，砍子集不必重建差分台。

> **行数以 Python 实测为准**（`forge\` 合计 13,134 行，`forge.py` 3,110 行 / 155,166 字节）—— 别用 PowerShell 的
> `(Get-Content 文件).Count`，它按 GBK 读 UTF-8，`draft.py` 会被数成 649（实际 815）。
3. ~~还欠着的两处~~ **已回填**（2026-10-16，命令层合拢时）：`content.mjs:920` 的 `_OP()` 占位（原写「forgejs 还没搬 opener.mjs」）
   已改成静态 `import * as OP from './opener.mjs'`；`M.ydump` → `M.jdump` 全库已扫过一遍。
4. **子代理派工单必须写死**：验收标准是 `python 差分\跑.py` **全绿**（不是「我那个模块绿就行」）；
   临时目录建在 `差分\` 底下（系统 temp 可能是 8.3 短名，路径归一对不上）；不许改 `forge\` 下任何 Python。
   **父级收工前必须自己复核**：`git status --short -- forge forge.py` 空 · 差分目录无残留 ·
   `git diff -U0` 只看得到该看的行 · `--刷` 重刷后**旧黄金一个字节没动**。


## 十七条纪律（差分台已经证明有用）

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
12. **`if (x)` 不等于 `if x:`** —— JS 里**空数组、空对象都是真值**，Python 的 `if x:` 里 `[]` / `{}` / `""` / `0` 全是假。
    `opener.mjs` 的 `写回()` 原先写 `if (problems)`，而 Python 是 `if problems:` ⇒ HUD 返回 `problems = []`（校验通过）时
    JS 多走一条支路，返回值里凭空多一个 `"写回": false`（差分当场逮到）。已改走 `content.mjs` 的 `CONTENT.pyTruthy()`
    （`content.mjs:122` 导出，`:133` 是 `export const 或 = (a,b) => pyTruthy(a) ? a : b`）。
    **凡「Python 真值判断」的地方都走它。** 另：`regex-<uuid4>` 这种**新生成**的 id 要按形状收掉 ——
    两侧已有 `收_uuid`（`出黄金.py:878-893` 定义、`:443`/`:955` 用；`比一比.mjs:887-902` 定义、`:599`/`:950` 用），
    只认 `-XXXX-XXXX-` 那两段，剩下的 hex8 交给原有形状规则。
13. **码点 · printf 家族 · 路径规范化**（`manual` / `theme` 两块撞出来的）：
    Python 的 `len(s)` / `s[i]` / 切片都是**码点**，JS 的 `s.length` 是 **UTF-16 码元** ⇒ 一个 emoji 就多算一位
    （`_cell` 的 `limit`、`_render_index` 的「字数」列、`estTokens` 的分母全中招；`validate.mjs` 已导 `lenPy` 备用）；
    `"%s" % None` 是 `"None"`（`util.format('%s', null)` 给 `"null"`，顶不了）· `"%s" % exc` **不是** `M.pyRepr(exc)` ·
    `"{:,}"` 不能用 `toLocaleString()`（ICU 可能给 NBSP）· `"%.1f"` **不是** `toFixed`（半值取偶 ＋ `.0` 补齐）
    ⇒ 各自手写 `_fmt` / `_千分` / `_fmt1`；**Python `str.replace` 换全部、JS `String.replace` 只换第一处**；
    `str(pathlib.Path(v))` 会把 `/` 规范化成 `\`（`os.path.join` 不带）· `json.dumps(21.0)` 是 `21.0`、`JSON.stringify(21)` 是 `21`（归一化要「折浮」）。
    **「顶层不是对象」这类手写守卫必须写在 `try` 之外** —— 塞进 `try` 会被同一个 `except` 收成「读不出来」，两个分支合成一个。
14. **真有「天生不可复现」时，走「申报差异 ＋ 折法」，不许删用例**（`png` · 2026-10-16 立的规矩）：
    整段 **deflate 体**复现不出来 —— CPython 3.13.14 用上游 zlib **`1.3.1`**，Node v24.14.0 自带的是 fork **`1.3.1-e00f703`**；
    `memLevel 1..9 × strategy 0..4` 全矩阵扫过：`strategy 1/2/3` 逐字节相同、`0/4`（含默认）不同，**没有组合能复现 Python 的默认产物**。
    处理：差分台把这处折成**逐块分解**（每块记「类型 + 数据 sha1」；`tEXt eleckoi-card` 那块改记
    「gzip 容器头 10 字节 + 容器尾 8 字节 + gunzip 后字节数/sha256」），折法与理由写进 `差分\语料\png.json` 的「说明」
    **和生成器** `差分\_造png语料.py`（重跑语料不会丢），**用例一个不删**。先例还有 `validate` 的 `读不出来：<解析器原文>`。
    **`preset` 若也写 PNG，直接照抄 `算_png`（差分台两侧就是模板）。**
15. **别用 `git checkout -- <共享文件>` 复原**（2026-10-16 事故，代价＝两整块重建）：
    `guard` 子代理为复原自己误加的 BOM，跑了 `git checkout -- 差分/出黄金.py` —— 这条命令把**整个工作区版本**
    退回 `HEAD`，连带把 `plan`／`bundle` 两个**并行**子代理尚未提交的定点追加（`算_plan` ＋ `算_bundle` ＋ `算式[...]`
    注册）一起抹掉（100,888 → 95,831 字节）。`git log -S "算_plan"`／`git fsck --lost-found --no-reflogs` 都查过：
    **从未进过任何提交、没有 dangling blob ⇒ 不可从 git 恢复**。更阴的是 `跑.py` 不带 `--刷` 时只跑 JS 侧比对
    ⇒ **差分照旧 25 绿，绿灯把这个损坏盖住了**（黄金文件还在，但再也没法重新生成）。最后靠照 `差分\比一比.mjs`
    的 JS 侧镜像重写才补回：`算_plan` 重建后 `差分\黄金\plan.json` md5 `CFB869B2AD9EDCE47DF50ED6C08C6DC8`、
    `算_bundle` 重建后 `bundle.json` md5 `5090C4D977938BEDC931FB3D1D060986`，**两侧都与事故前的黄金逐字节相同**。
    由此立三条规矩：① 取回旧文用 `git show HEAD:<路径>` 输出到临时文件再**定点重贴**，**绝不 `git checkout`**；
    ② 并行子代理时**每块交付即刻提交**（未提交的定点追加是最脆的东西）；③ **子代理一旦结束 `send_message` 就到不了**
    （报 `active teammate "…" not found`，已第二次验证），别指望唤它回来补活 —— 只能自己重建。
    另附一条：**中文源码一律用 write/edit 工具写，别过 pwsh** —— PowerShell 5.1 的 `Set-Content -Encoding UTF8`
    会给**无 BOM 的 UTF-8 文件加 BOM**，`-replace` 还会一次命中多处（这正是上面那场事故的起因）。
16. **Python 的关键字实参写成 `名字: 值`，在 JS 里就是「标签语句」**（命令层一次逮到 **27 处**）：
    `apply_modules(spec, names, {project, out})` 想表达 `project=…, out=…`，可 `{project, out}` 在 JS 里只是**一个对象**，
    而 `add_group(spec, 名, 父: '')` 这种更直接 —— `父:` 是**标签**。两种都**语法合法、`node --check` 照样过、整句什么都不干**，
    症状是「参数明明传了，行为却像没传」。探测器：把 `标识符:` 改成 `标识符:;` 再 `node --check`，还能过就是标签语句。
    **凡是「传了参数却没反应」的怪现象，先怀疑这一条。**
17. **差分绿 = 语料走到的那条路一致，不等于那个模块没有别的路**（命令层合拢时一次点出 **5 处**真 bug，全是「语料没走到 ⇒ 一直绿」）：
    `scaffold.mjs:368` 对象当位置参（模块账本与打印全落空）· `scaffold.mjs:596` `M.ydump`（JS 侧故意抛错，「接手搬运」这条路根本走不通）·
    `bridge.mjs:1082` `_或(seq_hint.get(a), 1e6)` 把「键在、值是 `0`」当成缺席（Python `dict.get(k,d)` **只在键不在**时才用默认值，
    设定库第一条被推到末位）· `content.mjs:490` `join` 不保留 `TRASH_DIR` 里的 `/` · `content.mjs:920` 过期占位。
    另一条同族：**`lenPy()` 只能量字符串** —— 它先 `Array.from(String(s))` 数码点，传数组进去量到的是 `"a,b".length`。
    还有一条命令层专属：**Node 的 fs 错误不是 CPython 的 `OSError`** —— `[Errno 2] No such file or directory: '<调用时的原样路径>'`
    要自己翻回来（类名／errno 说法／路径三样都得翻，`forge.mjs` 落成 `_OS表` ＋ `_python化()` ＋ `_错话()`）。


## 官方卡格式还差两件（照 `docs/CHARACTER_CARD_TRANSFER.md` 核出来的真缺口）

1. **`ejs_display_templates: {enabled, templates}`** —— 卡与预设都会带。模板字段 `id`/`name`/`enabled`/`position`/`pattern`/`flags`/`source`/`delimiter`/`openDelimiter`/`closeDelimiter`/`rmWhitespace`，`position ∈ before/after/replace/partial`；导入保持顺序、库保持停用。作者原话「尽量适配 ejs」指的就是这条。
2. **`script_library`**（可选根字段）`{trees, variables, enabled, files}`。

（已照官方改掉并发在 v0.28.8：PNG 默认不写 `chara` 块、`REGEX_KEYS` 补齐 `trim_strings`/`min_depth`/`max_depth`/`substitute_regex`、插件替调用方拆整条命令。）

## 一条要给作者的话

用户明确说过：**尽量避免让用户给 AI 输命令行**（「没人会记这个东西」），操作要往简单里做；
以及**不只是手机端，将来 DSH 与电子爱也要换成 node**。
