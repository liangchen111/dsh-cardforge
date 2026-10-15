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

## 现状（5/27 个模块逐字节绿）

| 模块 | JS | 差分 |
|---|---|---|
| `model` | `forgejs\lib\model.mjs` | ✔ 3,864 字节 |
| `domain` | `forgejs\lib\domain.mjs` | ✔ 7,975 字节 |
| `zod` | `forgejs\lib\zod.mjs` | ✔ 2,661 字节 |
| `pack` | `forgejs\lib\pack.mjs` | ✔ 136,436 字节（3 份语料） |
| `validate` | `forgejs\lib\validate.mjs` | ✔ 25,970 字节（**39/47 种诊断 code**，余 8 种卡在 YAML） |

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

1. **搬 YAML 子集读取器**（落进 `forgejs\lib\model.mjs`）—— 它是唯一挡在
   `validate` 剩下 8 种 code、以及后面整条 `spec.yaml` 链前面的东西。
   口径：**读得懂 `.spec.yaml`、新产出默认写 `.spec.json`；比对用 PyYAML 解析回来做结构相等，
   不逐字节比排版**（计划 §二①）。
2. 把 `validate` 的语料补上 `source/*.spec.yaml` 那一面（那 8 种 code 就能点亮）。
3. 之后按计划 §四 的批次顺序走：`content`(2159) → `draft`(816) → `coach`(1301) → `scaffold`/`theme`/`mods`/`hud` → `png`/`preset`/`dist`/`bundle`/`export` → 辅助 → 命令层（33 条命令，名字一个不改）。


## 三条纪律（差分台已经证明有用）

1. **行为照抄不顺手改**；要改先改 Python 版再同步过来。
2. **能逐字节比的必须逐字节比**；唯一例外是 YAML（JS 不复刻 PyYAML 排版：读用自写子集、写默认 JSON，比对时用 PyYAML 解析回来做**结构相等**）。
3. **抓到的两个坑**：Python `round()` 是**银行家舍入**（`.5` 进偶数，token 估算会撞上）；Python `repr()` 会**递归**（`repr(['normal'])` 是 `['normal']`）。宽度表是从 `unicodedata` **生成**的（`差分\生成宽度表.py` → `forgejs\lib\east_asian_width.mjs`），不手抄。

## 官方卡格式还差两件（照 `docs/CHARACTER_CARD_TRANSFER.md` 核出来的真缺口）

1. **`ejs_display_templates: {enabled, templates}`** —— 卡与预设都会带。模板字段 `id`/`name`/`enabled`/`position`/`pattern`/`flags`/`source`/`delimiter`/`openDelimiter`/`closeDelimiter`/`rmWhitespace`，`position ∈ before/after/replace/partial`；导入保持顺序、库保持停用。作者原话「尽量适配 ejs」指的就是这条。
2. **`script_library`**（可选根字段）`{trees, variables, enabled, files}`。

（已照官方改掉并发在 v0.28.8：PNG 默认不写 `chara` 块、`REGEX_KEYS` 补齐 `trim_strings`/`min_depth`/`max_depth`/`substitute_regex`、插件替调用方拆整条命令。）

## 一条要给作者的话

用户明确说过：**尽量避免让用户给 AI 输命令行**（「没人会记这个东西」），操作要往简单里做；
以及**不只是手机端，将来 DSH 与电子爱也要换成 node**。
