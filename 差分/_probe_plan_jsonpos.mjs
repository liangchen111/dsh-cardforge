// 同 `_probe_plan_jsonpos.py` 的样本跑的 Node 侧：把 `JSON.parse` 的原文与
// 「位置 → 行/列」的候选算法一并打出，供与 CPython 真值对读。
import { readFileSync } from 'node:fs'

const 样本 = [
  ['坏.json（语料同源）', '{\n  "format": "eleckoi.character-card",\n  "version": 1,\n  "character": {\n}\n'],
  ['缺逗号·行中', '{\n  "a": 1\n  "b": 2\n}\n'],
  ['缺冒号', '{"a" 1}'],
  ['多余数据', '{}x'],
  ['数组缺逗号', '[1 2]'],
  ['空串', ''],
  ['全空白', '   '],
  ['单词', 'nope'],
  ['尾逗号', '{"a": 1,}'],
  ['未闭合串', '"abc'],
  ['末行无换行', '{\n  "a": 1\n  "b": 2\n}'],
  ['两行空', '{\n\n}\n'],
]

const 出 = []
for (const [名, 文] of 样本) {
  let 错 = null
  try {
    JSON.parse(文)
  } catch (e) {
    错 = { 原文: e.message }
  }
  出.push({ 名, 原文: 文, 错 })
}
process.stdout.write(JSON.stringify(出, null, 2) + '\n')
