  // 11. 酒馆 V2 卡 -> ElecKoi
  const st_path = _join(tmp, 'st.json')
  writeFileSync(st_path, _json紧凑({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: '自检酒馆卡',
      description: '这是一张自检用的酒馆卡。',
      first_mes: '你好。',
      alternate_greetings: ['另一个开场。'],
      tags: ['自检'],
      character_book: {
        entries: [
          {
            name: '条目一', keys: ['测试'], content: '关键词条目。',
            constant: false, enabled: true, insertion_order: 1,
          },
          {
            name: '条目二', keys: [], content: '常驻条目。',
            constant: true, enabled: true, insertion_order: 2,
          },
        ],
      },
    },
  }), 'utf8')
  try {
    const sp3 = _join(tmp, 'st.spec.yaml')
    bridge.to_eleckoi(st_path, sp3, () => {})
    const errs3 = validate.validate_card(pack.spec_to_card(sp3), '自检酒馆卡').filter((i) => i.level === 'ERROR')
    if (!errs3.length) {
      _print('  11 酒馆卡转换      ✔ 酒馆 V2 -> ElecKoi，0 错误')
    } else {
      ok = false
      _print('  11 酒馆卡转换      ✗ ' + errs3.length + ' 个错误')
    }
  } catch (exc) {
    ok = false
    _print('  11 酒馆卡转换      ✗ ' + _errMsg(exc))
  }

  // 12. ElecKoi -> 酒馆 -> ElecKoi（无损往返）
  try {
    const back = _join(tmp, 'back.json')
    exportMod.to_tavern(card_path, back, () => {})
    const sp4 = _join(tmp, 'back.spec.yaml')
    bridge.to_eleckoi(back, sp4, () => {})
    const card4 = pack.spec_to_card(sp4)
    if (_canon_pair(card2, card4)) {
      _print('  12 往返无损        ✔ ElecKoi -> 酒馆 -> ElecKoi，语义不变')
    } else {
      ok = false
      _print('  12 往返无损        ✗ 转一圈之后语义变了')
    }
  } catch (exc) {
    ok = false
    _print('  12 往返无损        ✗ ' + _errMsg(exc))
  }

  // 13. 界面层：组装真的产出了东西，且守规矩
  try {
    const prev = _join(proj, '预览.html')
    const raw3 = M.yload(spec)
    const n_re3 = (raw3.regex_rules || []).length
    const hud_errs = validate.validate_hud(proj).filter((i) => i.level === 'ERROR')
    if (_是文件(prev) && n_re3 >= 2 && !hud_errs.length) {
      _print('  13 界面组装        ✔ 预览.html ' + Math.floor(_大小(prev) / 1024) + ' KB · 写回 ' +
        n_re3 + ' 条正则 · 界面守则 0 错')
    } else {
      ok = false
      _print('  13 界面组装        ✗ 预览页=' + _T(_是文件(prev)) + ' 正则=' + n_re3 +
        ' 守则错=' + hud_errs.length)
    }
  } catch (exc) {
    ok = false
    _print('  13 界面组装        ✗ ' + _errMsg(exc))
  }

  // 14. 界面守则（负向）：模块 CSS 漏了 .hud 前缀，必须被拦下
  try {
    const proj2b = _join(tmp, '模块卡')
    const css = _join(proj2b, 'hud', '模块', '备份', '备份.css')
    const text = _读文本(css)
    writeFileSync(css, text + '\nbody { color: red; }\n.mine-x { color: blue; }\n', 'utf8')
    const caught14 = validate.validate_hud(proj2b).filter((i) => i.code === 'HUD-CSS-PREFIX')
    if (caught14.length) {
      _print('  14 界面守则        ✔ 拦下了模块 CSS 里 ' + caught14.length + ' 处漏前缀的选择器')
    } else {
      ok = false
      _print('  14 界面守则        ✗ 没拦下漏前缀的裸选择器')
    }
  } catch (exc) {
    ok = false
    _print('  14 界面守则        ✗ ' + _errMsg(exc))
  }

  // 15. 变量三处同步（负向）：initial_state 少一个对象，必须被拦下
  try {
    const raw5 = M.yload(spec)
    delete raw5.variables.initial_state['存档']
    const bad5 = _join(tmp, '同步.spec.yaml')
    M.jdump(raw5, bad5)
    const caught15 = validate.validate_card(pack.spec_to_card(bad5), '同步样本')
      .filter((i) => i.code.startsWith('VAR-SYNC'))
    if (caught15.length) {
      _print('  15 变量三处同步    ✔ 拦下了「initial_state 少一个对象」（' + caught15.length + ' 处）')
    } else {
      ok = false
      _print('  15 变量三处同步    ✗ 没拦下变量不同步')
    }
  } catch (exc) {
    ok = false
    _print('  15 变量三处同步    ✗ ' + _errMsg(exc))
  }

  // 16. 打包分发
  try {
    const z = BUNDLE.run(_join(tmp, '模块卡'), _join(tmp, '包.zip'), false, () => {})
    const names = _zip列名(z)
    const has = ['spec.yaml', 'hud.core.js', 'test_core.js', '.card.json']
      .every((s) => names.some((n) => n.endsWith(s)))
    if (has && names.length >= 8) {
      _print('  16 打包分发        ✔ ' + names.length + ' 个文件进包（含内容层 / 界面层 / 成品 / 测试）')
    } else {
      ok = false
      _print('  16 打包分发        ✗ 包里少了东西（' + names.length + ' 个文件）')
    }
  } catch (exc) {
    ok = false
    _print('  16 打包分发        ✗ ' + _errMsg(exc))
  }

  // 17. 撤模块：接上再撤，必须回到没接过的那一份（账本清空、界面目录删掉）
  let proj3 = null
  let spec3 = null
  let before17 = null
  try {
    proj3 = scaffold.new_card('撤模块卡', tmp, null, true)
    spec3 = _join(proj3, 'source', '撤模块卡.spec.yaml')
    before17 = _fresh_snapshot(spec3)
    mods.apply_modules(spec3, ['骰子', '备份'], proj3, () => {})
    const mid = _fresh_snapshot(spec3)
    // 撤之前先组装一次，让模块的脚本落进 hud/模块/
    HUD.build(proj3, true, () => {})
    mods.drop_modules(spec3, ['骰子', '备份'], proj3, () => {})
    const after = _fresh_snapshot(spec3)
    const led = mods.load_ledger(proj3)['模块'] || {}
    const hud_gone = !_是目录(_join(proj3, 'hud', '模块', '备份'))
    if (_canon(mid) !== _canon(before17) && _canon(after) === _canon(before17) &&
        !Object.keys(led).length && hud_gone) {
      _print('  17 撤模块          ✔ 接上（' + before17['条目'] + ' -> ' + mid['条目'] + ' 条）再撤，回到原样；账本清空')
    } else {
      ok = false
      _print('  17 撤模块          ✗ 接=' + _T(_canon(mid) !== _canon(before17)) + ' 撤=' +
        _T(_canon(after) === _canon(before17)) + ' 原样=' + pyRepr(before17) + ' 账本=' +
        Object.keys(led).length + ' 界面残留=' + _T(!hud_gone))
    }
  } catch (exc) {
    ok = false
    _print('  17 撤模块          ✗ ' + _errMsg(exc))
  }

  // 18. 换皮肤：只动颜色槽，核心样式一个字不动
  try {
    const theme_pick = '墨夜'
    // 比对的是「这个工程」的核心样式前后 —— 不是跟骨架比：
    // 建卡时会做一轮换名（骨架 -> 卡名），抄过来的 hud.css 本来就有一处不同。
    const core_path = _join(proj3, 'hud', 'hud.css')
    const before_core = _读文本(core_path)
    THEME.apply_theme(theme_pick, proj3, () => {})
    HUD.build(proj3, true, () => {})
    const core_after = _读文本(core_path)
    const css_path = _join(proj3, 'hud', '主题.css')
    const doc = _读文本(_join(proj3, 'hud', 'out', 'view_create.html'))
    const page = _读文本(_join(proj3, '预览.html'))
    const slot_ok = doc.includes('--hud-ink: #e6dccb')       // 主题真的注进去了
    const core_same = core_after === before_core             // 核心没被改
    const page_ok = page.includes('#0b0a08')                 // 预览页外壳也跟着换
    if (_是文件(css_path) && slot_ok && core_same && page_ok) {
      _print('  18 换皮肤          ✔ ' + theme_pick + '：槽进页面 · 核心样式未改 · 预览页跟着换')
    } else {
      ok = false
      _print('  18 换皮肤          ✗ 主题文件=' + _T(_是文件(css_path)) + ' 注入=' + _T(slot_ok) +
        ' 核心未改=' + _T(core_same) + ' 预览=' + _T(page_ok))
    }
  } catch (exc) {
    ok = false
    _print('  18 换皮肤          ✗ ' + _errMsg(exc))
  }

  // 19. 主题写错槽（负向）：核心不认识的槽必须当场停，不许静默不生效
  try {
    let caught19 = false
    try {
      THEME.render_css({ 名: '坏主题', 变量: { '--hud-不存在的槽': '#fff' } })
    } catch (e) {
      if (e instanceof THEME.ThemeError) caught19 = true
      else throw e
    }
    if (caught19) {
      _print('  19 主题护栏        ✔ 拦下了核心不认识的槽（那种错会静默不生效）')
    } else {
      ok = false
      _print('  19 主题护栏        ✗ 没拦下写错的槽')
    }
  } catch (exc) {
    ok = false
    _print('  19 主题护栏        ✗ ' + _errMsg(exc))
  }

  // 20. 可读性体检（负向）：浅灰字压浅底，必须被判成「看不清」
  try {
    const bad_theme = {
      名: '雾里看花',
      变量: {
        '--hud-ink': '#c9c5bd', '--hud-ink-2': '#d5d1c9',
        '--hud-dim': '#dedbd4', '--hud-paper-solid': 'rgba(250, 248, 242, 0.93)',
      },
    }
    const rep = THEME.contrast_report(bad_theme)
    const poor = Object.entries(rep).filter(([, v]) => !v['够'])
    const good = Object.values(THEME.contrast_report(THEME.find_theme('羊皮卷'))).every((v) => v['够'])
    if (poor.length === 3 && good) {
      _print('  20 可读性体检      ✔ 浅灰压浅底被判成看不清；自带五套全部达标')
    } else {
      ok = false
      _print('  20 可读性体检      ✗ 判出 ' + poor.length + ' 处不达标 / 自带主题达标=' + _T(good))
    }
  } catch (exc) {
    ok = false
    _print('  20 可读性体检      ✗ ' + _errMsg(exc))
  }
