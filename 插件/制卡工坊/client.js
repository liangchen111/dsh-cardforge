/**
 * 浏览器那一半 —— 「制卡工坊」面板。
 *
 * 目的：**使用者永远不碰命令**。面板上全是人话按钮，点一下 = 把一句人话送进当前对话，
 * 由对话里的 AI（配「制卡助手」预设）去干活。
 *
 * 两处挂载：
 *   1. `main`（keyed）—— 注册一整页「制卡工坊」
 *   2. `sidebar.panellist`（list）—— 侧栏上的入口图标
 *
 * 说话的办法（服务 `eleckoiConversations`，客户端自己的服务）：
 *   readSelection() → { active_conversation_id }
 *   writeInputDraft(conversationId, text)  写进官方输入框
 *   submitInput(conversationId) → boolean  请官方输入框提交
 * 用官方输入框而不是 `send()`：文本会先在输入框里露一下，用户看得见、出事好回退。
 *
 * 注意：`id` 必须**等于**包名（官方要求），这里是 `dsh-cardforge`。
 * React 由浏览器模块表提供，不要自己再装一份。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cardforge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /* ---------------- 说话 ---------------- */

    function 取服务(ctx, 名) {
      const 表 = [ctx?.[名], ctx?.get?.(名), ctx?.services?.[名]];
      return 表.find((x) => x) ?? null;
    }

    async function 发话(ctx, 话) {
      const 服务 = 取服务(ctx, 'eleckoiConversations');
      if (!服务) throw new Error('这台 ElecKoi 没给对话服务，发不出去。');
      const 选 = await 服务.readSelection();
      const 编号 = 选?.active_conversation_id;
      if (!编号) throw new Error('先打开一个聊天，再点这里。');
      服务.writeInputDraft(编号, 话);
      if (!服务.submitInput(编号)) throw new Error('没发出去 —— 输入框正忙或内容被清空了。');
    }

    /* ---------------- 人话模板 ---------------- */

    const 新建 = (名, 题材, 感觉) =>
      '帮我做一张新卡。' +
      (名 ? `名字先叫「${名}」。` : '') +
      (题材 ? `它讲的是：${题材}` : '') +
      (感觉 ? `我想要的感觉是：${感觉}` : '') +
      '你先取规程，再把要先定下来的几件事一次问完，别一条一条挤牙膏。';

    const 常用 = [
      { k: '继续', 名: '接着做这张卡', 话: () => '接着把这张卡做下去——我们上次停在哪儿，你先看一眼再动手。' },
      { k: '体检', 名: '给它体检', 话: () => '给这张卡做一次体检，问题按轻重排给我，能顺手修的直接修掉。' },
      { k: '成品', 名: '出成品', 话: () => '把这张卡出成成品。出完告诉我卡名，以及成品文件在哪儿。' },
      { k: '导入', 名: '导进 ElecKoi', 话: () => '把这张卡的成品导进 ElecKoi。' },
    ];

    /* ---------------- 样式 ---------------- */

    const 页 = { padding: '28px 32px', maxWidth: '46rem', color: 'currentColor', lineHeight: 1.7 };
    const 标题 = { fontSize: '20px', fontWeight: 600, margin: '0 0 4px' };
    const 小字 = { fontSize: '12px', opacity: 0.6, margin: '0 0 22px' };
    const 分节 = { fontSize: '13px', fontWeight: 600, opacity: 0.75, margin: '26px 0 10px' };
    const 卡列 = { display: 'grid', gap: '10px' };
    const 按钮 = {
      padding: '13px 16px',
      border: '1px solid currentColor',
      borderRadius: '10px',
      background: 'transparent',
      color: 'inherit',
      fontSize: '14px',
      textAlign: 'left',
      cursor: 'pointer',
      fontFamily: 'inherit',
    };
    const 主按钮 = { ...按钮, borderColor: 'currentColor', fontWeight: 600, textAlign: 'center' };
    const 输入 = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '10px 12px',
      border: '1px solid currentColor',
      borderRadius: '8px',
      background: 'transparent',
      color: 'inherit',
      fontSize: '14px',
      fontFamily: 'inherit',
      opacity: 0.9,
    };
    const 提示 = (色) => ({
      margin: '12px 0 0',
      padding: '8px 12px',
      borderRadius: '8px',
      fontSize: '12.5px',
      border: `1px solid ${色}`,
      opacity: 0.9,
    });

    /* ---------------- 新建表单 ---------------- */

    function 新建夹(ctx, 报) {
      const [名, 设名] = React.useState('');
      const [题材, 设题材] = React.useState('');
      const [感觉, 设感觉] = React.useState('');
      const [忙, 设忙] = React.useState(false);

      const 走 = async () => {
        设忙(true);
        报('');
        try {
          await 发话(ctx, 新建(名.trim(), 题材.trim(), 感觉.trim()));
          报('发出去了，看对话那边。');
        } catch (e) {
          报('没发出去：' + (e?.message ?? e));
        } finally {
          设忙(false);
        }
      };

      return h(
        'div',
        { style: 卡列 },
        h('input', { style: 输入, placeholder: '卡名（可以先空着）', value: 名, onChange: (e) => 设名(e.target.value) }),
        h('textarea', {
          style: { ...输入, minHeight: '74px', resize: 'vertical' },
          placeholder: '这张卡讲的是什么事？（一两句就够）',
          value: 题材,
          onChange: (e) => 设题材(e.target.value),
        }),
        h('textarea', {
          style: { ...输入, minHeight: '58px', resize: 'vertical' },
          placeholder: '你想要什么感觉？（暧昧、阴冷、热闹、讲道理……）',
          value: 感觉,
          onChange: (e) => 设感觉(e.target.value),
        }),
        h('button', { style: 主按钮, disabled: 忙, onClick: 走 }, 忙 ? '正在发…' : '让它开始问我'),
      );
    }

    /* ---------------- 整页 ---------------- */

    function 制卡工坊(ctx) {
      const [报, 设报] = React.useState('');
      const [展开, 设展开] = React.useState(false);

      const 点 = (话) => async () => {
        设报('');
        try {
          await 发话(ctx, 话);
          设报('发出去了，看对话那边。');
        } catch (e) {
          设报('没发出去：' + (e?.message ?? e));
        }
      };

      return h(
        'div',
        { style: 页 },
        h('h1', { style: 标题 }, '制卡工坊'),
        h('p', { style: 小字 }, '点一下就行，不用记任何命令。说的每句话都会发给你正在聊的那个 AI。'),

        h('div', { style: 分节 }, '做一张新卡'),
        h('button', { style: 主按钮, onClick: () => 设展开(!展开) }, 展开 ? '先算了' : '＋ 我要做一张卡'),
        展开 ? h('div', { style: { marginTop: '12px' } }, 新建夹(ctx, 设报)) : null,

        h('div', { style: 分节 }, '手上这张卡'),
        h(
          'div',
          { style: 卡列 },
          ...常用.map((项) => h('button', { key: 项.k, style: 按钮, onClick: 点(项.话()) }, 项.名)),
        ),

        报 ? h('p', { style: 提示(报.startsWith('没') ? '#d0644a' : 'currentColor') }, 报) : null,

        h('p', { style: { ...小字, margin: '26px 0 0' } }, '要是 AI 不接活，先确认当前聊天用的是「制卡助手」预设。'),
      );
    }

    /* ---------------- 侧栏图标 ---------------- */

    function 入口() {
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', fontSize: '17px' }, title: '制卡工坊' },
        '⚒',
      );
    }

    /* ---------------- 注册 ---------------- */

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'cardforge', registrant: 'dsh-cardforge' }, () => 制卡工坊(ctx)),
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'cardforge', order: 30, label: { zh: '制卡工坊', en: 'Card Forge' }, registrant: 'dsh-cardforge' },
            入口,
          ),
        );
      },
    };
  },
});
