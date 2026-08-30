"""
geometry v13: сняты две глухие стены, за которыми вплотную стоит стекло.

  #14  h  y=8.917  x 13.031..16.83   — южная стена переговорной
  #16  h  y=8.96   x 19.693..20.56   — южный простенок кабинета у колонны

За каждой в glazing_interior уже есть панель (13.006..16.756 @ 8.988 и
19.659..20.649 @ 8.988) — стена и стекло стояли сэндвичем в 7 см друг от
друга, и стекло не было видно никогда. Убираем только стену. Подбор
по координатам, не по индексу.
"""
import json
G = json.load(open('geometry.json'))
assert G['version'] == 10
DROP = [('h', 8.917, 13.031, 16.83), ('h', 8.96, 19.693, 20.56)]
keep, gone = [], []
for w in G['walls_ortho']:
    hit = any(w['o'] == o and abs(w['pos'] - p) < 1e-3 and abs(w['p1'] - a) < 1e-3 and abs(w['p2'] - b) < 1e-3 for o, p, a, b in DROP)
    (gone if hit else keep).append(w)
assert len(gone) == 2, gone
G['walls_ortho'] = keep
for w in gone: print('снята стена', w)
json.dump(G, open('geom_v13_data.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('walls_ortho', len(keep) + 2, '->', len(keep))
