# ElecKoi 里的 AI 能不能直接跑 forge.py？—— 本机实测结论

> 2026-10-08。第二十四轮。上一轮的推论**错了一条**，这份文档把错的划掉、把实测的摆上。
>
> **一句话**：沙箱机制本身是通的，PowerShell 5.1 也能跑；`forge.py` 能启动、能读工程、能往工作区写。
> **但「删除 / 改名」被沙箱拒了** —— 而 `forge.py` 的每一次落盘都靠改名（`os.replace`）。
>
> **2026-10-08 补：这条路已经修好了。** 给 forge 加了「**沙箱友好模式**」（`--沙箱` /
> `FORGE_SANDBOX=1`）：只创建、只覆盖，不删文件、不改名。见第五节路 2。
>
> **再补：第五节路 3（走插件）也做出来了** —— `插件/制卡工坊/`，宿主插件，
> 让 AI 手上多一个不受沙箱限制的 `cardforge` 工具。**这条比路 2 更好**（保住原子落盘），
> 装与用见 `文档/C轨插件·实测单.md`。
> 下面第一到四节留作**证据与缘由**，别删 —— 它们解释了为什么要有这两条路。

---

## 〇、先纠正上一轮的两条错判

| 上一轮的说法 | 实测后 |
|---|---|
| 「这台机器没装 PowerShell 7，装一个就能好」 | ❌ **错**。受限令牌下 **PowerShell 5.1 本来就跑得起来**，实测退出码 0、输出正常、写文件成功。**不用装任何东西。** |
| 「命令失败（`0xC0000142`）是当前版本的现象」 | ❌ **错**。那 8 次失败全在 **9 月 25–27 日**；ElecKoi 是 **10 月 7 日**才更新到现版本的 `app.asar`。10-08 的三个新会话**一次命令都没调过** —— 「现在还能不能跑」**根本没有数据**。 |

> 教训记档：**别把「旧版本的一次失败」当成「当前版本的现象」**。查会话日志时先看时间戳，再看 `app.asar` 的改动时间。

---

## 一、怎么测的（可复现）

ElecKoi 的沙箱代码全在 `app.asar` 里。写了个 asar 解析器把它**原样抽出来**，在本机真跑：

- 抽出物：`.workbuddy/_沙箱实测/node_modules/`（`@deepseek-ai/dsh-sandbox-windows-acl` +
  `dsh-win32-process` + `dsh-subprocess` + `koffi` 原生模块等）
- 实测脚本：`.workbuddy/_沙箱实测/实测*.mjs`（11 个，覆盖机制 / 全链路 / 读写边界 / 令牌）
- 跑法：`<managed node> 实测N_xxx.mjs`

**抽 asar 的一个坑（以后还会踩）**：Electron 会把 `**/*.node` 之类**解包到磁盘**，
这些条目在 asar 头里**没有 `offset` 字段**（只有 `unpacked: true`）。
按 `offset or 0` 去读，会把**每个文件都读成同一段**（因为都从 `base+0` 读）。
正确做法：`unpacked` 的去 `app.asar.unpacked/` 拷，其余按 offset 读。

## 二、实测结果

### 2.1 沙箱机制本身：**通**

| 测的什么 | 结果 |
|---|---|
| 建受限令牌（`AclSandbox.init()`） | ✅ 成功 |
| 受限令牌下起 `cmd.exe` | ✅ 退出码 0 |
| 受限令牌下起 **`powershell.exe`（系统自带 5.1）** | ✅ 退出码 0 |
| 受限令牌下起 `node.exe` | ✅ 退出码 0 |
| 全链路：宿主 → `runner.js` 子进程 → 受限 pwsh | ✅ 通（`windowsHide` 开/关、管道/继承四种组合都试了） |
| 管道采集子进程输出 | ✅ 正常（上一版脚本按 `{text}` 取 Buffer 才显示为空，是脚本写错） |

### 2.2 `forge.py` 本体：**能起、能读、能写**

| 测的什么 | 结果 |
|---|---|
| 真身 `python.exe -V`（`versions/3.13.12`，非 venv 重定向器） | ✅ `Python 3.13.14` |
| `PYTHONPATH` 指到 venv 的 `site-packages`，`import yaml` | ✅ `yaml 6.0.3` |
| `forge.py --help` | ✅ 0，正常打印帮助 |
| `forge.py new 试卡`（在工作区里建工程） | ⚠️ 目录建出来了（`hud/source/成品/测试`），**但改名那步挂了** |
| 读项目目录里的文件（`README.md`） | ✅ 能读 |
| 往项目目录写文件 | ❌ 被拒 —— **这正是设计意图**（只允许写工作区） |
| 往工作区写文件 | ✅ 能写 |

> **venv 的 `python.exe` 是个重定向器**，它自己还要再起一次真身进程，在受限令牌下起不来
> （退出码 101，`Unable to create process using ...`）。
> → **在沙箱里一律用真身 python + `PYTHONPATH` 指到 venv 的 `site-packages`。**

### 2.3 决定性的一条：**删除与改名被拒**

同一个文件、同一个用户，只差「在不在沙箱里」：

| 操作 | 沙箱外 | 沙箱内（受限令牌） |
|---|---|---|
| 打开读（`GENERIC_READ`） | ✅ | ✅ |
| 打开写（`FILE_WRITE_DATA`） | ✅ | ✅ |
| **打开删（`DELETE`）** | ✅ | ❌ **`WinError 5`** |

同一条结论，用 Python 的 `os.*` 再验一遍（工作区根目录内、子目录内、新建的文件、预存在的文件，**全覆盖**）：

| 操作 | 结果 |
|---|---|
| 新建文件 / 新建目录 | ✅ |
| 写文件内容 | ✅ |
| 改名 `os.rename` | ❌ `WinError 5` |
| 删除 `os.remove` | ❌ `WinError 5` |
| **原子替换 `os.replace`** | ❌ `WinError 5` |

**换位置不改变结论**：把授权根放在 `%APPDATA%` 下（与 ElecKoi 真实工作区同构）与放在 `E:\workGZQ` 下，**表现一致**。
**换令牌高度也不改变结论**：本进程实测是**提权（High）**的，一样删不掉。

**为什么**（从授权代码与 DACL 读出来的）：
沙箱给授权根同时加了三条 —— 能力 SID 的 `(OI)(CI)(W,D,DC)`、**`Everyone:(CI)(DENY)(DC)`**、**Low 完整性标签**；
并且在受限令牌里**禁掉了 `Authenticated Users`**（官方文档明写）。
而普通目录里「用户能删自己的文件」多半是靠 `Authenticated Users:(M)` 这条 —— 它一被禁，`DELETE` 就没了来源。

> ⚠️ 这一条**与官方文档的说法不一致**：`dsh-sandbox-windows-acl/README.zh.md` 写着
> 「基于 `DELETE` 的删除、`MAXIMUM_ALLOWED` 与常规读写打开不受影响 —— 两种结果都已被 runner 套件钉住」。
> 我按它自己的代码复现，却是删不掉。**是文档乐观，还是我这套复现少了一环，尚不能下定论** —— 见第五节的真机一句话验证。

## 三、这条路卡在哪

`forge.py` 的**每一次落盘都靠改名**：

- `content.commit()`：写临时文件 → 证明能打包 → **`os.replace` 覆盖**（这是「证明不过就一个字不写」那道保护）
- `forge new`：抄骨架后**把 `骨架.spec.yaml` 改名**成 `<卡名>.spec.yaml`
- `回收站`：删/改都是**移动**文件进 `.workbuddy/回收站/`

**改名 = 需要源文件上的 `DELETE` 权限 = 沙箱拒。** 所以：
**在 `workspace-write` 沙箱里跑 `forge.py`，会在第一次落盘时失败 —— 而 `new` 连第一步就过不去。**

## 四、还有一条官方的「后门」：一次性升权

`pwsh` / `write` / `edit` 三个工具都带一个参数，官方原话：

> `sandbox_permissions`：**"The narrowest wider sandbox mode for a one-shot retry of the exact command the sandbox just denied; the retry asks the user for approval."**
> 枚举：`workspace-write` / `danger-full-access`；配一个必填的 `justification`（给用户看的理由）。

也就是说：**沙箱挡下一条命令后，AI 可以用更宽的模式就地重试一次，这一次会弹给你批准。**
同时工具说明里还有一句硬话：「被沙箱挡掉的文件操作是**策略拒绝：不要换法子重试**」——
所以正路就是**升权重试**，不是绕。

## 五、三条出路（按代价排）

| # | 做法 | 代价 | 何时用 |
|---|---|---|---|
| **1** | **一次性升权**：把「做一张卡」压成**一条命令**（一个脚本跑完全流程），AI 用 `danger-full-access` 重试一次，你批准一次 | 每次制卡点一次批准；批准后就是全权限（沙箱的意义暂时让位） | 想要最强的原子落盘 |
| **2** | ✅ **已实现** —— **沙箱友好模式**：`--沙箱` / `FORGE_SANDBOX=1`。forge 切成「只创建、只覆盖」：落盘直接覆盖目标、临时文件删不掉不算失败、回收站改用墓碑、撤皮肤写空壳、撤模块留目录（组装只看 conf） | 丢掉原子落盘（写一半崩了留半份）；工程里会留几个删不掉的空壳/墓碑（都很小） | **在 ElecKoi 里直接做卡**（推荐先走这条） |
| **3** | ✅ **已实现** —— **走插件（C 轨）**：`插件/制卡工坊/`。纯宿主插件，注册一个 `cardforge` 工具；**宿主进程起的子进程不在那层沙箱里**，读写改名、原子落盘全都正常 | 要在真机上装一次；要给角色的「扩展工具」开关打开 | **长期正解 / 推荐**，全功能 |

> 路 2 怎么落地（改动面，2026-10-08）：新增 `forge/sandbox.py` 一个开关与四个助手
> （`land` 落盘 / `remove` / `rmtree` / `retire` 墓碑 / `shell` 空壳），
> 把散在 `content` `scaffold` `mods` `theme` `pack` `dist` 里的删/改名调用点全部收口；
> **自检第 42 项**是它的门禁：把 `os.replace` / `os.remove` / `rmtree` 换成炸弹，
> 再跑「开新卡 → 加条目 → 出成品 → 验卡」，全程一次都不许碰到那三个。

> 路 3 怎么落地（改动面，2026-10-08）：`插件/制卡工坊/` 五个文件（`package.json` ·
> `cordis.patch.yml` · `index.js` · `locale/{zh,en}.json`）。`index.js` 照官方
> `@deepseek-ai/dsh-tool-present` 的形状写 —— `defineTool` + `ctx.tools.register()`，
> 官方文档原话「注册一个工具就足以让它可见」。本机 49 项冒烟全绿，
> 其中**「`new` 那步改名成功」是「宿主不受沙箱管」的决定性证据**。
> 装与用见 `文档/C轨插件·实测单.md`。

## 六、要你在真机上做的：一句话，一分钟

> **这条验证的意义变了**（2026-10-08 补）：沙箱友好模式已经做好，所以**路已经能走**。
> 现在验证它只是为了回答一个问题：**要不要戴 `--沙箱`**？
> ——能删能改名，就**不戴**（保住原子落盘）；不能，就戴上。两种都能做出卡来。

上面那条「删/改名被拒」，我复现得斩钉截铁，但官方文档说能用 —— **只有你的真机能定案**。
在 ElecKoi 里对它说（原样复制）：

> 用 pwsh 依次跑这三条，把每一步的原样输出发我：
> `Set-Content -Path "沙箱试.txt" -Value a`；
> `Move-Item "沙箱试.txt" "沙箱试2.txt" -Force`；
> `Remove-Item "沙箱试2.txt" -Force`；
> 最后 `Write-Output "三条都过了"`

**怎么看结果**：

| 你看到 | 说明什么 | 下一步 |
|---|---|---|
| 末尾出现 `三条都过了` | 真机能删能改 → **我的复现少了一环** | forge.py 直接跑就行，**不用戴 `--沙箱`**（保住原子落盘） |
| 中间某条报 `[sandbox: file access denied under workspace-write mode]` 或「拒绝访问」 | 与我的复现**一致** | 跑 forge.py 时**戴上 `--沙箱`** |
| 整条命令报 `[exit code: 3221225794]` | 命令执行本身在现版本仍然坏的 | 那就是另一个问题，回来找我（这次有真数据了） |

顺带一条（可选，验证沙箱里能不能跑 python —— 这决定出路 1 要不要把 python 也算进去）：

> 用 pwsh 跑 `python -V`，把原样输出发我。（若报「找不到命令」，说明这台机器的 PATH 与我的不同，
> 换 `py -V` 再试。）

## 七、证据出处（都可复核）

| 东西 | 在哪 |
|---|---|
| 沙箱实现（令牌 / DACL / spawn） | `.workbuddy/_沙箱实测/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/`（从 `app.asar` 原样抽出） |
| 进程创建实现与标志 | 同上，`@deepseek-ai/dsh-win32-process/lib/index.js`（`creationFlags = 0`；`dwFlags = 257`） |
| 沙箱官方说明（含 `0xC0000142` 两条成因、禁用 `Authenticated Users`、DELETE 那条断言） | 同上，`README.zh.md` 第 104 / 108 / 129 行 |
| 实测脚本与结论 | `.workbuddy/_沙箱实测/实测1..11*.mjs` |
| 会话日志里的真实失败与退出码 | `%APPDATA%\eleckoi-desktop\dsh-runtime\sessions\**\session.v3.jsonl`（**时间戳 9/25–9/27**） |
| 工具定义（`sandbox_permissions` / 官方红线原话） | 同上，`request/header` 里的 tools 数组 |
| ElecKoi 真实工作区上的授权痕迹 | `icacls %APPDATA%\eleckoi-desktop\workspace` → `S-1-4-…:(OI)(CI)(W,D,DC)` |

> 用户数据**全程只读**打开（连 sqlite 都是 `mode=ro`）；测试用的临时工作区跑完即删，无残留；
> 艾瑟兰一个字没碰。
