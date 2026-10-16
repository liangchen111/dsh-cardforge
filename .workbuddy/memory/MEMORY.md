# 制卡工具 · 长期约定

> 工位：`E:\workGZQ\制卡工具`。给 ElecKoi（PC + Android）做卡。
> 逐轮过程在 `YYYY-MM-DD.md`，这里只留**跨会话必须遵守的东西**。

## 铁律

0. **这个工具招待的是「AI」，不是人。**（用户原话：「我要的不是图形工作台，是**开新卡时指导 AI 怎么做**的制卡工具」；
   「艾瑟兰和酒馆只是参考，不是照抄，提炼好做法就行」。）每做一块先问：**AI 能不能照着它干活？**
   形态就三样：`forge.py` 命令（AI 跑）+ `向导/AI制卡规程.md`（AI 读；`forge guide` 按需取）+ `插件/制卡工坊/`（给 ElecKoi 里的 AI）。
   **AI 首选 `forge.py make <卡稿.yaml>`** —— 一次落成，省 5~10 轮工具调用（对话里每轮都要重发前文，是实打实的成本）。
1. **`E:\workGZQ\艾瑟兰` 全程只读，一个字都不能动。** 它是另一个会话在维护的实卡，本工具拿它当**参考实现**
   （`card_kit.py` / `build_hud.py` 是 forge 的前一代）。它写在**只读禁区名单**里 —— 唯一真相现在是内核
   `forge/guard.py` 的 `READONLY`（外加任何放着 `.只读` 空文件的目录）。
2. **`spec.yaml` 是唯一真相，`card.json` 是派生物。** 只手改 spec。
3. **报告宁可少报也不误报。** 误报比不报更糟。同组 order 撞车才提示（跨组撞车是常态）；单条超长的只列前几条。
4. **测试脚本不许在 `assets/` 上删东西。**（2026-10-08 一个冒烟脚本「无条件删同名文件」把自带主题
   `assets/主题/朱砂.json` 删了，无 git 无备份。）要测「装进主题库」就用自带库里绝不会有的名字，且**只删自己刚建的那一个**。
5. **图形工作台已迁出（2026-10-10，v0.27.0）。** 曾冻结（用户原话：「eleckoi 就是个对话 agent 工具，不需要工作台」），
   这轮连代码一起搬到 `弃用/工作台/`（`ui.py` + 前端 + 启动脚本 + 前端冒烟），并删掉 `forge.py ui`、
   移除自检第 21/39/40 项（**编号保留空位、不重排**，免得别处按编号引用错位）。主线只剩上面那三样。

## 环境

- 跑 forge.py 就用它：`C:\Users\Administrator\.workbuddy\binaries\python\envs\cardforge\Scripts\python.exe`（3.13 + PyYAML）。
- Node（跑卡内 HUD 纯函数单测）：`C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`。
- 改过内核**必须跑** `forge.py selftest`（当前 **42 项**；编号里 21/39/40 空着，含负向用例与往返比对）。
- **沙箱友好模式（`--沙箱` / `FORGE_SANDBOX=1`）**：整个 forge 切成「只创建、只覆盖」。新增落盘动作**必须走
  `forge/sandbox.py` 的助手**（`land` / `remove` / `rmtree` / `retire` 墓碑 / `shell` 空壳），**不许直接
  `os.replace` / `os.remove` / `shutil.rmtree`** —— 自检第 42 项把这三个换成炸弹跑一遍，漏一处就红。
- 看**警告**要单文件模式（`check <spec>`）；`check <目录>` 是批量模式，只打错误数。
- 脚本里调 forge.py **一律写 Windows 路径** `E:/workGZQ/制卡工具/forge.py`（`cd /e/...` 仍可用）；
  一旦 `export MSYS_NO_PATHCONV=1`，`/e/...` 就不再被转换。
- **MSYS 坑**：以 `/` 开头的参数会被 Git Bash 当路径展开；带 `pwsh` 字样的命令会被安全策略拦（脚本里拆写成 `"p" + "wsh"`）。

## ElecKoi 本体

- 0.2.8，唯一一处 `D:\eleckoi`（`resources/app.asar` 647,889,675 B，2026-10-07）。全盘**无** `app.asar.bak` ⇒ 没被改造过。用户数据 `%APPDATA%\eleckoi-desktop\`。
- **翻 asar 只能自己写解析器**。格式：前 16 B 四个 UInt32LE → 第 4 个是 JSON 头长、JSON 从偏移 16 起，
  **数据基址 = 8 + 第 2 个 UInt32**；JSON `{"files":{名:{files:{…}} | {offset,size,integrity,unpacked}}}`，
  `offset` 是字符串要 `int()`；**`unpacked:true` 的条目没有 offset**，要去 `app.asar.unpacked/` 拷（否则全读成同一段）。
  抽取脚本 `.workbuddy/_试/抽包.py`；副本在 `.workbuddy/_工具取证/`。
- **官方插件体系**：文档随包发（`node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/` 与
  `@deepseek-ai/dsh-client-ui-plugin-manager/README.zh.md`）。插件 = 一个目录（`package.json` + `cordis.patch.yml` +
  `index.js` + 可选 `client.js`）；装法 = 面板「添加插件」填**本地绝对路径**。
- **沙箱实测（2026-10-08，11 组对照）**：受限令牌下 `cmd` / PowerShell **5.1** / `node` 退出码全 0（**不用装 pwsh 7**）；
  `forge.py` 能起、能读、能写（**真身 python + `PYTHONPATH` 指 venv 的 site-packages**；venv 的 `python.exe` 是重定向器，起不来）。
  **决定性边界：沙箱内 读✅ 写✅ 删❌ 改名❌ `os.replace`❌（全 WinError 5）**；原因＝授权根带 `Everyone:(CI)(DENY)(DC)` + Low 标签，
  且受限令牌禁掉了 `Authenticated Users` → `DELETE` 失去来源。⇒ **出路：① 一次性升权 ② `--沙箱`（已实现）③ 走插件（长期正解）**。
  详见 `文档/ElecKoi内制卡·可行性勘察.md`。⚠️ 与官方 README 说法矛盾（它说 DELETE 不受影响）——真机一句话可定案。
- **C 轨插件（`插件/制卡工坊/`，纯宿主，无 `client.js`）**：`import { defineTool } from '@deepseek-ai/dsh-tools'`
  → `ctx.tools.register(defineTool({name, description, parameters, output, execute}))`，`export const inject = ['tools']`。
  **宿主 spawn 的子进程不受那层 ACL 沙箱管** → 改名 / 删除 / 原子落盘全回来。工具形状 `cardforge(args=[...], cwd=...)`
  → `{exitCode, stdout, stderr}`；子进程强制 `PYTHONIOENCODING=utf-8`。`cordis.patch.yml` 里的路径是**这台机器写死的**（换机器改这里）。
  - 门禁 2026-10-08 真机已过（探针 `插件试样/制卡探针/` 装进 0.2.8、渲染成功）。
  - **⚠️ 真机装最容易漏**：工具分 `built_in / mcp / **extension**` 三类，我们落在 **extension**，**要去角色的工具设置里打开**，不然模型看不见。
  - 本机验法＝**桩件法**：`.workbuddy/_插件本地测/`（桩 `defineTool` 与 schemastery，换两行 import 后载入真身 `index.js`）→ **49/49 绿**。
  - **唯一没验的：真机上装完，模型看不看得见这个工具。** 装与用见 `文档/C轨插件·实测单.md`。
- **`forge.py guide`**：让 AI 自己按需取知识（目录 / `--节` / `--篇` / `--对话` / `--全文`）。节＝规程正文按 `^## ` 切；
  篇＝`方法论` 九篇（coach 唯一真相）；对话段＝卡里四段（总则 / 访谈 / 交付 / 红线）。取名「全等→前缀→包含」，
  **认不出或撞名当场抛错并列全部候选**，绝不静默挑一个。自检第 43 项盯着；第 29 项扩查 `向导/SKILL.md` 门牌（命令真实 + 指向 `AI制卡规程.md`）。
- **旧注入式改造**（`%APPDATA%\eleckoi-desktop\eleckoi-plugins\`）对 0.2.8 已失效，别救。勘察用户数据**一律只读**。

## `make` 一次落成（`forge/draft.py`）

- `make <卡稿.yaml>` 一趟落成整张卡；**条目按标题 upsert**；分组 / 变量对象缺了自动补；
  **全程临时目录、全绿才整棵拷过去** —— 坏稿**一个字都不往目标写**；静态能查的一次报全。
- `--模板`＝空壳骨架（只答有哪些键）；`--示例`＝**一张真能开的完整卡稿**（长夜便利店，3.8k 字；同份也落
  `向导/示例卡稿.yaml`，由 `coach` 生成）—— 答「话写多细 / 哪句放常驻」。**别让它俩又打同一份**（曾犯）。自检 44 / 45 盯住。
- **改已有条目的三条规矩**：① `模板:` 换档要先用 `CONTENT.可改字段` **过滤**（模板表带 `kind`，直接递过去抛「不给改 kind」）；
  ② `分组:` 不在 `set_entry` 字段表里，得走 `CONTENT.move_entries()`（曾**默默忽略**）；③ 变量重名 `add_variable` 抛 `ContentError`，必须 catch 成人话。
- **先建后清**：`清空条目` 必须排在条目处理**之后**（反过来会误报「改 0·新建 4·删 4」且半路失败真丢内容）。
- **规程里的命令写法会被自检第 29 项解析**：`--模板` 后面紧跟空格 + 词会被当模板名抓走 → 写法一律
  `` `--模板` ``（反引号紧跟其后）。加新命令先想「第 29 项会怎么读这句话」。

## 制卡向导（`forge/coach.py`）

- **一份内容三类出口**：规程正文九节 + `方法论` 九篇 + `卡红线` 是唯一真相，规程 md / 门牌 / 向导卡 / `guide` 全从它生成 —— 改内容只改这一处。
- 出口一：`AI制卡规程.md` + `SKILL.md`（**门牌**，与已安装技能一次 `cp` 同步：`~/.workbuddy/skills/eleckoi-card-maker/`）；
  出口二：`制卡助手` 向导卡（14 条，给 ElecKoi 里的 AI）；出口三：`forge.py guide`。
- **卡的形状从骨架 spec 抄、内容用 `content.py` 写**，绝不手拼 → 向导卡自己 0 错。改卡内容**别动开场白 id 与 default**，只换 `content`。
- 常驻条目 **≤ 700 字**（自检第 28 项）；**规程写完要盲跑一次**（只读规程施工，2026-10-08 首跑暴露 15 条，硬缺口＝「entry 没有改命令」「开场白写在哪」）。

## 分发（`forge/dist.py`）

- **工程包** = zip，顶层 `<卡名>/`，多一份 `包信息.json`（信封：卡名 / 工具版本 / 模块 / 皮肤 / 逐文件 sha256；只写进 zip，不落盘）。
- **收包** `forge import`：条目名三拒（绝对路径 / `..` / 任一段带冒号）→ **整包拒收**；清单对不上**如实报但不拦**；
  目标已存在就停（`--改名` 才错开）。落点若在只读禁区，被 `forge/guard.py` 挡下。
- **皮肤能出能进** `theme --导出 / --导入 / --装`（导出读卡上那份 `hud/主题.css`，不是 assets 原型）。

## 结构 / 内容 / 校验（要点）

- 一张卡一个工程，**分两层**：内容住 `source/`（真相），界面住 `hud/`（派生物）。模块的**条目/正则**进 spec、
  **脚本/样式**落 `hud/模块/<名>/`；组装顺序 **核心 → 皮肤 → 模块**。
- `setting_library` / `variable_config` 是**嵌套 JSON 字符串**，解析出的是副本，改完必须写回（`pack.mutate_active_*`）。
  正文**不许 strip**（艾瑟兰开场白尾部 `\u200b` 是触发器）。
- **变量三处同步**：面板对象 `variables.objects` + 初值 `initial_state` + Zod `schema_code`，**少一处不报错、静默丢值**。
  `add_variable` 一次写全；`--对齐` 补歪的。
- **Zod 是代码字符串，不许正则改**：`zod.py` 按括号/引号配对拆成树、叶子原样保留、稳定拼回；认不出的退化成
  `Leaf` 原样带走 —— **拒绝猜**。
- **形状不猜**：写 `initial_state` 按对象表判形状，对不上报 `_挡路的` 并**拒写**；删从宽（只认「在不在」）。
- **删 / 改一律进回收站** `<工程>/.workbuddy/回收站/`（≤60 条，可逐项还原；删分组时条目落「未分组」、还原各归各位）。
  **只有 `content.commit()` 写 spec**（临时文件 → 证明 → `os.replace`，证明不过一个字不写）。
- 「工具自己会报的错，必须让用户能在工具里改」（`content.可改字段` / `set_entry` 一处定义）。
- 坑：`Issue.level` 是 **`"ERROR" / "WARN" / "INFO"`（大写）**。
- **工程层自洽** `PROJ-*`（`validate.validate_project`）：模块目录↔conf、conf↔账本、账本↔现状、spec↔成品、
  界面写没写回、spec 份数 —— 全是「不报错的错」。**交付给 ElecKoi 的永远是 `成品/*.card.json`**（`PROJ-STALE-CARD` 最值钱）。
  防误报：`PROJ-HUD-UNWRITTEN` 只在出过成品的工程上查；有第二种合理解释的一律降 INFO。

## 护城河（别弄丢）

- `forge/domain.py` 真值域表（反编译取证）：`agent_read_strategy: variable_condition` 会被**静默降级** `normal`；
  `dynamic_mode: single_condition` 不识别；`agent_read_condition` 平台**根本不读**。市面酒馆制卡工具都不知道。
- **开场白真源在 `hud/hud.conf.json`，不在 spec**（spec 里那条是派生物，`hud --写回` 会用 conf 覆盖它）。
  conf 正文**末尾三个零宽空格 U+200B** 是建卡界面正则 `/\u200B{3}/` 的触发标记 —— **删了导入后建卡界面静默消失、
  check 一字不报**（`HUD-OPENER-MARK` / `HUD-OPENER-DRIFT` 盯住，只在有成品工程上查）。

## 零依赖 ESM 重写（进行中 · 2026-10-16 起）

- **为什么**：手机端 ElecKoi 的 proot Ubuntu 里**没有 python3**，插件装得上、一调就死 ⇒ 把 16,189 行
  Python 引擎搬成**零依赖 ESM**（`forgejs\`），手机端插件形态 `manifest.json` ＋ `cordis.yml` ＋ 纯 `.mjs`。
  **Python 版不删、不停维护** —— 它既是黄金参照，也是桌面端正式实现。
- **怎么接手**：读 `E:\workGZQ\制卡工具\文档\接手-重写JS引擎.md`（一页就够）；详细计划与进度在
  `文档\重写-JS引擎-计划.md`（§二 两个格式决定 · §四 搬运顺序 · §七 进度 · §八 当前状态）。
- **怎么跑**：`python 差分\跑.py`（一条命令跑全套逐字节比）· `--刷` 刷新黄金 · `python 差分\数覆盖.py`
  数「语料走到了源码里的哪些诊断 code」。
- **铁律**：**行为照抄不顺手改**（要改先改 Python 版再同步）；**能逐字节比的必须逐字节比**，
  唯一例外是 **YAML**（读用自写子集 `forgejs\lib\yaml.mjs`、写默认 JSON，比对时用 PyYAML 解析回来做**结构相等**）。
- **进度：27/27 —— 全部搬完（2026-10-16）** —— `model` · `domain` · `zod` · `pack` · `validate`（47/47 种 code 全覆盖）·
  YAML 子集读取器 · `sandbox` · **`content`（`content.py` 2,158 行 · 本工程最大的一块；产出 `content.mjs` 2,794 行）** ·
  **`opener`（341,131 字节 · 界面档三条支路已真跑）** · **`scaffold`（331,130 字节）** · **`draft`（59,823 字节）** ·
  **`mods`（303,578 字节）** · **`bridge`（273,900 字节 · `bridge.mjs` 1,274 行）** · **`hud`（70,619 字节 · `hud.mjs` 952 行）** ·
  **`manual`（73,272 字节 · `manual.mjs` 870 行）** · **`theme`（58,911 字节 · `theme.mjs` 886 行）** ·
  **`coach`（709,969 字节 · `coach.mjs` 1,510 行）** · **`export`（115,144 字节 · `export.mjs` 616 行）** ·
  **`png`（80,563 字节 · `png.mjs` 748 行 · 26 情形 / 83 步）** · **`dist`（56,388 字节 · `dist.mjs` 721 行 · 17 情形 / 96 步）** ·
  **`preset`（441,131 字节 · `preset.mjs` 802 行 · 8 情形 / 122 步）** · **`lint`（161,769 字节 · `lint.mjs` 456 行 · 4 情形 / 87 步）**。
  **命令层已收工**：`forgejs/forge.mjs`（3,898 行 / 172,266 字节 ⇒ 黄金 133,725 字节 · 3 情形 / 136 步 · **33 条命令全覆盖**，
  含 `cmd_selftest` 的 45 项）＋ `forgejs/cli.mjs`（75 行 ⇒ `cli.py` 37 ＋ `__main__.py` 8）。
  `node forgejs\cli.mjs selftest` 在**只有 Node、没有 Python** 时可以独立跑、45 项全绿。
  其余：**`plan`（40,095 字节 · 904 行）· `bundle`（2,037,261 字节 · 397 行）· `guard`（16,896 字节 · 233 行）**。
  **命令层合拢时一次点出 5 处「已绿模块里的真 bug」**（全是语料没走到 ⇒ 一直绿）：`scaffold.mjs:368` 对象当位置参 ·
  `scaffold.mjs:596` `M.ydump`（JS 侧故意抛错）· `bridge.mjs:1082` `_或(seq_hint.get(a),1e6)` 把「键在、值是 0」当缺席 ·
  `content.mjs:490` `join` 不保留 `/` · `content.mjs:920` 那句「forgejs 还没搬 opener.mjs」是过期占位。
  **关键字实参写成 `名字: 值` 在 JS 里是「标签语句」**（语法合法、`node --check` 过、整句什么都不干）—— 命令层一次逮到 **27 处**；
  探测器：把 `标识符:` 改成 `标识符:;` 再 `node --check`，还能过就是标签语句。**`lenPy()` 只能量字符串**（传数组量到的是 `"a,b".length`）。
  **Node 的 fs 错误不是 CPython 的 `OSError`** ⇒ `forge.mjs` 落成 `_OS表` ＋ `_python化()` ＋ `_错话()`（类名／errno 说法／路径三样都翻）。
  已知坑：**`bundle.run` 里 `HUD.build(..., out=…)` 会把 hud 的模块级出口永久换掉且不还原** ⇒ 排在它后面跑的 `算_hud` 全黑（`bundle hud` 红 / `hud bundle` 绿）；两侧都改成「存还原」（Python 存 `B.HUD._P`、JS `finally` 里 `setOut(原出口)`），**`hud.mjs` 一字未动**。另：**`os.path.dirname(base) == project` 在 `bundle.py:98` 恒为假**（`os.walk` 的 base 是相对路径）⇒ 工程根旧 `包信息.json` 没被跳过、zip 里撞名，CPython 报 `UserWarning: Duplicate name:` —— **照抄原样，不许顺手修**。
  `preset` 撞到的坑：**`in` 成员测试 ≠ 真值判断** —— `TRIGGER_MODES` 里有**空串**，JS 里 `''` 是假值 ⇒ `!_pick(x,表,null)` 会把合法的 `''` 判成「不收」（Python 原句是 `x not in TRIGGER_MODES`）；**含空串/0 的表一律用成员测试，别用真值判断**。
  - **别用 `git checkout -- <共享文件>` 复原**（2026-10-16 事故 · 已立成接手页第 15 条纪律）：`guard` 子代理为复原自己误加的 BOM 跑了 `git checkout -- 差分/出黄金.py`，把 `plan`／`bundle` 两个**并行**子代理**尚未提交**的 `算_plan`／`算_bundle` ＋ 注册一起抹掉（100,888 → 95,831 字节）；`git log -S`／`git fsck --lost-found --no-reflogs` 全查过 —— **从未进过提交、无 dangling blob ⇒ 不可从 git 恢复**；更阴的是 `跑.py` 不带 `--刷` 时只跑 JS 侧比对 ⇒ **差分仍报 25 绿，绿灯把损坏盖住了**。父级照 `差分\比一比.mjs` 的 JS 侧镜像重写了两个算式：`算_plan` 重建后 `差分\黄金\plan.json` md5 **`CFB869B2AD9EDCE47DF50ED6C08C6DC8`**、`算_bundle` 重建后 `bundle.json` md5 **`5090C4D977938BEDC931FB3D1D060986`**，**两侧都与事故前的黄金逐字节相同**（提交 `e84a4bb`）。
    由此立的四条：① 取回旧文用 `git show HEAD:<路径>` 输出到临时文件再**定点重贴**，**绝不 `git checkout`**；② 并行子代理时**每块交付即刻提交**（未提交的定点追加是最脆的东西）；③ **子代理一旦结束 `send_message` 就到不了**（报 `active teammate "…" not found`，已第二次验证）⇒ 只能自己重建；④ **中文源码一律用 write/edit 工具写、别过 pwsh** —— PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会给无 BOM 的 UTF-8 文件**加 BOM**，`.Replace` 还会一次命中全部 21 处（这正是上面那场事故的起因）。
  依实测 grep 的依赖链：`plan` · `guard` · `bundle`（要 hud/manual/model/pack/dist/export 六件，**已全绿**）**现在就能开**；`preset` 要 `png`（已绿）。
  **行数一律用 Python 数**（`read_bytes().count(b"\n")`，`forge/` 合计 13,134 行）——
  PowerShell 的 `(Get-Content 文件).Count` 按 GBK 读 UTF-8，`draft.py` 会被数成 649（实际 815）。
- **★ 真「天生不可复现」就走「申报差异 ＋ 折法」，不许删用例**（`png` · 2026-10-16 立的规矩）：
  整段 **deflate 体**复现不出来 —— CPython 3.13.14 用上游 zlib **`1.3.1`**，Node v24.14.0 自带的是 fork **`1.3.1-e00f703`**；
  `memLevel 1..9 × strategy 0..4` 全矩阵扫过：`strategy 1/2/3` 逐字节相同、`0/4`（含默认）不同，**没有组合能复现 Python 的默认产物**；
  分歧还是**数据相关**的（400×`A`、2400 B 渐变逐字节同；388 B 卡 JSON 的最短分歧前缀＝**42 字节**）。
  差分台折成**逐块分解**（每块记「类型 + 数据 sha1」；`tEXt eleckoi-card` 那块改记「gzip 容器头 10 字节 + 容器尾 8 字节 + gunzip 后字节数/sha256」），
  折法写进 `差分\语料\png.json` 的「说明」＋生成器 `差分\_造png语料.py`。**`preset` 写 PNG 直接照抄 `算_png`。**
  另：`png` 子代理顺手修掉差分台一个保真度 bug —— `差分\比一比.mjs:351` 的 `动()` 开头加 `if (Buffer.isBuffer(x)) return x`（Python 侧对 `bytes` 原样放行）。
- **差分台的两处既有代码修正**（2026-10-16 · 复核过：`--刷` 重刷后旧黄金一个字节没动）：
  ① `_动()` 认 `tuple` —— Python `opener.定位()` 返回 tuple，原来整个跳过归一而 JS 侧 Array 照样归一，必红；
  ② 回收站判定 `rel.startswith(".forge/回收站/")` 放宽到「路径里出现 `/.forge/回收站/`」—— 多夹具并排时
  rel 是 `甲界面/.forge/回收站/…`。
- **差分台顺序陷阱**：沙箱开关是**进程级**状态，`算_sandbox` 跑完把它留在「开」⇒ 依赖它的模块会随
  「单跑 / 全套跑」给出两种结果。`算_scaffold` 已在进门 `SB.enable(False)`、出门还原。
  **新写 `算_X` 若碰沙箱，照此办理。**
- **两个环境地雷**：**`cpSync(..., {recursive:true})` 会把 Node 进程打崩**（本机 v24.14.0，
  退出码 `0xC0000409`，一行输出都不给）—— 递归拷目录自己用 `readdirSync + copyFileSync + utimesSync` 写；
  **`JSON.stringify` 会把 `undefined` 的键整个丢掉** —— Python 的 `None` 在 JS 侧有 `null`/`undefined`
  两个来源，记进差分结构前一律 `?? null`。
- **别照 YAML 规范写子集解析器，要照 PyYAML**：`1e3` 是**字符串**（PyYAML 浮点正则要求必须有小数点）；
  八进制是 YAML 1.1 的「前导 0」（`012` → 10，不认 `0o`）；流式标量要折行（单换行→空格，连续 n 个→`n-1` 个换行）。
- **`_动()` 后来又补了一处**：`hasattr(x, '__dict__')` —— Python `draft._体检()` 返回的是 `Issue` **对象**，
  不进这个分支 `json.dumps` 直接 `TypeError`（JS 的 `动()` 本来就把任何对象递归）。
- **Windows 的 OSError 文本只能硬抄**（Node 的错误对象里**没有 `winerror`**）：
  `[WinError 267] 目录名称无效。` · `[WinError 3] 系统找不到指定的路径。`（**是 3 不是 2**）· `[WinError 5] 拒绝访问。`
- **Python 内建 `str()` ≠ JS 里的 `_字()`**：`str(None)` 是真名字 `"None"`，而 `_字()` 是空串。
  `draft.mjs` 里单开了个 `_strPy()` 走内建语义（影响 `_字段名`、`模块`、`要的分组`、报告「问题」）。
- **`scaffold` 语料第 27 条依赖工作树形状**：`取内容层("", 工作区)` 里 `abspath("")`/`resolve("")` 都落回
  **当前工作目录（＝工具根）**，于是去扫根下最浅的 `.spec.yaml`。干净的根下固定命中
  `_tmp_scaffold-XXXX/前缀卡/source/前缀卡.spec.yaml`；**根里多一个 `_tmp_*` 残目录就会换结果**。
  跑差分前先确认工具根没有残目录（待改成显式路径）。
- **`mods` 的指纹要冻时钟**：语料里把台账步骤的 `接于` 换成 `时间`，并把时钟冻结在
  `2026-01-01T00:00:00.000000+08:00`（细节写在 `差分\语料\mods.json` 的「说明」里）。
- **`if (x)` ≠ `if x:`**（2026-10-16 真 bug）：JS 里**空数组/空对象是真值**，Python `if x:` 里 `[]`/`{}`/`""`/`0` 全假。
  `opener.mjs` 的 `写回()` 原先写 `if (problems)`，HUD 返回 `problems = []`（校验通过）时 JS 多跑一条支路，
  返回值里凭空多一个 `"写回": false`。已改走 `content.mjs` 的 `CONTENT.pyTruthy()`（`:122` 导出，`:133` 的 `或()` 用它）。
- **`regex-<uuid4>` 这种新生成的 id 要按形状收**：两侧已有 `收_uuid`（`出黄金.py:878-893` 定义 · `:443`/`:955` 用；
  `比一比.mjs:887-902` 定义 · `:599`/`:950` 用），只认 `-XXXX-XXXX-` 两段，剩下的 hex8 交给原有形状规则。
- **只加「坏夹具」不够，得加「形状不同」的正夹具**：`hud` 子代理把 `bodies.get(k, 正文)` 的默认值写成文件名
  `views[-1]` —— 主夹具两个键都在、默认值永不求值，一直绿；新加的「干净」夹具才暴露（预览页短 78 字符）。
- **子代理不是 teammate**：`send_message` / `list_agents` 都够不着 `subagent` 工具派出的子代理
  （报 `active teammate "…" not found`）⇒ 要传话只能**在派工单里一次写死**，或父级自己把活干了。
- **`出黄金.py <名> --刷` 的参数顺序有坑**：`--刷` 会被当成语料名（`FileNotFoundError: …语料\--刷.json`）；
  真要刷黄金……目前就是先跑 `<名>` 把黄金写出来再比。
- **码点 ≠ UTF-16 码元**：Python 的 `len(s)`/`s[i]`/切片都按**码点**，JS 的 `s.length` 按**码元** ⇒ 一个 emoji 差一位。
  `manual` 逮到三处：`_cell` 的 `limit`、`_render_index` 的「字数」列（😀 让 127→128，索引 sha1 直接对不上）、
  `model.mjs:220 estTokens` 的分母（手册「≈token」列 8→10）。`validate.mjs` 已导出 `lenPy` 备用。
- **printf 家族必须手写**：`"%s" % None` 是 `"None"`（`util.format('%s', null)` 给 `"null"`，顶不了）·
  `"%s" % exc` **不是** `M.pyRepr(exc)`（Node 的 `SyntaxError` 在 pyRepr 下给 `{}`）·
  `"{:,}"` 不能用 `toLocaleString()`（ICU 可能给 NBSP）· `"%.1f"` **不是** `toFixed`（半值取偶 ＋ `.0` 补齐）
  ⇒ `_fmt` / `_千分` / `_fmt1`。另：**Python `str.replace` 换全部、JS 只换第一处**（`SHOWCASE_SHELL` 里 `@@card@@` 两次）。
- **路径与数字的写法差**：`str(pathlib.Path(v))` 会把 `/` 规范化成 `\`（`os.path.join` 不会）；
  `json.dumps(21.0)` 是 `21.0`、`JSON.stringify(21)` 是 `21` ⇒ 归一化要加「折浮」。
- **`try` 边界不照抄会把两个分支合成一个**：`theme` 里「顶层不是对象」的手写守卫**必须写在 `try` 之外**，
  否则被同一个 `except` 收成「读不出来」。用顶层是数组 / 数字的两份 `.json` 才抓得住。

