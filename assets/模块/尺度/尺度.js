/* ============================================================================
 * 尺度模块 —— 给「叙事尺度」那三档配一句人话
 *
 * 条目里那份是写给 AI 的（怎么落笔）；这里这份是写给玩家的（你会看到什么）。
 * 两处说的是同一件事，措辞不同 —— 而且**都得有一份**：玩家拨档位的时候
 * 得知道自己在拨什么，不然那三个字就是三个字。
 *
 * 这一份是「另一个文件里的一段独立代码」：它读不到 hud.core.js 里的私有名字，
 * 只能通过 window.SKEL_HUD 那份导出接上去 —— 接线口就是 useModule()。
 * 不接的时候这个文件根本不在这张卡里（由 hud.conf.json 的「模块」说了算）。
 *
 * 自检写在下面 自检() 里，跟着 测试/run_all.py 一起跑：
 * 三档的措辞是内容，内容也会抄错 —— 抄错了不会报错，只是某一档看着像另一档。
 * ========================================================================== */
(function () {
  'use strict';

  /* 三档各是什么意思。改这里就是改这张卡的口味 —— 骨架不替你定，
     因为「放开」到哪一步才算放开，是作者的事。 */
  var NOTE = {
    克制: '镜头只跟着你走，你不问就不展开；冲突不升级。',
    标准: '有来有回 —— 该起波澜就起，但每件事都有来处。',
    放开: '世界自己会动：势力、仇家、时局会找上门；允许大场面与不可逆的后果。'
  };

  /* 档位 -> 那一句话。认不出的值退回「标准」那一句 ——
     跟界面上那颗扣子同一个规矩：不把认不出的东西摆到人眼前。 */
  function noteOf(v) {
    return NOTE[v] || NOTE.标准;
  }

  function blockHtml(hud, state) {
    var v = hud.scaleOf(state);
    var on = hud.pressureOn(state);
    return '' +
      '<div class="hud-scalehint">' +
      '  <span class="hud-scalehint__k">' + hud.esc(v) + '</span>' +
      '  <span class="hud-scalehint__v">' + hud.esc(noteOf(v)) + '</span>' +
      '  <span class="hud-scalehint__p">时局压力：' + (on ? '开' : '关') + '</span>' +
      '</div>';
  }

  function register() {
    var hud = window.SKEL_HUD;
    if (!hud || typeof hud.useModule !== 'function') return;
    hud.useModule({
      name: '尺度',
      /* 建卡器：拨档位的那一行底下，把话说明白 */
      create: function (state) { return blockHtml(hud, state); },
      /* 面板：每轮都看得到这一档是什么意思 */
      panel: function (state) { return blockHtml(hud, state); },
      自检: function () {
        return [
          ['三档都有一句人话',
            !!noteOf('克制') && !!noteOf('标准') && !!noteOf('放开')],
          ['三档的说法各不相同（不是同一句抄了三遍）',
            noteOf('克制') !== noteOf('标准') && noteOf('标准') !== noteOf('放开')],
          ['认不出的档位退回「标准」那一句', noteOf('乱写的') === NOTE.标准],
          ['空值与非字符串也退回「标准」那一句',
            noteOf('') === NOTE.标准 && noteOf(null) === NOTE.标准 &&
            noteOf(undefined) === NOTE.标准]
        ];
      }
    });
  }

  register();
})();
