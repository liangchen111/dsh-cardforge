/**
 * 本地桩件：替掉官方 `@deepseek-ai/schemastery`。
 *
 * 只需要它做一件事：`Config({})` 能吐出各字段的默认值（够驱动插件本体）。
 */
const 造 = (类型) => {
  const 模式 = { __类型: 类型 }
  模式.default = function (值) {
    this.__默认 = 值
    return this
  }
  return 模式
}

const z = {
  string: () => 造('string'),
  number: () => 造('number'),
  integer: () => 造('integer'),
  boolean: () => 造('boolean'),
  object: (字段) => {
    const 校验 = (输入 = {}) => {
      const 出 = {}
      for (const [键, 模式] of Object.entries(字段)) {
        const 给 = 输入?.[键]
        出[键] = 给 === undefined ? 模式?.__默认 : 给
      }
      return 出
    }
    校验.__字段 = 字段
    return 校验
  },
}

export default z
