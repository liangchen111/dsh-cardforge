/**
 * 零依赖 YAML **子集**读取器 —— 只为读本工具自己写出来的 `.spec.yaml`（外加手写的
 * 模块条目／示例卡稿）。**不是通用 YAML 实现**，吃不准就抛错，绝不猜。
 * ============================================================================
 *
 * 为什么要自己写：整份引擎的非标准库依赖只有 `yaml` 一个，而目标是**零依赖 ESM**。
 * 计划 §二① 的口径：**读得懂 `.spec.yaml`，新产出默认写 `.spec.json`**；比对时不比
 * 排版、拿 PyYAML 解析回来做**结构相等**。
 *
 * ★ 这个子集是**量的**结果、不是猜的：`差分\_探_yaml.py` 用 `yaml.scan()` 扫过本仓库
 *   14 个 YAML 文件，实际用到的语法只有 ——
 *
 *     标量样式：朴素 3263 · 单引号 402 · 双引号 16 · 块字面量 `|` 11（**没有 `>` 折叠**）
 *     集合：块映射（缩进 0/2/4/6/8，全偶数）· 块序列（`- `，含 `- key: v` 紧凑写法）
 *           · 流序列 `[…]` 99 处 · 流映射 `{…}` 1 处
 *     边角：**无锚点 & / 别名 * / 标签 ! / 指令 % / 多文档 / 制表符 / CRLF**
 *
 *   所以下面这些**故意不实现，遇到就抛错**（不许静默降级成字符串）：
 *     · 锚点与别名（`&a` / `*a`）· 标签（`!!str`）· 指令（`%YAML`）· 多文档（`---`/`...`）
 *     · **裸时间戳**（PyYAML 会把 `2026-01-01` 解成 `datetime.date`、`2026-01-01T00:00:00` 解成
 *       `datetime.datetime`）—— 引擎写出的 spec 里时间戳一律**带单引号**（实测：`'2026-01-01T00:00:00+08:00'`），
 *       所以正常路径撞不上；真撞上就是手写文件，那时的正确做法是「告诉他加引号」，不是替他猜。
 *     · YAML 1.1 的六十进制整数（`12:30` → 750）—— 同理，报错。
 *
 * 解析出来的形状：映射 → 普通对象（**保持键的先后顺序**）；序列 → 数组；标量 → JS 值。
 * 重复键取**后一个**（PyYAML 的 safe_load 也是这个行为）。
 */

// ------------------------------------------------------------------ 词法小件

/** 行首空格数。制表符按 YAML 规矩是禁止的（缩进里）。 */
function 缩进(行) {
  let n = 0
  while (n < 行.length && 行[n] === ' ') n += 1
  if (行[n] === '\t') throw new Error('YAML 子集：缩进里不许有制表符')
  return n
}

/**
 * 去掉行尾注释 —— 只有「前面是行首或空白」的 `#` 才算注释，
 * 且不在引号里（`content: 'a # b'` 与 `replacement: a#b` 都不能被切）。
 */
export function 去注释(行) {
  let 引 = null
  for (let i = 0; i < 行.length; i += 1) {
    const c = 行[i]
    if (引 === "'") {
      if (c === "'" && 行[i + 1] === "'") { i += 1; continue }
      if (c === "'") 引 = null
      continue
    }
    if (引 === '"') {
      if (c === '\\') { i += 1; continue }
      if (c === '"') 引 = null
      continue
    }
    if (c === "'" || c === '"') { 引 = c; continue }
    if (c === '#' && (i === 0 || 行[i - 1] === ' ' || 行[i - 1] === '\t')) return 行.slice(0, i)
  }
  return 行
}

const 空白行 = (行) => 行.trim() === ''

// ------------------------------------------------------------------ 标量求值

const 空集 = new Set(['', '~', 'null', 'Null', 'NULL'])
const 真集 = new Set(['true', 'True', 'TRUE', 'yes', 'Yes', 'YES', 'on', 'On', 'ON'])
const 假集 = new Set(['false', 'False', 'FALSE', 'no', 'No', 'NO', 'off', 'Off', 'OFF'])
// ↓ 下面这几条是**照抄 PyYAML 的 resolver 正则**（不是照抄 YAML 规范）——
//   两者不一样，差一点点就差分见红。举例：YAML 1.2 的 `1e3` 是浮点，但 PyYAML 的
//   浮点正则要求**必须有小数点**，所以 `1e3` 在 PyYAML 眼里是**字符串**（本轮实测抓到的第一处红）。
//   同理：PyYAML 的八进制是 YAML 1.1 的「前导 0」（`012` → 10），**不认 `0o`**。
const 整二 = /^[-+]?0b[0-1_]+$/
const 整八 = /^[-+]?0[0-7_]+$/
const 整十 = /^[-+]?(?:0|[1-9][0-9_]*)$/
const 整十六 = /^[-+]?0x[0-9a-fA-F_]+$/
const 整六十 = /^[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+$/
const 浮甲 = /^[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+]?[0-9]+)?$/
const 浮乙 = /^\.[0-9_]+(?:[eE][-+][0-9]+)?$/
const 浮六十 = /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/
const 浮无 = /^[-+]?\.(?:inf|Inf|INF)$/
const 浮非 = /^\.(?:nan|NaN|NAN)$/
const 时间戳 = /^\d{4}-\d\d?-\d\d?([Tt ]|$)/

/** 朴素标量 → JS 值（**照 PyYAML safe_load 的解析规则**，不是照 YAML 规范）。 */
export function 解析普通标量(文) {
  const s = 文.trim()
  if (空集.has(s)) return null
  if (真集.has(s)) return true
  if (假集.has(s)) return false
  if (整二.test(s)) return parseInt(s.replace(/_/g, '').replace(/^([-+]?)0b/, '$1'), 2)
  if (整八.test(s)) return parseInt(s.replace(/_/g, '').replace(/^([-+]?)0/, '$1'), 8)
  if (整十.test(s)) return parseInt(s.replace(/_/g, ''), 10)
  if (整十六.test(s)) return parseInt(s.replace(/_/g, ''), 16)
  if (浮无.test(s)) return s[0] === '-' ? -Infinity : Infinity
  if (浮非.test(s)) return NaN
  if (浮甲.test(s) || 浮乙.test(s)) return parseFloat(s.replace(/_/g, ''))
  if (时间戳.test(s)) {
    throw new Error(`YAML 子集：不认裸时间戳 ${JSON.stringify(s)} —— 请给它加引号（引擎写出的 spec 都是带引号的）`)
  }
  if (整六十.test(s) || 浮六十.test(s)) {
    throw new Error(`YAML 子集：不认 YAML 1.1 的六十进制数 ${JSON.stringify(s)} —— 请给它加引号`)
  }
  return s
}

/** 单引号标量（`''` 是一个单引号）。 */
function 解析单引号(文, p) {
  let 出 = ''
  let i = p + 1
  while (i < 文.length) {
    if (文[i] === "'") {
      if (文[i + 1] === "'") { 出 += "'"; i += 2; continue }
      return { 值: 出, 下: i + 1 }
    }
    出 += 文[i]
    i += 1
  }
  throw new Error('YAML 子集：单引号没闭合')
}

/** 双引号标量（认 \\n \\t \\" \\\\ \\uXXXX \\xXX 这些转义）。 */
function 解析双引号(文, p) {
  let 出 = ''
  let i = p + 1
  const 表 = { n: '\n', t: '\t', r: '\r', '0': '\0', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/', ' ': ' ' }
  while (i < 文.length) {
    const c = 文[i]
    if (c === '"') return { 值: 出, 下: i + 1 }
    if (c === '\\') {
      const n = 文[i + 1]
      if (n === 'u') { 出 += String.fromCharCode(parseInt(文.slice(i + 2, i + 6), 16)); i += 6; continue }
      if (n === 'x') { 出 += String.fromCharCode(parseInt(文.slice(i + 2, i + 4), 16)); i += 4; continue }
      if (n === '\n') { i += 2; continue } // 续行
      if (n in 表) { 出 += 表[n]; i += 2; continue }
      throw new Error(`YAML 子集：双引号里不认的转义 \\${n}`)
    }
    出 += c
    i += 1
  }
  throw new Error('YAML 子集：双引号没闭合')
}

// ------------------------------------------------------------------ 解析器

const 状 = { 行: [], i: 0 }

function 找下一非空(行, 从) {
  let j = 从
  while (j < 行.length && 空白行(去注释(行[j]))) j += 1
  return j
}

function 跳过空行(s) {
  s.i = 找下一非空(s.行, s.i)
}

const 正文 = (行) => 去注释(行).trim()

/** 这一行的正文像不像「键: 值」的键那一半。 */
function 切键(body) {
  if (!body) return null
  let 引 = null
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]
    if (引 === "'") {
      if (c === "'" && body[i + 1] === "'") { i += 1; continue }
      if (c === "'") 引 = null
      continue
    }
    if (引 === '"') {
      if (c === '\\') { i += 1; continue }
      if (c === '"') 引 = null
      continue
    }
    if (c === "'" || c === '"') {
      if (i !== 0) return null // 键必须是整个标量；引号出现在中间 ⇒ 这是个普通标量
      引 = c
      continue
    }
    if (c === ':' && (i + 1 === body.length || body[i + 1] === ' ')) {
      const 原键 = body.slice(0, i)
      const 键 = 原键[0] === "'" ? 解析单引号(原键 + "'", 0).值
        : 原键[0] === '"' ? 解析双引号(原键 + '"', 0).值
          : 解析普通标量(原键)
      if (typeof 键 !== 'string' && typeof 键 !== 'number' && typeof 键 !== 'boolean') {
        throw new Error(`YAML 子集：这种键不认：${原键}`)
      }
      return [String(键 === null ? 'null' : 键), body.slice(i + 1).trim()]
    }
  }
  return null
}

/** 这一行的正文像不像「集合的开头」（`- ` 或 `键:`）。 */
function 像集合(body) {
  if (body === '-' || body.startsWith('- ')) return true
  return 切键(body) !== null
}

function 解析节点(s, 父缩进) {
  跳过空行(s)
  if (s.i >= s.行.length) return null
  const ind = 缩进(s.行[s.i])
  if (ind <= 父缩进) return null
  const body = 正文(s.行[s.i])
  if (body === '-' || body.startsWith('- ')) return 解析序列(s, ind)
  if (切键(body)) return 解析映射(s, ind)
  // 一个光秃秃的标量占一行（顶层或作为集合的值）
  s.i += 1
  return 解析普通标量(body)
}

function 解析序列(s, ind) {
  const 列 = []
  for (;;) {
    跳过空行(s)
    if (s.i >= s.行.length) break
    const 行 = s.行[s.i]
    if (缩进(行) !== ind) break
    const body = 正文(行)
    if (body !== '-' && !body.startsWith('- ')) break
    const 余 = body === '-' ? '' : body.slice(2).trim()
    if (余 === '') {
      s.i += 1
      列.push(解析节点(s, ind))
      continue
    }
    if (像集合(余)) {
      // `- key: v` 紧凑写法：把这一行改写成 ind+2 的一行，原地交给「节点」
      s.行[s.i] = ' '.repeat(ind + 2) + 余
      列.push(解析节点(s, ind))
      continue
    }
    s.i += 1
    列.push(...[解析行内标量(s, ind, 余, 行)])
  }
  return 列
}

function 解析映射(s, ind) {
  const 出 = {}
  for (;;) {
    跳过空行(s)
    if (s.i >= s.行.length) break
    const 行 = s.行[s.i]
    if (缩进(行) !== ind) break
    const body = 正文(行)
    const kv = 切键(body)
    if (!kv) break
    const [键, 余] = kv
    s.i += 1
    出[键] = 解析值(s, ind, 余, 行)
  }
  return 出
}

function 解析值(s, 键缩进, 余, 本行) {
  if (余 === '') {
    const j = 找下一非空(s.行, s.i)
    if (j < s.行.length) {
      const j行 = s.行[j]
      const jind = 缩进(j行)
      const jbody = 正文(j行)
      if (jind > 键缩进) {
        s.i = j
        return 解析节点(s, 键缩进)
      }
      // 序列可以与它的键同缩进（YAML 允许，PyYAML 也这么写）
      if (jind === 键缩进 && (jbody === '-' || jbody.startsWith('- '))) {
        s.i = j
        return 解析序列(s, jind)
      }
    }
    return null
  }
  const 头 = 余[0]
  if (头 === '|' || 头 === '>') return 解析块标量(s, 键缩进, 余)
  if (头 === '[' || 头 === '{') return 解析流(s, 余)
  if ('&*!%@`'.includes(头)) throw new Error(`YAML 子集：不认这个写法「${余.slice(0, 20)}」`)
  return 解析行内标量(s, 键缩进, 余, 本行)
}

/**
 * 流式标量的**折行**：单个换行折成空格，连续 n 个换行折成 `n-1` 个换行。
 *
 * 这条是主路径上的坑：`content: '第一段。` ／ 空行 ／ 空行 ／ `第二段'` 这种写法
 * 在真 spec 里到处都是，折错了字面就少一个／多一个换行，肉眼极难发现。
 */
function 折行(行表) {
  let 出 = ''
  let 空 = 0
  let 有货 = false
  for (const 行 of 行表) {
    const t = 行.trim()
    if (t === '') { 空 += 1; continue }
    if (!有货) { 出 = t; 有货 = true; 空 = 0; continue }
    const 断 = 空 + 1
    出 += 断 >= 2 ? '\n'.repeat(断 - 1) : ' '
    出 += t
    空 = 0
  }
  return 出
}

/** 引号标量可能跨行；朴素标量后面更缩进的行是它的折行续文。 */
function 解析行内标量(s, 键缩进, 余, 本行) {
  const 行表 = [余]
  if (余[0] === "'" || 余[0] === '"') {
    const 引 = 余[0]
    while (!引号闭合(行表.join('\n'), 引) && s.i < s.行.length) {
      行表.push(正文(s.行[s.i]))
      s.i += 1
    }
    const 值文 = 折行(行表)
    return 引 === "'" ? 解析单引号(值文, 0).值 : 解析双引号(值文, 0).值
  }
  // 朴素标量的折行续文：更缩进的行都算（空行只在后面还有续文时才算）
  for (;;) {
    if (s.i >= s.行.length) break
    if (s.行[s.i].trim() === '') {
      const j = 找下一非空(s.行, s.i)
      if (j >= s.行.length || 缩进(s.行[j]) <= 键缩进) break
      行表.push('')
      s.i += 1
      continue
    }
    if (缩进(s.行[s.i]) <= 键缩进) break
    const jbody = 正文(s.行[s.i])
    if (!jbody) break
    行表.push(jbody)
    s.i += 1
  }
  return 解析普通标量(折行(行表))
}

function 引号闭合(文, 引) {
  let i = 1
  while (i < 文.length) {
    const c = 文[i]
    if (引 === '"' && c === '\\') { i += 2; continue }
    if (c === 引) {
      if (引 === "'" && 文[i + 1] === "'") { i += 2; continue }
      return true
    }
    i += 1
  }
  return false
}

/** 块字面量 `|` / 折叠 `>` 及其咬合指示（`-` 去掉尾换行、`+` 全留）。 */
function 解析块标量(s, 键缩进, 头) {
  const 折叠 = 头[0] === '>'
  const 脚 = 头.slice(1)
  const 去尾 = 脚.includes('-')
  const 全留 = 脚.includes('+')
  const 位数 = /([0-9])/.exec(脚)
  const 指定缩进 = 位数 ? 键缩进 + parseInt(位数[1], 10) : null

  const 内容 = []
  let 块缩进 = 指定缩进
  for (;;) {
    if (s.i >= s.行.length) break
    const 行 = s.行[s.i]
    if (行.trim() === '') { 内容.push(''); s.i += 1; continue }
    const ind = 缩进(行)
    if (ind <= 键缩进) break
    if (块缩进 === null) 块缩进 = ind
    if (ind < 块缩进) break
    内容.push(行.slice(块缩进))
    s.i += 1
  }

  // 摘掉尾部的空行（它们的个数在 `+` 时才要用）
  let 尾数 = 0
  while (内容.length && 内容[内容.length - 1].trim() === '') { 内容.pop(); 尾数 += 1 }
  if (!内容.length) return 全留 ? '\n'.repeat(尾数) : ''

  const 文 = 折叠 ? 折叠连(内容) : 内容.join('\n')
  if (去尾) return 文
  if (全留) return 文 + '\n'.repeat(尾数 + 1)
  return 文 + '\n'
}

/** 折叠标量：单换行折成空格，连续空行折成 n-1 个换行。 */
function 折叠连(行表) {
  let 出 = ''
  let 空 = 0
  for (const 行 of 行表) {
    if (行.trim() === '') { 空 += 1; continue }
    if (出 !== '') 出 += 空 > 0 ? '\n'.repeat(空) : ' '
    else if (空 > 0) 出 += '\n'.repeat(空)
    出 += 行
    空 = 0
  }
  return 出
}

/** 流集合 `[…]` / `{…}`：可能跨行，先把括号配平的文本收齐再递归下降。 */
function 解析流(s, 首段) {
  let 文 = 首段
  let j = s.i
  while (!括号配平(文) && j < s.行.length) {
    文 += ' ' + 正文(s.行[j])
    j += 1
  }
  s.i = j
  const 游 = { 文, p: 0 }
  const 值 = 读流值(游)
  跳空白(游)
  if (游.p < 游.文.length) throw new Error(`YAML 子集：流集合后面还有多余的东西「${游.文.slice(游.p)}」`)
  return 值
}

function 括号配平(文) {
  let d = 0
  let 引 = null
  for (let i = 0; i < 文.length; i += 1) {
    const c = 文[i]
    if (引 === "'") { if (c === "'" && 文[i + 1] === "'") i += 1; else if (c === "'") 引 = null; continue }
    if (引 === '"') { if (c === '\\') i += 1; else if (c === '"') 引 = null; continue }
    if (c === "'" || c === '"') { 引 = c; continue }
    if (c === '[' || c === '{') d += 1
    else if (c === ']' || c === '}') d -= 1
  }
  return d <= 0
}

const 跳空白 = (游) => { while (游.p < 游.文.length && /\s/.test(游.文[游.p])) 游.p += 1 }

function 读流值(游) {
  跳空白(游)
  const c = 游.文[游.p]
  if (c === '[') {
    游.p += 1
    跳空白(游)
    const 列 = []
    if (游.文[游.p] === ']') { 游.p += 1; return 列 }
    for (;;) {
      列.push(读流值(游))
      跳空白(游)
      if (游.文[游.p] === ',') { 游.p += 1; continue }
      if (游.文[游.p] === ']') { 游.p += 1; break }
      throw new Error(`YAML 子集：流序列里这里应该是 , 或 ]（第 ${游.p} 个字符）`)
    }
    return 列
  }
  if (c === '{') {
    游.p += 1
    跳空白(游)
    const 对 = {}
    if (游.文[游.p] === '}') { 游.p += 1; return 对 }
    for (;;) {
      跳空白(游)
      const 键 = 读流标量(游, true)
      跳空白(游)
      if (游.文[游.p] !== ':') throw new Error('YAML 子集：流映射里键后面应该是 :')
      游.p += 1
      对[String(键)] = 读流值(游)
      跳空白(游)
      if (游.文[游.p] === ',') { 游.p += 1; continue }
      if (游.文[游.p] === '}') { 游.p += 1; break }
      throw new Error('YAML 子集：流映射里这里应该是 , 或 }')
    }
    return 对
  }
  return 读流标量(游, false)
}

function 读流标量(游, 是键) {
  const c = 游.文[游.p]
  if (c === "'") { const r = 解析单引号(游.文, 游.p); 游.p = r.下; return r.值 }
  if (c === '"') { const r = 解析双引号(游.文, 游.p); 游.p = r.下; return r.值 }
  let 起 = 游.p
  while (游.p < 游.文.length) {
    const x = 游.文[游.p]
    if (是键) { if (x === ':') break }
    else if (x === ',' || x === ']' || x === '}') break
    游.p += 1
  }
  return 解析普通标量(游.文.slice(起, 游.p))
}

// ------------------------------------------------------------------ 对外

/** 解析一份 YAML 文本。吃不准的地方抛错，不猜。 */
export function 解析YAML(文本) {
  const 行 = String(文本).replace(/\r\n?/g, '\n').split('\n')
  const s = { 行, i: 0 }
  跳过空行(s)
  if (s.i >= 行.length) return null
  const 值 = 解析节点(s, -1)
  跳过空行(s)
  if (s.i < 行.length) {
    throw new Error(`YAML 子集：第 ${s.i + 1} 行起还有本解析器看不懂的东西：「${正文(行[s.i]).slice(0, 40)}」`)
  }
  return 值
}
