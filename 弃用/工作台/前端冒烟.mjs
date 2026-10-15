// 工作台前端渲染冒烟：拿 DOM 桩把 app.js 真跑起来，
// 直接断言「画条目 / 画变量」吐出来的 HTML 里，该有的控件真在。
//
//   （已随工作台迁出，见 ../README.md；要跑：进本目录 node 前端冒烟.mjs）
//
// 为什么要有它：工作台前端一直没人测，改了 app.js 只能靠肉眼看。
// 这台机器上没跑 playwright（要拉 Chromium，太重），于是用最轻的办法 ——
// 只验渲染函数吐出的那串 HTML，够抓住「按钮没渲染出来 / 条件写反了」这类错。
import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';

const 源路径 = fileURLToPath(new URL('./前端/app.js', import.meta.url));
let src = fs.readFileSync(源路径, 'utf8');

// 不跑启动流程（要 DOM），只把几个渲染函数递出来
const 改后 = src.replace(
  /\n启动\(\);(\s*)\}\)\(\);\s*$/,
  '\nglobalThis.__T = { 画变量, 画条目, 条目标签, 选中名单, 选中变量名单, S };\n})();\n'
);
if (改后 === src) { console.log('✗ 没能挂上导出（app.js 末尾形状变了）'); process.exit(1); }
src = 改后;

const 假元素 = () => new Proxy({
  classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
  style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
  checked: false, disabled: false
}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'toString') return () => '[假元素]';
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; }
});

const context = {
  document: {
    querySelector: () => 假元素(),
    querySelectorAll: () => [],
    createElement: () => 假元素()
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  window: { __TOKEN__: '自检用' },
  fetch: async () => ({ json: async () => ({ 好: true, 数据: {} }) }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  console, confirm: () => true, prompt: () => null, alert() {},
  location: { reload() {}, href: '' }, navigator: { clipboard: { writeText: async () => {} } },
  URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob: function () {},
  MutationObserver: function () { return { observe() {}, disconnect() {} }; }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(src, context);

const T = context.__T;
if (!T) { console.log('✗ 没拿到导出'); process.exit(1); }

/* ---- 一份最小的假详情（字段照 project_detail 的形状） ---- */
const 条 = (id, 标题, 启用) => ({
  id, 标题, 类型: 'normal', 分组: '', 分组名: '（未分组）', 顺序: 1, 启用,
  触发: 'always', 策略: 'required', 关键词: ['时间', '节气'], 位置: 'instructions',
  角色: 'system', 读取提示: '', 解释: '', 关键词条件: '', 动态模式: '', 图标: '',
  正文: '正文', 正文长度: 2, 开场分支: 0
});
const 详情 = {
  卡壳: { name: '冒烟卡', opening: '', group: '' },
  开场白: { 有开场白: true, 正文: '你好', 字数: 2, 标记数: 3, 写回一致: true, 条目: 'fixed-opening-assistant' },
  条目: [条('e1', '第一条', true), 条('e2', '第二条（禁用的）', false)],
  分组: [{ id: 'g1', 名: '世界', 父: '', 顺序: 1 }],
  对象: [{ id: 'o1', 名: '面板', 父: '', 变量数: 1, 说明: '', 固定: false },
        { id: 'o2', 名: '背包', 父: '', 变量数: 0, 说明: '', 固定: false }],
  变量: [{ id: 'v1', 名: '声望', 类型: 'number', 初值: '5', 说明: '', 对象: '面板', 对象id: 'o1' }],
  正则: [], 模板: ['常驻'], 变量类型: ['string', 'number'], 回收站: 0
};

const 条目HTML = T.画条目(详情);
const 变量HTML = T.画变量(详情);
const 禁用标签 = T.条目标签(条('e9', 'x', false));

// 右栏编辑器要有「当前选中」才渲染 —— 挑那条禁用的
T.S.条目id = 'e2';
const 编辑器HTML = T.画条目(详情);

const 检查 = [
  ['条目：多选框渲染出来了', 条目HTML.includes('class="ent-ck"') && 条目HTML.includes('data-勾="e1"')],
  ['条目：全选 / 清空按钮在', 条目HTML.includes('id="btnSelAll"') && 条目HTML.includes('id="btnSelNone"')],
  ['条目：批量五个动作都在（含新加的「批量改字段」）',
    ['btnBatchMove', 'btnBatchField', 'btnBatchOn', 'btnBatchOff', 'btnBatchDel']
      .every((x) => 条目HTML.includes('id="' + x + '"'))],
  ['条目：没勾时批量按钮是禁用的',
    条目HTML.includes('id="btnBatchDel" disabled') && 条目HTML.includes('id="btnBatchField" disabled')],
  ['条目：编辑器有启用/停用开关（禁用条目上写「启用这条」）',
    编辑器HTML.includes('id="btnToggleEntry"') && 编辑器HTML.includes('启用这条')],
  ['条目：未禁用的条目上写「停用这条」', (function () {
    T.S.条目id = 'e1'; const h = T.画条目(详情); T.S.条目id = 'e2';
    return h.includes('停用这条');
  })()],
  ['条目：禁用条目显示「已禁用」', 禁用标签.includes('已禁用')],
  ['变量：每行有 改名 / 换对象 / 删', 变量HTML.includes('data-改变量="声望"')
    && 变量HTML.includes('data-挪变量="声望"') && 变量HTML.includes('data-删变量="声望"')],
  ['变量：对象行有「改名」', 变量HTML.includes('data-改对象="面板"')],
  ['变量：面板没被写坏（原有按钮还在）', 变量HTML.includes('id="btnNewVar"') && 变量HTML.includes('id="btnAlign"')],
  ['变量：每行有多选框', 变量HTML.includes('class="var-ck"') && 变量HTML.includes('data-勾变量="面板.声望"')],
  ['变量：全选 / 清空 / 批量删都在',
    ['btnSelAllVar', 'btnSelNoneVar', 'btnBatchDelVar'].every((x) => 变量HTML.includes('id="' + x + '"'))],
  ['变量：没勾时「批量删」是禁用的', 变量HTML.includes('id="btnBatchDelVar" disabled')],
];

// 勾上两条之后：批量条上的数字与按钮状态
T.S.选中 = { e1: true, e2: true };
const 勾后 = T.画条目(详情);
检查.push(['条目：勾两条后显示「2 条已选」', 勾后.includes('2 条已选') && !勾后.includes('id="btnBatchDel" disabled')]);
检查.push(['条目：勾选状态回显在复选框上', (勾后.match(/checked/g) || []).length === 2]);

// 变量也勾一个：批量条数字与按钮要跟着活
T.S.选中变量 = { '面板.声望': true };
const 变量勾后 = T.画变量(详情);
检查.push(['变量：勾一个后显示「1 个已选」',
  变量勾后.includes('1 个已选') && !变量勾后.includes('id="btnBatchDelVar" disabled')]);
检查.push(['变量：勾选状态回显在复选框上', (变量勾后.match(/checked/g) || []).length === 1]);

let 全过 = true;
for (const [名, 过] of 检查) {
  console.log((过 ? '  ✔ ' : '  ✗ ') + 名);
  if (!过) 全过 = false;
}
console.log(全过 ? '\n前端渲染冒烟：全绿 ✔' : '\n前端渲染冒烟：有失败 ✗');
process.exit(全过 ? 0 : 1);
