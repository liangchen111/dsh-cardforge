  // 31. 开场白：真源在 hud/hud.conf.json，spec 里那条只是派生物；末尾那三个
  //     零宽空格是「建卡界面」正则的开关 —— 少一个，导入 ElecKoi 后界面静默消失。
  //     这一项盯三件事：改一处不落下另一处、标记永远不多不少、
  //     坏输入（尖括号 / 空正文）一个字都不许落盘。
  try {
    const d0 = OPENER.读(proj)
    const 初 = pyTruthy(d0['有开场白']) && d0['标记数'] === 3 && d0['写回一致'] === true

    const 新文 = '深夜十一点四十分。\n\n你推开那扇门。\n\n（写下你的名字。）'
    const r = OPENER.改正文(proj, 新文, true, _P)
    const d1 = OPENER.读(proj)
    const 改好 = (d1['正文'] === 新文 + OPENER.标记 && d1['标记数'] === 3 &&
      d1['写回一致'] === true && r['写回'] === true)

    const 前31 = _读文本(d1['配置文件'])
    let 拦尖 = false
    let 拦空 = false
    try {
      OPENER.改正文(proj, '你推开「<长夜>」的门。', false, _P)
    } catch (e) {
      if (e instanceof OPENER.OpenerError) 拦尖 = true
      else throw e
    }
    try {
      OPENER.改正文(proj, '   ', false, _P)
    } catch (e) {
      if (e instanceof OPENER.OpenerError) 拦空 = true
      else throw e
    }
    const 没动31 = _读文本(d1['配置文件']) === 前31

    // 标记被弄丢（手改 conf 最容易出的那种事）：读得出、写回被拒、能补齐
    const conf_p31 = d1['配置文件']
    const s = _读文本(conf_p31)
    // Python 这边是**字面量**反斜杠 + u200b（conf 里存的是转义写法）；
    // `str.replace` 换全部 —— JS 的 `String.replace` 只换第一处，必须 split/join。
    writeFileSync(conf_p31, s.split('\\u200b\\u200b\\u200b').join('\\u200b'), 'utf8')
    const 看出 = OPENER.读(proj)['标记数'] === 1
    let 拒写回 = false
    try {
      OPENER.写回(proj, _P)
    } catch (e) {
      if (e instanceof OPENER.OpenerError) 拒写回 = true
      else throw e
    }
    OPENER.补齐(proj, _P)
    const d2 = OPENER.读(proj)
    const 补齐 = d2['标记数'] === 3 && d2['写回一致'] === true
    // 写回去的标记要是**转义写法**（跟模板一致）—— 写成真字符就没法用眼睛看见了
    const 转义写 = _读文本(conf_p31).includes('\\u200b\\u200b\\u200b')
    const 回收 = CONTENT.list_trash(spec).some((rec) => rec['种类'] === '开场白')

    const 条 = [初, 改好, 拦尖, 拦空, 没动31, 看出, 拒写回, 补齐, 转义写, 回收]
    if (条.every(pyTruthy)) {
      _print('  31 开场白         ✔ 改一处两处齐 · 标记永远正好 3 个（转义写法）· ' +
        '尖括号/空正文不落盘 · 丢了能补齐 · 旧版进回收站')
    } else {
      ok = false
      _print('  31 开场白         ✗ 初始=' + _T(初) + ' 改=' + _T(改好) + ' 尖=' + _T(拦尖) +
        ' 空=' + _T(拦空) + ' 没动=' + _T(没动31) + ' 看出丢=' + _T(看出) +
        ' 拒写回=' + _T(拒写回) + ' 补齐=' + _T(补齐) + ' 转义=' + _T(转义写) + ' 回收站=' + _T(回收))
    }
  } catch (exc) {
    ok = false
    _print('  31 开场白         ✗ ' + _errMsg(exc))
  }

  // 32. 接手别人的卡 + 不许静默丢改动。
  //     盲跑挖出来的两组「不报错的错」，共同点是都在「照规程做」的路上：
  //       · 只有内容层的工程（import 进来的单张卡）原本**改不了开场白** —— opener 只认界面层、
  //         hud 不肯凭空造界面层、规程又让人别手改，最后只能手抠那三个零宽标记；
  //         而且 `entry --改` 会**把标记一起抹掉还不报**（实测过）。
  //       · 同一条 spec 上并发跑两条写命令：两条各自读到同一份旧内容、各自打印「已改…成功」，
  //         后落盘的那份赢，前一条**静默消失**。AI 一次并发下两条命令就会撞上。
  try {
    const 收 = _join(tmp, '收卡')
    const 卡 = DIST.import_pack(card_path, 收, false, true, _P)
    const 卡spec = _join(卡, 'source', '自检卡.spec.yaml')
    const 没界面 = !_存在(_join(卡, 'hud', 'hud.conf.json'))

    const d = OPENER.读(卡)                        // 内容档：认得出，且说清真源在 spec
    const 认得出 = d['模式'] === '内容' && pyTruthy(d['有开场白']) && pyTruthy(d['条目'])

    const 新 = '凌晨两点十七分，长夜便利店。\n\n自动门「叮」地合上。'
    OPENER.改正文(卡, 新, true, _P)
    const d2 = OPENER.读(卡)
    const lib = ((M.yload(卡spec) || {}).library) || {}
    const 开场条 = (lib['entries'] || []).filter((e) => String(e['kind']) === 'opening')[0]
    const 内容档 = (d2['正文'] === 新 + OPENER.标记 && d2['标记数'] === 3 &&
      开场条['content'] === 新 + OPENER.标记)          // 落盘后读回逐字一致
    const 方案齐 = pyTruthy(开场条['opening_messages']) &&
      (开场条['opening_messages'] || []).every((m) => m['content'] === 开场条['content'])

    let 拦改 = false                                // 开场白正文不走 --改（会静默抹掉标记）
    try {
      CONTENT.set_entry(卡spec, 'AI角色开场白', { content: '硬改' }, _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦改 = true
      else throw e
    }

    const raw = CONTENT.load(卡spec)                // 读了一份之后，文件被别人改过
    // Python 是 `open(p, "a", encoding="utf-8")` —— 文本模式写会把 `\n` 翻成 os.linesep，
    // 在 Windows 上就是 `\r\n`。
    writeFileSync(卡spec, _读文本(卡spec) + '\r\n', 'utf8')
    const 撞前 = _读文本(卡spec)
    let 拦并发 = false
    try {
      CONTENT.commit(卡spec, raw, _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦并发 = true
      else throw e
    }
    const 一字不动 = _读文本(卡spec) === 撞前

    const raw2 = CONTENT.load(卡spec)               // 反例：正常一读一写不许被误拦
    if (!raw2['character']) raw2['character'] = {}
    raw2['character']['nickname'] = '守卫反例'
    let 放行 = false
    try {
      CONTENT.commit(卡spec, raw2, _P)
      放行 = String((((M.yload(卡spec) || {}).character) || {})['nickname'] ?? '').includes('守卫反例')
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 放行 = false
      else throw e
    }

    const 条 = [没界面, 认得出, 内容档, 方案齐, 拦改, 拦并发, 一字不动, 放行]
    if (条.every(pyTruthy)) {
      _print('  32 接手与守卫     ✔ 单卡收进来就能改开场白（内容档，标记自动齐、方案同步）· ' +
        'entry --改 不许碰开场白正文 · 文件被抢改过就拒写且一字不动 · 正常读写不误拦')
    } else {
      ok = false
      _print('  32 接手与守卫     ✗ 没界面=' + _T(没界面) + ' 认得=' + _T(认得出) + ' 内容档=' + _T(内容档) +
        ' 方案齐=' + _T(方案齐) + ' 拦改=' + _T(拦改) + ' 拦并发=' + _T(拦并发) +
        ' 一字不动=' + _T(一字不动) + ' 放行=' + _T(放行))
    }
  } catch (exc) {
    ok = false
    _print('  32 接手与守卫     ✗ ' + _errMsg(exc))
  }

  // 33. 接手一张现成的卡（`new --从`）：界面层照抄骨架，内容层用它的。
  //     「别人给了一张卡」以前是条死路 —— 单张卡收进来只有内容层，没有界面层，
  //     opener 不认、hud 不肯凭空造。这条命令就是那次缺的搬运。顺带守三个静默：
  //       · 非 ElecKoi 卡不许被 unpack「成功」成空工程（宽容解析会让它一路绿灯）；
  //       · 接手失败不许把半成品目录留在盘上（用户会当成建好了）；
  //       · 开场白不许被骨架那句顶掉（桥接曾把它只写进方案，条目正文空着）。
  try {
    const SAMP = _join(HERE, 'samples')
    const 演示卡 = _join(SAMP, '演示卡', '成品', '演示卡.card.json')
    const 酒馆卡 = _join(SAMP, '示例·酒馆V2卡.json')
    const 演示doc = M.yload(_join(SAMP, '演示卡', 'source', '演示卡.spec.yaml')) || {}
    const 源场 = 演示doc['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 骨场 = (M.yload(_join(HERE, 'assets', '骨架', 'source', '骨架.spec.yaml')) || {})
      ['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 净 = (t) => String(t || '').split('\u200b').join('').trim()

    const 搬 = scaffold.new_card('自检搬运', tmp, null, true, null, true, 演示卡)
    const 搬doc = M.yload(_join(搬, 'source', '自检搬运.spec.yaml')) || {}
    const 搬场 = 搬doc['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 有界面 = _是文件(_join(搬, 'hud', 'hud.conf.json'))
    const 条数对 = 搬doc['library']['entries'].length === 演示doc['library']['entries'].length
    const 开场对 = (净(搬场['content']) === 净(源场['content']) &&
      净(搬场['content']) !== 净(骨场['content']))
    const conf = M.jload(_join(搬, 'hud', 'hud.conf.json'))
    const 两处齐 = (conf['开场白']['正文'] === 搬场['content'] &&
      OPENER.尾标记数(搬场['content']) === 3)

    const 酒 = scaffold.new_card('自检酒馆', tmp, null, true, null, true, 酒馆卡)
    const 酒doc = M.yload(_join(酒, 'source', '自检酒馆.spec.yaml')) || {}
    const 酒场 = 酒doc['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 桥接对 = pyTruthy(净(酒场['content'])) && 净(酒场['content']) !== 净(骨场['content'])

    let 拦非卡 = false
    let 没留空 = false
    try {
      pack.unpack(酒馆卡, _join(tmp, '不许出.yaml'))
    } catch {
      拦非卡 = true
      没留空 = !_存在(_join(tmp, '不许出.yaml'))
    }

    let 没残骸 = false
    try {
      scaffold.new_card('自检残骸', tmp, null, true, null, true, _join(tmp, '并没有这张卡.json'))
    } catch {
      没残骸 = !_存在(_join(tmp, '自检残骸'))
    }

    const 坏 = M.yload(_join(SAMP, '演示卡', 'source', '演示卡.spec.yaml'))
    const 坏场 = 坏['library']['entries'].filter((e) => String(e['kind']) === 'opening')[0]
    const 坏p = _join(tmp, '坏开场.spec.yaml')
    坏场['content'] = ''
    M.jdump(坏, 坏p)
    const 抓到空 = new Set(validate.validate_card(pack.spec_to_card(坏p)).map((i) => i.code))
      .has('OPENING-BLANK')
    坏场['content'] = '与各方案都不一样的一段话'
    M.jdump(坏, 坏p)
    const 抓到漂 = new Set(validate.validate_card(pack.spec_to_card(坏p)).map((i) => i.code))
      .has('OPENING-DRIFT')

    const 条 = [有界面, 条数对, 开场对, 两处齐, 桥接对, 拦非卡, 没留空, 没残骸, 抓到空, 抓到漂]
    if (条.every(pyTruthy)) {
      _print('  33 接手搬运       ✔ 单卡 / 酒馆卡都能连界面层一起建 · 开场白取自来源' +
        '（不是骨架那句）· 非卡不许静默成空工程 · 失败不留残骸 · ' +
        '开场白空/漂移查得出')
    } else {
      ok = false
      _print('  33 接手搬运       ✗ 界面=' + _T(有界面) + ' 条数=' + _T(条数对) + ' 开场=' + _T(开场对) +
        ' 两处齐=' + _T(两处齐) + ' 桥接=' + _T(桥接对) + ' 拦非卡=' + _T(拦非卡) +
        ' 没空工程=' + _T(没留空) + ' 没残骸=' + _T(没残骸) + ' 抓到空=' + _T(抓到空) + ' 抓到漂=' + _T(抓到漂))
    }
  } catch (exc) {
    ok = false
    _print('  33 接手搬运       ✗ ' + _errMsg(exc))
  }
