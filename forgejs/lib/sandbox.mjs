/**
 * forge.sandbox 的 JS 版 —— 「沙箱友好模式」：在**不许删、不许改名**的文件系统里也能干活。
 * =================================================================================
 *
 * 为什么要有它（2026-10-08 实测）：ElecKoi 里的 AI 跑命令时带着一层受限令牌沙箱
 * （`workspace-write`）。在那层沙箱里：读 ✔ 写 ✔ **删 ✘ 改名 ✘**（全是 WinError 5）。
 * 而引擎的习惯是「写临时文件 → 证明能打包 → 原子改名覆盖」（`os.replace`），
 * 回收站与「撤皮肤」也都要删文件 —— 于是命令会在**第一次落盘时就挂**。
 *
 * 打开这个模式后（命令行加 `--沙箱`，或设环境变量 `FORGE_SANDBOX=1`），换成：
 *
 * | 原来 | 换成 |
 * |---|---|
 * | `os.replace(临时, 目标)` | 读临时内容 → **直接覆盖目标**（不做改名） |
 * | 删临时文件 | 照删；**删不掉不算失败**（收尾不该把已经成功的事报成错） |
 * | 回收站「用掉一条记录」 | 改写成**墓碑**（列表会跳过它），不删文件 |
 * | 撤皮肤（删 `主题.css`） | 把它写成**空壳**（只有一行 CSS 注释），读进去等于没有皮肤 |
 * | 撤模块（删 `hud/模块/<名>/`） | **留着目录**，靠 `hud.conf.json` 的「模块」列表说话 |
 *
 * 一句话：**沙箱里只创建、只覆盖，绝不让文件消失。**
 * 代价：丢掉「原子落盘」（写一半崩了留下半份文件），工程里会留下几个删不掉的空壳与墓碑。
 * 所以**能用普通模式就用普通模式**。
 */
import { existsSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

let _ON = null

// ------------------------------------------------------------------ 开关
/** 模式开着没有？先看进程内开关，没定过再看环境变量（只读一次）。 */
export function enabled() {
  if (_ON === null) {
    const v = String(process.env.FORGE_SANDBOX ?? '').trim().toLowerCase()
    _ON = !['', '0', 'false', 'no', 'off'].includes(v)
  }
  return _ON
}

export function enable(flag = true) {
  _ON = Boolean(flag)
}

/** 把 `--沙箱` / `--sandbox` 从参数里摘掉（它不取值，出现在哪儿都认）。 */
export function take_flag(argv) {
  let 列 = [...argv]
  if (列.includes('--沙箱') || 列.includes('--sandbox')) {
    enable(true)
    列 = 列.filter((a) => a !== '--沙箱' && a !== '--sandbox')
  } else {
    enabled()
  }
  return 列
}

/** 命令行上打的那一句提醒。 */
export function note() {
  return '沙箱友好模式：只创建、只覆盖 —— 不删文件、不改名（原子落盘让位）。' +
    '要能删能改名时：去掉 --沙箱 / FORGE_SANDBOX 再跑。'
}

// ------------------------------------------------------------------ 落盘
/**
 * 把临时文件落到目标位置。
 *
 * 正常：`os.replace`（原子，一步到位）。
 * 沙箱：读出来**直接覆盖目标** —— 只碰目标那一份文件，不涉及改名。
 */
export function land(tmp, target) {
  if (!enabled()) {
    // Python 的 os.replace 是「改名」（原子）。JS 的 renameSync 同义。
    renameSync(tmp, target)
    return
  }
  writeFileSync(target, readFileSync(tmp))
}

/** 改名。成功删掉源返回 True；沙箱里删不掉源，内容照写、返回 False。 */
export function rename(src, dst) {
  if (!enabled()) {
    renameSync(src, dst)
    return true
  }
  writeFileSync(dst, readFileSync(src))
  remove(src)
  return false
}

/** 删临时文件。**永不抛** —— 收尾失败不该把已经成功的事报成错（与模式无关）。 */
export function cleanup(path) {
  return remove(path)
}

/** 删一个文件：删掉 True，删不掉（含沙箱拒绝）False。**不抛**。 */
export function remove(path) {
  try {
    if (path && existsSync(path)) {
      unlinkSync(path)
      return true
    }
  } catch {
    /* 删不掉就 False */
  }
  return false
}

/** 删一棵目录树：同上，删不掉就 False，**不抛**。 */
export function rmtree(path) {
  try {
    if (path && _是目录(path)) {
      rmSync(path, { recursive: true, force: true })
      return true
    }
  } catch {
    /* 删不掉就 False */
  }
  return false
}

// ------------------------------------------------------------------ 替代「删除」的两种写法
/** 这份 JSON 记录是不是墓碑（已作废）。 */
export function is_tombstone(rec) {
  return Boolean(rec && typeof rec === 'object' && !Array.isArray(rec) && rec['_作废'])
}

/**
 * 让一份 JSON 记录**作废**。
 *
 * 正常：删掉。
 * 沙箱：改写成墓碑（`content.list_trash` 会跳过它）—— 文件还在，但语义上它没了。
 */
export function retire(path) {
  if (!enabled()) return remove(path)
  try {
    writeFileSync(path, '{"_作废": true}\n', 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 把一份文件改写成**空壳**，替代「删掉它」。
 *
 * CSS / JS 里注释都是合法的，读进去等于没读；`.json` 就写一个空对象。
 */
export function shell(path, why) {
  if (!enabled()) return remove(path)
  const b = basename(path).toLowerCase()
  let body
  if (b.endsWith('.js')) body = `// ${why}\n`
  else if (b.endsWith('.json')) body = '{}\n'
  else body = `/* ${why} */\n`
  try {
    writeFileSync(path, body, 'utf8')
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ 内部
function _是目录(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
