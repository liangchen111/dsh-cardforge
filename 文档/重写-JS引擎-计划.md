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

---

## 八、当前状态（2026-10-16 凌晨 · 交接用）

**已搬完并逐字节绿（5/27）**

| 模块 | JS 文件 | 差分 |
|---|---|---|
| `model` | `forgejs/lib/model.mjs` | ✔ 3,864 字节 |
| `domain` | `forgejs/lib/domain.mjs` | ✔ 7,975 字节 |
| `zod` | `forgejs/lib/zod.mjs` | ✔ 2,661 字节 |
| `pack` | `forgejs/lib/pack.mjs` | ✔ 136,436 字节（3 份语料） |
| `validate` | `forgejs/lib/validate.mjs` | ✔ 25,970 字节（**39/47 种 code；余 8 种卡在 YAML**，见 §七） |

```
python 差分/跑.py              # 一条命令跑全套（比一比）
python 差分/跑.py --刷 validate # 只在确认行为变更时刷黄金
python 差分/数覆盖.py           # 数「语料走到了哪些诊断」
```

**下一轮的第一件事：搬 YAML 子集读取器（进 `model.mjs`）** —— 它现在是唯一挡在
`validate` 那 8 种 code、以及后面 `content`/`scaffold`/`preset` 整条链前面的东西
（任何 `.spec.yaml` 都要它）。落地点与口径见 §二①：**读得懂 `.spec.yaml`、新产出默认写
`.spec.json`；比对用 PyYAML 解析回来做结构相等，不逐字节比排版**。
做完顺手把 `validate` 的语料补上 `source/*.spec.yaml` 那一面。

**官方卡格式还差两件没做**（照 `docs/CHARACTER_CARD_TRANSFER.md` 核出来的，已确认是真缺口）：

1. **`ejs_display_templates: {enabled, templates}`** —— 卡与预设都会带；模板字段
   `id`/`name`/`enabled`/`position`/`pattern`/`flags`/`source`/`delimiter`/`openDelimiter`/`closeDelimiter`/`rmWhitespace`，
   `position ∈ before/after/replace/partial`，导入保持顺序、库保持停用。作者原话「尽量适配 ejs」指的就是这条。
2. **`script_library`**（可选根字段）`{trees, variables, enabled, files}`。

**已经照官方改掉的**（v0.28.8 已发）：PNG 默认不写 `chara`（`--带酒馆块` 才写）· `REGEX_KEYS` 补齐四键 ·
插件替调用方拆「一整条命令」。`verify()` 现在会拦禁块。

**一条工具故障（跨会话仍在）**：`compress` 工具不可用 —— 报
`stale-ref / session highest ref=none`，最后触发 **CIRCUIT BREAKER（连续 3 次失败后禁掉 compress）**。
压缩后端看不到本会话的消息 ⇒ **交接与进度只能靠这份文档**，别指望摘要。

