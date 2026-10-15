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

**DSH → 插件 → 添加插件 → 贴仓库地址 → 安装 → ★ 重启一次宿主。**

```
https://github.com/liangchen111/eleckoi-cardforge
```

也可以贴本机目录的绝对路径（例如 `X:\你的工具目录\插件\制卡工坊`），或贴 `插件/制卡工坊/` 的路径改本地版。

**插件只在宿主启动时载入，装完不重启不生效**（装完立刻去看，工具和预设都还没出现）。

连不上 GitHub 时，安装前的预检是 `git ls-remote`、上限 5 秒，会报「连接 GitHub 超时」。
给 git 单独配代理（不动系统代理）：

```
git config --global http.https://github.com/.proxy http://127.0.0.1:17890
# 回滚：git config --global --unset http.https://github.com/.proxy
```

或改用「试试其他方式」贴本机目录路径。

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
