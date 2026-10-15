/**
 * forge.domain 的 JS 版 —— ElecKoi 真值域表与静默降级拦截。
 * ========================================================
 *
 * 这张表是本工具的护城河：市面上多数制卡工具不知道 ElecKoi 的真实字段值域，
 * 于是导进去的卡有一半字段是「看着对、其实没生效」。
 *
 * 移植注意：**表项的顺序就是输出的顺序**（`check_entry_domains` 按它遍历），
 * 所以这里的字面量顺序与 `forge/domain.py` 一字不差地保持一致。
 */
import { err, info, warn, pyRepr } from './model.mjs'

/**
 * 一个字段的合法值域。
 * @typedef {{values: string[], default: string, legacy?: Record<string,string>,
 *            unknownTo?: string|null, note?: string}} Domain
 */

/** @type {Record<string, Domain>} */
export const DOMAINS = {
  trigger_mode: {
    values: ['always', 'agent_tool'],
    default: 'always',
    legacy: {},
    unknownTo: null,
    note: 'always = 提示词常驻；agent_tool = 由 AI 读取。缺省 always。',
  },
  agent_read_strategy: {
    values: ['required', 'keyword', 'normal'],
    default: 'normal',
    legacy: { variable_condition: 'normal' },
    unknownTo: null,
    note: 'required=必读 / keyword=命中后本轮必读 / normal=选读。' +
      '旧值 variable_condition 会被显式降级为 normal（源码 normalizeEntry 原文）。',
  },
  kind: {
    values: ['normal', 'opening', 'history_compaction', 'hidden_tool_timeline'],
    default: 'normal',
    legacy: {},
    unknownTo: null,
    note: '条目类型。缺省 normal。',
  },
  dynamic_mode: {
    values: ['standard', 'ejs_reference'],
    default: 'standard',
    legacy: { ejs_controller: 'standard', single_condition: 'standard' },
    unknownTo: 'standard',
    note: 'ejs_controller 会被显式降级；single_condition 全 asar 0 次，平台不认识。',
  },
  content_mode: {
    values: ['plain_text', 'ejs'],
    default: 'plain_text',
    legacy: {},
    unknownTo: null,
    note: '正文解释方式。缺省 plain_text。字段通常不写。',
  },
  keyword_condition: {
    values: ['none', 'any', 'all', 'not_any'],
    default: 'none',
    legacy: {},
    unknownTo: null,
    note: '多关键词之间的逻辑。空串按 none 处理，无害。',
  },
  insert_role: {
    values: ['system', 'user', 'assistant'],
    default: 'user',
    legacy: {},
    unknownTo: null,
    note: '正文以谁的口气插入。',
  },
}

// 「插入位置」（条目字段 position）**故意不进 DOMAINS**：
//   卡里可以在 library.prompt_positions 里自定义位置 id，一旦进了值域表，
//   那些自定义 id 就会被当成「不合法」报出来 —— 宁可少报也不误报。
export const POSITION_NOTE = [
  '插入位置（条目字段 position）：',
  '      留空 ""          不占系统提示词位 —— 关键词命中、或由 AI 选读时才插入（世界书 / 参考类）',
  '      "instructions"  并入系统提示词区 —— 每轮都在（常驻 / 必读类条目用它）',
  '      卡里在 library.prompt_positions 自定义的位置，也可以写那个位置的 id（本工具不校验）。',
]

/** 平台读都不读的字段：留着只是死重量，且会让后来人误以为生效。 */
export const DEAD_FIELDS = {
  agent_read_condition: '全 asar 出现 0 次 —— ElecKoi 根本不读它。' +
    '它承载的「变量条件加载」意图在 ElecKoi 里不生效。',
}

/** 空串按缺省处理的字段（写了也不报错，但值是无意义的）。 */
export const EMPTY_IS_DEFAULT = ['keyword_condition']

const 是字符串 = (v) => typeof v === 'string'

/**
 * 检查一条条目的值域。**只在字段「存在」时校验**（缺省不写是合法的）。
 *
 * @param {Record<string, unknown>} entry
 * @param {string} where
 * @returns {import('./model.mjs').Issue[]}
 */
export function checkEntryDomains(entry, where) {
  const out = []

  for (const [field, dom] of Object.entries(DOMAINS)) {
    if (!(field in entry)) continue
    const raw = entry[field]
    if (raw === null || raw === undefined) continue
    if (!是字符串(raw)) {
      out.push(warn(
        'DOMAIN-TYPE', where,
        `字段 ${field} 的值不是字符串（${pyRepr(raw)}）`,
        `改成字符串 ${pyRepr(dom.default)}。`,
      ))
      continue
    }

    const value = raw.trim()

    if (value === '') {
      if (EMPTY_IS_DEFAULT.includes(field)) {
        out.push(info(
          'DOMAIN-EMPTY', where,
          `${field} 是空串，平台按缺省 ${pyRepr(dom.default)} 处理`,
          `可以留着，也可以显式写成 ${pyRepr(dom.default)}。`,
        ))
      } else if (dom.default) {
        out.push(warn(
          'DOMAIN-EMPTY', where,
          `${field} 是空串，会被当成缺省 ${pyRepr(dom.default)}`,
          `显式写成 ${pyRepr(dom.default)} 更清楚。`,
        ))
      }
      continue
    }

    if (dom.values.includes(value)) continue

    // 不合法 —— 分「已知旧值」与「彻底不认识」两种
    if (Object.prototype.hasOwnProperty.call(dom.legacy ?? {}, value)) {
      const target = dom.legacy[value]
      // ★ 注意 Python 那边的优先级：`("长文案" % target) if 条件 else ("改成 %r。" % target)`
      const fix = field === 'agent_read_strategy'
        ? `改成 ${pyRepr(target)}；若原意是「满足变量条件才加载」，ElecKoi 没有这个策略，` +
          '改用 keyword 关键词，或把该条改成 agent_tool + normal 由 AI 选读。'
        : `改成 ${pyRepr(target)}。`
      out.push(err(
        'DOMAIN-LEGACY', where,
        `${field} = ${pyRepr(value)} 是平台已知的旧值，会被静默降级为 ${pyRepr(target)}（意图丢失）`,
        fix,
      ))
    } else if (dom.unknownTo) {
      out.push(err(
        'DOMAIN-UNKNOWN', where,
        `${field} = ${pyRepr(value)} 不被平台识别，会被降级为 ${pyRepr(dom.unknownTo)}`,
        `改成 ${pyRepr(dom.unknownTo)}。`,
      ))
    } else {
      out.push(err(
        'DOMAIN-UNKNOWN', where,
        `${field} = ${pyRepr(value)} 不在合法值域内`,
        `合法值：${dom.values.join(' / ')}。`,
      ))
    }
  }

  for (const [field, why] of Object.entries(DEAD_FIELDS)) {
    if (entry[field]) {
      out.push(info(
        'DOMAIN-DEAD', where,
        `字段 ${field} 平台不读：${why}`,
        '删掉它，或改成平台认的策略（见 agent_read_strategy 的值域）。',
      ))
    }
  }

  return out
}

/** 生成一张给人看的值域表（进手册）。 */
export function domainTableMarkdown() {
  const lines = [
    '| 字段 | 合法值 | 缺省 | 旧值会怎样 |',
    '|---|---|---|---|',
  ]
  for (const [name, dom] of Object.entries(DOMAINS)) {
    const legacy = Object.entries(dom.legacy ?? {})
      .map(([k, v]) => `${k}→${v}`).join('、') || '—'
    lines.push(`| \`${name}\` | ${dom.values.map((v) => `\`${v}\``).join(' / ')} ` +
      `| \`${dom.default}\` | ${legacy} |`)
  }
  return lines.join('\n')
}
