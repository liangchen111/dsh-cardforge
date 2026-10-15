# 制卡工坊 —— 一个普通 DSH 插件

> 一句话：装上之后，**会话里的 AI 多一个 `cardforge` 工具**，可以直接跑本机的 `forge.py` 做卡。
> 它不画任何界面、不依赖电子爱；在任意 DSH 里都能装。

---

## 一、它是什么形式的插件

| 项 | 取值 |
|---|---|
| 形态 | DSH **bundle**（组合包）：`package.json` 里 `dsh.bundle.patch` 指向 `cordis.patch.yml` |
| 补丁 | `cordis.patch.yml` 向当前 profile 注入一条插件记录（`id: cardforge`） |
| 宿主入口 | `插件/制卡工坊/index.js`（`main` / `exports["."]` 都指它） |
| 导出 | `name` · `inject` · `Config` · `apply` |
| 注入的服务 | 只有 `tools`（`@deepseek-ai/dsh-tools`）—— 所以要注册工具 |
| 不注入 | 任何电子爱专有服务（缺了也照常加载，见 §六） |
| 要不要前端 | **不要**。没有 `client.js`，不占任何 UI 插槽 |

为什么不发一个「跑在命令行沙箱里的工具」：DSH 自带的 `dsh-tool-pwsh` 跑在**受限令牌沙箱**里
（能读、能写，但**不许删、不许改名**，实测 `WinError 5`），而 `forge.py` 每次落盘都靠改名
（`os.replace` / `os.rename`，回收站是「移动」）。宿主插件起的子进程是普通权限的 node 进程，
**不受那层沙箱管** —— 原子落盘、改名、删除全都回来。

（只能走命令行工具的环境：给 `forge.py` 的命令加 `--沙箱`，丢掉原子落盘但能干活。）

---

## 二、装

**DSH → 插件 → 添加插件 → 贴包名 → 安装 → ★ 重启一次宿主。**

```
dsh-cardforge
```

包名按插件生态的惯例用 `dsh-` 前缀（本机已装的 `dsh-pocket` / `dsh-context` / `dsh-bookmarks` /
`dsh-whale-widget` 都是这个规矩）。贴包名装的好处：对方只拿到一个 1.7 MB 的包，
**不碰仓库、不拉历史**（本项目的源码仓库是私有的，也不打算开）。

也可以贴本机目录的绝对路径（例如 `X:\你的工具目录\插件\制卡工坊`），或贴 `插件/制卡工坊/` 的路径改本地版。

**刚发版的那几分钟可能装不上**：插件管理器默认用「中国大陆镜像源」，它抓新包有延迟。
等一会儿，或把安装源切成官方源（`registry.npmjs.org`）再装。

**插件只在宿主启动时载入，装完不重启不生效**（装完立刻去看，工具和预设都还没出现）。

（只有走「贴 Git 地址」那条路才会碰到 GitHub 连不上的问题：安装前预检是 `git ls-remote`、
上限 5 秒，报「连接 GitHub 超时」。贴包名装不碰 GitHub。）

---

## 三、配置（写进 `cordis.patch.yml`，改它不用动代码）

| 键 | 出厂默认 | 作用 |
|---|---|---|
| `python` | 空 | 跑 `forge.py` 的解释器。**留空＝自己找**：`FORGE_PYTHON` → `%LOCALAPPDATA%\Programs\Python\Python3xx` → `C:\Python3xx` / `D:\Python3xx` → DSH 运行时自带的 python → `python3` → `python` → `py -3`，挑**真的能 `import yaml`** 的那一个 |
| `pythonPath` | 空 | 追加到 `PYTHONPATH`（拿 venv 的 site-packages 喂基础解释器时才要填） |
| `forge` | 空 | `forge.py` 的位置。**留空＝自动认**：插件住在 `<仓库>/插件/制卡工坊/`，往上两级就是仓库根 |
| `cwd` | 空 | 默认工作目录。留空＝`<你的用户目录>/Documents/ElecKoi卡库`（没有就自动建；调用方给了 `cwd` 参数就听调用方的） |
| `timeoutMs` | `180000` | 单条命令的墙钟上限，到点杀进程 |

`forge.py` 只依赖 `PyYAML`。找不到带 PyYAML 的解释器时，工具照常注册，
但每次调用会在 stderr 先顶一句提示。

---

## 四、用

对 AI 说「用 cardforge 做一张卡」，或直接让它先跑 `["--help"]`。

```
["--help"]                              看全部命令
["guide"]                               取制卡规程
["guide","--节","一"]                    取规程某一节
["make","--示例"]                        打出一张完整卡稿（长夜便利店）
["make","E:/卡库/我的卡.yaml"]            一张稿一次落成
["png","E:/卡库/我的卡.card.json","--png"] 出能直接导入的角色卡 PNG
```

**别加 `--沙箱`** —— 这个工具由宿主进程直接执行，本来就不受命令行沙箱限制。

---

## 五、卸

插件管理器里卸载 → 重启宿主（同样因为插件只在启动时载入）。

---

## 六、在纯 DSH 里它是怎么活的

电子爱给插件开了一个预设管理服务（`eleckoiAgentPresetsApi`），插件的第二件事会用到它。
**取法是不写死的**：`ctx.get('eleckoiAgentPresetsApi', false)` 拿不到就当没有这回事，
只记一条日志。所以：

- 纯 DSH：只注册 `cardforge` 工具，一切正常。
- 电子爱：工具 + 顺手把「制卡助手」创作预设装进预设管理器。

另外，插件的 `inject` 只有 `['tools']` —— DSH 的 cordis 只认「字符串数组」或「服务名→配置」两种形状，
**没有 `{ required, optional }` 这种写法**（写成那样会被当成两个叫 `required` / `optional` 的服务，
插件永远等不到，且**不报错**）。可选依赖一律靠 `ctx.get(名字, false)`。

---

## 七、清单字段：我们声明了什么，以及为什么版本写 `*`

| 字段 | 我们的取值 | 依据 |
|---|---|---|
| `name` / `version` | `dsh-cardforge` / `0.28.2` | 清单里**唯二强制**的字段；名字按生态惯例带 `dsh-` 前缀 |
| `dsh.bundle.patch` | `./cordis.patch.yml` | **bundle 的判定字段**。没有它也装得上，但只当普通依赖装、不激活任何层，并打一行 `dsh: warning: … declares no dsh.bundle` |
| `dsh.manifestVersion` | `1` | 不写也行，写了就是明说「按这一版约定读」 |
| `type` / `main` / `exports` | `module` / `插件/制卡工坊/index.js` | 官方最小包就长这样 |
| `files` | 含 `cordis.patch.yml` | 漏了会把补丁排到包外 ⇒ 装了不激活 |
| `engines.dsh` | `>=0.2.0-rc.2` | **只是声明**：安装器与加载器都不强制它，也不校验 SemVer 语法（`dsh-package-manifest` 的说明原文） |
| `peerDependencies` | `@deepseek-ai/dsh-tools: "*"` 等 | 见下 |

**为什么不写死版本。** 安装前的那道兼容性检查，只看 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 这些名字，
并且是**拿运行时的 DSH 版本去卡你写的区间**（源码：`dsh-app-boot` 的 `evaluatePluginCompatibility`，
先 `if (!Object.hasOwn(fields, "peerDependencies")) return`，然后对每个 peer 做
`semver.satisfies(runtimeVersion, range, { includePrerelease: true })`）。不满足就报
`incompatible-version` **拒绝安装**。所以一旦把 `@deepseek-ai/dsh-tools` 钉成某个确切版本，
这个包就只能装在那个版本的宿主上 —— 桌面版、电子爱、手机版带的 DSH 版本不一定一样。
我们写 `*`，意思是：**任何 DSH 版本都放行**（本插件只用 `ctx.tools.register` + `defineTool`，
这两个接口跨版本很稳）。`@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 不在被检查的名字里，
写上只是为了把「我们 import 了它们」讲明白。

装了之后想核对：在插件管理器里看这个包的补丁行与存活条目（CLI 侧另有一组 `dsh plugin …` 命令，见官方 plugins/install 文档）。
