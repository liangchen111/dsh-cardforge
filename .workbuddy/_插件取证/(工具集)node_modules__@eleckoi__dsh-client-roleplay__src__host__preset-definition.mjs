import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const resolveRuntimeModule = createRequire(import.meta.url).resolve

const PRODUCT_PLUGIN_FILES = new Map([
  ['uploaded-file-tools', 'uploaded-file-tools.mjs'],
  ['variable-tools', 'variable-tools.mjs'],
  ['setting-library-tools', 'setting-library-tools.mjs'],
  ['roleplay-plan-tool', 'roleplay-plan-tool.mjs']
])

const productSpecifier = (id) => `eleckoi:agent-preset/${id}`

export const durableProductPluginSpecifier = productSpecifier

export function runtimePresetDefinition(definition, templatePath) {
  return {
    ...definition,
    plugins: Array.isArray(definition.plugins)
      ? definition.plugins.map((plugin) => resolveRuntimePlugin(plugin, templatePath))
      : definition.plugins
  }
}

export function readRuntimePresetDefinition(path, id, templatePath) {
  const source = readFileSync(path, 'utf8')
  const parsed = JSON.parse(source)
  if (parsed?.id !== id || !Array.isArray(parsed.plugins)) {
    throw new Error(`ElecKoi Agent preset ${id} has an invalid composition`)
  }
  return runtimePresetDefinition(parsed, templatePath)
}

function resolveRuntimePlugin(plugin, templatePath) {
  if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) return plugin
  const productFile = PRODUCT_PLUGIN_FILES.get(plugin.id)
  let name = plugin.name
  if (typeof name === 'string' && name.startsWith('@deepseek-ai/')) {
    name = pathToFileURL(resolveRuntimeModule(name)).href
  } else if (productFile && name === productSpecifier(plugin.id)) {
    if (!templatePath) throw new Error(`ElecKoi Agent preset ${plugin.id} is missing its runtime template path`)
    name = pathToFileURL(join(dirname(templatePath), '..', productFile)).href
  }
  return {
    ...plugin,
    name,
    ...(Array.isArray(plugin.config)
      ? { config: plugin.config.map((item) => resolveRuntimePlugin(item, templatePath)) }
      : {})
  }
}
