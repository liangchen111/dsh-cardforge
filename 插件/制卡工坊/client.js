/**
 * 浏览器那一半 —— 「制卡工坊」面板。
 *
 * 目的：**使用者永远不碰命令**。面板上全是人话按钮，点一下 = 把一句人话送进当前对话，
 * 由对话里的 AI 去干活（ElecKoi 里还会给它配上「制卡助手」创作预设；纯 DSH 没有预设这个概念）。
 *
 * 挂哪儿：
 *   1. **DSH 自己那套壳**：`main`（keyed，一整页）＋ `sidebar.panellist`（list，侧栏入口图标）
 *   2. **ElecKoi 的槽**：`eleckoi.roleplay.conversation.input.dock`（list / session，输入框上方那一条）
 * 三个都挂上 —— `ctx.slots.inject` 只是排队等着，哪套壳声明了哪个槽就哪个生效，不会报错。
 *
 * 说话的办法（两条路，自动挑）：
 *   甲 · ElecKoi：客户端服务 `eleckoiConversations`
 *       readSelection() → { active_conversation_id }
 *       writeInputDraft(conversationId, text)  写进官方输入框
 *       submitInput(conversationId) → boolean  请官方输入框提交
 *       用官方输入框而不是 `send()`：文本会先在输入框里露一下，用户看得见、出事好回退。
 *   乙 · DSH：那边没有 `eleckoiConversations`（那是 ElecKoi 的服务）⇒ 直接找输入框写值、
 *       派发 `input`／回车事件，不行再点「发送」。纯 DOM，不依赖任何服务名。
 *
 * 【两条铁律，0.30.3 加的 —— 上一版就是栽在这上面】
 *   1. **每个组件必须是真组件**（`h(甲, {…})`），不许把函数组件当普通函数调用（`甲(ctx)`）。
 *      后者会把子组件的 `useState` 记到父组件头上，hook 数量一变化，React 就抛
 *      「Rendered more hooks than during the previous render」——整棵客户端树被卸载 ⇒ **白屏**。
 *   2. **每个挂出去的组件都套一层错误边界**（`兜底`）。面板自己坏掉只许显示一条错话，
 *      绝不许把整个应用带成空白。
 *
 * 注意：`id` 必须**等于**包名（官方要求），这里是 `dsh-cardforge`。
 * React 由浏览器模块表提供，不要自己再装一份。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cardforge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /* ---------------- 错误边界（面板坏了不许连坐整个界面） ---------------- */

    class 兜底 extends React.Component {
      constructor(p) {
        super(p);
        this.state = { 错: null };
      }
      static getDerivedStateFromError(错) {
        return { 错 };
      }
      componentDidCatch(错) {
        console.warn('[制卡工坊] 面板出错：', 错);
      }
      render() {
        if (this.state.错) {
          const 话 = String(this.state.错?.message ?? this.state.错);
          return h(
            'div',
            { style: { padding: '18px 20px', fontSize: '13px', lineHeight: 1.7, opacity: 0.9 } },
            h('div', null, '制卡工坊这块出了点错（别的功能不受影响）：'),
            h('div', { style: { marginTop: '6px', fontSize: '12px', opacity: 0.75, whiteSpace: 'pre-wrap' } }, 话),
          );
        }
        return this.props.children;
      }
    }

    const 包 = (组件) => () => h(兜底, null, h(组件, null));

    /* ---------------- 说话 ---------------- */

    function 取服务(ctx, 名) {
      const 表 = [ctx?.[名], ctx?.get?.(名), ctx?.services?.[名]];
      return 表.find((x) => x) ?? null;
    }

    async function 发话(ctx, 话) {
      const 服务 = 取服务(ctx, 'eleckoiConversations');
      if (服务?.readSelection && 服务?.writeInputDraft) {
        const 选 = await 服务.readSelection();
        const 编号 = 选?.active_conversation_id;
        if (!编号) throw new Error('先打开一个聊天，再点这里。');
        服务.writeInputDraft(编号, 话);
        if (!服务.submitInput(编号)) throw new Error('没发出去 —— 输入框正忙或内容被清空了。');
        return;
      }
      // DSH 这边没有 eleckoiConversations（那是 ElecKoi 的服务）⇒ 直接操作输入框。
      塞进输入框(话);
    }

    /* ---------------- DSH 那条路：直接操作输入框 ---------------- */

    function 找输入框() {
      const 框 = [...document.querySelectorAll('textarea')].filter((t) => !t.disabled && !t.readOnly);
      if (框.length) return 框[框.length - 1];
      const 可编 = [...document.querySelectorAll('[contenteditable="true"]')];
      return 可编.length ? 可编[可编.length - 1] : null;
    }

    function 写值(框, 话) {
      if (框.tagName === 'TEXTAREA' || 框.tagName === 'INPUT') {
        const 设值 = Object.getOwnPropertyDescriptor(框.constructor.prototype, 'value')?.set;
        if (设值) 设值.call(框, 话);
        else 框.value = 话;
      } else {
        框.textContent = 话;
      }
      框.dispatchEvent(new Event('input', { bubbles: true }));
      框.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const 像回车 = (型) => new KeyboardEvent(型, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });

    function 点发送() {
      const 钮 = [...document.querySelectorAll('button')].find((b) => {
        const 文 = (b.getAttribute('aria-label') ?? '') + (b.title ?? '') + (b.textContent ?? '');
        return /发送|发 送|send/i.test(文);
      });
      if (钮) {
        钮.click();
        return true;
      }
      return false;
    }

    function 塞进输入框(话) {
      const 框 = 找输入框();
      if (!框) throw new Error('没找到输入框 —— 先打开一个聊天。');
      写值(框, 话);
      框.dispatchEvent(像回车('keydown'));
      框.dispatchEvent(像回车('keyup'));
      setTimeout(() => {
        const 还留着 = 框.tagName === 'TEXTAREA' ? 框.value === 话 : 框.textContent === 话;
        if (还留着) 点发送();
      }, 150);
    }

    /* ---------------- 人话模板 ---------------- */

    const 新建 = (名, 题材, 感觉) =>
      '帮我做一张新卡。' +
      (名 ? `名字先叫「${名}」。` : '') +
      (题材 ? `它讲的是：${题材}` : '') +
      (感觉 ? `我想要的感觉是：${感觉}` : '') +
      '你先取规程，再把要先定下来的几件事一次问完，别一条一条挤牙膏。';

    const 常用 = [
      { k: '继续', 名: '接着做', 话: '接着把这张卡做下去——我们上次停在哪儿，你先看一眼再动手。' },
      { k: '体检', 名: '体检', 话: '给这张卡做一次体检，问题按轻重排给我，能顺手修的直接修掉。' },
      { k: '成品', 名: '出成品', 话: '把这张卡出成成品。出完告诉我卡名，以及成品文件在哪儿。' },
      { k: '导入', 名: '导入', 话: '把这张卡的成品导进 ElecKoi。' },
    ];

    /* ---------------- 样式 ---------------- */

    const 条 = {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 2px',
      fontSize: '12.5px',
      color: 'currentColor',
      fontFamily: 'inherit',
    };
    const 片 = {
      padding: '4px 10px',
      border: '1px solid currentColor',
      borderRadius: '999px',
      background: 'transparent',
      color: 'inherit',
      fontSize: '12.5px',
      lineHeight: 1.6,
      cursor: 'pointer',
      fontFamily: 'inherit',
      opacity: 0.82,
      whiteSpace: 'nowrap',
    };
    const 主片 = { ...片, fontWeight: 600, opacity: 1 };
    const 报话 = { opacity: 0.7, fontSize: '12px' };
    const 浮层 = {
      flexBasis: '100%',
      display: 'grid',
      gap: '8px',
      marginTop: '6px',
      padding: '12px',
      border: '1px solid currentColor',
      borderRadius: '12px',
      opacity: 0.95,
    };
    const 输入 = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 10px',
      border: '1px solid currentColor',
      borderRadius: '8px',
      background: 'transparent',
      color: 'inherit',
      fontSize: '13px',
      fontFamily: 'inherit',
      opacity: 0.9,
    };
    const 分节 = { fontSize: '12px', fontWeight: 600, opacity: 0.7, margin: '14px 0 6px' };
    const 卡列 = { display: 'grid', gap: '8px' };
    const 长片 = { ...片, borderRadius: '9px', textAlign: 'left', padding: '10px 12px', opacity: 0.9 };
    const 页 = { padding: '28px 32px', maxWidth: '46rem', color: 'currentColor', lineHeight: 1.7 };
    const 标题 = { fontSize: '20px', fontWeight: 600, margin: '0 0 4px' };
    const 小字 = { fontSize: '12px', opacity: 0.6, margin: '0 0 22px' };

    /* ---------------- 新建表单（真组件！hooks 归它自己） ---------------- */

    function 新建夹({ ctx, 报, 紧凑 }) {
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
          style: { ...输入, minHeight: 紧凑 ? '52px' : '74px', resize: 'vertical' },
          placeholder: '这张卡讲的是什么事？（一两句就够）',
          value: 题材,
          onChange: (e) => 设题材(e.target.value),
        }),
        h('textarea', {
          style: { ...输入, minHeight: 紧凑 ? '44px' : '58px', resize: 'vertical' },
          placeholder: '你想要什么感觉？（暧昧、阴冷、热闹、讲道理……）',
          value: 感觉,
          onChange: (e) => 设感觉(e.target.value),
        }),
        h('button', { style: 主片, disabled: 忙, onClick: 走 }, 忙 ? '正在发…' : '让它开始问我'),
      );
    }

    /* ---------------- 输入框上方的条（ElecKoi） ---------------- */

    function 工坊条({ ctx }) {
      const [报, 设报] = React.useState('');
      const [开, 设开] = React.useState(false);

      const 点 = (话) => async () => {
        设报('');
        try {
          await 发话(ctx, 话);
          设报('发出去了');
        } catch (e) {
          设报('没发出去：' + (e?.message ?? e));
        }
      };

      return h(
        'div',
        { style: 条 },
        h('button', { style: 主片, title: '制卡工坊', onClick: () => 设开(!开) }, 开 ? '⚒ 收起' : '⚒ 做新卡'),
        ...常用.map((项) => h('button', { key: 项.k, style: 片, onClick: 点(项.话) }, 项.名)),
        报 ? h('span', { style: 报话 }, 报) : null,
        开 ? h('div', { style: 浮层 }, h(新建夹, { ctx, 报: 设报, 紧凑: true })) : null,
      );
    }

    /* ---------------- 整页（DSH 的 main 槽；ElecKoi 里不会出现） ---------------- */

    function 制卡工坊({ ctx }) {
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
        h('button', { style: 主片, onClick: () => 设展开(!展开) }, 展开 ? '先算了' : '＋ 我要做一张卡'),
        展开 ? h('div', { style: { marginTop: '12px' } }, h(新建夹, { ctx, 报: 设报, 紧凑: false })) : null,

        h('div', { style: 分节 }, '手上这张卡'),
        h(
          'div',
          { style: 卡列 },
          ...常用.map((项) => h('button', { key: 项.k, style: 长片, onClick: 点(项.话) }, 项.名)),
        ),

        报 ? h('p', { style: { ...小字, marginTop: '12px', opacity: 0.9 } }, 报) : null,

        h('p', { style: { ...小字, margin: '26px 0 0' } }, 取服务(ctx, 'eleckoiAgentPresetsApi')
          ? '要是 AI 不接活，先确认当前聊天用的是「制卡助手」预设。'
          : '要是 AI 不接活：确认这段对话里它手上有 cardforge 工具（插件列表里「制卡工坊」显示运行中）。'),
      );
    }

    /* ---------------- 侧栏图标（DSH 的 sidebar.panellist；ElecKoi 里不会出现） ---------------- */

    function 入口() {
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', fontSize: '17px' }, title: '制卡工坊' },
        '⚒',
      );
    }

    /* ---------------- 注册 ---------------- */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // 面板上的字走官方 locale 字典（`label` 是个**函数**，按当前语言取）。
        try {
          ctx.locale?.register?.('dsh-cardforge', {
            zh: { 'panel.title': '制卡工坊' },
            en: { 'panel.title': 'Card Forge' },
          })
        } catch {}
        const 取名 = () => {
          try {
            const t = ctx.locale?.bind?.('dsh-cardforge')
            if (typeof t === 'function') {
              const 值 = t('panel.title')
              if (值) return 值
            }
          } catch {}
          return '制卡工坊'
        };
        // 一个槽挂了，绝不许把别的槽（乃至整个客户端）连坐。
        const 挂 = (槽, 选项, 组件) => {
          try {
            ctx.slots.inject(槽, () => {
              try {
                ctx.slots.register(选项, 组件)
              } catch (错) {
                console.warn('[制卡工坊] 注册槽失败：' + 槽, 错)
              }
            })
          } catch (错) {
            console.warn('[制卡工坊] 取槽失败：' + 槽, 错)
          }
        };
        // ElecKoi：输入框上方那一区。这是主入口。
        挂(
          'eleckoi.roleplay.conversation.input.dock',
          { name: 'eleckoi.roleplay.conversation.input.dock', id: 'dsh-cardforge', order: 40 },
          包(工坊条),
        )
        // DSH 自己那套壳（ElecKoi 里这两个槽不会被声明，inject 只是等着，不会报错）。
        挂('main', { name: 'main', key: 'dsh-cardforge', locale: 'dsh-cardforge' }, 包(制卡工坊))
        挂(
          'sidebar.panellist',
          { name: 'sidebar.panellist', id: 'dsh-cardforge', order: 30, label: 取名, locale: 'dsh-cardforge' },
          包(入口),
        )
      },
    };
  },
});
