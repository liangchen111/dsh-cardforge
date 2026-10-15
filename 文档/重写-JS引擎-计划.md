# 重写计划：把引擎从 Python 搬到零依赖 ESM

> 目标一句话：**手机上不装 Python 也能做卡。**
> 现状：引擎是 Python（`forge.py` + `forge/`，共 16,189 行），手机端那个 proot Ubuntu 里
> **没有 python3**（实测 `usr/bin/python3` 0 命中，只有 `apt`/`dpkg`）⇒ 插件在手机上装得上，
> 一调就死在「找不到 Python」。所以把引擎搬成 **零依赖 ESM**。

---

## 一、地形图（实测，2026-10-15）

| 层 | 文件 | 行数 |
|---|---|---|
| CLI 命令层 | `forge.py` | **3,106** |
| 内核 | `forge/` **27 个模块** | **13,083** |
| 合计 | | **16,189** |

`forge/` 各模块（行数从大到小）：

```
content.py   2159   coach.py   1301   validate.py   834   draft.py   816
bridge.py     708   hud.py      694   mods.py       683   scaffold.py 601
theme.py      593   manual.py   557   preset.py     501   zod.py      457
export.py     397   dist.py     374   png.py        364   opener.py   326
pack.py       298   lint.py     294   plan.py       263   model.py    231
domain.py     182   sandbox.py  166   bundle.py     120   guard.py     72
__init__.py    45   cli.py       38   __main__.py     9
```

★ **好消息：整份引擎的非标准库依赖只有 `yaml` 一个**，而且只出现在两个文件里
（`model.py` · `lint.py`）。其余全是标准库 ⇒ 搬运的依赖面几乎为零。

★ **手机端运行时里的 Node 是 `v24.19.0`**（在 270 MB 的 `dsh-jsonrpc-agent` 里命中 10 次）⇒
`node:zlib` 的 `deflateSync` / `gzipSync` / **`crc32`** 都能用 ⇒ **PNG 编码不用自己实现**。

---

## 二、两个格式决定

**① 卡稿格式：JSON 为主，YAML 做兼容。**
引擎内部的真相格式改成 `.spec.json`；`.spec.yaml` 仍然**读得懂**（自己写一个够用的 YAML
子集读写器），但**新产出默认写 JSON**。理由：零依赖就没法用 `yaml` 包，而卡稿是我们自己
生成的，格式换起来代价最低。

**①-附：YAML 子集读取器的边界（2026-10-16 · 探针量的，不是猜的）**

动笔前先用 `yaml.scan()` 扫过本仓库 14 个 `.yaml`/`.yml`（排除 `node_modules`/`.git`/`出厂`/
`弃用`/`.workbuddy`），实际用到的语法只有这些：

| 语法 | 实际用量 |
|---|---|
| 朴素标量 | 3,263 |
| 单引号标量 | 402 |
| 双引号标量 | 16 |
| 块字面量 `\|` | 11（**没有 `>` 折叠**） |
| 块映射 | 缩进列 0/2/4/6/8，全偶数 |
| 块序列 `- ` | 285 个 `BlockEntryToken`（含 `- key: v` 紧凑写法） |
| 流序列 `[…]` | 99 |
| 流映射 `{…}` | 1 |

**没有**：锚点 `&` / 别名 `*` / 标签 `!` / 指令 `%` / 多文档 `---` / 制表符 / CRLF。

所以 `forgejs/lib/yaml.mjs` **故意不实现**这些，遇到**抛错**（不许静默降级成字符串）：
锚点别名、标签、指令、多文档、**裸时间戳**（PyYAML 会把 `2026-01-01` 解成 `datetime.date`；
引擎写出的 spec 里时间戳一律带单引号，实测 `'2026-01-01T00:00:00+08:00'`）、
YAML 1.1 六十进制数（`12:30` → 750）。

★ **两条照抄 PyYAML 而不照抄 YAML 规范的地方**（差分当场逮到的）：
1. **`1e3` 是字符串**，不是浮点 —— PyYAML 的浮点正则要求**必须有小数点**，YAML 1.2 不要求。
2. **八进制是 YAML 1.1 的「前导 0」**（`012` → 10），PyYAML **不认 `0o`**。

★ **流式标量要折行**：单个换行折成空格，连续 n 个换行折成 `n-1` 个换行。真 spec 里
`content: '第一段。`／空行／空行／`第二段'` 这种写法到处都是，折错一个字面就多／少一个换行。

**② 插件形态：按手机端认的那套来。**

手机端的插件目录长这样（`assets/dsh-plugins/` 里那两个内置插件实测）：

```
插件名/
  manifest.json   { schemaVersion:1, id, version, cordisConfig:"cordis.yml", files:[…] }
  cordis.yml      - id: xxx
                    name: ./xxx.mjs
                    config: {…}
  xxx.mjs         零依赖 ESM，直接跑
```

**没有 npm、没有 package.json、没有 `dsh.bundle.patch`、没有依赖声明。** 桌面端继续用现有的
npm bundle（`package.json` + `cordis.patch.yml`），**同一个仓库出两种壳、共用同一套引擎**。

---

## 三、差分测试台（先建，后搬）

搬运最大的风险是「看着一样、其实不一样」。所以**先建 oracle，再动代码**：

1. **语料** `差分/语料/`：挑覆盖面最广的输入 —— 示例卡稿 · 制卡助手 spec · 已经生成好的
   `.card.json` / `.preset.json` · 一份带界面的卡工程 · 一份最小卡。
2. **黄金输出**：用**现在的 Python 版**对每个语料跑一遍，把产物**逐字节**存进 `差分/黄金/`。
3. **比对**：JS 版对同样输入跑一遍，产物与黄金**逐字节比**（PNG 比 sha256，JSON 比字节，
   目录比整棵树）。
4. **规矩**：**绿一块才算搬完一块**；任何一处字节不同，要么是 bug，要么是有意的格式变更 ——
   后者必须在计划里写明，并且把黄金一起更新（**不许悄悄放行**）。

跑法（目标形式）：

```
python 差分/出黄金.py                 # 用 Python 版刷新黄金（只在确认变更时跑）
node   差分/比一比.mjs                # 用 JS 版跑，逐字节比，报第一处不同
```

---

## 四、搬运顺序（依赖从底向上，一块一块绿）

| 批 | 模块 | 行数 | 说明 |
|---|---|---|---|
| ① 地基 | `model` · `domain` · `zod` | 870 | 卡模型 · 真值域表 · 校验器；**YAML 子集读写就落在 model** |
| ② 体检 | `validate` · `pack` | 1,132 | spec↔卡 · 体检 |
| ③ 内容 | `content` · `draft` · `coach` | 4,276 | 最大的一块；条目读写 · 卡稿 · 规程生成 |
| ④ 工程 | `scaffold` · `theme` · `mods` · `hud` | 2,571 | 建工程 · 皮肤 · 模块 · 界面层 |
| ⑤ 成品 | `png` · `preset` · `dist` · `bundle` · `export` | 1,752 | PNG（`node:zlib`）· 预设 · 打包 · 酒馆互通 |
| ⑥ 辅助 | `plan` · `lint` · `manual` · `opener` · `bridge` · `guard` · `sandbox` | 2,250 | 规划书 · 体检 · 手册 · 开场白 · 桥 · 只读禁区 |
| ⑦ 命令层 | `forge.py` 的 33 条命令 | 3,106 | 最后接，命令名与参数**一个不改** |

**纪律**：Python 版**不停维护、不删**，它既是黄金参照，也是桌面端的正式实现；
JS 版只在差分全绿之后才允许成为默认路径。

---

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| YAML 子集读不干净（缩进、块标量、引号、注释） | 语料里塞一份「最刁的 YAML」，把解析器的边界钉死；吃不准就报错，**不许猜** |
| PNG 字节与 Python 版不一致（压缩级别、时间戳、块顺序） | 比 sha256；`gzip`/`deflate` 的级别与 `mtime=0` 照 Python 版抄 |
| 中文与换行（CRLF/LF、UTF-8 无 BOM） | 差分里专门放一组 CRLF 语料 |
| 命令层 3,106 行搬出行为漂移 | 命令名/参数不动；`selftest` 那 45 项当第二批 oracle |
| 手机端装不上 | 手机端的插件形态是实测来的（`manifest.json` + `cordis.yml` + `.mjs`）；装法照内置那两个抄 |

---

## 六、目录（新建，不动现有）

```
E:\workGZQ\制卡工具\
  forgejs\               ← 新引擎（零依赖 ESM）
    manifest.json        ← 手机端插件形态
    cordis.yml
    index.mjs            ← 插件入口（注册 cardforge 工具）
    lib\*.mjs            ← 引擎模块
    tests\*.mjs
  差分\
    语料\  黄金\
    出黄金.py   比一比.mjs
```

`forgejs/` 与 Python 版**并存**，先在 `forgejs` 里跑通差分，再谈换默认路径。

---

## 七、进度（滚动更新）

**第一批 ✅ 全绿**（2026-10-15）

| 模块 | 产出 | 差分结果 |
|---|---|---|
| `model` | `forgejs/lib/model.mjs` | ✔ 逐字节一致 **3,778 字节** |
| `domain` | `forgejs/lib/domain.mjs` | ✔ 逐字节一致 **7,975 字节** |
| `zod` | `forgejs/lib/zod.mjs` | ✔ 逐字节一致 **2,661 字节** |

跑法：

```
python 差分/出黄金.py          # 刷新黄金（只在确认行为变更时跑）
node   差分/比一比.mjs         # 逐字节比，红了报第几行第几偏移
```

**差分台当场抓到的两个真坑**（记下来给后面 20 多个模块当参照）：

1. **Python 的 `round()` 是银行家舍入**（.5 进偶数），JS 的 `Math.round` 是 .5 进位。
   token 估算正好会撞：非中日韩字符 9 个 ⇒ `9/3.6 = 2.5`，Python 给 **2**、JS 原本给 **3**。
   ⇒ JS 里手写了 `银行家()`。
2. **Python 的 `repr()` 会递归**：`repr(['normal'])` 是 `['normal']`，不是 `normal`。
   第一版 `pyRepr` 只处理字符串，差分立刻红在 domain 第 18 行。

**两个约定（后面照办）**

- **`disp_width` 的宽度表从 Python 生成**，不手抄：`差分/生成宽度表.py` 用
  `unicodedata.east_asian_width()` 吐出 `forgejs/lib/east_asian_width.mjs`
  （120 个宽区间 · Unicode 15.1.0），再用差分证明两边一致。
- **YAML 不做逐字节比对**：JS 不打算复刻 PyYAML 的排版。JS 侧读 YAML 用自写的子集解析器、
  写默认走 JSON；比对时把 JS 产出的 YAML 用 PyYAML 解析回来做**结构相等**比较。
  这是唯一一处「允许不是逐字节」的地方，写在这里备案。

**第二批 ✅ 全绿**（2026-10-15 深夜 → 2026-10-16）

| 模块 | 产出 | 差分结果 |
|---|---|---|
| `pack` | `forgejs/lib/pack.mjs` | ✔ 卡那边逐字节一致 **136,436 字节**（3 份语料：真卡 · 最小卡 · 不是 ElecKoi 卡） |
| `validate` | `forgejs/lib/validate.mjs` | ✔ 逐字节一致 **25,970 字节**（3 张卡 ＋ 4 个工程夹具） |

**`validate` 这一块要特别注意它的边界**：`forge/validate.py` 里写死了 **47 种**诊断 code，
差分语料走到了 **39 种**；没走到的 8 种**全部**是「要读 `source/*.spec.yaml`」的那几支 ——

```
HUD-OPENER-MARK · HUD-OPENER-DRIFT · HUD-OPENER-GONE
PROJ-NAME-DRIFT · PROJ-LEDGER-DRIFT · PROJ-HUD-UNWRITTEN · PROJ-HUD-PATTERN · PROJ-STALE-CARD
```

原因：JS 侧的 **YAML 子集读取器还没落地**（`model.mjs` 的 `yload()` 现在直接抛错），
Python 侧那几个分支会真读出来 ⇒ 两条路此刻**注定不同**。代码已经照抄一份放在
`validate.mjs` 里，等读取器落地**自动点亮**，那时再补语料。

**新加的一条工具**：`python 差分/数覆盖.py [模块名]` —— 数「源码里写死的 code vs 黄金走到过
的 code」。**差分的绿只证明语料走到过的那几条路一致**，绕开的分支照样绿；这份脚本把
「绕开了哪些」摆到台面上，免得好消息被当成全功。

**第三批 ✅ 全绿**（2026-10-16）

| 模块 | 产出 | 差分结果 |
|---|---|---|
| `model.yload`（YAML 子集读取器） | `forgejs/lib/yaml.mjs` | ✔ 逐字节一致 **109,826 字节**（10 份语料：手写的「最刁的」＋真 spec＋模块条目＋cordis.patch） |

- **YAML 这块比的是「结构相等」不是排版**（计划 §二① 唯一备案过的例外）：两边把解析结果
  归一成 JSON 再逐字节比；`datetime` 之类换成带类型名的标记，**让差分当场炸**而不是悄悄当字符串。
- **`validate` 一口气补齐到 47/47 种 code**（黄金 25,970 → **29,091 字节**）：YAML 落地后
  把「要读 `source/*.spec.yaml`」那一面全接上了 —— `HUD-OPENER-MARK` / `-DRIFT` / `-GONE`、
  `PROJ-NAME-DRIFT` / `LEDGER-DRIFT` / `HUD-UNWRITTEN` / `HUD-PATTERN` / `STALE-CARD`。
- **指纹算法也顺带验了**：`工程甲` 的账本里那条 `e-y` 的「并入后指纹」写的是 **Python 算出来的真值**
  （`4da31c9f1146`，见 `造语料.mjs` 注释）⇒ JS 的 `_fingerprint` 只要差一个字节，它就会多报一条
  `PROJ-LEDGER-DRIFT`，差分当场红。

**第四批 ✅ 全绿**（2026-10-16）

| 模块 | 产出 | 差分结果 |
|---|---|---|
| `content`（2,158 行 · 本工程最大的一块；产出 `content.mjs` 2,794 行） | `forgejs/lib/content.mjs` | ✔ 逐字节一致 **94,122 字节**（30+ 步顺序操作 ＋ 整棵工程树） |
| `sandbox`（165 行） | `forgejs/lib/sandbox.mjs` | ✔ 逐字节一致 **5,397 字节**（模式关／模式开各跑一遍） |

- **两份语料都不是「调几个函数」那种**：
  - `差分/语料/content.json`：把 `assets/骨架` 整份拷进临时目录，**顺序**跑 30+ 个操作
    （增删改条目／分组／变量／对象／正则／回收站还原／克隆），每步比「stdout ＋ 返回值 ＋ 异常消息」，
    最后比**整棵树**（普通文件比 sha1、spec 比结构、回收站记录按位次编号比结构）。
  - `差分/语料/sandbox.json`：同一串步骤跑两遍（模式关／模式开），专门盯那三处开关差异
    —— `land` 走改名还是直接覆盖（临时文件还在不在）· `retire` 变墓碑 · `shell` 变空壳。
- **两处备案过的写法差异**（`content.commit` / `content.load`；§二① 的落地）：
  `M.ydump(raw, tmp)` → **`M.jdump`**（JS 不写 YAML，新产出一律 JSON）、临时文件后缀 `.yaml` → `.json`；
  `M.yload(spec)` → **`M.loadStructured`**（`.spec.json` 与 `.spec.yaml` 都读得动）。
- **随机量必须归一才比得动**：id、`created_at`/`updated_at`、回收站文件名与时间戳两侧天生不同
  ⇒ 比对前按**形状**收（`-` 后面跟 8 位十六进制、且后面不再接十六进制）＋ 按**键**收
  （`id` / `*_id` / `谁` / `时间` / `_文件` / `_路径`），**键名也收**（`数据` 里拿 id 当键）。

```
python 差分/跑.py             # 全绿 8/8：content · domain · model · pack · sandbox · validate · yaml · zod
python 差分/跑.py --刷 yaml    # 只在确认行为变更时刷黄金
python 差分/数覆盖.py          # validate 47/47 · domain 5/5 · 其余无 code 型诊断
```

**新踩的两个环境地雷**（写进这里，省得下一轮再撞）：

1. **`cpSync(src, dst, {recursive:true})` 会把 Node 进程打崩** —— 本机 `D:\node.exe`（v24.14.0）
   上退出码 `-1073740791`（`0xC0000409` STATUS_STACK_BUFFER_OVERRUN），**一行输出都不给**。
   单文件 `cpSync` 是好的，坏的是 recursive 那条路。用 `readdirSync + copyFileSync + utimesSync`
   自己递归拷（并照 `shutil.copytree` 把 mtime 一起搬）。
2. **`JSON.stringify` 会把 `undefined` 的键整个丢掉** —— Python 的 `None` 在 JS 侧有 `null` 与
   `undefined` 两个来源，记进差分结构前一律 `?? null`，否则黄金里的 `"回": null` 会凭空少掉一个键。


---

## 八、当前状态（2026-10-16 凌晨 · 交接用）

**已搬完并逐字节绿（18/27）**

| 模块 | JS 文件 | 差分 |
|---|---|---|
| `model` | `forgejs/lib/model.mjs` | ✔ 3,864 字节 |
| `domain` | `forgejs/lib/domain.mjs` | ✔ 7,975 字节 |
| `zod` | `forgejs/lib/zod.mjs` | ✔ 2,661 字节 |
| `pack` | `forgejs/lib/pack.mjs` | ✔ 136,436 字节（3 份语料） |
| `validate` | `forgejs/lib/validate.mjs` | ✔ 29,091 字节（**47/47 种 code 全覆盖**） |
| YAML 子集读取器 | `forgejs/lib/yaml.mjs`（`model.yload` 走它） | ✔ 109,826 字节（结构相等 · 10 份语料） |
| `sandbox` | `forgejs/lib/sandbox.mjs` | ✔ 5,397 字节（模式关／开两遍） |
| `content` | `forgejs/lib/content.mjs` | ✔ 94,122 字节（30+ 步操作 ＋ 整棵树） |
| `opener` | `forgejs/lib/opener.mjs` | ✔ 228,776 字节（105 步 · 10 个夹具工程） |
| `scaffold` | `forgejs/lib/scaffold.mjs` | ✔ 331,130 字节（52 步 · 整棵树） |
| `draft` | `forgejs/lib/draft.mjs` | ✔ 59,823 字节（33 条预置 · 126 条操作） |
| `mods` | `forgejs/lib/mods.mjs` | ✔ 303,578 字节（9 份夹具 · 100 步操作） |
| `bridge` | `forgejs/lib/bridge.mjs` | ✔ 273,900 字节（51 条预置 · 198 条操作 · 27 条异常） |
| `hud` | `forgejs/lib/hud.mjs` | ✔ 70,619 字节（95 条操作 · 5 目录 56 文件） |
| `manual` | `forgejs/lib/manual.mjs` | ✔ 73,272 字节（39 步 · 3 份夹具） |
| `theme` | `forgejs/lib/theme.mjs` | ✔ 58,911 字节（8 情形 / 124 步） |
| `coach` | `forgejs/lib/coach.mjs` | ✔ 709,969 字节（6 情形 · 37 步 · 18 个长常量逐字节核过） |
| `export` | `forgejs/lib/export.mjs` | ✔ 115,144 字节（14 情形 · 14 次调用） |

```
python 差分\跑.py              # 一条命令跑全套（比一比）
python 差分\跑.py --刷 validate # 只在确认行为变更时刷黄金
python 差分\数覆盖.py           # 数「语料走到了源码里的哪些诊断 code」
```

**在跑**：`png`（384）＋ `dist`（373），两个子代理并排跑。
`png` 要的 `export` 已绿；`dist` 要的 model/pack/sandbox/hud/bridge/validate 也全绿。
之后：`preset`（500）要 `png`；`bundle`（119）要 dist＋export＋manual；`lint`（293）/ `plan`（262）/ `guard`（71）依赖最轻，随时可开。

**`opener` 的三条界面档支路已经真跑了**（2026-10-16）—— 新增夹具 `卯全界面`（`assets/骨架` 整份）
后，`写回()`（界面档·标记数 3）与 `改正文(..., 写回=true)` 都进了语料（opener 黄金 228,776 → **341,131**）。
**当场逮到一个真 bug**：JS `if (problems)` 把**空数组当真值**（Python `if problems:` 里 `[]` 是假）⇒
`写回` 返回值多带一个 `写回: false`。已改走 `CONTENT.pyTruthy`。

> ⚠️ **跑差分前别在工具根留 `_tmp_*` 残目录**：`scaffold` 语料第 27 条是
> `取内容层("", 工作区)` —— Python `abspath("")` / Node `resolve("")` 都落回**当前工作目录**（＝工具根），
> 于是它去扫工具根下最浅的 `.spec.yaml`，而 `_找文件` 按名字排序 ⇒ 谁是「最浅的第一个」取决于根里当时有什么。
> 干净的根下固定命中 `_tmp_scaffold-XXXX/前缀卡/source/前缀卡.spec.yaml`（`_` 排在 `a` 前面）；
> 多一个 `_tmp_draft-*` 之类就会换一条结果。**这不是移植错，是语料本身依赖工作树形状**（待改成显式路径）。

**之后照剩下来的大小排**：`coach`（1,353 · 最肥的一块）→ `preset`（500）→ `export`（396）／
`png`（384）／`dist`（373）／`lint`（293）／`plan`（262）／`bundle`（119）／`guard`（71） → 命令层
（`cli.py` 37 ＋ `__main__.py` 8 ＋ `forge.py` 3,106 行 · 33 条命令，名字一个不改）。
`content`（2,158 行）已经吃掉最肥的一块。

**依赖链（2026-10-16 实测 grep 过 `forge/*.py` 的 import）**：`coach` 要 content/draft/manual/model/pack/validate（**已全绿 ⇒ 可开**）·
`export` 要 model/pack（**可开**）· `lint` 只要 `io/json/os/re/sys/yaml`（**可开**）· `plan` 只要 sandbox（**可开**）·
`guard` 只要 os（**可开**）· `dist` 要 model/pack/sandbox/hud/bridge/validate ＋ `__version__`（**可开**）·
`png` 要 export · `preset` 要 png · `bundle` 要 dist＋export＋manual。

**`hud`（693）要早点搬** —— `opener` 有 3 条分支（`写回` / 改正文时 `写回=true` / `补齐`界面档）
与 `scaffold` 的 `build_hud` 都因为它没搬而留成抛错（差分覆盖率缺口就卡在这）。
**`forgejs/lib/` 里凡是调 `M.ydump` 的地方一律是 `M.jdump`**（计划 §二①：JS 侧不写 YAML、改写 JSON，
差分按结构相等比）—— `opener.mjs` / `scaffold.mjs` 已这么做。
`content.restore()` 里两处 `from . import opener as OP` 走的是**惰性导入**，`opener.mjs` 落地后没回填，
等命令层合拢时一起接。

**行数以 Python 实测为准**（2026-10-16 用 `pathlib` 数的，`forge/` 合计 **13,134 行**）：

| 模块 | Python 行数 | 模块 | Python 行数 |
|---|---|---|---|
| `content` | 2,158 | `preset` | 500 |
| `coach` | 1,353 | `zod` | 456 |
| `validate` | 833 | `export` | 396 |
| `draft` | 815 | `png` | 384 |
| `bridge` | 707 | `dist` | 373 |
| `hud` | 693 | `opener` | 325 |
| `mods` | 682 | `pack` | 297 |
| `scaffold` | 600 | `lint` | 293 |
| `theme` | 592 | `plan` | 262 |
| `manual` | 556 | `model` | 234 |
| `domain` | 181 · `sandbox` 165 · `bundle` 119 · `guard` 71 · `__init__` 44 · `cli` 37 · `__main__` 8 | | |

> ⚠️ **别用 PowerShell 的 `(Get-Content 文件).Count` 数行数** —— 它按 GBK 读 UTF-8，
> `draft.py` 被数成 649 行（实际 815）。要行数就用 Python `read_bytes().count(b"\n")`。
> 本轮文档里所有「XXX 行」都是这么重新数过的。


**已知还欠着的两处**（content 里那两个 import 的兄弟模块还没搬）：

- `content.restore()` 里两处 `from . import opener as OP`（延迟导入）⇒ `opener.mjs` 没搬，
  「还原开场白 / 还原卡名」两条支路会撞上，其余全部照抄可用。
- 全库 `M.ydump` 仍抛错（JS 不写 YAML）—— 需要写 YAML 的调用点都得改成 `M.jdump`。

**官方卡格式还差两件没做**（照 `docs/CHARACTER_CARD_TRANSFER.md` 核出来的，已确认是真缺口）：

1. **`ejs_display_templates: {enabled, templates}`** —— 卡与预设都会带；模板字段
   `id`/`name`/`enabled`/`position`/`pattern`/`flags`/`source`/`delimiter`/`openDelimiter`/`closeDelimiter`/`rmWhitespace`，
   `position ∈ before/after/replace/partial`，导入保持顺序、库保持停用。作者原话「尽量适配 ejs」指的就是这条。
2. **`script_library`**（可选根字段）`{trees, variables, enabled, files}`。

**已经照官方改掉的**（v0.28.8 已发）：PNG 默认不写 `chara`（`--带酒馆块` 才写）· `REGEX_KEYS` 补齐四键 ·
插件替调用方拆「一整条命令」。`verify()` 现在会拦禁块。

**`compress` 工具（2026-10-16 复诊：已恢复，别当它坏了）**：之前报的
`stale-ref / session highest ref=none` ＋ CIRCUIT BREAKER 是**暂时现象**，不是「后端看不到本会话」。
实测结论与做法写在默认工作区 `bili-压缩失效-诊断-20261016.md`：**先 `acp_status` 拿当前可折叠区间，
照它给的 ref 折一次** —— 一次成功即清断路器（阈值 3 次，且静默 10 分钟自动消）。

