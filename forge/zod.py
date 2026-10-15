# -*- coding: utf-8 -*-
"""forge.zod —— Zod 结构的小解析器 / 保形生成器。

为什么需要它：一条变量在卡里要写**三处** —— 画面板的 objects、初始值 initial_state、
以及 Zod 校验代码 schema_code。第三处是一整段 JS 代码（在卡里就是个字符串），
往对象里加一个字段就得同时往那段代码里加一行；漏了不报错，运行时**静默丢掉**
写进去的值（validate 里的 VAR-SYNC-SCHEMA 就是在事后兜这个）。

于是这一层只做一件事：把 `z.object({...})` 拆成一棵树，**原样存住**每个叶子的
表达式，再按稳定格式拼回去。于是：

    · 手写的约束（`z.number().int().min(1).max(20)`）原样留着，不被简化、不被重排；
    · 逗号在函数调用里、在字符串里，靠括号与引号配对认出来，不当成分隔符；
    · 认不出来的形状**直接拒绝**（ZodError），绝不上猜 —— 猜错等于悄悄改掉
      别人写好的校验规则，那比拒绝糟得多。

只有一条路是例外：**嵌套**的对象如果形状认不出（比如带了 `.passthrough()`），
就当一个不透明的叶子原样留着 —— 它能被整体复制、删除，只是不能往里加字段。
"""
from __future__ import annotations

import re
from collections import OrderedDict

__all__ = ["ZodError", "Obj", "Leaf", "parse", "emit", "dump", "expr_for",
           "set_leaf", "drop", "sync", "is_object", "top_keys", "roundtrip_ok",
           "node_at", "rename_key", "key_raw"]


class ZodError(Exception):
    """这份 Zod 代码的形状工具不认，拒改。措辞要能让人看懂是哪儿。"""


# ------------------------------------------------------------------ 树
class Obj:
    """一个 z.object({...})。kids 按原顺序存子节点，raw 存键的原始写法。"""
    __slots__ = ("kids", "raw")

    def __init__(self, kids=None, raw=None):
        self.kids = OrderedDict(kids or [])
        self.raw = dict(raw or {})

    def __repr__(self):
        return "Obj(%s)" % ", ".join(self.kids)


class Leaf:
    """其余一切：一段原样留着的表达式（z.string()、z.array(z.any())…）。"""
    __slots__ = ("code",)

    def __init__(self, code):
        self.code = code

    def __repr__(self):
        return "Leaf(%r)" % self.code


# ------------------------------------------------------------------ 扫描
_QUOTES = "\"'`"
_OPEN = "([{"
_CLOSE = ")]}"


def _scan_close(s, i):
    """s[i] 是左括号，返回配对右括号的下标。字符串里的括号不算。"""
    depth = 0
    q = None
    j = i
    n = len(s)
    while j < n:
        c = s[j]
        if q:
            if c == "\\":
                j += 2
                continue
            if c == q:
                q = None
            j += 1
            continue
        if c in _QUOTES:
            q = c
        elif c in _OPEN:
            depth += 1
        elif c in _CLOSE:
            depth -= 1
            if depth == 0:
                return j
        j += 1
    raise ZodError("括号没配平")


def _split_top(s):
    """在括号深度 0 处按逗号切开。"""
    parts = []
    depth = 0
    q = None
    start = 0
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if q:
            if c == "\\":
                i += 2
                continue
            if c == q:
                q = None
            i += 1
            continue
        if c in _QUOTES:
            q = c
        elif c in _OPEN:
            depth += 1
        elif c in _CLOSE:
            depth -= 1
            if depth < 0:
                raise ZodError("右括号比左括号多")
        elif c == "," and depth == 0:
            parts.append(s[start:i])
            start = i + 1
        i += 1
    if q:
        raise ZodError("引号没关上")
    if depth != 0:
        raise ZodError("括号没配平")
    parts.append(s[start:])
    return parts


def _split_key(part):
    """把 `键: 表达式` 在顶部那个冒号处切开。切不出冒号说明我们切错了地方。"""
    depth = 0
    q = None
    i = 0
    while i < len(part):
        c = part[i]
        if q:
            if c == "\\":
                i += 2
                continue
            if c == q:
                q = None
            i += 1
            continue
        if c in _QUOTES:
            q = c
        elif c in _OPEN:
            depth += 1
        elif c in _CLOSE:
            depth -= 1
        elif c == ":" and depth == 0:
            return part[:i], part[i + 1:]
        i += 1
    return None, None


# JS 标识符（中日韩汉字在 JS 里本来就是合法标识符字符，所以中文裸键放行）
_IDENT = re.compile(r"^[A-Za-z_$\u00a0-\uffff][\w$\u00a0-\uffff]*$")


def _key_of(raw):
    t = raw.strip()
    if len(t) >= 2 and t[0] == t[-1] and t[0] in _QUOTES:
        return t[1:-1], t
    if _IDENT.match(t):
        return t, t
    raise ZodError("键的写法认不出：%s" % (raw.strip()[:24] or "(空)"))


# ------------------------------------------------------------------ 解析
def parse(code):
    """一段 Zod 代码 -> 树。顶层不是单个干净的 z.object(...) 就抛错。"""
    t = str(code or "").strip()
    if t.endswith(";"):
        t = t[:-1].strip()
    if not t:
        return Obj()
    return _parse_object(t)


def _parse_object(s):
    t = s.strip()
    if not t.startswith("z.object"):
        raise ZodError("顶层不是 z.object(...)：开头是「%s」" % t[:24])
    k = len("z.object")
    if k >= len(t) or t[k] != "(":
        raise ZodError("z.object 后面不是左括号")
    close = _scan_close(t, k)
    tail = t[close + 1:].strip()
    if tail:
        raise ZodError("z.object(...) 后面还跟着「%s」—— 这种形状工具不碰"
                       % tail[:16])
    inner = t[k + 1:close].strip()
    if not inner.startswith("{"):
        raise ZodError("z.object(...) 里不是一对花括号")
    end = _scan_close(inner, 0)
    if end != len(inner) - 1:
        raise ZodError("z.object(...) 里的花括号不止一对")
    node = Obj()
    for part in _split_top(inner[1:end]):
        if not part.strip():
            continue
        rawkey, expr = _split_key(part)
        if rawkey is None:
            raise ZodError("这一段看不懂（找不到冒号）：%s" % part.strip()[:32])
        key, raw = _key_of(rawkey)
        if key in node.kids:
            raise ZodError("同一个对象里出现了两次「%s」" % key)
        node.kids[key] = _parse_expr(expr)
        node.raw[key] = raw
    return node


def _parse_expr(expr):
    t = str(expr or "").strip()
    if t.startswith("z.object"):
        try:
            return _parse_object(t)
        except ZodError:
            # 形状认不出的嵌套对象：原样留着（能整体复制 / 删除，只是进不去）
            return Leaf(t)
    return Leaf(t)


# ------------------------------------------------------------------ 生成
MAX_INLINE = 96          # 一行的舒服上限（含缩进）；超了就一层一行


def emit(node, indent=0):
    """树 -> 代码。格式是稳定的：短对象写成一行，长对象一层一行。

    「稳」在这里是硬要求 —— 同样的树必须每次都出同样的字。不然每次跑一遍工具，
    卡里那段 schema 就抖一下，写进 git 全是噪声，也没法拿字符串比对。
    """
    if isinstance(node, Leaf):
        return node.code
    kids = [(k, v) for k, v in node.kids.items() if v is not None]
    if not kids:
        return "z.object({})"
    if all(isinstance(v, Leaf) for _, v in kids):
        inline = "z.object({ %s })" % ", ".join(
            "%s: %s" % (node.raw.get(k) or k, emit(v)) for k, v in kids)
        if len(inline) + 2 * indent <= MAX_INLINE:
            return inline
    pad = "  " * (indent + 1)
    body = "".join("%s%s: %s,\n" % (pad, node.raw.get(k) or k, emit(v, indent + 1))
                   for k, v in kids)
    return "z.object({\n%s%s})" % (body, "  " * indent)


def dump(node):
    """树 -> 普通嵌套结构（字符串=叶子表达式）。给人看、给测试比。"""
    if isinstance(node, Leaf):
        return node.code
    return OrderedDict((k, dump(v)) for k, v in node.kids.items())


def top_keys(code):
    return list(parse(code).kids)


def is_object(code):
    try:
        parse(code)
        return True
    except ZodError:
        return False


def roundtrip_ok(code):
    """解析 -> 生成 -> 再解析，两棵树必须一模一样。用于自检与「改前先证明」。"""
    a = dump(parse(code))
    b = dump(parse(emit(parse(code))))
    return a == b


# ------------------------------------------------------------------ 类型
_TYPES = {
    "boolean": "z.boolean()",
    "bool": "z.boolean()",
    "string": "z.string()",
    "number": "z.number()",
    "int": "z.number().int()",
    "array": "z.array(z.any())",
    "object": "z.object({})",
}


def expr_for(type_name, value=None):
    """按变量的类型名给一个 Zod 表达式；类型名没写就按初值的形状猜。"""
    t = str(type_name or "").strip().lower()
    if t in _TYPES:
        return _TYPES[t]
    if isinstance(value, bool):
        return "z.boolean()"
    if isinstance(value, (int, float)):
        return "z.number()"
    if isinstance(value, list):
        return "z.array(z.any())"
    if isinstance(value, dict):
        return "z.object({})"
    if isinstance(value, str):
        return "z.string()"
    return "z.any()"


# ------------------------------------------------------------------ 改树
def _walk(node, path, create=True):
    cur = node
    for seg in path:
        if isinstance(cur, Leaf):
            raise ZodError(
                "「%s」在 Zod 里不是纯 z.object({...})（现在写的是 %s），"
                "工具没法往里加字段" % (".".join(path), cur.code[:30]))
        child = cur.kids.get(seg)
        if child is None:
            if not create:
                return None, None
            child = Obj()
            cur.kids[seg] = child
            cur.raw[seg] = seg
        cur = child
    return cur, cur


def set_leaf(root, path, key, code):
    """在 path 那层放一个叶子。path 为空表示根。"""
    if isinstance(root, Leaf):
        raise ZodError("顶层不是 z.object，加不了字段")
    node, _ = _walk(root, tuple(path))
    if isinstance(node, Leaf):
        raise ZodError("走不到「%s」那层" % ".".join(path))
    node.kids[key] = Leaf(str(code).strip())
    node.raw[key] = key
    return root


def drop(root, path, key=None):
    """删掉 path 那层的 key；key 为空则整个 path 节点删掉。"""
    path = tuple(path)
    if isinstance(root, Leaf):
        raise ZodError("顶层不是 z.object，删不了")
    if not path:
        if key in root.kids:
            del root.kids[key]
            root.raw.pop(key, None)
        return root
    if key is None:
        parent, _ = _walk(root, path[:-1])
        if isinstance(parent, Leaf):
            return root
        if path[-1] in parent.kids:
            del parent.kids[path[-1]]
            parent.raw.pop(path[-1], None)
        return root
    node, _ = _walk(root, path)
    if not isinstance(node, Leaf) and key in node.kids:
        del node.kids[key]
        node.raw.pop(key, None)
    return root


def key_raw(k):
    """一个键该怎么写：能当标识符就裸写（中文在 JS 里本来就是合法标识符），否则加引号。"""
    k = str(k)
    if _IDENT.match(k):
        return k
    return '"%s"' % k.replace("\\", "\\\\").replace('"', '\\"')


def node_at(root, path):
    """按路径走到某个节点；走不到（或中途是叶子）返回 None。只读，不改树。"""
    cur = root
    for seg in path:
        if isinstance(cur, Leaf):
            return None
        cur = cur.kids.get(seg)
        if cur is None:
            return None
    return cur


def rename_key(node, 旧, 新):
    """把 node 里 `旧` 这个键改名成 `新` —— **整棵子树跟着走，顺序不动**。

    变量改名 / 对象改名都要落到这里：Zod 里那个字段名就是变量的名字本身，
    只改面板上那一处、把 schema 落下，值写进去会被静默丢掉（VAR-SYNC-SCHEMA 兜的
    就是这种）。顺序必须保持 —— `emit` 是按 `kids` 的顺序出字的，重排一遍就
    等于把整段 schema 抖乱，写进 git 全是噪声。

    返回 True 表示真改了。
    """
    if isinstance(node, Leaf):
        return False
    旧, 新 = str(旧), str(新)
    if 旧 not in node.kids or 旧 == 新:
        return False
    for d in (node.kids, node.raw):
        新表 = OrderedDict()
        for k, v in d.items():
            新表[新 if k == 旧 else k] = v
        d.clear()
        d.update(新表)
    node.raw[新] = key_raw(新)
    return True


def sync(root, state, types, out=None):
    """让 schema 与 initial_state 对齐。

    状态里有的补上（用变量的类型推表达式），状态里没有的删掉 —— **已有的叶子
    表达式原样保留**，手写的 .min(1).max(20) 不会被抹掉。

    types: {("对象名", "字段名"): "number"} 这样按路径给类型；没给就按初值猜。
    state: initial_state 那棵树。
    """
    say = out or (lambda s: None)
    types = dict(types or {})

    def walk(node, st, path):
        if isinstance(node, Leaf):
            raise ZodError("「%s」在 Zod 里不是纯 z.object({...})，对不齐"
                           % (".".join(path) or "(根)"))
        want = st if isinstance(st, dict) else {}
        for k in list(node.kids):
            if k not in want:
                got = node.kids[k]
                say("      · schema 里删掉「%s」—— 另两处已经没有它了"
                    % ".".join(path + (k,)))
                del node.kids[k]
                node.raw.pop(k, None)
                del got
        for k, v in want.items():
            if isinstance(v, dict):
                child = node.kids.get(k)
                if child is None or isinstance(child, Leaf):
                    if child is not None:
                        say("      · schema 里「%s」原来是 %s，状态里它是个对象，"
                            "改写成 z.object" % (k, child.code[:24]))
                    child = Obj()
                    node.kids[k] = child
                    node.raw[k] = k
                walk(child, v, path + (k,))
            else:
                if k not in node.kids:
                    expr = expr_for(types.get(path + (k,)), v)
                    node.kids[k] = Leaf(expr)
                    node.raw[k] = k
                    say("      · schema 里补上「%s: %s」" % (k, expr))
                elif isinstance(node.kids[k], Obj):
                    say("      · schema 里「%s」本来是个对象，状态里它是个值，"
                        "改成 %s" % (k, expr_for(types.get(path + (k,)), v)))
                    node.kids[k] = Leaf(expr_for(types.get(path + (k,)), v))

    walk(root, state if isinstance(state, dict) else {}, ())
    return root
