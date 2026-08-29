"""
geometry v8, первая половина: снятие северного джога у прохода.

Проверено против public/plan_113n_3652px.png (162,29 px/м, 50%-плотностной
след кромки): вершина 14 (10,903; 2,699) стоит на 0,23-0,27 м южнее
настоящей стены. Прямая 13->15 приближает реальную границу со средней
ошибкой 0,09 м против 0,23 м у текущего джога — визуально подтверждено
на срезе /tmp/north_density.png. Джог у западного входа (вершина 23)
проверен тем же способом и, наоборот, подтверждён планом — не трогаем.
"""
import json
import numpy as np
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union

G = json.load(open('geometry.json'))
assert G.get('version') == 7, 'need v7'
TH = G['wall_th']
C = np.array(G['slab'])
DROP = [14]
C2 = C[[i for i in range(len(C)) if i not in DROP]]
P = Polygon(C2)
for _ in range(60):
    e = P.area - 244.1
    if abs(e) < 0.02:
        break
    P = P.buffer(-e / P.length / 2, join_style=2, mitre_limit=12).simplify(0.003)
    if P.geom_type != 'Polygon':
        P = max(P.geoms, key=lambda g: g.area)
C3 = np.array(P.exterior.coords)[:-1]
slab = Polygon(C3)
rl = slab.exterior
RL = rl.length
G['slab'] = [[round(float(x), 3), round(float(y), 3)] for x, y in C3]
print('contour', len(C), '->', len(C3), 'area %.2f' % slab.area)


def snap(p1, p2, nm):
    a = np.array(rl.interpolate(rl.project(Point(*p1))).coords[0])
    b = np.array(rl.interpolate(rl.project(Point(*p2))).coords[0])
    return dict(name=nm, x1=round(float(a[0]), 3), y1=round(float(a[1]), 3),
                x2=round(float(b[0]), 3), y2=round(float(b[1]), 3),
                len=round(float(np.hypot(*(b - a))), 2))


G['openings'] = [
    snap((0.714, 2.843), (0.635, 4.249), 'west entrance'),
    snap((10.8, 2.231), (9.45, 2.24), 'north passage'),
    snap((18.48, 5.377), (17.04, 5.399), 'north-east passage'),
]
for o in G['openings']:
    print('  opening', o['name'], o['len'])

runs = []
for r in G['glazing_runs']:
    s1, s2 = rl.project(Point(r['x1'], r['y1'])), rl.project(Point(r['x2'], r['y2']))
    if abs(s2 - s1) > RL / 2:
        s1, s2 = max(s1, s2), min(s1, s2) + RL
    a = np.array(rl.interpolate(min(s1, s2) % RL).coords[0])
    b = np.array(rl.interpolate(max(s1, s2) % RL).coords[0])
    runs.append(dict(side=r['side'], x1=round(float(a[0]), 3), y1=round(float(a[1]), 3),
                      x2=round(float(b[0]), 3), y2=round(float(b[1]), 3),
                      len=round(float(np.hypot(*(b - a))), 2)))
G['glazing_runs'] = runs
G['facade_total_m'] = round(sum(r['len'] for r in runs), 2)
json.dump(G, open('geom_stage2.json', 'w'), ensure_ascii=False, indent=1)
print('stage2 ok, facade', G['facade_total_m'])
