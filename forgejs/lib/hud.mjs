/**
 * forge.hud 的 JS 版 —— 卡内 HUD 的组装器（B 轨）。
 * ==================================================================
 *
 * 做三件事：
 *
 *   1. 把工程 hud/ 下的 CSS、JS、视图拼成「完整 HTML 文档」（ElecKoi 只把完整 HTML
 *      文档提升成富文本消息）；顺手把 conf「模块」里那几个模块的脚本与样式接在核心之后；
 *   2. 转成正则的替换串，按 hud/hud.conf.json 里写的规则写回 spec；
 *   3. 产出一份浏览器可直接打开的 预览.html。
 *
 * ------------------------------------------------------------------ 移植记号
 *
 * 移植纪律（同 model.mjs / opener.mjs 头上那几条）：**行为照抄，不顺手改**；能逐字节
 * 比的逐字节比。这个模块到处在拼人话诊断（`"%s"` / `"%d"` / `%-28s`）、按码点排序、
 * 银行家舍入、`str.lower()` 这类边角，所以下面照抄了 opener.mjs 那组「Python 语义小工具」——
 * 少了它们，报错原文与落盘内容会在边角上悄悄跑偏，而跑偏了差分也抓不住。
 *
 * ★ 本模块有**两处已知的申报差异**（计划 §二① 备案过的，不是 bug）：
 *
 *   1. `patch_spec()` 的落盘：Python 走 `M.ydump(spec, SPEC)`（写 YAML），
 *      JS 侧 `M.ydump` 是明确抛错的 ⇒ 这里走 `M.jdump(spec, SPEC)`（写 JSON）。
 *      JSON 是合法 YAML，PyYAML 读得回来；差分比的是**结构**，所以这一支能比。
 *   2. `M.yload(SPEC)` 读进来那一步照抄（`.spec.yaml` 仍读得懂）。
 *
 * ★ 另有一处**不是边界、是必须自己写**的：路径拼接用 `_join()` 照抄 `os.path.join`
 *   （只接分隔符、不规范化），**别用 `node:path` 的 `join`** —— 理由见 opener.mjs 上
 *   那段注释（路径里混着 `/` 时两边会拼出不同的字符串）。`python -c "import os"` 那套
 *   `basename` / `dirname` 也一样：Windows 上两个分隔符都认，`node:path` 的 `basename`
 *   只认平台那一个，`"a\\b/c".split` 出来的结果两边不一样，所以下面有自己的 `_基名` / `_目录名`。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as M from './model.mjs'

// 每次组装前由 configure() 设定
export let PROJECT = ''
export let HUD_DIR = ''
export let OUT = ''
export let SPEC = ''
export let PREVIEW = ''
export let CONF = {}
export let CARD_NAME = ''
export let STYLE_ID = ''
export let GLOBAL = ''
export let RULES = []
export let CHECK = {}
export let CSS_ALL = ''
export let JS_ALL = ''

export const SPEC_TAIL = '.spec.yaml'


/** HUD 这一层的硬错：缺文件、名字对不上、正则撞车。一律当场停，不含糊过去。 */
export class HudError extends Error {
  constructor(message) {
    super(message)
    this.name = 'HudError'
  }
}

// Python 的内建 `IndexError`：`assemble(write=True)` 在 conf 一条正则都没有
// （`views` 是空表）时，`bodies[views[0]]` 会当场抛 `list index out of range`。
// JS 的 `arr[0]` 只给 `undefined`、不抛 —— 照抄的话这里就分岔了，所以自己抛。
class IndexError extends Error {
  constructor(message) {
    super(message)
    this.name = 'IndexError'
  }
}

/** Python 的 `seq[i]` —— 支持负索引，越界抛 `IndexError: list index out of range`。 */
function _第(seq, i) {
  const n = seq.length
  const j = i < 0 ? n + i : i
  if (j < 0 || j >= n) throw new IndexError('list index out of range')
  return seq[j]
}


// ------------------------------------------------------------------ Python 语义小工具
// 这一组与 opener.mjs 头上那组同源，按本模块用到的再取一份。

/** Python `print`（默认 end="\\n"）。 */
function _print(s = '') {
  process.stdout.write(String(s) + '\n')
}

// 组装过程的输出走这里 —— build() 一进来就换掉它，静默调用方传 () => {} 即可。
// Python 里是个模块级变量 `_P = print`；JS 的 ESM 导出是活绑定，外面拿 `out` 属性
// 现取（`import * as HUD` 时是 `HUD.out()`），所以这里用一个可换的出口函数。
let _出口 = _print
export function setOut(fn) { _出口 = fn }
/** 当前出口（= Python 的 `_P`）。 */
export function out(...a) { return _出口(...a) }
// 模块内部一律走这个 —— 它每调一次都现取 `_出口`，所以 build() 一改就全场生效。
// ★ 名字照着 Python 的模块级变量 `_P`（`_P = print`）取；那边是个变量，这边是函数。
export function _P(...a) { return _出口(...a) }

/** `os.path.isfile`。 */
function _是文件(p) {
  try { return statSync(p).isFile() } catch { return false }
}

/** `os.path.isdir`。 */
function _是目录(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}

/**
 * `os.path.join` —— **只接分隔符，一个字都不规范化**。理由见 opener.mjs 的 `_join`。
 */
function _join(...段s) {
  let 串 = ''
  for (const 段 of 段s) {
    const b = String(段)
    if (b === '') continue                       // Python 3.12+ 忽略空段
    if (串 === '' || b.startsWith('/') || b.startsWith('\\')) 串 = b
    else if (串.endsWith('/') || 串.endsWith('\\')) 串 += b
    else 串 += '\\' + b
  }
  return 串
}

/**
 * `os.path.basename` —— **Windows 上 `/` 和 `\\` 都是分隔符**，别用 `node:path` 的
 * `basename`（它只认平台那一个）。
 */
function _基名(p) {
  let s = String(p)
  while (s.length > 1 && (s.endsWith('/') || s.endsWith('\\'))) s = s.slice(0, -1)
  let i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i >= 0) s = s.slice(i + 1)
  // Windows 的盘符根（`E:` / `E:\\`）：basename 给空串
  if (/^[A-Za-z]:$/.test(s)) return ''
  return s
}

/** `os.path.dirname` —— 同 `_基名`，两个分隔符都认。 */
function _目录名(p) {
  const s = String(p)
  let i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i < 0) return ''
  let d = s.slice(0, i)
  if (/^[A-Za-z]:$/.test(d)) d += '\\'
  return d
}

/**
 * Python 的 `sorted(list)`：按**码点**逐位比。
 *
 * ★ 不能拿 JS 的 `Array.prototype.sort()` 默认（按 UTF-16 码元比）顶 —— 差在
 *   BMP 外的字符（跟本模块最相关的就是标签里的 emoji）上，`>` vs `\\uFFFD` 会给出
 *   两种顺序，而 `readdirSync(...).sort(...)` 决定文件清单的次序，次序一变差分就红。
 */
function _比码点(a, b) {
  const A = Array.from(String(a)), B = Array.from(String(b))
  const n = Math.min(A.length, B.length)
  for (let i = 0; i < n; i += 1) {
    const x = A[i].codePointAt(0), y = B[i].codePointAt(0)
    if (x !== y) return x < y ? -1 : 1
  }
  return A.length - B.length
}

/**
 * `sorted(..., key=lambda x: x["order"])` 里的那个比较：`order` 是**整数**，按数值排。
 * ★ 别拿 `_比码点` 顶上 —— 它先 `String()`，`5` 与 `30` 会按 "5" > "30" 排反。
 */
function _数比(a, b) {
  return Number(a.order) - Number(b.order)
}

/** Python 的 `str.lower()` —— **不是** JS 的 `toLowerCase()`（个案：`İ`）。 */
const _小写 = (s) => String(s).replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))

/** Python 的 `round()`：银行家舍入（.5 进到偶数）。同 model.mjs 里那份。 */
function _银行家(x) {
  const 下 = Math.floor(x)
  const 余 = x - 下
  if (余 > 0.5) return 下 + 1
  if (余 < 0.5) return 下
  return 下 % 2 === 0 ? 下 : 下 + 1
}

/** `os.listdir` —— 只给名字，不排序（要排的地方自己排）。 */
function _列目录(d) {
  return readdirSync(d)
}


// ------------------------------------------------------------------ 定位

export function project_of(spec_or_project) {
  /** 给 spec 或工程根，都折出工程根。 */
  let p = resolve(String(spec_or_project))
  if (_是文件(p)) {
    p = _目录名(p)
    if (_基名(p) === 'source') p = _目录名(p)
  }
  return p
}


export function find_spec(project) {
  /** 一份工程只该有一份 spec —— 多份就停，别猜。 */
  const src = _join(project, 'source')
  if (!_是目录(src)) return null
  const got = _列目录(src)
    .filter((f) => f.endsWith(SPEC_TAIL))
    .map((f) => _join(src, f))
    .sort(_比码点)
  if (got.length > 1) {
    throw new HudError(
      `source/ 下有 ${got.length} 份 spec：${got.map((p) => _基名(p)).join('、')}\n`
      + '  一张卡只该有一份；多张卡请各自独立成一个目录。')
  }
  return got.length ? got[0] : null
}


export function configure(spec_or_project, theme_override = null) {
  /** 定位一个工程的全部路径与配置。缺 hud/hud.conf.json 就当场抛 HudError。
   *
   * theme_override：临时换一套皮肤 CSS（「皮肤巡览」用）。传 null = 按工程里那份走。
   */
  PROJECT = project_of(spec_or_project)
  HUD_DIR = _join(PROJECT, 'hud')
  const conf_path = _join(HUD_DIR, 'hud.conf.json')
  if (!_是文件(conf_path)) {
    throw new HudError(
      `这个工程里没有 hud/hud.conf.json：${PROJECT}\n`
      + '  没有它就没有界面这一层。`forge new` 建的工程自带一份。')
  }
  CONF = M.jload(conf_path)

  SPEC = find_spec(PROJECT)
  OUT = _join(HUD_DIR, 'out')
  PREVIEW = _join(PROJECT, '预览.html')
  CARD_NAME = _str(CONF['卡名'] ?? '')
  STYLE_ID = _str(CONF['style_id'] ?? '')
  GLOBAL = _str(CONF['global'] ?? '')
  RULES = CONF['正则'] ?? []
  CHECK = CONF['校验'] ?? {}

  const [js, css] = module_files()
  // 顺序：核心 -> 主题 -> 模块。主题压核心（换色），模块压主题
  // （某个模块自带的强调色，比如骰子按结果分色，该赢）。
  CSS_ALL = read('hud.css') + theme_css(theme_override)
    + css.map((p) => '\n' + read_at(p)).join('')
  JS_ALL = read('hud.core.js') + js.map((p) => '\n' + read_at(p)).join('')
  return PROJECT
}


export const THEME_FILE = '主题.css'


export function theme_css(override = null) {
  /** 皮肤那一段 CSS。
   *
   * override 不为 None 就用它（巡览时临时换皮，不碰磁盘上的文件）；
   * 否则读工程里的 hud/主题.css；没有 = 用核心默认那套。
   */
  if (override !== null && override !== undefined) return '\n' + override
  const p = _join(HUD_DIR, THEME_FILE)
  if (!_是文件(p)) return ''
  return '\n' + read_at(p)
}


// ------------------------------------------------------------------ 读取素材

export function read(name) {
  return readFileSync(_join(HUD_DIR, name), 'utf8')
}

export function read_at(path) {
  return readFileSync(path, 'utf8')
}


// ------------------------------------------------------------ 可选模块给的料

// conf 的「模块」里写着哪几个模块，就把 hud/模块/<名>/<名>.js（和 .css）拼在核心之后。
// 名字对不上目录是**硬错，直接停** —— 那种状态比不接更坏：卡看着是接了的，
// 界面上却安静地少一块，谁也不会发现。
export function module_files() {
  const js = [], css = []
  const mod_dir = _join(HUD_DIR, '模块')
  const names = (CONF['模块'] ?? []).map((x) => _str(x))
  for (const name of names) {
    const folder = _join(mod_dir, name)
    if (!_是目录(folder)) {
      throw new HudError(
        `hud.conf.json 的「模块」里写着「${name}」，但 ${folder} 不存在。`
        + `（接模块用 \`forge add ${name} <你的 spec>\`）`)
    }
    for (const [tail, bucket] of [['.js', js], ['.css', css]]) {
      const p = _join(folder, name + tail)
      if (existsSync(p)) bucket.push(p)
    }
  }
  // 反过来：目录在这儿、名字不在 conf 里 —— 它**不会被拼进去**。
  // 这是那种「看着接了、其实没接」的状态，所以当场说一句，别让它安静地过去。
  if (_是目录(mod_dir)) {
    const stray = _列目录(mod_dir)
      .filter((d) => _是目录(_join(mod_dir, d)) && !names.includes(d))
      .sort(_比码点)
    if (stray.length) {
      _P(`  提示：${_rel(mod_dir, PROJECT).replace(/\\/g, '/')} 下有目录没写进 conf 的「模块」：`
        + stray.join('、'))
      _P('        没登记就不会被拼进页面 —— 要接就把它写进 conf（或 `forge add`）。')
    }
  }
  return [js, css]
}


/**
 * `os.path.relpath(path, start)` —— 只在**同一个盘**上才跟 Node 的 `path.relative`
 * 一样；跨盘时 Python 抛 `ValueError: path is on mount 'C:', start on mount 'E:'`、
 * Node 根本不抛、会算出一串 `../../`。hud 的语料把工作目录建在工具根底下
 * （同盘），所以这里照 Node 的算；跨盘那条差异与 scaffold 那边同源，由调用方去拦。
 */
function _rel(p, start) { return relative(start, p) }


export function document(body_html, pre_script = '') {
  /** 把片段包成 ElecKoi 富消息要求的完整 HTML 文档。 */
  const css = CSS_ALL
  const js = JS_ALL
  let head = ''
  if (_strip(pre_script)) {
    head = '<script>\n' + _strip(pre_script) + '\n</script>\n'
  }
  return '<!DOCTYPE html>\n'
    + '<html lang="zh-CN">\n'
    + '<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + `<style id="${STYLE_ID}">\n${css}\n</style>\n`
    + `${head}`
    + '</head>\n'
    + '<body>\n'
    + `${_strip(body_html)}\n`
    + `<script>\n${js}\n</script>\n`
    + '</body>\n'
    + '</html>'
}


export function to_replacement(doc) {
  /** 包成 ```html 围栏，并把 $ 转义成 $$（正则替换里 $ 有特殊含义）。 */
  return '```html\n' + String(doc).replace(/\$/g, '$$$$') + '\n```'
}


export function validate(doc, content, label) {
  /** content 是我们自己写的内容（CSS+JS+视图），外壳包装不参与检查。 */
  const problems = []
  if (String(content).includes('```')) {
    problems.push(`${label}：内容里出现了三反引号，会破坏代码围栏`)
  }
  if (/<\/script/i.test(String(content))) {
    problems.push(`${label}：内容里出现 </script 字面量，会提前闭合脚本`)
  }
  if (String(content).includes('<!--')) {
    problems.push(`${label}：内容里出现 HTML 注释开头，可能干扰富消息标记识别`)
  }
  for (const token of [`id="${STYLE_ID}"`, GLOBAL]) {
    if (!String(doc).includes(token)) {
      problems.push(`${label}：缺少必需标记 ${token}`)
    }
  }
  for (const token of (CHECK['must_contain'] ?? [])) {
    if (!String(doc).includes(token)) {
      problems.push(`${label}：内容里找不到 ${token}`)
    }
  }
  const limit = CHECK['page_max']
  if (limit && String(doc).length > limit) {
    problems.push(`${label}：整页 ${String(doc).length} 字符，超过上限 ${limit} —— 富消息单条太大会被宿主丢掉`)
  }
  return problems
}


// ------------------------------------------------------------------ 预览桩

export const MOCK = `
/* 本地预览用的 ElecKoi 桩；真实环境里不存在，会被真 API 顶掉 */
(function () {
  var HAS_PLAYER = @@has_player@@;

  var player = HAS_PLAYER ? {
    '姓名': '示例角色',
    '性别': '女',
    '种族': '人类',
    '等级': 3,
    '状态': '正常',
    '钱币': 42,
    '背包': ['短剑', '干粮 ×3', '火绒盒']
  } : {
    '姓名': '', '性别': '', '种族': '', '等级': 1, '状态': '正常', '钱币': 0, '背包': []
  };

  var store = { stat_data: {
    '世界设定': { '压力源': false, '叙事尺度': '标准' },
    '玩家': player
  } };

  function reply(v) { return Promise.resolve(v); }

  window.ElecKoi = {
    context: { current: function () {
      return reply({ surface: 'message-renderer', messageId: 'm-1', conversationId: 'c-1' });
    } },
    messages: {
      current: function () { return reply({ id: 'm-1' }); },
      list: function () { return reply([]); }
    },
    variables: {
      getState: function () { return reply(JSON.parse(JSON.stringify(store))); },
      setState: function (state) {
        if (state && typeof state === 'object') store = state;
        window.__mockState = store;
        return reply(store);
      }
    },
    input: { set: function (text) {
      window.__mockOutgoing = text;
      return reply({ text: text });
    } },
    chat: { send: function (text) {
      window.__mockOutgoing = text;
      return reply({});
    } }
  };
})();
`

export const PREVIEW_SHELL = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@@card@@ HUD · 预览</title>
<style>
body{margin:0;background:@@p_bg@@;color:@@p_ink@@;font:14px/1.7 @@font@@}
.wrap{max-width:760px;margin:0 auto;padding:26px 18px 120px}
h1{font-size:19px;letter-spacing:.2em;color:@@p_accent@@;font-weight:700;margin:0 0 8px}
p.lead{margin:0 0 24px;color:@@p_dim@@;font-size:12.5px;line-height:1.85}
p.lead b{color:@@p_accent@@;font-weight:700}
.demo{margin:0 0 22px}
.demo__t{font-size:12px;letter-spacing:.18em;color:@@p_dim@@;font-weight:400;margin:0 0 8px}
.demo__f{width:100%;height:280px;border:1px solid @@p_line@@;border-radius:10px;background:@@p_frame@@;display:block}
.demo__badge{margin:6px 0 0;padding:6px 10px;border-left:2px solid @@p_accent@@;background:@@p_wash@@;
  color:@@p_accent@@;font-size:11.5px;line-height:1.6;word-break:break-all;border-radius:0 6px 6px 0}
</style>
<style id="@@style_id@@">@@css@@</style>
</head>
<body>
<div class="wrap">
  <h1>@@card@@ HUD · 预览</h1>
  <p class="lead">一份代码，两个视图，一颗球。<b>建卡器</b>只在开场出现一次；<b>面板</b>每轮出现在回复末尾；球常驻页面右下角，可拖拽、点击展开。<br>预览里的角色数据是假数据，右下角那颗球是真的在跑宿主挂载逻辑，可以直接拖着玩。</p>
  @@demos@@
</div>
<script>@@mock@@</script>
<script>@@js@@</script>
<script>
(function () {
  var frames = [].slice.call(document.querySelectorAll('.demo__f'));
  frames.forEach(function (f) {
    var badge = document.createElement('p');
    badge.className = 'demo__badge';
    badge.hidden = true;
    f.parentNode.appendChild(badge);
    f.__badge = badge;
  });

  /* 持续轮询：既跟随内容自动调高，也接住桩里记录的「已交出」文本 */
  function tick() {
    frames.forEach(function (f) {
      var w, d;
      try { w = f.contentWindow; d = f.contentDocument; } catch (e) { return; }
      if (!w || !d) return;
      try {
        var h = Math.ceil((d.documentElement && d.documentElement.scrollHeight)
                       || (d.body && d.body.scrollHeight) || 0);
        if (h > 40) f.style.height = (h + 22) + 'px';
      } catch (e) { /* 跨源就保持默认高度 */ }
      try {
        if (w.__mockOutgoing) {
          f.__badge.hidden = false;
          f.__badge.textContent = '已交给 ElecKoi → ' + String(w.__mockOutgoing).replace(/\\s+/g, ' ').slice(0, 160);
        }
      } catch (e) { /* 忽略 */ }
    });
  }
  tick();
  setInterval(tick, 400);

  /* 真·悬浮球：把宿主文档当作挂载目标，演示常驻悬浮路径 */
  @@global@@.mountBall(null, document);
})();
</script>
</body>
</html>
`


export function fill(template, values) {
  /** 占位符替换。Python 的 str.replace 不解释 $，所以插入内容是安全的。 */
  let out = String(template)
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`@@${key}@@`).join(_str(value))
  }
  return out
}


// ------------------------------------------------------- 预览页外壳的配色

// 预览页的外壳配色单独一份 —— 它不是卡的一部分，是给人看卡的台子。
// 主题可以在自己那份 JSON 的「预览」里指定「底 / 字 / 强调」；只给这三个就够，
// 剩下的（次级字、框底色、线、淡底）从这里按它们现推，免得主题作者要填十来项。
export const _PREVIEW_FALLBACK = { 底: '#12100c', 字: '#bdb2a0', 强调: '#c8a23c' }
export const _PREVIEW_FONT = '-apple-system,"PingFang SC",system-ui,sans-serif'


export function _hex_to_rgb(value) {
  let v = _strip(_str(value ?? '')).replace(/^#+/, '')
  if (Array.from(v).length === 3) {
    v = Array.from(v).map((c) => c + c).join('')
  }
  if (Array.from(v).length !== 6) return null
  const out = []
  for (const i of [0, 2, 4]) {
    const h = v.slice(i, i + 2)
    if (!/^[0-9a-fA-F]{2}$/.test(h)) return null
    out.push(parseInt(h, 16))
  }
  return out
}


export function _rgba(color, alpha) {
  /** 把 #rrggbb 变成 rgba(...)；不是十六进制就原样退回（如 rgba() 字符串）。 */
  const rgb = _hex_to_rgb(color)
  if (!rgb) return color
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${_str(alpha)})`
}


export function _shift(color, amount) {
  /** 整体提亮（amount>0）或压暗（amount<0），0.35 大约是「明显但不刺眼」。 */
  const rgb = _hex_to_rgb(color)
  if (!rgb) return color
  const f = 1.0 + amount
  const s = rgb.map((c) => {
    const v = Math.max(0, Math.min(255, _银行家(c * f)))
    return v.toString(16).padStart(2, '0')
  }).join('')
  return '#' + s
}


export function _frame_color(bg) {
  /** 演示框（iframe）的底 —— 比台面略暗一点，好让卡有边界。
   *
   * 深浅两路：浅色主题只压暗一点点（压多了会变成一块脏灰），
   * 深色主题可以压得狠（本来就在暗处，再暗也是暗）。
   */
  const rgb = _hex_to_rgb(bg)
  if (!rgb) return bg
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255.0
  return _shift(bg, lum > 0.55 ? -0.06 : -0.45)
}


export function preview_palette() {
  /** 组装预览页外壳要用的色。 */
  const given = {}
  for (const [k, v] of Object.entries(CONF['预览'] ?? {})) {
    if (v) given[k] = v
  }
  const got = { ..._PREVIEW_FALLBACK, ...given }
  const bg = got['底'], ink = got['字'], accent = got['强调']
  return {
    p_bg: bg,
    p_ink: ink,
    p_dim: given['暗'] || _rgba(ink, 0.72),
    p_accent: accent,
    p_line: given['线'] || _rgba(accent, 0.32),
    p_frame: given['框'] || _frame_color(bg),
    p_wash: _rgba(accent, 0.08),
    font: _PREVIEW_FONT,
  }
}


export function srcdoc_escape(doc) {
  /** 把一份完整 HTML 文档塞进 iframe 的 srcdoc 属性。
   *
   * 三个字符要换：`&`（实体本身的规矩）、`"`（不然属性值提前闭合）、
   * `<`（尖括号）。裸尖括号在浏览器里其实也能过 —— 属性值状态里 `<`
   * 是普通字符 —— 但那样这份 HTML 就经不起任何一次「读出再写回」
   * （格式化、压缩、序列化），中间过一手就当场坏掉，而且坏得没有提示。
   * `>` 不必换（同上，它在属性值里没有歧义），换了只是白白变大。
   */
  return _str(doc).split('&').join('&amp;')
    .split('"').join('&quot;')
    .split('<').join('&lt;')
}


export function demo_block(title, body, has_player = true) {
  const mock = fill(MOCK, { has_player: has_player ? 'true' : 'false' })
  const full = document(body, mock)
  return '<section class="demo"><h3 class="demo__t">' + title + '</h3>'
    + `<iframe class="demo__f" title="${title}" srcdoc="${srcdoc_escape(full)}"></iframe></section>`
}


// ------------------------------------------------------------------ 装配

export function assemble(write = true) {
  /** 拼页面。write=false 时只算不落盘（「皮肤巡览」要一次算好几套）。 */
  const views = []
  for (const r of RULES) {
    if (!views.includes(r.view)) views.push(r.view)
  }

  const bodies = {}
  for (const v of views) bodies[v] = read(v)
  const docs = {}
  for (const v of views) docs[v] = document(bodies[v])

  const css = CSS_ALL, js = JS_ALL
  let problems = []
  for (const v of views) {
    problems = problems.concat(validate(docs[v], css + js + bodies[v], v))
  }

  const files = {}
  for (const v of views) {
    files[v] = docs[v]
    files[`replacement_${v.split('view_').join('').split('.html').join('')}.txt`] = to_replacement(docs[v])
  }

  let page = ''
  if (write) {
    mkdirSync(OUT, { recursive: true })
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(_join(OUT, name), text, { encoding: 'utf8' })
    }

    // ★ Python 的默认值是 `bodies[views[0]]`（正文），不是 `views[0]`（文件名）。
    const demos = [
      demo_block('① 建卡器 · 还没填', _取键(bodies, 'view_create.html', bodies[_第(views, 0)]), false),
      demo_block('② 建卡器 · 已有一份档案', _取键(bodies, 'view_create.html', bodies[_第(views, 0)])),
      demo_block('③ 面板 · 有档案', _取键(bodies, 'view_card.html', bodies[_第(views, -1)])),
      demo_block('④ 面板 · 还没档案', _取键(bodies, 'view_card.html', bodies[_第(views, -1)]), false),
    ].join('\n  ')
    page = fill(PREVIEW_SHELL, {
      card: CARD_NAME,
      style_id: STYLE_ID,
      global: GLOBAL,
      css: css,
      js: js,
      mock: fill(MOCK, { has_player: 'true' }),
      demos: demos,
      ...preview_palette(),
    })
    writeFileSync(PREVIEW, page, { encoding: 'utf8' })
  }

  _P(`组装完成（卡名：${CARD_NAME} · 模块：`
    + `${(CONF['模块'] ?? []).map((x) => _str(x)).join('、') || '没接'}）：`)
  for (const name of Object.keys(files).sort(_比码点)) {
    _P(`  out/${name.padEnd(28, ' ')} ${String(Array.from(files[name]).length).padStart(8, ' ')} 字符`)
  }
  if (write) {
    _P(`  预览页                        ${String(Array.from(page).length).padStart(8, ' ')} 字符  -> ${PREVIEW}`)
  }

  if (problems.length) {
    _P('\n校验发现问题：')
    for (const p of problems) {
      _P('  x ' + p)
    }
  } else {
    _P('\n校验通过：无三反引号 / 无 </script 字面量 / 无 HTML 注释 / 关键标记齐备。')
  }
  return [problems, docs]
}


/** Python 的 `d.get(k, d2)` —— 键在、值是 null 时给 null，不是给默认。 */
function _取键(o, k, d) {
  return (o && typeof o === 'object' && k in o) ? o[k] : d
}


// ------------------------------------------------------------------ 写回 spec

export function rule(rid, name, pattern, replacement, order) {
  return {
    id: rid,
    name: name,
    pattern: pattern,
    replacement: replacement,
    targets: ['AiOutput'],
    enabled: true,
    display_only: true,
    prompt_only: false,
    run_on_edit: true,
    order: order,
  }
}


export function re_slash(text) {
  /** 纯字面量 / 已经是 /.../flags 的，都照原样用；其余包成 /.../g。 */
  const t = _strip(text ?? '')
  if (t.startsWith('/') && /^\/.*\/[gimsuy]*$/s.test(t)) return t
  if (/[\\^$.*+?()[\]{}|]/.test(t)) return `/${t}/g`
  return t
}


export function parse_pattern(text) {
  /** 照 ElecKoi 的 parseRegexPattern 拆：/body/flags 拆开，其余整体当 body。 */
  const t = _strip(text ?? '')
  if (Array.from(t).length >= 3 && t.startsWith('/')) {
    const closing = t.lastIndexOf('/')
    if (closing > 0) {
      const flags = { i: 'i', m: 'm', s: 's' }
      let f = ''
      for (const ch of t.slice(closing + 1)) f += _小写(flags[ch] ?? '')
      return new RegExp(t.slice(1, closing), f)
    }
  }
  return new RegExp(t)
}


export function patch_spec() {
  if (!SPEC) {
    throw new HudError(`source/ 下没有 *${SPEC_TAIL} —— 没有 spec 就没有地方写回。`)
  }
  const spec = M.yload(SPEC)

  // --- 1. 开场白：正文里那个标记不能少，否则开场那一条渲染不出建卡器 ---
  const opening = CONF['开场白'] ?? {}
  if (_真值(opening)) {
    let marker = ''
    for (const r of RULES) {
      if (r.view === 'view_create.html') marker = r.pattern
    }
    let touched = 0
    for (const entry of spec['library']['entries']) {
      if ((entry['id'] ?? null) !== (opening['条目'] ?? null)) continue
      const body = opening['正文'] ?? ''
      // 建卡器标记是三个零宽空格（U+200B），conf 里正文写的是真字符、pattern 写的是
      // /\u200B{3}/ 这种转义写法 —— 两者长得不一样，所以这里按「正则真能命中正文」
      // 来查，而不是比字符串。顺带守住「正文里不许有尖括号」：那意味着标记又变回
      // 可见的了，会从 ElecKoi 的会话预览（侧栏 / 历史检索）里露出来。
      if (marker && !parse_pattern(marker).test(body)) {
        throw new HudError(`hud.conf.json 的开场白正文里没有建卡器标记「${marker}」，停`)
      }
      if (String(body).includes('<') || String(body).includes('>')) {
        throw new HudError('hud.conf.json 的开场白正文里有尖括号，会话预览会露出来，停')
      }
      // 写回前先记下各方案原本写着什么 —— 一会儿全要被 conf 那份盖掉。
      // 若本来就有多种正文（酒馆卡常带默认 + 备选几套），那是**有损**的，
      // 得说一句：骨架的建卡器只有一格正文，多出来的那几套从此没了。
      const 旧正文 = new Set((entry['opening_messages'] ?? []).map((m) => _str(m['content'] ?? '')))
      const 旧 = [...旧正文].filter((x) => _真值(_strip(x)))
      entry['content'] = body
      for (const msg of (entry['opening_messages'] ?? [])) {
        msg['content'] = body
        touched += 1
      }
      if (旧.length > 1) {
        _P(`  提示：开场白原本有 ${旧.length} 套不同正文，已统一成 conf 里那一份 ——`
          + ' 建卡器只有一格正文。')
        _P('      想保住多套开场：别接界面层（用 `forge.py import` 收成内容档）。')
      }
    }
    if (!touched) {
      _P(`  提示：spec 里没有开场白条目（${opening['条目'] ?? ''}），开场那一步由宿主自己填。`)
    }
  }

  // --- 2. 正则：conf 里那几条按 order 接，**外来的一条都不许动** ---
  //     spec 里的正则有两个来源：这份 conf，以及「不是 conf 给的」—— 模块接的、
  //     作者手写的。以前这里是光秃秃一句 spec["regex_rules"] = rules，每跑一次
  //     构建就把后一类全抹掉；那种错不报错，只是某种界面从此不再出现，
  //     而人往往要等到下一局才发现。所以改成「两拨按 order 合起来」，并当场查撞车。
  const conf_names = new Set(RULES.map((r) => r.name))
  const orders = RULES.map((r) => r.order)
  if (new Set(orders).size !== orders.length) {
    throw new HudError(`hud.conf.json 里有重复的 order：${_pyList(orders)}（顺序不明，停）`)
  }

  const before = spec['regex_rules'] ?? []
  const existing = {}
  for (const r of before) existing[_str(r['name'] ?? '')] = r
  const foreign = before.filter((r) => !conf_names.has(_str(r['name'] ?? '')))

  const made = []
  for (const r of [...RULES].sort(_数比)) {
    const rid = (existing[r.name] ?? {})['id'] || ('regex-' + randomUUID())
    const repl = read_at(_join(OUT, `replacement_${r.view.split('view_').join('').split('.html').join('')}.txt`))
    made.push(rule(rid, r.name, re_slash(r.pattern), repl, r.order))
  }

  const merged = [...foreign, ...made].sort(_数比)
  const slots = {}
  for (const r of merged) {
    if (!(r.order in slots)) slots[r.order] = []
    slots[r.order].push(_str(r['name'] ?? ''))
  }
  const clash = Object.keys(slots).sort((a, b) => Number(a) - Number(b))
    .filter((o) => slots[o].length > 1)
    .map((o) => `order=${o} 上有 ${slots[o].join('、')}`)
  if (clash.length) {
    throw new HudError(`正则 order 撞车：${clash.join('；')}\n`
      + '  conf 那几条与 spec 里的外来规则要各占一个号 —— 挪开再跑。')
  }
  spec['regex_rules'] = merged

  // ★ 移植记号：Python 这里是 `M.ydump(spec, SPEC)`。JS 侧不写 YAML（计划 §二①），
  //   走 JSON；JSON 是合法 YAML，PyYAML 读得回来，差分的树快照比的是结构。
  M.jdump(spec, SPEC)

  _P('已写回 spec：')
  if (_真值(opening)) {
    _P(`  开场白 ${opening['条目'] ?? ''} 已更新（正文与开场消息都换了）`)
  }
  _P(`  正则规则共 ${merged.length} 条（conf ${made.length} 条 · 非 conf 来源 ${foreign.length} 条，一个字没动）：`)
  for (const r of merged) {
    _P(`    order=${_str(r['order']).padEnd(3, ' ')} ${_str(r['name']).padEnd(24, ' ')} `
      + `pattern=${_str(r['pattern']).slice(0, 14).padEnd(14, ' ')} 替换 ${Array.from(_str(r['replacement'])).length} 字符`)
  }
  return spec
}


export function build(spec_or_project, write_back = false, out_fn = _print, theme_override = null) {
  /** 组装一个工程的 HUD。
   *
   * 返回 [problems, docs]：problems 非空 = 有校验问题（这时**不写回** spec）。
   * 组装本身失败（缺文件、名字对不上）会抛 HudError。
   *
   * ★ 参数**逐位对齐 Python**（`build(spec_or_project, write_back=False, out=print,
   *   theme_override=None)`）：`out` 默认就是 `print` —— 调一次就把模块级 `_P` 钉回
   *   打印，正是 Python 的行为（`_出口` 会被 `render_views` 换成空函数且**不还原**）。
   */
  setOut(out_fn)
  configure(spec_or_project, theme_override)
  const [problems, docs] = assemble()
  if (write_back) {
    if (problems.length) {
      out_fn('')
      out_fn('有校验问题，已跳过写回 spec —— 不拿半成品覆盖源文件。')
    } else {
      out_fn('')
      patch_spec()
    }
  }
  return [problems, docs]
}


export function render_views(spec_or_project, theme_override = null, out_fn = () => {}) {
  /** 只算不落盘：返回 {视图文件名: 完整 HTML 文档}。
   *
   * 「皮肤巡览」靠它一次算好几套皮肤 —— 每算一套都重新 configure，
   * 进程里不留上一套的残渣（CSS_ALL / JS_ALL 每次都是重算的）。
   */
  setOut(out_fn)
  configure(spec_or_project, theme_override)
  const [, docs] = assemble(false)
  return docs
}


export function main(argv = null) {
  const 参 = argv ?? process.argv.slice(2)
  const 位置 = []
  let write_back = false
  for (const a of 参) {
    if (a === '--写回' || a === '--write-back') write_back = true
    else if (a.startsWith('-')) throw new HudError(`unrecognized arguments: ${a}`)
    else 位置.push(a)
  }
  if (位置.length !== 1) {
    throw new HudError(`usage: forge hud [-h] [--写回] 目标\nforge hud: error: 目标 只该给一个`)
  }
  let problems
  try {
    ;[problems] = build(位置[0], write_back)
  } catch (exc) {
    if (exc instanceof HudError) {
      console.log(`!! ${exc.message}`)
      return 1
    }
    throw exc
  }
  return problems.length ? 1 : 0
}


// ------------------------------------------------------------ 本模块自己要的收尾

/** Python 的真值判定（与 content.pyTruthy 同源，按本模块用到的取一份）。 */
function _真值(v) {
  if (v === null || v === undefined || v === false) return false
  if (v === true) return true
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return Boolean(v)
}

/** Python 的 `str(v)`。 */
function _str(v) {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v)
}

// Python 的 `str.isspace()` 那一套：比 JS 的 `trim()` **宽 `\x1c`–`\x1f`、`\x85`**，
// 又**不含 `\ufeff`**（JS 的 trim 会把 BOM 当空白吃掉）。差一个字符就是差一个字节。
const _PY空白 = '\t\n\v\f\r \x1c\x1d\x1e\x1f\x85\u00a0\u1680' +
  '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a' +
  '\u2028\u2029\u202f\u205f\u3000'
const _STRIP = new RegExp(`^[${_PY空白}]+|[${_PY空白}]+$`, 'g')

/** Python 的 `s.strip()`。 */
const _strip = (s) => String(s).replace(_STRIP, '')

/** Python 的 `str(list)`：`[1, 2]`。诊断文案里要用（`重复的 order：%s`）。 */
function _pyList(a) {
  return '[' + a.map((x) => _str(x)).join(', ') + ']'
}
