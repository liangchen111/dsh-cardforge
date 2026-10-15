# -*- coding: utf-8 -*-
"""照一份「卡稿」一次落成整张卡。

为什么有它
──────────
`new` → `group` → `entry`×N → `var` → `regex` → `opener` → `build` → `check`
是七八次进程启动。人用不累，**AI 在对话里用就贵得离谱**：每次调用都是一整轮
（上下文从头重发一遍）。内容想清楚之后，真正要的是「一次落成」。

稿子写的是**这张卡该长什么样**，不是「先做这步、再做那步」：

  · 条目按**标题**认人 —— 卡里已有同名的就改它，没有才新建。
    所以不必先搞清楚骨架里现成有什么。
  · 分组 / 变量对象缺了就自动补，只在报告里说一句（名字打错也看得见）。
  · **全程在临时目录里做，全绿了才整棵拷到目标位置。**
    稿子有毛病时，目标位置**一个字都不会被写** —— 这是这个命令最要紧的一条。

落成之后就是普通工程：`entry` / `var` / `check` / `build` 照旧接着用。

稿子长什么样（YAML；只有「卡名」是必填）
────────────────────────────────────────
    卡名: 长夜便利店
    到: E:/卡库                  # 落点；命令行 --到 优先
    模块: [骰子]
    清空条目: true               # 先把骨架自带的条目清掉（开场白那条留着）
    分组: [角色, 世界]
    对象:
      - 名: 玩家
      - 名: 门店
        父: 玩家
    变量:
      - 对象: 玩家
        名: 信任
        类型: number
        初值: 0
        说明: 玩家对这个店长的信任
    条目:
      - 标题: 核心 · 世界总纲      # 与骨架同名 -> 改它；新的 -> 建它
        正文: |
          多行正文直接写。
      - 标题: 世界 · 长夜便利店
        模板: 关键词              # 常驻 / 必读 / 关键词 / 选读
        分组: 世界
        关键词: [便利店, 夜班]
        提示: 玩家问起这家店、夜班规矩时读这条
        正文: |
          ……
      - 标题: 规则 · 判定         # 骨架里有、但你不要
        删: true
    正则:
      - 名: 高亮方括号
        模式: "【(.*?)】"
        替换: "「$1」"
    开场白: |
      夜色落下来的时候……

**值域字段（触发方式 / 读取策略 / 内容模式 …）建议一律用「模板:」指定**，
别自己写 —— 那几个平台会**静默降级**（`变量条件` 变 `常驻`、`single_condition` 不认）。
真写了也收，`set_entry` 会当场拦下来说清降级成什么。

稿子拿不准怎么写：`make --模板` 是骨架（只回答「有哪些键」），
`make --示例` 是一张真能开的卡（还回答「话该写多细、哪句该放哪一层」）。
"""

from __future__ import annotations

import os
import shutil
import tempfile
from collections import OrderedDict

from . import content as CONTENT
from . import domain
from . import model as M
from . import opener as OPENER
from . import pack
from . import scaffold
from . import validate


class DraftError(Exception):
    """卡稿本身的问题 —— 这类错**一个字都不该落盘**。"""


def _静(*a, **k):
    """给底下的 add_*/set_* 用的空输出 —— 这一步的细节由本模块汇总后再报。"""


# 「照着填」的起点：空手想 YAML 的键名最容易卡壳。
# **它自己必须是一份能跑的稿子** —— 自检第 44 项会把它原样落一遍，出不来绿卡就算失败。
# 所以这里没注释掉的部分是「打开就能跑」，注释掉的是「按需打开的可选件」。
_模板 = """\
# ElecKoi 卡稿 —— 只有「卡名」是必填，其余不要就删掉。
# 填完照这份稿子做卡：python forge.py make 这份文件.yaml
#
# 条目按**标题**认人：卡里已有同名的就改它，没有才新建 ——
# 所以不必先搞清楚骨架里现成有什么。想删掉骨架自带的条目，写「删: true」。

卡名: 我的卡
# 到: E:/卡库                 # 落点；不给就用当前目录，也可以用 --到
# 模块: [骰子]                # 想接现成机制就写（有哪些：python forge.py mods）
# 清空条目: true              # 把骨架自带、而这份稿子里没提到的条目清掉
# 分组: [角色, 世界]          # 可以声明；条目里用到而没声明的也会自动建出来

条目:
  - 标题: 核心 · 世界总纲      # 与骨架同名 -> 改它（不是删了重建）
    正文: |
      这里是……

  - 标题: 角色 · 某某          # 骨架里没有 -> 新建
    模板: 必读                # 常驻 / 必读 / 关键词 / 选读
    分组: 角色
    提示: 玩家和他说话、或问起他时读这条
    正文: |
      ……

  - 标题: 世界 · 某某
    模板: 关键词
    分组: 世界
    关键词: [甲, 乙, 丙]
    提示: 玩家问起甲、乙、丙时读这条
    正文: |
      ……

# 变量（写到的对象缺了会自动建出来）
# 变量:
#   - 对象: 玩家
#     名: 信任
#     类型: number            # string / number / boolean / array / object
#     初值: 0
#     说明: 玩家对这个人的信任

# 正则
# 正则:
#   - 名: 方括号转引号
#     模式: "【(.*?)】"
#     替换: "「$1」"

# 开场白（末尾那三个零宽标记归工具管，别自己写）
# 开场白: |
#   夜色落下来的时候……
"""


def 卡稿模板():
    """一份能直接跑的卡稿骨架 —— `make --模板` 打的就是它。"""
    return _模板


# 「照着抄」的整份稿子 —— `make --示例` 打的就是它，`forge.py coach` 还会把它
# 落成 `向导/示例卡稿.yaml`（一份内容两个出口，跟规程那边一个规矩）。
#
# 它跟 _模板 的分工：
#   · `--模板` 回答「有哪些键、怎么缩进」—— 空格占位，得自己填。
#   · `--示例` 回答「**话该写到什么程度**」—— 一张真能开局的卡，形状与内容都能照抄。
#     AI 最容易失手的地方不是键名，是「写多细算够」「哪句话放常驻、哪句放关键词」，
#     一份好样板比十条规则管用。
#
# **它自己必须是一份能跑的稿子** —— 自检第 45 项会原样落一遍，出不来绿卡就算失败。
# 所以它只用了 draft 真支持的键；多加一个没实现的键，自检立刻红。
_示例 = r"""# ════════════════════════════════════════════════════════════════════
#  一份「照着抄」的卡稿 —— 长夜便利店
# ────────────────────────────────────────────────────────────────────
#  它不是骨架，是一张真能开局的卡：**形状**（写哪些键、怎么缩进）与
#  **内容**（话该写多细、哪句话该放哪一层）都照它来。
#
#  做出来：    python forge.py make 示例卡稿.yaml --到 E:/卡库
#  只验不动盘：在上面那条后面加 --试
#
#  自己开新卡时：**把这份稿子整个留下来当底子**，把设定换成你的 ——
#  别对着空文件一格一格想键名。（只想看键名：python forge.py make --模板）
# ════════════════════════════════════════════════════════════════════

卡名: 长夜便利店

# 模块：想接现成机制就写（有哪些：python forge.py mods）。这张卡不用，所以留着注释。
# 模块: [骰子]

# 清空条目：把骨架自带、这份稿子里又没提到的条目清掉。
# 本卡把骨架那四条都处理了（三条改写、一条删掉），所以开它不会误伤自己写的东西。
# 不写这一行，骨架的占位条目会全留在卡里，跟着一起进提示。
清空条目: true

# 条目里用到的分组会自动建出来；这里声明一遍，是为了「光看稿子就知道卡长什么样」。
分组: [角色, 世界, 规则]

# ── 变量 ────────────────────────────────────────────────────────────
# 只有「会变、而且要跨轮记住」的东西才配进变量。动手前三个问题要答全：
# 哪些字段、初值多少、什么条件下更新 —— 答不全就先别加。
对象:
  - 名: 阿岩
    说明: 店长本人的状态。她累不累、信不信玩家，都记在这儿；写进正文就改不动了。
    更新规则: 只按正文里真实发生过的事改；没发生过的不许凭空增减。

变量:
  - 对象: 玩家
    名: 信任
    类型: number            # string / number / boolean / array / object
    初值: 0
    说明: 阿岩对玩家的信任，0 到 100。升靠「说到做到」，降靠「答应的事没做」。
  - 对象: 阿岩
    名: 倦意
    类型: number
    初值: 1
    说明: 0 到 5。这一班阿岩累到什么程度 —— 决定她话多话少、还耐不耐烦。

# ── 条目 ────────────────────────────────────────────────────────────
# 条目按**标题**认人：卡里已有同名的就改它，没有才新建。
# 下面每段前面的 ①②③ 是「这一步在干什么」的批注，你自己写稿时不用抄。
条目:

  # ① 常驻：每轮都进提示，字数就是成本。这张卡只留一条常驻。
  - 标题: 核心 · 世界总纲
    正文: |
      【长夜便利店】

      你演夜班店长阿岩。玩家是凌晨推门进来的客人 —— 他不知道这家店为什么整夜不熄灯，你也不打算解释。
      整张卡的调子：安静、克制、留白。冷的比热的多，说的比想的多。

      三条不许违背：
      一、查库。下面的条目都不在提示里，是按需去读的；需要时自己取，别凭印象编。
      二、变量。面板上的数字只在事情真的发生时变，不许替玩家发明。
      三、口吻。先确认这一条还在，再动笔。句子短，形容词少，不替玩家做决定。

  # ② 骨架里有这一条（同名），所以这里是**改它**、不是删了重建 —— id 不动，
  #    卡里引用它的地方不会断。分组没变，写出来只是让稿子自洽（写错了会当场挪过去）。
  - 标题: 规则 · 判定
    模板: 关键词
    分组: 规则
    关键词: [判定, 掷骰, 检定]
    提示: 需要判断一件事成不成、要不要掷骰时读我。
    正文: |
      【判定】

      能靠常识定的事**不要**掷骰 —— 凌晨两点的便利店里，开门、找零、泡面，都是「成」。
      只有结果真的两说、而且两种结果都好看的时候才掷：先说清掷什么、什么算成，
      再掷 1d100，低于目标值算成。掷完必须在正文里落一个**能读出来的结果**，
      不许只说一句「你成功了」。
      判定只决定「世界怎么回应」，不用来决定「她喜不喜欢你」。

  # ③ 同样是改骨架原有的条目。这条是「选读」：每轮只把标题和「什么时候读我」
  #    放进目录，AI 觉得用得上才真去读 —— 比常驻省得多。
  - 标题: 名册 · 常用名字
    模板: 选读
    提示: 要临时给配角取名、或确认某个名字属于谁时读我。
    正文: |
      【凌晨的名字】

      阿岩记得的熟客（收银小票上的叫法）：
        连帽衫 —— 每晚两点半，一罐黑咖啡，从不说话
        抱图纸的男人 —— 三点，两瓶水，会在窗边坐到天亮
        戴耳机的高中生 —— 三点半，一个饭团，只买最便宜的
        出租车司机 —— 四点，一杯热豆浆，走前把零钱投进捐款盒

      临时路人用这些：老周、小于、阿灿、祁姐、老魏、毛毛、陈师傅、林小雨。

  # ④ 骨架里没有这一条 —— 新建。新条目**一定要给分组**：不给就全落在「未分组」，
  #    做出来的设定库是一盘散的。
  - 标题: 角色 · 阿岩
    模板: 必读
    分组: 角色
    提示: 玩家和她说话、或问起她时读这条 —— 她是这张卡的对手戏。
    正文: |
      【阿岩 · 夜班店长】

      身份与经历：二十七岁，在这家店值了四年夜班。因为白天要照顾中风后卧床的父亲，
      所以从没申请换班 —— 长夜对她不是浪漫，是一份能同时挣钱和看护的活计。
      因为见过太多凌晨的人，所以她对客人的狼狈不发表意见；因为她自己也在硬撑，
      所以她认得别人的硬撑。

      腔调：短句，少形容词，不反问。常用「嗯」「行」「随你」收尾。
        例：「热的在左边，冷的在右边。你要哪个都行，别站中间。」
        例：「我不问。你要说就说。」
        例（倦意 4 以上）：「……嗯。多少钱。」

      关系：对玩家是「一个还会再来的客人」。她不打听；但玩家连着三晚都来，
      她会开始记得他要买什么、要不要加热。

      底线：不碰客人的私事，不打烊，不打开柜台下面那个纸箱 —— 哪怕店里只剩一个人。

  - 标题: 世界 · 长夜便利店
    模板: 关键词
    分组: 世界
    关键词: [便利店, 夜班, 冷柜, 关东煮]
    提示: 玩家问起这家店、夜班规矩、货架上的东西时读这条。
    正文: |
      【长夜便利店】

      位置：地铁末班出口往东两百米，夹在一家关了门的打印店和一片工地之间。
      门头灯管坏了一根，夜里看过去是「长 夜 便利店」。

      每天凌晨一点到五点，这条街上只有它还亮着：暖气开着，关东煮的汤在锅里滚，
      收银台后面贴着一张纸 ——「本店不设监控」。

      墙上贴着三条规矩：
      一、凌晨两点后不卖酒 —— 但可以赊。
      二、关东煮过了三点全部下架，锅底倒掉。
      三、柜台下面那个纸箱不许碰，也不许问。

      这里没有超自然的东西。奇怪的从来不是店，是为什么总有人在这个点推门进来。

  # ⑤ 用不上的就删 —— 骨架里那条是演示「怎么把条目挂到变量开关上」的样板件，
  #    本卡用不上。删掉的条目进回收站，改主意了能捞回来。
  - 标题: 可选 · 时局压力
    删: true

# 正则只管显示格式，不承担内容。这条把 AI 偶尔多打出来的空行收掉。
正则:
  - 名: 折掉多余空行
    模式: '\n{3,}'
    替换: '\n\n'

# 开场白：末尾那三个零宽标记归工具管（它决定开卡时出不出建卡界面），千万别自己写。
开场白: |
  凌晨一点四十分，长夜便利店的自动门在你身后合上。

  暖气、关东煮的汤味、冰柜低沉的嗡声 —— 这条街上还剩的活气全在这儿。
  收银台后面的女人没抬头，只把扫码枪往手边挪了挪。

  「热的在左边，冷的在右边。」她说，「你要哪个都行，别站中间。」
"""


def 卡稿示例():
    """一份完整的、能直接落成绿卡的卡稿 —— `make --示例` 与 `向导/示例卡稿.yaml` 都用它。"""
    return _示例


# 卡稿里条目的「特殊键」：不是 spec 字段，是「这条怎么处理」
_条目特殊 = ("标题", "模板", "分组", "删")

# 中文友好名 -> spec 字段名。**从 content 的中文表反推**，不另手写一份 ——
# 两份表迟早漂移（改了一处忘了另一处，而且不报错）。只补几个规程里的口语叫法。
_别名 = {v: k for k, v in CONTENT._字段中文.items()}
_别名.update({"提示": "agent_selection_hint", "图标id": "icon_id"})


def _字段名(k):
    """认中文友好名，也认 spec 原名；都不是就返回 None（预检会报）。"""
    k = str(k).strip()
    if k in CONTENT.可改字段:
        return k
    return _别名.get(k)


def _取(稿, *名, 默认=None):
    for n in 名:
        if n in 稿:
            return 稿[n]
    return 默认


def _列表(x):
    if x is None:
        return []
    return list(x) if isinstance(x, (list, tuple)) else [x]


def _字(x):
    return "" if x is None else str(x)


# ---------------------------------------------------------------- 预检
def 预检(稿, 到=None):
    """动手之前先把稿子扫一遍 —— **能一次报全的就一次报全**。

    逐条做的时候才发现错，人（或 AI）就得改一处、重跑一次、再发现下一处。
    静态能查的（名字写没写、模板认不认、类型在不在、值域会不会被降级）
    在这里全查掉；剩下那些必须建出工程才看得出来的（形状对不上之类）才留到后面。
    """
    错 = []

    卡名 = _字(_取(稿, "卡名", "name")).strip()
    if not 卡名:
        错.append("没写「卡名」。")
    elif any(c in 卡名 for c in '\\/:*?"<>|'):
        错.append('卡名不能带 \\ / : * ? " < > | 这些字符：%s' % 卡名)

    模块 = [str(x).strip() for x in _列表(_取(稿, "模块", "mods")) if str(x).strip()]
    if 模块:
        from . import mods as MODS            # 只在真要接模块时才导入
        有 = {m.get("名") or m.get("name") for m in MODS.list_modules()}
        for m in 模块:
            if m not in 有:
                错.append("没有这个模块：%s（有 %s）。看现成的：python forge.py mods"
                          % (m, " / ".join(sorted(x for x in 有 if x))))

    for i, 条 in enumerate(_列表(_取(稿, "条目", "entries")), 1):
        哪 = "条目 %d" % i
        if not isinstance(条, dict):
            错.append("%s：不是一组键值对。" % 哪)
            continue
        标题 = _字(条.get("标题") or 条.get("title")).strip()
        if not 标题:
            错.append("%s：没写「标题」—— 标题就是认人的钥匙（同名即改、无名即建）。" % 哪)
            哪 = 哪 + "（无名）"
        else:
            哪 = "条目「%s」" % 标题

        if 条.get("删"):
            未知 = [k for k in 条 if k not in _条目特殊 and k not in ("title",)]
            if 未知:
                错.append("%s：说了「删」，就别再给其它字段了：%s" % (哪, "、".join(未知)))
            continue

        模板 = _字(条.get("模板")).strip()
        认模板 = 模板 in CONTENT.模板表
        if 模板 and not 认模板:
            错.append("%s：模板认不得 %s（有 %s）"
                      % (哪, 模板, " / ".join(CONTENT.模板表)))
        if 模板 == "开场":
            错.append("%s：用了「开场」模板 —— 开场白不走条目，写在稿子顶层"
                      "「开场白:」那一格里（那里会顺手补末尾那三个零宽标记）。" % 哪)

        # 值域字段：把这条先拼成一个「将要长成的样子」，交给护城河那一份实现去查 ——
        # **不在这里另写一遍值域表**（两份表迟早漂移，而这正是护城河）。
        形状 = OrderedDict()
        if 认模板:
            形状.update(CONTENT.模板表[模板])
        未知 = []
        for k, v in 条.items():
            if k in _条目特殊 or k == "title":
                continue
            名 = _字段名(k)
            if 名 is None:
                未知.append(str(k))
                continue
            形状[名] = v
        if 未知:
            错.append("%s：认不得这些字段 %s\n      能写：%s，或 spec 原名：%s"
                      % (哪, "、".join(未知),
                         "、".join(sorted(set(_别名))), "、".join(CONTENT.可改字段)))
            continue
        if 模板 == "关键词" and not _列表(条.get("关键词") or 条.get("keywords")):
            错.append("%s：用的是关键词模板，却没给「关键词」—— 这条永远不触发。" % 哪)
        形状.setdefault("content", _字(条.get("正文") or 条.get("content")))
        降 = [iss.message for iss in domain.check_entry_domains(M.ordered(形状, M.ENTRY_KEYS), 哪)
              if getattr(iss, "level", "") == "ERROR"]
        for d in 降:
            错.append("%s：会被平台静默吃掉：%s" % (哪, d.strip()))

    for i, v in enumerate(_列表(_取(稿, "变量", "variables")), 1):
        哪 = "变量 %d" % i
        if not isinstance(v, dict):
            错.append("%s：不是一组键值对。" % 哪)
            continue
        名 = _字(v.get("名") or v.get("标题") or v.get("title")).strip()
        对象 = _字(v.get("对象") or v.get("object")).strip()
        if not 名:
            错.append("%s：没写「名」。" % 哪)
        elif not 对象:
            错.append("变量「%s」没写「对象」—— 变量得挂在某个对象底下（对象缺了会自动建）。" % 名)
        t = _字(v.get("类型") or v.get("type") or "string").strip().lower()
        if t not in CONTENT.变量类型表:
            错.append("变量「%s」的类型认不得：%s（有 %s）"
                      % (名 or 哪, t, " / ".join(CONTENT.变量类型表)))

    for i, r in enumerate(_列表(_取(稿, "正则", "regex")), 1):
        哪 = "正则 %d" % i
        if not isinstance(r, dict):
            错.append("%s：不是一组键值对。" % 哪)
            continue
        if not _字(r.get("名") or r.get("name")).strip():
            错.append("%s：没写「名」。" % 哪)
        if not _字(r.get("模式") or r.get("pattern")).strip():
            错.append("%s：没写「模式」。" % 哪)

    return 错


# ---------------------------------------------------------------- 落卡
def _拷树(src, dst, out=print):
    """把一棵树**只创建、只覆盖**地拷过去（不删、不改名 —— 沙箱里也能跑）。

    copytree 要求目标不存在，而「目标目录已经在了、但是空的」是常见处境
    （比如上一趟只建了目录就失败了）。为了迁就它就先去 rmdir，反而在沙箱里
    撞墙（rmdir 属于删除）。逐文件写过去最省事，也最不容易出错。
    """
    n = 0
    os.makedirs(dst, exist_ok=True)
    for root, _dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        to = dst if rel == "." else os.path.join(dst, rel)
        os.makedirs(to, exist_ok=True)
        for f in files:
            shutil.copy2(os.path.join(root, f), os.path.join(to, f))
            n += 1
    return n


def _找规格(proj):
    源 = os.path.join(proj, "source")
    for f in sorted(os.listdir(源)):
        if f.endswith(".spec.yaml"):
            return os.path.join(源, f)
    raise DraftError("新工程里找不到 spec：%s" % 源)


def _组名(spec, gid):
    """分组 id -> 名字。找不到（或本来就是空 id）就是空串，也就是「未分组」。"""
    if not str(gid or "").strip():
        return ""
    for g in CONTENT.groups_of(CONTENT.load(spec), must=False):
        if str(g.get("id") or "") == str(gid):
            return str(g.get("name") or "")
    return ""


def _体检(spec, 成品):
    """一份 spec（或成品卡）在这份工程里通不通 —— 返回 (错误数, 警告数, issues, card)。"""
    card = pack.spec_to_card(spec)
    issues = validate.validate_card(card, os.path.basename(spec))
    return card, issues


def 落卡(稿路径, 到=None, 试=False, 保留=False, 覆盖=False, out=print):
    """照一份卡稿落成一张卡 —— 全绿了才落，目标位置要么一个字不动、要么是一整张卡。"""
    if not os.path.isfile(稿路径):
        raise DraftError("找不到卡稿：%s" % 稿路径)
    try:
        稿 = M.yload(稿路径) if M.is_yaml(稿路径) else M.jload(稿路径)
    except Exception as exc:
        raise DraftError("卡稿读不出来（%s）：%s" % (os.path.basename(稿路径), exc))
    if not isinstance(稿, dict):
        raise DraftError("卡稿得是一份键值对，读到的是 %s。" % type(稿).__name__)

    错 = 预检(稿, 到)
    if 错:
        raise DraftError("卡稿有 %d 处要先改（**一个字都没往任何地方写**）：\n%s"
                         % (len(错), "\n".join("  · " + x for x in 错)))

    卡名 = _字(_取(稿, "卡名", "name")).strip()
    dest = os.path.abspath(到 or _取(稿, "到", "to", "落点") or os.getcwd())
    目标 = os.path.join(dest, 卡名)
    if os.path.exists(目标) and os.listdir(目标):
        # 重落：稿子改了以后要再来一遍。**同名卡才让覆盖** ——
        # 判据是那份 spec 在不在，不是目录名像不像（目录名可以改，spec 名跟着卡名走）。
        同名卡 = os.path.isfile(os.path.join(目标, "source", "%s.spec.yaml" % 卡名))
        if not 同名卡:
            raise DraftError(
                "那里已经有东西了，而且看着不是「%s」这张卡的工程：\n  %s\n"
                "  **不覆盖别人的东西** —— 换个落点：--到 <目录>" % (卡名, 目标))
        if not 覆盖:
            raise DraftError(
                "「%s」这张卡的工程已经在那里了：\n  %s\n"
                "  · 想照稿子重落一遍（把它恢复成稿子里写的样子）：加 `--覆盖`\n"
                "  · 想留着现在那份：换个落点 --到 <目录>" % (卡名, 目标))
        覆盖 = True

    模块 = [str(x).strip() for x in _列表(_取(稿, "模块", "mods")) if str(x).strip()]
    临时 = tempfile.mkdtemp(prefix="forge-draft-")
    报告 = {"卡名": 卡名, "工程": 目标, "临时": 临时, "条目改": 0, "条目新": 0,
            "条目删": 0, "分组": [], "自动分组": [], "挪组": [], "对象": 0, "变量": 0,
            "正则": 0, "开场白": False, "成品": "", "文件": 0, "试": bool(试),
            "覆盖": bool(覆盖)}
    try:
        proj = scaffold.new_card(卡名, dest=临时, modules=模块, quiet=True)
        spec = _找规格(proj)

        # 1. 分组：稿子里声明的 + 条目里用到的。**缺了就补**，但把「你没声明、
        #    它自己冒出来」的那几个单独列一份 —— 多半是名字打错了，看得见才改得掉。
        要的分组 = [str(x).strip() for x in _列表(_取(稿, "分组", "groups")) if str(x).strip()]
        for 条 in _列表(_取(稿, "条目", "entries")):
            if isinstance(条, dict) and not 条.get("删"):
                g = _字(条.get("分组")).strip()
                if g and g not in 要的分组:
                    要的分组.append(g)
                    if g not in 报告["自动分组"]:
                        报告["自动分组"].append(g)
        现存组 = {g.get("name") for g in CONTENT.groups_of(CONTENT.load(spec), must=False)}
        for g in 要的分组:
            if g in 现存组:
                continue
            try:
                CONTENT.add_group(spec, g, out=_静)
                报告["分组"].append(g)
            except CONTENT.ContentError:
                pass

        # 2. 变量对象（缺了就建）
        for o in _列表(_取(稿, "对象", "objects")):
            if isinstance(o, str):
                o = {"名": o}
            if not isinstance(o, dict):
                continue
            名 = _字(o.get("名") or o.get("name")).strip()
            if not 名:
                continue
            try:
                CONTENT.add_object(spec, 名, 父=_字(o.get("父") or o.get("parent")),
                                   说明=_字(o.get("说明") or o.get("description")),
                                   更新规则=_字(o.get("更新规则")), out=_静)
                报告["对象"] += 1
            except CONTENT.ContentError:
                pass

        # 3. 变量（对象缺了就顺手建出来 —— 稿子不必先声明一遍）
        for v in _列表(_取(稿, "变量", "variables")):
            if not isinstance(v, dict):
                continue
            对象 = _字(v.get("对象") or v.get("object")).strip()
            名 = _字(v.get("名") or v.get("标题") or v.get("title")).strip()
            try:
                CONTENT.add_object(spec, 对象, out=_静)
                报告["对象"] += 1
            except CONTENT.ContentError:
                pass
            try:
                CONTENT.add_variable(spec, 对象, 名,
                                     类型=_字(v.get("类型") or v.get("type") or "string").strip().lower(),
                                     初值=v.get("初值", v.get("value", v.get("default"))),
                                     说明=_字(v.get("说明") or v.get("description")),
                                     更新规则=_字(v.get("更新规则")), out=_静)
            except CONTENT.ContentError as exc:
                # 最常撞的一头：稿子里的变量名跟骨架里现成的重了（比如给「玩家.等级」再写一遍）。
                # 一次落成**只加新变量**，不知道该怎么把旧值覆盖掉才对，
                # 所以这里当场停下并说清楚 —— 不能让它底下抛个 traceback 上来，
                # 更不能默默跳过（跳过了，用户以为初值写进去了，运行时是旧值，还不报错）。
                raise DraftError(
                    "变量「%s.%s」写不进去：%s\n"
                    "  一次落成只负责**新增**变量；跟骨架里现成的变量重名、或初值那一层的"
                    "形状对不上号，都会卡在这里。\n"
                    "  换个名字（推荐）——改骨架自带的变量请落成之后用 `python forge.py var` 那条路。"
                    % (对象, 名, exc))
            报告["变量"] += 1

        # 4. 条目：**同名即改、无名即建**（upsert）
        提到 = set()
        for 条 in _列表(_取(稿, "条目", "entries")):
            if not isinstance(条, dict):
                continue
            标题 = _字(条.get("标题") or 条.get("title")).strip()
            提到.add(标题)

            if 条.get("删"):
                try:
                    CONTENT.del_entry(spec, 标题, out=_静)
                    报告["条目删"] += 1
                except CONTENT.ContentError:
                    pass                      # 本来就没有 —— 稿子说「删除」是意图，不是断言
                continue

            模板 = _字(条.get("模板")).strip()
            余下 = OrderedDict()
            别名 = {"标题": "title", "正文": "content", "关键词": "keywords",
                    "提示": "agent_selection_hint", "位置": "position",
                    "图标": "icon_id", "启用": "enabled"}
            等等 = OrderedDict()
            for k, val in 条.items():
                if k in ("标题", "模板", "分组", "删", "title"):
                    continue
                名 = _字段名(k)
                if 名 is None:
                    continue
                等等[名] = val

            try:
                e = CONTENT.find_entry(spec, 标题)[1]
                有 = True
            except CONTENT.ContentError:
                e, 有 = None, False

            if not 有:
                # 新建：先把 add_entry 认的那几样一次给全（省一次落盘与一条回收记录）
                头 = OrderedDict(等等)
                正文 = 头.pop("content", "")
                关键词 = 头.pop("keywords", None)
                位置 = 头.pop("position", None)
                提示 = 头.pop("agent_selection_hint", None)
                CONTENT.add_entry(spec, 标题, 分组=_字(条.get("分组")).strip(),
                                  模板=模板 or "常驻", 正文=正文,
                                  关键词=_列表(关键词) if 关键词 is not None else None,
                                  位置=位置, 提示=提示, out=_静)
                报告["条目新"] += 1
                if 头:
                    CONTENT.set_entry(spec, 标题, 字段=dict(头), out=_静)
                余下 = 头
            else:
                字段 = OrderedDict()
                if 模板:
                    # 换档 = 那一组字段一起换。但 `模板表` 里还带着 `kind`（身份字段），
                    # 而 set_entry 明确不收身份 —— 照原样递过去会当场抛「这些字段不给改：kind」。
                    # 所以先拿**同一份** `可改字段` 过滤一遍（这份表就是「什么能改」的唯一真相）。
                    字段.update({k: v for k, v in CONTENT.模板表[模板].items()
                                 if k in CONTENT.可改字段})
                字段.update(等等)
                if 字段:
                    CONTENT.set_entry(spec, 标题, 字段=dict(字段), out=_静)
                报告["条目改"] += 1
                # 「分组」不在 set_entry 的字段表里（改分组是另一条路 `move_entries`）。
                # 早先这里**默默忽略**它：稿子明明写了「分组: 角色」，条目却纹丝不动，
                # 而且一个字都不报 —— 分组是设定库的骨架，错得看不见最要命。所以这里真的挪。
                分 = _字(条.get("分组")).strip()
                if 分:
                    e2 = CONTENT.find_entry(spec, 标题)[1]
                    if _组名(spec, e2.get("group_id")) != 分:
                        CONTENT.move_entries(spec, [e2.get("id")], 分, out=_静)
                        报告["挪组"].append("%s → %s" % (标题, 分))

        # 5. 清空：把「稿子里没提到」的设定条目删掉。
        #
        #    注意顺序 —— **先建后清**。反过来的话，稿子里「改写已有条目」那几条会先被
        #    清掉、再当成新条目建回来，报告上就成了「改 0 · 新建 4 · 删 4」，
        #    看着像丢了一条；万一半路失败，先清后建还会真的丢掉内容。
        #    清空**不碰开场白**那条 —— 它不是一个设定条目，是卡的门面。
        if _取(稿, "清空条目", "清空", "clear"):
            剩 = [e for e in CONTENT.entries_of(CONTENT.load(spec), must=True)
                  if str(e.get("kind") or "") != "opening"
                  and str(e.get("title") or "") not in 提到]
            if 剩:
                CONTENT.del_entries(spec, [e["id"] for e in 剩], out=_静)
                报告["条目删"] += len(剩)

        # 5. 正则
        for r in _列表(_取(稿, "正则", "regex")):
            if not isinstance(r, dict):
                continue
            CONTENT.add_regex(spec, _字(r.get("名") or r.get("name")).strip(),
                               _字(r.get("模式") or r.get("pattern")).strip(),
                               替换=_字(r.get("替换") or r.get("replacement")),
                               目标=_列表(r.get("目标") or r.get("targets")) or None,
                               out=_静)
            报告["正则"] += 1

        # 6. 开场白（走 opener —— 末尾那三个零宽标记归它管）
        开场白 = _取(稿, "开场白", "opening")
        if 开场白 is not None and _字(开场白).strip():
            r = OPENER.改正文(proj, _字(开场白), 写回=True, out=_静)
            报告["开场白"] = True
            if r.get("变了") and not r.get("写回"):
                raise DraftError(
                    "开场白改了，但**写回 spec** 那一步没成（这是界面层的问题，不是稿子的问题）：\n"
                    "  %s\n"
                    "  工程照常落出来，界面那边修好再补一次即可：\n"
                    "    python forge.py opener <工程> --写回"
                    % "；".join(str(x) for x in (r.get("问题") or ["组装没通过"])))

        # 7. 出成品
        成品 = os.path.join(proj, "成品", "%s.card.json" % 卡名)
        os.makedirs(os.path.dirname(成品), exist_ok=True)
        pack.build(spec, 成品)
        报告["成品"] = 成品

        # 8. 体检（在**临时工程**上；拷过去之后还会再验一次，专抓路径依赖）
        card, issues = _体检(spec, 成品)
        报告["错误"] = [i.line().strip() for i in issues if i.level == "ERROR"]
        报告["警告"] = [i.line().strip() for i in issues if i.level == "WARN"]
        if 报告["错误"]:
            raise DraftError(
                "这份稿子做出来的卡有 %d 个错误（**目标位置%s**）：\n%s\n"
                "  改稿子重来。想知道细节：看上面这一趟的临时工程，或者先把稿子落成工程再 `check`。"
                % (len(报告["错误"]), "一个字都没写" if not 试 else "本来就没动",
                   "\n".join("  · " + x for x in 报告["错误"][:12])))

        if not 试:
            报告["文件"] = _拷树(proj, 目标, out=out)
            # 拷过去之后再验一次：这一遍查的是**目标位置**那一份，
            # 顺带把「工程里写死了临时路径」这类问题照出来（只报，不拦）。
            目标成品 = os.path.join(目标, "成品", "%s.card.json" % 卡名)
            卡2, iss2 = _体检(_找规格(目标), 目标成品)
            报告["落点错误"] = [i.line().strip() for i in iss2 if i.level == "ERROR"]
            报告["成品"] = 目标成品

        s = validate.summarize(M.jload(成品))
        报告["统计"] = s
        return 报告
    finally:
        if 保留:
            out("  （--保留）临时工程留在 %s" % 临时)
        else:
            shutil.rmtree(临时, ignore_errors=True)


def 打报告(报告, out=print):
    """把 落卡() 的结果打成一张人（和 AI）都读得懂的表。

    **只有这一份输出**：底下那些 add_* / set_* / HUD / opener 的碎碎念全被静音了。
    「一次落成」的价值一半在于只跑一次、另一半在于只读到一句结论 ——
    底下打一屏「out/replacement_card.txt 34752 字符」之类，对读它的人（和 AI）纯是负担。
    """
    out("照卡稿落成一张卡")
    out("─" * 56)
    out("  %s%s" % (M.pad("工程", 10), 报告["工程"] + ("（--试：没写）" if 报告["试"] else "")))
    if 报告.get("覆盖"):
        out("  %s照稿子重落了一遍（原来那份被盖掉了）" % M.pad("覆盖", 10))
    out("  %s改 %d · 新建 %d · 删 %d"
        % (M.pad("条目", 10), 报告["条目改"], 报告["条目新"], 报告["条目删"]))
    if 报告["分组"]:
        out("  %s%s" % (M.pad("分组", 10), "、".join(报告["分组"])))
    if 报告.get("挪组"):
        out("  %s%s" % (M.pad("挪组", 10), "、".join(报告["挪组"])))
    if 报告["自动分组"]:
        out("  %s%s" % (M.pad("自动补组", 10),
                       "、".join(报告["自动分组"])
                       + "（稿子里没声明，是条目里用到的 —— 名字打错了就改）"))
    out("  %s对象新建 %d · 变量 %d · 正则 %d"
        % (M.pad("变量", 10), 报告["对象"], 报告["变量"], 报告["正则"]))
    if 报告["开场白"]:
        out("  %s换过（末尾那三个零宽标记已补齐）" % M.pad("开场白", 10))
    if 报告.get("统计"):
        s = 报告["统计"]
        out("  %s%s%s" % (M.pad("成品", 10), 报告["成品"],
                          "（--试：这是临时目录里那份，没拷出来）" if 报告["试"] else ""))
        out("  %s条目 %d · 分组 %d · 变量 %d · 正则 %d"
            % (M.pad("", 10), s["entries"], s["groups"], s["variables"], s["regex"]))
    if not 报告["试"]:
        out("  %s%d 个文件" % (M.pad("拷过去", 10), 报告["文件"]))
    for w in 报告.get("警告") or []:
        out("  " + w)               # Issue.line() 自带标记，缩进跟上面几行对齐即可
    for e in 报告.get("落点错误") or []:
        out("  " + e)               # 拷过去之后才冒出来的错（多半是路径依赖）—— 如实报
    if 报告.get("错误"):
        out("  体检   %d 错" % len(报告["错误"]))
    else:
        out("  体检   ok（0 错 %d 警告）" % len(报告.get("警告") or []))
