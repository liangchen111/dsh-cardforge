# 定位自检第 12 项：Python 侧（oracle）在酒馆往返各阶段的条目顺序。
import json
import os
import sys
import tempfile
import shutil

sys.path.insert(0, r'E:\workGZQ\制卡工具')
from forge import scaffold, pack, bridge, model as M
from forge import export as EX

无 = lambda *a, **k: None
工作 = tempfile.mkdtemp(prefix='_tmp_probe12py-', dir=r'E:\workGZQ\制卡工具\差分')
try:
    proj = scaffold.new_card('自检卡', dest=工作, quiet=True)
    spec = os.path.join(proj, 'source', '自检卡.spec.yaml')
    card_path = os.path.join(工作, '自检卡.card.json')
    pack.build(spec, card_path)
    card2 = M.jload(card_path)
    back = os.path.join(工作, 'back.json')
    EX.to_tavern(card_path, back, out=无)
    sp4 = os.path.join(工作, 'back.spec.yaml')
    bridge.to_eleckoi(back, sp4, out=无)
    card4 = pack.spec_to_card(sp4)

    backj = M.jload(back)
    book = (backj.get('data') or {}).get('character_book') or backj.get('character_book') or {}
    ents = book.get('entries') or []
    print('酒馆书条目：')
    for i, e in enumerate(ents):
        print('   %d  name=%r constant=%r insertion_order=%r' % (i, e.get('name'), e.get('constant'), e.get('insertion_order')))
    print('desc 前 200：', repr((backj.get('data') or {}).get('description', '')[:200]))

    sp4j = M.yload(sp4)
    lib = (sp4j.get('library') or {}).get('entries') or []
    print('回读 spec 条目：')
    for e in lib:
        print('   title=%r order=%r position=%r' % (e.get('title'), e.get('order'), e.get('position')))

    def 名(c):
        return ['%s:%s' % (e.get('order'), e.get('title')) for e in (c['setting_library']['versions'][0]['entries'] or [])]
    print('卡2 顺序：', 名(card2))
    print('卡4 顺序：', 名(card4))
finally:
    shutil.rmtree(工作, ignore_errors=True)
