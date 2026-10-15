/* ============================================================================
 * 代笔模块 —— 把一栏「交给 AI 起一版」，再把 AI 回的那一块搬进栏里
 *
 * 卡里没有第二条通道能让 AI 把文字交回界面：它能写的地方只有对话。
 * 所以这一套走的是对话那条路，规矩定死在两处：
 *   · 请求：一段带记号（AI_REQ_MARK）的正文，末尾写明「只回【代笔 · 栏位名】这一块」；
 *   · 回话：AI 照那一块回，界面从**最后一条**消息里切出【代笔 · 栏位名】，
 *     塞回对应的那一栏 —— 搬进去之后照样能手改。
 *
 * **这一份也不写死栏位名。** 建卡器有哪几栏（hud.CONFIG.fields），这里就摆几对
 * 「AI 代笔 / 取回」扣子；栏的类型决定请求里怎么写、回话怎么切：
 *   · 一行文本 → 压成一行，剥掉引号与「一行：」那种壳，掐到 TEXT_CAP；
 *   · 数字     → 只认一个数，按那一栏的上下限夹住（表单是同一套上下限）；
 *   · 一行一件 → 按行 / 顿号 / 逗号切开，剥编号与圆点，去重，掐到 LIST_CAP。
 * 哪一栏不想让 AI 碰，把它的 key 写进下面的 SKIP —— 别的一字不用改。
 *
 * 回话怎么认（三道闸，缺一条就会把旧回复或自己的请求搬进栏里）：
 *   1. 不是空的；2. 不是我们自己发出去的那份请求；3. 跟按下去那一刻的末条不一样。
 * 认下来之后自动搬 —— 每 2.5 秒看一眼宿主最后一条消息；宿主肯转发
 * agent.run.finished 事件时就更快，不转也照样兜得住。
 *
 * 送出去有两条路，只看宿主的接口通哪条：
 *   · input.set  → 只填进对话输入框，由玩家自己按发送（**默认**，不会把人从建卡器卷走）；
 *   · chat.send  → 直接发。要玩家自己拨开关换成这条。
 * 两条都不通时界面如实说：把请求整段复制给 AI，回完点「取回」。
 *
 * 自检写在下面 自检() 里，测的是「切与认」那一半：块切错、清单切不干净、
 * 自家人发出去的请求被当成回复 —— 这三样都不报错，只会安静地把栏填坏。
 * ========================================================================== */
(function () {
  'use strict';

  /* 我们自己发出去的请求里必带这一句。末条消息里若是它，说明 AI 还没回 ——
     没有这个记号，「取回」会把我们自己写的那份格式模板当成回复搬进栏里。 */
  var MARK = '（这是建卡器发来的代笔请求';

  var TEXT_CAP = 60;        /* 一行文本的栏：最多留这么长 */
  var LIST_CAP = 8;         /* 「一行一件」的栏：最多留这么多条 */
  var POLL_MS = 2500;       /* 等回话时多久看一眼最后一条消息 */
  var WAIT_SENT_MS = 120000;  /* 请求已经发出去了：两分钟没回就松开扣子 */
  var WAIT_HOLD_MS = 600000;  /* 只填进输入框：给玩家十分钟按发送 */

  /* 哪几栏不让 AI 碰（写 hud.CONFIG.fields 里的 key）。
     默认一个都不跳 —— 「等级」「钱币」这种数字栏也给得：请求里只要一个数字，
     回话照样按上下限夹住，玩家不满意自己改就是了。 */
  var SKIP = [];

  /* ------------------------------------------------- 切与认（不碰 DOM 的那一半） */

  /* 从一段文本里切出所有【代笔 · 栏位名】块。一次问了好几栏就切出好几块 ——
     「取回全部」靠它一次搬完。 */
  function parseBlocks(text) {
    var s = String(text == null ? '' : text);
    var re = /【代笔\s*·\s*([^】\n]{1,12})】/g;
    var m, marks = [], out = {};
    while ((m = re.exec(s)) !== null) {
      marks.push({ label: m[1].replace(/\s+/g, ''), head: m.index, end: m.index + m[0].length });
    }
    for (var i = 0; i < marks.length; i++) {
      var stop = marks[i + 1] ? marks[i + 1].head : s.length;
      out[marks[i].label] = s.slice(marks[i].end, stop);
    }
    return out;
  }

  /* 这条回复能不能收。三条一起判：不是空的、不是我们自己那份请求、
     也不是「按下扣子那一刻就已经摊在那儿」的那一条 ——
     少了最后一条，重复点同一栏会把上一轮的旧回复再搬一遍，看着像成了，其实没有。 */
  function acceptable(text, base) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return false;
    if (s.indexOf(MARK) >= 0) return false;
    if (base && s === String(base).trim()) return false;
    return true;
  }

  /* 「一行一件」的栏：按行、顿号、逗号、分号、斜线切开，剥掉行首的编号与圆点，
     去重去空，掐掉超长项，最后按 cap 截断。AI 爱写成「1. 追踪」或「· 弓术」，
     那两种壳都在这里剥掉。 */
  function splitList(hud, raw, cap) {
    var parts = String(raw == null ? '' : raw).split(/[\n\r；;、，,\/／|]+/);
    var out = [], seen = {};
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i]
        .replace(/^[\s\-–—·•*・\d.．、)）(（【】[\]]+/, '')
        .replace(/[\s。.！!]+$/, '')
        .trim();
      if (!v || v.length > 24) continue;
      if (seen[v]) continue;
      seen[v] = 1;
      out.push(v);
      if (out.length >= Math.max(1, hud.num(cap, 1))) break;
    }
    return out;
  }

  /* 单行栏：压成一行的空格，剥掉 AI 爱加的引号、书名号与「一行：」这类壳。 */
  function oneLine(raw, cap) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    s = s.replace(/^[「『"'“‘]+/, '').replace(/[」』"'”’]+$/, '');
    s = s.replace(/^[（(【\[]?\s*(一行|答案|结果|不超过\s*\d+\s*字)\s*[:：]?\s*/, '');
    s = s.replace(/[，,、；;。]+$/, '').trim();
    if (cap && s.length > cap) s = s.slice(0, cap);
    return s;
  }

  function pickText(m) {
    return String((m && (m.content || m.text || m.message)) || '');
  }

  /* 末条可读的正文。空消息（宿主偶尔留白）跳过。 */
  function lastSay(list) {
    if (!list || !list.length) return '';
    for (var i = list.length - 1; i >= 0; i--) {
      var s = pickText(list[i]).trim();
      if (s) return s;
    }
    return '';
  }

  /* 这一版宿主该怎么把请求送出去。两条路都通时看玩家拨的开关：
     拨到「直接发」就走 chat.send，否则只填进输入框。
     只通一条就走那一条；都不通返回空串，界面如实说，让玩家自己复制。 */
  function sendMode(caps, direct) {
    var canChat = !!(caps && caps.chat);
    var canInput = !!(caps && caps.input);
    if (!canChat && !canInput) return '';
    if (!canInput) return 'chat';
    if (!canChat) return 'input';
    return direct ? 'chat' : 'input';
  }

  /* 建卡器上要摆代笔扣子的那几栏，从 CONFIG.fields 现读。 */
  function slots(hud) {
    var out = [], F = hud.CONFIG.fields || [];
    for (var i = 0; i < F.length; i++) {
      var f = F[i];
      if (SKIP.indexOf(f.key) >= 0) continue;
      out.push({
        key: f.key, label: f.label || f.key, kind: f.type,
        min: f.min, max: f.max, tip: f.hint || ''
      });
    }
    return out;
  }

  /* 按栏位名（或者栏位 key —— AI 偶尔照 key 写）找那一栏 */
  function slotOf(hud, name) {
    var all = slots(hud), s = String(name == null ? '' : name).trim();
    for (var i = 0; i < all.length; i++) {
      if (all[i].label === s || all[i].key === s) return all[i];
    }
    return null;
  }

  /* 写进请求里的那句「要什么」。谁定的？这一栏的类型定的 —— 不另外维护一张表。 */
  function wantOf(s) {
    if (s.kind === 'list') return '3 – 6 条，一条一行';
    if (s.kind === 'number') {
      var lo = (s.min == null) ? '' : String(s.min);
      var hi = (s.max == null) ? '' : String(s.max);
      var range = (lo || hi) ? '（' + (lo || '不限') + ' – ' + (hi || '不限') + '）' : '';
      return '只回一个数字' + range;
    }
    return '一行，不超过 40 字';
  }

  function tipOf(s) {
    if (s.tip) return s.tip;
    if (s.kind === 'list') return '只写条目本身，不写解释、不给数值';
    if (s.kind === 'number') return '只回数字，不要任何说明';
    return '照这一栏的名字写，写看得见的东西，不要写成一段故事';
  }

  /* ------------------------------------------------------------ 界面那一块 */

  function barHtml(hud, s) {
    return '<div class="hud-ai__row">' +
      '<span class="hud-ai__l">' + hud.esc(s.label) + '</span>' +
      '<button type="button" class="hud-btn hud-btn--quiet" data-act="ai" data-slot="' +
      hud.esc(s.key) + '">AI 代笔</button>' +
      '<button type="button" class="hud-btn hud-btn--quiet" data-act="ai-take" data-slot="' +
      hud.esc(s.key) + '">取回</button>' +
      '<span class="hud-ai__hint">' + hud.esc(wantOf(s)) + '</span>' +
      '</div>';
  }

  function blockHtml(hud, state) {
    var all = slots(hud), rows = [];
    for (var i = 0; i < all.length; i++) rows.push(barHtml(hud, all[i]));
    return '' +
      '<div class="hud-ai" data-ai>' +
      '  <div class="hud-ai__t">AI 代笔</div>' +
      '  <div class="hud-ai__lead">让它先给一版，你再改 —— 取回来的内容跟手打进去的没有两样。' +
      '点某一栏的「AI 代笔」，请求会填进对话输入框（或直接发出去），AI 回完自动搬进那一栏。' +
      '</div>' +
      '  <div class="hud-ai__top">' +
      '    <button type="button" class="hud-btn hud-btn--quiet" data-act="ai-direct">' +
      '代笔：只填不送</button>' +
      '    <button type="button" class="hud-btn hud-btn--quiet" data-act="ai-all">取回全部</button>' +
      '  </div>' +
      '  <div class="hud-ai__rows">' + rows.join('') + '</div>' +
      '  <div class="hud-ai__out" data-ai-out hidden></div>' +
      '  <div class="hud-ai__note" data-ai-note hidden></div>' +
      '</div>';
  }

  function noteIn(root, text, kind) {
    var n = root.querySelector('[data-ai-note]');
    if (!n) return;
    n.hidden = !text;
    n.className = 'hud-ai__note' + (kind ? ' ' + kind : '');
    n.textContent = text || '';
  }

  /* 请求摊在这儿：宿主不给代发、也填不了输入框时，玩家能自己整段复制走。 */
  function outIn(root, html) {
    var box = root.querySelector('[data-ai-out]');
    if (!box) return;
    box.hidden = !html;
    box.innerHTML = html || '';
  }

  function createRootOf(node) {
    var t = node;
    while (t && t.getAttribute && !t.getAttribute('data-create')) t = t.parentNode;
    return (t && t.getAttribute) ? t : null;
  }

  /* 每一处建卡器各自记一份状态（等待中的栏、基线末条、定时器、开关）——
     挂在根元素上，页面里有两处建卡器也不会互相串。 */
  function stOf(root) {
    if (!root.__hudAi) {
      root.__hudAi = { waiting: {}, base: {}, timers: {}, poll: null,
        direct: false, lastReq: '', evBound: false };
    }
    return root.__hudAi;
  }

  function btnOf(root, act, key) {
    var list = root.querySelectorAll('[data-act="' + act + '"]');
    for (var i = 0; i < list.length; i++) {
      if (list[i].getAttribute('data-slot') === key) return list[i];
    }
    return null;
  }

  /* 这一栏现在写着什么 —— 有内容就润色，空着就现写 */
  function valueOf(hud, root, s) {
    var got = hud.readCreateForm(root)[s.key];
    if (s.kind === 'list') return hud.isArr(got) ? got.join('、') : hud.str(got);
    return hud.str(got);
  }

  /* 给 AI 的上下文：他已经填了什么。填得越全，代笔出来的越像这个人。 */
  function contextOf(hud, root) {
    var form = hud.readCreateForm(root), bits = [], all = slots(hud);
    for (var i = 0; i < all.length; i++) {
      var s = all[i], v = form[s.key];
      var text = hud.isArr(v) ? v.join('、') : hud.str(v);
      if (!text) continue;
      if (s.kind === 'number' && s.min != null && hud.num(text, s.min) === s.min) continue;  /* 没动过的下限值不算填过 */
      bits.push(s.label + ' ' + text);
    }
    return bits.length ? bits.join('；') : '（还什么都没填）';
  }

  /* -------------------------------------------------- 「生成中…」与自动取回 */

  function pendingKeys(st) {
    var out = [];
    Object.keys(st.waiting).forEach(function (k) { if (st.waiting[k]) out.push(k); });
    return out;
  }

  /* 按下去这一刻，末条是什么。存着用来认「后来这条才是新回的」。 */
  function snapshot(hud, st, key) {
    st.base[key] = '';
    var e = hud.api();
    if (!e || !e.messages || typeof e.messages.list !== 'function') return Promise.resolve();
    return Promise.resolve().then(function () { return e.messages.list(); })
      .then(function (list) { st.base[key] = lastSay(list); })
      .catch(function () { /* 读不到就当没有基线：MARK 那道闸还在 */ });
  }

  function waitOn(hud, root, st, key, hold) {
    st.waiting[key] = hold ? 'hold' : 'sent';
    var btn = btnOf(root, 'ai', key);
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-waiting');
      if (hold) btn.classList.add('is-hold');
      btn.textContent = hold ? '待发送' : '生成中…';
    }
    if (st.timers[key]) clearTimeout(st.timers[key]);
    st.timers[key] = setTimeout(function () {
      delete st.timers[key];
      waitOff(hud, root, st, key);
      noteIn(root, hold
        ? '代笔请求还压在对话输入框里没发出去（等了十分钟），先把扣子松开。'
        : '等了两分钟还没等到 AI 的回复。它要是后来回了，点那一栏的「取回」照样能搬进来。',
        'is-error');
    }, hold ? WAIT_HOLD_MS : WAIT_SENT_MS);
    bindRunEvents(hud, root, st);
    pollStart(hud, root, st);
  }

  function waitOff(hud, root, st, key) {
    if (st.timers[key]) { clearTimeout(st.timers[key]); delete st.timers[key]; }
    if (!st.waiting[key]) return;
    delete st.waiting[key];
    var btn = btnOf(root, 'ai', key);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-waiting');
      btn.classList.remove('is-hold');
      btn.textContent = 'AI 代笔';
    }
    if (!pendingKeys(st).length) pollStop(st);
  }

  /* 封缄、重置这类「这一页要翻篇」的动作，把还按着的扣子都松开 */
  function waitClear(hud, root, st) {
    pendingKeys(st).forEach(function (k) { waitOff(hud, root, st, k); });
    pollStop(st);
  }

  function pollStart(hud, root, st) {
    if (st.poll) return;
    st.poll = setInterval(function () { pollTick(hud, root, st); }, POLL_MS);
    pollTick(hud, root, st);
  }

  function pollStop(st) {
    if (st.poll) { clearInterval(st.poll); st.poll = null; }
  }

  function pollTick(hud, root, st) {
    if (!pendingKeys(st).length) { pollStop(st); return; }
    var e = hud.api();
    if (!e || !e.messages || typeof e.messages.list !== 'function') return;
    Promise.resolve().then(function () { return e.messages.list(); })
      .then(function (list) { absorb(hud, root, st, lastSay(list)); })
      .catch(function () { /* 这一跳读不到就等下一跳；真没回还有超时兜底 */ });
  }

  /* 宿主肯在 AI 跑完一条时往卡里转事件，这条最快；不转也不碍事，轮询兜得住 */
  function bindRunEvents(hud, root, st) {
    if (st.evBound) return;
    var e = hud.api();
    if (!e || !e.events || typeof e.events.on !== 'function') return;
    st.evBound = true;
    try {
      e.events.on('agent.run.finished', function (p) {
        if (!pendingKeys(st).length) return;
        var t = p && p.message ? pickText(p.message) : '';
        if (t && absorb(hud, root, st, t)) return;
        pollTick(hud, root, st);
      });
    } catch (err) { st.evBound = false; }
  }

  /* 把一块代笔塞回它该去的那一栏，返回一句能直接摊给玩家看的话。 */
  function applyBlock(hud, root, s, raw) {
    var el = root.querySelector('[data-field="' + s.key + '"]');
    if (s.kind === 'list') {
      var items = splitList(hud, raw, LIST_CAP);
      if (!items.length) return '「' + s.label + '」那一块没解析出东西。';
      if (el) el.value = items.join('\n');
      return '「' + s.label + '」已取回 ' + items.length + ' 条：' + items.join('、') +
        '。不满意就改，或者再点一次「AI 代笔」。';
    }
    if (s.kind === 'number') {
      var got = oneLine(raw, 12), n = hud.num(got, NaN);
      if (!isFinite(n)) return '「' + s.label + '」那一块里没读出数字。';
      var lo = (s.min == null) ? n : s.min, hi = (s.max == null) ? n : s.max;
      var v = Math.round(hud.clamp(n, lo, hi));
      if (el) el.value = String(v);
      return '「' + s.label + '」已取回：' + v + (v !== Math.round(n) ? '（原样回的是 ' + Math.round(n) +
        '，按这一栏的范围夹住了）' : '') + '。';
    }
    var val = oneLine(raw, TEXT_CAP);
    if (!val) return '「' + s.label + '」那一块是空的。';
    if (el) el.value = val;
    return '「' + s.label + '」已取回：' + val;
  }

  /* 从一段回复里把还在等的栏位搬进栏。搬动了就返回 true。
     搬不动的（这一条里没写那一块）留在等待里 —— 下一次回复还有机会。 */
  function absorb(hud, root, st, text) {
    var labels = pendingKeys(st).filter(function (key) {
      return acceptable(text, st.base[key]);
    });
    if (!labels.length) return false;
    var blocks = parseBlocks(text), got = [], miss = [];
    labels.forEach(function (key) {
      var s = slotOf(hud, key);
      if (!s) return;
      if (blocks[s.label] == null && blocks[s.key] == null) { miss.push(s.label); return; }
      got.push(applyBlock(hud, root, s, blocks[s.label] != null ? blocks[s.label] : blocks[s.key]));
      waitOff(hud, root, st, key);
    });
    if (!got.length) return false;
    noteIn(root, 'AI 回完了 —— ' + got.join(' ') +
      (miss.length ? '这条里没写的：' + miss.join('、') + '（想再要一版就再点一次「AI 代笔」）。' : ''),
      'is-ok');
    return true;
  }

  /* ------------------------------------------------------------------ 动作 */

  function request(hud, root, st, key) {
    var s = slotOf(hud, key);
    if (!s) return;
    var cur = valueOf(hud, root, s);
    var text = MARK + '。现在是建卡阶段，不用写正文剧情，只回这一块。）\n' +
      '【代笔 · ' + s.label + '】\n' +
      '要求：' + wantOf(s) + '。' + tipOf(s) + '。\n' +
      (cur
        ? '他已经写了：' + cur + '\n（请在这份内容上润色 —— 保留他的意思与关键信息，不要另起炉灶。）'
        : '他还没写。\n（请替他想一版。）') + '\n' +
      '当前档案：' + contextOf(hud, root) + '\n' +
      '只回下面这一块，别的都不要写：\n' +
      '【代笔 · ' + s.label + '】\n（内容）';

    var e = hud.api();
    var caps = {
      input: !!(e && e.input && typeof e.input.set === 'function'),
      chat: !!(e && e.chat && typeof e.chat.send === 'function')
    };
    var mode = sendMode(caps, st.direct);
    st.lastReq = text;
    outIn(root, '<div class="hud-ai__req"><b>代笔请求</b>' +
      '<span class="hud-ai__hint">' + (mode === 'chat'
        ? '直接发出去；AI 回完自动搬进这一栏'
        : (mode === 'input' ? '会填进对话输入框 —— 你按发送；AI 回完自动搬进这一栏'
                            : '这一版宿主既不能代发、也填不了输入框 —— 把下面这段自己复制给 AI')) +
      '</span><button type="button" class="hud-btn hud-btn--quiet" data-act="ai-copy">' +
      '复制这段</button><pre class="hud-ai__pre">' + hud.esc(text) + '</pre></div>');

    if (!mode) {
      noteIn(root, '这一版宿主既不能代发、也填不了输入框 —— 把下面那段自己复制给 AI，回完再点「取回」。');
      return;
    }

    /* 先记下按下去这一刻的末条，再送 —— 顺序反了，AI 还没回时上一轮那条带
       【代笔】的回复会被当成新回复搬一遍。 */
    var shot = snapshot(hud, st, key);

    if (mode === 'input') {
      shot.then(function () { return hud.call('input.set', [text]); }).then(function () {
        waitOn(hud, root, st, key, true);
        noteIn(root, '请求已填进对话输入框 —— 你按发送；AI 回完自动搬进「' + s.label + '」。' +
          '（这样不会把你从建卡器那边卷走。）');
      }).catch(function (err) {
        waitOff(hud, root, st, key);
        if (!caps.chat) {
          noteIn(root, '填不进输入框（' + hud.msgOf(err) + '）—— 下面那段自己复制给 AI，回完点「取回」。',
            'is-error');
          return;
        }
        /* 输入框这条道不通（比如对话没在前台），退回直接发：总比什么都不做强 */
        hud.call('chat.send', [text]).then(function () {
          waitOn(hud, root, st, key, false);
          noteIn(root, '输入框这条路不通（' + hud.msgOf(err) + '），改成直接发 —— AI 回完自动搬进「' +
            s.label + '」。');
        }).catch(function (err2) {
          noteIn(root, '代笔请求没发出去：' + hud.msgOf(err2) + '。下面那段自己复制给 AI。', 'is-error');
        });
      });
      return;
    }

    shot.then(function () { return hud.call('chat.send', [text]); }).then(function () {
      waitOn(hud, root, st, key, false);
      noteIn(root, '代笔请求已发出 —— AI 回完自动搬进「' + s.label + '」。');
    }).catch(function (err) {
      waitOff(hud, root, st, key);
      noteIn(root, '代笔请求没发出去：' + hud.msgOf(err) + '。下面那段可以自己复制给 AI。', 'is-error');
    });
  }

  /* 取回前的三道门：桥读不读得到消息、末条是不是还停在我们自己的请求上、
     末条有没有内容。三道都过了才把正文交给 fn。 */
  function withLastSay(hud, root, fn) {
    var e = hud.api();
    if (!e || !e.messages || typeof e.messages.list !== 'function') {
      noteIn(root, '这一版宿主读不到消息，取不回代笔 —— 把 AI 那一段直接复制粘进栏里也一样。',
        'is-error');
      return;
    }
    Promise.resolve().then(function () {
      return e.messages.list();
    }).then(function (list) {
      var text = lastSay(list);
      if (!text) { noteIn(root, '读不到 AI 的回复（末条是空的）。', 'is-error'); return; }
      if (text.indexOf(MARK) >= 0) {
        noteIn(root, '末条还是我们自己发出去的请求 —— AI 那边还没回，等一下再点「取回」。', 'is-error');
        return;
      }
      fn(text);
    }).catch(function (err) { noteIn(root, '取回失败：' + hud.msgOf(err), 'is-error'); });
  }

  function take(hud, root, st, key) {
    var s = slotOf(hud, key);
    if (!s) return;
    withLastSay(hud, root, function (text) {
      var blocks = parseBlocks(text);
      if (blocks[s.label] == null && blocks[s.key] == null) {
        noteIn(root, 'AI 这条回复里没有【代笔 · ' + s.label + '】那一块 —— 要么它换了个栏位名，' +
          '要么这一栏它没写。也可以把它那段直接复制粘进来。', 'is-error');
        return;
      }
      noteIn(root, applyBlock(hud, root, s, blocks[s.label] != null ? blocks[s.label] : blocks[s.key]));
      waitOff(hud, root, st, key);   /* 手动取回来了，那颗「生成中…」也该松开 */
    });
  }

  function takeAll(hud, root, st) {
    withLastSay(hud, root, function (text) {
      var blocks = parseBlocks(text), done = [], miss = [];
      slots(hud).forEach(function (s) {
        if (blocks[s.label] == null && blocks[s.key] == null) { miss.push(s.label); return; }
        applyBlock(hud, root, s, blocks[s.label] != null ? blocks[s.label] : blocks[s.key]);
        waitOff(hud, root, st, s.key);
        done.push(s.label);
      });
      if (!done.length) {
        noteIn(root, '这条回复里一块【代笔 · 〈栏位名〉】都没有 —— 看看它是不是没照格式回。', 'is-error');
        return;
      }
      noteIn(root, '已取回：' + done.join('、') + '。' +
        (miss.length ? '这条里没写的：' + miss.join('、') + '。' : ''), 'is-ok');
    });
  }

  /* 把最近那份请求抄到剪贴板 —— 宿主不让写剪贴板时如实说，让人自己框选 */
  function copyReq(hud, root, st) {
    if (!st.lastReq) {
      noteIn(root, '还没有请求可抄 —— 先点某一栏的「AI 代笔」。', 'is-error');
      return;
    }
    var noWay = '这一版不让脚本写剪贴板 —— 把下面那段用鼠标框住，按 Ctrl+C。';
    try {
      if (window.navigator && window.navigator.clipboard &&
          typeof window.navigator.clipboard.writeText === 'function') {
        window.navigator.clipboard.writeText(st.lastReq).then(function () {
          noteIn(root, '已抄走 —— 粘进对话输入框就行。', 'is-ok');
        }).catch(function () { noteIn(root, noWay, 'is-error'); });
        return;
      }
    } catch (err) { /* 落到下面 */ }
    noteIn(root, noWay, 'is-error');
  }

  /* 默认「只填不送」：一按发送宿主就把对话卷到最底下，而建卡器长在开场那一条里，
     人得自己爬回来。想省这次回车的人，把开关拨到「直接发」。 */
  function directToggle(hud, root, st, btn) {
    st.direct = !st.direct;
    if (btn) btn.textContent = '代笔：' + (st.direct ? '直接发' : '只填不送');
    noteIn(root, st.direct
      ? '代笔请求会直接发出去 —— 发完对话可能被卷到最底下（建卡器在开场那一条里，翻回去就有）。'
      : '代笔请求只填进对话输入框，你自己按发送 —— 这样不会把你从建卡器那边卷走。');
  }

  /* ------------------------------------------------------------------ 接线 */

  function register() {
    var hud = window.SKEL_HUD;
    if (!hud || typeof hud.useModule !== 'function') return;

    hud.useModule({
      name: '代笔',
      /* 建卡器：「封缄」那一排之前，摆一份每栏一对的扣子 */
      create: function (state) { return blockHtml(hud, state); },
      /* 扣子长在核心画出来的建卡器里，核心不认得这几个动作 —— 自己从 document 上收。
         只认自家那一块（先往上找到 [data-create]，再看块在不在）。 */
      mount: function (h) {
        var use = h || hud;
        document.addEventListener('click', function (ev) {
          var t = ev.target;
          while (t && t.getAttribute && !t.getAttribute('data-act')) t = t.parentNode;
          if (!t || !t.getAttribute) return;
          var act = t.getAttribute('data-act');
          if (act !== 'ai' && act !== 'ai-take' && act !== 'ai-all' &&
              act !== 'ai-direct' && act !== 'ai-copy') return;
          var root = createRootOf(t);
          if (!root || !root.querySelector('[data-ai]')) return;
          ev.preventDefault();
          var st = stOf(root);
          if (act === 'ai') { request(use, root, st, t.getAttribute('data-slot')); return; }
          if (act === 'ai-take') { take(use, root, st, t.getAttribute('data-slot')); return; }
          if (act === 'ai-all') { takeAll(use, root, st); return; }
          if (act === 'ai-direct') { directToggle(use, root, st, t); return; }
          copyReq(use, root, st);
        });
      },
      自检: function () {
        var two = '【代笔 · 姓名】\n甲\n【代笔 · 背包】\n短剑、干粮\n';
        var got = parseBlocks(two);
        var caps = { input: true, chat: true };
        var first = slotOf(hud, ((hud.CONFIG.fields || [])[0] || {}).key) || {};
        function many(c, n) { return new Array(n + 1).join(c); }
        return [
          ['切得出两块代笔（一次问两栏就回两块）',
            got['姓名'] !== undefined && got['背包'] !== undefined],
          ['第一块只到第二块的标题为止', String(got['姓名']).indexOf('背包') < 0],
          ['标题里的空格被去掉（【代笔 · 姓 名】也认）',
            parseBlocks('【代笔 · 姓 名】\n甲').hasOwnProperty('姓名')],
          ['没有块时给空对象，不是 null', Object.keys(parseBlocks('随便写点什么')).length === 0],
          ['空回复不收', !acceptable('', '')],
          ['我们自己发出去的请求不收', !acceptable(MARK + '。只回这一块。）', '')],
          ['与按下去那一刻一模一样的回复不收（重复点同一栏不会搬旧回复）',
            !acceptable('同一段正文', '同一段正文')],
          ['与那一刻不同的才是新回复', acceptable('新的一段正文', '旧的一段正文')],
          ['清单：编号与圆点都剥掉',
            splitList(hud, '1. 追踪\n· 弓术\n- 识途', 8).join('|') === '追踪|弓术|识途'],
          ['清单：顿号逗号也当分隔，重复项只留一个',
            splitList(hud, '追踪、弓术，追踪', 8).join('|') === '追踪|弓术'],
          ['清单：超长的一条（超过 24 字）不进来',
            splitList(hud, '短剑\n' + many('长', 30), 8).length === 1],
          ['清单：按上限截断', splitList(hud, '甲\n乙\n丙', 2).length === 2],
          ['单行：剥引号与「一行：」的壳', oneLine('「一行：甲某」', 60) === '甲某'],
          ['单行：压成一行、掐到上限',
            oneLine('甲\n\n乙', 60) === '甲 乙' && oneLine(many('甲', 80), 10).length === 10],
          ['末条：空消息跳过，取的是最后一条有字的',
            lastSay([{ content: '甲' }, { content: '  ' }, { content: '乙' }]) === '乙'],
          ['两条路都通时按开关走', sendMode(caps, true) === 'chat' && sendMode(caps, false) === 'input'],
          ['只通一条就走那一条',
            sendMode({ input: true }, true) === 'input' && sendMode({ chat: true }, false) === 'chat'],
          ['都不通就不发（界面如实说，让玩家自己复制）', sendMode({}, true) === ''],
          ['建卡器上每一栏都有一对扣子（SKIP 是空的时候）',
            slots(hud).length === (hud.CONFIG.fields || []).length],
          ['按栏位名或 key 都找得到那一栏', !!first.key &&
            slotOf(hud, first.label).key === first.key && slotOf(hud, first.key).key === first.key],
          ['三种栏都写得出「要什么」', !!wantOf({ kind: 'text' }) && !!wantOf({ kind: 'list' }) &&
            wantOf({ kind: 'number', min: 1, max: 20 }).indexOf('1') >= 0],
          ['「要什么」认的是栏的类型，不是谁的名字',
            wantOf({ kind: 'list' }).indexOf('条') >= 0 && wantOf({ kind: 'text' }).indexOf('行') >= 0]
        ];
      }
    });
  }

  register();
})();
