"""forge 的独立测试 —— 只用标准库，全程临时目录，不碰仓库、不碰工作区。

跑法（在仓库根）：

    python -m unittest discover -s tests -v

为什么这几条非测不可：forge 交付出去的是**产物**（卡图 / 预设），
产物错了、客户端拒收，用户是在「导入失败」那一刻才知道的。
所以这里测的不是「函数返回了没」，而是三条硬口径：

1. **往返**：PNG 里那个块解出来，逐字节等于源卡；
2. **确定性**：同一个输入跑两遍，字节完全相同（`gzip(mtime=0)` / 写死时间戳）；
3. **白名单**：条目的枚举值全落在客户端 `AgentPresetImportCodec.ts` 认的集合里
   —— 客户端遇到表外的 `kind` 是**直接抛**的，不做兜底。
"""

import base64
import gzip
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from forge import model as M                      # noqa: E402
from forge import pack, png as PNG, preset as PRESET, plan as PLAN, lint as LINT  # noqa: E402

卡 = os.path.join(ROOT, "向导", "制卡助手", "成品", "制卡助手.card.json")
卡稿 = os.path.join(ROOT, "向导", "制卡助手", "source", "制卡助手.spec.yaml")


def 静(*_a, **_k):
    """吞掉打印：测试输出里只留结论。"""


class 基类(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="forgetest-")
        self.addCleanup(self.tmp.cleanup)

    def 路(self, *a):
        return os.path.join(self.tmp.name, *a)

    def 读(self, p):
        with open(p, "rb") as f:
            return f.read()


class 测模型(基类):

    def test_条目键序与官方一致(self):
        self.assertEqual(M.ENTRY_KEYS[:4], ["id", "title", "icon_id", "kind"])
        self.assertEqual(M.ENTRY_KEYS[-3:], ["tree_view_order", "created_at", "updated_at"])
        # 预设条目比卡条目多一个 content_mode
        self.assertIn("content_mode", PRESET.ENTRY_KEYS)
        self.assertEqual([k for k in PRESET.ENTRY_KEYS if k not in M.ENTRY_KEYS], ["content_mode"])
        self.assertEqual(len(set(PRESET.ENTRY_KEYS)), len(PRESET.ENTRY_KEYS), "条目键不该重复")

    def test_ordered_把多出来的键留在后面(self):
        got = list(M.ordered({"b": 1, "a": 2, "z": 9}, ["a", "b"]))
        self.assertEqual(got, ["a", "b", "z"])

    def test_存取往返(self):
        p = self.路("x.json")
        M.jdump({"名": "值", "数": 3}, p)
        self.assertEqual(dict(M.jload(p)), {"名": "值", "数": 3})


class 测卡图(基类):

    def test_出图_解得出源卡(self):
        out = self.路("卡.png")
        got = PNG.write(卡, out, quiet=True, out=静)
        self.assertTrue(os.path.isfile(out))
        text = PNG.read_text(self.读(out))
        self.assertIsInstance(text, dict)
        self.assertIn("eleckoi-card", text)
        # 客户端那条路：tEXt → base64 → gunzip
        解出 = gzip.decompress(base64.b64decode(text["eleckoi-card"]))
        self.assertEqual(解出, self.读(卡))
        self.assertEqual(got["native_bytes"], len(self.读(卡)))
        PNG.verify(out, out=静)

    def test_确定性(self):
        a = PNG.write(卡, self.路("a.png"), quiet=True, out=静)["sha256"]
        b = PNG.write(卡, self.路("b.png"), quiet=True, out=静)["sha256"]
        self.assertEqual(a, b, "同一份卡跑两遍字节必须相同")

    def test_不是PNG要给错(self):
        bad = self.路("假的.png")
        with open(bad, "wb") as f:
            f.write(b"not a png at all")
        self.assertRaises(Exception, PNG.verify, bad, None, 静)


class 测预设(基类):

    def 出(self, **kw):
        kw.setdefault("quiet", True)
        kw.setdefault("out", 静)
        return PRESET.build(卡, out_path=self.路("p.preset.json"), **kw)

    def test_信封与键序(self):
        self.出()
        doc = json.loads(self.读(self.路("p.preset.json")).decode("utf-8"))
        self.assertEqual(list(doc)[:3], ["format", "version", "preset"])
        self.assertEqual(doc["format"], "eleckoi.agent-preset")
        self.assertEqual(doc["version"], 2)
        pr = doc["preset"]
        self.assertEqual(pr["purpose"], "creator")
        # purpose 跟在 name 后面，与客户端自己的编码器同序
        self.assertEqual(list(pr)[:2], ["name", "purpose"])
        for 键 in ("entries", "groups", "regex_rules", "prompt_positions",
                   "tool_configuration", "versions"):
            self.assertIn(键, pr)
        self.assertEqual(pr["tool_configuration"]["included_group_ids"], ["builtin:creator"])

    def test_条目全落白名单(self):
        self.出()
        doc = json.loads(self.读(self.路("p.preset.json")).decode("utf-8"))
        ents = doc["preset"]["entries"]
        self.assertTrue(ents, "预设里一条设定都没有 —— 那是空预设")
        for e in ents:
            self.assertIn(e["kind"], PRESET.KINDS)
            self.assertIn(e["agent_read_strategy"], PRESET.READ_STRATEGIES)
            self.assertIn(e["dynamic_mode"], PRESET.DYNAMIC_MODES)
            self.assertIn(e["content_mode"], PRESET.CONTENT_MODES)
            self.assertIn(e["trigger_mode"], PRESET.TRIGGER_MODES)
            self.assertTrue(e["position"] is None or e["position"] in PRESET.POSITIONS)
            self.assertEqual(list(e), list(PRESET.ENTRY_KEYS), "条目键序必须与官方逐位一致")

    def test_搬运是减不是换_引擎条目留在卡里(self):
        self.出()
        doc = json.loads(self.读(self.路("p.preset.json")).decode("utf-8"))
        种类 = {e["kind"] for e in doc["preset"]["entries"]}
        self.assertFalse(种类 & set(PRESET.ENGINE_KINDS),
                         "扮演机件不该跟着预设走：%s" % 种类)
        self.出(drop_engine=False)
        doc2 = json.loads(self.读(self.路("p.preset.json")).decode("utf-8"))
        种类2 = {e["kind"] for e in doc2["preset"]["entries"]}
        self.assertEqual(种类2, 种类 | (种类2 & set(PRESET.ENGINE_KINDS)))

    def test_确定性(self):
        a = self.出()["doc"]
        b = self.出()["doc"]
        self.assertEqual(json.dumps(a, ensure_ascii=False, sort_keys=False),
                         json.dumps(b, ensure_ascii=False, sort_keys=False))

    def test_预设图_只base64不压缩(self):
        self.出()
        p = self.路("p.preset.json")
        got = PRESET.build_png(p, out_path=self.路("p.preset.png"), quiet=True, out=静)
        text = PNG.read_text(self.读(got["png"]))
        self.assertIn("eleckoi_agent_preset", text)
        # ★ 客户端解预设是 Buffer.from(v,'base64').toString('utf8') —— 没有 gunzip
        解出 = base64.b64decode(text["eleckoi_agent_preset"]).decode("utf-8")
        self.assertEqual(解出, self.读(p).decode("utf-8"))
        self.assertNotEqual(text["eleckoi_agent_preset"][:6], "H4sIAA",
                            "预设的块被 gzip 了 —— 客户端读不懂")

    def test_假的kind必须当场报错(self):
        self.出()
        p = self.路("p.preset.json")
        doc = json.loads(self.读(p).decode("utf-8"))
        doc["preset"]["entries"][0]["kind"] = "bogus"
        bad = self.路("坏.preset.json")
        with open(bad, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
        self.assertRaises(PRESET.PresetError, PRESET.verify, bad, 静)

    def test_用途不对必须当场报错(self):
        self.出()
        p = self.路("p.preset.json")
        doc = json.loads(self.读(p).decode("utf-8"))
        doc["preset"]["purpose"] = "roleplay"
        bad = self.路("角色扮演.preset.json")
        with open(bad, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
        self.assertRaises(PRESET.PresetError, PRESET.verify, bad, 静)


class 测规程(基类):
    """coach 是「向导卡」的真源，它必须**幂等**。

    2026-10-15 实测到的真缺陷：`coach` 每次重生成都发新 uuid 与新时间戳 ⇒
    连跑两次 `向导\\制卡助手\\source\\制卡助手.spec.yaml` 的 sha256 不同；
    用户导过上一版卡、再导新版，卡内 id 全变。修法是重生成前按「条目标题 /
    分组名」把上一版的 id 与 created_at 认回来 —— 这条测试就是给那个修法上的锁。
    """

    def _跑两遍(self):
        from forge import coach as COACH
        到 = self.路("向导")
        COACH.出(到, out=静)
        工程 = os.path.join(到, COACH.卡名)
        spec = os.path.join(工程, "source", "%s.spec.yaml" % COACH.卡名)
        a = self.读(spec)
        COACH.出(到, out=静)
        b = self.读(spec)
        return COACH, spec, a, b, 工程

    def test_重生成幂等(self):
        _c, spec, a, b, _工程 = self._跑两遍()
        self.assertEqual(a, b, "coach 连跑两次必须逐字节相同 —— 否则导过旧版的人 id 全变")

    def test_认回身份_标题到id不变(self):
        import yaml
        _COACH, spec, a, _b, _工程 = self._跑两遍()
        新库 = (M.yload(spec)["library"] or {})
        旧库 = (yaml.safe_load(a.decode("utf-8"))["library"] or {})
        新 = {e["title"]: e["id"] for e in 新库.get("entries") or []}
        旧 = {e["title"]: e["id"] for e in 旧库.get("entries") or []}
        self.assertTrue(新, "规程卡里一条条目都没有？")
        self.assertEqual(旧, 新, "同一条目的 id 必须认回上一版")

    def test_出的卡也能出图出预设(self):
        COACH, _spec, _a, _b, 工程 = self._跑两遍()
        卡 = os.path.join(工程, "成品", "%s.card.json" % COACH.卡名)
        self.assertTrue(os.path.isfile(卡), "coach 该顺手把成品卡也落下来")
        PNG.write(卡, self.路("c.png"), quiet=True, out=静)
        PRESET.build(卡, out_path=self.路("p.preset.json"), quiet=True, out=静)
        PRESET.verify(self.路("p.preset.json"), 静)


class 测打包(基类):

    def test_卡稿能落成能开的卡(self):
        out = self.路("卡.json")
        pack.build(卡稿, out)
        doc = json.loads(self.读(out).decode("utf-8"))
        self.assertEqual(list(doc)[:2], ["format", "version"])
        self.assertEqual(doc["format"], "eleckoi.character-card")
        self.assertEqual(doc["version"], 1)
        lib = doc["setting_library"]
        snap = json.loads(lib) if isinstance(lib, str) else lib
        ents = snap["versions"][0]["entries"]
        self.assertTrue(ents)
        for e in ents:
            self.assertIn(e["kind"], PRESET.KINDS)

    def test_卡稿往返_再出预设也过(self):
        out = self.路("卡.json")
        pack.build(卡稿, out)
        PRESET.build(out, out_path=self.路("p.preset.json"), quiet=True, out=静)
        PRESET.verify(self.路("p.preset.json"), 静)


class 测规划书(基类):
    """规划书这一环最容易假绿：空模板要是也能过，等于没有闸。"""

    def test_空模板必须被拦下(self):
        问题 = PLAN.查(PLAN.模板("测试卡"))
        self.assertEqual(len(问题), len(PLAN.格子))

    def test_填满的模板能放行(self):
        行 = ["# 规划书 · 测试卡", ""]
        for 标题, _, 必含 in PLAN.格子:
            行 += ["## %s" % 标题, "",
                   "- " + "、".join(必含 or []) + " —— 这一节填好了。", ""]
        self.assertEqual(PLAN.查("\n".join(行)), [])

    def test_填了却漏了关键格子也要拦(self):
        问题 = PLAN.查("# 规划书 · 测试卡\n\n## 三、世界\n\n- 这一个世界有山有水。\n")
        self.assertTrue(any("没有" in p for p in 问题))

    def test_反推真卡出得来而且过体检(self):
        文本 = PLAN.反推(卡)
        self.assertIn("制卡助手", 文本)
        self.assertEqual(PLAN.查(文本), [])


class 测体检(基类):
    """「去 AI 味」最容易做成假绿：词表一撒全是命中，或者什么都查不出来。

    这里盯的是两件事：判据真的抓得住（正例），以及**长文本不许拿一轮的硬阈值去量**。
    实测教训：艾瑟兰实卡 3,174,883 B 里有 4,706 处破折号 —— 那是长篇常态，
    拿「破折号 0 处」去判整卡，数字大到没有意义。
    """

    def test_短文本硬判据真的会拦(self):
        坏 = "交付纪律：\n- 一\n- 二\n不是模型笨，是消息没送到。\n"
        不过 = LINT.体检(坏, out=lambda *a: None, 单轮=True)
        self.assertTrue(不过)

    def test_干净短文本全过(self):
        好 = "他把碗搁下，问她吃过了没有。她摇头。屋里那盏灯芯短了，光只够照到半张桌子。"
        self.assertEqual(LINT.体检(好, out=lambda *a: None, 单轮=True), [])

    def test_长文本自动降级只报密度(self):
        长 = ("不是这样，是那样。" * 400)
        不过 = LINT.体检(长, out=lambda *a: None)
        self.assertEqual(不过, [])

    def test_字数决定单轮还是长文(self):
        自小 = LINT.体检("他把碗搁下。", out=lambda *a: None)
        self.assertEqual(自小, [])

    def test_对立句式的两种写法都认得(self):
        self.assertTrue(LINT.查对立句("不是他不想来，是来不了。"))
        self.assertTrue(LINT.查对立句("这不光是钱的问题，而是人的问题。"))
        self.assertEqual(LINT.查对立句("他不想来，因为来不了。"), [])

    def test_破折号与提示冒号认得出(self):
        self.assertEqual(len(LINT.查破折号("他——是的他——来了。")), 2)
        self.assertTrue(LINT.查提示冒号("交付纪律：\n\n- 一\n"))
        self.assertEqual(LINT.查提示冒号("他把碗搁下，问她吃过了没有。\n"), [])

    def test_读得懂卡_json与纯文本两条路(self):
        文本, 出处 = LINT.读(卡)                      # 读() 返回 (正文, 出处)
        self.assertEqual(出处, 卡)
        self.assertGreater(len(文本), 200)          # 卡里的条目正文都取出来了
        self.assertIn("四条铁律", 文本)             # 是内容，不是 JSON 壳
        self.assertNotIn("eleckoi.character-card", 文本)
        self.assertEqual(LINT.读(卡)[0], 文本)      # 读两次一样（没有随机）


class 测只读禁区(基类):
    """名单必须是**用户配置**的：工具本体不许认识任何人的私有路径。"""

    def 名单里(self):
        from forge import guard
        return guard.readonly_paths()

    def test_默认不认任何私有路径(self):
        # 本机 `只读名单.txt` 里可以有艾瑟兰，但**代码里**不许出现 —— 靠临时改 ROOT 验空默认
        from forge import guard
        旧 = guard.ROOT
        try:
            guard.ROOT = os.path.join(tempfile.gettempdir(), "_forge_没有名单的根")
            os.environ.pop(guard.ENV, None)
            self.assertEqual(guard.readonly_paths(), [])
        finally:
            guard.ROOT = 旧

    def test_环境变量认(self):
        from forge import guard
        旧 = os.environ.get(guard.ENV)
        try:
            os.environ[guard.ENV] = os.pathsep.join([r"C:\甲", r"D:\乙"])
            got = self.名单里()
            self.assertIn(r"C:\甲", got)
            self.assertIn(r"D:\乙", got)
        finally:
            if 旧 is None:
                os.environ.pop(guard.ENV, None)
            else:
                os.environ[guard.ENV] = 旧

    def test_名单文件认_并且能读到中文路径(self):
        from forge import guard
        旧 = guard.ROOT
        try:
            with tempfile.TemporaryDirectory() as tmp:
                guard.ROOT = tmp
                p = os.path.join(tmp, guard.LIST_FILE)
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write("# 注释行\n\nE:\\有的卡\\艾瑟兰\n")
                self.assertIn("E:\\有的卡\\艾瑟兰", self.名单里())
        finally:
            guard.ROOT = 旧

    def test_命中就拒绝_外面就放行(self):
        from forge import guard
        旧 = os.environ.get(guard.ENV)
        try:
            os.environ[guard.ENV] = os.path.join(tempfile.gettempdir(), "_forge禁区")
            禁 = os.path.join(tempfile.gettempdir(), "_forge禁区")
            self.assertIsNotNone(guard.readonly_reason(禁))
            self.assertIsNotNone(guard.readonly_reason(os.path.join(禁, "里面", "卡.json")))
            self.assertIsNone(guard.readonly_reason(os.path.join(tempfile.gettempdir(), "_forge别处")))
        finally:
            if 旧 is None:
                os.environ.pop(guard.ENV, None)
            else:
                os.environ[guard.ENV] = 旧

    def test_点只读标记也算(self):
        from forge import guard
        with tempfile.TemporaryDirectory() as tmp:
            子 = os.path.join(tmp, "子目录")
            os.makedirs(子)
            self.assertIsNone(guard.readonly_reason(子))
            open(os.path.join(tmp, guard.MARKER), "w").close()
            self.assertIsNotNone(guard.readonly_reason(子))
            self.assertIsNotNone(guard.readonly_reason(os.path.join(子, "卡.json")))


class 测出厂清单(基类):
    """贴仓库地址直装那条路，靠的是根上的 `package.json` + `cordis.patch.yml`。

    两处 `cordis.patch.yml`（根＝贴链接直装；`插件/制卡工坊/`＝本地拷装）的 config
    默认值必须**一模一样** —— 否则「装法不同、行为不同」，用户按着装法踩不同的坑。
    """

    def _读yml(self, *段):
        import yaml
        with open(os.path.join(ROOT, *段), encoding="utf-8") as f:
            return yaml.safe_load(f)

    def _根包(self):
        with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as f:
            return json.load(f)

    def _出厂模块(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("forge出厂", os.path.join(ROOT, "出厂.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m

    def test_根清单指向真实存在的文件(self):
        pkg = self._根包()
        补丁 = pkg["dsh"]["bundle"]["patch"]
        self.assertTrue(os.path.exists(os.path.join(ROOT, 补丁)), 补丁)
        self.assertTrue(os.path.exists(os.path.join(ROOT, pkg["main"])), pkg["main"])
        self.assertTrue(os.path.exists(os.path.join(ROOT, pkg["exports"]["."])), pkg["exports"]["."])

    def test_两处补丁的默认值一模一样(self):
        根 = self._读yml("cordis.patch.yml")[0]["insert"][0]
        内 = self._读yml("插件", "制卡工坊", "cordis.patch.yml")[0]["insert"][0]
        self.assertEqual(根["config"], 内["config"])
        self.assertEqual(根["id"], 内["id"])

    def test_补丁里的包名就是包自己的名字(self):
        根 = self._读yml("cordis.patch.yml")[0]["insert"][0]
        self.assertEqual(根["name"], self._根包()["name"])

    def test_出厂要把贴链接直装那两件带上(self):
        m = self._出厂模块()
        for 名 in ("package.json", "cordis.patch.yml"):
            self.assertIn(名, m.要装的文件, 名)
        for 名 in m.不装:
            self.assertNotIn(名, m.要装的文件, 名)

    def test_清单合DSH插件约定(self):
        """按官方最小包的形状核一遍（`文档/插件-DSH.md` 里逐条写了出处）。"""
        pkg = self._根包()
        self.assertEqual(pkg["dsh"].get("manifestVersion"), 1)
        self.assertEqual(pkg["type"], "module")
        self.assertIn("main", pkg)
        self.assertIn("cordis.patch.yml", pkg["files"])
        self.assertIn("./cordis.patch.yml", pkg["exports"].values())
        self.assertTrue(pkg.get("engines", {}).get("dsh"), "engines.dsh 是声明项，别删")

    def test_不许把DSH运行时钉死版本(self):
        """`@deepseek-ai/dsh-*` 的 peer 一旦写死版本号，装到别的 DSH 上会被当场拒（错误码
        incompatible-version）。本项目要能装进桌面版、ElecKoi、手机版 —— 所以一律写 `*`。"""
        dsh范围 = {
            名: 范围
            for 名, 范围 in self._根包().get("peerDependencies", {}).items()
            if 名 == "@deepseek-ai/dsh" or 名.startswith("@deepseek-ai/dsh-")
        }
        self.assertIn("@deepseek-ai/dsh-tools", dsh范围, "至少要声明我们唯一注入的那个服务")
        for 名, 范围 in dsh范围.items():
            self.assertEqual(范围, "*", "%s 被钉成 %s 了" % (名, 范围))

    def test_插件目录那份清单同一套约定(self):
        根 = self._根包()
        with open(os.path.join(ROOT, "插件", "制卡工坊", "package.json"), encoding="utf-8") as f:
            内 = json.load(f)
        self.assertEqual(内["dsh"].get("manifestVersion"), 1)
        self.assertIn("cordis.patch.yml", 内["files"])
        self.assertEqual(内["peerDependencies"], 根["peerDependencies"])
        self.assertEqual(内["engines"], 根["engines"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
