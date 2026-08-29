"""
geometry v9, первая половина: снятие остатков джогов у обоих проёмов.

Прямая инструкция без повторной проверки детектором: убрать группы вершин
целиком, чтобы каждый проём стал одним прямым разрывом периметра без
уступа и остатка стены.

  север:  ...11 -> 12(11.56,4.29) -> 13(11.56,2.72) -> 14(10.90,2.70) -> 15...
          заменить на прямую 11 -> 15 (в нумерации v7/до чистки прохода).
  запад:  ...22 -> 23(0.88,2.77) -> 24(0.75,2.28) -> 0...
          заменить на прямую 22 -> 0.

В текущем geometry.json (v8) вершина 14 (10.903,2.699) из v7 уже снята
прошлым проходом, индексы сдвинуты на 1: то, что было 12/13, сейчас
12/13 (без сдвига, они раньше точки сдвига), а то, что было 23/24, сейчас
22/23 (сдвинуты на -1). Снимаем по КООРДИНАТАМ, а не по индексам,
чтобы не зависеть от того, что чему сейчас соответствует.
"""
import json
import numpy as np
from shapely.geometry import Polygon, LineString, Point

G = json.load(open('geometry.json'))
assert G.get('version') == 8, 'need v8'
TH = G['wall_th']
C = np.array(G['slab'])
print('v8 contour:', len(C), 'вершин')

def nearest_idx(pt, tol=0.05):
    d = np.hypot(C[:, 0] - pt[0], C[:, 1] - pt[1])
    i = int(np.argmin(d))
    assert d[i] < tol, f'{pt} не нашлась рядом (ближайшая {C[i]}, {d[i]:.3f} м)'
    return i

DROP_PTS = [
    (11.557, 4.288), (11.557, 2.718),   # север: старые 12, 13
    (0.874, 2.769), (0.747, 2.29),      # запад: старые 23, 24
]
DROP = sorted(nearest_idx(p) for p in DROP_PTS)
print('снимаем индексы (по координатам):', DROP, [list(C[i]) for i in DROP])
assert len(set(DROP)) == 4, 'должно быть ровно 4 разные вершины'

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


# Прямая 22->0 проходит в 1,25 м от старой косяки (0.714,2.843) — та точка
# была осмысленной только для снятого уступа. Вторая (0.635,4.249) легла
# на новую стену почти без сдвига (0.033 м); от неё и строим проём той же
# документированной ширины 1,41 м вдоль новой прямой стены.
G['openings'] = [
    snap((0.65, 4.279), (1.907, 3.639), 'west entrance'),
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
json.dump(G, open('geom_stage3.json', 'w'), ensure_ascii=False, indent=1)
print('stage3 ok, facade', G['facade_total_m'])
