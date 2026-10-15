# -*- coding: utf-8 -*-
"""forge —— ElecKoi 制卡工具内核。

分层：
    model     数据模型：格式常量、键序、读写助手
    domain    真值域表与静默降级拦截（本工具的护城河）
    pack      spec.yaml ⇄ card.json 打包解包
    validate  校验：值域 + 一致性 + 交付前护栏
    zod       Zod 校验代码（schema_code）的保形拆解与拼回
    content   内容编辑：条目 / 分组 / 变量 / 正则的增删挪 + 回收站
    opener    开场白：只说正文是什么，末尾那三个零宽标记由它负责
    coach     制卡向导：一份内容两个出口（给 AI 的规程 + 给 ElecKoi 的向导卡）
    draft     卡稿：照着「这张卡该长什么样」一次落成（全绿了才落，坏稿一个字不写）
    bridge    酒馆卡 / 世界书 ⇄ ElecKoi
    scaffold  开新卡（抄骨架；--从 = 连界面层一起接手现成的卡）
    hud       卡内界面组装（把工程拼成整页 HTML，再写回正则）
    theme     皮肤系统（只覆盖颜色槽 + 对比度体检）
    bundle    工程打包（附一份带 sha256 清单的「包信息.json」）
    dist      分发：清单与收包（导入时逐条查路径，恶意包整包拒收）
    sandbox   沙箱友好模式：只创建、只覆盖 —— 不许删 / 不许改名时也能干活
    guard     只读禁区名单（任何写操作落盘前先问它）
    png       卡 → 图片卡（PNG tEXt `eleckoi-card`，手机端导入唯一认的）
    preset    卡 → ElecKoi 创作预设（PNG tEXt `eleckoi_agent_preset`；**不 gzip**）
    plan      规划书：九节模板 / 从现成卡反推 / `--查` 体检
    lint      正文体检（防八股）：只查句式骨架，不查词
    cli       薄壳：找到仓库根，把 `forge.py` 当脚本跑起来（`python -m forge` / `pip` 入口）
"""

__version__ = "0.28.4"

# 内核里的提示语是中文 + ✔ / ✘ 这类符号，而 Windows 控制台默认是 GBK：
# 不换编码就会 `UnicodeEncodeError: 'gbk' codec can't encode character '\u2714'`。
# `forge.py` 自己会 reconfigure，但**当库用**（测试、别的脚本 `from forge import png`）
# 就不会走那里 —— 所以在这里兜一次。失败（比如 stdout 被换成不支持 reconfigure 的对象）
# 不算错，静默跳过。
import sys as _sys                                   # noqa: E402

for _流 in (_sys.stdout, _sys.stderr):
    try:
        _流.reconfigure(encoding="utf-8")
    except Exception:
        pass
del _流, _sys

