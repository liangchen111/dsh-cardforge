/** Python 的 `str(exc)`：只有消息本体，不带 `Error: ` 前缀。 */
function _errMsg(exc) {
  if (exc === null || exc === undefined) return 'None'
  if (typeof exc === 'string') return exc
  if (exc.message !== undefined) return String(exc.message)
  return String(exc)
}

/** `open(p, 'r', encoding='utf-8').read()` —— Python 默认通用换行（CRLF/CR → LF）。 */
function _读文本(p) {
  return readFileSync(p, 'utf8').split('\r\n').join('\n').split('\r').join('\n')
}

/** Python 的 `str.count(sub)`（非空子串，非重叠计数）。 */
function _数(s, sub) {
  if (sub === '') return lenPy(s) + 1
  return String(s).split(sub).length - 1
}

/** Python 的 `os.path.getsize(p)`。 */
function _大小(p) { return statSync(p).size }

/** `json.dumps(obj, ensure_ascii=False)`（默认分隔符 `", "` / `": "`、无缩进、无末尾换行）。
 *  `ass` 为真时模拟 CPython 的 `ensure_ascii=True`（非 ASCII 一律 `\uXXXX`）。 */
function _json紧凑(obj, ass) {
  if (obj === null || obj === undefined) return 'null'
  if (obj === true) return 'true'
  if (obj === false) return 'false'
  if (Array.isArray(obj)) return '[' + obj.map((x) => _json紧凑(x, ass)).join(', ') + ']'
  if (typeof obj === 'number') return _pyStr(obj)
  if (typeof obj === 'object') {
    return '{' + Object.keys(obj)
      .map((k) => _json键(k, ass) + ': ' + _json紧凑(obj[k], ass)).join(', ') + '}'
  }
  return _json串(String(obj), ass)
}

function _json键(k, ass) { return _json串(String(k), ass) }

function _json串(s, ass) {
  const 原 = JSON.stringify(s)
  if (!ass) return 原
  let out = ''
  for (let i = 0; i < 原.length; i++) {
    const c = 原.charCodeAt(i)
    out += c > 127 ? '\\u' + c.toString(16).padStart(4, '0') : 原[i]
  }
  return out
}

/** `sorted(os.listdir(p))`。 */
function _列目录(p) { return readdirSync(p).slice().sort(比串) }

/** `shutil.rmtree(p, ignore_errors=True)`。 */
function _删树(p) { try { rmSync(p, { recursive: true, force: true }) } catch { /* ignore_errors */ } }

/** `shutil.copy(src, dst)`（保留内容；mtime 由调用方按需 utimes）。 */
function _拷文件(src, dst) { copyFileSync(src, dst) }

/** `os.utime(p, (t, t))` —— Node 的 `utimesSync(path, atime, mtime)`。 */
function _触时间(p, t) { utimesSync(p, t, t) }

/** Python 的 `"%s" % True` → `'True'`（`String(true)` 会给出 `'true'`）。 */
function _T(v) { return v ? 'True' : 'False' }

/** `re.findall(pattern, text)` 的等价物：取**捕获组 1**的全部命中（按出现顺序）。 */
function _找全部(文, re, 组) {
  const out = []
  for (const m of String(文).matchAll(re)) out.push(m[组])
  return out
}

/** Python `lambda *a, **k: None` —— 自检里到处用来消输出。 */
const _P = () => {}

/** `zipfile.ZipFile(z).namelist()`：只读中央目录取名字。
 *  自检第 16 项专用 —— **不为此去给已经绿的 `dist.mjs` 加导出**（它的 `_读zip` 是私有的）。 */
function _zip列名(zip_path) {
  const buf = readFileSync(zip_path)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('File is not a zip file')
  const n = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad magic number for central directory')
    const 名长 = buf.readUInt16LE(p + 28)
    const 额外长 = buf.readUInt16LE(p + 30)
    const 注长 = buf.readUInt16LE(p + 32)
    out.push(buf.toString('utf8', p + 46, p + 46 + 名长))
    p += 46 + 名长 + 额外长 + 注长
  }
  return out
}
