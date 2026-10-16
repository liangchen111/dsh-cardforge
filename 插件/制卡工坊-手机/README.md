# 制卡工坊 · 手机壳

给**手机上不装 Python 也能做卡**用的插件。引擎（原来是 `forge.py` 3,109 行 ＋ `forge\` 27 个模块
13,134 行）已经整份搬成零依赖 ESM，这里只是给它套一层手机端认的插件壳。

## 这个目录是什么

```
制卡工坊-手机/
├─ manifest.json          插件清单（files 是本插件全部文件的白名单，别手改）
├─ cordis.yml             装载入口（形状照 APK 里两个内置插件）
├─ 制卡工坊.mjs            Host 入口：注册 cardforge 工具；引擎在宿主进程里跑
├─ forgejs/               引擎（27 个 .mjs，零依赖：只用 node: 与相对路径）
├─ assets/                骨架卡 / 模块 / 主题 / HUD 素材
└─ samples/               示例卡
```

`forgejs/cli.mjs` **故意没搬** —— 那是「在仓库里用 node 跑 Python 版」的薄壳，它要求旁边有
`forge.py`；手机上两样都没有。壳用的是自己的入口 `制卡工坊.mjs`。

## 装机

把**整个 `制卡工坊-手机\` 目录**放进手机端 DSH 的插件目录（与 APK 内置的
`assets/dsh-plugins/context-pressure`、`assets/dsh-plugins/agent-session-bridge` 同一层）。
装好后宿主会在启动时读 `manifest.json`，按 `cordis.yml` 装载 `制卡工坊.mjs`。

> `manifest.json` 的 `files` 白名单里必须列全所有 `.mjs`（内置插件就是这么干的）。
> 别手改它 —— 跑一次同步脚本会自动按落盘结果重写。

## 手机上怎么用

插件给宿主注册一个工具 `cardforge`，直接说人话就行，例如：

- 「用制卡工具开一张新卡，叫 `我的第一张卡`」
- 「给这张卡加一个条目，标题 `门规`，正文 `……`」
- 「跑一下检查」「打包」「出图」
- 「把制卡规程的目录给我看看」（＝`guide`）

参数就是命令行那套：工具收 `args`（字符串数组，例如 `["new","我的第一张卡"]`）与可选的 `cwd`。
33 条命令一条不少，`--help` 能列出全部。

## 维护：引擎改了之后

**真源永远在工具根的 `forgejs\`** —— 引擎只在那里改，改完跑：

```powershell
node 插件\同步手机壳.mjs      # 把 forgejs\ assets\ samples\ 推过来，并重写 manifest.files
```

别在壳里手改引擎（下次同步会被覆盖）。同步脚本自己遵守两条纪律：不用
`fs.cpSync(..., {recursive:true})`（本机 Node v24.14.0 上会把进程打崩，退出码 `0xC0000409`），
`manifest.json` 的 `files` 按实际落盘结果重写。

## 自检

```powershell
node 插件\手机壳自测.mjs
```

它用一个假 `ctx` 把工具注册进来，在临时工作区里真跑
`--help` / `guide` / `new` / `entry` / `var` / `check` / `build` / `png` / `selftest` 九条，
并检查跑完 `process.cwd()` 与 `process.stdout.write` 都还原了。全绿输出 `结论：手机壳自测全绿 ✔`。

## 两件要知道的事

1. **引擎从不叉进程**：`forgejs\**\*.mjs` 里 `child_process|spawn|execSync` 零命中，没有 Python 也能全跑。
2. **桌面端那份是另一套壳**（`插件\制卡工坊\`，走 `package.json` ＋ `cordis.patch.yml`，当前用
   Python 解释器跑 `forge.py`）。两边共用同一套引擎文件，桌面那份今天仍在用 Python ——
   要切成 JS 是另一件事，没在本轮动它。
