/* ============================================================================
 * 备份模块 —— 把「玩家」那份档案导出成一段文本，再原样读回来
 *
 * 解决的是这一件事：界面填的东西只住在变量里。换台机器、重开一局、想把某个
 * 角色单独存着 —— 一条路都没有。这一段给那条路。
 *
 * 导出的文本里带两样，缺一样就不算备份：
 *   · 变量里那份**已经封缄的**档案 —— 封缄之后唯一的真相；
 *   · 建卡器界面上**正在填的**那份草稿 —— 还没封缄的活。
 * 只带前者，填了一半的草稿白填；只带后者，封缄过的角色读回来是空界面。
 *
 * **这一份有三个落脚处，各管一段路，别混为一谈**：
 *   · 界面上那一格 textarea —— 草稿纸。活在当前这一页里，关掉或重启软件就空了；
 *   · 变量树里那个「给机器用的」对象（CONFIG.archiveObject，默认是 存档 › 角色）——
 *     这一局的**过夜那一份**。它跟玩家档案住同一套变量系统，所以按会话存：重启软件、
 *     关掉这段对话再回来都在；新开一段对话是另一局，那里自然是空的。
 *   · 宿主窗口的 localStorage —— **跨局的永久档**，钥匙由 FORMAT 派生（见 SLOT_KEY）。
 *     localStorage 按「源」存，而卡片每一楼都跑在同一个源里，所以同一台机器的任何
 *     一局都读得到它，关软件、开新对话都不丢。变量办不到的那一半 ——「日后再开一局
 *     把捏好的角色读回来」—— 就压在它身上。
 * 所以导出会同时写三处；**封缄也会顺手写一份**（核心在那一笔落定后叫
 * afterSubmit，这时读到的档案才是封缄之后的）；「从存档取回」先读变量，
 * 变量空着（新一局本来就是空的）再退到永久档；「从上面那格读回」只读那一格。
 *
 * 写进变量的是**紧凑 JSON**：给人看的那份摆在界面上（缩进好读），这一份要跟着
 * 每一次请求进上下文 —— 同一份东西，缩进一加就从 864 字涨到 1444 字。
 *
 * **这一份不写死任何字段名。** 建卡器上有哪几栏、档案住在哪个变量下、存档那一格
 * 叫什么，都从 hud.CONFIG 现读（fields / playerObject / archiveObject / archiveSlot）
 * —— 你把演示卡改成什么样，它就备份什么样；某栏的上下限改了，读回来时的夹取也跟着改。
 *
 * 界面只接在建卡器那一页（create），不接面板：面板每轮回复都重画一遍，
 * 放进去的 textarea 下一轮就空了。想在面板上「随时能存」是另一件事 ——
 * 面板看不见表单，能存的只有变量里那份档案，而那一份本来就在变量里。
 *
 * 这一份是「另一个文件里的一段独立代码」：读不到 hud.core.js 里的私有名字，
 * 只能通过 window.CARDC73C60_HUD 那份导出接上去，接线口是 useModule()。
 *
 * 自检写在下面 自检() 里，跟着 测试/run_all.py 一起跑 —— 测的是「认与收」那
 * 一半（不碰 DOM 的那些函数）：存档认错、栏位夹不住、多出来的键被丢掉、
 * 空档案把变量清空、存档位读错一格，这几样都不会报错，只会安静地把玩家的档案弄坏。
 * ========================================================================== */
(function () {
  'use strict';

  /* 存档的标记。换名时 cardc73c60 会跟着变成这张卡的 id 前缀 ——
     认存档只认这一个记号：别家的、手改坏了的一律如实说读不出来，
     绝不「尽力解析」（猜着填进界面，比不填更坏）。 */
  var FORMAT = 'cardc73c60.card-archive';
  var VERSION = 1;

  var ACT_OUT = 'archive-out';
  var ACT_LOAD = 'archive-load';
  var ACT_IN = 'archive-in';
  var BUSY = 'data-archive-busy';

  /* ------------------------------------------------ 认与收（不碰 DOM 的那一半） */

  /* 这一段读得出来吗。只认自家格式。 */
  function parse(hud, text) {
    var s = hud.str(text);
    if (!s) {
      return { ok: false,
        msg: '上面那格是空的 —— 先点「导出到上面那格」，把那一段抄走，要还原时再粘回来。' };
    }
    var box = null;
    try { box = JSON.parse(s); } catch (e) { box = null; }
    if (!hud.plain(box)) {
      return { ok: false,
        msg: '这段读不出来：它不是 JSON。要的是点「导出」写进那格的那一整段（从 { 到 }）。' };
    }
    if (hud.str(box.format) !== FORMAT) {
      return { ok: false,
        msg: '这段不是本卡的存档 —— 认不出「' + FORMAT + '」这个标记（读到的 format 是「' +
          (hud.str(box.format) || '空') + '」）。' };
    }
    return { ok: true, data: box, msg: '' };
  }

  /* 一块对象里到底有没有东西。用它代替「有没有名字」——
     名字是某张卡自己的栏位，模块不该知道；空串、空数组、空的嵌套对象都算没有。 */
  function hasAny(hud, obj) {
    var keys = Object.keys(hud.plain(obj) || {});
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (hud.plain(v)) { if (hasAny(hud, v)) return true; continue; }
      if (hud.isArr(v) ? v.length > 0 : hud.str(v) !== '') return true;
    }
    return false;
  }

  /* 「一行一件」的栏：是数组就逐项去空白；单写一个字符串也认（手改过的存档常见），
     按行切开。行里放不下换行（界面上就是拿换行拼的），所以这么切不丢东西。 */
  function listOf(hud, v) {
    if (hud.isArr(v)) {
      var out = [];
      for (var i = 0; i < v.length; i++) {
        var s = hud.str(v[i]);
        if (s) out.push(s);
      }
      return out;
    }
    if (v == null || v === '') return [];
    return hud.parseList(String(v));
  }

  /* 把一份（可能被手改过的）档案收成界面与变量都认得的形状：
     照 CONFIG.fields 逐栏对类型与上下限 —— 手改出来的「等级 999」不该进变量。
     然后**先原样摊开**：档案里多出来的键一个不丢（变量树常常比建卡器长，
     来回一趟丢东西是备份最容易犯的错）。代价是宿主 schema 若不认多出来的键，
     那次写入会被整条挡回来 —— 那种时候写回那一步会如实报出来，不装着成功。 */
  function norm(hud, src) {
    var raw = hud.plain(src) || {};
    var out = {};
    Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
    var F = hud.CONFIG.fields || [];
    for (var i = 0; i < F.length; i++) {
      var f = F[i], v = raw[f.key];
      if (f.type === 'list') {
        out[f.key] = listOf(hud, v);
      } else if (f.type === 'number') {
        var n = Math.round(hud.num(v, f.min != null ? f.min : 0));
        out[f.key] = hud.clamp(n, f.min != null ? f.min : n, f.max != null ? f.max : n);
      } else {
        out[f.key] = hud.str(v);
      }
    }
    return out;
  }

  /* 打包。draft 为假表示这一页没有建卡器（那就只带变量里那份档案）。 */
  function pack(hud, state, draft) {
    var p = hud.objectOf(state, hud.CONFIG.playerObject);
    var sealed = hasAny(hud, p);
    return {
      format: FORMAT,
      version: VERSION,
      存于: new Date().toISOString(),
      草稿: draft || null,
      档案: sealed ? norm(hud, p) : null
    };
  }

  /* ------------------------------------------------------------------ 存档位

     「存档」那一格是过夜的地方。读法归核心（它知道变量住 stat_data 还是摊在
     顶层），模块只管用；写法则直接用核心的 writeObject —— 自己拼一份 setState
     出来，等于把「整份读出、改一处、整份写回」这件事在这里重做一遍，
     多一处会写错的地方。 */

  function slotName(hud) {
    return hud.str(hud.CONFIG.archiveObject) && hud.str(hud.CONFIG.archiveSlot);
  }

  /* 这一局存着的那一份（空串 = 还没有）。 */
  function savedOf(hud, state) {
    if (typeof hud.readArchive === 'function') return hud.readArchive(state);
    if (!slotName(hud)) return '';
    /* 老核心没这个助手：照 CONFIG 自己读一遍，别让整块功能因此瞎掉 */
    return hud.str(hud.objectOf(state, hud.CONFIG.archiveObject)[hud.CONFIG.archiveSlot]);
  }

  /* ------------------------------------------------------------ 永久档（跨局）

     变量那一格按会话存，新一局天然是空的 —— 干净开局要的正是这个，可它同时意味着
     「捏好的角色、日后再开一局也读回来」在变量里办不到。那一半只有压在宿主窗口的
     localStorage 上：按「源」存、落盘，所以同一台机器的任何一局都读得到。

     宿主不给写（关掉了站点存储之类）就当作没这一步 —— 这里一律不抛，只把
     「没写成」当一句话带上去；上面那格文本与剪贴板照旧是最后一道保险。 */

  /* 永久档那把钥匙。从 FORMAT 派生，而 FORMAT 会被 cardc73c60 换成这张卡的名字，
     所以两张卡各存各的，谁也不盖谁。 */
  var SLOT_KEY = FORMAT + '::perm';

  function permStore() {
    try {
      var w = (typeof window !== 'undefined' && window) || null;
      return (w && w.localStorage) || null;
    } catch (e) { return null; }
  }

  /* 写一份进永久档。写后读回来对一眼 —— 宿主可能只是「假装」写成功。
     不记名字：模块这一头不写死任何字段名（见文件头），所以只记时间与长度，
     界面上那一句自己会说是谁。 */
  function permWrite(text) {
    var ls = permStore();
    if (!ls) return false;
    try {
      var s = String(text == null ? '' : text);
      if (!s) return false;
      ls.setItem(SLOT_KEY, JSON.stringify({ v: VERSION, at: new Date().toISOString(), text: s }));
      return !!ls.getItem(SLOT_KEY);
    } catch (e) { return false; }
  }

  /* 读永久档。没存过、那段坏了、宿主不给读 —— 一律当没有：
     它是锦上添花的那一条，不该把「从存档取回」整条路带塌。 */
  function permRead() {
    var ls = permStore();
    if (!ls) return null;
    try {
      var raw = ls.getItem(SLOT_KEY);
      if (!raw) return null;
      var box = JSON.parse(raw);
      if (!box || typeof box !== 'object' || !String(box.text || '')) return null;
      return box;
    } catch (e) { return null; }
  }

  /* 永久档那句话里要写「什么时候、多大一份」。摊成人看得懂的本地时间。 */
  function permBrief(box) {
    var d = new Date(String((box || {}).at || ''));
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var at = isNaN(d.getTime()) ? ''
      : d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    return (at ? at + ' 存 · ' : '') + String((box || {}).text || '').length + ' 字';
  }

  /* 永久档那一行。这一局的变量空着（新一局本来就空）时，它就是唯一的来路 ——
     不说一声，人只会以为白捏了一遍。 */
  function permText(box) {
    return box
      ? '这台机器的永久档里留着一份（' + permBrief(box) + '）—— 另开一局新对话也能按「从存档取回」填回来。'
      : '这台机器的永久档里没有东西。（宿主若不给卡片写站点存储，跨局就只剩上面那格文本一条路。）';
  }

  /* 把一份备份写进那一格。写的是紧凑 JSON（理由见文件头）。
     失败一律**不往下抛** —— 备份还有那格文本与剪贴板两条路，如实说一句就够，
     不该让一次变量写不成把整个导出打断。返回空串 = 顺利。

     顺手也压一份永久档：写三处的那三处里，只有它跨得过「另开一局」。
     两处互不依赖 —— 哪一处没成就说哪一处，不因一处坏了把另一处也丢掉。 */
  function store(hud, scope, data) {
    var tight = JSON.stringify(data);
    var perm = permWrite(tight);
    var permBad = perm ? '' : '（永久档没写成 —— 这台机器不让卡片写站点存储，' +
      '往后另开一局取回就只剩上面那格文本这条路。）';
    if (!slotName(hud)) {
      return Promise.resolve('（这张卡的 CONFIG 里没写「存档」那个位子，' +
        '这一份只有抄走的才留得住。）' + permBad);
    }
    var patch = hud.mkPatch(hud.CONFIG.archiveSlot, tight);
    return hud.writeObject(hud.CONFIG.archiveObject, patch, scope).then(function (warn) {
      return (warn ? '（没能写进「存档」变量：' + warn + '）' : '') + permBad;
    }, function (err) {
      return '（没能写进「存档」变量：' + hud.msgOf(err) + '）' + permBad;
    });
  }

  /* 「这一局存着没有」那一行。导出 / 取回之后就地把字换掉，不用等下一次重画 ——
     建卡器不是每轮都重画的，等重画等于让这句话一直是旧的。 */
  function keptText(n) {
    return n
      ? '这一局存着一份备份（' + n + ' 字）—— 按「从存档取回」就能把表单填回来，重启也在。'
      : '这一局还没有存档：按「导出」会存一份，封缄时也会顺手存一份。';
  }

  /* 那一行写两件事：这一局存着没有，以及这台机器的永久档里有没有。
     两处都要说 —— 只看前者的话，新一局里那一行永远说「还没有存档」，
     而人刚在这一局按过封缄，看着就像备份丢了。 */
  function keptIn(scope, n) {
    var el = scope.querySelector('[data-archive-kept]');
    if (el) el.textContent = keptText(n) + ' ' + permText(permRead());
  }

  /* ------------------------------------------------------------ 界面那一块 */

  function blockHtml(hud, state) {
    var sealed = hud.hasProfile(state);
    var line = sealed
      ? '变量里现在这份档案：' + hud.briefOf(state)
      : '变量里还没有封缄过的档案 —— 先把上面填好、点「封缄 · 开始」，导出时才会带上它。';
    return '' +
      '<div class="hud-archive" data-archive>' +
      '  <div class="hud-archive__t">档案备份</div>' +
      '  <div class="hud-archive__hint">想把某个角色单独留着、换台机器、另开一局再玩 —— ' +
      '导出这一份：变量里过夜，这台机器的永久档里跨局，那格文本可以抄走带到别处。' +
      hud.esc(line) + '</div>' +
      '  <div class="hud-archive__hint" data-archive-kept>' +
      hud.esc(keptText(savedOf(hud, state).length) + ' ' + permText(permRead())) + '</div>' +
      '  <textarea class="hud-input hud-input--area hud-archive__box" rows="4" ' +
      'data-archive-box spellcheck="false" ' +
      'placeholder="点「导出」把这一份写进这格 —— 同时抄进剪贴板、并写进这一局的' +
      '「存档」变量与这台机器的永久档。要还原就按「从存档取回」（另开一局也读得回来）；' +
      '换了机器，才需要把那段文本粘回这一格再点「从上面那格读回」。">' +
      '</textarea>' +
      '  <div class="hud-archive__row">' +
      '    <button type="button" class="hud-btn hud-btn--quiet" data-act="' + ACT_OUT + '">' +
      '导出到上面那格</button>' +
      '    <button type="button" class="hud-btn hud-btn--quiet" data-act="' + ACT_LOAD + '">' +
      '从存档取回</button>' +
      '    <button type="button" class="hud-btn hud-btn--quiet" data-act="' + ACT_IN + '">' +
      '从上面那格读回</button>' +
      '  </div>' +
      '  <div class="hud-archive__note" data-archive-note hidden></div>' +
      '</div>';
  }

  function noteIn(scope, text, kind) {
    var n = scope.querySelector('[data-archive-note]');
    if (!n) return;
    n.hidden = !text;
    n.className = 'hud-archive__note' + (kind ? ' ' + kind : '');
    n.textContent = text || '';
  }

  /* 从被点的那个扣子往上找，找到这一块所在的建卡器根 ——
     读表单、写状态提示都在这根里做，不碰页面别处。 */
  function createRootOf(node) {
    var t = node;
    while (t && t.getAttribute && !t.getAttribute('data-create')) t = t.parentNode;
    return (t && t.getAttribute) ? t : null;
  }

  /* 抄进剪贴板。宿主不让写就当作没这一步 —— 文字已经在格子里全选着，
     Ctrl+C 一样管用，不必为它报错。 */
  function copyText(text) {
    try {
      if (window.navigator && window.navigator.clipboard &&
          typeof window.navigator.clipboard.writeText === 'function') {
        return window.navigator.clipboard.writeText(text);
      }
    } catch (e) { /* 落到下面 */ }
    return Promise.reject(new Error('这一版不让脚本写剪贴板'));
  }

  function exportOut(hud, scope) {
    var box = scope.querySelector('[data-archive-box]');
    var root = createRootOf(scope);
    noteIn(scope, '正在读变量…');
    return hud.readState().then(function (state) {
      var draft = root ? hud.readCreateForm(root) : null;
      var data = pack(hud, state, draft);
      var text = JSON.stringify(data, null, 2);   /* 给人看、抄走的那一份 */
      var tight = JSON.stringify(data);           /* 过夜的那一份，不带缩进 */
      if (box) {
        box.value = text;
        if (box.select) box.select();     /* 顺手全选：接着 Ctrl+C 就行 */
      }
      var what = data.档案
        ? '：带着变量里那份档案，也带着界面这一份草稿'
        : (draft ? '：只带界面这一份草稿 —— 变量里还没有封缄过的档案，读回时只填界面、不动变量'
                 : '：只带变量里那份档案');
      var head = '已把这一份写成文本放在上面那格（' + text.length + ' 字）' + what +
        '，并存进了这一局的「存档」变量（' + tight.length + ' 字）与这台机器的永久档 —— ' +
        '关掉软件、另开一局新对话回来，按「从存档取回」都填得回来。';
      /* 存变量与抄剪贴板互不依赖：一个不成不该带走另一个，所以两边分开收尾 */
      return store(hud, scope, data).then(function (kept) {
        keptIn(scope, tight.length);
        var tail = kept ? ' ' + kept : '';
        return copyText(text).then(function () {
          noteIn(scope, head + '那段也顺手抄进剪贴板了，存到别处多一份保险。' + tail,
            kept ? 'is-error' : 'is-ok');
        }).catch(function () {
          noteIn(scope, head + '这一版不让脚本写剪贴板 —— 那格已经全选，按 Ctrl+C 抄走存好。' + tail,
            kept ? 'is-error' : 'is-ok');
        });
      });
    }).catch(function (err) {
      noteIn(scope, '导出失败：' + hud.msgOf(err), 'is-error');
    });
  }

  /* 从「存档」那一格里把表单填回来 —— 重启软件、关掉对话再回来，靠的就是这一颗。
     先读这一局那一格；本局还没有（新一局本来就是空的）就退到这台机器的永久档 ——
     「新对话干净开局」与「捏好的角色日后再开一局也读回来」这两半，就在这一处接上。
     只填界面，**不覆盖已经封缄的那份档案**：那一份是会给剧情改的（升级、花钱、
     拿东西），照旧备份盖回去等于把玩家的进展抹了。
     要连档案一起盖，那是「从上面那格读回」的活 —— 得人看着那段文字自己按。 */
  function loadSaved(hud, scope) {
    var root = createRootOf(scope);
    noteIn(scope, '正在读变量…');
    return hud.readState().then(function (state) {
      var saved = savedOf(hud, state);
      var from = '这一局的存档';
      if (!saved) {
        var perm = permRead();
        if (!perm) {
          noteIn(scope, '这一局还没有存档，这台机器的永久档里也是空的 —— ' +
            '按「导出」会存一份，封缄时也会顺手存一份。', 'is-error');
          return;
        }
        saved = perm.text;
        from = '这台机器的永久档（' + permBrief(perm) + '）';
      }
      var got = parse(hud, saved);
      if (!got.ok) { noteIn(scope, '存档里那段读不出来：' + got.msg, 'is-error'); return; }
      var data = got.data;
      var draft = hud.plain(data.草稿);
      var prof = hud.plain(data.档案);
      if (prof && !hasAny(hud, prof)) prof = null;
      var box = scope.querySelector('[data-archive-box]');
      if (box) box.value = JSON.stringify(data, null, 2);   /* 顺手摆出来，好核 */
      keptIn(scope, saved.length);
      var n = root ? fillForm(hud, root, draft || prof) : 0;
      var odd = (hud.num(data.version, VERSION) !== VERSION)
        ? '（这段是 v' + hud.num(data.version, 0) + ' 的格式，我按认得的栏填的，回头核一眼。）' : '';
      noteIn(scope, '已照' + from + '把表单填回 ' + n + ' 栏' +
        (prof ? '（存档里那份档案没动：它在变量里本来就一直在）。' : '。') + odd, 'is-ok');
    }).catch(function (err) {
      noteIn(scope, '取回存档失败：' + hud.msgOf(err), 'is-error');
    });
  }

  /* 把读回来的草稿摊进表单。表单是这一页唯一的「正在填的」地方，
     所以导入必须落在它上面 —— 变量写回去了但界面没动，人会以为没成功。 */
  function fillForm(hud, root, src) {
    var n = 0;
    var list = root.querySelectorAll('[data-field]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var key = el.getAttribute('data-field');
      var type = el.getAttribute('data-type');
      if (!key || !src || src[key] === undefined) continue;
      el.value = (type === 'list') ? hud.joinList(src[key])
        : (src[key] == null ? '' : String(src[key]));
      n++;
    }
    return n;
  }

  function importIn(hud, scope) {
    var box = scope.querySelector('[data-archive-box]');
    var got = parse(hud, box ? box.value : '');
    if (!got.ok) { noteIn(scope, got.msg, 'is-error'); return; }

    var data = got.data;
    var odd = (hud.num(data.version, VERSION) !== VERSION)
      ? '（这段是 v' + hud.num(data.version, 0) + ' 的格式，我按认得的栏填的，回头核一眼。）' : '';
    var draft = hud.plain(data.草稿);
    var prof = hud.plain(data.档案);
    /* 有「档案」这个键、里面却什么都没有（手改坏的、或者是别处拼出来的）：
       当它没有 —— 拿一份空档案去写变量，等于把玩家现在的档案抹成初值。 */
    if (prof && !hasAny(hud, prof)) prof = null;

    var root = createRootOf(scope);
    var n = 0;
    if (root) n = fillForm(hud, root, draft || prof);

    /* 粘进来这份顺手也存回变量：往后重启回来，按「从存档取回」就能再填一遍。
       存的是刚粘进去的那段（紧凑地重写一遍），不是表单的实时快照 ——
       想把眼下这份存起来，按「导出」。 */
    var tight = JSON.stringify(data);

    /* 这段里没带封缄过的档案：界面填好、存档换上就行，玩家那份档案一根手指都不碰 */
    if (!prof) {
      noteIn(scope, '已读回：界面这一份填好了（' + n + ' 栏），正在存进「存档」…');
      store(hud, scope, data).then(function (kept) {
        keptIn(scope, tight.length);
        noteIn(scope, '已读回：界面这一份填好了（' + n + ' 栏），也存回了「存档」变量。' +
          '这段没带封缄过的档案，变量里那份档案没动 —— 填好之后按「封缄 · 开始」就写进去了。' +
          odd + (kept ? ' ' + kept : ''), kept ? 'is-error' : 'is-ok');
      });
      return;
    }
    noteIn(scope, '已读回：界面填好了，正在把这份档案写回变量…');
    hud.writeObject(hud.CONFIG.playerObject, norm(hud, prof), scope).then(function (warn) {
      /* 两笔变量写必须一前一后：每一笔都是「读出整份 → 改一处 → 整份写回」，
         并行跑的话，后写的那一笔带着自己先前读到的旧状态，会把前一笔盖掉。 */
      return store(hud, scope, data).then(function (kept) {
        keptIn(scope, tight.length);
        var tail = (warn ? ' ' + warn : '') + (kept ? ' ' + kept : '');
        noteIn(scope, '已读回：界面填好了，变量里那份档案也写回去了 —— 面板与悬浮球照它显示，' +
          '这一份也存回了「存档」变量。' + odd + tail, (warn || kept) ? 'is-error' : 'is-ok');
      });
    }).catch(function (err) {
      noteIn(scope, '界面已经填好了，可那份档案没写进变量：' + hud.msgOf(err) +
        '。界面上的值都还在，按「封缄 · 开始」可以再写一次。' + odd, 'is-error');
    });
  }

  /* 一下一下点不重复跑：读变量是异步的，手快的人容易点两遍。 */
  function once(hud, scope, fn) {
    var block = scope.querySelector('[data-archive]');
    if (block && block.getAttribute(BUSY)) return;
    if (block) block.setAttribute(BUSY, '1');
    var done = function () { if (block) block.removeAttribute(BUSY); };
    var r;
    try {
      r = fn();
    } catch (e) {
      done();
      noteIn(scope, '这一下没走通：' + hud.msgOf(e), 'is-error');
      return;
    }
    if (r && typeof r.then === 'function') r.then(done, done);
    else done();
  }

  /* 自检里用：CONFIG.fields 里有没有这一种栏。找不到就跳过那条断言 ——
     某张卡把栏改成别的样子时，自检不该跟着崩。 */
  function fieldOf(hud, type) {
    var F = hud.CONFIG.fields || [];
    for (var i = 0; i < F.length; i++) {
      if (F[i].type === type) return F[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------ 接线 */

  function register() {
    var hud = window.CARDC73C60_HUD;
    if (!hud || typeof hud.useModule !== 'function') return;

    hud.useModule({
      name: '备份',
      /* 建卡器：档位那一行底下、表单与「封缄」之间 */
      create: function (state) { return blockHtml(hud, state); },
      /* 要从整页收点击：扣子长在核心画出来的建卡器里，核心不认得这两个动作。
         挂在 document 上只认自家那一块（先往上找到 [data-create]，再看块在不在）。 */
      mount: function (h) {
        var use = h || hud;
        document.addEventListener('click', function (ev) {
          var t = ev.target;
          while (t && t.getAttribute && !t.getAttribute('data-act')) t = t.parentNode;
          if (!t || !t.getAttribute) return;
          var act = t.getAttribute('data-act');
          if (act !== ACT_OUT && act !== ACT_LOAD && act !== ACT_IN) return;
          var scope = createRootOf(t);
          if (!scope || !scope.querySelector('[data-archive]')) return;
          ev.preventDefault();
          once(use, scope, function () {
            if (act === ACT_OUT) return exportOut(use, scope);
            if (act === ACT_LOAD) return loadSaved(use, scope);
            return importIn(use, scope);
          });
        });
      },
      /* 封缄那一笔写落定之后叫一次。核心写完调这一处，模块不自己掐时机：
         这一刻 readState 读到的已经是封缄之后的那一份，所以「档案」带得上。
         自己抢在封缄前面做会把刚写进去的档案盖回旧值 —— 每一笔写都是
         「读出整份 → 改一处 → 整份写回」。 */
      afterSubmit: function (h, root) {
        var use = h || hud;
        var scope = createRootOf(root) || root;
        if (!scope || typeof scope.querySelector !== 'function') return;
        if (!scope.querySelector('[data-archive]')) return;
        return once(use, scope, function () {
          return use.readState().then(function (state) {
            var data = pack(use, state, use.readCreateForm(scope));
            var n = JSON.stringify(data).length;
            return store(use, scope, data).then(function (kept) {
              keptIn(scope, n);
              noteIn(scope, '封缄的同一口气里，也把这一份存进了这一局的「存档」' +
                '与这台机器的永久档 —— 重启回来、或者干脆另开一局新对话，' +
                '按「从存档取回」都能把表单填回来。' +
                (kept ? ' ' + kept : ''), kept ? 'is-error' : 'is-ok');
            });
          });
        });
      },
      自检: function () {
        var good = JSON.stringify({ format: FORMAT, version: VERSION, 草稿: null, 档案: null });
        var numF = fieldOf(hud, 'number');
        var listF = fieldOf(hud, 'list');
        var big = {}, many = {};
        if (numF) big[numF.key] = 99999999;
        if (listF) many[listF.key] = '甲\n\n　乙　';
        var keep = { 没见过的键: { 深: 1 }, 另一个: '留着' };
        return [
          ['空着的一格读不出来', !parse(hud, '').ok],
          ['不是 JSON 的一段读不出来', !parse(hud, '{这不是 JSON').ok],
          ['别家的存档读不出来（format 对不上）', !parse(hud,
            JSON.stringify({ format: '别人的卡.card-archive' })).ok],
          ['数组不是存档（JSON 里能读出来的不止对象）', !parse(hud, '[]').ok],
          ['自家格式的存档读得出来', parse(hud, good).ok],
          ['认下来的存档带着草稿与档案两块', '草稿' in parse(hud, good).data &&
            '档案' in parse(hud, good).data],
          ['空对象不算「有一份档案」', !hasAny(hud, {})],
          ['一栏都没填的档案也不算', !hasAny(hud, { a: '', b: [], c: {} })],
          ['填过的档案就算', hasAny(hud, { a: '甲' }) && hasAny(hud, { a: [1] }) &&
            hasAny(hud, { 深: { 再深: '乙' } })],
          ['数字栏被夹进上下限', !numF || numF.max == null || norm(hud, big)[numF.key] <= numF.max],
          ['多行栏：单写一个字符串也认，空白项不留',
            !listF || norm(hud, many)[listF.key].join('|') === '甲|乙'],
          ['档案里多出来的键一个不丢（变量树比建卡器长是常态）',
            !!norm(hud, keep)['没见过的键'] && norm(hud, keep)['另一个'] === '留着'],

          /* 存档位这一组：读错一格（读成玩家档案、或者读成空）不会报错，
             只会让「取回」把人的表单填成别的东西 —— 所以把落点钉住。 */
          ['存档位：CONFIG 里那两个名字都写了',
            !!hud.str(hud.CONFIG.archiveObject) && !!hud.str(hud.CONFIG.archiveSlot)],
          ['存档位：读的是 CONFIG 指的那一格（没写死在模块里）', (function () {
            var box = {}, slot = {};
            slot[hud.CONFIG.archiveSlot] = '一段存档';
            box[hud.CONFIG.archiveObject] = slot;
            return savedOf(hud, { stat_data: box }) === '一段存档';
          })()],
          ['存档位：这一局没存过的时候读出来是空串（不是 undefined）',
            savedOf(hud, { stat_data: {} }) === '' && savedOf(hud, {}) === ''],
          ['核心的初值里有那个机器位（面板按初值的对象列表画，少了它空局时不出现那一行）',
            !!(hud.DEFAULTS && hud.DEFAULTS[hud.CONFIG.archiveObject])],
          ['「这一局存着没有」那句话两种情形都说得出',
            keptText(0).indexOf('还没有存档') >= 0 && keptText(120).indexOf('120 字') >= 0],

          /* 永久档那一组。它跨局，所以坏了最难发现：本局那份变量还在，界面看着
             一切正常，只有「另开一局把角色读回来」这一件事安静地没了。
             这几条自己写自己读，不碰谁的真存档（宿主桩里那份 localStorage 是
             内存里的，写完就散，跑测试不会伤到任何人的角色）。 */
          ['永久档：钥匙从 FORMAT 派生（两张卡各存各的，不会互相盖掉）',
            SLOT_KEY.indexOf(FORMAT) === 0 && SLOT_KEY !== FORMAT],
          ['永久档：写进去读得回来，文字一模一样', (function () {
            if (!permStore()) return true;                 /* 宿主没给存储，没得测 */
            var t = JSON.stringify({ format: FORMAT, 探针: '甲' });
            permWrite(t);
            var back = permRead();
            return !!back && back.text === t;
          })()],
          ['永久档：空的一串不写（写了等于把玩家留着的那份清成空的）',
            !permStore() || permWrite('') === false],
          ['永久档：坏掉的那段当没有，不是抛出来', (function () {
            var ls = permStore();
            if (!ls) return true;
            var keep = ls.getItem(SLOT_KEY);
            ls.setItem(SLOT_KEY, '{这不是 JSON');
            var bad = permRead();
            if (keep === null) ls.removeItem(SLOT_KEY); else ls.setItem(SLOT_KEY, keep);
            return bad === null;
          })()],
          ['永久档：那一行两种情形都说得出（有 / 没有）',
            permText(null).indexOf('没有东西') >= 0 &&
            permText({ at: '2026-09-26T02:41:00.000Z', text: '甲乙丙' }).indexOf('3 字') >= 0]
        ];
      }
    });
  }

  register();
})();
