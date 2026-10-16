# -*- coding: utf-8 -*-
"""forge.mjs 补丁 1：① 补上缺失的「小工具」块；② 把 6 处 Python 关键字写法改成位置实参。

每次替换都断言命中 1 次；改完不做别的事（写盘由调用方核对）。
"""
import io
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

MJS = r"E:\workGZQ\制卡工具\forgejs\forge.mjs"
MARK = "// ------------------------------------------------------------------ 分发"

BLOCK = r'''// ------------------------------------------------------------------ 小工具
/** `forge.py:835` —— 命令行参数本身有毛病（不是卡的问题）。 */
export class ArgError extends Error {
  constructor(消息 = '') { super(消息); this.name = 'ArgError' }
}

/** Python `"%s" % v`：`None` 打成 `None`。 */
function _pyStr(v) { return v === null || v === undefined ? 'None' : String(v) }

/**
 * `forge.py:839` `_读文` —— 参数值写成 `@文件名` 且那个文件真在，就从文件读内容。
 *
 * 文件末尾那一个换行按编辑器习惯忽略；`open(..., encoding="utf-8")` 是文本模式读
 * （universal newlines），所以先 `\r\n`/`\r` 折成 `\n` 再判末尾。
 */
export function _读文(v) {
  if (typeof v !== 'string' || !v.startsWith('@')) return v
  const f = v.slice(1)
  if (!f) throw new ArgError('`@` 后面要跟文件名。例：--正文@正文.txt')
  if (!_是文件(f)) {
    throw new ArgError('参数里的 @' + f + ' 不是个文件（当前目录 ' + process.cwd() + '）。\n'
      + '  `@名字` 的意思是「从这个文件读内容」。写出绝对路径最稳；\n'
      + '  真的想传一个以 @ 开头的字符串？把整段写进文件再 @ 引。')
  }
  const 文 = _读文本(f)
  return 文.endsWith('\n') ? 文.slice(0, -1) : 文
}

/** `forge.py:864` `_opt` —— `--旗 值` 与 `--旗@值` 两种写法都认；认不出返 `null`。 */
export function _opt(argv, names) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (names.includes(a) && i + 1 < argv.length) return _读文(argv[i + 1])
    for (const n of names) {              // 也认连写：--正文@正文.txt
      if (String(a).startsWith(n + '@')) return _读文(String(a).slice(n.length))
    }
  }
  return null
}

/** `forge.py:874` */
export function cmd_diff(argv) {
  if (argv.length < 2) {
    _print('用法：python forge.py diff <a.json> <b.json>')
    return 2
  }
  return diff_cards(argv[0], argv[1])
}

/** `forge.py:881` */
export function cmd_domains(argv) {
  _print('ElecKoi 真值域表（来源：反编译 0.2.8 逐字节取证）')
  _print('')
  for (const [name, dom] of Object.entries(domain.DOMAINS)) {
    _print('  ' + name)
    _print('      合法值：' + dom.values.join(' / '))
    _print('      缺省  ：' + _pyStr(dom.default))
    if (pyTruthy(dom.legacy)) {
      _print('      旧值  ：' + Object.entries(dom.legacy)
        .map(([k, val]) => k + ' → ' + _pyStr(val)).join('、'))
    }
    _print('      ' + _pyStr(dom.note))
    _print('')
  }
  _print('平台不读的字段：')
  for (const [f, why] of Object.entries(domain.DEAD_FIELDS)) _print('  ' + f + ' —— ' + why)
  _print('')
  for (const line of domain.POSITION_NOTE) _print('  ' + line)
  return 0
}

// ------------------------------------------------------------------ diff
/** `forge.py:902` `diff_cards` */
export function diff_cards(a_path, b_path) {
  // 时间戳与「往返重建」无关，先抹掉再比，免得报告被它们淹没
  const a = _scrub(M.jload(a_path))
  const b = _scrub(M.jload(b_path))
  if (_canon(a) === _canon(b)) {
    _print('✔ 两张卡语义完全一致')
    return 0
  }

  _print('✗ 存在差异')
  for (const key of ['format', 'version', 'character', 'assets', 'regex_rules']) {
    if (_canon(a[key] === undefined ? null : a[key]) !== _canon(b[key] === undefined ? null : b[key])) {
      _print('  顶层字段不同：' + key)
    }
  }

  for (const [key, label] of [['setting_library', '设定库'], ['variable_config', '变量']]) {
    let va = pack.active_library(a)
    let vb = pack.active_library(b)
    if (key === 'variable_config') {
      va = pack.active_variables(a)
      vb = pack.active_variables(b)
    }
    if (_canon(va) === _canon(vb)) continue
    _print('  ' + label + ' 不同')
    if (key === 'setting_library') {
      const ta = new Map()
      for (const e of ((va && va.entries) || [])) ta.set(e.title === undefined ? null : e.title, e)
      const tb = new Map()
      for (const e of ((vb && vb.entries) || [])) tb.set(e.title === undefined ? null : e.title, e)
      for (const t of ta.keys()) {
        if (!tb.has(t)) _print('      仅 A 有：' + _pyStr(t))
        else if (_canon(ta.get(t)) !== _canon(tb.get(t))) _print('      内容不同：' + _pyStr(t))
      }
      for (const t of tb.keys()) {
        if (!ta.has(t)) _print('      仅 B 有：' + _pyStr(t))
      }
    }
  }
  return 1
}

/** `forge.py:935` `_canon` —— `json.dumps(obj, ensure_ascii=False, sort_keys=True)`。 */
export function _canon(obj) { return _json文(obj, true) }

/** `json.dumps` 的字面输出（键按**码点**排序，不是 UTF-16 序）。 */
function _json文(v, 排键) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN'
    if (v === Infinity) return 'Infinity'
    if (v === -Infinity) return '-Infinity'
    return String(v)
  }
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map((x) => _json文(x, 排键)).join(', ') + ']'
  if (typeof v === 'object') {
    let 键 = Object.keys(v)
    if (排键) 键 = 键.slice().sort(比串)
    return '{' + 键.map((k) => JSON.stringify(k) + ': ' + _json文(v[k], 排键)).join(', ') + '}'
  }
  return 'null'
}

/** Python 元组比较：`sorted` 对元组逐元素比，字符串按码点。 */
function _比元组(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    const c = 比串(String(x), String(y))
    if (c !== 0) return c
  }
  return a.length - b.length
}

// ------------------------------------------------------------------ selftest
/** `forge.py:940` `_常驻字数` —— 一张卡里「每轮都要注入」的字数。 */
export function _常驻字数(卡) {
  const lib = pack.active_library(卡) || {}
  let 总 = 0
  for (const e of (lib.entries || [])) {
    if (String(e.trigger_mode || '') === 'always' && String(e.kind || 'normal') === 'normal') {
      总 += lenPy(String(e.content || ''))
    }
  }
  return 总
}

/** `forge.py:2470` `_fresh_snapshot` —— 撤模块的验收靠它。 */
export function _fresh_snapshot(spec_path) {
  const spec = M.yload(spec_path) || {}
  const lib = spec.library || {}
  const entries = (lib.entries || []).map((e) => [
    String(e.id || ''), String(e.title || ''),
    lenPy(String(e.content || '')), String(e.agent_read_strategy || ''),
  ])
  entries.sort(_比元组)
  const rules = (spec.regex_rules || []).map((r) => String(r.id || ''))
  rules.sort(比串)
  return { 条目: entries.length, 条目明细: entries, 正则: rules.length, 正则明细: rules }
}

/** `forge.py:2486` `_canon_pair` —— 比语义：忽略键顺序、忽略空白。 */
export function _canon_pair(a, b) { return _canon(_scrub(a)) === _canon(_scrub(b)) }

/**
 * `forge.py:2491` `_scrub` —— 去掉与语义无关的易变字段（时间戳）。
 *
 * 卡里 `setting_library` / `variable_config` 是嵌套的 JSON **字符串**，光在顶层 dict
 * 上删键不够 —— 得先把它当 JSON 解析开再往里删。
 */
export function _scrub(obj) {
  if (Array.isArray(obj)) return obj.map((v) => _scrub(v))
  if (obj !== null && typeof obj === 'object') {
    const 出 = {}
    for (const [k, v] of Object.entries(obj)) {
      if (['created_at', 'updated_at', 'updatedAt', 'config_updated_at'].includes(k)) continue
      出[k] = _scrub(v)
    }
    return 出
  }
  if (typeof obj === 'string' && (obj.slice(0, 1) === '{' || obj.slice(0, 1) === '[')) {
    try { return _scrub(JSON.parse(obj)) } catch { return obj }
  }
  return obj
}

'''

# ---------------------------------------------------------------- 6 处调用点
REPL = []

REPL.append((
    """      const 新参 = {
        分组: _opt(argv, ['--分组', '--group']) || '',
        模板: _opt(argv, ['--模板', '--template']) || '常驻',
        正文: _opt(argv, ['--正文', '--body']) || '',
        关键词: _list(_opt(argv, ['--关键词', '--kw'])),
      }
      const 位 = _opt(argv, ['--位置', '--position'])
      if (位 !== null) 新参.位置 = 位
      const 示 = _opt(argv, ['--提示', '--hint'])
      if (示 !== null) 新参.提示 = 示
      CONTENT.add_entry(spec, _opt(argv, ['--新', '--add']), 新参)""",
    """      CONTENT.add_entry(spec, _opt(argv, ['--新', '--add']),
        _opt(argv, ['--分组', '--group']) || '',
        _opt(argv, ['--模板', '--template']) || '常驻',
        _opt(argv, ['--正文', '--body']) || '',
        _list(_opt(argv, ['--关键词', '--kw'])),
        _opt(argv, ['--位置', '--position']),
        _opt(argv, ['--提示', '--hint']))""",
))

REPL.append((
    """      CONTENT.dup_entries(spec, 谁们, {
        标题: _opt(argv, ['--标题', '--title']),
        到: _opt(argv, ['--到', '--to', '--分组', '--group']) || '',
      })""",
    """      CONTENT.dup_entries(spec, 谁们, _opt(argv, ['--标题', '--title']),
        _opt(argv, ['--到', '--to', '--分组', '--group']) || '')""",
))

REPL.append((
    """      CONTENT.add_group(spec, _opt(argv, ['--新', '--add']),
        父 = _opt(argv, ['--父', '--parent']) || '')""",
    """      CONTENT.add_group(spec, _opt(argv, ['--新', '--add']),
        _opt(argv, ['--父', '--parent']) || '')""",
))

REPL.append((
    """      CONTENT.add_object(spec, _opt(argv, ['--新对象']),
        父 = _opt(argv, ['--父', '--parent']) || '',
        说明 = _opt(argv, ['--说明', '--desc']) || '',
        更新规则 = _opt(argv, ['--更新规则']) || '')""",
    """      CONTENT.add_object(spec, _opt(argv, ['--新对象']),
        _opt(argv, ['--父', '--parent']) || '',
        _opt(argv, ['--说明', '--desc']) || '',
        _opt(argv, ['--更新规则']) || '')""",
))

REPL.append((
    """      CONTENT.add_variable(spec, 对象, 标,
        类型 = _opt(argv, ['--类型', '--type']) || 'string',
        初值 = _opt(argv, ['--初值', '--value']),
        说明 = _opt(argv, ['--说明', '--desc']) || '',
        更新规则 = _opt(argv, ['--更新规则']) || '')""",
    """      CONTENT.add_variable(spec, 对象, 标,
        _opt(argv, ['--类型', '--type']) || 'string',
        _opt(argv, ['--初值', '--value']),
        _opt(argv, ['--说明', '--desc']) || '',
        _opt(argv, ['--更新规则']) || '')""",
))

REPL.append((
    """      CONTENT.add_regex(spec, _opt(argv, ['--新', '--add']),
        模式 = _opt(argv, ['--模式', '--pattern']) || '',
        替换 = _opt(argv, ['--替换', '--repl']) || '',
        目标 = _list(_opt(argv, ['--目标', '--targets'])),
        顺序 = (pyTruthy(序) ? Number.parseInt(序, 10) : null))""",
    """      CONTENT.add_regex(spec, _opt(argv, ['--新', '--add']),
        _opt(argv, ['--模式', '--pattern']) || '',
        _opt(argv, ['--替换', '--repl']) || '',
        _list(_opt(argv, ['--目标', '--targets'])),
        (pyTruthy(序) ? Number.parseInt(序, 10) : null))""",
))


def main():
    src = io.open(MJS, encoding="utf-8").read()
    for bad in ("export class ArgError", "function _pyStr(", "function _比元组(", "function _json文("):
        if bad in src:
            raise SystemExit("!! 文件里已经有 %r —— 先人工看一眼" % bad)
    if src.count(MARK) != 1:
        raise SystemExit("!! 分发段标记命中 %d 次（应为 1）" % src.count(MARK))
    for old, new in REPL:
        n = src.count(old)
        if n != 1:
            raise SystemExit("!! 有 %d 处这样的调用点，应为 1：\n%s" % (n, old[:80]))
        src = src.replace(old, new)
    src = src.replace(MARK, BLOCK + MARK, 1)
    io.open(MJS, "w", encoding="utf-8", newline="\n").write(src)
    print("forge.mjs 补丁 1 落盘：%d 字节" % len(src.encode("utf-8")))


main()
