/**
 * forge.pack 的 JS 版 —— spec ⇄ card 打包与解包。
 * ================================================
 *
 * 为什么需要这一层：ElecKoi 的卡把「设定库」和「变量」各自压成了一坨 JSON 字符串，
 * 手改极易错位（少一个引号、顺序乱了，软件就静默读不到）。本模块把它拆成人可读的
 * 规格文件（唯一真相），再原样打包回去。
 *
 * ★ 与 Python 版**唯一有意的差别**：规格文件的默认格式。
 *   Python 写 `.spec.yaml`；这里写 **`.spec.json`**（零依赖 -> 用不了 YAML 包）。
 *   卡那边两边**逐字节一致**，规格那边用结构相等比 —— 见 `文档/重写-JS引擎-计划.md`。
 */
import { basename, dirname, extname, join, resolve } from 'node:path'
import { unlinkSync } from 'node:fs'
import * as M from './model.mjs'

export const KEEP_LIB_VERSIONS = '#其它版本(原样保留)'
export const KEEP_VAR_VERSIONS = '#其它版本(原样保留)'
export const KEEP_TOP_EXTRA = '#其它顶层字段(原样保留)'

const _KNOWN_TOP = new Set(['format', 'version', 'character', 'assets',
  'setting_library', 'variable_config', 'regex_rules'])

const 是对象 = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// ------------------------------------------------------------------ unpack
/**
 * 卡片 -> 可读规格。返回写出的 spec 路径。
 *
 * 认卡守卫照抄：**先确认它是个 ElecKoi 卡，再动手** —— 少了它，一张酒馆卡会
 * 「解包成功」地变成空工程（不报错，只是收进来一张什么都装不了的卡）。
 */
export function unpack(card_path, out_path = null) {
  const card = M.jload(card_path)

  if (!['character', 'setting_library', 'variable_config'].some((k) => k in card)) {
    throw new Error(
      '这不像 ElecKoi 卡：character / setting_library / variable_config 三样一样都没有。\n' +
      `  先认一下是什么卡： python forge.py analyze "${basename(String(card_path))}"\n` +
      '  酒馆卡走 python forge.py to-eleckoi（`import` 与 `new --从` 会自动转）。')
  }

  const base = M.stripUploadPrefix(basename(card_path))
  const stem = extname(base).length
    ? base.slice(0, -extname(base).length).replace(/^[. ]+|[. ]+$/g, '')
    : base.replace(/^[. ]+|[. ]+$/g, '')
  out_path = out_path ?? join(dirname(resolve(card_path)), `${stem || 'card'}.spec.json`)

  const spec = {}
  spec.format = card.format ?? M.CARD_FORMAT
  spec.version = card.version ?? 1
  spec.character = M.ordered(card.character ?? {}, M.CHARACTER_KEYS)
  spec.assets = card.assets ?? []

  // ---- 设定库
  const lib = _as_obj(card.setting_library)
  const versions = lib.versions ?? []
  const act = _pick_active(versions, lib.active_version_id ?? '')

  const library = {}
  library.snapshot_format = lib.format ?? M.LIB_FORMAT
  library.snapshot_version = lib.version ?? 1
  library.active_version_id = act.id ?? lib.active_version_id ?? ''
  library.version_name = act.name ?? ''
  library.list_all_expanded = act.list_all_expanded ?? true
  library.expanded_group_ids = act.expanded_group_ids ?? []
  library.prompt_positions = act.prompt_positions ?? []
  library.created_at = act.created_at ?? ''
  library.updated_at = act.updated_at ?? ''
  library.groups = (act.groups ?? []).map((g) => M.ordered(g, M.GROUP_KEYS))
  library.entries = (act.entries ?? []).map((e0) => {
    const e = M.ordered(e0, M.ENTRY_KEYS)
    e.opening_messages = (e.opening_messages ?? []).map((m) => M.ordered(m, M.ENTRY_MESSAGE_KEYS))
    return e
  })
  const others = versions.filter((v) => v !== act)
  if (others.length) library[KEEP_LIB_VERSIONS] = others
  spec.library = library

  // ---- 变量
  const vc = _as_obj(card.variable_config)
  const vvers = vc.versions ?? []
  const vact = _pick_active(vvers, vc.active_version_id ?? '')

  const variables = {}
  variables.config_format = vc.format ?? M.VAR_FORMAT
  variables.config_version = vc.version ?? 1
  variables.character_id = vc.character_id ?? ''
  variables.name = vc.name ?? ''
  variables.version_name = vact.name ?? vc.name ?? ''
  variables.active_version_id = vact.id ?? vc.active_version_id ?? ''
  variables.initial_state = vact.initial_state ?? {}
  variables.schema_code = vact.schema_code ?? ''
  variables.objects = (vact.objects ?? []).map((o) => M.ordered(o, M.VAR_OBJECT_KEYS))
  variables.variables = (vact.variables ?? []).map((v) => M.ordered(v, M.VAR_ITEM_KEYS))
  variables.expanded_object_ids = vact.expanded_object_ids ?? []
  variables.created_at = vact.created_at ?? ''
  variables.updated_at = vact.updated_at ?? ''
  variables.config_updated_at = vc.updated_at ?? ''
  const v_others = vvers.filter((v) => v !== vact)
  if (v_others.length) variables[KEEP_VAR_VERSIONS] = v_others
  spec.variables = variables

  spec.regex_rules = (card.regex_rules ?? []).map((r) => M.ordered(r, M.REGEX_KEYS))

  const extra = {}
  for (const [k, v] of Object.entries(card)) if (!_KNOWN_TOP.has(k)) extra[k] = v
  if (Object.keys(extra).length) spec[KEEP_TOP_EXTRA] = extra

  M.jdump(spec, out_path)
  return out_path
}

// ------------------------------------------------------------------ build
/** 可读规格 -> 卡片。返回写出的卡路径。 */
export function build(spec_path, out_path) {
  const spec = M.loadStructured(spec_path) ?? {}

  const card = {}
  card.format = spec.format ?? M.CARD_FORMAT
  card.version = spec.version ?? 1
  card.character = M.ordered(spec.character ?? {}, M.CHARACTER_KEYS)
  card.assets = spec.assets ?? []

  // ---- 设定库
  const library = spec.library ?? {}
  const entries = (library.entries ?? []).map((e0) => {
    const e = M.ordered(e0, M.ENTRY_KEYS)
    e.opening_messages = (e.opening_messages ?? []).map((m) => M.ordered(m, M.ENTRY_MESSAGE_KEYS))
    return e
  })
  const groups = (library.groups ?? []).map((g) => M.ordered(g, M.GROUP_KEYS))

  const lib_version = {
    id: library.active_version_id ?? '',
    name: library.version_name ?? '',
    entries,
    groups,
    prompt_positions: library.prompt_positions ?? [],
    list_all_expanded: library.list_all_expanded ?? true,
    expanded_group_ids: library.expanded_group_ids ?? [],
    created_at: library.created_at ?? '',
    updated_at: library.updated_at ?? '',
  }
  const snap = {
    format: library.snapshot_format ?? M.LIB_FORMAT,
    version: library.snapshot_version ?? 1,
    active_version_id: library.active_version_id ?? '',
    versions: [lib_version, ...(library[KEEP_LIB_VERSIONS] ?? [])],
  }
  card.setting_library = JSON.stringify(snap)

  // ---- 变量
  const v = spec.variables ?? {}
  const v_objects = (v.objects ?? []).map((o) => M.ordered(o, M.VAR_OBJECT_KEYS))
  const v_items = (v.variables ?? []).map((item0) => {
    const item = M.ordered(item0, M.VAR_ITEM_KEYS)
    if ('default_value' in item && typeof item.default_value !== 'string') {
      // Python 是 `json.dumps(v, ensure_ascii=False)`（默认带空格），照抄
      item.default_value = JSON.stringify(item.default_value)
    }
    return item
  })

  const _var_payload = () => ({
    initial_state: v.initial_state ?? {},
    schema_code: v.schema_code ?? '',
    objects: v_objects,
    variables: v_items,
    expanded_object_ids: v.expanded_object_ids ?? [],
  })

  const var_version = {
    id: v.active_version_id ?? '',
    name: v.version_name ?? v.name ?? '',
    ..._var_payload(),
  }
  var_version.created_at = v.created_at ?? ''
  var_version.updated_at = v.updated_at ?? ''

  const vc = {
    format: v.config_format ?? M.VAR_FORMAT,
    version: v.config_version ?? 1,
    character_id: v.character_id ?? '',
    name: v.name ?? '',
    active_version_id: v.active_version_id ?? '',
    updated_at: v.config_updated_at ?? '',
    ..._var_payload(),
  }
  vc.versions = [var_version, ...(v[KEEP_VAR_VERSIONS] ?? [])]
  card.variable_config = JSON.stringify(vc, null, 2)

  card.regex_rules = (spec.regex_rules ?? []).map((r) => M.ordered(r, M.REGEX_KEYS))

  for (const [k, val] of Object.entries(spec[KEEP_TOP_EXTRA] ?? {})) card[k] = val

  M.jdump(card, out_path, 2)
  return out_path
}

// ------------------------------------------------------------------ 取数
/** 从卡里取出 (character, setting_library_snapshot, variable_config) 三个对象。 */
export function card_parts(card) {
  const lib = _as_obj(card.setting_library)
  const vc = _as_obj(card.variable_config)
  return [card.character ?? {}, lib, vc]
}

export function active_library(card) {
  const [, lib] = card_parts(card)
  const versions = lib.versions ?? []
  return _pick_active(versions, lib.active_version_id ?? '') ?? {}
}

/** 整份设定库容器（含 versions / active_version_id），给导出存档用。 */
export const raw_setting_library = (card) => _as_obj(card.setting_library)

/** 整份变量容器（含 versions / character_id），给导出存档用。 */
export const raw_variable_config = (card) => _as_obj(card.variable_config)

export function active_variables(card) {
  const [, , vc] = card_parts(card)
  const versions = vc.versions ?? []
  return _pick_active(versions, vc.active_version_id ?? '') ?? {}
}

/**
 * 在卡上就地改「当前设定库版本」，并把改动写回卡片字符串。
 *
 * 注意：`card.setting_library` 是一段 JSON **字符串**，每次解析都得到新副本；
 * 改了副本不写回，等于没改。凡是要改卡的结构，都走这个口。
 */
export function mutate_active_library(card, fn) {
  const snap = _as_obj(card.setting_library)
  const versions = snap.versions ?? []
  const act = _pick_active(versions, snap.active_version_id ?? '')
  fn(act)
  card.setting_library = JSON.stringify(snap)
  return card
}

/** 同上，改「当前变量版本」。 */
export function mutate_active_variables(card, fn) {
  const vc = _as_obj(card.variable_config)
  const versions = vc.versions ?? []
  const act = _pick_active(versions, vc.active_version_id ?? '')
  fn(act)
  card.variable_config = JSON.stringify(vc)
  return card
}

/** 把 spec 在内存里编成卡（不落盘），供校验使用。 */
export function spec_to_card(spec_path) {
  const tmp = M.tempJson()
  try {
    build(spec_path, tmp)
    return M.jload(tmp)
  } finally {
    try { unlinkSync(tmp) } catch { /* 删不掉就算了 */ }
  }
}

// ------------------------------------------------------------------ 内部
export function _as_obj(raw) {
  if (raw === null || raw === undefined) return {}
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return {}
    try {
      return JSON.parse(t)
    } catch {
      return {}
    }
  }
  return 是对象(raw) ? raw : {}
}

export function _pick_active(versions, active_id) {
  if (!versions || !versions.length) return {}
  for (const v of versions) if (v.id === active_id) return v
  return versions[0]
}
