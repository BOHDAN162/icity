"""geometry v15 (данные): семь согласованных правок по разметке.
1 зелёный: стекло кабинета y 8,988 продлить с x 20,649 до 20,77 (край колонны 21,29 Ø1,04).
2 синий:   стена #21 (x 4,04, y 5,348-6,197) -> снять, на её месте стекло.
3 синий:   стена #20 (x 4,022, y 8,025-9,022) -> снять; стекло за ней уже есть.
4 красный: стык Skype x 4,04 y 7,05-7,50 -> снять (все копии).
5 красный: микровыступ x 9,43 y 3,63-4,10 -> снять.
   + дедупликация walls_ortho (обрубок у прохода лежал дважды).
Розовые (торцы) — в pv15b.py, они про сборку полигонов, не про данные."""
import json
G = json.load(open('geometry.json')); assert G['version'] == 14
def same(w, o, pos, p1, p2): return w['o']==o and abs(w['pos']-pos)<2e-3 and abs(w['p1']-p1)<2e-3 and abs(w['p2']-p2)<2e-3
DROP = [('v',4.04,5.348,6.197), ('v',4.022,8.025,9.022), ('v',4.04,7.05,7.5), ('v',9.43,3.63,4.1)]
seen, keep, gone = set(), [], []
for w in G['walls_ortho']:
    key = (w['o'], round(w['pos'],3), round(w['p1'],3), round(w['p2'],3))
    if key in seen: gone.append(('dup', w)); continue
    seen.add(key)
    if any(same(w,*d) for d in DROP): gone.append(('drop', w))
    else: keep.append(w)
for g in gone: print(*g)
assert sum(1 for k,_ in gone if k=='drop') == 4, gone
G['walls_ortho'] = keep
n = 0
for g in G['glazing_interior']:
    if abs(g['y1']-8.988)<1e-3 and abs(g['x2']-20.649)<1e-3: g['x2'] = 20.77; g['len'] = round(g['x2']-g['x1'],2); n += 1
assert n == 1
G['glazing_interior'].append({'x1':4.04,'y1':5.348,'x2':4.04,'y2':6.197,'len':0.85})
print('walls_ortho ->', len(keep), '| glazing_interior ->', len(G['glazing_interior']))
json.dump(G, open('geom_v15_data.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
