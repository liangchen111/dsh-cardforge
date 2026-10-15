/**
 * 造 validate 的差分语料 —— **一次性生成器**，产物已入库。
 * 改语料形状时跑一遍：`node 差分/语料/validate/造语料.mjs`
 * ============================================================
 *
 * 为什么要生成而不是手写：`问题卡` 里要有一条 3,200 字的正文（撞 `ENTRY_CHARS_LIMIT`
 * 与 `CONST_CHARS_LIMIT` 两条护栏），手抄容易抄歪；工程甲/乙/丙三份夹具也要保持
 * 一致的字面形状（`hud.conf.json` 的键、模块目录名、账本字段）。
 *
 * ★ 夹具必须是**确定的**：`validate_hud` 用 os.walk 扫目录，目录枚举顺序两边
 *   （Python scandir / Node readdir）理论上同源，但为了让诊断**顺序**不含运气成分，
 *   每一层**最多只有一个**子目录里放会被扫到的文件；另一层目录放的 .js 不触发任何
 *   规矩（内容为空注释）⇒ 顺序怎么排，结果都一样。
 */
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))

function 写(rel, text) {
  const p = join(这里, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text, 'utf8')
  console.log('写出', rel)
  return p
}
const 写j = (rel, obj) => 写(rel, JSON.stringify(obj, null, 2) + '\n')

// ------------------------------------------------------------------ 问题卡
const 长文 = '本'.repeat(3200)

const 条目 = [
  // 开场白三条：各撞一种坏法（默认指向不存在 / 一个方案都没有 / 正文与方案对不上）
  { id: 'e1', title: '开场白甲', kind: 'opening', content: '',
    opening_messages: [{ id: 'm1', content: '方案一' }], default_opening_message_id: 'mX' },
  { id: 'e2', title: '开场白乙', kind: 'opening', content: '', opening_messages: [] },
  { id: 'e3', title: '', kind: 'normal', content: '',
    trigger_mode: 'always', position: '', agent_read_strategy: 'keyword', keywords: [] },
  { id: 'e3', title: '重号条目', kind: 'normal', content: 'x', position: 'instructions' },
  { id: 'e4', title: '超长条目', kind: 'normal', content: 长文,
    trigger_mode: 'always', position: 'instructions' },
  { id: 'e5', title: '按需无提示', kind: 'normal', content: 'x',
    trigger_mode: 'agent_tool', agent_selection_hint: '' },
  { id: 'e6', title: '常驻还必读', kind: 'normal', content: 'y',
    trigger_mode: 'always', position: 'instructions', agent_read_strategy: 'required' },
  { id: 'e7', title: '分组不存在', kind: 'normal', content: 'z',
    group_id: 'gX', position: 'instructions' },
  { id: 'e8', title: '条件路径', kind: 'normal', content: 'w', position: 'instructions',
    agent_read_condition: 'stat_data.不存在.字段 与 普通词 与 stat_data.体力' },
  { id: 'e9', title: '同组撞车甲', kind: 'normal', content: 'a',
    group_id: 'g1', order: 3, position: 'instructions' },
  { id: 'e10', title: '同组撞车乙', kind: 'normal', content: 'b',
    group_id: 'g1', order: 3, position: 'instructions' },
  { id: 'e11', title: '值域越界', kind: 'normal', content: 'c',
    trigger_mode: '不知啥', agent_read_strategy: '乱写', insert_role: '??' },
  { id: 'e12', title: '无位置常驻', kind: 'normal', content: 'd',
    trigger_mode: 'always', position: '  ' },
  // 标题 28 个码点（含星平面字符）—— 逼 `title[:24]` 按码点切，而不是按 UTF-16 码元
  { id: 'e13', title: '😀开'.repeat(14), kind: 'normal', content: 'e',
    order: 1, position: 'instructions' },
  { id: 'e14', title: '排序无组二', kind: 'normal', content: 'f',
    order: 1, position: 'instructions' },
  { id: 'e15', title: '开场白丙', kind: 'opening', content: '正文甲',
    opening_messages: [{ id: 'm2', content: '方案乙' }] },
]

const 问题卡 = {
  format: 'tester.card',
  version: 1,
  character: { name: '' },
  setting_library: {
    format: 'eleckoi.setting-library-snapshot',
    version: 1,
    active_version_id: 'v1',
    versions: [{ id: 'v1', name: '主', entries: 条目, groups: [{ id: 'g1', name: '甲' }] }],
  },
  variable_config: {
    format: 'eleckoi.variable-config',
    version: 1,
    active_version_id: 'vv1',
    versions: [{
      id: 'vv1',
      name: '主',
      initial_state: { 体力: 10, 孤儿: 1 },
      schema_code: 'const S = z.object({ 体力: z.number() })',
      objects: [
        { id: 'o1', name: '体力' },
        { id: 'o2', name: '散兵', parent_id: 'oX' },
        { id: 'o3', name: '没有初值' },
      ],
      variables: [{ id: 'v1', title: '某变量', object_id: 'oY' }],
    }],
  },
  regex_rules: [
    { id: 'r1', name: '空模式', pattern: '', order: 1 },
    { id: 'r2', name: '没写完', pattern: '/abc', order: 2 },
    { id: 'r3', name: '重号', pattern: '〔面板〕', order: 2 },
    { id: 'r4', name: '正常', pattern: '/^.+$/isu', order: 3 },
  ],
}
写j('问题卡.card.json', 问题卡)

// 一条开场白都没有的卡（OPENING-NONE 是「卡本身不能开」那一档，单独一张更干净）
写j('无开场.card.json', {
  format: 'eleckoi.character-card',
  version: 1,
  character: { name: '无开场' },
  setting_library: {
    format: 'eleckoi.setting-library-snapshot',
    version: 1,
    active_version_id: 'v1',
    versions: [{
      id: 'v1',
      name: '主',
      entries: [{ id: 'n1', title: '普通条目', kind: 'normal', content: '正文', position: 'instructions' }],
      groups: [],
    }],
  },
  variable_config: { format: 'eleckoi.variable-config', version: 1, active_version_id: 'vv1', versions: [{ id: 'vv1', name: '主' }] },
  regex_rules: [],
})

// ------------------------------------------------------------------ 工程甲
// 界面层全查一遍 + **工程层里要读 source/*.spec.yaml 的那些分支**
// （YAML 子集读取器落地后，这一面才点得亮）
写('工程甲/source/甲.spec.yaml',
  'format: eleckoi.test-snapshot\n' +
  'version: 1\n' +
  'character:\n' +
  '  name: 甲（spec 名）\n' +
  'library:\n' +
  '  entries:\n' +
  '  - id: opening-1\n' +
  '    title: 开场白\n' +
  '    kind: opening\n' +
  "    content: '没有建卡器标记的正文'\n" +
  '  - id: e-y\n' +
  '    title: 新增的\n' +
  "    content: '没被改过的正文'\n" +
  '  - id: e-z\n' +
  '    title: 被改过的\n' +
  "    content: '改过了'\n" +
  'regex_rules:\n' +
  '  - id: r-y\n' +
  '    name: 别的正则\n' +
  '    pattern: /x/\n')
写('工程甲/source/别的.txt', '夹具：这个文件不该影响任何判断\n')
写j('工程甲/hud/hud.conf.json', {
  卡名: '甲',
  模块: ['缺的模块', '在的模块'],
  开场白: { 条目: 'opening-1', 正文: '@开场@' },
  正则: [
    // 名字不在 spec 的正则里 ⇒ PROJ-HUD-UNWRITTEN
    { name: '界面注入', view: 'view_create.html', pattern: '/\\u200B{3}/' },
    // 名字在 spec 里、但模式对不上 ⇒ PROJ-HUD-PATTERN
    { name: '别的正则', view: 'view_other.html', pattern: '/不一样/' },
  ],
})
写('工程甲/hud/hud.core.js',
  '/* 界面核心（夹具） */\n' +
  '// 反引号示范：```\n' +
  '// 注释开头示范：<!--\n' +
  '// 闭合示范：</script\n' +
  'var hudFixture = 1\n')
写('工程甲/hud/hud.css', '.hud-root { color: red }\nbody { margin: 0 }\n')
写('工程甲/hud/模块/在的模块/在的模块.js',
  '/* 模块（夹具）—— 这条只查模块：内联 position:fixed 会脱离消息流 */\n' +
  '.x { position:fixed; top: 0 }\n')
写('工程甲/hud/模块/在的模块/样式.css', '.hud-模块 { color: blue }\n')
写('工程甲/hud/模块/没登记的/没登记的.js', '/* 空模块：一条都不该报 */\n')
// 成品 的 mtime 钉到 2000-01-01 ⇒ 比 source/甲.spec.yaml 旧 ⇒ PROJ-STALE-CARD 必响
utimesSync(写('工程甲/成品/甲.card.json', '{}\n'), new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'))
// 预览.html 的 mtime 钉到 2000-01-01 ⇒ 永远比 hud/ 下的文件旧 ⇒ PROJ-STALE-PREVIEW 必响
// （不能用「先生成预览、后生成 hud」——同一次生成里 mtime 分不出先后）
utimesSync(写('工程甲/预览.html', '<!DOCTYPE html><title>甲</title>\n'), new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'))
写j('工程甲/模块账本.json', {
  模块: {
    在的模块: {
      条目: {
        替换: [{ id: 'e-x', title: '被替换的' }],
        新增: [
          // e-y 的指纹是**真值**（见 差分/_指纹.py 算出来的）⇒ 两边都得不出 DRIFT。
          // 这一条是在**验指纹算法本身**：JS 的 _fingerprint 要是与 Python 差一个字节，
          // 它就会多报一条 PROJ-LEDGER-DRIFT，差分当场红。
          { id: 'e-y', title: '新增的', 指纹: '4da31c9f1146' },
          // e-z 的指纹是**假的** ⇒ 两边都该报 PROJ-LEDGER-DRIFT
          { id: 'e-z', title: '被改过的', 指纹: 'ffffffffffff' },
        ],
      },
      正则: ['r-x'],
      界面: ['hud/模块/在的模块/没了.js'],
    },
  },
})

// ------------------------------------------------------------------ 工程乙
// 两份 spec ⇒ PROJ-MULTI-SPEC；顺带证明 _check_opener 遇到两份 spec 会主动收手
写('工程乙/source/甲.spec.yaml', '# 甲（夹具）\n')
写('工程乙/source/乙.spec.yaml', '# 乙（夹具）\n')
写j('工程乙/hud/hud.conf.json', {
  卡名: '乙',
  模块: [],
  开场白: { 条目: 'opening-1' },
  正则: [{ name: '界面注入', view: 'view_create.html', pattern: '/x/' }],
})
写j('工程乙/成品/乙.card.json', {})

// ------------------------------------------------------------------ 工程丙
// hud.conf.json 读不出来 ⇒ 只有 HUD-CONF 一条（两边解析器的报错原文不同，差分里做归一）
写('工程丙/hud/hud.conf.json', '{ 这不是 JSON\n')

// ------------------------------------------------------------------ 工程丁
// 有成品、有唯一一份 spec，但 spec 里没有 conf 记的那个开场白条目 ⇒ HUD-OPENER-GONE
写('工程丁/source/丁.spec.yaml',
  'format: eleckoi.test-snapshot\n' +
  'version: 1\n' +
  'library:\n' +
  '  entries: []\n')
写j('工程丁/hud/hud.conf.json', {
  卡名: '丁',
  模块: [],
  开场白: { 条目: 'opening-1' },
  正则: [],
})
utimesSync(写('工程丁/成品/丁.card.json', '{}\n'), new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'))
