/* ============================================================================
 * 点数池模块 —— 给「六维 + 一笔预算」这套建卡数值配一套界面与算法
 *
 * 解决的是这一件事：建卡时那六个数字（力量、敏捷……）不是随手填的，它们花的是
 * 一笔预算 —— 可分配点 = 等级 × 每级点数 ＋ 永久奖励。人一边填一边得知道还剩
 * 几点，填完还得对得上；不然封缄之后面板上那个「剩余」当场就是负的。
 *
 * 这一份给四样：
 *   · 一行实时的「可分配 / 已用 / 剩余」，跟着你敲数字走；
 *   · 六格数字输入（写回的就是变量里那六项，走核心那条表单路，不另开一条）；
 *   · 一颗「交给命运」：把剩下的点按职业倾向一次撒开（没填职业就均摊）；
 *   · 六格「临时加成」＋ 一颗写回：加成是六个数的一个对象，**不进池子**。
 *
 * **默认值与卡无关，全都能换。** 六维叫什么、每级几点、职业那一栏叫什么、职业
 * 偏爱哪两项 —— 都在下面那几张表里。卡想换掉它们，在自己的 hud.core.js 的
 * CONFIG 里加一个 pool 块就行，一个字都不用改这里：
 *
 *     pool: {
 *       stats: ['筋骨', '灵巧', '根骨', '悟性', '神识', '气度'],
 *       per: 4,                     // 每级几点
 *       base: 1,                    // 每项从几起步
 *       level: '等级',               // 哪一栏是等级（算池子用）
 *       bonus: '永久奖励',           // 哪一栏并入池子
 *       add: '加成',                 // 临时加成写在哪个对象上
 *       job: '职业',                 // 哪一栏是职业（只用来决定撒点倾向）
 *       jobs: ['剑修', '丹修'],        // 下拉里那几项
 *       favor: { 剑修: ['筋骨', '灵巧'] }   // 职业 -> 偏爱哪两项
 *     }
 *
 * **这一份不写死任何卡名，也不读别的卡的东西。** 池子怎么算、撒得对不对，
 * 全在下面的 自检() 里跟着 测试/run_all.py 一起跑 —— 这几样错了都不报错，
 * 只会安静地把玩家的数值算歪：
 *   · 等级认不出来（空、乱写、0）时按 1 级算，不能让池子变成 NaN 或负数；
 *   · 「已用」只算**高于起点**的那部分，低于起点的项不倒扣；
 *   · 撒出去的点数总和正好等于要撒的点数（不超支也不剩）；
 *   · 加成只认六维那几个键，界面上多出来的东西一个都不写回。
 *
 * 接不接由 hud.conf.json 的「模块」说了算：不接，这个文件根本不在这张卡里。
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 默认值 */

  var DEFAULT_STATS = ['力量', '敏捷', '体质', '智力', '感知', '魅力'];

  var DEFAULT_JOBS = ['游侠', '剑士', '斥候', '咒术师', '学者',
                      '神父', '医士', '商人', '铁匠', '矿工'];

  /* 职业偏爱哪两项。认不出的职业 = 没有偏爱 = 六项均摊 —— 宁可均摊，
     也不要替玩家的职业瞎猜一条路。 */
  var DEFAULT_FAVOR = {
    游侠: ['敏捷', '感知'],
    剑士: ['力量', '体质'],
    斥候: ['敏捷', '感知'],
    咒术师: ['智力', '感知'],
    学者: ['智力', '感知'],
    神父: ['魅力', '感知'],
    医士: ['智力', '感知'],
    商人: ['魅力', '智力'],
    铁匠: ['力量', '体质'],
    矿工: ['力量', '体质']
  };

  /* 池子这一套的全部参数，一处读齐。卡没给就全用默认。 */
  function defOf(hud) {
    var cfg = hud.plain(hud.CONFIG && hud.CONFIG.pool) || {};
    var stats = hud.isArr(cfg.stats) ? cfg.stats : [];
    var jobs = hud.isArr(cfg.jobs) ? cfg.jobs : [];
    return {
      per: hud.num(cfg.per, 5),
      base: Math.max(0, Math.round(hud.num(cfg.base, 1))),
      level: hud.str(cfg.level) || '等级',
      bonus: hud.str(cfg.bonus) || '永久奖励',
      add: hud.str(cfg.add) || '加成',
      job: hud.str(cfg.job) || '职业',
      stats: stats.length ? [].slice.call(stats) : DEFAULT_STATS,
      jobs: jobs.length ? [].slice.call(jobs) : DEFAULT_JOBS,
      favor: hud.plain(cfg.favor) || DEFAULT_FAVOR
    };
  }

  /* 一个键一个值的对象（ES5 没有计算属性，只能这样绕一下）。 */
  function oneK(key, value) {
    var o = {};
    o[key] = value;
    return o;
  }

  function setText(node, text) {
    if (node) node.textContent = text == null ? '' : String(text);
  }

  /* 这一层只吃数字，不认 hud —— 认不出的值一律退回第二个参数，
     免得一个乱值（空串、'abc'、undefined）顺着算下去变成 NaN。 */
  function toNum(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).trim());
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  /* ------------------------------------------------- 池子（不碰 DOM 的那一半） */

  /* 池子大小：等级 × 每级点数 ＋ 永久奖励。
     等级认不出来（空、乱写、0 或负数）时按 1 级算 —— 池子宁可算小，
     也不能因为一个乱值算出 NaN 或负数，那样整页都跟着垮。 */
  function poolOf(def, level, bonus) {
    var lv = Math.round(toNum(level, 1));
    if (!(lv >= 1)) lv = 1;
    return Math.round(lv * def.per + toNum(bonus, 0));
  }

  /* 六维收成一份干净的数：缺的补起点，低于起点的抬回起点。 */
  function statsOf(hud, def, src) {
    var raw = hud.plain(src) || {};
    var out = {};
    for (var i = 0; i < def.stats.length; i++) {
      var k = def.stats[i];
      var v = Math.round(toNum(raw[k], def.base));
      out[k] = v < def.base ? def.base : v;
    }
    return out;
  }

  /* 已用点：六项**高于起点**的那部分之和。
     低于起点的项不倒扣 —— 少给的那个数不是「省下来的点数」，
     扣回去只会让「剩余」莫名其妙地变多。 */
  function spentOf(def, stats) {
    var s = 0;
    for (var i = 0; i < def.stats.length; i++) {
      var v = Math.round(toNum(stats && stats[def.stats[i]], def.base));
      if (v > def.base) s += v - def.base;
    }
    return s;
  }

  /* 撒点权重：六项各 1（保底，谁都有份），被职业偏爱的各再 +2。
     于是「偏爱 : 不偏爱 = 3 : 1」；认不出的职业就是全 1，也就是均摊。 */
  function weightsOf(hud, def, job) {
    var favor = hud.plain(def.favor) || {};
    var hit = favor[hud.str(job)];
    var fav = hud.isArr(hit) ? hit : [];
    var w = [];
    for (var i = 0; i < def.stats.length; i++) {
      var k = def.stats[i], extra = 0;
      for (var j = 0; j < fav.length; j++) {
        if (hud.str(fav[j]) === k) extra = 2;
      }
      w.push(1 + extra);
    }
    return w;
  }

  /* 把 total 点按权重分给六项：最大余数法 —— 先按比例取整，
     剩下的点给小数部分最大的那几项（并列时靠前的先拿）。
     总和**正好**等于 total，不超支也不剩 —— 这条在自检里钉死。 */
  function spread(total, weights) {
    var n = weights.length, out = [], frac = [], i;
    var left = Math.round(toNum(total, 0));
    var sum = 0;
    for (i = 0; i < n; i++) sum += toNum(weights[i], 0);
    if (!(left > 0) || !(sum > 0)) {
      for (i = 0; i < n; i++) out.push(0);
      return out;
    }
    var given = 0;
    for (i = 0; i < n; i++) {
      var ideal = left * toNum(weights[i], 0) / sum;
      var fl = Math.floor(ideal);
      out.push(fl);
      given += fl;
      frac.push(ideal - fl);
    }
    var rest = left - given;
    while (rest > 0) {
      var best = -1;
      for (i = 0; i < n; i++) {
        if (frac[i] >= 0 && (best < 0 || frac[i] > frac[best])) best = i;
      }
      if (best < 0) break;
      out[best] += 1;
      frac[best] = -1;          /* 一项这一轮只多拿一次 */
      rest -= 1;
    }
    return out;
  }

  /* 把 pool 这笔池子按职业倾向一次撒到 stats 上，返回新的六维。
     池子已经超支时一点不撒（不往回削玩家填的数，只如实报出来）。 */
  function spendPool(hud, def, stats, job, pool) {
    var cur = statsOf(hud, def, stats);
    var add = spread(toNum(pool, 0) - spentOf(def, cur), weightsOf(hud, def, job));
    var out = {};
    for (var i = 0; i < def.stats.length; i++) {
      var k = def.stats[i];
      out[k] = cur[k] + toNum(add[i], 0);
    }
    return out;
  }

  /* 临时加成：只认六维那几个键，界面上多出来的框一个都不写回变量；小数取整。 */
  function addsOf(hud, def, obj) {
    var raw = hud.plain(obj) || {};
    var out = {};
    for (var i = 0; i < def.stats.length; i++) {
      var k = def.stats[i];
      out[k] = Math.round(toNum(raw[k], 0));
    }
    return out;
  }

  /* 加成摊成一行人话：「力量+2 敏捷-1」。零的不写，免得一屏都是 +0。 */
  function addListOf(def, adds) {
    var bits = [];
    for (var i = 0; i < def.stats.length; i++) {
      var k = def.stats[i];
      var v = Math.round(toNum(adds && adds[k], 0));
      if (v) bits.push(k + (v > 0 ? '+' : '') + v);
    }
    return bits.join(' ');
  }

  /* ------------------------------------------------------------ 界面那一块 */

  function statCell(hud, def, key, value) {
    return '<label class="hud-pool__cell">' +
      '<span class="hud-pool__cl">' + hud.esc(key) + '</span>' +
      '<input class="hud-input hud-pool__in" type="number" data-field="' + hud.esc(key) +
      '" data-type="number" min="' + def.base + '" step="1" value="' +
      hud.esc(value) + '"></label>';
  }

  /* 加成那几格用 data-add，不是 data-field：它写的是**一个对象**，
     核心那条表单路只认「一个键一个值」，硬塞进去只会写坏。 */
  function addCell(hud, key, value) {
    return '<label class="hud-pool__cell hud-pool__cell--add">' +
      '<span class="hud-pool__cl">' + hud.esc(key) + '</span>' +
      '<input class="hud-input hud-pool__in" type="number" data-add="' + hud.esc(key) +
      '" step="1" value="' + hud.esc(value) + '"></label>';
  }

  function jobSelect(hud, def, job) {
    var cur = hud.str(job);
    var out = '<select class="hud-input" data-field="' + hud.esc(def.job) +
      '" data-type="text"><option value=""' + (cur ? '' : ' selected') +
      '>（不定）</option>';
    for (var i = 0; i < def.jobs.length; i++) {
      var j = hud.str(def.jobs[i]);
      out += '<option value="' + hud.esc(j) + '"' + (j === cur ? ' selected' : '') +
        '>' + hud.esc(j) + '</option>';
    }
    return out + '</select>';
  }

  function barHtml(hud, def, max, used, level, bonus) {
    var left = max - used;
    return '<div class="hud-pool__bar">' +
      '<span class="hud-pool__k">点数池</span>' +
      '<span class="hud-pool__n' + (left < 0 ? ' is-over' : '') + '" data-pool-left>' +
      (left < 0 ? '超支 ' + (-left) : '剩余 ' + left) + '</span>' +
      '<span class="hud-pool__of">可分配 <b data-pool-max>' + max +
      '</b>　已用 <b data-pool-used>' + used + '</b></span>' +
      '<span class="hud-pool__eq">＝ 等级 <b data-pool-lv>' + level + '</b> × ' +
      def.per + ' ＋ ' + hud.esc(def.bonus) + ' <b data-pool-bonus>' + bonus + '</b></span>' +
      '</div>';
  }

  function createBlock(hud, state) {
    var def = defOf(hud);
    var p = hud.objectOf(state, hud.CONFIG.playerObject);
    var level = Math.max(1, Math.round(toNum(p[def.level], 1)));
    var bonus = Math.round(toNum(p[def.bonus], 0));
    var max = poolOf(def, level, bonus);
    var stats = statsOf(hud, def, p);
    var adds = addsOf(hud, def, p[def.add]);
    var head = [], tail = [];
    for (var i = 0; i < def.stats.length; i++) {
      var k = def.stats[i];
      head.push(statCell(hud, def, k, stats[k]));
      tail.push(addCell(hud, k, adds[k]));
    }
    return '' +
      '<div class="hud-pool" data-pool>' +
      barHtml(hud, def, max, spentOf(def, stats), level, bonus) +
      '  <div class="hud-pool__grid">' + head.join('') + '</div>' +
      '  <div class="hud-pool__row">' +
      '    <label class="hud-pool__side"><span class="hud-pool__cl">' + hud.esc(def.job) +
      '</span>' + jobSelect(hud, def, p[def.job]) + '</label>' +
      '    <label class="hud-pool__side"><span class="hud-pool__cl">' + hud.esc(def.bonus) +
      '</span><input class="hud-input hud-pool__in" type="number" data-field="' +
      hud.esc(def.bonus) + '" data-type="number" min="0" step="1" value="' +
      bonus + '"></label>' +
      '  </div>' +
      '  <div class="hud-pool__acts">' +
      '    <button type="button" class="hud-btn hud-btn--quiet" data-act="pool-fate"' +
      ' title="按职业倾向，把剩下的点数一次撒到那六项上">交给命运</button>' +
      '    <button type="button" class="hud-btn hud-btn--quiet" data-act="pool-write"' +
      ' title="把下面那六格临时加成写进变量（不进点数池）">加成写回</button>' +
      '  </div>' +
      '  <div class="hud-pool__addbox">' +
      '    <div class="hud-pool__al">临时加成 · 不进池子，只影响判定，事过即还</div>' +
      '    <div class="hud-pool__grid">' + tail.join('') + '</div>' +
      '  </div>' +
      '  <div class="hud-pool__note" data-pool-note hidden></div>' +
      '</div>';
  }

  /* 面板上那一行：已有角色时才画。没角色的卡不该多一行「剩余 5」，
     那会让人以为这一局已经开工了。 */
  function panelBlock(hud, state) {
    if (!hud.hasProfile(state)) return '';
    var def = defOf(hud);
    var p = hud.objectOf(state, hud.CONFIG.playerObject);
    var max = poolOf(def, p[def.level], p[def.bonus]);
    var used = spentOf(def, statsOf(hud, def, p));
    var left = max - used;
    var adds = addListOf(def, addsOf(hud, def, p[def.add]));
    return '' +
      '<div class="hud-poolhint">' +
      '<span class="hud-poolhint__n">点数池 ' + (left < 0 ? '超支 ' + (-left) : '剩余 ' + left) +
      '</span>' +
      '<span class="hud-poolhint__of">可分配 ' + max + ' · 已用 ' + used + '</span>' +
      (adds ? '<span class="hud-poolhint__a">' + hud.esc(def.add) + ' ' +
        hud.esc(adds) + '</span>' : '') +
      '</div>';
  }

  function noteIn(pool, text, kind) {
    var n = pool.querySelector('[data-pool-note]');
    if (!n) return;
    n.hidden = !text;
    n.className = 'hud-pool__note' + (kind ? ' ' + kind : '');
    n.textContent = text || '';
  }

  /* 从被点的那个扣子往上找，找到带着某个标记的那一层 ——
     读表单、写状态提示都收在这一块里做，不碰页面别处。 */
  function upTo(node, attr) {
    var t = node;
    while (t && t.getAttribute && !t.getAttribute(attr)) t = t.parentNode;
    return (t && t.getAttribute) ? t : null;
  }

  function fieldEl(create, key) {
    var list = create.querySelectorAll('[data-field]');
    for (var i = 0; i < list.length; i++) {
      if (list[i].getAttribute('data-field') === key) return list[i];
    }
    return null;
  }

  /* 表单里现在这一份：池子多大、花了多少。读的是**界面**上的数，
     不是变量里的 —— 人正敲着，看到的必须是敲进去的。 */
  function readBar(hud, def, create) {
    var got = hud.readCreateForm(create);
    var level = Math.max(1, Math.round(toNum(got[def.level], 1)));
    var bonus = Math.round(toNum(got[def.bonus], 0));
    var stats = {};
    for (var i = 0; i < def.stats.length; i++) {
      var k = def.stats[i];
      var v = Math.round(toNum(got[k], def.base));
      stats[k] = v < def.base ? def.base : v;
    }
    var max = poolOf(def, level, bonus);
    return { level: level, bonus: bonus, stats: stats, max: max,
             used: spentOf(def, stats), job: hud.str(got[def.job]) };
  }

  function paint(pool, it) {
    var left = it.max - it.used;
    var n = pool.querySelector('[data-pool-left]');
    setText(n, left < 0 ? '超支 ' + (-left) : '剩余 ' + left);
    if (n) n.className = 'hud-pool__n' + (left < 0 ? ' is-over' : '');
    setText(pool.querySelector('[data-pool-max]'), it.max);
    setText(pool.querySelector('[data-pool-used]'), it.used);
    setText(pool.querySelector('[data-pool-lv]'), it.level);
    setText(pool.querySelector('[data-pool-bonus]'), it.bonus);
  }

  /* 交给命运：按职业倾向把剩下的点一次撒开。
     撒的是界面那六格 —— 撒完还能手调，封缄时以界面上的数为准。 */
  function doFate(hud, create, pool) {
    var def = defOf(hud);
    var it = readBar(hud, def, create);
    var left = it.max - it.used;
    if (left <= 0) {
      noteIn(pool, left === 0
        ? '点数已经花完了 —— 想重撒，先把某一项调低一点，或者把等级加上去，再点这颗扣子。'
        : '点数已经超支 ' + (-left) + ' —— 先把六维削回池子里，再点这颗扣子。');
      return;
    }
    var out = spendPool(hud, def, it.stats, it.job, it.max);
    var bits = [];
    for (var i = 0; i < def.stats.length; i++) {
      var k = def.stats[i];
      var el = fieldEl(create, k);
      if (el) el.value = out[k];
      bits.push(k + ' ' + out[k]);
    }
    paint(pool, readBar(hud, def, create));
    noteIn(pool, '已按' + (it.job ? '「' + it.job + '」的倾向' : '不偏（职业那栏空着）') +
      '把 ' + left + ' 点撒开：' + bits.join(' · ') +
      '。还能手调 —— 封缄时以界面上的数为准。', 'is-ok');
  }

  /* 加成写回：那六个数住在变量里的**一个对象**上，表单那条路送不进去，
     所以这里自己走一次写变量。只在玩家点这颗扣子时写 ——
     跟着「封缄」一起写，会和核心那一次互相踩（两次读到的状态不一样）。 */
  function doWriteAdds(hud, pool) {
    var def = defOf(hud);
    var inputs = pool.querySelectorAll('[data-add]');
    var raw = {};
    for (var i = 0; i < inputs.length; i++) {
      var k = inputs[i].getAttribute('data-add');
      if (k) raw[k] = inputs[i].value;
    }
    var adds = addsOf(hud, def, raw);
    noteIn(pool, '正在把临时加成写进变量…');
    return hud.writeObject(hud.CONFIG.playerObject, oneK(def.add, adds), pool)
      .then(function (warn) {
        noteIn(pool, warn ? warn
          : '临时加成已写进「' + def.add + '」：' + (addListOf(def, adds) || '六项都是 0') +
            '。它不进点数池 —— 属性是长在身上的，加成是事过即还的。',
          warn ? 'is-error' : 'is-ok');
      })
      .catch(function (err) {
        noteIn(pool, '加成没写进变量：' + hud.msgOf(err), 'is-error');
      });
  }

  /* ------------------------------------------------------------------ 接线 */

  function register() {
    var hud = window.CARDC73C60_HUD;
    if (!hud || typeof hud.useModule !== 'function') return;

    hud.useModule({
      name: '点数池',
      /* 建卡器：档位那一行底下、表单与「封缄」之间 */
      create: function (state) { return createBlock(hud, state); },
      /* 面板：已有角色时多一行「剩余 / 加成」 */
      panel: function (state) { return panelBlock(hud, state); },
      mount: function (h) {
        var use = h || hud;
        /* 一边敲一边算：六格数字、职业、永久奖励、等级，动哪个都重算那一行。
           input 管打字，change 管下拉与上下箭头 —— 两个都收。 */
        var live = function (ev) {
          var create = upTo(ev.target, 'data-create');
          if (!create) return;
          var pool = create.querySelector('[data-pool]');
          if (!pool) return;
          paint(pool, readBar(use, defOf(use), create));
        };
        document.addEventListener('input', live);
        document.addEventListener('change', live);
        document.addEventListener('click', function (ev) {
          var t = ev.target;
          while (t && t.getAttribute && !t.getAttribute('data-act')) t = t.parentNode;
          if (!t || !t.getAttribute) return;
          var act = t.getAttribute('data-act');
          /* 核心的「清空」把表单全抹空 —— 那一行得跟着重算，
             不然它停在上一秒的剩余上，人以为没清掉。 */
          if (act === 'reset') {
            var root = upTo(t, 'data-create');
            var box = root && root.querySelector('[data-pool]');
            if (box) {
              setTimeout(function () { paint(box, readBar(use, defOf(use), root)); }, 0);
            }
            return;
          }
          if (act !== 'pool-fate' && act !== 'pool-write') return;
          var pool = upTo(t, 'data-pool');
          var create = upTo(t, 'data-create');
          if (!pool || !create) return;
          ev.preventDefault();
          if (act === 'pool-fate') doFate(use, create, pool);
          else doWriteAdds(use, pool);
        });
      },
      自检: function () {
        var def = defOf(hud);
        var n = def.stats.length;
        var i, k;

        /* 一份全在起点的六维，与它的一个变体（第一项 +3） */
        var full = {}, one = {};
        for (i = 0; i < n; i++) {
          full[def.stats[i]] = def.base;
          one[def.stats[i]] = def.base;
        }
        one[def.stats[0]] = def.base + 3;

        /* 均摊 vs 有倾向：给同样的 10 点，看撒出来的样子 */
        var even = spread(10, weightsOf(hud, def, '这个职业不存在'));
        var bias = spread(10, weightsOf(hud, def, hud.str(def.jobs[0])));

        /* 偏爱的那几格 / 不偏爱的其余几格 */
        var hit = (hud.plain(def.favor) || {})[hud.str(def.jobs[0])];
        var fav = hud.isArr(hit) ? hit.map(hud.str) : [];
        var atFav = [], atOther = [];
        for (i = 0; i < n; i++) {
          if (fav.indexOf(def.stats[i]) >= 0) atFav.push(i); else atOther.push(i);
        }
        var pick = function (a, idx) {
          var s = 0;
          for (var j = 0; j < idx.length; j++) s += a[idx[j]];
          return s;
        };
        var sum = function (a) {
          var s = 0;
          for (var j = 0; j < a.length; j++) s += a[j];
          return s;
        };
        var hi = function (a) { return Math.max.apply(null, a); };
        var lo = function (a) { return Math.min.apply(null, a); };

        /* 池子已经超支：一件都不该被削回来 */
        var fat = {};
        for (i = 0; i < n; i++) fat[def.stats[i]] = def.base + 5;
        var fatSpent = spentOf(def, fat);
        var stayed = spendPool(hud, def, fat, '', fatSpent - 4);

        var pool5 = poolOf(def, 5, 0);
        var fated = spendPool(hud, def, full, '', pool5);
        var stray = addsOf(hud, def, oneK('这个键不存在', 9));

        /* 面板那两条断言得先有一份「有角色」的变量：hasProfile 只看有没有名字 */
        var withName = oneK('姓名', '甲');
        var withAdds = oneK('姓名', '甲');
        withAdds[def.add] = oneK(def.stats[0], 3);

        return [
          ['池子大小 = 等级 × 每级点数 ＋ 永久奖励',
            poolOf(def, 5, 0) === 5 * def.per && poolOf(def, 3, 7) === 3 * def.per + 7],
          ['等级认不出来时按 1 级算（不吐 NaN、不吐负数）',
            poolOf(def, '乱写', 0) === def.per && poolOf(def, 0, 0) === def.per &&
            poolOf(def, null, 0) === def.per && poolOf(def, -9, 0) === def.per &&
            !isNaN(poolOf(def, undefined, 0))],
          ['六项都在起点时一点没花', spentOf(def, full) === 0],
          ['已用点 = 六项高于起点的部分之和', spentOf(def, one) === 3],
          ['低于起点的项不倒扣（剩余不会莫名其妙变多）',
            spentOf(def, oneK(def.stats[0], def.base - 5)) === 0 && spentOf(def, {}) === 0],
          ['撒出去的点数总和正好等于给的点数',
            sum(even) === 10 && sum(bias) === 10 && sum(spread(0, [1, 1, 1])) === 0],
          ['没得撒的时候一点不撒（不往回削，也不炸）',
            sum(spread(-3, [1, 1])) === 0 && sum(spread(2, [0, 0])) === 0],
          ['不偏时六项差距不超过 1', hi(even) - lo(even) <= 1],
          ['有倾向时偏爱的那两项拿得更多、其余跟着少',
            !atFav.length ||
            (pick(bias, atFav) > pick(even, atFav) &&
             hi(atOther.map(function (x) { return bias[x]; })) <=
             hi(atOther.map(function (x) { return even[x]; })))],
          ['「交给命运」把剩余一次花完：撒完正好等于池子大小',
            spentOf(def, fated) === pool5],
          ['池子已经超支时，交给命运一点不撒（不削玩家填的数）',
            spentOf(def, stayed) === fatSpent],
          ['加成只认六维那几个键，界面上多出来的框一个都不写回',
            Object.keys(stray).length === n && stray['这个键不存在'] === undefined &&
            stray[def.stats[0]] === 0],
          ['加成取整：小数四舍五入，乱写当 0',
            addsOf(hud, def, oneK(def.stats[0], 2.6))[def.stats[0]] === 3 &&
            addsOf(hud, def, oneK(def.stats[0], '乱写'))[def.stats[0]] === 0],
          ['加成列成一行时零的不写',
            addListOf(def, oneK(def.stats[0], 0)) === '' &&
            addListOf(def, oneK(def.stats[0], 2)).indexOf(def.stats[0]) === 0],
          ['没有角色的卡：面板那一块不画（不给空卡添一行）',
            panelBlock(hud, {}) === ''],
          ['有角色时画得出「剩余」那一行',
            panelBlock(hud, { stat_data: oneK(hud.CONFIG.playerObject,
              withName) }).indexOf('剩余') >= 0],
          ['加成会出现在面板那一行上（带着那一栏的名字）',
            panelBlock(hud, { stat_data: oneK(hud.CONFIG.playerObject,
              withAdds) }).indexOf(def.add) >= 0]
        ];
      }
    });
  }

  register();
})();
