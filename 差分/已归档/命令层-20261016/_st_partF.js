  // 34. 子命令 --help：问一句用法，必须给出**这条命令**的用法，而且一个字都不写盘
  //
  //  以前 `forge.py entry --help` 回的是总表，唯一线索是总表末行那句「去掉参数直接跑」——
  //  没人会去猜那句话，于是「查不到 entry 有哪些参数」成了盲跑里最费劲的一处。
  //
  //  ★ 移植记号：Python 这边起 33 个子进程跑 `forge.py <c> --help`。JS 侧不起子进程
  //  （本机沙箱下 piped stdio 会 EPERM），改成**进程内**调 `main([c, '--help'])`
  //  ＋ `process.chdir(探)`，语义完全一样（子进程那次跑的也正是 `main`）。
  try {
    const 探 = _join(tmp, '_问用法')
    mkdirSync(探, { recursive: true })
    const 前 = _列目录(探)
    const 自文档 = new Set(['domains', 'mods'])   // 这两条没有参数，跑一遍本身就是它的文档
    const 坏 = []
    const 写盘 = []
    const 原cwd = process.cwd()
    try {
      process.chdir(探)
      for (const c of Object.keys(COMMANDS).sort(比串)) {
        let 出文 = ''
        const 原写 = process.stdout.write.bind(process.stdout)
        process.stdout.write = (s) => { 出文 += String(s); return true }
        let rc = 0
        try {
          rc = main([c, '--help'])
        } finally {
          process.stdout.write = 原写
        }
        if (!(rc === 0) || !(自文档.has(c) || 出文.includes('forge.py ' + c))) 坏.push(c)
      }
    } finally {
      process.chdir(原cwd)
    }
    for (const f of _列目录(探)) if (!前.includes(f)) 写盘.push(f)
    if (!坏.length && !写盘.length) {
      _print('  34 子命令用法     ✔ ' + Object.keys(COMMANDS).length +
        ' 条命令的 --help 都给出自己的用法，且一条没写盘')
    } else {
      ok = false
      _print('  34 子命令用法     ✗ 没给出用法的=' + _pyStr(坏) + ' · 写盘的=' + _pyStr(写盘))
    }
  } catch (exc) {
    ok = false
    _print('  34 子命令用法     ✗ ' + _errMsg(exc))
  }

  // 35. 卡名与接管：`--从` 之后名字归新卡 · `name --改` 两处一起动 · 禁用条目看得见改得动
  try {
    const 样卡 = _join(HERE, 'samples', '示例·酒馆V2卡.json')
    const proj2 = scaffold.new_card('接管卡', tmp, null, true, null, true, 样卡)
    const spec2 = _join(proj2, 'source', '接管卡.spec.yaml')
    const conf2 = _join(proj2, 'hud', 'hud.conf.json')

    const _名 = () => String((((M.yload(spec2) || {}).character) || {})['name'] ?? '')
    const _界面名 = () => String(((M.jload(conf2) || {})['卡名']) ?? '')
    const _启 = (r) => ('启用' in r ? r['启用'] : true)

    const 名归新 = (_名() === '接管卡' && _界面名() === '接管卡')
    const 无漂 = !validate.validate_project(proj2).some((i) => i['code'] === 'PROJ-NAME-DRIFT')
    const 禁 = CONTENT.list_entries(spec2).filter((r) => !pyTruthy(_启(r)))
    const 看得见 = pyTruthy(禁)
    if (禁.length) {
      CONTENT.set_entry(spec2, 禁[0]['标题'], { enabled: true }, _P)
    }
    const 改得动 = !CONTENT.list_entries(spec2).some((r) => !pyTruthy(_启(r)))
    scaffold.改卡名(proj2, '改名卡', _P)
    const 两处齐 = (_名() === '改名卡' && _界面名() === '改名卡')
    CONTENT.restore(spec2, '1', _P)
    const 还原回 = (_名() === '接管卡' && _界面名() === '接管卡')
    const 条35 = [名归新, 无漂, 看得见, 改得动, 两处齐, 还原回]
    if (条35.every(pyTruthy)) {
      _print('  35 卡名与接管     ✔ --从 后名字归新卡 · 没有卡名漂移 · 禁用条目列得出也' +
        '改得动 · name 改两处齐 · 回收站连界面配置一起还原')
    } else {
      ok = false
      _print('  35 卡名与接管     ✗ 名归新=' + _T(名归新) + ' 无漂=' + _T(无漂) +
        ' 看得见=' + _T(看得见) + ' 改得动=' + _T(改得动) +
        ' 两处齐=' + _T(两处齐) + ' 还原=' + _T(还原回))
    }
  } catch (exc) {
    ok = false
    _print('  35 卡名与接管     ✗ ' + _errMsg(exc))
  }

  // 36. 变量改名：一次把三处一起挪（面板 / 初值那一格的键 / Zod 那个字段名），
  //     id 不动、顺序不动；撤销能把三处**逐字**还原回原样。
  try {
    const proj3 = scaffold.new_card('改名台', tmp, null, true)
    const spec3 = _join(proj3, 'source', '改名台.spec.yaml')
    CONTENT.add_object(spec3, '面板', '', '', '', _P)
    CONTENT.add_variable(spec3, '面板', '声望', 'number', 5, '', '', _P)

    const _片 = () => {
      const v = ((M.yload(spec3) || {}).variables) || {}
      return [v['initial_state'] || {}, String(v['schema_code'] || '')]
    }
    const 初 = _片()
    const 改前 = String(初[1])
    CONTENT.rename_variable(spec3, '面板.声望', '名望', _P)
    let [st, sc] = _片()
    const 面板格 = st['面板'] || {}
    const 三处 = (_canon(面板格) === _canon({ 名望: 5 }) && sc.includes('名望: z.number()') &&
      !sc.includes('声望') && !('声望' in 面板格))
    const id没换 = ((((CONTENT.load(spec3) || {}).variables) || {})['variables'] || [])
      .filter((x) => x['title'] === '名望' && String(x['id'] || '').startsWith('variable-'))
    const 顺序没乱 = sc === 改前.split('声望').join('名望')   // 只换了名字，别的字节一个没动

    CONTENT.rename_object(spec3, '面板', '状态板', _P)
    ;[st, sc] = _片()
    const 对象齐 = ('状态板' in st && !('面板' in st) && sc.includes('状态板: z.object'))

    let 禁止重名 = false
    try {
      CONTENT.add_variable(spec3, '状态板', '名望', 'string', null, '', '', _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 禁止重名 = true
      else throw e
    }

    CONTENT.restore(spec3, '1', _P)
    CONTENT.restore(spec3, '1', _P)
    ;[st, sc] = _片()
    const 撤得回 = (_canon(st['面板'] || {}) === _canon({ 声望: 5 }) && sc === 改前)

    const 条36 = [三处, pyTruthy(id没换), 顺序没乱, 对象齐, 禁止重名, 撤得回]
    if (条36.every(pyTruthy)) {
      _print('  36 变量改名       ✔ 三处一起挪（面板/初值/Zod）· id 不动 · 顺序没乱 · ' +
        '对象改名同办 · 同层重名拦下 · 撤销逐字还原')
    } else {
      ok = false
      _print('  36 变量改名       ✗ 三处=' + _T(三处) + ' id在=' + _T(pyTruthy(id没换)) +
        ' 顺序=' + _T(顺序没乱) + ' 对象=' + _T(对象齐) + ' 拦重名=' + _T(禁止重名) +
        ' 撤销=' + _T(撤得回))
    }
  } catch (exc) {
    ok = false
    _print('  36 变量改名       ✗ ' + _errMsg(exc))
  }

  // 37. 条目批量：一次落盘、一条回收记录 · 有认不出的名字就**整批停下**（半条最难收拾）
  //     · 删多条再还原，顺序 / 分组 / 启用状态都回得来。
  try {
    const proj3 = _join(tmp, '改名台')
    const spec4 = _join(proj3, 'source', '改名台.spec.yaml')
    CONTENT.add_group(spec4, '甲组', '', _P)
    for (const t of ['甲一', '甲二', '甲三']) {
      CONTENT.add_entry(spec4, t, '', '关键词', '正文 ' + t, ['试'], null, null, _P)
    }
    const 删前 = CONTENT.list_entries(spec4).map((r) => r['标题'])
    const _启 = (r) => ('启用' in r ? r['启用'] : true)

    CONTENT.move_entries(spec4, ['甲一', '甲二', '甲三'], '甲组', _P)
    const 挪齐 = CONTENT.list_entries(spec4).filter((r) => r['标题'].startsWith('甲'))
      .every((r) => r['分组'] === '甲组')
    CONTENT.set_entries_enabled(spec4, ['甲一', '甲二'], false, _P)
    const 停齐 = _canon(CONTENT.list_entries(spec4).filter((r) => !pyTruthy(_启(r)))
      .map((r) => r['标题'])) === _canon(['甲一', '甲二'])

    let 整批停 = false
    let 拦报错 = ''
    try {
      CONTENT.del_entries(spec4, ['甲一', '不存在的条目', '甲二'], _P)
    } catch (e) {
      if (!(e instanceof CONTENT.ContentError)) throw e
      整批停 = _errMsg(e).includes('不存在的条目')
      拦报错 = _errMsg(e)
    }
    const 没动它 = _canon(CONTENT.list_entries(spec4).map((r) => r['标题'])) === _canon(删前)

    CONTENT.del_entries(spec4, ['甲一', '甲二', '甲三'], _P)
    const 真删了 = !CONTENT.list_entries(spec4).some((r) => r['标题'].startsWith('甲'))
    CONTENT.restore(spec4, '1', _P)
    const 栏 = {}
    for (const r of CONTENT.list_entries(spec4)) 栏[r['标题']] = r
    const 回得来 = (_canon(CONTENT.list_entries(spec4).map((r) => r['标题'])) === _canon(删前) &&
      栏['甲一']['分组'] === '甲组' && 栏['甲二']['分组'] === '甲组' &&
      栏['甲一']['启用'] === false && 栏['甲二']['启用'] === false)

    const 条37 = [挪齐, 停齐, 整批停, 没动它, 真删了, 回得来]
    if (条37.every(pyTruthy)) {
      _print('  37 条目批量       ✔ 挪组/启停/删都一次落盘一条记录 · 认不出的名字整批停下' +
        '（一条没动）· 删掉再还原顺序/分组/启用状态全齐')
    } else {
      ok = false
      _print('  37 条目批量       ✗ 挪=' + _T(挪齐) + ' 停=' + _T(停齐) + ' 整批停=' + _T(整批停) +
        ' 没动=' + _T(没动它) + ' 删=' + _T(真删了) + ' 还原=' + _T(回得来) +
        (整批停 ? '' : '｜' + 拦报错))
    }
  } catch (exc) {
    ok = false
    _print('  37 条目批量       ✗ ' + _errMsg(exc))
  }

  // 38. 变量换对象：名字不动，挂靠 / 初值那格 / Zod 那个字段 / 排序**一起搬**，
  //     id 不动；撤销能把这几处**逐字**还原。同对象 / 没这个对象 / 新层重名都拦。
  try {
    const proj3 = _join(tmp, '改名台')
    const spec4 = _join(proj3, 'source', '改名台.spec.yaml')
    const spec5 = spec4
    CONTENT.add_object(spec5, '乙', '', '', '', _P)
    CONTENT.add_variable(spec5, '乙', '金锭', 'number', 3, '', '', _P)
    CONTENT.add_object(spec5, '甲', '', '', '', _P)

    const _变量 = (名) => ((((CONTENT.load(spec5) || {}).variables) || {})['variables'] || [])
      .filter((x) => x['title'] === 名)
    const _对象id = (名) => ((((CONTENT.load(spec5) || {}).variables) || {})['objects'] || [])
      .filter((o) => o['name'] === 名).map((o) => o['id'])
    const _片5 = () => {
      const v = ((M.yload(spec5) || {}).variables) || {}
      return [v['initial_state'] || {}, String(v['schema_code'] || '')]
    }

    const 改前5 = _片5()
    const id前 = String(_变量('声望')[0]['id'])

    let 拦同对象 = false
    let 拦没对象 = false
    try {
      CONTENT.move_variable(spec5, '面板.声望', '面板', _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦同对象 = true
      else throw e
    }
    try {
      CONTENT.move_variable(spec5, '面板.声望', '没有这个对象', _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦没对象 = true
      else throw e
    }
    const 没动38 = _canon(_片5()) === _canon(改前5)   // 两次拦截都不许落盘

    CONTENT.move_variable(spec5, '面板.声望', '甲', _P)
    let [st, sc] = _片5()
    const 挂齐 = (String(_变量('声望')[0]['object_id']) === String(_对象id('甲')[0]) &&
      String(_变量('声望')[0]['id']) === id前)
    const 状态齐 = (_canon(st['甲'] || {}) === _canon({ 声望: 5 }) &&
      !('声望' in (st['面板'] || {})))
    const 紧凑 = sc.split(' ').join('').split('\n').join('')
    const zod齐 = 紧凑.includes('甲:z.object({声望:z.number()})')
    const 顺序齐 = _变量('声望')[0]['order'] === 1   // 甲下本来没变量，排到末尾 = 1

    CONTENT.restore(spec5, '1', _P)
    const 撤得回5 = _canon(_片5()) === _canon(改前5)

    CONTENT.add_variable(spec5, '乙', '声望', 'number', 9, '', '', _P)
    let 拦重名 = false
    try {
      CONTENT.move_variable(spec5, '面板.声望', '乙', _P)
    } catch (e) {
      if (e instanceof CONTENT.ContentError) 拦重名 = true
      else throw e
    }

    const 条38 = [拦同对象, 拦没对象, 没动38, 挂齐, 状态齐, zod齐, 顺序齐, 撤得回5, 拦重名]
    if (条38.every(pyTruthy)) {
      _print('  38 变量换对象     ✔ 挂靠/初值那格/Zod 那个字段/排序一起搬 · id 不动 · ' +
        '同对象与缺对象当场拦（不落盘）· 新层重名拦下 · 撤销逐字还原')
    } else {
      ok = false
      _print('  38 变量换对象     ✗ 拦同=' + _T(拦同对象) + ' 拦无=' + _T(拦没对象) +
        ' 没动=' + _T(没动38) + ' 挂=' + _T(挂齐) + ' 态=' + _T(状态齐) + ' Zod=' + _T(zod齐) +
        ' 序=' + _T(顺序齐) + ' 撤=' + _T(撤得回5) + ' 重名=' + _T(拦重名))
    }
  } catch (exc) {
    ok = false
    _print('  38 变量换对象     ✗ ' + _errMsg(exc))
  }
