  // 27. 工程层：模块目录↔conf、账本↔现状、界面有没有写回、派生物过没过期。
  //     这几类错的共同点是**都不报错**（界面上安静地少一块、撤模块撤不回原样、
  //     交出去的成品还是老内容），所以只能靠查 —— 每条都要能查出来（负向），
  //     同时**模板源那种「本来就没成品」的工程一条都不许报**（防误报）。
  try {
    const 工 = _join(tmp, '模块卡')                 // 接过模块、有成品的那种
    const _地 = () => validate.validate_project(工).map((i) => i.code)   // noqa: E731

    // (a) 干净的时候一条都不该有
    const 净 = !_地().length

    // (b) 模块目录在、conf 没登记 —— 组装时根本不拼它
    mkdirSync(_join(工, 'hud', '模块', '野模块'), { recursive: true })
    const 拦b = _地().includes('PROJ-MOD-UNLISTED')

    // (c) conf 登记了、账本没记 —— `forge drop` 撤不掉
    const conf_p = _join(工, 'hud', 'hud.conf.json')
    let conf = M.jload(conf_p)
    if (!conf['模块']) conf['模块'] = []
    conf['模块'].push('野模块')
    writeFileSync(conf_p, JSON.stringify(conf, null, 2), 'utf8')
    const 拦c = _地().includes('PROJ-MOD-NO-LEDGER')

    // (d) 账本记着替换过的条目，spec 里被删了 —— 撤的时候撤不动
    const led_p = _join(工, '模块账本.json')
    const led = M.jload(led_p)
    for (const rec of Object.values(led['模块'] || {})) {
      if (!rec['条目']) rec['条目'] = {}
      if (!rec['条目']['替换']) rec['条目']['替换'] = []
      rec['条目']['替换'].push({ id: '早就不在了', title: '幽灵条目', 原: {}, 并入后: 'x' })
      break
    }
    writeFileSync(led_p, JSON.stringify(led, null, 2), 'utf8')
    const 拦d = _地().includes('PROJ-LEDGER-GONE')

    // (e) 账本记的界面文件不见了
    let _界 = null
    for (const rec of Object.values(led['模块'] || {})) {
      for (const rel of (rec['界面'] || [])) {
        _界 = _join(工, String(rel).split('/').join('\\'))
        break
      }
      if (_界) break
    }
    if (_界 && _是文件(_界)) unlinkSync(_界)
    const 拦e = pyTruthy(_界) && _地().includes('PROJ-LEDGER-HUD')

    // (f) 界面没写回卡里：把 conf 那条正则换个名，spec 里就没有同名的了
    conf = M.jload(conf_p)
    conf['正则'][0]['name'] = '改了个名 · 没人写回'
    writeFileSync(conf_p, JSON.stringify(conf, null, 2), 'utf8')
    const 拦f = _地().includes('PROJ-HUD-UNWRITTEN')

    // (g) 成品比 spec 旧：把 spec 摸新
    const sp_p = _join(工, 'source', '模块卡.spec.yaml')
    _触时间(sp_p, Date.now() / 1000 + 60)
    const 拦g = _地().includes('PROJ-STALE-CARD')

    // (h) 两张 spec 并存 —— 谁也不知道该用哪份
    copyFileSync(sp_p, _join(工, 'source', '第二张.spec.yaml'))
    const 拦h = _地().includes('PROJ-MULTI-SPEC')

    // (i) 防误报：把成品拿走（变成「模板源」那样），界面没写回也不许报
    rmSync(_join(工, '成品'), { recursive: true, force: true })
    unlinkSync(_join(工, 'source', '第二张.spec.yaml'))
    const 不报 = !_地().includes('PROJ-HUD-UNWRITTEN')

    const 条 = [净, 拦b, 拦c, 拦d, 拦e, 拦f, 拦g, 拦h, 不报]
    if (条.every(pyTruthy)) {
      _print('  27 工程自洽       ✔ 七种「不报错的错」都查得出；' +
        '模板源（没成品）不误报')
    } else {
      ok = false
      _print('  27 工程自洽       ✗ 净=' + _T(净) + ' 目录↔conf=' + _T(拦b) + ' 账本无记录=' + _T(拦c) +
        ' 幽灵条目=' + _T(拦d) + ' 账本界面=' + _T(拦e) + ' 没写回=' + _T(拦f) +
        ' 成品过期=' + _T(拦g) + ' 两份spec=' + _T(拦h) + ' 不误报=' + _T(不报))
    }
  } catch (exc) {
    ok = false
    _print('  27 工程自洽       ✗ ' + _errMsg(exc))
  }

  // 28. 制卡向导：一份内容两个出口；出完自己必须是绿的
  //     验收：规程成篇、技能有 frontmatter、卡体检 0 错、条目齐、往返一致、
  //     并且它自己守着「常驻不超预算」这条规矩（教别人省，自己不能胖）。
  try {
    const 向导 = _join(tmp, '向导')
    const 静 = () => {}
    const r = COACH.出(向导, 静)
    const 规程字 = lenPy(_读文本(r['规程']))
    const 有头 = _读文本(r['技能']).startsWith('---\n')
    const 向导卡 = M.jload(r['卡'])
    const 概 = validate.summarize(向导卡)
    const 卡错 = validate.validate_card(向导卡, '向导卡').filter((i) => i.level === 'ERROR')
    pack.unpack(r['卡'], _join(向导, '回.yaml'))
    const 往返 = _canon(向导卡) === _canon(pack.spec_to_card(_join(向导, '回.yaml')))
    const 常驻 = _常驻字数(向导卡)
    const 条 = [规程字 > 5000, 有头, 概['entries'] >= 13, !卡错.length, 往返, 常驻 <= 700]
    if (条.every(pyTruthy)) {
      _print('  28 制卡向导       ✔ 规程 ' + 规程字 + ' 字 / 卡 ' + 概['entries'] + ' 条 0 错 / 往返一致 / 常驻 ' + 常驻 + ' 字')
    } else {
      ok = false
      _print('  28 制卡向导       ✗ 规程=' + 规程字 + '字 技能头=' + _T(有头) + ' 条目=' + 概['entries'] +
        ' 卡错=' + 卡错.length + ' 往返=' + _T(往返) + ' 常驻=' + 常驻 + '字')
    }
  } catch (exc) {
    ok = false
    _print('  28 制卡向导       ✗ ' + _errMsg(exc))
  }

  // 29. 规程与工具对得上 —— 规程会腐烂：工具加了命令、改了值域，规程还写着老样子。
  //     它是给 AI 的唯一依据；里面一句跑不通的命令，AI 就会照着撞一次墙。
  //     查四样：命令都在、模板名都在、类型名都在、该有的章节与要点都在。
  try {
    const 规程 = COACH.规程正文()
    const 命令 = Array.from(new Set(_找全部(规程, /forge\.py\s+([a-z][a-z_-]*)/g, 1))).sort(比串)
    const 野命令 = 命令.filter((c) => !(c in COMMANDS))
    const 模板 = new Set(_找全部(规程, /--模板\s+([^\s\\|]+)/g, 1).map((m) => m.trim()))
    const 野模板 = Array.from(模板).filter((t) => t && !(t in CONTENT.模板表)).sort(比串)
    const 类型 = Array.from(new Set(_找全部(规程, /--类型\s+([A-Za-z]+)/g, 1))).sort(比串)
    const 野类型 = 类型.filter((t) => !CONTENT.变量类型表.includes(t))
    const 缺节 = '一二三四五六七八九'.split('').map((x) => '## ' + x + '、').filter((h) => !规程.includes(h))
    const 缺要点 = [['零宽标记本身', 'u200B{3}'],
      ['--改 命令', '--改'],
      ['--看 命令', '--看'],
      ['@文件 写法', '--正文@'],
      ['开场白那一节', '## 三、开场白'],
      ['收卡那一节', '## 二、手上已经有一张卡'],
      ['opener 命令', 'forge.py opener'],
      ['--补齐', '--补齐'],
      ['开场白兜底断言', 'HUD-OPENER-MARK'],
      ['analyze 命令', 'forge.py analyze'],
      ['import 命令', 'forge.py import'],
      ['to-eleckoi 命令', 'forge.py to-eleckoi'],
      ['--从 接手（连界面层）', 'new <卡名> --从']]
      .filter(([, 串]) => !规程.includes(串)).map(([名]) => 名)
    // 负向：规程不许再出现「手改 conf 改开场白」的老教法。
    // 规程会腐烂成**自相矛盾**——§三 说「用 opener，别手改」，§八 还抄着老写法，
    // AI 抄的是 §八。正面查「有没有 opener」拦不住这个，得反面查「还在不在教手改」。
    const 老教法 = ['hud/hud.conf.json 的「开场白',
      'hud.conf.json 的「开场白.正文」',
      'conf 里的开场白正文（末尾'].filter((串) => 规程.includes(串))
    // 门牌（SKILL.md）是另一份会被读的东西：它必须指向**真**规程、里面的命令也得是真的。
    // 它以前是手抄的副本，与生成物脱节过 —— 现在由 coach 生成，这里顺手钉住。
    const 门牌 = COACH.技能正文
    const 野门牌 = Array.from(new Set(_找全部(门牌, /forge\.py\s+([a-z][a-z_-]*)/g, 1))).sort(比串)
      .filter((c) => !(c in COMMANDS))
    const 门牌缺 = ['AI制卡规程.md', 'forge.py', 'guide', 'cardforge'].filter((串) => !门牌.includes(串))
    const 前言缺 = ['name: eleckoi-card-maker', 'description:'].filter((串) => !COACH.技能前言.includes(串))
    const 缺 = (野命令.length ? ['命令不存在：' + 野命令.join('、')] : [])
      .concat(野模板.length ? ['模板不在表里：' + 野模板.join('、')] : [])
      .concat(野类型.length ? ['类型不在表里：' + 野类型.join('、')] : [])
      .concat(缺节.length ? ['缺章节：' + 缺节.join('、')] : [])
      .concat(缺要点.length ? ['缺要点：' + 缺要点.join('、')] : [])
      .concat(老教法.length ? ['规程自相矛盾（还在教手改 conf）：' + 老教法.join('、')] : [])
      .concat(野门牌.length ? ['门牌里的命令不存在：' + 野门牌.join('、')] : [])
      .concat(门牌缺.length ? ['门牌缺指向或命令：' + 门牌缺.join('、')] : [])
      .concat(前言缺.length ? ['技能前言缺：' + 前言缺.join('、')] : [])
    if (!缺.length) {
      _print('  29 规程与工具     ✔ ' + 命令.length + ' 条命令 / ' + 模板.size + ' 种模板 / ' + 类型.length +
        ' 种类型全对得上，九节齐、无手改残留；门牌指向正确')
    } else {
      ok = false
      _print('  29 规程与工具     ✗ ' + 缺.join('；'))
    }
  } catch (exc) {
    ok = false
    _print('  29 规程与工具     ✗ ' + _errMsg(exc))
  }

  // 30. 制卡读写回路 —— 「AI 顺畅改一张卡」的两个最短动作：
  //     先读它现在写了什么（--看），再把长正文写回去（--正文@文件）。
  //     缺了这两个，AI 就只能把整份 spec 整个吞进去找一段话，
  //     还得跟命令行转义打架（换行、引号在 shell 里是另一门手艺）。
  try {
    CONTENT.add_entry(spec, '自检 · 读写回路', '', '关键词', '第一版正文', ['回路'], null, null, _P)
    const d = CONTENT.entry_detail(spec, '自检 · 读写回路')
    const 读回 = d['正文'] === '第一版正文' && _canon(d['关键词']) === _canon(['回路']) && pyTruthy(d['id'])

    const 多行 = '第一行\n第二行\n\n第四行 \t 制表符 "引号" \\ 反斜杠 $ 符号'
    const f = _join(tmp, '正文.txt')
    writeFileSync(f, 多行 + '\n', 'utf8')      // 编辑器习惯：末尾多一个换行，不算内容
    CONTENT.set_entry(spec, '自检 · 读写回路', { content: _读文('@' + f) }, _P)
    const 写回 = CONTENT.entry_detail(spec, '自检 · 读写回路')['正文'] === 多行
    const 粘写 = _opt(['x', '--正文@' + f], ['--正文']) === 多行      // --正文@文件
    const 分写 = _opt(['x', '--正文', '@' + f], ['--正文']) === 多行  // --正文 @文件

    let 拦下 = false
    try {
      _opt(['x', '--正文@并没有这个文件.txt'], ['--正文'])
    } catch (e2) {
      if (e2 instanceof ArgError) 拦下 = true
      else throw e2
    }
    const 前30 = _读文本(spec)
    CONTENT.entry_detail(spec, '自检 · 读写回路')
    const 没动 = _读文本(spec) === 前30          // --看 是纯读

    const 条 = [读回, 写回, 粘写, 分写, 拦下, 没动]
    if (条.every(pyTruthy)) {
      _print('  30 制卡读写回路   ✔ 读一条（正文/关键词/多行原样）· ' +
        '长正文 @文件 两种写法 · 路径写错当场拦 · 读不改盘')
    } else {
      ok = false
      _print('  30 制卡读写回路   ✗ 读回=' + _T(读回) + ' 写回=' + _T(写回) + ' 粘写=' + _T(粘写) +
        ' 分写=' + _T(分写) + ' 拦下=' + _T(拦下) + ' 没动=' + _T(没动))
    }
  } catch (exc) {
    ok = false
    _print('  30 制卡读写回路   ✗ ' + _errMsg(exc))
  }
