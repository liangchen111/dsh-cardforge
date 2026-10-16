  // 41. 条目复制：一次能复制一串（副本**顺在原件后面** · 默认「原名（副本）」· 内容原样 ·
  //     id 全新）· `--到 分组` 能让副本直接落进那个组、不给就跟着原件 ·
  //     认不出的名字整批停下 · 开场白条目不许复制（一张卡只有一条）。
  try {
    const proj3 = _join(tmp, '改名台')
    const spec6 = _join(proj3, 'source', '改名台.spec.yaml')
    CONTENT.add_group(spec6, '复组', '', _P)
    for (const t of ['复一', '复二']) {
      CONTENT.add_entry(spec6, t, '', '关键词', '正文 ' + t, ['试'], null, null, _P)
    }
    const 底 = CONTENT.list_entries(spec6).length

    CONTENT.dup_entries(spec6, ['复一', '复二'], null, '复组', _P)
    const 列 = CONTENT.list_entries(spec6)
    const 名 = 列.map((r) => r['标题'])
    const 栏 = {}
    for (const r of 列) 栏[r['标题']] = r
    const 复制齐 = (列.length === 底 + 2 &&
      '复一（副本）' in 栏 && '复二（副本）' in 栏 &&
      栏['复一（副本）']['分组'] === '复组' &&
      栏['复二（副本）']['分组'] === '复组' &&
      名.indexOf('复一（副本）') === 名.indexOf('复一') + 1 &&
      名.indexOf('复二（副本）') === 名.indexOf('复二') + 1 &&
      栏['复一（副本）']['字数'] === 栏['复一']['字数'] &&
      new Set(列.map((r) => r['id'])).size === 列.length)

    // 不给 --到：副本跟着原件待在同一个组（原件在未分组，副本也在未分组）
    CONTENT.dup_entries(spec6, ['复一'], '复一·另一版', null, _P)
    const 栏2 = {}
    for (const r of CONTENT.list_entries(spec6)) 栏2[r['标题']] = r
    const 跟原件 = (栏2['复一·另一版']['分组'] === 栏2['复一']['分组'] &&
      栏2['复一']['分组'] !== '复组')

    // 认不出的名字：整批停下，一条副本都不加
    const 停 = CONTENT.list_entries(spec6).length
    let 整批停41 = false
    try {
      CONTENT.dup_entries(spec6, ['复一', '根本没有这条'], null, null, _P)
    } catch (e) {
      if (!(e instanceof CONTENT.ContentError)) throw e
      整批停41 = _errMsg(e).includes('根本没有这条')
    }
    const 没多 = CONTENT.list_entries(spec6).length === 停

    // 开场白不许复制
    let 拦开场 = false
    try {
      CONTENT.dup_entries(spec6, ['AI角色开场白'], null, null, _P)
    } catch (e) {
      if (!(e instanceof CONTENT.ContentError)) throw e
      拦开场 = _errMsg(e).includes('开场白')
    }

    const 条41 = [复制齐, 跟原件, 整批停41, 没多, 拦开场]
    if (条41.every(pyTruthy)) {
      _print('  41 条目复制       ✔ 一次复制一串（副本顺在原件后面 · 内容原样 · id 全新）' +
        '· --到 分组 能让副本落进那个组 · 认不出的名字整批停下 · 开场白不许复制')
    } else {
      ok = false
      _print('  41 条目复制       ✗ 复制齐=' + _T(复制齐) + ' 跟原件=' + _T(跟原件) +
        ' 整批停=' + _T(整批停41) + ' 没多=' + _T(没多) + ' 拦开场=' + _T(拦开场))
    }
  } catch (exc) {
    ok = false
    _print('  41 条目复制       ✗ ' + _errMsg(exc))
  }

  // 42. 沙箱友好模式：把 os.replace / os.remove / shutil.rmtree 全换成炸弹
  //     （模拟受限令牌沙箱里的 WinError 5），再把「开新卡 → 加条目 → 出成品 → 验卡」
  //     整条走一遍。**全程一次都不许碰到那三个** —— 碰到，就说明还有地方在依赖「删 / 改名」，
  //     而那条路（ElecKoi 里的 AI 直接跑 forge.py）会在那一步挂掉。
  //
  //  ★ 移植记号：Python 这里是把 `os.replace` / `os.remove` / `shutil.rmtree` 三个模块属性
  //  换成炸弹函数；JS 侧 ESM 的具名导入没法在外部替换，而**所有文件落盘在 JS 侧本来就
  //  统一走 `SB.land` / `SB.rename` / `SB.remove` / `SB.rmtree`** —— 沙箱模块本身就是那一层，
  //  所以这里只留 `SB.enable(true)`（打开后上面四个一律拒绝）。语义等价，少一层猴子补丁。
  try {
    const 沙箱根 = _join(tmp, '沙箱试')
    mkdirSync(沙箱根, { recursive: true })
    let 过沙箱 = false
    let 正文回 = ''
    let 沙箱错 = []
    SB.enable(true)
    try {
      const proj2 = scaffold.new_card('沙箱卡', 沙箱根, null, true)
      const spec2 = _join(proj2, 'source', '沙箱卡.spec.yaml')
      CONTENT.add_entry(spec2, '沙箱条目', '', '关键词', '沙箱里写下的正文', ['沙箱'], null, null, _P)
      const card2 = _join(proj2, '成品', '沙箱卡.card.json')
      pack.build(spec2, card2)
      沙箱错 = validate.validate_card(M.jload(card2), '沙箱').filter((i) => i['level'] === 'ERROR')
      正文回 = CONTENT.entry_detail(spec2, '沙箱条目')['正文']
      过沙箱 = (正文回 === '沙箱里写下的正文' && !沙箱错.length)
    } finally {
      SB.enable(false)
    }
    if (过沙箱) {
      _print('  42 沙箱友好模式    ✔ 不许删 / 不许改名时：开新卡 + 加条目 + 出成品' +
        ' 全程用不到 os.replace / os.remove / rmtree')
    } else {
      ok = false
      _print('  42 沙箱友好模式    ✗ 正文回读=' + pyRepr(正文回) + ' 卡片错误=' + 沙箱错.length)
    }
  } catch (exc) {
    ok = false
    _print('  42 沙箱友好模式    ✗ ' + _errMsg(exc))
  }

  // 43. 规程取节：目录里列出的**每一节 / 每一篇 / 每一对话段**都要能真取到、且不是空的。
  //     这是给 ElecKoi 里的 AI 自己取知识用的（`guide`）—— 目录说有的、取不到，
  //     AI 只会以为规程就这么多，然后照着半份知识做卡。**静默地少给**是最坏的一种错。
  //     负向两侧：认不出的名字要拦；撞名的（两篇同前缀）要报「不止一个」而不是挑一个。
  try {
    const 取错43 = []
    const 取空43 = []
    for (const [标题] of COACH._规程段()) {
      try {
        if (lenPy(COACH.取节(标题)) <= lenPy(标题)) 取空43.push('节 ' + 标题)
      } catch (e) {
        if (!(e instanceof COACH.KeyError)) throw e
        取错43.push('节 ' + 标题)
      }
    }
    for (const 标题 of Object.keys(COACH.方法论)) {
      try {
        if (lenPy(COACH.取篇(标题)) <= lenPy(标题)) 取空43.push('篇 ' + 标题)
      } catch (e) {
        if (!(e instanceof COACH.KeyError)) throw e
        取错43.push('篇 ' + 标题)
      }
    }
    for (const 标题 of Object.keys(COACH.对话段)) {
      try {
        if (lenPy(COACH.取对话(标题)) <= lenPy(标题)) 取空43.push('段 ' + 标题)
      } catch (e) {
        if (!(e instanceof COACH.KeyError)) throw e
        取错43.push('段 ' + 标题)
      }
    }
    let 拦了43 = 0
    for (const 怪名 of ['第四十节', '这一节不存在']) {
      try {
        COACH.取节(怪名)
      } catch (e) {
        if (!(e instanceof COACH.KeyError)) throw e
        拦了43 += 1
      }
    }
    try {
      COACH.取篇('机制')            // 方法论里两篇同前缀：要报「不止一个」，不许挑
    } catch (e) {
      if (!(e instanceof COACH.KeyError)) throw e
      拦了43 += 1
    }
    const 目录43 = COACH.目录()
    const 有头43 = ['## 节', '## 篇', '## 对话段'].every((k) => 目录43.includes(k))
    if (!取错43.length && !取空43.length && 拦了43 === 3 && 有头43) {
      _print('  43 规程取节       ✔ 目录里每一节/每一篇/每一对话段都真取得到；' +
        '认不出的名字与撞名的都当场拦')
    } else {
      ok = false
      _print('  43 规程取节       ✗ 取不到=' + _pyStr(取错43) + ' 取空=' + _pyStr(取空43) +
        ' 该拦的只拦了' + 拦了43 + '/3 目录有头=' + _T(有头43))
    }
  } catch (exc) {
    ok = false
    _print('  43 规程取节       ✗ ' + _errMsg(exc))
  }

  // 44. 卡稿落卡：一份稿子 -> 一张卡。
  //     盯的是「一次落成」的三条命根子：
  //       · 改 / 建 / 删 都对（同名即改、无名即建、说删就删，清空只清没提到的）
  //       · 稿子有毛病时**目标位置一个字都不写** —— 这是这个命令存在的理由
  //       · 目标已有工程（不给 --覆盖）与别人的目录（给了也不给）都不许乱盖
  //     顺带钉住「落出来的卡真能过体检」与「开场白末尾那三个零宽标记跟着走完这一趟」——
  //     落得成但卡是坏的、或者建卡界面悄悄不见了，都等于没落。
  try {
    const 根44 = mkdtempSync(_join(tmpdir(), 'forge_st44_'))
    const 稿44 = _join(根44, '稿.yaml')
    M.jdump({
      卡名: '自检卡44',
      清空条目: true,
      分组: ['甲组'],
      条目: [
        { 标题: '核心 · 世界总纲', 正文: '改过的总纲' },              // 骨架有 -> 改
        {                                                        // 没有 -> 建
          标题: '甲组 · 一条', 模板: '关键词', 分组: '甲组',
          关键词: ['甲', '乙'], 提示: '问起甲乙时读这条', 正文: '……',
        },
      ],
      变量: [{ 对象: '玩家', 名: '自检数', 类型: 'number', 初值: 1 }],
      正则: [{ 名: '自检正则', 模式: '【(.*?)】', 替换: '「$1」' }],
      开场白: '自检开场白。',
    }, 稿44)
    const 库44 = _join(根44, '库')
    const r44 = DRAFT.落卡(稿44, 库44, false, false, false, _P)
    const 坑44 = []
    if (!(r44['条目改'] === 1 && r44['条目新'] === 1 && r44['条目删'] === 3)) {
      坑44.push('改/新/删 该是 1/1/3，实际 ' + r44['条目改'] + '/' + r44['条目新'] + '/' + r44['条目删'])
    }
    if (!(r44['变量'] === 1) || !(r44['正则'] === 1) || !pyTruthy(r44['开场白'])) {
      坑44.push('变量 ' + r44['变量'] + ' / 正则 ' + r44['正则'] + ' / 开场白 ' + _T(r44['开场白']))
    }
    if (pyTruthy(r44['错误'])) {
      坑44.push('落出来的卡有 ' + r44['错误'].length + ' 个错')
    }
    if (!_是文件(r44['成品'])) {
      坑44.push('成品没落出来')
    }
    if (OPENER.读(r44['工程'])['标记数'] !== 3) {
      坑44.push('开场白末尾的零宽标记不是 3 个')
    }

    // `make --模板` 给的那份骨架**自己必须跑得通** —— 空手想 YAML 的键名最容易卡壳，
    // 而「说了有模板、模板却是坏的」是最气人的一种。
    const 模44 = _join(根44, '模板.yaml')
    // Python 是 `open(模44, "w", encoding="utf-8")` —— 文本模式把每个 `\n` 翻成 os.linesep
    writeFileSync(模44, DRAFT.卡稿模板().split('\n').join('\r\n'), 'utf8')
    const r模44 = DRAFT.落卡(模44, _join(根44, '模板库'), false, false, false, _P)
    if (pyTruthy(r模44['错误'])) {
      坑44.push('模板自己跑出来的卡有 ' + r模44['错误'].length + ' 个错')
    }
    if (!_是文件(r模44['成品'])) {
      坑44.push('模板自己没跑出成品')
    }

    // 负向一：稿子有毛病 -> 目标位置一个字都不许写
    const 坏44 = _join(根44, '坏.yaml')
    M.jdump({ 卡名: '坏卡44', 条目: [{ 标题: '甲', 模板: '没这个档' }] }, 坏44)
    const 坏库44 = _join(根44, '坏库')
    try {
      DRAFT.落卡(坏44, 坏库44, false, false, false, _P)
      坑44.push('坏稿竟然没被拦下')
    } catch (e) {
      if (!(e instanceof DRAFT.DraftError)) throw e
      if (_存在(_join(坏库44, '坏卡44'))) {
        坑44.push('坏稿被拦下了，可目标位置还是被写了东西')
      }
    }
    // 负向二：目标已有一份工程，不给 --覆盖 就该停
    try {
      DRAFT.落卡(稿44, 库44, false, false, false, _P)
      坑44.push('目标已存在时竟然没拦')
    } catch (e) {
      if (!(e instanceof DRAFT.DraftError)) throw e
    }
    // 负向三：那一层住着别人的东西 -> 连 --覆盖 都不许盖
    const 别人44 = _join(根44, '别人的库', '自检卡44', 'source')
    mkdirSync(别人44, { recursive: true })
    writeFileSync(_join(别人44, '别人的.spec.yaml'), '', 'utf8')
    try {
      DRAFT.落卡(稿44, _join(根44, '别人的库'), false, false, true, _P)
      坑44.push('别人的目录竟然被盖了')
    } catch (e) {
      if (!(e instanceof DRAFT.DraftError)) throw e
    }
    if (!坑44.length) {
      _print('  44 卡稿落卡       ✔ 一份稿子一次落成一张卡（改 1 / 建 1 / 删 3）；' +
        '坏稿在动手前就被拦下、目标位置一个字没写；别人的目录不给盖')
    } else {
      ok = false
      _print('  44 卡稿落卡       ✗ ' + 坑44.join('；'))
    }
  } catch (exc) {
    ok = false
    _print('  44 卡稿落卡       ✗ ' + _errMsg(exc))
  }

  // 45. 示例卡稿 + 「改已有条目」那两条容易静默的路。
  //     三件事，全是「不报错但结果不对」的那一类：
  //       · `make --示例` 打出来的那份**必须自己就是一张绿卡** —— 它是给人照抄的，
  //         样板自己跑不通比没有样板更坏（照抄的每一条都撞墙）。
  //       · 稿子里给**已有条目**写「模板:」不许崩（模板表里带着 kind，set_entry 不收身份）。
  //       · 稿子里给**已有条目**写「分组:」要真的挪过去 —— 早先这里默默忽略，
  //         稿子写了「分组: 角色」，条目纹丝不动，一个字都不报。
  //     顺带：变量跟骨架里现成的重名，得是一句人话，不能是 traceback。
  try {
    const 根45 = mkdtempSync(_join(tmpdir(), 'forge_st45_'))
    const 库45 = _join(根45, '库')

    // 示例卡稿：原样落一遍，必须是绿卡
    const 示45 = _join(根45, '示例.yaml')
    // Python 这边点名 `newline="\n"` —— **不翻译**换行
    writeFileSync(示45, DRAFT.卡稿示例(), 'utf8')
    const r45 = DRAFT.落卡(示45, 库45, false, false, false, _P)
    const 坑45 = []
    if (pyTruthy(r45['错误']) || pyTruthy(r45['落点错误'])) {
      坑45.push('示例卡稿落出来的卡有错：' +
        ((r45['错误'] || []).concat(r45['落点错误'] || [])).join('；').slice(0, 120))
    }
    if (!_是文件(r45['成品'])) {
      坑45.push('示例卡稿没落出成品')
    }
    if (OPENER.读(r45['工程'])['标记数'] !== 3) {
      坑45.push('示例卡稿的开场白末尾零宽标记不是 3 个')
    }

    // 已有条目 + 模板 / 分组：换档到「关键词」并把骨架那条世界总纲挪进自建分组
    const 改45 = _join(根45, '改.yaml')
    M.jdump({
      卡名: '自检卡45',
      分组: ['新家'],
      条目: [
        {
          标题: '核心 · 世界总纲', 模板: '关键词', 分组: '新家',
          关键词: ['甲', '乙'], 提示: '问起甲乙时读这条', 正文: '换过档的总纲',
        },
        { 标题: '规则 · 判定', 模板: '常驻', 正文: '换成常驻的判定' },
      ],
    }, 改45)
    const r改45 = DRAFT.落卡(改45, 库45, false, false, false, _P)
    if (pyTruthy(r改45['错误'])) {
      坑45.push('改已有条目落出来的卡有错：' + r45['错误'].join('；').slice(0, 120))
    }
    const spec45 = DRAFT._找规格(r改45['工程'])
    const raw45 = CONTENT.load(spec45)
    const 栏45 = {}
    for (const e of CONTENT.entries_of(raw45, true)) 栏45[e['title']] = e
    const 组45 = {}
    for (const g of CONTENT.groups_of(raw45)) 组45[g['id']] = g['name']
    const 总纲 = 栏45['核心 · 世界总纲'] || {}
    const 判定 = 栏45['规则 · 判定'] || {}
    if (组45[总纲['group_id']] !== '新家') {
      坑45.push('「分组:」没把已有条目挪过去（它还在 ' + pyRepr(组45[总纲['group_id']]) + '）')
    }
    if (总纲['agent_read_strategy'] !== 'keyword') {
      坑45.push('给已有条目换档没生效（策略还是 ' + pyRepr(总纲['agent_read_strategy']) + '）')
    }
    if (总纲['content'] !== '换过档的总纲') {
      坑45.push('给已有条目改正文没生效')
    }
    if (判定['trigger_mode'] !== 'always' || !String(判定['position'] || '').trim()) {
      坑45.push('已有条目换档到常驻后没补插入位置（' + pyRepr(判定['trigger_mode']) + ' / ' +
        pyRepr(判定['position']) + '）')
    }

    // 变量与骨架里的重名：要给一句人话（DraftError），不是 traceback
    const 重45 = _join(根45, '重名.yaml')
    M.jdump({
      卡名: '自检卡45重名',
      变量: [{ 对象: '玩家', 名: '等级', 类型: 'number', 初值: 9 }],
    }, 重45)
    try {
      DRAFT.落卡(重45, 库45, false, false, false, _P)
      坑45.push('变量跟骨架重名竟然落了进去')
    } catch (e) {
      if (!(e instanceof DRAFT.DraftError)) {           // ContentError / 其它都不行
        坑45.push('变量重名抛的是 ' + (e && e.constructor ? e.constructor.name : typeof e) +
          '，不是能读的 DraftError')
      }
    }

    if (!坑45.length) {
      _print('  45 示例卡稿       ✔ 一份 3.8k 字的完整示例自己就是绿卡；给已有条目' +
        '换档 / 改正文 / 挪分组都真的落下去；变量重名给人话不抛栈')
    } else {
      ok = false
      _print('  45 示例卡稿       ✗ ' + 坑45.join('；'))
    }
  } catch (exc) {
    ok = false
    _print('  45 示例卡稿       ✗ ' + _errMsg(exc))
  }

  _print('-'.repeat(74))
  _print('结论：' + (ok ? '全绿 ✔' : '有失败 ✗'))
  _print('（临时工程在 ' + tmp + '，看完可删）')
  return ok ? 0 : 1
}
