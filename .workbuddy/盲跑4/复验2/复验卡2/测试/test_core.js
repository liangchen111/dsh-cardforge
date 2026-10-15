/* ==========================================================================
   test_core.js —— 复验卡2 HUD 的纯函数单测

   做法：把 hud/hud.core.js 的**真身**载进 Node（配一个最小 document / window 桩），
        直接调它导出的函数。规则只写在一处，这里不另抄一份 ——
        抄一份的结果是「测试全绿、界面全错」。

   为什么要有这个文件：界面上的错，肉眼看不出来的那一类最贵。
   一个「认不出的档位值该退回哪一档」写错，页面上只是某个字不对，
   测出来是秒级的事，等玩家发现可能已经打包发出去三轮了。

   跑：node 测试/test_core.js
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.argv[2] || path.join(__dirname, '..', 'hud', 'hud.core.js');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  [OK]   ' + label); }
  else { fail++; console.log('  [FAIL] ' + label + (extra ? '  → ' + extra : '')); }
}
function head(t) { console.log('\n== ' + t + ' =='); }

/* ------------------------------------------------------------ 载入被测文件 */

function fakeNode() {
  return {
    style: {}, dataset: {}, hidden: false, textContent: '', innerHTML: '',
    className: '', children: [],
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    hasAttribute() { return false; }, appendChild() {}, removeChild() {},
    replaceWith() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    focus() {}, click() {}
  };
}

const win = {
  innerWidth: 1280, innerHeight: 800,
  addEventListener() {}, removeEventListener() {},
  localStorage: (() => {
    const m = {};
    return {
      getItem: k => (k in m ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: k => { delete m[k]; }
    };
  })()
};

const doc = {
  readyState: 'complete',
  body: fakeNode(),
  documentElement: fakeNode(),
  defaultView: win,
  createElement: () => fakeNode(),
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {}
};
win.document = doc;

const sandbox = { window: win, document: doc, console, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });

const H = win.CARDB611AC_HUD;
ok(!!H, '载入 hud.core.js 并拿到 window.CARDB611AC_HUD');
if (!H) { console.log('无法继续'); process.exit(1); }

for (const k of ['CONFIG', 'DEFAULTS', 'esc', 'str', 'num', 'clamp', 'isArr', 'plain',
  'msgOf', 'parseList', 'joinList', 'fillState', 'objectOf', 'statOf', 'scaleOf', 'nextScale',
  'pressureOn', 'valueHtml', 'panelHtml', 'briefOf', 'hasProfile', 'mkPatch',
  'createHtml', 'readCreateForm', 'touched', 'renderCardView', 'renderCreateView',
  'mountBall', 'readState', 'writeObject', 'whenReady']) {
  const t = typeof H[k];
  ok(t === 'function' || t === 'object', '导出 ' + k, '实际 ' + t);
}

/* ------------------------------------------------ 0. 模块：接上了，且画得出来

   模块是「这张卡选着接的能力」，代码各占 hud/模块/<名>/<名>.js 一个文件
   （一个模块一个目录，与 build_hud.py 找的是同一个形状），
   跟拼进同一页的顺序一样一段一段载进来。

   模块的断言归它自己：模块对象上的 自检() 给一组 [说明, 对不对]，这里只负责跑。
   规则写在模块那一处，测试里不另抄一份 —— 抄一份的结果是「测试全绿、界面全错」。 */

const CONF = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hud', 'hud.conf.json'), 'utf8'));
const MOD_NAMES = CONF['模块'] || [];
const MOD_DIR = path.join(__dirname, '..', 'hud', '模块');

head('0. 模块：conf 里写着的那几个都接上了');

let modLoaded = [];
for (const name of MOD_NAMES) {
  const p = path.join(MOD_DIR, name, name + '.js');
  if (!fs.existsSync(p)) continue;          /* 只给样式、不给脚本的模块，正常 */
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p });
  modLoaded.push(name);
}

ok(typeof H.useModule === 'function' && typeof H.modules === 'function',
  'hud.core.js 给了接线口（useModule / modules）');
ok(H.modules().length === modLoaded.length,
  `模块都登记进了注册表（${H.modules().length}/${modLoaded.length}）`,
  JSON.stringify({ 有脚本的: modLoaded, 登记了的: H.modules().map(m => m.name) }));

for (const m of H.modules()) {
  ok(typeof m.name === 'string' && m.name.length > 0, '模块带名字');
  ok(typeof m.create === 'function' || typeof m.panel === 'function' ||
    typeof m.mount === 'function', `模块「${m.name}」至少给了一个挂载点（不然接它没用）`);

  for (const kind of ['create', 'panel']) {
    if (typeof m[kind] !== 'function') continue;
    let html = '', boom = '';
    try { html = m[kind](H.DEFAULTS); } catch (e) { boom = String((e && e.message) || e); }
    ok(!boom, `模块「${m.name}」的 ${kind}() 拿默认值也画得出东西（不抛）`, boom);
    ok(typeof html === 'string' && html.indexOf('<script') < 0 && html.indexOf('<!--') < 0,
      `模块「${m.name}」的 ${kind}() 给的是一段干净 HTML`,
      typeof html === 'string' ? html.slice(0, 60) : typeof html);
  }

  if (typeof m['自检'] === 'function' && Array.isArray(m['自检']())) {
    for (const pair of m['自检']()) ok(pair[1], `[${m.name}] ${pair[0]}`);
  }
}

/* ------------------------------------------------------------ 1. 小工具 */

head('1. 小工具：转义、取值、切行');

ok(H.esc('<b>&"x"</b>') === '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;', 'esc 把五个危险字都转掉');
ok(H.esc(null) === '' && H.esc(undefined) === '', 'esc 收到 null/undefined 给空串');
ok(H.str('  a  ') === 'a' && H.str(null) === '', 'str 去首尾空白，null 给空串');
ok(H.num('3.7', 0) === 3.7 && H.num('abc', 9) === 9 && H.num(undefined, 2) === 2,
  'num 认不出就退回第二个参数');
ok(H.clamp(5, 1, 3) === 3 && H.clamp(0, 1, 3) === 1 && H.clamp(2, 1, 3) === 2, 'clamp 夹在区间里');
ok(H.isArr([]) === true && H.isArr({}) === false && H.isArr('') === false, 'isArr 只认数组');
ok(H.plain({}) !== null && H.plain([]) === null && H.plain('') === null,
  'plain 只放行「真对象」，数组和字符串都不算');

ok(JSON.stringify(H.parseList('a\n\n  b  \nc')) === '["a","b","c"]',
  'parseList：切行、去空白、丢空行', JSON.stringify(H.parseList('a\n\n  b  \nc')));
ok(JSON.stringify(H.parseList('')) === '[]' && JSON.stringify(H.parseList(null)) === '[]',
  'parseList 对空输入给空数组');
ok(H.joinList(['a', 'b']) === 'a\nb' && H.joinList([]) === '' && H.joinList(null) === '',
  'joinList 与 parseList 互逆');
ok(H.joinList('x') === 'x', 'joinList 收到非数组就原样转字符串');
ok(JSON.stringify(H.parseList(H.joinList([' 甲 ', '乙']))) === '["甲","乙"]',
  '来回一趟不丢东西（切行前先 trim）');

/* ------------------------------------------------------------ 2. 读状态 */

head('2. 读状态：stat_data 优先，缺的键用初值补');

const stat0 = { stat_data: { 玩家: { 姓名: '甲' } } };
ok(H.statOf(stat0).玩家.姓名 === '甲', 'statOf 认 stat_data 这一层');
ok(H.statOf({ 玩家: { 姓名: '乙' } }).玩家.姓名 === '乙',
  '没有 stat_data 时退到顶层同名键');
ok(H.statOf(null) && typeof H.statOf(null) === 'object', 'statOf 对空输入给空对象而不是炸掉');
ok(H.objectOf(stat0, '玩家').姓名 === '甲', 'objectOf 取到对象');
ok(JSON.stringify(H.objectOf(stat0, '不存在')) === '{}', 'objectOf 取不到给空对象');

const filled = H.fillState({ 玩家: { 姓名: '甲' } });
ok(filled.玩家.姓名 === '甲', 'fillState 保留读到的值');
ok(filled.玩家.等级 === 1 && filled.玩家.状态 === '正常',
  'fillState 把缺的键用初值补上');
ok(filled.世界设定.叙事尺度 === '标准', 'fillState 补的是完整的一层，不只最外层');
ok(JSON.stringify(filled.玩家.背包) === '[]', 'fillState 补数组给空数组');
const extra = H.fillState({ 玩家: { 姓名: '甲', 自定义字段: 'x' } });
ok(extra.玩家.自定义字段 === 'x',
  'fillState 不吞掉初值里没有的键（变量表比这里长是常态）');
ok(H.fillState(null).玩家.姓名 === '', 'fillState 对空输入给完整初值');

/* ------------------------------------------------------------ 3. 档位 */

head('3. 档位：只认三档，认不出的一律退回中间那一档');

ok(JSON.stringify(H.CONFIG.scaleValues) === '["克制","标准","放开"]',
  'SCALE_VALUES 就这三档', JSON.stringify(H.CONFIG.scaleValues));
ok(H.scaleOf({ stat_data: { 世界设定: { 叙事尺度: '放开' } } }) === '放开', '读得到就是那一档');
ok(H.scaleOf({ stat_data: { 世界设定: { 叙事尺度: '瞎写的' } } }) === '标准',
  '认不出的值按「标准」算 —— 不把怪值摆到界面上');
ok(H.scaleOf({}) === '标准' && H.scaleOf(null) === '标准', '读不到也按「标准」算');

ok(H.nextScale('克制') === '标准' && H.nextScale('标准') === '放开',
  'nextScale 往后拨一位');
ok(H.nextScale('放开') === '克制', '拨到头绕回来，不是停在原地');
ok(H.nextScale('瞎写的') === '放开' && H.nextScale('') === '放开',
  '认不出的值按「标准」的下一档算（历史坑：老式算法会算成「克制」）');
ok(H.nextScale(null) === '放开', 'null 也走同一条路');

ok(H.pressureOn({ stat_data: { 世界设定: { 压力源: true } } }) === true, '压力源：真布尔');
ok(H.pressureOn({ stat_data: { 世界设定: { 压力源: false } } }) === false, '压力源：假布尔');
ok(H.pressureOn({ stat_data: { 世界设定: { 压力源: 'true' } } }) === true,
  '压力源：字符串 true 也算开（宿主可能把布尔存成字符串）');
ok(H.pressureOn({}) === false, '压力源没写时算关');

const p1 = H.mkPatch('叙事尺度', '放开');
ok(p1.叙事尺度 === '放开' && Object.keys(p1).length === 1, 'mkPatch 就是「用变量当键名」的绕法');

/* ------------------------------------------------------------ 4. 渲染 */

head('4. 渲染：变量树进得去，转义出不来');

ok(H.valueHtml(['a', '<b>']).indexOf('&lt;b&gt;') >= 0, '数组项也会转义');
ok(H.valueHtml(['a']).indexOf('hud-tag') >= 0, '数组渲染成标签');
ok(H.valueHtml([]).indexOf('hud-dim') >= 0, '空数组说「空」，不是一片空白');
ok(H.valueHtml(true).indexOf('开') >= 0 && H.valueHtml(false).indexOf('关') >= 0,
  '布尔渲染成开关字样');
ok(H.valueHtml(false).indexOf('is-on') < 0 && H.valueHtml(true).indexOf('is-on') >= 0,
  '只有「开」才带高亮类');
ok(H.valueHtml('') === '<span class="hud-dim">—</span>', '空串给一个破折号');
ok(H.valueHtml(0).indexOf('0') >= 0, '数字 0 不当成「没有」（老坑：0 是假值）');
ok(H.valueHtml({}).indexOf('hud-dim') >= 0, '嵌一层对象就说「嵌套对象」');

const state = { stat_data: {
  世界设定: { 压力源: true, 叙事尺度: '标准' },
  玩家: { 姓名: '甲', 等级: 3, 背包: ['短剑'], 属性: { 力量: 4, 敏捷: 2 } }
} };
const html = H.panelHtml(state);
ok(html.indexOf('世界设定') >= 0 && html.indexOf('玩家') >= 0, '面板按对象分小节');
ok(html.indexOf('hud-sec__h') >= 0 && html.indexOf('hud-row') >= 0, '小节与行都用了约定的类名');
ok(html.indexOf('短剑') >= 0, '数组里的东西渲染得出来');
ok(html.indexOf('hud-sub') >= 0, '嵌套对象渲染成子节');
ok(H.panelHtml({}).indexOf('hud-sec') >= 0, '空状态也画得出复验卡2（初值兜底那一层在起作用）');

ok(H.briefOf(state) === '甲 · 等级 3', '摘要行：名字 + 等级', H.briefOf(state));
ok(H.briefOf({ stat_data: { 玩家: { 姓名: '甲', 状态: '重伤' } } }).indexOf('重伤') >= 0,
  '状态不是「正常」时才进摘要（不然每行都挂一句废话）');
ok(H.briefOf({}) === '尚无角色档案', '没有档案时摘要说清楚');
ok(H.hasProfile(state) === true && H.hasProfile({ stat_data: { 玩家: {} } }) === false,
  'hasProfile 只看「有没有名字」');

/* ------------------------------------------------------------ 5. 建卡器表单 */

head('5. 建卡器：表单读得出来，夹得住');

function fakeField(key, type, value, min, max) {
  return {
    value: value,
    getAttribute(k) {
      if (k === 'data-field') return key;
      if (k === 'data-type') return type;
      if (k === 'min') return min == null ? null : String(min);
      if (k === 'max') return max == null ? null : String(max);
      return null;
    }
  };
}
function fakeRoot(fields) {
  return {
    innerHTML: '',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll(sel) { return sel === '[data-field]' ? fields : []; }
  };
}

const form = H.readCreateForm(fakeRoot([
  fakeField('姓名', 'text', '  甲  '),
  fakeField('等级', 'number', '7', 1, 20),
  fakeField('背包', 'list', '短剑\n\n干粮')
]));
ok(form.姓名 === '甲', '文本框：去首尾空白', JSON.stringify(form.姓名));
ok(form.等级 === 7, '数字框：转成数字', JSON.stringify(form.等级));
ok(JSON.stringify(form.背包) === '["短剑","干粮"]', '多行框：切成数组', JSON.stringify(form.背包));

const over = H.readCreateForm(fakeRoot([fakeField('等级', 'number', '999', 1, 20)]));
ok(over.等级 === 20, '数字框超过上限被夹住（表单不是唯一防线，但它是第一道）',
  JSON.stringify(over.等级));
const under = H.readCreateForm(fakeRoot([fakeField('等级', 'number', '-5', 1, 20)]));
ok(under.等级 === 1, '低于下限也被夹住', JSON.stringify(under.等级));
const weird = H.readCreateForm(fakeRoot([fakeField('等级', 'number', 'abc', 1, 20)]));
ok(weird.等级 === 1, '填了字也算得出一个数（不给 NaN 往下走）', JSON.stringify(weird.等级));

ok(H.touched(fakeRoot([fakeField('姓名', 'text', '')])) === false, '空表：没人动过');
ok(H.touched(fakeRoot([fakeField('姓名', 'text', '甲')])) === true, '填了字：动过了');
ok(H.touched(fakeRoot([fakeField('背包', 'list', '短剑')])) === true, '多行框填了也算动过');

const createHtml = H.createHtml(state);
ok(createHtml.indexOf('data-field="姓名"') >= 0, '建卡器里有姓名那一栏');
ok(createHtml.indexOf('data-act="submit"') >= 0, '有「封缄」扣子');
ok(createHtml.indexOf('data-act="scale"') >= 0 && createHtml.indexOf('data-act="pressure"') >= 0,
  '两个档位扣子也在建卡器上');
ok(createHtml.indexOf('叙事尺度：标准') >= 0, '档位扣子的字跟着变量走');
ok(createHtml.indexOf('甲') >= 0, '已有档案时把值填进表单');
ok(H.createHtml({}).indexOf('<script') < 0, '建卡器 HTML 里不带脚本（注入的一条都不带）');

/* ------------------------------------------------------------ 收尾 */

console.log('\n' + '─'.repeat(56));
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) { console.log('有失败项，不许打包。'); process.exit(1); }
console.log('全部通过。');
