/**
 * 浏览器那一半 —— 全部渲染都在这儿。
 *
 * 这是照着官方模板 `templates/decoration/client.js` 改的，只动了两处：
 *   1. 懒加载工厂的 id 改成我们的包名（官方要求：id 必须**等于**包名）；
 *   2. 把那个蓝圆圈换成一行字，好让你一眼认出来。
 *
 * 挂的位置是 `conversation.composer.dock`（输入框下面那条槽），官方推荐的
 * 「简单画点东西」用位。React 由浏览器模块表提供，不要自己再装一份。
 */
window.__ModuleLoader__.load({
  id: '@local/cardforge-probe',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    function Probe() {
      return h(
        'div',
        {
          'aria-hidden': true,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            margin: '6px 0',
            padding: '3px 10px',
            border: '1px solid currentColor',
            borderRadius: '999px',
            fontSize: '12px',
            lineHeight: 1.5,
            opacity: 0.72,
            pointerEvents: 'none',
          },
        },
        '\u5236\u5361\u63a2\u9488 \u00b7 \u63d2\u4ef6\u901a\u4e86'
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'cardforge-probe',
              order: 5,
            },
            Probe
          )
        );
      },
    };
  },
});
