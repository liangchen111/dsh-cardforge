// ---……--- 自检 ------------------------------------------------------------------
// `forge.py:950-2467` 的 `cmd_selftest` 逐字节移植（四十二项；编号 21 / 39 / 40 已迁出）。
// 移植记号：`tempfile.mkdtemp` → `mkdtempSync`；`M.ydump` 在 JS 侧明确抛错 ⇒ 一律改走
// `M.jdump`（路径与后缀不变，差分按结构相等比）；`os.path.relpath` → `BUNDLE._relpath`；
// `%s % exc` → `_errMsg(exc)`（Python 的 `str(exc)` 不带 `Error: ` 前缀）。
export function cmd_selftest(argv) {
  // 自检：骨架 -> 卡 -> 解包 -> 再打包，比对语义是否一致；顺带跑校验。
  // 自检是**在普通文件系统上考工具自己** —— 有几项靠「删文件 / 改名」摆场景，
  // 沙箱模式下它们会假报错。所以这里把沙箱模式关掉（第 42 项自己会临时打开再关）。
  if (SB.enabled()) {
    _print('（沙箱友好模式已临时关掉 —— 自检要在能删能改名的文件系统上跑）')
    SB.enable(false)
  }
  let ok = true
  const tmp = mkdtempSync(_join(tmpdir(), 'forge_selftest_'))

  _print('='.repeat(74))
  _print('forge 自检（四十二项；编号 21 / 39 / 40 原为图形工作台，已迁出 → 弃用/工作台/）')
  _print('='.repeat(74))

  // 1. 开新卡
  let proj = null
  let spec = null
  try {
    proj = scaffold.new_card('自检卡', tmp, null, true)
    spec = _join(proj, 'source', '自检卡.spec.yaml')
    _print('  1 开新卡          ✔ ' + BUNDLE._relpath(spec, tmp))
  } catch (exc) {
    _print('  1 开新卡          ✗ ' + _errMsg(exc))
    return 1
  }

  // 2. 校验 spec
  const card1 = pack.spec_to_card(spec)
  const issues = validate.validate_card(card1, '骨架')
  const errs = issues.filter((i) => i.level === 'ERROR')
  if (errs.length) {
    ok = false
    _print('  2 骨架校验        ✗ 有 ' + errs.length + ' 个错误（骨架不该有错）')
    for (const i of errs) _print(i.line())
  } else {
    _print('  2 骨架校验        ✔ 0 错误，' + issues.filter((i) => i.level === 'WARN').length + ' 警告')
  }

  // 3. 打包
  const card_path = _join(proj, '成品', '自检卡.card.json')
  pack.build(spec, card_path)
  const card2 = M.jload(card_path)
  _print('  3 打包            ✔ ' + BUNDLE._relpath(card_path, tmp))

  // 4. 解包
  const round_spec = _join(tmp, 'round.spec.yaml')
  pack.unpack(card_path, round_spec)
  _print('  4 解包            ✔ ' + _basename(round_spec))

  // 5. 往返语义一致
  const card3 = pack.spec_to_card(round_spec)
  if (_canon_pair(card2, card3)) {
    _print('  5 往返一致        ✔ 卡 -> spec -> 卡，语义不变')
  } else {
    ok = false
    _print('  5 往返一致        ✗ 往返后语义变了')
  }

  // 6. 值域拦截（负向验：故意写一个会被静默降级的旧值）
  const bad = M.jload(card_path)
  pack.mutate_active_library(bad, (lib) => {
    lib.entries[1].agent_read_strategy = 'variable_condition'
  })
  const intercepted = validate.validate_card(bad, '负向样本').filter((i) => i.code === 'DOMAIN-LEGACY')
  if (intercepted.length) {
    _print('  6 值域拦截        ✔ 拦下了 variable_condition（会被静默降级）')
  } else {
    ok = false
    _print('  6 值域拦截        ✗ 没拦下 variable_condition')
  }

  // 7. 常驻缺位置（负向）
  const bad2 = M.jload(card_path)
  pack.mutate_active_library(bad2, (lib) => {
    lib.entries[1].position = ''
  })
  const caught = validate.validate_card(bad2, '负向样本').filter((i) => i.code === 'CONST-NO-POSITION')
  if (caught.length) {
    _print('  7 常驻位置护栏    ✔ 拦下了「常驻但 position 为空」')
  } else {
    ok = false
    _print('  7 常驻位置护栏    ✗ 没拦下常驻缺位置')
  }

  // 8. 关键词空（负向）
  const bad3 = M.jload(card_path)
  const _blank_keywords = (lib) => {
    lib.entries[3].agent_read_strategy = 'keyword'
    lib.entries[3].keywords = []
  }
  pack.mutate_active_library(bad3, _blank_keywords)
  const caught3 = validate.validate_card(bad3, '负向样本').filter((i) => i.code === 'KEYWORD-EMPTY')
  if (caught3.length) {
    _print('  8 关键词护栏      ✔ 拦下了「keyword 策略但没关键词」')
  } else {
    ok = false
    _print('  8 关键词护栏      ✗ 没拦下空关键词')
  }

  // 9. 模块并入（骰子替换一条 + 并 7 条正则；备份底稿克隆一条）
  let spec2 = null
  try {
    const proj2 = scaffold.new_card('模块卡', tmp, null, true, ['骰子', '备份'])
    spec2 = _join(proj2, 'source', '模块卡.spec.yaml')
    const raw2 = M.yload(spec2)
    const n_ent = raw2.library.entries.length
    const n_re = (raw2.regex_rules || []).length
    const errs2 = validate.validate_card(pack.spec_to_card(spec2), '模块卡').filter((i) => i.level === 'ERROR')
    if (n_ent >= 5 && n_re >= 7 && !errs2.length) {
      _print('  9 模块并入        ✔ 骰子+备份 -> 条目 ' + n_ent + ' 条 / 正则 ' + n_re + ' 条 / 0 错误')
    } else {
      ok = false
      _print('  9 模块并入        ✗ 条目 ' + n_ent + ' / 正则 ' + n_re + ' / 错误 ' + errs2.length)
    }
  } catch (exc) {
    ok = false
    spec2 = null
    _print('  9 模块并入        ✗ ' + _errMsg(exc))
  }

  // 10. 手册与索引
  try {
    const html_path = _join(tmp, '手册.html')
    manual.build_manual(spec2 || spec, html_path, () => {})
    const text = _读文本(html_path)
    const paired = _数(text, '<details>') === _数(text, '</details>') &&
      _数(text, '<section') === _数(text, '</section>')
    const idx_path = manual.build_index(spec2 || spec, _join(tmp, '索引.md'), () => {})
    if (paired && _大小(idx_path) > 200) {
      _print('  10 手册与索引      ✔ 手册 ' + Math.floor(lenPy(text) / 1024) + ' KB（' +
        _数(text, '<details>') + ' 个条目块）+ 索引 ' + _大小(idx_path) + ' 字节')
    } else {
      ok = false
      _print('  10 手册与索引      ✗ 标签不配对或索引为空')
    }
  } catch (exc) {
    ok = false
    _print('  10 手册与索引      ✗ ' + _errMsg(exc))
  }
