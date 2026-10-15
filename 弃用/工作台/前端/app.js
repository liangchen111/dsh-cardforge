/* 制卡工作台 · 前端（原生 JS，零依赖） */
(function () {
'use strict';

var TOKEN = window.__TOKEN__ || '';
var $ = function (s) { return document.querySelector(s); };

var S = {
  根: localStorage.getItem('forge.根') || '',
  工程: [],
  当前: '',
  详情: null,
  页签: localStorage.getItem('forge.页签') || '概览',
  条目id: null,
  选中: {},                       // 条目多选：{ id: true }，切换工程时清空
  选中变量: {},                   // 变量多选：{ "对象.变量": true }，切换工程时清空
  真值域: {},
  模块: [],
  日志: ''
};

var 页签表 = ['概览', '条目', '变量', '正则', '体检', '机制', '成品', '原文'];

/* ------------------------------------------------------------ 小工具 */
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function fmtTime(t) {
  var d = new Date(t * 1000);
  var p = function (x) { return (x < 10 ? '0' : '') + x; };
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
var toastTimer = null;
function toast(msg, kind) {
  var t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.className = 'toast hidden'; }, kind === 'bad' ? 8000 : 3200);
}

/* ------------------------------------------------------------ 通信 */
async function api(名, 体) {
  var r = await fetch('/api/' + encodeURIComponent(名), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forge-Token': TOKEN },
    body: JSON.stringify(体 || {})
  });
  var j = await r.json().catch(function () { return { 好: false, 错: '服务端返回了非 JSON' }; });
  if (!j.好) throw new Error(j.错 || '未知错误');
  return j.数据;
}
async function apiGet(路径, 参数) {
  var u = new URL(路径, location.origin);
  Object.keys(参数 || {}).forEach(function (k) {
    if (参数[k] !== undefined && 参数[k] !== null) u.searchParams.set(k, 参数[k]);
  });
  var j = await (await fetch(u)).json();
  if (!j.好) throw new Error(j.错 || '未知错误');
  return j.数据;
}
function 文件链接(相对) {
  return '/api/文件?工程=' + encodeURIComponent(S.当前) + '&相对=' + encodeURIComponent(相对);
}

/* ------------------------------------------------------------ 启动 */
async function 启动() {
  try {
    var st = await apiGet('/api/状态', { 根: S.根 });
    S.根 = st.根; S.工程 = st.工程; S.真值域 = st.真值域;
    S.模块 = st.模块; S.主题 = st.主题;
    $('#rootInput').value = S.根;
    localStorage.setItem('forge.根', S.根);
    $('#siderFoot').innerHTML = '禁区：' + st.禁区.map(function (p) {
      return '<code>' + esc(p.split(/[\\/]/).pop()) + '</code>';
    }).join('、') + '<br>（那里的一切改动都会被拒绝）';
    画列表();
    if (S.工程.length) {
      var 有 = S.工程.filter(function (p) { return p.路径 === S.当前; });
      await 打开(有.length ? S.当前 : S.工程[0].路径);
    } else {
      S.当前 = ''; S.详情 = null; 画主区();
    }
  } catch (e) { toast('开不起来：' + e.message, 'bad'); }
}

function 画列表() {
  var box = $('#siderList');
  $('#siderCount').textContent = S.工程.length ? S.工程.length + ' 张' : '';
  if (!S.工程.length) {
    box.innerHTML = '<div class="empty" style="padding:24px 8px;font-size:13px">' +
      '这个目录下还没有卡。<br>点右上角「＋ 开新卡」。</div>';
    return;
  }
  box.innerHTML = S.工程.map(function (p) {
    var bits = ['<i>' + p.条目 + ' 条目</i>'];
    if (p.变量) bits.push('<i>' + p.变量 + ' 变量</i>');
    if (p.正则) bits.push('<i>' + p.正则 + ' 正则</i>');
    if (p.皮肤) bits.push('<i>' + esc(p.皮肤) + '</i>');
    if (p.模块.length) bits.push('<i>' + esc(p.模块.join('/')) + '</i>');
    return '<div class="card-item' + (p.路径 === S.当前 ? ' on' : '') +
      '" data-路径="' + esc(p.路径) + '">' +
      '<div class="t">' + esc(p.卡名) +
      (p.只读 ? '<span class="ro">只读</span>' : '') + '</div>' +
      '<div class="m">' + bits.join('') + '</div></div>';
  }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('.card-item'), function (n) {
     n.onclick = function () { 打开(n.getAttribute('data-路径')); };
  });
}

async function 打开(路径) {
  S.当前 = 路径; S.条目id = null; S.日志 = ''; S.选中 = {}; S.选中变量 = {};
  画列表();
  await 刷新详情();
}

async function 刷新详情() {
  try {
    var d = await apiGet('/api/详情', { 工程: S.当前 });
    S.详情 = d;
    画主区();
  } catch (e) { toast('读不出来：' + e.message, 'bad'); }
}

/* ------------------------------------------------------------ 主区 */
function 画主区() {
  var m = $('#main');
  if (!S.详情) {
    m.innerHTML = '<div class="empty">左边还没有选中的卡。<br><br>' +
      '点「＋ 开新卡」从骨架开一张 —— 骨架自带一整套界面层，出生就是能跑的最小验证。</div>';
    return;
  }
  var d = S.详情, p = d.工程;
  var 错 = d.体检.错;
  var html = '<div class="pane">';
  html += '<div class="pane-head"><h1>' + esc(p.卡名) + '</h1>' +
    (d.只读 ? '<span class="pill warnp">只读禁区</span>' : '') +
    '<span class="sub">' + esc(p.路径) + '</span></div>';
  if (d.只读) {
    html += '<div class="verdict bad">' + esc(d.只读) + '</div>';
  }
  html += '<div class="tabs">' + 页签表.map(function (t) {
    var dot = (t === '体检' && 错) ? '<span class="dot">' + 错 + '</span>' : '';
    return '<div class="tab' + (t === S.页签 ? ' on' : '') + '" data-t="' + t + '">' + t + dot + '</div>';
  }).join('') + '</div>';
  html += '<div class="sect" id="paneBody"></div></div>';
  m.innerHTML = html;
  Array.prototype.forEach.call(m.querySelectorAll('.tab'), function (n) {
    n.onclick = function () {
      S.页签 = n.getAttribute('data-t');
      localStorage.setItem('forge.页签', S.页签);
      画主区();
    };
  });
  var body = $('#paneBody');
  body.innerHTML = {
    概览: 画概览, 条目: 画条目, 变量: 画变量, 正则: 画正则, 体检: 画体检,
    机制: 画机制, 成品: 画成品, 原文: 画原文
  }[S.页签](d);
  // 上一次动作的日志：加变量补了哪三处、删东西进了回收站 —— 这些都要看得见
  if (S.日志) {
    var lg = document.createElement('div');
    lg.className = 'log';
    lg.textContent = S.日志;
    body.appendChild(lg);
  }
  绑事件();
}

/* ------------------------------------------------------------ 概览 */
function 画概览(d) {
  var p = d.工程, s = d.体检.摘要;
  var h = '';
  h += '<div class="grid k3">' +
    统计卡(s.条目, '条目', '分 ' + s.分组 + ' 组') +
    统计卡(s.变量, '变量', '对象 ' + s.对象 + ' 个') +
    统计卡(s.正则, '正则', '界面与替换') +
    统计卡(s.常驻字数, '常驻字数', s.常驻 + ' 条常驻 · 护栏 ' + s.常驻护栏,
      s.常驻字数 > s.常驻护栏 ? 'bad' : '') +
    '</div>';

  h += '<div class="sect"><h2>一键</h2><div class="row">' +
    '<button class="btn primary" data-a="出成品" data-项="卡,手册,索引">出成品（卡＋手册＋索引）</button>' +
    '<button class="btn" data-a="组装">组装界面</button>' +
    '<button class="btn" data-a="体检">重新体检</button>' +
    '<button class="btn" data-a="出成品" data-项="卡,打包">打成工程包</button>' +
    (d.界面.预览 ? '<a class="btn" target="_blank" href="' + esc(文件链接(d.界面.预览)) + '">打开预览页</a>' : '') +
    (d.界面.手册 ? '<a class="btn" target="_blank" href="' + esc(文件链接(d.界面.手册)) + '">打开手册</a>' : '') +
    '</div></div>';

  h += '<div class="sect"><h2>这张卡长什么样</h2><div class="box"><dl class="kv">' +
    '<dt>卡壳</dt><dd>' + Object.keys(d.卡壳).length + ' 个字段（去「条目」页最上面改）</dd>' +
    '<dt>触发方式</dt><dd>' + 计数(d.体检.摘要.触发) + '</dd>' +
    '<dt>读取策略</dt><dd>' + 计数(d.体检.摘要.策略) + '</dd>' +
    '<dt>插入角色</dt><dd>' + 计数(d.体检.摘要.角色) + '</dd>' +
    '<dt>界面层</dt><dd>' + (d.界面.有界面 ? '有（hud/）· 皮肤：' + esc(S.详情.机制.当前皮肤 || '核心默认') : '没有') + '</dd>' +
    '<dt>接的机制</dt><dd>' + (S.详情.机制.模块.filter(function (x) { return x.状态 !== '未接'; })
      .map(function (x) { return esc(x.名) + ' v' + esc(x.版本); }).join('、') || '（没接）') + '</dd>' +
    '<dt>源真相</dt><dd><code>' + esc(S.详情.工程.spec ? 'source/' + p.卡名 + '.spec.yaml' : '') + '</code>（只手改它）</dd>' +
    '</dl></div></div>';

  h += '<div class="sect"><h2>成品</h2>' + 画文件表(d.成品) + '</div>';
  return h;
}

function 统计卡(n, 名, 副, cls) {
  return '<div class="box"><div class="stat"><b' + (cls === 'bad' ? ' style="color:var(--bad)"' : '') +
    '>' + esc(n) + '</b><span>' + esc(名) + '</span></div>' +
    '<div class="hint" style="color:var(--dim);font-size:12px">' + esc(副) + '</div></div>';
}
function 计数(o) {
  var ks = Object.keys(o || {});
  if (!ks.length) return '（无）';
  return ks.sort(function (a, b) { return o[b] - o[a]; })
    .map(function (k) { return esc(k || '(空)') + ' ' + o[k]; }).join(' · ');
}

function 画文件表(list) {
  if (!list.length) return '<div class="box" style="color:var(--dim)">还没有出过成品。</div>';
  return '<div class="files">' + list.map(function (f) {
    return '<div class="file"><span class="n">' + esc(f.相对) + '</span>' +
      '<span class="s">' + fmtSize(f.大小) + '</span>' +
      '<span class="s">' + fmtTime(f.时间) + '</span>' +
      '<a class="btn sm" target="_blank" href="' + esc(文件链接(f.相对)) + '">打开</a></div>';
  }).join('') + '</div>';
}

/* ------------------------------------------------------------ 条目 */
function 画条目(d) {
  var 组表 = {};
  d.条目.forEach(function (e) {
    var k = e.分组名 || '（未分组）';
    (组表[k] = 组表[k] || []).push(e);
  });
  var 顺序 = d.分组.map(function (g) { return g.名; }).concat(['（未分组）']);
  var 左 = '';
  顺序.forEach(function (g) {
    if (!组表[g]) return;
    左 += '<div class="grp-title">' + esc(g) + ' · ' + 组表[g].length + '</div>';
    组表[g].forEach(function (e) {
      左 += '<div class="ent' + (e.id === S.条目id ? ' on' : '') + '" data-id="' + esc(e.id) + '">' +
        '<div class="n"><input type="checkbox" class="ent-ck" data-勾="' + esc(e.id) + '"' +
        (S.选中[e.id] ? ' checked' : '') + '> ' + esc(e.标题 || '(无标题)') + '</div>' +
        '<div class="b">' + 条目标签(e) + '</div></div>';
    });
  });

  var 右 = '<div class="box" style="color:var(--dim)">左边点一条，在这里改；' +
    '或者右上角「＋ 新条目」起一条新的。</div>';
  if (S.条目id) {
    var e = d.条目.filter(function (x) { return x.id === S.条目id; })[0];
    if (e) 右 = 条目编辑器(e, d);
  }

  var 工具 = '<div class="row" style="margin-bottom:10px">' +
    '<button class="btn primary" id="btnNewEntry">＋ 新条目</button>' +
    '<button class="btn" id="btnGroups">分组管理（' + d.分组.length + '）</button>' +
    '<span style="color:var(--dim);font-size:12px">' + d.条目.length +
    ' 条。删掉的会进回收站，随时能捞回来。</span></div>';
  var n选 = 选中名单().length;
  var 批量 = '<div class="row" style="margin:-4px 0 10px">' +
    '<span style="color:var(--dim);font-size:12px">多选：</span>' +
    '<button class="btn sm" id="btnSelAll">全选</button>' +
    '<button class="btn sm" id="btnSelNone">清空</button>' +
    '<span id="selBar" style="color:' + (n选 ? 'var(--fg,#e8e8e8)' : 'var(--dim)') +
    ';font-size:12px">' + n选 + ' 条已选</span>' +
    '<span style="flex:1"></span>' +
    '<button class="btn sm" id="btnBatchMove"' + (n选 ? '' : ' disabled') + '>批量挪组</button>' +
    '<button class="btn sm" id="btnBatchField"' + (n选 ? '' : ' disabled') + '>批量改字段</button>' +
    '<button class="btn sm" id="btnBatchOn"' + (n选 ? '' : ' disabled') + '>启用</button>' +
    '<button class="btn sm" id="btnBatchOff"' + (n选 ? '' : ' disabled') + '>停用</button>' +
    '<button class="btn sm danger" id="btnBatchDel"' + (n选 ? '' : ' disabled') + '>删</button>' +
    '</div>';
  var 卡壳 = '<div class="sect"><h2>卡壳（整张卡的身份）</h2>' + 卡壳表单(d.卡壳) + '</div>';
  var 开场 = '<div class="sect"><h2>开场白（开卡第一屏）</h2>' + 开场白表单(d.开场白) + '</div>';
  return 卡壳 + 开场 + '<div class="sect"><h2>条目</h2>' + 工具 + 批量 + '<div class="split">' +
    '<div class="ent-list">' + 左 + '</div><div>' + 右 + '</div></div></div>';
}

function 条目标签(e) {
  var out = [];
  if (e.启用 === false) out.push('<span class="pill warnp">已禁用</span>');
  if (e.类型 === 'opening') out.push('<span class="pill op">开场</span>');
  if (e.触发 === 'always') out.push('<span class="pill always">常驻</span>');
  if (e.触发 === 'agent_tool') out.push('<span class="pill tool">AI 读</span>');
  if (e.策略 === 'required') out.push('<span class="pill req">必读</span>');
  if (e.策略 === 'keyword') out.push('<span class="pill">关键词' +
    (e.关键词.length ? ' ' + e.关键词.length : '') + '</span>');
  if (e.策略 === 'variable_condition') out.push('<span class="pill warnp">旧值！</span>');
  if (e.动态模式 === 'single_condition') out.push('<span class="pill warnp">死值！</span>');
  out.push('<span class="pill">' + e.正文长度 + ' 字</span>');
  return out.join('');
}

function 卡壳表单(ch) {
  var 文本 = ['name', 'opening', 'image_prompt', 'profile_age', 'profile_sex',
    'profile_height', 'profile_birthday', 'profile_like', 'group'];
  var 名 = { name: '卡名', opening: '开场白（卡壳字段）', image_prompt: '出图提示词',
    profile_age: '年龄', profile_sex: '性别', profile_height: '身高',
    profile_birthday: '生日', profile_like: '喜好', group: '分组' };
  var h = '<div class="box"><div class="pane-note" style="margin:0 0 12px">' +
    '这些是卡内显示的身份字段。注意：<b>成品文件名跟着 source/ 里那份 spec 的文件名走</b>，' +
    '跟这里的「卡名」是两回事 —— 改文件名要自己去「原文」页外动手。</div><div class="f2">';
  文本.forEach(function (k) {
    if (!(k in ch)) return;
    var big = (k === 'opening' || k === 'image_prompt');
    h += '<div class="field"' + (big ? ' style="grid-column:1/-1"' : '') + '><label>' + esc(名[k] || k) +
      ' <code style="color:var(--dim)">' + esc(k) + '</code></label>' +
      (big ? '<textarea data-卡壳="' + k + '" style="min-height:90px">' + esc(ch[k]) + '</textarea>'
        : '<input type="text" data-卡壳="' + k + '" value="' + esc(ch[k]) + '">') + '</div>';
  });
  ['show_opening', 'frontend_beauty_enabled'].forEach(function (k) {
    if (!(k in ch)) return;
    h += '<div class="field"><label class="chk"><input type="checkbox" data-卡壳="' + k + '"' +
      (ch[k] ? ' checked' : '') + '> ' + esc(k === 'show_opening' ? '显示开场白' : '启用前端美化') + '</label></div>';
  });
  h += '</div><div class="row"><button class="btn primary" id="btnSaveCardShell">保存卡壳</button>' +
    '<span style="color:var(--dim);font-size:12px">保存会整份重写 spec.yaml（键序与语义不变）。</span></div></div>';
  return h;
}

function 开场白表单(op) {
  if (!op || !op.有开场白) {
    return '<div class="box"><div class="pane-note" style="margin:0">' +
      '这个工程没有开场白（<code>hud/hud.conf.json</code> 里没有「开场白」这一块）—— ' +
      '开卡第一屏由宿主自己填，这里不用管。</div></div>';
  }
  var 标记 = op.标记数 === 3
    ? '<span class="pill good">末尾 3 个标记 ✔</span>'
    : '<span class="pill warnp">末尾只有 ' + op.标记数 +
      ' 个标记 ✗ 建卡界面不会出现（保存一下即补齐）</span>';
  var 一致 = op.写回一致 === true ? '<span class="pill good">与卡里一致 ✔</span>'
    : (op.写回一致 === false
      ? '<span class="pill warnp">与卡里不一致 ✗（保存一下即同步）</span>' : '');
  var h = '<div class="box">';
  h += '<div class="pane-note" style="margin:0 0 12px">这是玩家看到的<b>第一屏</b>，权重最高的字段。' +
    '真源是 <code>hud/hud.conf.json</code> —— 上面那个「开场白（卡壳字段）」是<b>另一个东西</b>。' +
    '末尾那三个零宽标记由工具负责，不用管。</div>';
  h += '<div style="margin:0 0 10px">' + 标记 + 一致 +
    '<span class="pill">' + op.字数 + ' 字</span></div>';
  h += '<div class="field"><label>正文 <code>开场白 · 正文</code></label>' +
    '<textarea id="openerText" style="min-height:150px">' +
    esc(op.正文.replace(/\u200b+$/, '')) + '</textarea></div>';
  h += '<div class="row"><button class="btn primary" id="btnSaveOpener">保存开场白</button>' +
    '<span style="color:var(--dim);font-size:12px">保存会同步写回卡里；旧版进回收站，能还原。</span></div>';
  h += '</div>';
  return h;
}

function 下拉(field, cur) {
  var d = S.真值域[field];
  if (!d) return '';
  var opts = ['<option value=""' + (cur ? '' : ' selected') + '>（不写 = 缺省 ' + esc(d.缺省) + '）</option>'];
  d.值.forEach(function (v) {
    opts.push('<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>');
  });
  Object.keys(d.旧值 || {}).forEach(function (old) {
    opts.push('<option value="' + esc(old) + '"' + (old === cur ? ' selected' : '') + '>' +
      esc(old) + ' ⚠ 会被降级成 ' + esc(d.旧值[old]) + '</option>');
  });
  if (cur && d.值.indexOf(cur) < 0 && !(d.旧值 || {})[cur]) {
    opts.push('<option value="' + esc(cur) + '" selected>' + esc(cur) + ' ⚠ 平台不认识</option>');
  }
  return '<select data-条目="' + field + '">' + opts.join('') + '</select>' +
    '<div class="hint">' + esc(d.说明) + '</div>';
}

function 条目编辑器(e, d) {
  var h = '<div class="box">';
  h += '<div class="field"><label>标题</label><input type="text" data-条目="title" value="' + esc(e.标题) + '"></div>';
  h += '<div class="f2">';
  h += '<div class="field"><label>触发方式 <code>trigger_mode</code></label>' + 下拉('trigger_mode', e.触发) + '</div>';
  h += '<div class="field"><label>读取策略 <code>agent_read_strategy</code></label>' + 下拉('agent_read_strategy', e.策略) + '</div>';
  h += '</div><div class="f3">';
  h += '<div class="field"><label>类型 <code>kind</code></label>' + 下拉('kind', e.类型 === 'normal' ? '' : e.类型) + '</div>';
  h += '<div class="field"><label>插入角色 <code>insert_role</code></label>' + 下拉('insert_role', e.角色) + '</div>';
  h += '<div class="field"><label>动态模式 <code>dynamic_mode</code></label>' + 下拉('dynamic_mode', e.动态模式) + '</div>';
  h += '</div><div class="f3">';
  h += '<div class="field"><label>正文解释 <code>content_mode</code></label>' + 下拉('content_mode', e.解释) + '</div>';
  h += '<div class="field"><label>关键词条件 <code>keyword_condition</code></label>' + 下拉('keyword_condition', e.关键词条件) + '</div>';
  h += '<div class="field"><label>位置 <code>position</code></label><input type="text" data-条目="position" value="' + esc(e.位置) + '">' +
    '<div class="hint">常驻条目（always）必须填位置，否则平台放不进去。</div></div>';
  h += '</div>';
  h += '<div class="field"><label>关键词 <code>keywords</code>（逗号分隔）</label>' +
    '<input type="text" data-条目="keywords" value="' + esc(e.关键词.join(', ')) + '">' +
    '<div class="hint">策略选了 keyword 就必须有关键词，否则这条永远不触发。</div></div>';
  h += '<div class="field"><label>读取提示 <code>agent_selection_hint</code></label>' +
    '<textarea data-条目="agent_selection_hint" style="min-height:70px">' +
    esc(e.读取提示 || '') + '</textarea>' +
    '<div class="hint">由 AI 读取的条目（触发方式 agent_tool）才用得上。AI 手里只有四项：' +
    '路径、标题、策略、读取提示 —— 缺这一项，它就不知道什么时候该读这条。</div></div>';
  h += '<div class="field"><label>正文 <code>content</code></label>' +
    '<textarea data-条目="content">' + esc(e.正文) + '</textarea>' +
    '<div class="hint">' + e.正文长度 + ' 字 · 分组：' + esc(e.分组名) +
    ' · id：<code>' + esc(e.id) + '</code>' +
    (e.开场分支 ? ' · 开场分支 ' + e.开场分支 + ' 条' : '') + '</div></div>';
  h += '<div class="row"><button class="btn primary" id="btnSaveEntry">保存这一条</button>' +
    '<button class="btn" id="btnReloadEntry">还原</button>' +
    '<select id="moveGroup" title="挪到别的分组"><option value="">（未分组）</option>' +
    (d.分组 || []).map(function (g) {
      return '<option value="' + esc(g.名) + '"' + (g.名 === e.分组名 ? ' selected' : '') +
        '>' + esc(g.名) + '</option>';
    }).join('') + '</select>' +
    '<button class="btn" id="btnToggleEntry">' +
    (e.启用 === false ? '启用这条' : '停用这条') + '</button>' +
    '<button class="btn" id="btnDupEntry">复制一条</button>' +
    '<button class="btn danger" id="btnDelEntry">删除</button>' +
    '<span style="color:var(--dim);font-size:12px">保存后立刻重跑体检。</span></div>';
  h += '</div>';
  return h;
}

/* ------------------------------------------------------------ 变量 */
function 画变量(d) {
  var 工具 = '<div class="row" style="margin-bottom:10px">' +
    '<button class="btn primary" id="btnNewObj">＋ 变量对象</button>' +
    '<button class="btn primary" id="btnNewVar">＋ 变量</button>' +
    '<button class="btn" id="btnAlign">对齐 Zod</button>' +
    '<span style="color:var(--dim);font-size:12px">加一个变量，工具会一次写全三处。</span></div>';

  var h = '';
  h += '<div class="sect"><h2>对象 · ' + d.对象.length + ' 个</h2>' + 工具 +
    '<div class="box"><table class="tb">' +
    '<tr><th>名</th><th>父</th><th>变量</th><th>说明</th><th></th></tr>' +
    d.对象.map(function (o) {
      return '<tr><td>' + esc(o.名) + (o.固定 ? ' <span class="pill">平台内置</span>' : '') +
        '</td><td>' + esc(o.父 || '—') + '</td><td>' + o.变量数 + '</td>' +
        '<td class="dim2">' + esc((o.说明 || '').slice(0, 60)) + '</td>' +
        '<td class="row" style="gap:4px;justify-content:flex-end">' + (o.固定 ? '' :
          '<button class="btn sm" data-改对象="' + esc(o.名) + '">改名</button>' +
          '<button class="btn sm danger" data-删对象="' + esc(o.名) + '">删</button>') +
        '</td></tr>';
    }).join('') + '</table></div></div>';

  if (d.变量.length) {
    var nv选 = 选中变量名单().length;
    var 变量批量 = '<div class="row" style="margin:-4px 0 8px">' +
      '<span style="color:var(--dim);font-size:12px">多选：</span>' +
      '<button class="btn sm" id="btnSelAllVar">全选</button>' +
      '<button class="btn sm" id="btnSelNoneVar">清空</button>' +
      '<span id="selVarBar" style="color:' + (nv选 ? 'var(--fg,#e8e8e8)' : 'var(--dim)') +
      ';font-size:12px">' + nv选 + ' 个已选</span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn sm danger" id="btnBatchDelVar"' + (nv选 ? '' : ' disabled') +
      '>批量删</button></div>';
    h += '<div class="sect"><h2>变量 · ' + d.变量.length + ' 个</h2>' + 变量批量 +
      '<div class="box"><table class="tb">' +
      '<tr><th></th><th>对象</th><th>变量</th><th>类型</th><th>初值</th><th>说明</th><th></th></tr>' +
      d.变量.map(function (v) {
        var 键 = v.对象 + '.' + v.名;
        return '<tr><td><input type="checkbox" class="var-ck" data-勾变量="' + esc(键) + '"' +
          (S.选中变量[键] ? ' checked' : '') + '></td>' +
          '<td>' + esc(v.对象) + '</td><td>' + esc(v.名) + '</td>' +
          '<td><code>' + esc(v.类型) + '</code></td>' +
          '<td><code>' + esc(v.初值) + '</code></td>' +
          '<td class="dim2">' + esc((v.说明 || '').slice(0, 60)) + '</td>' +
          '<td class="row" style="gap:4px;justify-content:flex-end">' +
          '<button class="btn sm" data-改变量="' + esc(v.名) + '" data-对象="' + esc(v.对象) +
          '" title="改名（三处一起挪，id 不动）">改名</button>' +
          '<button class="btn sm" data-挪变量="' + esc(v.名) + '" data-对象="' + esc(v.对象) +
          '" title="换到别的变量对象下">换对象</button>' +
          '<button class="btn sm danger" data-删变量="' + esc(v.名) + '" data-对象="' +
          esc(v.对象) + '">删</button></td></tr>';
      }).join('') + '</table></div></div>';
  }
  h += '<div class="sect"><div class="verdict warn">变量在卡里要写三处（画面板 objects / 初值 initial_state / ' +
    'Zod 校验 schema_code），少任何一处都不报错，只是安静地少一块 —— 体检里的 <code>VAR-SYNC</code> ' +
    '就是在查这个。<b>加变量请用上面的按钮</b>，工具会把三处一次写完；' +
    '手改过 Zod 之后点「对齐 Zod」能把三处重新对齐（已有的约束表达式不会被抹掉）。<br>' +
    '<b>改名</b>与<b>换对象</b>同理 —— 名字与挂靠都落在好几处，所以别手改：改名一次挪三处，' +
    '换对象把挂靠 / 初值那格 / Zod 那个字段一起搬到新对象下，<b>id 都不动</b>。' +
    '卡里正文写着旧名字的地方工具<b>只报不改</b>（分不清那是变量名还是恰好同字的词），改完自己扫一眼。' +
    '删错 / 改错都进回收站，能整得回来。</div></div>';
  return h;
}

/* ------------------------------------------------------------ 正则 */
function 画正则(d) {
  var 工具 = '<div class="row" style="margin-bottom:10px">' +
    '<button class="btn primary" id="btnNewRegex">＋ 正则</button>' +
    '<span style="color:var(--dim);font-size:12px">ElecKoi 按 order 从小到大依次跑；' +
    '前面的先动手，后面的看到的是它改完的文本。</span></div>';
  var h = '<div class="sect"><h2>正则 · ' + d.正则.length + ' 条</h2>' + 工具;
  if (!d.正则.length) {
    return h + '<div class="box" style="color:var(--dim)">这张卡没有正则。' +
      '界面上那些〔面板〕〔骰〕都是靠正则渲染成卡片的。</div></div>';
  }
  var 序 = d.正则.slice().sort(function (a, b) { return (a.顺序 || 0) - (b.顺序 || 0); });
  h += '<div class="box"><table class="tb">' +
    '<tr><th>顺序</th><th>名</th><th>作用</th><th>模式</th><th></th></tr>' +
    序.map(function (r) {
      return '<tr' + (r.开 ? '' : ' style="opacity:.5"') + '>' +
        '<td>' + (r.顺序 === null || r.顺序 === undefined ? '—' : r.顺序) + '</td>' +
        '<td>' + esc(r.名) + (r.开 ? '' : ' <span class="pill">停用</span>') + '</td>' +
        '<td class="dim2">' + esc((r.目标 || []).join('、')) + '</td>' +
        '<td><code class="dim2">' + esc(r.模式.slice(0, 68)) + '</code></td>' +
        '<td><button class="btn sm" data-正则开关="' + esc(r.名) + '" data-开="' +
        (r.开 ? '0' : '1') + '">' + (r.开 ? '停' : '启') + '</button> ' +
        '<button class="btn sm danger" data-删正则="' + esc(r.名) + '">删</button></td></tr>';
    }).join('') + '</table></div></div>';
  return h;
}

/* ------------------------------------------------------------ 体检 */
function 画体检(d) {
  var t = d.体检, s = t.摘要;
  var 全是工程 = function (lv) {
    var got = (t.问题 || []).filter(function (i) { return i.级别 === lv; });
    return got.length && got.every(function (i) { return i.编号.indexOf('PROJ-') === 0; });
  };
  var h = '';
  if (t.错) {
    h += 全是工程('ERROR')
      ? '<div class="verdict bad">卡本身没毛病，是<b>这个工程</b>里两处对不上（下面那些 PROJ-）' +
        '—— 不改的话，界面上会安静地少一块，或者交出去的还是老内容。</div>'
      : '<div class="verdict bad">有 ' + t.错 + ' 个错误 —— 导进客户端会有一部分「填了不生效」。先改错误。</div>';
  } else if (t.警告) {
    h += 全是工程('WARN')
      ? '<div class="verdict warn">卡本身没问题；工程层有几处对不上（PROJ-），建议看一眼。</div>'
      : '<div class="verdict warn">没有错误，' + t.警告 + ' 个警告建议看一眼。</div>';
  } else h += '<div class="verdict ok">没有错误，可以交付。</div>';

  h += '<div class="grid k3">' +
    统计卡(s.条目, '条目', '分 ' + s.分组 + ' 组') +
    统计卡(s.变量, '变量', '对象 ' + s.对象) +
    统计卡(s.正则, '正则', '') +
    统计卡(s.常驻字数, '常驻字数', '护栏 ' + s.常驻护栏, s.常驻字数 > s.常驻护栏 ? 'bad' : '') + '</div>';

  var 序 = ['ERROR', 'WARN', 'INFO'];
  var 名 = { ERROR: '错误', WARN: '警告', INFO: '提示' };
  序.forEach(function (lv) {
    var got = t.问题.filter(function (i) { return i.级别 === lv; });
    if (!got.length) return;
    h += '<div class="sect"><h2>' + 名[lv] + ' · ' + got.length + '</h2>' +
      got.map(function (i) {
        return '<div class="iss ' + lv + '"><div class="h">[' + esc(i.编号) + '] ' + esc(i.位置) + '</div>' +
          '<div class="m">' + esc(i.说明) + '</div>' +
          (i.修法 ? '<div class="f">→ ' + esc(i.修法) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
  });
  return h;
}

/* ------------------------------------------------------------ 机制 */
function 画机制(d) {
  var g = d.机制;
  var h = '<div class="sect"><h2>机制模块 · 挂上去就有，撤下来干净</h2><div class="grid k3">';
  h += g.模块.map(function (m) {
    var 接 = m.状态 !== '未接';
    var 带 = [];
    if (m.带条目) 带.push('条目');
    if (m.带正则) 带.push('正则');
    if (m.带脚本) 带.push('脚本');
    if (m.带样式) 带.push('样式');
    return '<div class="box mod' + (接 ? ' on' : '') + '">' +
      '<div class="h"><b>' + esc(m.名) + '</b><span class="v">v' + esc(m.版本) + '</span>' +
      (m.状态 === '落后' ? '<span class="pill warnp">仓库更新了</span>' : '') +
      (接 ? '<span class="pill req">已接</span>' : '') + '</div>' +
      '<div class="one">' + esc(m.一句话) + '</div>' +
      '<div style="font-size:11.5px;color:var(--dim)">带：' + (带.join(' / ') || '—') +
      (m.说明 ? ' · ' + esc(m.说明) : '') + '</div>' +
      '<div class="btns">' + (接
        ? '<button class="btn sm danger" data-机制="撤模块" data-名="' + esc(m.名) + '">撤下来</button>'
        : '<button class="btn sm primary" data-机制="接模块" data-名="' + esc(m.名) + '">接上去</button>') +
      '</div></div>';
  }).join('');
  h += '</div></div>';

  h += '<div class="sect"><h2>皮肤 · 只换颜色，不碰版式</h2><div class="grid k3">';
  h += 皮肤卡('核心默认', '核心自带的那套（羊皮卷）', {}, g.当前皮肤 === '核心默认（羊皮卷）' || g.当前皮肤 === '（未登记）');
  h += g.皮肤.map(function (t) {
    return 皮肤卡(t.名, t.一句话, t, g.当前皮肤 === t.名);
  }).join('');
  h += '</div><div class="pane-note">换皮肤只覆盖 CSS 变量槽（<code>--hud-*</code>），' +
    '核心样式一个字不动 —— 所以任何皮肤都能用在任何卡上。' +
    '下面的条是「最不利宿主背景」下的对比度，够不够按 AA 底线判。</div></div>';
  return h;
}

function 皮肤卡(名, 一句, t, 选中) {
  var h = '<div class="box skin' + (选中 ? ' on' : '') + '" data-皮肤="' + esc(名) + '">' +
    '<div class="h" style="display:flex;gap:7px;align-items:center"><b>' + esc(名) + '</b>' +
    (选中 ? '<span class="pill req">当前</span>' : '') + '</div>' +
    '<div style="font-size:12.5px;color:var(--ink2);min-height:2.4em">' + esc(一句 || '') + '</div>';
  if (t && t.对比度 && t.对比度.length) {
    h += '<div class="bars">' + t.对比度.map(function (r) {
      var pct = Math.min(100, Math.round(r.比度 / 7 * 100));
      return '<div class="bar' + (r.够 ? '' : ' bad') + '"><span>' + esc(r.角色) + '</span>' +
        '<i><b style="width:' + pct + '%"></b></i>' +
        '<span class="num">' + r.比度 + '</span></div>';
    }).join('') + '</div>';
    if (t.不达标 && t.不达标.length) {
      h += '<div style="font-size:11.5px;color:var(--bad)">⚠ ' + esc(t.不达标.join('、')) + ' 低于底线，真界面上会发糊。</div>';
    }
  }
  h += '</div>';
  return h;
}

/* ------------------------------------------------------------ 成品 */
function 画成品(d) {
  var 项 = [['卡', '卡 .card.json（导入 ElecKoi 的就是它）'],
    ['手册', '人读手册 .html（双击就看，不用装东西）'],
    ['索引', '给 AI 的导航索引 .md'],
    ['酒馆', '酒馆 V2 卡 .json（无损，能再转回来）'],
    ['打包', '整包 zip（内容层＋界面层＋成品＋文档）']];
  var h = '<div class="sect"><h2>要出什么</h2><div class="box">' +
    项.map(function (x) {
      return '<label class="chk" style="margin-bottom:7px"><input type="checkbox" data-项="' + x[0] + '"' +
        (x[0] === '卡' || x[0] === '手册' || x[0] === '索引' ? ' checked' : '') + '> ' +
        esc(x[0]) + ' <span style="color:var(--dim);font-size:12px">' + esc(x[1]) + '</span></label>';
    }).join('') +
    '<div class="row" style="margin-top:10px"><button class="btn primary" id="btnOut">生成</button>' +
    '<span style="color:var(--dim);font-size:12px">「打包」会先把界面重新组装一遍，组装不过就停，不拿半成品覆盖。</span></div>' +
    '</div></div>';
  h += '<div class="sect"><h2>已有成品</h2>' + 画文件表(d.成品) + '</div>';
  return h;
}

/* ------------------------------------------------------------ 原文 */
function 画原文(d) {
  return '<div class="sect"><h2>spec.yaml 原文</h2><div class="box">' +
    '<div class="pane-note" style="margin-top:0">这是这张卡的**唯一真相**。改完点保存，' +
    '服务端会先证明它解析得出、打得出卡，才落盘；打不出就自动还原并告诉你哪儿不对。' +
    '第一次保存时会把原文件备份到 <code>.workbuddy/原文备份/</code>。</div>' +
    '<div class="field" style="margin-top:12px"><textarea id="rawText" spellcheck="false"></textarea></div>' +
    '<div class="row"><button class="btn primary" id="btnSaveRaw">保存并体检</button>' +
    '<button class="btn" id="btnReloadRaw">重新读</button>' +
    '<button class="btn danger" id="btnRestoreRaw">还原到上次备份</button></div></div></div>';
}

/* ------------------------------------------------------------ 事件 */
function 绑事件() {
  document.querySelectorAll('[data-a]').forEach(function (n) {
    n.onclick = function () { 执行动作(n.getAttribute('data-a'), n.getAttribute('data-项')); };
  });
  document.querySelectorAll('.ent').forEach(function (n) {
    n.onclick = function (ev) {
      // 点的是那个勾：别顺手把右栏也切走
      if (ev && ev.target && ev.target.classList &&
          ev.target.classList.contains('ent-ck')) return;
      S.条目id = n.getAttribute('data-id'); 画主区();
    };
  });
  document.querySelectorAll('[data-勾]').forEach(function (n) {
    n.onclick = function (ev) { ev.stopPropagation(); };   // 冒到 .ent 就会跳页
    n.onchange = function () {
      var id = n.getAttribute('data-勾');
      if (n.checked) S.选中[id] = true; else delete S.选中[id];
      刷批量条();
    };
  });
  document.querySelectorAll('[data-机制]').forEach(function (n) {
    n.onclick = function () { 机制动作(n.getAttribute('data-机制'), n.getAttribute('data-名')); };
  });
  document.querySelectorAll('[data-皮肤]').forEach(function (n) {
    n.onclick = function () { 换皮肤(n.getAttribute('data-皮肤')); };
  });
  var b;
  if ((b = $('#btnSaveEntry'))) b.onclick = 保存条目;
  if ((b = $('#btnSaveCardShell'))) b.onclick = 保存卡壳;
  if ((b = $('#btnSaveOpener'))) b.onclick = 保存开场白;
  if ((b = $('#btnReloadEntry'))) b.onclick = function () { 画主区(); };
  if ((b = $('#btnNewEntry'))) b.onclick = 新条目弹层;
  if ((b = $('#btnGroups'))) b.onclick = 分组弹层;
  if ((b = $('#btnDupEntry'))) b.onclick = 复制条目;
  if ((b = $('#btnDelEntry'))) b.onclick = 删条目;
  if ((b = $('#btnToggleEntry'))) b.onclick = 切换条目启用;
  if ((b = $('#btnSelAll'))) b.onclick = function () {
    (S.详情.条目 || []).forEach(function (e) { S.选中[e.id] = true; });
    画主区();
  };
  if ((b = $('#btnSelNone'))) b.onclick = function () { S.选中 = {}; 画主区(); };
  if ((b = $('#btnBatchMove'))) b.onclick = 批量挪组弹层;
  if ((b = $('#btnBatchField'))) b.onclick = 批量改字段弹层;
  if ((b = $('#btnBatchOn'))) b.onclick = function () { 批量做('启用'); };
  if ((b = $('#btnBatchOff'))) b.onclick = function () { 批量做('停用'); };
  if ((b = $('#btnBatchDel'))) b.onclick = function () {
    var n = 选中名单().length;
    if (!n) return;
    if (!confirm('删掉选中的 ' + n + ' 条？进回收站，能整批还原。')) return;
    批量做('删');
  };
  if ((b = $('#moveGroup'))) b.onchange = 挪条目;
  if ((b = $('#btnNewObj'))) b.onclick = 新对象弹层;
  if ((b = $('#btnNewVar'))) b.onclick = 新变量弹层;
  if ((b = $('#btnAlign'))) b.onclick = 对齐schema;
  if ((b = $('#btnSelAllVar'))) b.onclick = function () {
    (S.详情.变量 || []).forEach(function (v) { S.选中变量[v.对象 + '.' + v.名] = true; });
    画主区();
  };
  if ((b = $('#btnSelNoneVar'))) b.onclick = function () { S.选中变量 = {}; 画主区(); };
  if ((b = $('#btnBatchDelVar'))) b.onclick = 批量删变量;
  document.querySelectorAll('[data-勾变量]').forEach(function (n) {
    n.onchange = function () {
      var k = n.getAttribute('data-勾变量');
      if (n.checked) S.选中变量[k] = true; else delete S.选中变量[k];
      刷变量批量条();
    };
  });
  if ((b = $('#btnNewRegex'))) b.onclick = 新正则弹层;
  if ((b = $('#btnOut'))) b.onclick = 出成品;
  if ((b = $('#btnSaveRaw'))) b.onclick = 保存原文;
  if ((b = $('#btnReloadRaw'))) b.onclick = 读原文;
  if ((b = $('#btnRestoreRaw'))) b.onclick = 还原原文;
  document.querySelectorAll('[data-删变量]').forEach(function (n) {
    n.onclick = function () {
      var 全名 = n.getAttribute('data-对象') + '.' + n.getAttribute('data-删变量');
      if (!confirm('删掉变量「' + 全名 + '」？三处会一起撤（面板 / 初值 / Zod），能还原。')) return;
      简单动作('删变量', { 变量: 全名 }, '已删变量');
    };
  });
  document.querySelectorAll('[data-删对象]').forEach(function (n) {
    n.onclick = function () {
      var 名 = n.getAttribute('data-删对象');
      if (!confirm('删掉变量对象「' + 名 + '」？它下面的变量会一起收走（能还原）。')) return;
      简单动作('删对象', { 对象: 名 }, '已删对象');
    };
  });
  document.querySelectorAll('[data-改对象]').forEach(function (n) {
    n.onclick = function () { 改名对象(n.getAttribute('data-改对象')); };
  });
  document.querySelectorAll('[data-改变量]').forEach(function (n) {
    n.onclick = function () {
      改名变量弹层(n.getAttribute('data-对象'), n.getAttribute('data-改变量'));
    };
  });
  document.querySelectorAll('[data-挪变量]').forEach(function (n) {
    n.onclick = function () {
      挪变量弹层(n.getAttribute('data-对象'), n.getAttribute('data-挪变量'));
    };
  });
  document.querySelectorAll('[data-删正则]').forEach(function (n) {
    n.onclick = function () {
      var 名 = n.getAttribute('data-删正则');
      if (!confirm('删掉正则「' + 名 + '」？能还原。')) return;
      简单动作('删正则', { 正则: 名 }, '已删正则');
    };
  });
  document.querySelectorAll('[data-正则开关]').forEach(function (n) {
    n.onclick = function () {
      简单动作('开关正则', { 正则: n.getAttribute('data-正则开关'),
                            开: n.getAttribute('data-开') === '1' }, '改好了');
    };
  });
  if (S.页签 === '原文') 读原文();
}

async function 简单动作(名, 体, 话) {
  try {
    var r = await api(名, Object.assign({ 工程: S.当前 }, 体));
    改完(r, 话);
  } catch (e) { toast(话 + '失败：' + e.message, 'bad'); }
}

/* ------------------------------------------------------------ 条目多选 / 批量 */
function 选中名单() {
  return Object.keys(S.选中).filter(function (k) { return S.选中[k]; });
}

function 刷批量条() {
  var n = 选中名单().length;
  var bar = $('#selBar');
  if (bar) bar.textContent = n + ' 条已选';
  ['#btnBatchMove', '#btnBatchField', '#btnBatchOn', '#btnBatchOff', '#btnBatchDel'].forEach(function (s) {
    var b = $(s);
    if (b) b.disabled = !n;
  });
}

async function 批量做(做, 到) {
  if (只读吗()) return;
  var 名单 = 选中名单();
  if (!名单.length) { toast('还没勾条目', 'bad'); return; }
  try {
    var r = await api('批量条目', { 工程: S.当前, 做: 做, 条目: 名单, 到: 到 || '' });
    S.选中 = {};
    改完(r, 做 + '了 ' + 名单.length + ' 条');
  } catch (e) { toast('没做成：' + e.message, 'bad'); }
}

function 批量挪组弹层() {
  if (只读吗()) return;
  var d = S.详情;
  var 名单 = 选中名单();
  if (!名单.length) { toast('还没勾条目', 'bad'); return; }
  弹层('<h3>批量挪组</h3>' +
    '<div class="lead">把勾中的 <b>' + 名单.length + '</b> 条一起挪到某个分组。' +
    '一次落盘、回收站里只留<b>一条</b>记录，还原时顺序 / 分组 / 启用状态一起回来。' +
    '（有认不出的名字会<b>整批停下、一条不动</b> —— 不会出现「挪了 10 条其实进了 6 条」。）</div>' +
    '<div class="field"><label>挪到</label><select id="bmTo">' +
    选项((d.分组 || []).map(function (g) { return g.名; }), '', '（未分组）') + '</select></div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">挪</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    var 到 = $('#bmTo').value;
    关弹层();
    await 批量做('挪', 到);
  };
}

/* 条目批量改字段：勾中的一批同时改成同一组字段 */
var 批量可改字段 = [
  ['title', '标题', 0], ['content', '正文', 0],
  ['keywords', '关键词（逗号分隔）', 0],
  ['agent_selection_hint', '读取提示', 0],
  ['trigger_mode', '触发方式', 1], ['agent_read_strategy', '读取策略', 1],
  ['insert_role', '插入角色', 1], ['content_mode', '正文解释', 1],
  ['dynamic_mode', '动态模式', 1], ['keyword_condition', '关键词条件', 1],
  ['position', '插入位置', 0]
];

function 批量改字段弹层() {
  if (只读吗()) return;
  var 名单 = 选中名单();
  if (!名单.length) { toast('还没勾条目', 'bad'); return; }
  var 有开场 = (S.详情.条目 || []).some(function (e) {
    return 名单.indexOf(e.id) >= 0 && e.类型 === 'opening';
  });
  弹层('<h3>批量改字段</h3>' +
    '<div class="lead">给勾中的 <b>' + 名单.length + '</b> 条同时改下面这一个字段。' +
    '一次落盘、回收站里只留<b>一条</b>记录，能整批还原。' +
    '值域字段写错会被当场拦下 —— 只要有一条会被静默降级，<b>整批一个字都不落盘</b>。' +
    (有开场 ? '<br><b>这批里有开场白条目：</b>开场白的正文不能这么改（真源在界面配置里，' +
      '末尾还挂着三个零宽标记），要改正文请走「开场白」那一栏。改别的字段不受影响。' : '') +
    '</div>' +
    '<div class="field"><label>改哪个字段</label><select id="bfField">' +
    批量可改字段.map(function (f) {
      return '<option value="' + f[0] + '">' + esc(f[1]) + '</option>';
    }).join('') + '</select></div>' +
    '<div class="field" id="bfValWrap"></div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">改</button></div>');
  画批量字段值();
  $('#bfField').onchange = 画批量字段值;
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = function () {
    var k = $('#bfField').value;
    var sel = $('#bfValWrap select');
    var ta = $('#bfVal');
    var v = sel ? sel.value : (ta ? ta.value : '');
    var 名 = (批量可改字段.filter(function (f) { return f[0] === k; })[0] || [])[1] || k;
    if (!confirm('把选中的 ' + 名单.length + ' 条的「' + 名 + '」统一改成：\n' +
        (v ? v.slice(0, 80) + (v.length > 80 ? '…' : '') : '（空）') + '\n\n确定？')) return;
    关弹层();
    批量改字段(k, v);
  };
}

function 画批量字段值() {
  var k = $('#bfField').value;
  var 型 = (批量可改字段.filter(function (f) { return f[0] === k; })[0] || [])[2];
  var wrap = $('#bfValWrap');
  if (!wrap) return;
  if (型 === 1 && S.真值域[k]) {
    wrap.innerHTML = '<label>改成</label>' + 下拉(k, '');
  } else {
    wrap.innerHTML = '<label>改成</label><textarea id="bfVal" style="min-height:90px" ' +
      'placeholder="留空 + 确定 = 把这个字段清成空"></textarea>' +
      (k === 'keywords' ? '<div class="hint">逗号或顿号分隔。</div>' : '') +
      (k === 'position' ? '<div class="hint">常驻条目（always）必须填位置，否则平台放不进去。</div>' : '');
  }
}

async function 批量改字段(k, v) {
  if (只读吗()) return;
  var 名单 = 选中名单();
  if (!名单.length) { toast('还没勾条目', 'bad'); return; }
  var 字段 = {};
  字段[k] = v;
  try {
    var r = await api('批量改条目', { 工程: S.当前, 条目: 名单, 字段: 字段 });
    改完(r, '改了 ' + 名单.length + ' 条');
  } catch (e) { toast('没改成：' + e.message, 'bad'); }
}

/* 变量多选 / 批量删 */
function 选中变量名单() {
  return Object.keys(S.选中变量).filter(function (k) { return S.选中变量[k]; });
}

function 刷变量批量条() {
  var n = 选中变量名单().length;
  var bar = $('#selVarBar');
  if (bar) bar.textContent = n + ' 个已选';
  var b = $('#btnBatchDelVar');
  if (b) b.disabled = !n;
}

async function 批量删变量() {
  if (只读吗()) return;
  var 名单 = 选中变量名单();
  if (!名单.length) { toast('还没勾变量', 'bad'); return; }
  if (!confirm('删掉选中的 ' + 名单.length + ' 个变量？每个变量三处会一起撤' +
      '（面板 / 初值 / Zod），进回收站能整批还原。')) return;
  try {
    var r = await api('批量删变量', { 工程: S.当前, 变量: 名单 });
    S.选中变量 = {};
    改完(r, '删了 ' + 名单.length + ' 个变量');
  } catch (e) { toast('没删成：' + e.message, 'bad'); }
}

async function 切换条目启用() {
  if (只读吗()) return;
  var d = S.详情;
  var e = (d.条目 || []).filter(function (x) { return x.id === S.条目id; })[0];
  if (!e) return;
  var 要开 = e.启用 === false;      // 现在禁用 → 点它就是要启用
  try {
    var r = await api('批量条目', {
      工程: S.当前, 做: 要开 ? '启用' : '停用', 条目: e.标题 || e.id
    });
    改完(r, 要开 ? '这条已启用' : '这条已停用（留着，但不会触发）');
  } catch (err) { toast('没改成：' + err.message, 'bad'); }
}

async function 复制条目() {
  if (只读吗()) return;
  try {
    var r = await api('复制条目', { 工程: S.当前, 条目: S.条目id });
    S.条目id = r.条目;
    改完(r, '复制好了（排在原件后面，顺序号在末尾）');
  } catch (e) { toast('没复制成：' + e.message, 'bad'); }
}

async function 删条目() {
  if (只读吗()) return;
  var e = (S.详情.条目 || []).filter(function (x) { return x.id === S.条目id; })[0];
  if (!confirm('删掉「' + (e ? e.标题 : S.条目id) + '」？会进回收站，随时能放回来。')) return;
  try {
    var r = await api('删条目', { 工程: S.当前, 条目: S.条目id });
    S.条目id = null;
    改完(r, '已删（回收站里留了一份）');
  } catch (x) { toast('没删成：' + x.message, 'bad'); }
}

async function 挪条目() {
  if (只读吗()) return;
  var sel = $('#moveGroup');
  if (!sel) return;
  try {
    var r = await api('挪条目', { 工程: S.当前, 条目: S.条目id, 分组: sel.value });
    改完(r, '挪到「' + (sel.value || '未分组') + '」');
  } catch (e) { toast('没挪成：' + e.message, 'bad'); }
}

async function 对齐schema() {
  if (只读吗()) return;
  try {
    var r = await api('对齐schema', { 工程: S.当前 });
    var 几 = 0;
    (r.日志 || []).forEach(function (s) { if (s.indexOf('·') === 0) 几++; });
    改完(r, 几 ? '对齐了 ' + 几 + ' 处，看下面日志' : '本来就是齐的，一个字没改');
  } catch (e) { toast('对不齐：' + e.message, 'bad'); }
}

function 收条目字段() {
  var out = {};
  document.querySelectorAll('[data-条目]').forEach(function (n) {
    out[n.getAttribute('data-条目')] = n.value;
  });
  return out;
}

async function 保存条目() {
  var btn = $('#btnSaveEntry');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 保存';
  try {
    var r = await api('存条目', { 工程: S.当前, 条目: S.条目id, 字段: 收条目字段() });
    toast(r.改了.length ? '已保存，动了：' + r.改了.join('、') : '没有变化', 'good');
    await 刷新详情();
  } catch (e) { toast('保存失败：' + e.message, 'bad'); btn.disabled = false; btn.textContent = '保存这一条'; }
}

async function 保存卡壳() {
  var 字段 = {};
  document.querySelectorAll('[data-卡壳]').forEach(function (n) {
    字段[n.getAttribute('data-卡壳')] = n.type === 'checkbox' ? n.checked : n.value;
  });
  try {
    var r = await api('存卡壳', { 工程: S.当前, 字段: 字段 });
    toast(r.改了.length ? '卡壳已保存：' + r.改了.join('、') : '没有变化', 'good');
    await 刷新详情();
  } catch (e) { toast('保存失败：' + e.message, 'bad'); }
}

async function 保存开场白() {
  var ta = $('#openerText');
  if (!ta) return;
  try {
    var r = await api('存开场白', { 工程: S.当前, 正文: ta.value });
    toast((r.日志 && r.日志[0]) || '已保存', 'good');
    await 刷新详情();
  } catch (e) { toast('保存失败：' + e.message, 'bad'); }
}

async function 读原文() {
  var ta = $('#rawText');
  if (!ta) return;
  try {
    var d = await apiGet('/api/原文', { 工程: S.当前 });
    ta.value = d.文本;
  } catch (e) { toast('读不出来：' + e.message, 'bad'); }
}

async function 保存原文() {
  var ta = $('#rawText');
  if (!ta) return;
  try {
    var r = await api('存原文', { 工程: S.当前, 文本: ta.value });
    toast('已保存（备份在 ' + r.备份.split(/[\\/]/).slice(-3).join('/') + '）', 'good');
    await 刷新详情();
  } catch (e) { toast('没写成：' + e.message, 'bad'); }
}

async function 还原原文() {
  if (!confirm('把 spec.yaml 还原到上次备份？当前改动会丢。')) return;
  try {
    await api('还原原文', { 工程: S.当前 });
    toast('已还原到上次备份', 'good');
    await 刷新详情();
  } catch (e) { toast('还原失败：' + e.message, 'bad'); }
}

async function 机制动作(动作, 名) {
  try {
    var r = await api(动作, { 工程: S.当前, 模块: [名] });
    var done = r.已接 || r.已撤 || [];
    toast(done.length ? 动作 + '「' + done.join('、') + '」完成' : '没有变化',
      done.length ? 'good' : undefined);
    S.日志 = (r.日志 || []).join('\n');
    if (r.详情) { S.详情 = r.详情; 画列表(); 画主区(); } else await 刷新详情();
  } catch (e) { toast(动作 + '失败：' + e.message, 'bad'); }
}

async function 换皮肤(名) {
  if (S.详情.只读) { toast(S.详情.只读, 'bad'); return; }
  try {
    var r = await api('换皮肤', { 工程: S.当前, 主题: 名 });
    toast('已换成「' + 名 + '」', 'good');
    S.日志 = (r.日志 || []).join('\n');
    if (r.详情) { S.详情 = r.详情; 画列表(); 画主区(); } else await 刷新详情();
  } catch (e) { toast('换皮肤失败：' + e.message, 'bad'); }
}

async function 执行动作(动作, 项) {
  try {
    if (动作 === '体检') {
      var r = await api('体检', { 工程: S.当前 });
      S.详情.体检 = r.体检; 页签跳('体检'); 画主区();
      toast('体检完成', 'good');
      return;
    }
    if (动作 === '组装') {
      var a = await api('组装', { 工程: S.当前 });
      S.日志 = (a.日志 || []).join('\n');
      toast(a.问题 && a.问题.length ? '组装有 ' + a.问题.length + ' 个问题，看日志' : '界面组装完成',
        a.问题 && a.问题.length ? 'bad' : 'good');
      if (a.详情) { S.详情 = a.详情; 画列表(); }
      页签跳('成品'); 画主区();
      return;
    }
    if (动作 === '出成品') {
      await 出成品(项);
      return;
    }
  } catch (e) { toast(e.message, 'bad'); }
}

function 页签跳(t) {
  S.页签 = t; localStorage.setItem('forge.页签', t);
}

async function 出成品(预设) {
  var 项 = [];
  if (预设) { 项 = 预设.split(','); }
  else {
    document.querySelectorAll('[data-项]').forEach(function (n) {
      if (n.checked) 项.push(n.getAttribute('data-项'));
    });
  }
  if (!项.length) { toast('先勾要出什么。'); return; }
  var btn = $('#btnOut');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 生成中'; }
  try {
    var r = await api('出成品', { 工程: S.当前, 项: 项 });
    S.日志 = (r.日志 || []).join('\n');
    toast('出好了：' + 项.join('、'), 'good');
    if (r.详情) { S.详情 = r.详情; 画列表(); }
    页签跳('成品'); 画主区();
  } catch (e) {
    toast('出成品失败：' + e.message, 'bad');
    if (btn) { btn.disabled = false; btn.textContent = '生成'; }
  }
}

/* ------------------------------------------------------------ 弹层 */
function 弹层(html) {
  $('#mask').className = 'mask';
  var m = $('#modal');
  m.className = 'modal';
  m.innerHTML = html;
}
function 关弹层() { $('#mask').className = 'mask hidden'; $('#modal').className = 'modal hidden'; }

function 开新卡弹层() {
  var 模块 = (S.模块 || []).map(function (x) {
    return '<label class="chk" style="margin-bottom:6px"><input type="checkbox" data-模="' + esc(x.名) + '"> ' +
      '<b>' + esc(x.名) + '</b> <span style="color:var(--dim);font-size:12px">v' + esc(x.版本) +
      ' · ' + esc(x.一句话) + '</span></label>';
  }).join('');
  弹层('<h3>开一张新卡</h3>' +
    '<div class="lead">从骨架抄一整套工程（内容层 + 界面层 + 测试 + 预览），出生就是能跑的最小验证。</div>' +
    '<div class="field"><label>卡名</label><input type="text" id="newName" placeholder="例：我的第一张卡"></div>' +
    '<div class="f2"><div class="field"><label>开在哪个目录</label>' +
    '<input type="text" id="newDest" value="' + esc(S.根) + '"></div>' +
    '<div class="field"><label>id 前缀（留空自动）</label>' +
    '<input type="text" id="newPrefix" placeholder="英文小写，如 mycard"></div></div>' +
    '<div class="field"><label>顺手接上的机制</label>' + (模块 || '<span style="color:var(--dim)">没有可选模块</span>') + '</div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">开卡</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    var 选 = [];
    document.querySelectorAll('[data-模]').forEach(function (n) { if (n.checked) 选.push(n.getAttribute('data-模')); });
    try {
      var r = await api('建卡', {
        名: $('#newName').value.trim(), 根: $('#newDest').value.trim(),
        id前缀: $('#newPrefix').value.trim(), 模块: 选
      });
      关弹层();
      toast('已开新卡：' + r.工程.卡名, 'good');
      var st = await apiGet('/api/状态', { 根: S.根 });
      S.工程 = st.工程; 画列表();
      await 打开(r.工程.路径);
    } catch (e) { toast('开卡失败：' + e.message, 'bad'); }
  };
  setTimeout(function () { $('#newName').focus(); }, 30);
}

function 导入卡弹层() {
  弹层('<h3>导入一张现成的卡</h3>' +
    '<div class="lead">ElecKoi 卡（.card.json）或酒馆 V2 卡（.json）都认。会解包成一份 spec.yaml，' +
    '放进指定目录下的同名工程里。</div>' +
    '<div class="field"><label>卡文件的完整路径</label>' +
    '<input type="text" id="impPath" placeholder="D:\\下载\\某张卡.card.json" spellcheck="false"></div>' +
    '<div class="field"><label>放到哪个目录</label><input type="text" id="impDest" value="' + esc(S.根) + '"></div>' +
    '<div class="lead" style="margin:0">导入进来的是外来卡，**只有内容层**，没有界面层（hud/）。</div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">导入</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    try {
      var r = await api('导入卡', { 文件: $('#impPath').value.trim(), 根: $('#impDest').value.trim() });
      关弹层();
      toast('已导入：' + r.工程.卡名, 'good');
      var st = await apiGet('/api/状态', { 根: S.根 });
      S.工程 = st.工程; 画列表();
      await 打开(r.工程.路径);
    } catch (e) { toast('导入失败：' + e.message, 'bad'); }
  };
}

function 收包弹层() {
  弹层('<h3>收一个工程包</h3>' +
    '<div class="lead">别人给你的 <code>.工程包.zip</code>，或者单张 <code>.card.json</code>。' +
    '包里那份 <code>包信息.json</code> 会先核一遍完整性；条目名不可信的包**整个拒收**。</div>' +
    '<div class="field"><label>包的完整路径</label>' +
    '<input type="text" id="pkPath" placeholder="D:\\下载\\某张卡.工程包.zip" spellcheck="false"></div>' +
    '<div class="field"><label>收到哪个目录</label><input type="text" id="pkDest" value="' + esc(S.根) + '"></div>' +
    '<div class="lead" style="margin:0">同名工程已经在了会停下 —— 换个目录，或者在命令里加 <code>--改名</code>。</div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">收包</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    try {
      var r = await api('导入包', { 包: $('#pkPath').value.trim(), 根: $('#pkDest').value.trim() });
      关弹层();
      toast('已收下：' + r.工程.卡名, 'good');
      var st = await apiGet('/api/状态', { 根: S.根 });
      S.工程 = st.工程; 画列表();
      await 打开(r.工程.路径);
    } catch (e) { toast('收包失败：' + e.message, 'bad'); }
  };
  setTimeout(function () { $('#pkPath').focus(); }, 30);
}

/* ------------------------------------------------------------ 增 / 删 */
/* 后端那一套动作和命令行共用一份内核：改不成会把原话退回来，这里照说就是。 */
function 改完(r, 话) {
  if (r) {
    S.日志 = (r.日志 || []).join('\n');
    if (r.详情) { S.详情 = r.详情; 画列表(); }
  }
  toast(话, 'good');
  画主区();
}

function 只读吗() {
  if (S.详情 && S.详情.只读) { toast(S.详情.只读, 'bad'); return true; }
  return false;
}

function 选项(list, 当前, 空一档) {
  var h = 空一档 ? '<option value="">' + esc(空一档) + '</option>' : '';
  return h + (list || []).map(function (x) {
    return '<option value="' + esc(x) + '"' + (x === 当前 ? ' selected' : '') + '>' +
      esc(x) + '</option>';
  }).join('');
}

function 新条目弹层() {
  if (只读吗()) return;
  var d = S.详情;
  弹层('<h3>新条目</h3>' +
    '<div class="lead">模板只是把几个字段凑成常见的一档，建好之后随便改。' +
    '<b>常驻</b>要填位置（默认给了 instructions）；<b>关键词</b>要有关键词，' +
    '否则这条永远不触发 —— 这几条工具都会帮你盯着。</div>' +
    '<div class="f2">' +
    '<div class="field"><label>标题</label><input type="text" id="neTitle" placeholder="例：可选 · 时局压力"></div>' +
    '<div class="field"><label>分组</label><select id="neGroup">' +
    选项((d.分组 || []).map(function (g) { return g.名; }), '', '（未分组）') + '</select></div></div>' +
    '<div class="field"><label>模板</label><select id="neTpl">' + 选项(d.模板 || [], '常驻', '') + '</select></div>' +
    '<div class="field"><label>关键词（逗号分隔；模板选「关键词」时必填）</label>' +
    '<input type="text" id="neKw" placeholder="判定,掷骰,检定"></div>' +
    '<div class="field"><label>读取提示 <code>agent_selection_hint</code>' +
    '（由 AI 读的条目最好填；留空就是留空，工具不替你编）</label>' +
    '<input type="text" id="neHint" placeholder="例：玩家问到时间、节气、赶路时读这条"></div>' +
    '<div class="field"><label>正文（可以先留空，稍后在左栏里写）</label>' +
    '<textarea id="neBody" style="min-height:130px"></textarea></div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">建这条</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    var 标题 = $('#neTitle').value.trim();
    var btn = $('#mOk'); btn.disabled = true; btn.textContent = '建…';
    try {
      var r = await api('新条目', {
        工程: S.当前, 标题: 标题, 分组: $('#neGroup').value,
        模板: $('#neTpl').value, 关键词: $('#neKw').value, 正文: $('#neBody').value,
        读取提示: $('#neHint').value
      });
      关弹层(); S.条目id = r.条目; 页签跳('条目');
      改完(r, '已加：「' + 标题 + '」');
    } catch (e) {
      toast('没建成：' + e.message, 'bad');
      btn.disabled = false; btn.textContent = '建这条';
    }
  };
  setTimeout(function () { $('#neTitle').focus(); }, 30);
}

function 分组弹层() {
  if (只读吗()) return;
  var d = S.详情;
  var 行 = (d.分组 || []).map(function (g) {
    var n = d.条目.filter(function (x) { return x.分组名 === g.名; }).length;
    return '<div class="file"><span class="n">' + esc(g.名) + '</span>' +
      '<span class="s">' + n + ' 条</span>' +
      '<button class="btn sm" data-改组="' + esc(g.id) + '" data-名="' + esc(g.名) + '">改名</button>' +
      '<button class="btn sm danger" data-删组="' + esc(g.id) + '">删</button></div>';
  }).join('') || '<div style="color:var(--dim);font-size:13px">这张卡还没有分组。</div>';
  弹层('<h3>分组管理</h3>' +
    '<div class="lead">删分组**不删内容**：里面的条目会挪到「未分组」，' +
    '而且这一步进回收站 —— 还原时连「谁原来在这一组」一起回来。</div>' +
    '<div class="field"><label>新分组</label><div class="row">' +
    '<input type="text" id="grpName" style="flex:1" placeholder="例：规则">' +
    '<button class="btn primary" id="mNewGrp">建</button></div></div>' +
    '<div class="files" style="margin-top:12px">' + 行 + '</div>' +
    '<div class="foot"><button class="btn" id="mCancel">关掉</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mNewGrp').onclick = async function () {
    var 名 = $('#grpName').value.trim();
    if (!名) { toast('名字不能空', 'bad'); return; }
    try {
      var r = await api('新分组', { 工程: S.当前, 名: 名 });
      S.日志 = (r.日志 || []).join('\n');
      if (r.详情) S.详情 = r.详情;
      toast('已建分组「' + 名 + '」', 'good');
      分组弹层();
    } catch (e) { toast('没建成：' + e.message, 'bad'); }
  };
  document.querySelectorAll('[data-改组]').forEach(function (n) {
    n.onclick = async function () {
      var 旧 = n.getAttribute('data-名');
      var 新 = prompt('「' + 旧 + '」改成什么？', 旧);
      if (!新 || 新 === 旧) return;
      try {
        var r = await api('改名分组', { 工程: S.当前, 分组: n.getAttribute('data-改组'), 名: 新.trim() });
        S.日志 = (r.日志 || []).join('\n');
        if (r.详情) { S.详情 = r.详情; 画列表(); }
        toast('改好了', 'good');
        分组弹层();
      } catch (e) { toast('没改成：' + e.message, 'bad'); }
    };
  });
  document.querySelectorAll('[data-删组]').forEach(function (n) {
    n.onclick = async function () {
      if (!confirm('删掉这个分组？里面的条目会挪到「未分组」（内容不删），这一步能还原。')) return;
      try {
        var r = await api('删分组', { 工程: S.当前, 分组: n.getAttribute('data-删组') });
        关弹层(); S.日志 = (r.日志 || []).join('\n');
        if (r.详情) S.详情 = r.详情;
        画列表();
        改完(r, '分组已删（能还原）');
      } catch (e) { toast('没删成：' + e.message, 'bad'); }
    };
  });
  setTimeout(function () { $('#grpName').focus(); }, 30);
}

function 新对象弹层() {
  if (只读吗()) return;
  var d = S.详情;
  弹层('<h3>新变量对象</h3>' +
    '<div class="lead">对象是面板上的一格。对象下面放变量；对象也能套对象（选个父）。' +
    '建的时候工具会同时把 <code>initial_state</code> 和 <code>schema_code</code> 补上。</div>' +
    '<div class="f2"><div class="field"><label>对象名</label>' +
    '<input type="text" id="noName" placeholder="例：声望"></div>' +
    '<div class="field"><label>父对象（可选）</label><select id="noParent">' +
    选项((d.对象 || []).map(function (o) { return o.名; }), '', '（顶层）') + '</select></div></div>' +
    '<div class="field"><label>说明（写给以后的自已看）</label>' +
    '<input type="text" id="noDesc" placeholder="面板上这一格是干什么的"></div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">建</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    var 名 = $('#noName').value.trim();
    try {
      var r = await api('新对象', {
        工程: S.当前, 名: 名, 父: $('#noParent').value, 说明: $('#noDesc').value
      });
      关弹层();
      改完(r, '已建对象「' + 名 + '」');
    } catch (e) { toast('没建成：' + e.message, 'bad'); }
  };
  setTimeout(function () { $('#noName').focus(); }, 30);
}

function 新变量弹层() {
  if (只读吗()) return;
  var d = S.详情;
  if (!d.对象.length) { toast('先建一个变量对象', 'bad'); 新对象弹层(); return; }
  var 初值提示 = { boolean: 'true / false', number: '3', string: '随便写', array: '甲,乙（或 ["甲","乙"]）', object: '{"a":1}' };
  弹层('<h3>新变量</h3>' +
    '<div class="lead">加一个变量，工具会把三处**一次**写完：面板对象、初始值、Zod 校验。' +
    '手写很容易漏掉 Zod 那一处，而漏了不报错 —— 运行时只是安静地丢掉这个值。</div>' +
    '<div class="f2"><div class="field"><label>对象</label><select id="nbObj">' +
    选项((d.对象 || []).map(function (o) { return o.名; }), '', '') + '</select></div>' +
    '<div class="field"><label>变量名</label><input type="text" id="nbName" placeholder="例：声望"></div></div>' +
    '<div class="f2"><div class="field"><label>类型</label><select id="nbType">' +
    选项(d.变量类型 || ['string', 'number', 'boolean', 'array', 'object'], 'string', '') +
    '</select><div class="hint" id="nbHint"></div></div>' +
    '<div class="field"><label>初值</label><input type="text" id="nbValue" placeholder="可以留空"></div></div>' +
    '<div class="field"><label>说明</label><input type="text" id="nbDesc" placeholder="这一格代表什么"></div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">建</button></div>');
  var 提示 = function () { $('#nbHint').textContent = '初值写法：' + (初值提示[$('#nbType').value] || ''); };
  $('#nbType').onchange = 提示; 提示();
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    try {
      var r = await api('新变量', {
        工程: S.当前, 对象: $('#nbObj').value, 标题: $('#nbName').value.trim(),
        类型: $('#nbType').value, 初值: $('#nbValue').value, 说明: $('#nbDesc').value
      });
      var 名 = $('#nbObj').value + '.' + $('#nbName').value.trim();
      关弹层();
      改完(r, '已加变量「' + 名 + '」（三处都写了）');
    } catch (e) { toast('没建成：' + e.message, 'bad'); }
  };
  setTimeout(function () { $('#nbName').focus(); }, 30);
}

function 改名变量弹层(对象, 名) {
  if (只读吗()) return;
  弹层('<h3>给变量改名</h3>' +
    '<div class="lead">变量名同时住在<b>三个地方</b>：面板这一行、初值那一格的<b>键</b>、Zod 里那个' +
    '<b>字段名</b>。改名字工具会一次把三处挪过去，<b>id 不动</b> —— 卡里按 id 引用的地方不会断。' +
    '正文 / 读取提示里写着旧名字的地方工具<b>只报不改</b>（分不清那是变量名还是恰好同字的词），' +
    '改完自己扫一眼。</div>' +
    '<div class="field"><label>现在的名字</label>' +
    '<input type="text" value="' + esc(对象 + '.' + 名) + '" disabled></div>' +
    '<div class="field"><label>新名字</label><input type="text" id="rnName" value="' + esc(名) + '"></div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">改</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    var 新 = $('#rnName').value.trim();
    if (!新 || 新 === 名) { 关弹层(); return; }
    try {
      var r = await api('改名变量', { 工程: S.当前, 变量: 对象 + '.' + 名, 新名: 新 });
      关弹层();
      改完(r, '「' + 名 + '」已改名为「' + 新 + '」（三处一起挪了）');
    } catch (e) { toast('没改成：' + e.message, 'bad'); }
  };
  setTimeout(function () { var n = $('#rnName'); n.focus(); n.select(); }, 30);
}

function 挪变量弹层(对象, 名) {
  if (只读吗()) return;
  var d = S.详情;
  var 别的 = (d.对象 || []).filter(function (o) { return o.名 !== 对象; });
  if (!别的.length) { toast('这张卡只有一个变量对象，没地方挪。', 'bad'); return; }
  弹层('<h3>把变量挪到别的对象下</h3>' +
    '<div class="lead">名字不变，换的是它<b>挂在哪儿</b>：挂靠关系 / 初值那一格 / Zod 那个字段' +
    '一起搬到新对象那棵子树下，顺带排到新对象末尾。<b>id 同样不动</b>。挪错了进回收站，能整得回来。</div>' +
    '<div class="field"><label>变量</label>' +
    '<input type="text" value="' + esc(对象 + '.' + 名) + '" disabled></div>' +
    '<div class="field"><label>挪到哪个对象</label><select id="mvTo">' +
    选项(别的.map(function (o) { return o.名; }), '', '') + '</select></div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">挪</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    var 到 = $('#mvTo').value;
    if (!到) { toast('先选一个对象', 'bad'); return; }
    try {
      var r = await api('换变量对象', { 工程: S.当前, 变量: 对象 + '.' + 名, 到: 到 });
      关弹层();
      改完(r, '「' + 名 + '」已挪到「' + 到 + '」下');
    } catch (e) { toast('没挪成：' + e.message, 'bad'); }
  };
}

async function 改名对象(名) {
  if (只读吗()) return;
  var 新 = prompt('变量对象「' + 名 + '」改成什么？', 名);
  if (!新 || 新 === 名) return;
  简单动作('改名对象', { 对象: 名, 新名: 新.trim() }, '对象已改名');
}

function 新正则弹层() {
  if (只读吗()) return;
  var d = S.详情;
  var 最大 = (d.正则 || []).reduce(function (a, r) { return Math.max(a, r.顺序 || 0); }, 0);
  弹层('<h3>新正则</h3>' +
    '<div class="lead">模式写成 <code>/…/g</code> 或纯字面量（如 <code>〔面板〕</code>）。' +
    '替换里 <code>$1</code> 是第一个捕获组。</div>' +
    '<div class="field"><label>名字</label><input type="text" id="nrName" placeholder="例：高亮 · 重点"></div>' +
    '<div class="field"><label>模式</label><input type="text" id="nrPat" spellcheck="false" placeholder="/〔重点〕([^〕]+)/g"></div>' +
    '<div class="field"><label>替换（留空 = 只删不换）</label>' +
    '<textarea id="nrRepl" spellcheck="false" style="min-height:90px" placeholder="<b>$1</b>"></textarea></div>' +
    '<div class="f2"><div class="field"><label>作用在哪儿</label>' +
    '<input type="text" id="nrTarget" value="AiOutput"></div>' +
    '<div class="field"><label>顺序</label><input type="text" id="nrOrder" value="' + (最大 + 10) + '"></div></div>' +
    '<div class="foot"><button class="btn" id="mCancel">取消</button>' +
    '<button class="btn primary" id="mOk">加</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mOk').onclick = async function () {
    var 名 = $('#nrName').value.trim();
    try {
      var r = await api('新正则', {
        工程: S.当前, 名: 名, 模式: $('#nrPat').value,
        替换: $('#nrRepl').value, 目标: $('#nrTarget').value, 顺序: $('#nrOrder').value
      });
      关弹层();
      改完(r, '已加正则「' + 名 + '」');
    } catch (e) { toast('没加成：' + e.message, 'bad'); }
  };
  setTimeout(function () { $('#nrName').focus(); }, 30);
}

async function 回收站弹层() {
  try {
    var r = await api('回收站', { 工程: S.当前 });
  } catch (e) { toast('打不开：' + e.message, 'bad'); return; }
  var 行 = (r.回收站 || []).map(function (x) {
    return '<div class="file"><span class="n">' + esc(x.说明) + '</span>' +
      '<span class="s">' + esc((x.时间 || '').slice(0, 19).replace('T', ' ')) + '</span>' +
      '<span class="s">' + x.项数 + ' 项</span>' +
      '<button class="btn sm primary" data-还原="' + x.序号 + '">放回去</button></div>';
  }).join('') || '<div style="color:var(--dim);font-size:13px">回收站是空的 —— 还没删过东西。</div>';
  弹层('<h3>回收站</h3>' +
    '<div class="lead">删条目 / 删分组 / 删变量 / 删正则，都会先在这儿留一份。' +
    '放回去是**逐项**放的：编号已经不在了的会跳过，不会盖掉你现在写的东西。</div>' +
    '<div style="font-size:12px;color:var(--dim);font-family:var(--mono);margin-bottom:10px">' +
    esc(S.当前) + '/' + esc(r.目录) + '</div>' +
    '<div class="files">' + 行 + '</div>' +
    '<div class="foot"><button class="btn danger" id="mClear">清空回收站</button>' +
    '<button class="btn" id="mCancel">关掉</button></div>');
  $('#mCancel').onclick = 关弹层;
  $('#mClear').onclick = async function () {
    if (!confirm('把回收站清空？清掉就真找不回来了（当前卡的内容不受影响）。')) return;
    try {
      var x = await api('清空回收站', { 工程: S.当前 });
      关弹层();
      改完(x, '回收站清空了');
    } catch (e) { toast('没清成：' + e.message, 'bad'); }
  };
  document.querySelectorAll('[data-还原]').forEach(function (n) {
    n.onclick = async function () {
      n.disabled = true;
      try {
        var x = await api('还原', { 工程: S.当前, 序号: n.getAttribute('data-还原') });
        关弹层();
        改完(x, '放回去了');
      } catch (e) {
        toast('没放回去：' + e.message, 'bad');
        n.disabled = false;
      }
    };
  });
}

/* ------------------------------------------------------------ 顶栏 */
$('#mask').onclick = 关弹层;
$('#btnNew').onclick = 开新卡弹层;
$('#btnImport').onclick = 导入卡弹层;
$('#btnPackIn').onclick = 收包弹层;
$('#btnTrash').onclick = 回收站弹层;
$('#btnReload').onclick = 启动;
$('#btnRoot').onclick = function () {
  S.根 = $('#rootInput').value.trim();
  localStorage.setItem('forge.根', S.根);
  S.当前 = ''; 启动();
};
$('#rootInput').onkeydown = function (e) { if (e.key === 'Enter') $('#btnRoot').click(); };

启动();
})();
