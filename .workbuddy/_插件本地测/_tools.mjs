/**
 * 本地桩件：替掉官方 `@deepseek-ai/dsh-tools`。
 *
 * `defineTool` 在真身里会做两件事：编译参数 DSL → JSON Schema、校验执行前后。
 * 桩件只做「编译参数」这一半（够让冒烟脚本看到与生产同形的 `parameters`），
 * 不做校验 —— 校验是官方代码的事，这里不重造。
 */
const 编译参数 = (规格 = {}) => {
  const properties = {}
  const required = []
  for (const [键, 节点] of Object.entries(规格)) {
    const 副本 = { ...节点 }
    if (副本.required === true) required.push(键)
    delete 副本.required
    properties[键] = 副本
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

export const defineTool = (定义) => ({ ...定义, parameters: 编译参数(定义.parameters) })
