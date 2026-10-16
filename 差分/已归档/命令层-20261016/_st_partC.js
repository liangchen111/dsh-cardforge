  // 22. 分发往返：打包 -> 收包 -> 语义一致；恶意包必须整包拒收
  try {
    const pack_zip = BUNDLE.run(proj, _join(tmp, '自检卡.工程包.zip'), false, () => {})
    const got = DIST.import_pack(pack_zip, _join(tmp, '收到的'), false, true, () => {})
    const man = DIST.read_manifest(pack_zip)
    const back_spec = _join(got, 'source', '自检卡.spec.yaml')
    const same = _是文件(back_spec) && _canon_pair(M.yload(spec), M.yload(back_spec))

    const evil = _join(tmp, '恶意包.zip')
    BUNDLE._写zip(evil, [
      { 名: '卡/../../forge_逃逸自检.txt', 数据: 'x' },
      { 名: '卡/source/x.spec.yaml', 数据: 'x' },
    ])
    let refused = false
    try {
      DIST.import_pack(evil, tmp, false, true, () => {})
    } catch (e) {
      if (e instanceof DIST.DistError) refused = true
      else throw e
    }
    const escaped = _存在(_join(tmp, '..', 'forge_逃逸自检.txt'))

    if (pyTruthy(man) && same && refused && !escaped) {
      _print('  22 分发往返        ✔ 包 ' + Object.keys(man['清单'] || {}).length + ' 条清单 · 收回来语义一致 · 恶意包被拒')
    } else {
      ok = false
      _print('  22 分发往返        ✗ 清单=' + _T(pyTruthy(man)) + ' 语义一致=' + _T(same) +
        ' 拒恶意=' + _T(refused) + ' 未逃逸=' + _T(!escaped))
    }
  } catch (exc) {
    ok = false
    _print('  22 分发往返        ✗ ' + _errMsg(exc))
  }

  // 23. 皮肤出入：卡上那份配色导得出去、回得来；坏槽必须当场停
  try {
    THEME.apply_theme('朱砂', proj, () => {})
    const exp = THEME.export_theme(proj, _join(tmp, '自检皮肤.json'), '自检皮肤', () => {})
    THEME.clear_theme(proj, () => {})
    const cleared = THEME.current(proj).startsWith('核心默认')
    THEME.import_theme(exp, proj, false, () => {})
    const css = _读文本(_join(proj, 'hud', '主题.css'))
    const back_ok = css.includes('--hud-accent') && THEME.current(proj) === '自检皮肤'

    const bad = _join(tmp, '坏皮肤.json')
    writeFileSync(bad, _json紧凑({ 名: '坏', 变量: { '--hud-没有这个槽': '#fff' } }, true), 'utf8')
    let stopped = false
    try {
      THEME.import_theme(bad, proj, false, () => {})
    } catch (e) {
      if (e instanceof THEME.ThemeError) stopped = true
      else throw e
    }

    if (back_ok && cleared && stopped) {
      _print('  23 皮肤出入        ✔ 导出/导入往返一致 · 撤得干净 · 坏槽被拦')
    } else {
      ok = false
      _print('  23 皮肤出入        ✗ 往返=' + _T(back_ok) + ' 撤回=' + _T(cleared) +
        ' 坏槽被拦=' + _T(stopped))
    }
  } catch (exc) {
    ok = false
    _print('  23 皮肤出入        ✗ ' + _errMsg(exc))
  }

  // 24. Zod 保形：解析 -> 生成 -> 再解析必须一致，手写的约束不许被抹掉；
  //     认不出的形状必须当场拒绝（负向）
  try {
    const code = ((M.yload(spec).variables || {}).schema_code) || ''
    const once = ZOD.emit(ZOD.parse(code))
    const 稳 = ZOD.roundtrip_ok(code) && once === ZOD.emit(ZOD.parse(once))
    const 保住 = once.includes('z.number().int().min(1).max(20)')   // 手写的约束
    let 拦住 = 0
    for (const bad of ['z.string()',                                 // 顶层不是 object
      'z.object({ a: z.string() }).passthrough()',                   // 后面带后缀
      'z.object({ a b })']) {                                        // 切错了（缺冒号）
      try {
        ZOD.parse(bad)
      } catch (e) {
        if (e instanceof ZOD.ZodError) 拦住 += 1
        else throw e
      }
    }
    if (稳 && 保住 && 拦住 === 3) {
      _print('  24 Zod 保形        ✔ 往返一致 · 手写的 .min().max() 保住 · 三种怪形状被拒')
    } else {
      ok = false
      _print('  24 Zod 保形        ✗ 稳定=' + _T(稳) + ' 约束保住=' + _T(保住) + ' 拒了 ' + 拦住 + '/3')
    }
  } catch (exc) {
    ok = false
    _print('  24 Zod 保形        ✗ ' + _errMsg(exc))
  }

  // 25. 内容增删：条目 / 分组 / 对象 / 变量 / 正则 加得上、删得进回收站、
  //     放回去能回到原样；错模板、错分组、重名都要被拦（负向）
  try {
    const _P = () => {}
    // 数「这一项自己新增了几条记录」而不是总数 —— 同一份 spec 上前面几项
    // （比如前面几项）也会留下记录，总数不该由这一项来断言。
    const 起始回收 = CONTENT.list_trash(spec).length
    const 前 = CONTENT.stats(spec)
    CONTENT.add_group(spec, '自检组', '', _P)
    const e = CONTENT.add_entry(spec, '自检 · 新条目', '自检组', '关键词', '占位', ['自检'], null, null, _P)
    CONTENT.add_object(spec, '自检对象', '', '', '', _P)
    const v = CONTENT.add_variable(spec, '自检对象', '计数', 'number', 7, '', '', _P)
    const r = CONTENT.add_regex(spec, '自检正则', '/〔自检〕/g', '<b>$1</b>', null, null, true, _P)
    const 加完 = CONTENT.stats(spec)
    const 加齐 = (加完['条目'] === 前['条目'] + 1 && 加完['分组'] === 前['分组'] + 1 &&
      加完['对象'] === 前['对象'] + 1 && 加完['变量'] === 前['变量'] + 1 &&
      加完['正则'] === 前['正则'] + 1)

    let 拦 = 0
    for (const fn of [() => CONTENT.add_entry(spec, '没关键词', '', '关键词', '', null, null, null, _P),
      () => CONTENT.add_entry(spec, '错组', '没这个组', '常驻', '', null, null, null, _P),
      () => CONTENT.add_entry(spec, '错模板', '', '乱写', '', null, null, null, _P),
      () => CONTENT.add_group(spec, '自检组', '', _P)]) {
      try {
        fn()
      } catch (e2) {
        if (e2 instanceof CONTENT.ContentError) 拦 += 1
        else throw e2
      }
    }

    CONTENT.del_entry(spec, e['id'], _P)
    CONTENT.del_variable(spec, v['id'], _P)
    CONTENT.del_regex(spec, r['id'], _P)
    CONTENT.del_object(spec, '自检对象', _P)
    CONTENT.del_group(spec, '自检组', _P)
    const 撤完 = CONTENT.stats(spec)
    const 回收站 = CONTENT.list_trash(spec).length - 起始回收

    for (const rec of CONTENT.list_trash(spec)) {        // 逐条放回去
      CONTENT.restore(spec, rec['_文件'], _P)
    }
    const 回来 = CONTENT.stats(spec)
    const 还原齐 = _canon(回来) === _canon(加完)
    const 条目回 = CONTENT.list_entries(spec).some((x) => x['id'] === e['id'])

    if (加齐 && _canon(撤完) === _canon(前) && 回收站 === 5 && 还原齐 && 条目回 && 拦 === 4) {
      _print('  25 内容增删        ✔ 五种都能加 · 撤完回到原样 · 五条记录放回去一字不差 · 四种错被拦')
    } else {
      ok = false
      _print('  25 内容增删        ✗ 加齐=' + _T(加齐) + ' 撤净=' + _T(_canon(撤完) === _canon(前)) +
        ' 回收站=' + 回收站 + ' 还原=' + _T(还原齐) + ' 错被拦=' + 拦 + '/4')
    }
  } catch (exc) {
    ok = false
    _print('  25 内容增删        ✗ ' + _errMsg(exc))
  }

  // 26. 变量三处同步：加一个变量三处一次写全、删一个三处一起撤；
  //     对象表与初值形状对不上时必须拒写，且 spec 一个字不动（负向）
  try {
    const _P = () => {}
    const vv = CONTENT.add_variable(spec, '玩家', '自检值', 'number', 5, '', '', _P)
    let raw = CONTENT.load(spec)
    let v = raw['variables']
    let z = ZOD.parse(v['schema_code'])
    const 齐 = (((v['initial_state']['玩家'] || {})['自检值']) === 5 &&
      (z.kids['玩家'] instanceof ZOD.Obj) &&
      (z.kids['玩家'].kids['自检值'] !== undefined && z.kids['玩家'].kids['自检值'] !== null) &&
      v['variables'].some((x) => x['id'] === vv['id']))
    CONTENT.del_variable(spec, vv['id'], _P)
    raw = CONTENT.load(spec)
    v = raw['variables']
    z = ZOD.parse(v['schema_code'])
    const 净 = (!('自检值' in (v['initial_state']['玩家'] || {})) &&
      !('自检值' in z.kids['玩家'].kids))

    // 造一个「列表对象」：对象挂在别人下面、名字和它唯一的变量同名、初值那边是平的
    raw = CONTENT.load(spec)
    v = raw['variables']
    v['objects'].push(M.ordered({
      id: 'obj-check-bag', name: '自检夹',
      parent_id: 'obj-player', enabled: true,
      description: '', update_rule: '',
      dynamic_key: false, order: 99,
      tree_view_order: 99,
      created_at: M.nowIso(),
      updated_at: M.nowIso(),
    }, M.VAR_OBJECT_KEYS))
    v['variables'].push(M.ordered({
      id: 'variable-check-bag', title: '自检夹',
      object_id: 'obj-check-bag', enabled: true,
      type: 'array', default_value: '[]',
      description: '', update_rule: '',
      read_mode: 'on_demand', order: 99,
      tree_view_order: 99,
      created_at: M.nowIso(),
      updated_at: M.nowIso(),
    }, M.VAR_ITEM_KEYS))
    v['initial_state']['玩家']['自检夹'] = []
    M.jdump(raw, spec)
    const 前文 = _读文本(spec)
    let 拒 = false
    try {
      CONTENT.add_variable(spec, '自检夹', '重量', 'number', 1, '', '', _P)
    } catch (e2) {
      if (e2 instanceof CONTENT.ContentError) 拒 = true
      else throw e2
    }
    const 没动 = _读文本(spec) === 前文
    // 形状不一致时，删那一条仍要认得准（靠「存不存在」认位置）
    CONTENT.del_variable(spec, '自检夹', _P)
    raw = CONTENT.load(spec)
    const 删净 = (!('自检夹' in (raw['variables']['initial_state']['玩家'] || {})) &&
      !('自检夹' in ZOD.parse(raw['variables']['schema_code']).kids['玩家'].kids))

    if (齐 && 净 && 拒 && 没动 && 删净) {
      _print('  26 变量三处同步    ✔ 加一个三处齐 · 删一个三处净 · 形状对不上时拒写且一字不动')
    } else {
      ok = false
      _print('  26 变量三处同步    ✗ 加齐=' + _T(齐) + ' 删净=' + _T(净) + ' 拒写=' + _T(拒) +
        ' 没动=' + _T(没动) + ' 删准=' + _T(删净))
    }
  } catch (exc) {
    ok = false
    _print('  26 变量三处同步    ✗ ' + _errMsg(exc))
  }
